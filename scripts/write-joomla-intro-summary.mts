/**
 * AB#172: `npm run fix:joomla-intro -- --out <dir> [--approved-digest <hash> --yes]`.
 *
 * Moves each imported story's Joomla intro text from the first body paragraph
 * into a listing-only `summary` (`joomla-intro-summary.mts` decides which
 * pages and how). This file performs the reads and the write.
 *
 * 1. **Without `--yes`**: a tokenless, published-perspective read of every
 *    article and gallery — nothing a visitor could not already see — and a
 *    plan written under `--out`. The console prints counts and the digest to
 *    approve. No credential is read and nothing is written to Sanity.
 * 2. **With `--approved-digest <hash> --yes`** and `SANITY_MIGRATION_TOKEN`:
 *    - a fresh raw-perspective read. The plan is recomputed from it and must
 *      have exactly the approved digest; any edit or revision change since the
 *      review refuses the run;
 *    - any draft or release version of a planned page refuses the run;
 *    - the approved plan is saved as the recovery record before anything is
 *      sent, and is never overwritten;
 *    - the version check is repeated immediately before the write, and every
 *      patch goes in **one** transaction, each guarded by the approved
 *      revision;
 *    - whatever the write's outcome, the pages are read back and each is
 *      reported as applied, still pending, or unexpected. A rerun after an
 *      uncertain outcome reconciles against the saved record first.
 *
 * No transaction can promise that nobody creates a draft between the last
 * check and the write, so the runbook (docs/sanity-seeding.md) asks for a
 * short editing freeze while this runs, and the post-write check reports any
 * draft that appeared.
 */

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalJson,
  findVersionConflicts,
  INTRO_SUMMARY_DOCUMENT_TYPES,
  planIntroSummaries,
  recomputeIntroSummaryDigest,
  reconcileIntroSummaries,
  type IntroSummaryPlan,
  type IntroSummaryReconciliation,
  type IntroSummarySourceDocument,
} from "./joomla-intro-summary.mts";
import { parsePublicReadTarget, runPublicReadQuery } from "./sanity-read-http.mts";
import {
  parseSeedConnection,
  runSeedMutationBatches,
  runSeedQuery,
  type SeedConnection,
} from "./sanity-seed-http.mts";

class IntroSummaryWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntroSummaryWriteError";
  }
}

function fail(message: string): never {
  throw new IntroSummaryWriteError(message);
}

export type Options = {
  readonly out: string;
  readonly approvedDigest?: string;
  readonly apply: boolean;
  readonly project?: string;
  readonly dataset?: string;
  readonly apiVersion?: string;
};

const KNOWN_OPTIONS = new Set(["out", "approved-digest", "project", "dataset", "api-version"]);

const DOCUMENTS_QUERY = `*[_type in $types]{_id, _rev, _type, contentId, language, summary, summaryListingOnly, body}`;
const IDS_QUERY = `*[_type in $types]._id`;

export function parseArguments(argv: readonly string[]): Options {
  const values = new Map<string, string>();
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (argument === "--yes") {
      apply = true;
      continue;
    }
    if (!argument.startsWith("--")) {
      fail(`unexpected argument "${argument}" — every option is spelled --<name> <value>`);
    }
    const name = argument.slice(2);
    if (!KNOWN_OPTIONS.has(name)) {
      fail(`unknown option "${argument}" — known options are ${[...KNOWN_OPTIONS].map((known) => `--${known}`).join(", ")}, --yes`);
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) fail(`${argument} needs a value`);
    values.set(name, next);
    index += 1;
  }
  const out = values.get("out") ?? fail("--out <report folder> is required");
  const approvedDigest = values.get("approved-digest");
  if (approvedDigest !== undefined && !/^[0-9a-f]{64}$/u.test(approvedDigest)) {
    fail("--approved-digest must be the 64-character SHA-256 digest the plan run printed");
  }
  if (apply && approvedDigest === undefined) {
    fail("--yes needs --approved-digest <sha256> — the digest of the plan you reviewed");
  }
  return {
    out,
    apply,
    ...(approvedDigest === undefined ? {} : { approvedDigest }),
    ...(values.get("project") === undefined ? {} : { project: values.get("project") as string }),
    ...(values.get("dataset") === undefined ? {} : { dataset: values.get("dataset") as string }),
    ...(values.get("api-version") === undefined ? {} : { apiVersion: values.get("api-version") as string }),
  };
}

