#!/usr/bin/env node
/**
 * Repoints the stable Preview integration alias (`PREVIEW_STABLE_ALIAS`) at the
 * deployment the pipeline has just verified, as a transaction (AB#136 / AB#144).
 *
 *   npm run repoint:preview -- https://<deployment>.vercel.app dpl_<id> <deployed-commit-sha>
 *
 * Runs after "Verify access protection and noindex" in the DeployPreview job,
 * so it only ever points the alias at a deployment that already passed the same
 * checks on its generated URL. It then re-verifies those two properties on the
 * alias host itself and, on failure, restores the alias's previous target.
 *
 * The third argument is `$(Build.SourceVersion)` — the commit this deployment
 * was built from. Immediately before the alias is assigned, the current `main`
 * tip is resolved live (`git ls-remote`) and compared with it; a deployment
 * whose commit `main` has moved past is left unpublished (AB#144). Resolving
 * the tip needs `git` and an `origin` remote in the checkout; the reference
 * repo is public so no credential is required (a private-repo clone must set
 * `checkout: self` with `persistCredentials: true`, or this step fails closed).
 *
 * Secrets: the Vercel token reaches Vercel only in the `Authorization` header;
 * the automation bypass secret is read from `VERCEL_AUTOMATION_BYPASS_SECRET`
 * and sent only as a request header on the alias probe, never in a URL or log.
 * The decision logic lives in `preview-alias.mts` and has tests; this file
 * reads settings, builds the real probe and the git resolver, prints, and sets
 * an exit code.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  createAliasProbe,
  repointAndVerifyPreviewAlias,
  type RepointOutcome,
} from "./preview-alias.mts";
import { parsePreviewAliasHost, type PreviewCheck } from "./preview-verification.mts";
import { readVercelPreviewApiSettings } from "./vercel-preview-api.mts";

const execFileAsync = promisify(execFile);

/**
 * The live `main` tip. `--exit-code` makes `ls-remote` exit non-zero when the
 * ref is absent, so a missing ref, a network failure, or a timeout all reject
 * — which the orchestrator turns into a fail-closed refusal rather than a
 * repoint on `createdAt` ordering alone.
 */
async function resolveCurrentMainRevision(): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-remote", "--exit-code", "origin", "refs/heads/main"],
    { timeout: 20_000 },
  );
  const sha = stdout.trim().split(/\s+/, 1)[0] ?? "";
  if (!sha) {
    throw new Error(
      "git ls-remote returned no commit for refs/heads/main; cannot establish the current main revision",
    );
  }
  return sha;
}

const BYPASS_SECRET_SETTING = "VERCEL_AUTOMATION_BYPASS_SECRET";
const ALIAS_SETTING = "PREVIEW_STABLE_ALIAS";

function fail(message: string): never {
  console.error(`Preview alias repoint failed: ${message}`);
  process.exit(1);
}

function printChecks(checks: readonly PreviewCheck[]): void {
  for (const check of checks) {
    console.log(`  ${check.ok ? "ok" : "FAILED"}  ${check.name}: ${check.detail}`);
  }
}

async function main(): Promise<void> {
  const deploymentUrl = process.argv[2];
  const deploymentId = process.argv[3];
  const deployedRevision = process.argv[4];
  if (!deploymentUrl || !deploymentId || !deployedRevision) {
    fail(
      "deployment URL, immutable ID, and the deployed commit SHA are required. Usage: npm run repoint:preview -- https://<deployment>.vercel.app dpl_<id> <deployed-commit-sha>",
    );
  }

  let aliasHost: string;
  try {
    aliasHost = parsePreviewAliasHost(process.env[ALIAS_SETTING] ?? "");
  } catch (cause) {
    fail(cause instanceof Error ? cause.message : String(cause));
  }

  const bypassSecret = process.env[BYPASS_SECRET_SETTING]?.trim();
  if (!bypassSecret) {
    fail(
      `${BYPASS_SECRET_SETTING} is not set. It is needed to read the alias's noindex header the way a reviewer would.`,
    );
  }

  let outcome: RepointOutcome;
  try {
    const settings = readVercelPreviewApiSettings();
    outcome = await repointAndVerifyPreviewAlias({
      deploymentUrl,
      deploymentId,
      aliasHost,
      deployedRevision,
      settings,
      deps: {
        fetcher: fetch,
        probe: createAliasProbe(bypassSecret),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        resolveCurrentMainRevision,
      },
    });
  } catch (cause) {
    fail(cause instanceof Error ? cause.message : String(cause));
  }

  switch (outcome.kind) {
    case "already-current":
      console.log(`Stable Preview alias ${aliasHost}: ${outcome.detail}.`);
      return;
    case "assigned":
      console.log(
        `Stable Preview alias ${aliasHost} -> ${deploymentId} (was ${outcome.previousTarget ?? "unassigned"}).`,
      );
      printChecks(outcome.checks);
      console.log("Access protection and noindex verified on the alias host.");
      return;
    case "refused":
      fail(`${outcome.detail}. Nothing was changed. See docs/deployment.md.`);
      break;
    case "superseded":
      // Not a failure: this deployment's commit is no longer main's tip, so it
      // is not an eligible target for the durable alias. The alias is left
      // exactly as it was — this run did not update it.
      console.warn(
        `##vso[task.logissue type=warning]Stable Preview alias ${aliasHost} NOT updated by this run: ${outcome.detail} (AB#144).`,
      );
      console.log(
        `Stable Preview alias ${aliasHost} left unchanged: ${outcome.detail}. The alias is only advanced by a DeployPreview run whose commit is the current main tip; if none has succeeded yet, the alias stays on its last verified target.`,
      );
      return;
    case "abandoned":
      printChecks(outcome.checks);
      fail(
        `alias verification failed; the alias no longer points at this run's deployment (now: ${outcome.movedOnTo}), so it was left in place rather than restored.`,
      );
      break;
    case "restored":
      printChecks(outcome.checks);
      fail(
        `alias verification failed; restored to ${outcome.restoredTo ?? "unassigned (alias removed)"}. Confirm Standard Protection covers this alias.`,
      );
      break;
    case "unreconciled":
      printChecks(outcome.checks);
      fail(
        `${outcome.detail}. Run "npm run verify:preview-alias" and repoint the alias by hand — see docs/deployment.md.`,
      );
      break;
  }
}

await main();
