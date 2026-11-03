/**
 * AB#391: the source half of the legacy re-upload plan. Pure: classifies already read
 * files and puts every location the owner has to review in one list. It decides nothing
 * about publication; a non-JPEG source has no rule yet, because ADR-0039 decision 8
 * speaks about JPEGs, and is listed rather than guessed.
 */
import { compressedImageDataSha256, importActionFor, inspectJpegImportFacts, type GpsPresence, type ImportAction, type JpegImportFacts } from "./image-import-metadata.mts";
import { JpegAuditError } from "./jpeg-export-audit.mts";

export type ReuploadRow =
  | Readonly<{ path: string; action: ImportAction; compressedDataSha256: string; facts: JpegImportFacts }>
  | Readonly<{ path: string; action: "non-jpeg-no-rule" }>
  | Readonly<{ path: string; action: "unreadable"; code: string }>;

export function classifySource(path: string, bytes: Uint8Array): ReuploadRow {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return { path, action: "non-jpeg-no-rule" };
  try {
    const facts = inspectJpegImportFacts(bytes);
    return { path, action: importActionFor(facts), compressedDataSha256: compressedImageDataSha256(bytes), facts };
  } catch (error) {
    if (error instanceof JpegAuditError) return { path, action: "unreadable", code: error.code };
    throw error;
  }
}

const gpsOf = (row: ReuploadRow): GpsPresence | null => "facts" in row ? row.facts.gps : null;

/** Unreadable sources are in the review list too: their location is simply unknown. */
export function buildReuploadPlan(rows: readonly ReuploadRow[]) {
  const sorted = [...rows].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const count = (test: (row: ReuploadRow) => boolean) => sorted.filter(test).length;
  return {
    schemaVersion: 1,
    summary: {
      total: sorted.length,
      keepCompressedData: count(row => row.action === "keep-compressed-data"),
      reEncode: count(row => row.action === "re-encode"),
      nonJpegNoRule: count(row => row.action === "non-jpeg-no-rule"),
      unreadable: count(row => row.action === "unreadable"),
      keywordMetadata: count(row => "facts" in row && row.facts.keywordMetadata),
      creatorPostalAddress: count(row => "facts" in row && row.facts.creatorPostalAddress),
    },
    gpsReview: sorted
      .filter(row => row.action === "unreadable" || gpsOf(row) === "present" || gpsOf(row) === "unreadable")
      .map(row => ({ path: row.path, gps: gpsOf(row) ?? "unreadable" as GpsPresence })),
    rows: sorted,
  };
}
