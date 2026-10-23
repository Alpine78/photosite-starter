import { describe, expect, it, vi } from "vitest";
import { createProofGalleryReader, PROOF_GALLERY_MISS_TTL_MS, PROOF_GALLERY_QUERY } from "@/lib/proof-gallery-sanity";
import { ClientGalleryBudgetError, ClientGalleryChangedError, ClientGalleryDataError } from "@/lib/client-gallery-model";
import { PROOF_GALLERY_MAX_DOCUMENT_BYTES, PROOF_GALLERY_MAX_ITEMS } from "@/lib/proof-gallery-model";

const handle = "a".repeat(32), id = "proof1";
const asset = (n: string) => `image-${n.repeat(40)}-1600x1000-webp`;
const now = Date.parse("2026-10-23T00:00:00Z");
const config = { projectId: "abcdefgh", dataset: "fixture", datasetVisibility: "public" as const, apiVersion: "v2026-06-24" };
const text = (language: string, value: string) => ({ _key: language, _type: "localizedText", language, value });
function document(extra: Record<string, unknown> = {}) {
  return { _id: id, _type: "clientProofGallery", _rev: "rev1", _createdAt: "2026-10-22T12:00:00Z", _updatedAt: "2026-10-22T12:00:00Z",
    handle, available: true, availabilityMode: "indefinite", referenceHighWater: 14, title: [text("en", "Proofs"), text("fi", "Vedokset")],
    items: [
      { _key: "b", _type: "clientProofItem", mediaType: "image", originalFilename: "DSC_0042-secret-name.jpg", reference: "014",
        image: { _type: "image", asset: { _type: "reference", _ref: asset("2") } }, alt: [text("en", "Coast"), text("fi", "Rannikko")] },
      { _key: "a", _type: "clientProofItem", mediaType: "image", originalFilename: "DSC_0007.jpg", reference: "002",
        image: { _type: "image", asset: { _type: "reference", _ref: asset("1") } } },
    ], ...extra };
}
const metadata = (n: string) => ({ _id: asset(n), _type: "sanity.imageAsset", sha1hash: n.repeat(40), extension: "webp", mimeType: "image/webp", width: 1600, height: 1000, restricted: false });
function row(doc: ReturnType<typeof document> = document(), replacement: unknown = null) {
  const { _createdAt, _updatedAt, ...projected } = structuredClone(doc);
  void _createdAt; void _updatedAt;
  return { _id: doc._id, _type: doc._type, document: projected, assets: doc.items.map((item) => ({ asset: metadata(item.image.asset._ref.slice(6, 7)) })), replacement };
}
function setup(options: { doc?: unknown; docs?: unknown[]; rows?: unknown; rowsSeq?: unknown[]; wall?: () => number; tick?: () => number; missing?: Map<string, number> } = {}) {
  const controller = new AbortController();
  let queries = 0, reads = 0;
  const query = vi.fn(async () => options.rowsSeq ? options.rowsSeq[Math.min(queries++, options.rowsSeq.length - 1)] : Object.hasOwn(options, "rows") ? options.rows : [row()]);
  const read = vi.fn(async () => options.docs ? options.docs[Math.min(reads++, options.docs.length - 1)] : Object.hasOwn(options, "doc") ? options.doc : document());
  const reader = createProofGalleryReader({ config, query: { query }, documents: { read },
    now: options.wall ?? (() => now), missClock: options.tick ?? (() => 0), missing: options.missing, signal: () => controller.signal });
  const full = (value = handle, language = "en-GB", fallback = "fi") => reader.read(value, language, fallback);
  return { query, read, controller, full, run: async (value = handle, language = "en-GB", fallback = "fi") => (await full(value, language, fallback))?.view };
}

