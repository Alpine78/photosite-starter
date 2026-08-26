import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { defineMediaType } from "../sanity/schemas/media.ts";
import type { ReadQueryRequest } from "./sanity-read-http.mts";
import {
  AuditConfigurationError,
  AuditConsistencyError,
  AuditQueryError,
  AUDIT_PAGE_SIZE,
  type AuditRawRow,
  buildAuditPageQuery,
  buildAuditSnapshotCountQuery,
  classifySanityDocumentId,
  formatContentAuditReport,
  resolveAuditSetting,
  runContentAudit,
  SENSITIVE_MEDIA_METADATA_FIELDS,
} from "./sanity-audit.mts";

// ---------------------------------------------------------------------------
// resolveAuditSetting — fail-closed configuration resolution
// ---------------------------------------------------------------------------

describe("resolveAuditSetting", () => {
  const base = { envName: "SANITY_PROJECT_ID", flagName: "project" } as const;

  it("returns the flag value when only the flag is present", () => {
    expect(resolveAuditSetting({ ...base, flagValue: "abc123", envValue: undefined })).toBe("abc123");
  });

  it("returns the env value when only the env var is present", () => {
    expect(resolveAuditSetting({ ...base, flagValue: undefined, envValue: "abc123" })).toBe("abc123");
  });

  it("returns the shared value when flag and env agree", () => {
    expect(resolveAuditSetting({ ...base, flagValue: "abc123", envValue: "abc123" })).toBe("abc123");
  });

  it("trims before comparing, so incidental whitespace is not a disagreement", () => {
    expect(resolveAuditSetting({ ...base, flagValue: "abc123", envValue: "  abc123  " })).toBe("abc123");
  });

  it("throws when both are missing", () => {
    expect(() => resolveAuditSetting({ ...base, flagValue: undefined, envValue: undefined })).toThrow(
      AuditConfigurationError,
    );
  });

  it("treats a whitespace-only value as missing", () => {
    expect(() => resolveAuditSetting({ ...base, flagValue: "   ", envValue: undefined })).toThrow(
      AuditConfigurationError,
    );
  });

  it("throws as ambiguous when flag and env disagree", () => {
    expect(() => resolveAuditSetting({ ...base, flagValue: "abc123", envValue: "xyz789" })).toThrow(
      AuditConfigurationError,
    );
  });
});

// ---------------------------------------------------------------------------
// classifySanityDocumentId
// ---------------------------------------------------------------------------

describe("classifySanityDocumentId", () => {
  it("classifies an ordinary root-level id as published", () => {
    expect(classifySanityDocumentId("seed--media--coastal-landscape")).toEqual({
      kind: "published",
      publishedId: "seed--media--coastal-landscape",
    });
  });

  it("classifies a drafts.-prefixed id as a draft, stripping the prefix", () => {
    expect(classifySanityDocumentId("drafts.abc123")).toEqual({
      kind: "draft",
      publishedId: "abc123",
    });
  });

  it("classifies a versions.<release>.<id> id as a release version, splitting the release id", () => {
    expect(classifySanityDocumentId("versions.summer-launch.abc123")).toEqual({
      kind: "release-version",
      releaseId: "summer-launch",
      publishedId: "abc123",
    });
  });

  it("handles a malformed versions. id with no further dot by treating the whole remainder as both ids", () => {
    expect(classifySanityDocumentId("versions.onlyonesegment")).toEqual({
      kind: "release-version",
      releaseId: "onlyonesegment",
      publishedId: "onlyonesegment",
    });
  });
});

// ---------------------------------------------------------------------------
// Query builders — pure, no network
// ---------------------------------------------------------------------------

describe("buildAuditSnapshotCountQuery", () => {
  it("asks for a raw, unfiltered document count", () => {
    const request = buildAuditSnapshotCountQuery();
    expect(request.query).toBe("count(*[])");
    expect(request.perspective).toBe("raw");
  });
});

