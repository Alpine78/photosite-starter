/**
 * AB#391: the legacy re-upload plan, by published medium. Pure. A source reaches a medium only
 * through the `assetRequirements` of the approved import plans and their SHA-256, so a file
 * that changed or a medium with no recorded source is reported, never guessed.
 */

import { createHash } from "node:crypto";

import type { GpsPresence, ImportAction } from "./image-import-metadata.mts";

export type AssetRequirementRow = Readonly<{ mediaId: string; sourceLocator: string; contentHash: string }>;
export type PublishedMedium = Readonly<{ _id: string; _rev: string; mediaId: string; assetRef: string | null }>;
export type ReuploadSource = Readonly<{
  path: string;
  sha256: string;
  bytes: number;
  action: ImportAction | "non-jpeg-no-rule" | "unreadable";
  gps: GpsPresence | null;
}>;

export type ReuploadPlanned = PublishedMedium & Readonly<{
  sourceLocator: string;
  contentHash: string;
  action: ImportAction;
  gps: GpsPresence;
  sourceBytes: number;
}>;

/** Why a medium is not in the plan. It keeps the asset it has. */
export type ReuploadSkipReason =
  | "no-recorded-source"
  | "conflicting-sources"
  | "source-missing"
  | "source-changed"
  | "not-a-jpeg"
  | "unreadable-jpeg"
  | "no-asset";

export type PublishedReuploadPlan = Readonly<{
  schemaVersion: 1;
  summary: Readonly<{ published: number; planned: number; keepCompressedData: number; reEncode: number; gpsReview: number; sourceBytes: number; skipped: Readonly<Record<string, number>> }>;
  /** Every planned medium whose source has, or may have, a location. The owner decides on each. */
  gpsReview: readonly Readonly<{ mediaId: string; sourceLocator: string; gps: GpsPresence }>[];
  planned: readonly ReuploadPlanned[];
  skipped: readonly Readonly<{ mediaId: string; reason: ReuploadSkipReason }>[];
}>;

/** One medium, one source. Plans can repeat a pair; two different files for one medium is a fault. */
export function indexAssetRequirements(rows: Iterable<AssetRequirementRow>): ReadonlyMap<string, AssetRequirementRow | "conflict"> {
  const index = new Map<string, AssetRequirementRow | "conflict">();
  for (const row of rows) {
    const known = index.get(row.mediaId);
    if (known === undefined) index.set(row.mediaId, row);
    else if (known !== "conflict" && known.contentHash.toLowerCase() !== row.contentHash.toLowerCase()) index.set(row.mediaId, "conflict");
  }
  return index;
}

export function buildPublishedReuploadPlan(
  published: readonly PublishedMedium[],
  requirements: ReadonlyMap<string, AssetRequirementRow | "conflict">,
  sources: ReadonlyMap<string, ReuploadSource>,
): PublishedReuploadPlan {
  const planned: ReuploadPlanned[] = [];
  const skipped: { mediaId: string; reason: ReuploadSkipReason }[] = [];
  for (const medium of [...published].sort((a, b) => (a.mediaId < b.mediaId ? -1 : a.mediaId > b.mediaId ? 1 : 0))) {
    const skip = (reason: ReuploadSkipReason) => skipped.push({ mediaId: medium.mediaId, reason });
    const requirement = requirements.get(medium.mediaId);
    if (requirement === undefined) { skip("no-recorded-source"); continue; }
    if (requirement === "conflict") { skip("conflicting-sources"); continue; }
    if (medium.assetRef === null) { skip("no-asset"); continue; }
    const source = sources.get(requirement.sourceLocator);
    if (source === undefined) { skip("source-missing"); continue; }
    if (source.sha256 !== requirement.contentHash.toLowerCase()) { skip("source-changed"); continue; }
    if (source.action === "non-jpeg-no-rule") { skip("not-a-jpeg"); continue; }
    if (source.action === "unreadable" || source.gps === null) { skip("unreadable-jpeg"); continue; }
    planned.push({ ...medium, sourceLocator: requirement.sourceLocator, contentHash: source.sha256, action: source.action, gps: source.gps, sourceBytes: source.bytes });
  }
  const gpsReview = planned.filter((row) => row.gps !== "absent").map((row) => ({ mediaId: row.mediaId, sourceLocator: row.sourceLocator, gps: row.gps }));
  const skippedCounts: Record<string, number> = {};
  for (const row of skipped) skippedCounts[row.reason] = (skippedCounts[row.reason] ?? 0) + 1;
  return {
    schemaVersion: 1,
    summary: {
      published: published.length,
      planned: planned.length,
      keepCompressedData: planned.filter((row) => row.action === "keep-compressed-data").length,
      reEncode: planned.filter((row) => row.action === "re-encode").length,
      gpsReview: gpsReview.length,
      sourceBytes: planned.reduce((total, row) => total + row.sourceBytes, 0),
      skipped: skippedCounts,
    },
    gpsReview,
    planned,
    skipped,
  };
}

/**
 * A plan is a file someone can edit or truncate. A row with no revision would serialize as an
 * unconditional patch, overwriting whatever changed since, so it stops the run before anything.
 */
export function assertReuploadPlan(plan: Readonly<{ schemaVersion?: unknown; planned?: unknown }>): void {
  if (plan.schemaVersion !== 1 || !Array.isArray(plan.planned)) throw new Error("PLAN_MALFORMED");
  const text = (value: unknown) => typeof value === "string" && value !== "";
  for (const row of plan.planned as readonly Record<string, unknown>[]) {
    const valid = text(row?._id) && text(row?._rev) && text(row?.mediaId) && text(row?.sourceLocator) && text(row?.contentHash) && (row?.assetRef === null || text(row?.assetRef));
    if (!valid) throw new Error("PLAN_MALFORMED");
  }
}

/** What an owner approves: which medium, at which revision, replacing which asset, from which bytes, which lose their location, and whether old assets go. */
export function reuploadApprovalDigest(planned: readonly ReuploadPlanned[], sensitive: ReadonlySet<string>, deleteReplaced = false): string {
  const rows = planned.map((row) => [row.mediaId, row._id, row._rev, row.assetRef, row.contentHash, sensitive.has(row.mediaId)]);
  return createHash("sha256").update(JSON.stringify({ rows, deleteReplaced })).digest("hex");
}

/** One `mediaId` per line, for the media the owner marks sensitive. A line naming no planned medium is a mistake. */
export function parseSensitiveList(text: string, planned: readonly ReuploadPlanned[]): ReadonlySet<string> {
  const known = new Set(planned.map((row) => row.mediaId));
  const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#"));
  const unknown = lines.filter((line) => !known.has(line));
  if (unknown.length > 0) throw new Error(`SENSITIVE_LIST_UNKNOWN_MEDIA:${unknown.length}`);
  return new Set(lines);
}
