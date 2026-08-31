#!/usr/bin/env node
/**
 * Repoints the stable Preview integration alias (`PREVIEW_STABLE_ALIAS`) at the
 * deployment the pipeline has just verified, as a transaction (AB#136).
 *
 *   npm run repoint:preview -- https://<deployment>.vercel.app dpl_<id>
 *
 * Runs after "Verify access protection and noindex" in the DeployPreview job,
 * so it only ever points the alias at a deployment that already passed the same
 * checks on its generated URL. It then re-verifies those two properties on the
 * alias host itself and, on failure, restores the alias's previous target.
 *
 * Secrets: the Vercel token reaches Vercel only in the `Authorization` header;
 * the automation bypass secret is read from `VERCEL_AUTOMATION_BYPASS_SECRET`
 * and sent only as a request header on the alias probe, never in a URL or log.
 * The decision logic lives in `preview-alias.mts` and has tests; this file
 * reads settings, builds the real probe, prints, and sets an exit code.
 */
import {
  createAliasProbe,
  repointAndVerifyPreviewAlias,
  type RepointOutcome,
} from "./preview-alias.mts";
import { parsePreviewAliasHost, type PreviewCheck } from "./preview-verification.mts";
import { readVercelPreviewApiSettings } from "./vercel-preview-api.mts";

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
  if (!deploymentUrl || !deploymentId) {
    fail(
      "deployment URL and immutable ID are required. Usage: npm run repoint:preview -- https://<deployment>.vercel.app dpl_<id>",
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
      settings,
      deps: {
        fetcher: fetch,
        probe: createAliasProbe(bypassSecret),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
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