describe("buildAuditPageQuery", () => {
  it("asks for the first page with no lower bound and only a $limit parameter", () => {
    const request = buildAuditPageQuery(undefined, 200);
    expect(request.query).toContain("*[]");
    expect(request.query).not.toContain("_id > $after");
    expect(request.params).toEqual({ limit: 200 });
    expect(request.perspective).toBe("raw");
  });

  it("asks for a subsequent page bounded by the given cursor", () => {
    const request = buildAuditPageQuery("some-id", 200);
    expect(request.query).toContain("_id > $after");
    expect(request.params).toEqual({ after: "some-id", limit: 200 });
    expect(request.perspective).toBe("raw");
  });

  it("projects only presence/dimension fields, never a sensitive field's value", () => {
    const request = buildAuditPageQuery(undefined, 10);
    expect(request.query).toContain("defined(archiveLocator)");
    expect(request.query).toContain("defined(capturedAt)");
    expect(request.query).toContain("defined(originalFilename)");
    expect(request.query).not.toMatch(/^\s*archiveLocator\s*,/m);
    expect(request.query).not.toMatch(/^\s*capturedAt\s*,/m);
    expect(request.query).not.toMatch(/^\s*originalFilename\s*,/m);
  });
});

// ---------------------------------------------------------------------------
// runContentAudit — the paginated scan and its consistency checks
// ---------------------------------------------------------------------------

function row(overrides: Partial<AuditRawRow> & { readonly _id: string; readonly _type: string }): AuditRawRow {
  return {
    hasOriginalFilename: false,
    width: null,
    height: null,
    hasArchiveLocator: false,
    hasCapturedAt: false,
    ...overrides,
  };
}

/** A fake `RunQuery` driven by a fixed total and an in-order document list, so tests can assert on the exact pagination behavior against known data. */
function fakeRunQuery(
  total: number,
  documents: readonly AuditRawRow[],
): (request: ReadQueryRequest) => Promise<unknown> {
  // Sorted ascending by `_id`, matching what a real `order(_id)` query
  // guarantees — the fake's cursor lookup below assumes this order, and a
  // caller should not have to hand-order its fixture ids correctly itself.
  const sorted = [...documents].sort((left, right) => (left._id < right._id ? -1 : left._id > right._id ? 1 : 0));
  return async (request: ReadQueryRequest) => {
    if (request.query === "count(*[])") return total;
    const after = (request.params as { readonly after?: string } | undefined)?.after;
    const limit = (request.params as { readonly limit: number }).limit;
    const startIndex = after === undefined ? 0 : sorted.findIndex((doc) => doc._id === after) + 1;
    return sorted.slice(startIndex, startIndex + limit);
  };
}

