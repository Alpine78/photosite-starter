#!/usr/bin/env node
/**
 * Read-only check of the stable Preview integration alias (AB#136).
 *
 *   PREVIEW_STABLE_ALIAS=<host>.vercel.app \
 *   VERCEL_AUTOMATION_BYPASS_SECRET=... VERCEL_TOKEN=... VERCEL_ORG_ID=... \
 *   VERCEL_PROJECT_ID=... npm run verify:preview-alias
 *
 * Confirms the alias resolves to a deployment in the expected project and team,
 * then that the alias host is access-protected and non-indexable — the same two
 * properties `verify:preview` checks on a generated URL. It never assigns or
 * removes the alias, so it is safe to run by hand after a rollback, a rotation,
 * or during owner handoff.
 */
import { createAliasProbe } from "./preview-alias.mts";
import {
  parsePreviewAliasHost,
  verifyPreviewDeployment,
} from "./preview-verification.mts";
import {
  readAliasCurrentTarget,
  readVercelPreviewApiSettings,
} from "./vercel-preview-api.mts";

const BYPASS_SECRET_SETTING = "VERCEL_AUTOMATION_BYPASS_SECRET";
const ALIAS_SETTING = "PREVIEW_STABLE_ALIAS";

function fail(message: string): never {
  console.error(`Preview alias verification failed: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  let aliasHost: string;
  try {
    aliasHost = parsePreviewAliasHost(process.env[ALIAS_SETTING] ?? "");
  } catch (cause) {
    fail(cause instanceof Error ? cause.message : String(cause));
  }

  const bypassSecret = process.env[BYPASS_SECRET_SETTING]?.trim();
  if (!bypassSecret) {
    fail(`${BYPASS_SECRET_SETTING} is not set.`);
  }

  let target: Awaited<ReturnType<typeof readAliasCurrentTarget>>;
  try {
    const settings = readVercelPreviewApiSettings();
    target = await readAliasCurrentTarget(aliasHost, settings);
  } catch (cause) {
    fail(cause instanceof Error ? cause.message : String(cause));
  }

  if (!target) {
    fail(
      `${aliasHost} is not assigned to a deployment in this project. Run the pipeline (or npm run repoint:preview) to assign it.`,
    );
  }

  if (target.isProductionTarget) {
    fail(
      `${aliasHost} resolves to a production deployment (${target.deploymentId}). PREVIEW_STABLE_ALIAS must be a dedicated non-production *.vercel.app host — see docs/deployment.md.`,
    );
  }

  let probes;
  try {
    probes = await createAliasProbe(bypassSecret)(new URL(`https://${aliasHost}/`));
  } catch (cause) {
    fail(
      `the alias host could not be reached: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const verification = verifyPreviewDeployment(probes);
  console.log(`Stable Preview alias: ${aliasHost} -> ${target.deploymentId}`);
  for (const check of verification.checks) {
    console.log(`  ${check.ok ? "ok" : "FAILED"}  ${check.name}: ${check.detail}`);
  }

  if (!verification.ok) {
    fail("the alias is not access-protected and non-indexable. See the checks above.");
  }

  console.log("Access protection and noindex both verified on the alias host.");
}

await main();