function requiredSetting(value: string | undefined, envName: string, flag: string): string {
  const resolved = value ?? process.env[envName];
  if (resolved === undefined || resolved.trim().length === 0) fail(`${envName} is required (or pass --${flag})`);
  return resolved;
}

function requiredToken(envName: string): string {
  if (process.env[`NEXT_PUBLIC_${envName}`]?.trim()) {
    fail(`NEXT_PUBLIC_${envName} is set: a NEXT_PUBLIC_ value is compiled into the browser bundle, so this write credential must never use that name. Remove it and set ${envName} instead.`);
  }
  const value = process.env[envName];
  if (value === undefined || value.trim().length === 0) fail(`${envName} is required (this tool never accepts a token as a flag)`);
  return value;
}

async function ensureOutDir(outDir: string): Promise<void> {
  await mkdir(outDir, { recursive: true, mode: 0o700 });
  await chmod(outDir, 0o700);
}

async function writeReport(outDir: string, fileName: string, data: unknown): Promise<string> {
  await ensureOutDir(outDir);
  const filePath = path.join(outDir, fileName);
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(filePath, 0o600);
  return filePath;
}

const recoveryFileName = (digest: string) => `intro-summary-approved-${digest}.json`;

async function readRecoveryRecord(outDir: string, digest: string): Promise<IntroSummaryPlan | undefined> {
  let text: string;
  try {
    text = await readFile(path.join(outDir, recoveryFileName(digest)), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const plan = JSON.parse(text) as IntroSummaryPlan;
  if (plan.digest !== digest || recomputeIntroSummaryDigest(plan) !== digest) {
    fail(`${recoveryFileName(digest)} does not match its own digest — it was edited; restore it before continuing`);
  }
  return plan;
}

/** Saves the approved plan once. An existing record must be byte-for-byte the same plan. */
async function persistRecoveryRecord(outDir: string, plan: IntroSummaryPlan): Promise<string> {
  await ensureOutDir(outDir);
  const filePath = path.join(outDir, recoveryFileName(plan.digest));
  const text = `${JSON.stringify(plan, null, 2)}\n`;
  try {
    await writeFile(filePath, text, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = JSON.parse(await readFile(filePath, "utf8")) as IntroSummaryPlan;
    if (canonicalJson(existing) !== canonicalJson(plan)) {
      fail(`${filePath} already exists with different content; it is never overwritten`);
    }
  }
  return filePath;
}

async function readRaw(connection: SeedConnection): Promise<readonly IntroSummarySourceDocument[]> {
  const rows = await runSeedQuery(connection, {
    query: DOCUMENTS_QUERY,
    params: { types: [...INTRO_SUMMARY_DOCUMENT_TYPES] },
    perspective: "raw",
  });
  if (!Array.isArray(rows)) fail("The raw read returned an unexpected shape");
  return rows as IntroSummarySourceDocument[];
}

async function readRawIds(connection: SeedConnection): Promise<readonly string[]> {
  const ids = await runSeedQuery(connection, {
    query: IDS_QUERY,
    params: { types: [...INTRO_SUMMARY_DOCUMENT_TYPES] },
    perspective: "raw",
  });
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) fail("The id read returned an unexpected shape");
  return ids as string[];
}

function printReconciliation(result: IntroSummaryReconciliation): void {
  console.log(
    `Applied: ${result.applied.length}. Still pending: ${result.pending.length}. Unexpected: ${result.unexpected.length}.`,
  );
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArguments(argv);
  const projectId = requiredSetting(options.project, "SANITY_PROJECT_ID", "project");
  const dataset = requiredSetting(options.dataset, "SANITY_DATASET", "dataset");
  const apiVersion = requiredSetting(options.apiVersion, "SANITY_API_VERSION", "api-version");
  const target = { projectId, dataset };

  if (!options.apply) {
    const publicTarget = parsePublicReadTarget({ projectId, dataset, apiVersion });
    const rows = await runPublicReadQuery(publicTarget, {
      query: DOCUMENTS_QUERY,
      params: { types: [...INTRO_SUMMARY_DOCUMENT_TYPES] },
    });
    if (!Array.isArray(rows)) fail("The published read returned an unexpected shape");
    const plan = planIntroSummaries(rows as IntroSummarySourceDocument[], target);
    const planPath = await writeReport(options.out, "intro-summary-plan.json", plan);
    console.log(`Planned ${plan.changes.length} page(s); excluded ${plan.excluded.length}. Plan: ${planPath}`);
    console.log(`Digest to approve: ${plan.digest}`);
    if (options.approvedDigest !== undefined) {
      console.log(options.approvedDigest === plan.digest
        ? "The approved digest matches the current published content."
        : "The approved digest does NOT match the current published content — review the new plan.");
    }
    console.log("Dry run only — no credential was read and nothing was written. Re-run with --approved-digest <hash> --yes to write.");
    return;
  }

  const approvedDigest = options.approvedDigest as string;
  const connection = parseSeedConnection({ projectId, dataset, apiVersion, token: requiredToken("SANITY_MIGRATION_TOKEN") });

  const record = await readRecoveryRecord(options.out, approvedDigest);
  if (record !== undefined) {
    const earlier = reconcileIntroSummaries(record, await readRaw(connection));
    if (earlier.unexpected.length > 0) {
      const reportPath = await writeReport(options.out, "intro-summary-reconciliation.json", earlier);
      printReconciliation(earlier);
      fail(`An earlier run's pages are in an unexpected state; nothing was written. See ${reportPath}.`);
    }
    if (earlier.pending.length === 0) {
      printReconciliation(earlier);
      console.log("Nothing left to do — an earlier run already applied this plan.");
      return;
    }
    if (earlier.applied.length > 0) {
      fail("An earlier run applied only part of this plan, which one transaction cannot produce; inspect the dataset before continuing.");
    }
  }

  const plan = planIntroSummaries(await readRaw(connection), target);
  if (plan.digest !== approvedDigest) {
    const planPath = await writeReport(options.out, "intro-summary-plan.json", plan);
    fail(`The current content no longer matches the approved plan (digest ${plan.digest}); nothing was written. Review ${planPath}.`);
  }
  if (plan.changes.length === 0) {
    console.log("Nothing to do — no page has an intro paragraph to move.");
    return;
  }
  const conflicts = findVersionConflicts(plan, await readRawIds(connection));
  if (conflicts.length > 0) {
    const reportPath = await writeReport(options.out, "intro-summary-version-conflicts.json", conflicts);
    fail(`${conflicts.length} planned page(s) have a draft or release version; publish or discard them first. Nothing was written. See ${reportPath}.`);
  }

  const recoveryPath = await persistRecoveryRecord(options.out, plan);
  console.log(`Recovery record: ${recoveryPath}`);

  const lateConflicts = findVersionConflicts(plan, await readRawIds(connection));
  if (lateConflicts.length > 0) {
    fail(`${lateConflicts.length} planned page(s) gained a draft or release version just now; nothing was written.`);
  }

  let writeError: unknown;
  try {
    await runSeedMutationBatches(connection, plan.mutations, { batchSize: plan.mutations.length });
  } catch (error) {
    writeError = error;
  }

  const result = reconcileIntroSummaries(plan, await readRaw(connection));
  const afterConflicts = findVersionConflicts(plan, await readRawIds(connection));
  const reportPath = await writeReport(options.out, "intro-summary-reconciliation.json", {
    ...result,
    versionsAfterWrite: afterConflicts,
    ...(writeError === undefined ? {} : { writeError: writeError instanceof Error ? writeError.message : String(writeError) }),
  });
  printReconciliation(result);
  if (afterConflicts.length > 0) {
    console.error(`${afterConflicts.length} planned page(s) now have a draft or release version — publishing it would restore the old body. See ${reportPath}.`);
    process.exitCode = 1;
  }
  if (result.applied.length === plan.changes.length) {
    console.log(`All ${plan.changes.length} page(s) written and verified. Report: ${reportPath}`);
    return;
  }
  console.error(
    writeError === undefined
      ? `The write reported success but not every page reads back as planned. See ${reportPath}.`
      : `The write failed (${writeError instanceof Error ? writeError.message : String(writeError)}). See ${reportPath}; re-run the same command to reconcile.`,
  );
  process.exitCode = 1;
}

if (import.meta.main || process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((cause: unknown) => {
    console.error(`Intro summary correction failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exitCode = 1;
  });
}
