#!/usr/bin/env node
/**
 * AB#138's owner-run, read-only content audit tool. See
 * `docs/sanity-seeding.md`'s "Content audit" section for the full runbook —
 * this file is deliberately thin orchestration; the logic worth testing
 * lives in `sanity-audit.mts` (pure), the same split
 * `seed-sanity-content.mts`/`sanity-seed-fixtures.mts` already use.
 *
 *   npm run audit:sanity -- --project <id> --dataset <name> --api-version vYYYY-MM-DD
 *
 * Requires SANITY_AUDIT_TOKEN — a Viewer-role, read-only credential; never
 * this deployment's own SANITY_READ_TOKEN (which the running application
 * never uses to see drafts or releases at all — see `src/lib/sanity-client.ts`)
 * and never a seed script's write-scoped SANITY_SEED_TOKEN. Environment-only,
 * never a CLI flag, for the same reason `seed-sanity-content.mts` keeps its
 * own token out of `process.argv`: a process's argument list is visible to
 * every other process on the same machine (`ps`) and is commonly persisted
 * to shell history.
 *
 * Deliberately imports only `./sanity-read-http.mts` for its Sanity
 * transport — never the sibling write-capable module that additionally
 * exports mutate/upload functions this tool must never be able to reach.
 * Importing the mutate-incapable module is the actual guarantee; the
 * source-import check in `sanity-audit.test.mts` only pins that this file
 * keeps doing so.
 *
 * Never mutates, never deletes: this tool issues only the reads
 * `runContentAudit` builds, and exits non-zero on any classified failure
 * without partially printing a report it can no longer trust.
 */

import {
  parseReadConnection,
  type ReadConnection,
  runReadQuery,
  SanityReadConfigurationError,
} from "./sanity-read-http.mts";
import {
  AuditConfigurationError,
  AuditConsistencyError,
  AuditQueryError,
  formatContentAuditReport,
  resolveAuditSetting,
  runContentAudit,
} from "./sanity-audit.mts";

const ALLOWED_FLAGS = new Set(["project", "dataset", "api-version"]);

function fail(message: string): never {
  console.error(`Sanity audit failed: ${message}`);
  process.exit(1);
}

/** Rejects a repeated flag outright rather than silently using the first (or last) occurrence. */
function readFlag(name: string): string | undefined {
  const indices: number[] = [];
  process.argv.forEach((arg, index) => {
    if (arg === `--${name}`) indices.push(index);
  });
  if (indices.length > 1) fail(`--${name} was passed more than once`);
  if (indices.length === 0) return undefined;
  const value = process.argv[indices[0] + 1];
  if (value === undefined || value.startsWith("--")) fail(`--${name} requires a value`);
  return value;
}

function assertNoUnknownFlags(): void {
  for (const arg of process.argv.slice(2)) {
    if (!arg.startsWith("--")) continue;
    const name = arg.slice(2);
    if (!ALLOWED_FLAGS.has(name)) {
      fail(`Unknown flag --${name}. Allowed flags: ${[...ALLOWED_FLAGS].map((flag) => `--${flag}`).join(", ")}`);
    }
  }
}

function requiredEnvSetting(envName: string): string {
  const value = process.env[envName]?.trim();
  if (!value) fail(`missing ${envName}`);
  return value;
}

async function main(): Promise<void> {
  assertNoUnknownFlags();

  let connection: ReadConnection;
  try {
    const projectId = resolveAuditSetting({
      envName: "SANITY_PROJECT_ID",
      flagName: "project",
      flagValue: readFlag("project"),
      envValue: process.env.SANITY_PROJECT_ID,
    });
    const dataset = resolveAuditSetting({
      envName: "SANITY_DATASET",
      flagName: "dataset",
      flagValue: readFlag("dataset"),
      envValue: process.env.SANITY_DATASET,
    });
    const apiVersion = resolveAuditSetting({
      envName: "SANITY_API_VERSION",
      flagName: "api-version",
      flagValue: readFlag("api-version"),
      envValue: process.env.SANITY_API_VERSION,
    });
    const token = requiredEnvSetting("SANITY_AUDIT_TOKEN");

    connection = parseReadConnection({ projectId, dataset, apiVersion, token });
  } catch (cause) {
    if (cause instanceof AuditConfigurationError || cause instanceof SanityReadConfigurationError) {
      fail(cause.message);
    }
    throw cause;
  }

  console.log(
    `Auditing project "${connection.projectId}", dataset "${connection.dataset}" (API version ${connection.apiVersion})`,
  );
  console.log("Read-only: no write, mutate, or delete request will ever be issued by this tool.\n");

  try {
    const report = await runContentAudit((request) => runReadQuery(connection, request));
    console.log(formatContentAuditReport(report));
  } catch (cause) {
    if (cause instanceof AuditQueryError || cause instanceof AuditConsistencyError) {
      fail(cause.message);
    }
    throw cause;
  }
}

main().catch((cause) => {
  fail(cause instanceof Error ? cause.message : String(cause));
});