describe("proof gallery reading (ADR-0038 action item 2)", () => {
  it("projects only numbered full-frame presentation data in authored order", async () => {
    const f = setup(), view = await f.run();
    expect(f.query).toHaveBeenCalledWith({ query: PROOF_GALLERY_QUERY, tag: "client.proof", params: { handle }, signal: f.controller.signal });
    expect(f.read).toHaveBeenCalledWith(id, f.controller.signal);
    expect(view).toEqual({ title: "Proofs", images: [
      expect.objectContaining({ itemId: "b", reference: "014", alt: "Coast", width: 1600, height: 1000, src: `https://cdn.sanity.io/images/abcdefgh/fixture/${"2".repeat(40)}-1600x1000.webp` }),
      expect.objectContaining({ itemId: "a", reference: "002", alt: "" }),
    ] });
    const payload = JSON.stringify(view);
    for (const internal of ["DSC_", "originalFilename", "_rev", "referenceHighWater", "restricted", "clientProofGallery", asset("1")]) expect(payload).not.toContain(internal);
  });

  it("falls back to the configured language and then leaves an absent alt empty", async () => {
    const view = await setup().run("a".repeat(32), "sv", "fi");
    expect(view?.title).toBeUndefined();
    expect(view?.images.map((image) => image.alt)).toEqual(["Rannikko", ""]);
  });

  it.each(["", "A".repeat(32), "a".repeat(31), "a/../b"])("refuses malformed handle %j without provider IO", async (value) => {
    const f = setup(); expect(await f.run(value)).toBeUndefined(); expect(f.query).not.toHaveBeenCalled();
  });

  it.each([
    ["deleted", null],
    ["paused", document({ available: false })],
    ["expired at its deadline", document({ availabilityMode: "until", expiryInstant: "2026-10-23T00:00:00.000Z" })],
  ])("treats a %s gallery as ordinary unavailability", async (_name, doc) => {
    expect(await setup({ doc }).run()).toBeUndefined();
  });

  it("rechecks the deadline after the projection work", async () => {
    const doc = document({ availabilityMode: "until", expiryInstant: "2026-10-23T00:00:01.000Z" });
    let clock = now;
    const f = setup({ doc, rows: [row(doc)], wall: () => { const value = clock; clock += 1000; return value; } });
    expect(await f.run()).toBeUndefined();
  });

  it("retries one stale indexed revision, then refuses a document that keeps changing", async () => {
    const stale = row(document({ _rev: "rev0" }));
    expect(await setup({ rowsSeq: [[stale], [row()]] }).run()).toMatchObject({ title: "Proofs" });
    await expect(setup({ rows: [stale] }).run()).rejects.toBeInstanceOf(ClientGalleryChangedError);
  });

  it("refuses a same-revision snapshot that disagrees after normalization", async () => {
    const snapshot = row(document({ items: document().items.map((item) => item._key === "a" ? { ...item, reference: "003" } : item) }));
    await expect(setup({ rows: [snapshot] }).run()).rejects.toBeInstanceOf(ClientGalleryChangedError);
  });

  it("notices a known document that the index lost or moved to another handle between reads", async () => {
    await expect(setup({ rowsSeq: [[row(document({ _rev: "rev0" }))], []] }).run()).rejects.toBeInstanceOf(ClientGalleryChangedError);
    expect(await setup({ rowsSeq: [[row(document({ _rev: "rev0" }))], []], docs: [document(), null] }).run()).toBeUndefined();
    await expect(setup({ doc: document({ handle: "b".repeat(32) }) }).run()).rejects.toBeInstanceOf(ClientGalleryDataError);
  });

  it.each([
    ["two documents with one handle", [row(), row()]],
    ["a draft identity", [{ ...row(), _id: "drafts.proof1" }]],
    ["a delivery gallery row", [{ ...row(), _type: "clientDeliveryGallery" }]],
    ["a non-array answer", {}],
  ])("refuses %s as malformed discovery", async (_name, rows) => {
    await expect(setup({ rows }).run()).rejects.toBeInstanceOf(ClientGalleryDataError);
  });

  it.each([
    ["a private-only asset", { restricted: true }],
    ["mismatched dimensions", { width: 1599 }],
    ["a mismatched hash", { sha1hash: "f".repeat(40) }],
  ])("refuses %s", async (_name, patch) => {
    const value = row(); value.assets[0].asset = { ...value.assets[0].asset, ...patch };
    await expect(setup({ rows: [value] }).run()).rejects.toBeInstanceOf(ClientGalleryDataError);
  });

  it("refuses unnumbered or repeated proof numbers in a published document", async () => {
    const unnumbered = document({ items: document().items.map(({ reference: _reference, ...item }) => { void _reference; return item; }) });
    await expect(setup({ doc: unnumbered, rows: [row(unnumbered)] }).run()).rejects.toBeInstanceOf(ClientGalleryDataError);
  });

  it("stops at the shared time budget", async () => {
    const f = setup(); f.controller.abort();
    await expect(f.run()).rejects.toBeInstanceOf(ClientGalleryBudgetError);
  });

  it("caches only an empty public discovery, briefly", async () => {
    const missing = new Map<string, number>();
    let tick = 0;
    const f = setup({ rows: [], missing, tick: () => tick });
    expect(await f.run()).toBeUndefined(); expect(await f.run()).toBeUndefined();
    expect(f.query).toHaveBeenCalledTimes(1);
    tick = PROOF_GALLERY_MISS_TTL_MS + 1;
    expect(await f.run()).toBeUndefined(); expect(f.query).toHaveBeenCalledTimes(2);
    expect(await setup({ doc: document({ available: false }), missing }).run()).toBeUndefined();
    expect(missing.size).toBe(1);
  });

  it("holds only the fresh document, not its projection's explicit nulls, to the size limit", async () => {
    const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
    const build = (length: number) => document({ referenceHighWater: PROOF_GALLERY_MAX_ITEMS, items: Array.from({ length: PROOF_GALLERY_MAX_ITEMS }, (_, index) => ({
      _key: `k${index}`, _type: "clientProofItem", mediaType: "image", originalFilename: `${"f".repeat(200)}${index}.jpg`,
      reference: String(index + 1).padStart(3, "0"), image: { _type: "image", asset: { _type: "reference", _ref: asset("2") } },
      alt: [text("en", "a".repeat(length)), text("fi", "b".repeat(length))] })) });
    const authored = (doc: ReturnType<typeof document>) => { const { _id, _rev, _createdAt, _updatedAt, ...rest } = doc; void _id; void _rev; void _createdAt; void _updatedAt; return bytes(rest); };
    let length = 1;
    while (authored(build(length + 1)) <= PROOF_GALLERY_MAX_DOCUMENT_BYTES) length++;
    const doc = build(length), snapshot = row(doc);
    snapshot.document = { ...snapshot.document, expiryInstant: null,
      items: snapshot.document.items.map((item) => ({ ...item, image: { ...item.image, crop: null, hotspot: null } })) } as typeof snapshot.document;
    expect(authored(doc)).toBeLessThanOrEqual(PROOF_GALLERY_MAX_DOCUMENT_BYTES);
    expect(bytes(snapshot.document)).toBeGreaterThan(PROOF_GALLERY_MAX_DOCUMENT_BYTES);
    expect((await setup({ doc, rows: [snapshot] }).run())?.images).toHaveLength(PROOF_GALLERY_MAX_ITEMS);
    const over = build(length + 1);
    await expect(setup({ doc: over, rows: [row(over)] }).run()).rejects.toBeInstanceOf(ClientGalleryDataError);
  });

  describe("replacement by a delivery gallery (owner answer 5)", () => {
    const reference = { _type: "reference", _ref: "delivery1", _weak: true };
    const delivery = { _id: "delivery1", _type: "clientDeliveryGallery", handle: "d".repeat(32) };

    it("names the referenced delivery gallery and leaves availability to the caller", async () => {
      const doc = document({ replacedBy: reference });
      expect(await setup({ doc, rows: [row(doc, delivery)] }).full()).toMatchObject({
        replacement: { id: "delivery1", handle: "d".repeat(32) }, availability: { available: true }, view: { title: "Proofs" },
      });
    });

    it("still answers for paused or expired proofs that name a replacement", async () => {
      for (const extra of [{ available: false }, { availabilityMode: "until", expiryInstant: "2026-10-22T00:00:00.000Z" }]) {
        const doc = document({ ...extra, replacedBy: reference });
        const result = await setup({ doc, rows: [row(doc, delivery)] }).full();
        expect(result?.replacement).toEqual({ id: "delivery1", handle: "d".repeat(32) });
        expect(result?.availability.available === false || result?.availability.deadline === Date.parse("2026-10-22T00:00:00.000Z")).toBe(true);
      }
    });

    it("ignores a deleted replacement, so only open proofs answer", async () => {
      const doc = document({ replacedBy: reference });
      expect((await setup({ doc, rows: [row(doc, null)] }).full())?.replacement).toBeUndefined();
      const paused = document({ available: false, replacedBy: reference });
      expect(await setup({ doc: paused, rows: [row(paused, null)] }).full()).toBeUndefined();
    });

    it.each([
      ["another document", { ...delivery, _id: "delivery2" }],
      ["another type", { ...delivery, _type: "legacyDeliveryGallery" }],
      ["a malformed handle", { ...delivery, handle: "x" }],
    ])("refuses a dereference to %s", async (_name, replacement) => {
      const doc = document({ replacedBy: reference });
      await expect(setup({ doc, rows: [row(doc, replacement)] }).full()).rejects.toBeInstanceOf(ClientGalleryDataError);
    });

    it("refuses a reference shape Studio does not write for a published target", async () => {
      const doc = document({ replacedBy: { ...reference, _strengthenOnPublish: { type: "clientDeliveryGallery", weak: true } } });
      await expect(setup({ doc, rows: [row(doc, delivery)] }).full()).rejects.toBeInstanceOf(ClientGalleryDataError);
    });
  });
});
