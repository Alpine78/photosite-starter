/** Diagnose an approved intro write with GET only; pending never authorizes a resend. */
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readRecoveryRecord } from "./intro-summary-recovery.mts";
import {
  INTRO_SUMMARY_PLANNER_VERSION,
  INTRO_SUMMARY_DOCUMENT_TYPES,
  findVersionConflicts,
  isPublishedId,
  reconcileIntroSummaries,
  type IntroSummaryPlan,
  type IntroSummarySourceDocument,
} from "./joomla-intro-summary.mts";
import { parsePublicReadTarget, parseReadConnection, runReadQuery } from "./sanity-read-http.mts";

type Environment = Readonly<Record<string, string | undefined>>;
type Options = { out: string; digest: string; project?: string; dataset?: string; apiVersion?: string };
class ReconciliationError extends Error {}
function fail(message: string): never { throw new ReconciliationError(message); }
const flags = new Set(["out", "approved-digest", "project", "dataset", "api-version"]);

export function parseArguments(argv: readonly string[]): Options {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const argument = argv[i] ?? "";
    const key = argument.startsWith("--") ? argument.slice(2) : "";
    if (!flags.has(key)) fail("Unknown option; this command accepts no write flags or credentials.");
    if (values.has(key)) fail("Duplicate option.");
    const value = argv[i + 1];
    if (value === undefined || !value.trim() || value.startsWith("--")) fail("An option value is missing.");
    values.set(key, value);
  }
  const out = values.get("out") ?? fail("--out is required: the existing approved recovery directory.");
  const digest = values.get("approved-digest") ?? fail("--approved-digest is required.");
  if (!/^[0-9a-f]{64}$/.test(digest)) fail("The approved digest must be 64 lowercase hexadecimal characters.");
  return { out, digest, project: values.get("project"), dataset: values.get("dataset"), apiVersion: values.get("api-version") };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function assertPlan(plan: IntroSummaryPlan): void {
  if (plan.version !== INTRO_SUMMARY_PLANNER_VERSION || !record(plan.target) ||
      typeof plan.target.projectId !== "string" || typeof plan.target.dataset !== "string" ||
      !Array.isArray(plan.changes) || plan.changes.length === 0) fail("Unsupported or empty recovery record.");
  const ids = new Set<string>();
  for (const change of plan.changes) {
    if (!record(change) || typeof change.documentId !== "string" || !change.documentId ||
        !isPublishedId(change.documentId) || ids.has(change.documentId) ||
        typeof change.rev !== "string" || !change.rev ||
        typeof change.summary !== "string" || !change.summary.trim() ||
        !Array.isArray(change.originalBody)) fail("Malformed recovery change.");
    ids.add(change.documentId);
  }
}
function assertRows(value: unknown): readonly IntroSummarySourceDocument[] {
  if (!Array.isArray(value)) fail("The raw read returned an invalid document list.");
  const ids = new Set<string>();
  for (const row of value) {
    if (!record(row) || typeof row._id !== "string" || !row._id || ids.has(row._id) ||
        typeof row._rev !== "string" || !row._rev ||
        !(INTRO_SUMMARY_DOCUMENT_TYPES as readonly unknown[]).includes(row._type)) {
      fail("The raw read returned an invalid document list.");
    }
    ids.add(row._id);
  }
  return value as readonly IntroSummarySourceDocument[];
}
function required(value: string | undefined, message: string): string { return value ?? fail(message); }

/** Never enumerates the environment or reads seed/migration credentials. */
export async function main(argv: readonly string[] = process.argv.slice(2), environment: Environment = process.env): Promise<number> {
  try {
    // Closed argument validation precedes all filesystem, configuration and provider IO.
    const options = parseArguments(argv);
    const plan = await readRecoveryRecord(options.out, options.digest) ?? fail("The approved recovery record is missing.");
    assertPlan(plan);
    const target = parsePublicReadTarget({
      projectId: required(options.project ?? environment.SANITY_PROJECT_ID, "SANITY_PROJECT_ID is required."),
      dataset: required(options.dataset ?? environment.SANITY_DATASET, "SANITY_DATASET is required."),
      apiVersion: required(options.apiVersion ?? environment.SANITY_API_VERSION, "SANITY_API_VERSION is required."),
    });
    if (target.projectId !== plan.target.projectId || target.dataset !== plan.target.dataset) fail("The read target does not match the approved recovery record.");
    if (environment.NEXT_PUBLIC_SANITY_AUDIT_TOKEN?.trim()) fail("A public audit credential is forbidden.");
    const connection = parseReadConnection({ ...target, token: required(environment.SANITY_AUDIT_TOKEN, "SANITY_AUDIT_TOKEN is required (Viewer read access).") });
    const readStartedAt = new Date().toISOString();
    const rows = assertRows(await runReadQuery(connection, {
      query: '*[_type in $types]{_id, _rev, _type, contentId, language, summary, summaryListingOnly, body}',
      params: { types: [...INTRO_SUMMARY_DOCUMENT_TYPES] },
      perspective: "raw",
    }));
    const result = reconcileIntroSummaries(plan, rows);
    const versions = findVersionConflicts(plan, rows.map(row => row._id));
    const complete = result.applied.length === plan.changes.length && versions.length === 0;
    const report = {
      readOnly: true, providerWritesAttemptedByThisTool: false,
      readStartedAt, readCompletedAt: new Date().toISOString(), perspective: "raw",
      plannerVersion: plan.version, digest: plan.digest, target,
      status: complete ? "all-applied" : "diagnosis-needs-attention",
      ...result, versions,
    };
    // Exclusive per-run output never follows a pre-existing report symlink or replaces evidence.
    const reportPath = path.join(options.out, `intro-summary-readonly-${options.digest.slice(0, 12)}-${randomUUID()}.json`);
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    console.log(`Read-only diagnosis: applied ${result.applied.length}; pending ${result.pending.length}; unexpected ${result.unexpected.length}; versions ${versions.length}.`);
    console.log(`Report: ${path.basename(reportPath)}`);
    console.log("No provider writes attempted. Pending is not retry authorization; an earlier request may still commit later.");
    return complete ? 0 : 2;
  } catch (cause) {
    // No arbitrary local/provider error, record content or credential enters operator output.
    console.error(cause instanceof ReconciliationError ? cause.message : "Read-only intro reconciliation failed; no provider writes attempted.");
    return 1;
  }
}

if (import.meta.main || process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
