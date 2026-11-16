/**
 * AB#69, owner-run: `npm run sync:keywords -- --out <new-private-dir> [--imports <fields.json>]
 * [--set-discoverable] [--approved-digest <hash> --yes]`.
 *
 * Re-derives every medium's keywords and closure from current data (ADR-0039 decisions 2 and 3)
 * with no upload and no change to any asset URL. Without `--yes` it reads and reports only. With it,
 * the digest of what would be written must equal `--approved-digest`.
 *
 * Every batch is one transaction that also advances `keywordTaxonomyState` under the revision just
 * read, the guard Studio's keyword publication takes, so a publication and a sync conflict rather than
 * interleave. Each document carries its own revision guard. A conflict stops the run; run it again,
 * and whatever was written is found unchanged and skipped. A full run with no `--imports` also
 * acknowledges the taxonomy version it processed, so a newer request is never cleared by an older run.
 *
 * `--imports` is a JSON object of `mediaId` → ExifTool `-G1` fields, read separately from local files.
 * The token is `SANITY_MIGRATION_TOKEN`, from the environment only.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  KEYWORD_RECORD_TYPE,
  KEYWORD_TAXONOMY_STATE_ID,
  KEYWORD_TERM_DECISIONS_ID,
  KeywordSyncError,
  planKeywordSync,
  summarizeKeywordSync,
  type KeywordSyncEntry,
  type KeywordSyncMedia,
  type KeywordSyncPlan,
  type KeywordSyncRecord,
  type KeywordSyncSummary,
} from "./keyword-sync-plan.mts";
import { parseSeedConnection, runSeedMutationBatches, runSeedQuery, type SeedConnection, type SeedMutation } from "./sanity-seed-http.mts";

const READ_PAGE_SIZE = 1000;
const MAX_READ_PAGES = 200;
/** Media per transaction. A medium writes at most three documents. */
export const KEYWORD_SYNC_BATCH_SIZE = 50;

/** The same fields as `KEYWORD_GRAPH_PROJECTION` in `sanity/schemas/keyword-rules.ts`; a test holds them together. */
export const KEYWORD_SYNC_VOCABULARY_QUERY = `*[_type == "keyword" && !(_id in path("drafts.**")) && !(_id in path("versions.**"))]{
  _id,
  keywordId,
  "categoryRef": category._ref,
  "parentRef": parent._ref,
  "titles": title[].value,
  aliases,
  status,
  visibility,
  "mergedIntoRef": mergedInto._ref
}`;

const MEDIA_PAGE_QUERY = `*[_type == "media" && !(_id in path("drafts.**")) && !(_id in path("versions.**"))] | order(_id asc) [$from...$to]{
  _id, _rev, mediaId, keywords, expandedKeywordIds, dynamicallyDiscoverable,
  "draft": *[_id == "drafts." + ^._id][0]{_id, _rev, keywords, expandedKeywordIds, dynamicallyDiscoverable}
}`;
/** Read once, because one lookup per medium would scan every version for each. */
const VERSIONS_QUERY = `*[_id in path("versions.**")]._id`;
const RECORD_PAGE_QUERY = `*[_type == "${KEYWORD_RECORD_TYPE}"] | order(_id asc) [$from...$to]{
  _id, _rev, importedKeywords, keywordOverrides, internalKeywords, reviewItems
}`;
const TERM_DECISIONS_QUERY = `*[_id == "${KEYWORD_TERM_DECISIONS_ID}"][0].decisions[]{key, "documentId": keyword._ref}`;
const STATE_QUERY = `*[_id == "${KEYWORD_TAXONOMY_STATE_ID}"][0]{_rev, taxonomyVersion, resyncedVersion, publicationSequence}`;

export type KeywordSyncState = Readonly<{ _rev: string; taxonomyVersion: number; resyncedVersion: number; publicationSequence: number }>;

export type KeywordSyncPort = Readonly<{
  query: (query: string, params: Readonly<Record<string, unknown>>) => Promise<unknown>;
  mutate: (mutations: readonly SeedMutation[]) => Promise<void>;
}>;

export function parseArguments(argv: readonly string[]) {
  const options: { out?: string; imports?: string; approvedDigest?: string; yes: boolean; setDiscoverable: boolean } = { yes: false, setDiscoverable: false };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--yes") options.yes = true;
    else if (name === "--set-discoverable") options.setDiscoverable = true;
    else if (name === "--out" || name === "--imports" || name === "--approved-digest") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new KeywordSyncError("ARGUMENTS_INVALID");
      if (name === "--out") options.out = value;
      else if (name === "--imports") options.imports = value;
      else options.approvedDigest = value;
    } else throw new KeywordSyncError("ARGUMENTS_INVALID");
  }
  if (options.out === undefined) throw new KeywordSyncError("ARGUMENTS_INVALID");
  if (options.yes && options.approvedDigest === undefined) throw new KeywordSyncError("APPROVED_DIGEST_REQUIRED");
  if (options.setDiscoverable && options.imports === undefined) throw new KeywordSyncError("ARGUMENTS_INVALID");
  return { ...options, out: options.out };
}

