import { describe, expect, it } from "vitest";
import { CleanupSnapshotBuilder, CleanupSnapshotError } from "./client-gallery-cleanup-snapshot";

const encoder = new TextEncoder();
const limits = { maxSnapshotBytes: 100_000, maxLineBytes: 10_000, maxDocuments: 100, maxReferences: 100 };
const document = (id = "gallery", extra: Record<string, unknown> = {}) => ({ _id: id, _rev: "r1", _type: "clientDeliveryGallery", ...extra });
function parse(lines: readonly unknown[], overrides = {}) {
  const builder = new CleanupSnapshotBuilder({ ...limits, ...overrides });
  builder.append(encoder.encode(lines.map((line) => typeof line === "string" ? line : JSON.stringify(line)).join("\n")));
  return builder.finish(1000);
}

describe("bounded cleanup snapshot", () => {
  it("keeps only revision and reference metadata, including private, draft and release weak uses", () => {
    const result = parse([
      document("clientGalleryCleanup.zz", { _type: "clientGalleryCleanup", customerEmail: "synthetic@example.invalid" }),
      document("gallery", { image: { _type: "reference", _ref: "image-a" }, alternate: { _ref: "image-a" }, privatePrice: 123 }),
      document("drafts.other", { blocks: [{ nested: { _ref: "image-a", _weak: true } }] }),
      document("versions.release.other", { blocks: [{ nested: { _ref: "image-a" } }] }),
    ]);
    expect(result.controlIds).toEqual(["clientGalleryCleanup.zz"]);
    expect(result.referrers("image-a").map((doc) => doc.id)).toEqual(["gallery", "drafts.other", "versions.release.other"]);
    expect(result.documents.get("drafts.other")?.references).toEqual([{ target: "image-a", weak: true }]);
    expect(JSON.stringify([...result.documents.values()])).not.toMatch(/privatePrice|customerEmail|example|123/);
    expect(result.documentCount).toBe(4);
    expect(result.providerTime).toBe(1000);
  });
  it("handles every UTF-8 byte boundary and CRLF without retaining entire export", () => {
    const input = encoder.encode(JSON.stringify(document("one", { title: "Ää 📷" })) + "\r\n" + JSON.stringify(document("two")) + "\n");
    const builder = new CleanupSnapshotBuilder(limits);
    for (const byte of input) builder.append(Uint8Array.of(byte));
    const result = builder.finish(1000);
    expect([...result.documents.keys()]).toEqual(["one", "two"]);
    expect(result.bytes).toBe(input.length);
  });
  it("terminal controls cannot consume the work cursor, while all their references remain evidence", () => {
    const result = parse([
      document("clientGalleryCleanup.complete", { _type: "clientGalleryCleanup", state: "complete", unexpected: { _ref: "image-a" } }),
      document("clientGalleryCleanup.disabled", { _type: "clientGalleryCleanup", state: "disabled" }),
      document("clientGalleryCleanup.active", { _type: "clientGalleryCleanup", state: "enrolled" }),
      document("clientGalleryCleanup.malformed", { _type: "unknown", state: "typo" }),
    ]);
    expect(result.controlIds).toEqual(["clientGalleryCleanup.active", "clientGalleryCleanup.malformed"]);
    expect(result.documents.size).toBe(4);
    expect(result.referrers("image-a").map((entry) => entry.id)).toEqual(["clientGalleryCleanup.complete"]);
  });
  it.each([
    '{"_id":"one","_id":"two","_rev":"r","_type":"x"}',
    '{"_id":"one","\\u005fid":"two","_rev":"r","_type":"x"}',
    '{"_id":"one","_rev":"r","_type":"x","nested":{"a":1,"a":2}}',
    '{"error":{"description":"synthetic"}}', '{"nextCursor":"partial"}',
    '{"_id":"one","_rev":"r","_type":"x","nextCursor":"partial"}',
    '{"_id":"one","_rev":"r","_type":"x"', "[]", "null", "true", "{}",
    JSON.stringify(document("one", { reference: { _type: "reference" } })),
    JSON.stringify(document("one", { reference: { _ref: "asset", _weak: "true" } })),
    JSON.stringify(document("one", { reference: { _ref: "../../asset" } })),
    JSON.stringify(document("one", { _rev: "" })),
    JSON.stringify(document("one", { _rev: "r1\n" })),
    JSON.stringify(document("one", { _type: "clientDeliveryGallery\n" })),
    JSON.stringify(document("one\n")),
    JSON.stringify(document("../one")),
  ])("rejects an incomplete or ambiguous export line (%s)", (line) => {
    expect(() => parse([line])).toThrowError(new CleanupSnapshotError("snapshot_invalid"));
  });
  it("rejects duplicate document IDs even if their revisions match", () => {
    expect(() => parse([document(), document()])).toThrowError("snapshot_invalid");
  });
  it("rejects invalid UTF-8, blank interior lines and BOM", () => {
    for (const input of [Uint8Array.of(0xff), encoder.encode("\n"), encoder.encode("\ufeff" + JSON.stringify(document()))]) {
      const builder = new CleanupSnapshotBuilder(limits);
      expect(() => { builder.append(input); builder.finish(1); }).toThrowError("snapshot_invalid");
    }
  });
  it.each([
    { maxSnapshotBytes: 10 }, { maxLineBytes: 10 }, { maxDocuments: 1 }, { maxReferences: 1 },
  ])("reports explicit resource limits: %j", (overrides) => {
    expect(() => parse([document("one", { refs: [{ _ref: "a" }, { _ref: "b" }] }), document("two")], overrides)).toThrowError("snapshot_limit_exceeded");
  });
  it("rejects excessive JSON depth and incomplete final UTF-8", () => {
    expect(() => parse([JSON.stringify(document("one", { nesting: Array.from({ length: 70 }).reduce((value) => [value], [] as unknown[]) }))])).toThrowError("snapshot_invalid");
    const builder = new CleanupSnapshotBuilder(limits);
    builder.append(encoder.encode(JSON.stringify(document()) + "\n"));
    builder.append(Uint8Array.of(0xe2, 0x82));
    expect(() => builder.finish(1)).toThrowError("snapshot_invalid");
  });
  it("supports empty datasets but never accepts further chunks after completion", () => {
    const builder = new CleanupSnapshotBuilder(limits);
    expect(builder.finish(1).documentCount).toBe(0);
    expect(() => builder.append(new Uint8Array())).toThrowError("snapshot_invalid");
    expect(() => builder.finish(1)).toThrowError("snapshot_invalid");
  });
  // Real duplicate-key scanning across a synthetic multi-MiB export needs a generous suite budget.
  it("parses a realistic synthetic export within a generous CPU budget", () => {
    const builder = new CleanupSnapshotBuilder({ maxSnapshotBytes: 16 * 1024 * 1024, maxLineBytes: 1024 * 1024, maxDocuments: 10_000, maxReferences: 100_000 });
    const started = performance.now();
    const padding = "p".repeat(1024);
    for (let i = 0; i < 8000; i++) builder.append(encoder.encode(JSON.stringify(document(`asset-${i}`, { lqip: padding, metadata: { refs: [{ _ref: "other" }] } })) + "\n"));
    const result = builder.finish(1000);
    expect(result.bytes).toBeGreaterThan(8 * 1024 * 1024);
    expect(result.documentCount).toBe(8000);
    expect(performance.now() - started).toBeLessThan(15_000);
  }, 20_000);
});