describe("runContentAudit", () => {
  it("returns a full inventory of every document, classified by identity kind", async () => {
    const documents = [
      row({ _id: "a1", _type: "media", hasArchiveLocator: true }),
      row({ _id: "a2", _type: "category" }),
      row({ _id: "drafts.a3", _type: "article" }),
      row({ _id: "versions.launch.a4", _type: "gallery" }),
      row({ _id: "b1", _type: "sanity.imageAsset", width: 800, height: 600 }),
      row({ _id: "b2", _type: "sanity.fileAsset" }),
      row({ _id: "c1", _type: "system.release" }),
    ];
    const report = await runContentAudit(fakeRunQuery(documents.length, documents), { pageSize: 200 });

    expect(report.totalDocuments).toBe(7);
    expect(report.documents).toHaveLength(7);
    expect(report.documents.filter((entry) => entry.kind === "published")).toHaveLength(5);
    expect(report.documents.filter((entry) => entry.kind === "draft")).toHaveLength(1);
    expect(report.documents).toContainEqual({ id: "drafts.a3", type: "article", kind: "draft" });
    expect(report.documents).toContainEqual({
      id: "versions.launch.a4",
      type: "gallery",
      kind: "release-version",
      releaseId: "launch",
    });
    expect(report.assets).toHaveLength(2);
    expect(report.assets).toContainEqual({
      id: "b1",
      type: "sanity.imageAsset",
      width: 800,
      height: 600,
      hasOriginalFilename: false,
    });
    expect(report.mediaMetadata).toEqual([{ id: "a1", hasArchiveLocator: true, hasCapturedAt: false }]);
    expect(report.documentTypeCounts.get("media")).toBe(1);
    expect(report.documentTypeCounts.get("system.release")).toBe(1);
    expect(report.pageCount).toBe(1);
  });

  it("does not flag a file asset for missing dimensions, but does flag an image asset", async () => {
    const documents = [
      row({ _id: "img1", _type: "sanity.imageAsset", width: null, height: null }),
      row({ _id: "file1", _type: "sanity.fileAsset", width: null, height: null }),
    ];
    const report = await runContentAudit(fakeRunQuery(documents.length, documents), { pageSize: 200 });
    const imageEntry = report.assets.find((entry) => entry.id === "img1");
    const fileEntry = report.assets.find((entry) => entry.id === "file1");
    expect(imageEntry?.width).toBeNull();
    expect(fileEntry?.type).toBe("sanity.fileAsset");
  });

  it("scopes hasOriginalFilename to actual asset types, not any document that happens to carry the field", async () => {
    const documents = [
      // An unrelated document type coincidentally carrying a field with the
      // same name must never be reported as an asset with a stored filename.
      row({ _id: "odd1", _type: "some.unexpected.type", hasOriginalFilename: true }),
      row({ _id: "img1", _type: "sanity.imageAsset", width: 10, height: 10, hasOriginalFilename: true }),
    ];
    const report = await runContentAudit(fakeRunQuery(documents.length, documents), { pageSize: 200 });
    expect(report.assets.map((entry) => entry.id)).toEqual(["img1"]);
    // The unexpected type is still visible — just not misreported as an asset.
    expect(report.documentTypeCounts.get("some.unexpected.type")).toBe(1);
  });

  it("scopes archiveLocator/capturedAt reporting to media documents, not any document that happens to carry those field names", async () => {
    const documents = [
      row({ _id: "odd1", _type: "some.unexpected.type", hasArchiveLocator: true }),
      row({ _id: "med1", _type: "media", hasCapturedAt: true }),
    ];
    const report = await runContentAudit(fakeRunQuery(documents.length, documents), { pageSize: 200 });
    expect(report.mediaMetadata).toEqual([{ id: "med1", hasArchiveLocator: false, hasCapturedAt: true }]);
  });

  it("handles an exact multiple of the page size without truncating or misreporting an infinite loop", async () => {
    const documents = Array.from({ length: 4 }, (_unused, index) =>
      row({ _id: `id-${String(index).padStart(2, "0")}`, _type: "media" }),
    );
    const report = await runContentAudit(fakeRunQuery(documents.length, documents), { pageSize: 2 });

    expect(report.totalDocuments).toBe(4);
    // Two full pages of 2, plus the confirming short (empty) page.
    expect(report.pageCount).toBe(3);
  });

  it("terminates in exactly one page for an empty dataset", async () => {
    const report = await runContentAudit(fakeRunQuery(0, []), { pageSize: 200 });
    expect(report.totalDocuments).toBe(0);
    expect(report.pageCount).toBe(1);
  });

  it("throws AuditConsistencyError when the collected count disagrees with the initial snapshot", async () => {
    // The snapshot claims 5, but only 3 documents actually exist to page through —
    // simulating a deletion between the count and the scan.
    const documents = [
      row({ _id: "a1", _type: "media" }),
      row({ _id: "a2", _type: "media" }),
      row({ _id: "a3", _type: "media" }),
    ];
    await expect(runContentAudit(fakeRunQuery(5, documents), { pageSize: 200 })).rejects.toThrow(
      AuditConsistencyError,
    );
  });

  it("throws AuditQueryError when a page returns more rows than the requested page size", async () => {
    const runQuery = async (request: ReadQueryRequest) => {
      if (request.query === "count(*[])") return 3;
      return [row({ _id: "a1", _type: "media" }), row({ _id: "a2", _type: "media" }), row({ _id: "a3", _type: "media" })];
    };
    await expect(runContentAudit(runQuery, { pageSize: 2 })).rejects.toThrow(AuditQueryError);
  });

  it("throws AuditQueryError when a page's ids are not strictly increasing (non-advancing cursor)", async () => {
    const runQuery = async (request: ReadQueryRequest) => {
      if (request.query === "count(*[])") return 2;
      return [row({ _id: "a1", _type: "media" }), row({ _id: "a1", _type: "media" })];
    };
    await expect(runContentAudit(runQuery, { pageSize: 200 })).rejects.toThrow(AuditQueryError);
  });

  it("throws AuditConsistencyError rather than looping forever when pagination never terminates", async () => {
    // Always returns a full page, advancing the id but never falling short of
    // the page size and never matching the (impossibly low) snapshot count.
    let counter = 0;
    const runQuery = async (request: ReadQueryRequest) => {
      if (request.query === "count(*[])") return 1;
      counter += 1;
      return [row({ _id: `id-${String(counter).padStart(4, "0")}`, _type: "media" })];
    };
    await expect(runContentAudit(runQuery, { pageSize: 1 })).rejects.toThrow(AuditConsistencyError);
  });

  it("throws AuditQueryError on a malformed row shape rather than silently reporting an empty result", async () => {
    const runQuery = async (request: ReadQueryRequest) => {
      if (request.query === "count(*[])") return 1;
      return [{ _id: "a1", _type: "media", hasOriginalFilename: "not-a-boolean" }];
    };
    await expect(runContentAudit(runQuery, { pageSize: 200 })).rejects.toThrow(AuditQueryError);
  });

  it("throws AuditQueryError when the snapshot count is not a number", async () => {
    const runQuery = async () => "not-a-number";
    await expect(runContentAudit(runQuery, { pageSize: 200 })).rejects.toThrow(AuditQueryError);
  });

  it("rejects a non-positive page size", async () => {
    await expect(runContentAudit(fakeRunQuery(0, []), { pageSize: 0 })).rejects.toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// formatContentAuditReport — never echoes a sensitive value
// ---------------------------------------------------------------------------

describe("formatContentAuditReport", () => {
  it("never includes a sensitive field's value, even if one leaked into a row's extra properties", async () => {
    const SENTINEL = "TOTALLY-SECRET-ARCHIVE-PATH-VALUE";
    const documents = [
      // Only `hasArchiveLocator`/`hasCapturedAt` are ever read by the parser;
      // the raw row below also carries the real field name with a sentinel
      // value, proving it is never picked up or echoed anywhere downstream.
      { _id: "a1", _type: "media", hasOriginalFilename: false, width: null, height: null, hasArchiveLocator: true, hasCapturedAt: false, archiveLocator: SENTINEL },
    ];
    const report = await runContentAudit(fakeRunQuery(1, documents as unknown as AuditRawRow[]), { pageSize: 200 });
    const text = formatContentAuditReport(report);
    expect(text).not.toContain(SENTINEL);
    expect(text).toContain("a1  archiveLocator:yes  capturedAt:no");
  });

  it("labels a file asset's absent dimensions as expected, never as a missing-dimension defect", async () => {
    const documents = [
      row({ _id: "file1", _type: "sanity.fileAsset", width: null, height: null }),
      row({ _id: "img1", _type: "sanity.imageAsset", width: null, height: null }),
    ];
    const report = await runContentAudit(fakeRunQuery(documents.length, documents), { pageSize: 200 });
    const text = formatContentAuditReport(report);
    expect(text).toContain("file1  [sanity.fileAsset]  n/a (file asset)");
    expect(text).toContain("img1  [sanity.imageAsset]  MISSING DIMENSIONS");
    expect(text).toContain("Image assets missing public derivative dimensions: 1 (img1)");
  });

  it("reports the default page size constant is a positive integer", () => {
    expect(Number.isInteger(AUDIT_PAGE_SIZE)).toBe(true);
    expect(AUDIT_PAGE_SIZE).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Sensitive-field policy pinned against the real schema
// ---------------------------------------------------------------------------

describe("SENSITIVE_MEDIA_METADATA_FIELDS", () => {
  it("is a subset of the fields sanity/schemas/media.ts actually declares for a private dataset", () => {
    const mediaType = defineMediaType({ datasetVisibility: "private" });
    const declaredFieldNames = new Set((mediaType.fields ?? []).map((field) => field.name));
    for (const field of SENSITIVE_MEDIA_METADATA_FIELDS) {
      expect(declaredFieldNames.has(field)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Import-boundary guard: the CLI must only ever import the mutate-incapable
// read transport. This is a structural guarantee (sanity-read-http.mts has
// no mutate/upload export to call), not a substitute for it — this test only
// pins that the CLI keeps importing that module and not the write-capable one.
// ---------------------------------------------------------------------------

describe("audit-sanity-content.mts import boundary", () => {
  it("imports the read-only transport and never the write-capable seed transport", () => {
    const cliPath = fileURLToPath(new URL("./audit-sanity-content.mts", import.meta.url));
    const source = readFileSync(cliPath, "utf8");
    expect(source).toContain("./sanity-read-http.mts");
    expect(source).not.toContain("sanity-seed-http");
  });
});