export function parseImports(text: string): ReadonlyMap<string, Readonly<Record<string, unknown>>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new KeywordSyncError("IMPORTS_MALFORMED");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new KeywordSyncError("IMPORTS_MALFORMED");
  const entries = Object.entries(parsed);
  for (const [, fields] of entries) {
    if (typeof fields !== "object" || fields === null || Array.isArray(fields)) throw new KeywordSyncError("IMPORTS_MALFORMED");
  }
  return new Map(entries as [string, Readonly<Record<string, unknown>>][]);
}

async function readPages<T>(port: KeywordSyncPort, query: string): Promise<readonly T[]> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_READ_PAGES; page += 1) {
    const from = page * READ_PAGE_SIZE;
    const result = await port.query(query, { from, to: from + READ_PAGE_SIZE });
    if (!Array.isArray(result)) throw new KeywordSyncError("READ_MALFORMED");
    rows.push(...(result as T[]));
    if (result.length < READ_PAGE_SIZE) return rows;
  }
  throw new KeywordSyncError("READ_TOO_LARGE");
}

/** Every decision affects every medium holding the term, so a damaged list stops the run rather than being half read. */
export function parseTermDecisions(result: unknown): ReadonlyMap<string, string> {
  if (result === null || result === undefined) return new Map();
  if (!Array.isArray(result)) throw new KeywordSyncError("TERM_DECISIONS_MALFORMED");
  return new Map(result.map((row: { key?: unknown; documentId?: unknown } | null) => {
    if (typeof row?.key !== "string" || typeof row.documentId !== "string") throw new KeywordSyncError("TERM_DECISIONS_MALFORMED");
    return [row.key, row.documentId] as const;
  }));
}

async function readState(port: KeywordSyncPort): Promise<KeywordSyncState> {
  const state = await port.query(STATE_QUERY, {}) as KeywordSyncState | null;
  if (state === null || typeof state._rev !== "string") throw new KeywordSyncError("TAXONOMY_STATE_MISSING");
  if (![state.taxonomyVersion, state.resyncedVersion, state.publicationSequence].every(Number.isSafeInteger)) throw new KeywordSyncError("TAXONOMY_STATE_MALFORMED");
  return state;
}

export type KeywordSyncResult = Readonly<{
  /** `not-settled`: everything planned was written, but a read afterwards found more, so the version stays unacknowledged. */
  outcome: "planned" | "written" | "conflict" | "taxonomy-changed" | "not-settled";
  digest: string;
  summary: KeywordSyncSummary;
  written: number;
  acknowledgedVersion?: number;
}>;

type RunOptions = Readonly<{
  imports?: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  setDiscoverable?: boolean;
  approvedDigest?: string;
  yes?: boolean;
  now: string;
}>;

export async function runKeywordSync(port: KeywordSyncPort, options: RunOptions): Promise<KeywordSyncResult & { readonly plan: KeywordSyncPlan }> {
  const initial = await readState(port);
  const readPlan = async () => {
    const [termDecisions, vocabulary, media, records, versions] = await Promise.all([
      port.query(TERM_DECISIONS_QUERY, {}),
      port.query(KEYWORD_SYNC_VOCABULARY_QUERY, {}),
      readPages<KeywordSyncMedia>(port, MEDIA_PAGE_QUERY),
      readPages<KeywordSyncRecord>(port, RECORD_PAGE_QUERY),
      port.query(VERSIONS_QUERY, {}),
    ]);
    if (!Array.isArray(vocabulary) || !Array.isArray(versions)) throw new KeywordSyncError("READ_MALFORMED");
    // `versions.<release>.<documentId>`.
    const versioned = new Set((versions as unknown[]).flatMap((id) => (typeof id === "string" ? [id.split(".").slice(2).join(".")] : [])));
    return planKeywordSync({
      vocabulary,
      media: media.map((medium) => ({ ...medium, hasVersion: versioned.has(medium._id) })),
      records,
      termDecisions: parseTermDecisions(termDecisions),
      now: options.now,
      ...(options.imports === undefined ? {} : { imports: options.imports }),
      ...(options.setDiscoverable === undefined ? {} : { setDiscoverable: options.setDiscoverable }),
    });
  };
  const plan = await readPlan();
  const summary = summarizeKeywordSync(plan);
  // Only a full run with nothing skipped has processed the version it read.
  const acknowledges = options.imports === undefined && summary.failed === 0 && initial.resyncedVersion < initial.taxonomyVersion;
  // Also the state, so an approval cannot authorize another version's acknowledgement, or a vocabulary published since.
  const digest = createHash("sha256").update(JSON.stringify({ mutations: plan.digest, taxonomyVersion: initial.taxonomyVersion, publicationSequence: initial.publicationSequence, acknowledges })).digest("hex");
  const base = { digest, summary, plan };
  if (options.yes !== true) return { ...base, outcome: "planned", written: 0 };
  if (options.approvedDigest !== digest) throw new KeywordSyncError("DIGEST_MISMATCH");

  // The plan rests on the vocabulary as read. A publication since moves this sequence even when it
  // leaves the version alone (a new keyword, an alias), and only this run's own batches may move it.
  let expectedSequence = initial.publicationSequence;
  const stateIfUnmoved = async () => {
    const state = await readState(port);
    return state.taxonomyVersion === initial.taxonomyVersion && state.publicationSequence === expectedSequence ? state : undefined;
  };

  const updates = plan.entries.filter((entry): entry is Extract<KeywordSyncEntry, { status: "update" }> => entry.status === "update");
  let written = 0;
  for (let start = 0; start < updates.length; start += KEYWORD_SYNC_BATCH_SIZE) {
    const state = await stateIfUnmoved();
    if (state === undefined) return { ...base, outcome: "taxonomy-changed", written };
    const batch = updates.slice(start, start + KEYWORD_SYNC_BATCH_SIZE);
    try {
      await port.mutate([
        { patch: { id: KEYWORD_TAXONOMY_STATE_ID, ifRevisionID: state._rev, set: { publicationSequence: state.publicationSequence + 1 } } },
        ...batch.flatMap((entry) => entry.mutations),
      ]);
    } catch (error) {
      if ((error as { status?: unknown }).status === 409) return { ...base, outcome: "conflict", written };
      throw error;
    }
    written += batch.length;
    expectedSequence += 1;
  }

  if (acknowledges) {
    // A draft or release version created during the run leaves every revision guard intact, and publishing
    // it would undo the sync. Only a fresh read finding nothing left to do may close the version.
    const after = summarizeKeywordSync(await readPlan());
    if (after.update > 0 || after.failed > 0) return { ...base, outcome: "not-settled", written };
    const state = await stateIfUnmoved();
    if (state === undefined) return { ...base, outcome: "taxonomy-changed", written };
    try {
      await port.mutate([{ patch: { id: KEYWORD_TAXONOMY_STATE_ID, ifRevisionID: state._rev, set: { resyncedVersion: initial.taxonomyVersion, publicationSequence: state.publicationSequence + 1 } } }]);
    } catch (error) {
      if ((error as { status?: unknown }).status === 409) return { ...base, outcome: "conflict", written };
      throw error;
    }
    return { ...base, outcome: "written", written, acknowledgedVersion: initial.taxonomyVersion };
  }
  return { ...base, outcome: "written", written };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") throw new KeywordSyncError(`${name}_REQUIRED`);
  return value;
}

function deploymentPort(connection: SeedConnection): KeywordSyncPort {
  return {
    query: (query, params) => runSeedQuery(connection, { query, params: { ...params }, perspective: "raw" }),
    mutate: async (mutations) => { await runSeedMutationBatches(connection, mutations, { batchSize: mutations.length }); },
  };
}

export async function main(argv: readonly string[]): Promise<KeywordSyncResult> {
  const options = parseArguments(argv);
  if (process.env.NEXT_PUBLIC_SANITY_MIGRATION_TOKEN?.trim()) throw new KeywordSyncError("PUBLIC_TOKEN_REFUSED");
  const connection = parseSeedConnection({
    projectId: requiredEnvironment("SANITY_PROJECT_ID"),
    dataset: requiredEnvironment("SANITY_DATASET"),
    apiVersion: requiredEnvironment("SANITY_API_VERSION"),
    token: requiredEnvironment("SANITY_MIGRATION_TOKEN"),
  });
  const imports = options.imports === undefined ? undefined : parseImports(await readFile(options.imports, "utf8"));
  const out = path.resolve(options.out);
  // Not recursive: an existing directory is refused rather than mixed with an older report.
  await mkdir(out, { mode: 0o700 });
  const { plan, ...result } = await runKeywordSync(deploymentPort(connection), {
    now: new Date().toISOString(),
    yes: options.yes,
    setDiscoverable: options.setDiscoverable,
    ...(imports === undefined ? {} : { imports }),
    ...(options.approvedDigest === undefined ? {} : { approvedDigest: options.approvedDigest }),
  });
  // Private: a review item can hold anything a photographer typed. The console carries counts only.
  await writeFile(path.join(out, "keyword-sync-report.json"), `${JSON.stringify({ ...result, entries: plan.entries, unmatchedImports: plan.unmatchedImports }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return result;
}

/** A run that skipped media is not finished, even though it reports what it did. */
export function keywordSyncExitCode(result: Pick<KeywordSyncResult, "outcome" | "summary">): number {
  if (result.outcome !== "planned" && result.outcome !== "written") return 3;
  return result.summary.failed > 0 ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (result) => { console.log(JSON.stringify(result)); process.exitCode = keywordSyncExitCode(result); },
    (error: Error) => { console.error(error.message); process.exitCode = 2; },
  );
}
