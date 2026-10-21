import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluate, parse } from "groq-js/1";
import { CLIENT_DELIVERY_ERRORS, isClientDeliveryAsset, validateClientDeliveryGallery } from "../sanity/schemas/client-delivery-gallery";
import { createExistingImageController, existingImageCutoff, EXISTING_IMAGES_BEFORE_QUERY, EXISTING_IMAGES_QUERY, SELECTED_EXISTING_IMAGES_QUERY, existingImageCapacity, existingImageReferences, makeExistingClientItems, parseExistingClientImages, type ExistingClientImage, type ExistingImageRequest, type ExistingImageScope } from "./existing-client-web-images";
function asset(n = 1) {
  const sha1hash = n.toString(16).padStart(40, "0");
  return { _id: `image-${sha1hash}-1600x1000-webp`, _type: "sanity.imageAsset", sha1hash, extension: "webp", mimeType: "image/webp",
    _createdAt: "2026-10-17T00:00:00Z", metadata: { dimensions: { width: 1600, height: 1000 } }, originalFilename: "never-project-canary.webp", url: "https://never-fetch.example/source" };
}
function row(n = 1): ExistingClientImage {
  const { _id, sha1hash, extension, mimeType, _createdAt } = asset(n);
  return { _id, _type: "sanity.imageAsset", sha1hash, extension, mimeType, _createdAt, width: 1600, height: 1000, restricted: false };
}
async function query(dataset: unknown[], source: string, params = {}) { return (await evaluate(parse(source), { dataset, params })).get(); }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function harness(rows = [row(1), row(2)], read?: (request: ExistingImageRequest) => Promise<unknown>) {
  const append = vi.fn(), requests = vi.fn(read ?? (async request => request.ids ? rows.filter(row => request.ids!.includes(row._id)) : rows));
  let scope: ExistingImageScope = { documentId: "synthetic-gallery", path: '["fixture","items"]', readOnly: false, value: undefined, append }, random = 0;
  const controller = createExistingImageController({ getScope: () => scope, read: requests, random: bytes => { bytes.fill(++random); } });
  return { controller, append, requests, scope: () => scope, change: (change: Partial<ExistingImageScope>, notify = true) => { scope = { ...scope, ...change }; if (notify) controller.scopeChanged(); } };
}
afterEach(() => vi.restoreAllMocks());

describe("existing public web-image query and shared publication contract", () => {
  it("bounds the actual query and excludes draft/release privateOnly references without projecting source data", async () => {
    const raw = Array.from({ length: 260 }, (_, i) => asset(i + 1));
    const media = (id: string, n: number) => ({ _id: id, _type: "media", privateOnly: true, image: { asset: { _ref: asset(n)._id } } });
    const dataset = [...raw, media("drafts.private", 1), media("versions.release.private", 2)];
    const selected = await query(dataset, EXISTING_IMAGES_QUERY);
    const rows = parseExistingClientImages(selected, 257, true);
    expect(rows).toHaveLength(257); expect(rows[0]._id).toBe(asset(3)._id); expect(rows.at(-1)?._id).toBe(asset(259)._id);
    expect(rows.every(isClientDeliveryAsset)).toBe(true); expect(JSON.stringify(rows)).not.toMatch(/never-project|never-fetch|originalFilename|metadata/);
    const fresh = await query(dataset, SELECTED_EXISTING_IMAGES_QUERY, { ids: [asset(1)._id, asset(3)._id] });
    expect(fresh).toHaveLength(2); expect(() => parseExistingClientImages(fresh, 2)).toThrow(); // Recheck sees the new/draft restriction, never silently drops it.
  // AB#377: evaluates the real GROQ query over ~260 documents, which neared or
  // exceeded the default 5 s limit under the full parallel suite.
  }, 20_000);
  it.each([true, "false", 1, {}])("shares the current malformed/privateOnly refusal %#", async flag => {
    const dataset = [asset(), { _id: "drafts.private", _type: "media", privateOnly: flag, image: { asset: { _ref: asset()._id } } }];
    expect(await query(dataset, EXISTING_IMAGES_QUERY)).toEqual([]);
  });
  it("rejects malformed, duplicate, oversized, unordered and provider-internal responses", () => {
    const good = row();
    for (const bad of [null, {}, [null], [{ ...good, originalFilename: "canary" }], [{ ...good, restricted: true }], [{ ...good, sha1hash: "b".repeat(40) }], [{ ...good, width: 2049 }], [{ ...good, extension: "jpg" }], [{ ...good, mimeType: "image/jpeg" }], [{ ...good, _createdAt: "2026-02-31T00:00:00Z" }], [good, good], Array.from({ length: 258 }, (_, i) => row(i + 1))]) expect(() => parseExistingClientImages(bad, 257)).toThrow();
    expect(() => parseExistingClientImages([row(2), row(1)], 257, true)).toThrow();
    expect(parseExistingClientImages([row(2), row(1)], 257)).toHaveLength(2); // Refetch order is immaterial.
    expect(isClientDeliveryAsset({ ...good, _id: `image-${good.sha1hash}-1600x1000-webp\n` })).toBe(false);
  });
  it("builds closed native items with no crop/alt invention and validates after owner-authored alt", async () => {
    let random = 0; const items = makeExistingClientItems([asset(1)._id, asset(2)._id], undefined, bytes => { bytes.fill(++random); });
    expect(items.map(item => item.image.asset._ref)).toEqual([asset(1)._id, asset(2)._id]);
    expect(items[0]).toEqual({ _key: "01".repeat(16), _type: "clientDeliveryItem", mediaType: "image", image: { _type: "image", asset: { _type: "reference", _ref: asset(1)._id } } });
    expect(JSON.stringify(items)).not.toMatch(/alt|crop|hotspot|filename|title|available/);
    const document = { _id: "synthetic-gallery", _type: "clientDeliveryGallery", handle: "a".repeat(32), available: false, availabilityMode: "indefinite", items };
    const client = { withConfig() { return this; }, fetch: <T>(q: string, params?: Readonly<Record<string, unknown>>) => query([asset(1), asset(2)], q, params) as Promise<T> };
    expect(await validateClientDeliveryGallery(document, { getClient: () => client })).toBe(CLIENT_DELIVERY_ERRORS.structure);
    const authored = { ...document, items: items.map(item => ({ ...item, alt: [{ _key: "en", _type: "localizedText", language: "en", value: "Synthetic complete frame" }] })) };
    expect(await validateClientDeliveryGallery(authored, { getClient: () => client })).toBe(true);
  });
  it("does not overwrite existing keys and refuses absent entropy or repeated collisions", () => {
    let n = 0; const value = [{ _key: "01".repeat(16), image: { asset: { _ref: asset()._id } } }];
    expect(makeExistingClientItems([asset()._id], value, bytes => { bytes.fill(++n); })[0]._key).toBe("02".repeat(16));
    expect(() => makeExistingClientItems([asset()._id], value, bytes => { bytes.fill(1); })).toThrow("keys");
    expect(() => makeExistingClientItems([asset()._id], value, () => { throw Error("private-provider-canary"); })).toThrow();
    expect(existingImageCapacity(Array(256))).toBe(0); expect(existingImageCapacity({})).toBe(0); expect(existingImageCapacity(undefined)).toBe(256);
    expect(existingImageReferences(value)).toEqual(new Set([asset()._id]));
  });
});

describe("native picker asynchronous controller", () => {
  it("binds only after commit and discards a pending response after an immutable scope replacement", async () => {
    const controller = createExistingImageController(), append = vi.fn(), replacement = vi.fn(), pending = deferred<unknown>();
    await controller.open(); expect(controller.getSnapshot().phase).toBe("closed");
    const scope: ExistingImageScope = { documentId: "one", path: "items", readOnly: false, value: undefined, append };
    const read = vi.fn(async (request: ExistingImageRequest) => request.ids ? pending.promise : [row()]);
    controller.bind({ getScope: () => scope, read }); await controller.open(); controller.toggle(row()._id); const adding = controller.add();
    const signal = read.mock.calls.at(-1)![0].signal;
    controller.bind({ getScope: () => ({ ...scope, documentId: "two", append: replacement }), read }); controller.scopeChanged();
    expect(signal.aborted).toBe(true); pending.resolve([row()]); await adding;
    expect(append).not.toHaveBeenCalled(); expect(replacement).not.toHaveBeenCalled(); expect(controller.getSnapshot().phase).toBe("closed");
  });
  it("uses the latest committed native callback and value after a same-document rebind", async () => {
    const controller = createExistingImageController(), first = vi.fn(), latest = vi.fn(), pending = deferred<unknown>();
    const scope: ExistingImageScope = { documentId: "same", path: "items", readOnly: false, value: undefined, append: first };
    const read = async (request: ExistingImageRequest) => request.ids ? pending.promise : [row()];
    controller.bind({ getScope: () => scope, read }); await controller.open(); controller.toggle(row()._id); const adding = controller.add();
    const value = [{ _key: "existing" }]; controller.bind({ getScope: () => ({ ...scope, value, append: latest }), read }); controller.scopeChanged();
    pending.resolve([row()]); await adding; expect(first).not.toHaveBeenCalled(); expect(latest).toHaveBeenCalledTimes(1); expect(value).toEqual([{ _key: "existing" }]);
  });
  it("makes zero reads until deliberate loading and reveals the bounded newest set locally", async () => {
    const h = harness(Array.from({ length: 257 }, (_, i) => row(i + 1)));
    expect(h.requests).not.toHaveBeenCalled(); expect(h.controller.getSnapshot().phase).toBe("closed");
    await h.controller.open(); expect(h.requests).toHaveBeenCalledTimes(1); expect(h.controller.getSnapshot()).toMatchObject({ phase: "ready", truncated: true, visible: 64 });
    expect(h.controller.getSnapshot().rows).toHaveLength(256); h.controller.showMore(); expect(h.controller.getSnapshot().visible).toBe(128); expect(h.requests).toHaveBeenCalledTimes(1);
    h.controller.toggle(row(200)._id); expect(h.controller.getSnapshot().selected).toEqual([]);
  });
  it("preserves checkbox selection order, allows existing source repetition and appends once", async () => {
    const rows = [row(1), row(2), row(3)], h = harness(rows); const old = [{ _key: "existing", image: { asset: { _ref: row(1)._id } } }]; h.change({ value: old });
    await h.controller.open(); for (const id of [row(1)._id, row(3)._id, row(1)._id, row(1)._id]) h.controller.toggle(id);
    expect(h.controller.getSnapshot().selected).toEqual([row(3)._id, row(1)._id]);
    await h.controller.add(); expect(h.append).toHaveBeenCalledTimes(1); expect(h.append.mock.calls[0][0].map((item: { image: { asset: { _ref: string } } }) => item.image.asset._ref)).toEqual([row(3)._id, row(1)._id]);
    expect(old).toEqual([{ _key: "existing", image: { asset: { _ref: row(1)._id } } }]); expect(h.controller.getSnapshot().phase).toBe("closed");
  });
  it("compares fresh metadata by value rather than JSON property order", async () => {
    const h = harness([row()], async request => request.ids ? [{ ...Object.fromEntries(Object.entries(row()).reverse()) }] : [row()]);
    await h.controller.open(); h.controller.toggle(row()._id); await h.controller.add(); expect(h.append).toHaveBeenCalledTimes(1);
  });
  it.each([[], [{ ...row(), restricted: true }], [{ ...row(), _createdAt: "2026-10-18T00:00:00Z" }], [row(2)], [row(), row()]])("refuses an entire missing/changed/restricted selected set %#", async fresh => {
    const h = harness([row()], async request => request.ids ? fresh : [row()]); await h.controller.open(); h.controller.toggle(row()._id); await h.controller.add();
    expect(h.append).not.toHaveBeenCalled(); expect(h.controller.getSnapshot()).toMatchObject({ phase: "ready", error: "changed", selected: [row()._id] });
  });
  it("rechecks current capacity after refetch and uses the latest native callback", async () => {
    const pending = deferred<unknown>(), h = harness([row(1), row(2)], request => request.ids ? pending.promise : Promise.resolve([row(1), row(2)]));
    await h.controller.open(); h.controller.toggle(row(1)._id); h.controller.toggle(row(2)._id); const added = h.controller.add(); h.change({ value: Array(255) });
    pending.resolve([row(1), row(2)]); await added; expect(h.append).not.toHaveBeenCalled(); expect(h.controller.getSnapshot().error).toBe("capacity");
    const next = vi.fn(); h.change({ value: [], append: next }); await h.controller.add(); expect(next).toHaveBeenCalledTimes(1); expect(h.append).not.toHaveBeenCalled();
  });
  it("prevents double Add and rejects over-capacity selection before any refetch", async () => {
    const pending = deferred<unknown>(), h = harness([row()], request => request.ids ? pending.promise : Promise.resolve([row()]));
    await h.controller.open(); h.controller.toggle(row()._id); const first = h.controller.add(); await h.controller.add(); expect(h.requests).toHaveBeenCalledTimes(2);
    pending.resolve([row()]); await first; expect(h.append).toHaveBeenCalledTimes(1);
    const full = harness(); full.change({ value: Array(256) }); await full.controller.open(); full.controller.toggle(row()._id); await full.controller.add(); expect(full.requests).toHaveBeenCalledTimes(1); expect(full.append).not.toHaveBeenCalled();
  });
  it.each([{ documentId: "another-gallery" }, { path: '["other-dataset","items"]' }, { readOnly: true }])("ignores a late refetch after scope/permission changes %#", async change => {
    const pending = deferred<unknown>(), h = harness([row()], request => request.ids ? pending.promise : Promise.resolve([row()]));
    await h.controller.open(); h.controller.toggle(row()._id); const added = h.controller.add(); h.change(change, false); // Simulate latest committed scope updating before passive effects.
    pending.resolve([row()]); await added; expect(h.append).not.toHaveBeenCalled(); h.controller.scopeChanged(); expect(h.controller.getSnapshot().phase).toBe("closed");
  });
  it("aborts closed/unmounted reads and ignores a previously resolved generation", async () => {
    const first = deferred<unknown>(), second = deferred<unknown>(); let n = 0;
    const h = harness([row()], () => ++n === 1 ? first.promise : second.promise);
    const opened = h.controller.open(), oldSignal = h.requests.mock.calls[0][0].signal; h.controller.close(); expect(oldSignal.aborted).toBe(true);
    const reopened = h.controller.open(); second.resolve([row(2)]); await reopened; first.resolve([row(1)]); await opened; expect(h.controller.getSnapshot().rows[0]._id).toBe(row(2)._id);
    h.controller.close(); const pending = h.controller.open(); const signal = h.requests.mock.calls.at(-1)![0].signal; h.controller.dispose(); expect(signal.aborted).toBe(true); await pending;
  });
  it("has fixed permission/error/empty feedback and retry while never retaining raw errors", async () => {
    let failure = true; const h = harness([], async () => { if (failure) throw { statusCode: 403, private: "never-project-canary" }; return []; });
    await h.controller.open(); expect(h.controller.getSnapshot()).toMatchObject({ phase: "error", error: "permission", rows: [] }); expect(JSON.stringify(h.controller.getSnapshot())).not.toContain("never-project");
    failure = false; await h.controller.open(); expect(h.controller.getSnapshot()).toMatchObject({ phase: "ready", rows: [] });
  });
  it("never loads or patches readOnly/malformed scopes", async () => {
    const h = harness(); h.change({ readOnly: true }); await h.controller.open(); expect(h.requests).not.toHaveBeenCalled(); h.change({ readOnly: false, value: {} }); await h.controller.open(); expect(h.requests).not.toHaveBeenCalled();
  });
});


describe("explicit older-image UTC search", () => {
  it("parses minute fields without machine-local time or the Date.UTC year0..99 adjustment", () => {
    const before = process.env.TZ;
    try {
      for (const tz of ["Pacific/Kiritimati", "America/Los_Angeles"]) {
        process.env.TZ = tz;
        for (const value of ["0001-01-01T00:00", "0099-12-31T23:59", "2024-02-29T00:00", "9999-12-31T23:59"]) expect(existingImageCutoff(value)).toBe(`${value}:00.000Z`);
        expect(existingImageCutoff("")).toBeUndefined();
        for (const bad of ["2026-02-29T00:00", "2026-02-31T00:00", "2026-01-01T24:00", "2026-01-01T00:60", "0000-01-01T00:00", "2026-13-01T00:00", "2026-01-00T00:00", "2026-01-01T00:00Z", "2026-01-01T00:00:00", " 2026-01-01T00:00", "2026-01-01T00:00\n", "+100000-01-01T00:00", "２０２６-01-01T00:00", "x".repeat(1000)]) expect(() => existingImageCutoff(bad)).toThrow("invalid-cutoff");
      }
    } finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; }
  });
  it("executes the real fixed GROQ with strict instant boundaries, mixed precision, eligibility and257-row bound", async () => {
    const before = "2026-01-01T12:00:00.000Z";
    const older = Array.from({ length: 260 }, (_, i) => ({ ...asset(i + 1), _createdAt: "2026-01-01T11:59:00Z" }));
    const mixed = [{ ...asset(400), _createdAt: "2026-01-01T11:59:00.999Z" }, { ...asset(401), _createdAt: "2026-01-01T11:59:00.000Z" }];
    const dataset = [...older, ...mixed, { ...asset(500), _createdAt: before }, { ...asset(501), _createdAt: "2026-01-01T12:00:00Z" },
      { _id: "drafts.restricted", _type: "media", privateOnly: true, image: { asset: { _ref: asset(1)._id } } }];
    const result = parseExistingClientImages(await query(dataset, EXISTING_IMAGES_BEFORE_QUERY, { before }), 257, true);
    expect(result).toHaveLength(257); expect(result[0]._id).toBe(asset(400)._id);
    expect(result.map(x => x._id)).not.toContain(asset(1)._id); expect(result.every(x => Date.parse(x._createdAt) < Date.parse(before))).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/never-project|never-fetch|originalFilename/);
  // AB#377: evaluates the real GROQ query over ~260 documents, which neared or
  // exceeded the default 5 s limit under the full parallel suite.
  }, 20_000);
  it("selects an older alreadyexisting set through the actual query and appends its chosen order once", async () => {
    const old = [1, 2].map(n => ({ ...asset(n), _createdAt: "2025-01-01T00:00:00Z" }));
    const dataset = [...old, ...Array.from({ length: 300 }, (_, i) => asset(1000 + i))];
    const h = harness([], request => query(dataset, request.query, request.ids ? { ids: request.ids } : request.before ? { before: request.before } : {}));
    expect(h.requests).not.toHaveBeenCalled(); await h.controller.open();
    expect(h.controller.getSnapshot().rows.map(x => x._id)).not.toContain(asset(1)._id);
    h.controller.toggle(h.controller.getSnapshot().rows[0]._id);
    h.controller.changeCutoff("2026-01-01T00:00");
    expect(h.controller.getSnapshot()).toMatchObject({ phase: "idle", cutoff: "2026-01-01T00:00", selected: [], rows: [], selectionCleared: true });
    expect(h.requests).toHaveBeenCalledTimes(1);
    await h.controller.open(); expect(h.requests.mock.calls[1][0]).toMatchObject({ query: EXISTING_IMAGES_BEFORE_QUERY, before: "2026-01-01T00:00:00.000Z" });
    expect(h.controller.getSnapshot().rows.map(x => x._id)).toEqual(old.map(x => x._id));
    h.controller.toggle(asset(2)._id); h.controller.toggle(asset(1)._id); await h.controller.add();
    expect(h.append).toHaveBeenCalledOnce(); expect(h.append.mock.calls[0][0].map((x: { image: { asset: { _ref: string } } }) => x.image.asset._ref)).toEqual([asset(2)._id, asset(1)._id]);
    expect(h.requests.mock.calls.at(-1)![0]).toMatchObject({ query: SELECTED_EXISTING_IMAGES_QUERY, ids: [asset(2)._id, asset(1)._id] });
    expect(h.requests.mock.calls.at(-1)![0]).not.toHaveProperty("before");
  // AB#377: evaluates the real GROQ query over 302 documents (~3 s alone), so the
  // default 5 s limit was hit under the full parallel suite. The size is the point:
  // the older set must fall outside the newest page.
  }, 20_000);
  it("refuses malformed and partial-native input before IO and restores newest search when explicitly cleared", async () => {
    const h = harness(); await h.controller.open();
    for (const [value, partial] of [["2026-02-30T00:00", false], ["", true], ["2026", false], ["x".repeat(1000), false]] as const) {
      h.controller.changeCutoff(value, partial); await h.controller.open();
      expect(h.requests).toHaveBeenCalledTimes(1); expect(h.controller.getSnapshot()).toMatchObject({ phase: "idle", error: "cutoff", rows: [], selected: [] });
      expect(h.controller.getSnapshot().cutoff.length).toBeLessThanOrEqual(17);
    }
    h.controller.changeCutoff(""); await h.controller.open();
    expect(h.requests).toHaveBeenCalledTimes(2); expect(h.requests.mock.calls[1][0].query).toBe(EXISTING_IMAGES_QUERY); expect(h.requests.mock.calls[1][0]).not.toHaveProperty("before");
  });
  it("cancels loading on an edited cutoff and discards out-of-order results without extra reads", async () => {
    const first = deferred<unknown>(), second = deferred<unknown>(); let n = 0;
    const h = harness([], () => ++n === 1 ? first.promise : second.promise);
    const initial = h.controller.open(), signal = h.requests.mock.calls[0][0].signal;
    h.controller.changeCutoff("2026-01-01T00:00"); expect(signal.aborted).toBe(true); expect(h.requests).toHaveBeenCalledTimes(1);
    const next = h.controller.open(), latest = h.requests.mock.calls[1][0].signal;
    h.controller.changeCutoff("2026-01-01T00:00"); expect(latest.aborted).toBe(false); // Duplicate input events cannot cancel an active query.
    second.resolve([{ ...row(2), _createdAt: "2025-12-31T23:59:59.999Z" }]); await next;
    first.resolve([row(1)]); await initial; expect(h.controller.getSnapshot().rows[0]._id).toBe(row(2)._id);
    expect(h.controller.getSnapshot().cutoff).toBe("2026-01-01T00:00");
  });
  it("locks cutoff changes during adding and preserves fresh native scope/capacity checks", async () => {
    const pending = deferred<unknown>(), h = harness([row()], request => request.ids ? pending.promise : Promise.resolve([row()]));
    await h.controller.open(); h.controller.toggle(row()._id); const added = h.controller.add();
    h.controller.changeCutoff("2025-01-01T00:00"); expect(h.controller.getSnapshot()).toMatchObject({ phase: "adding", cutoff: "", selected: [row()._id] });
    h.change({ readOnly: true }); pending.resolve([row()]); await added; expect(h.append).not.toHaveBeenCalled(); expect(h.controller.getSnapshot().phase).toBe("closed");
  });
  it.each([{ documentId: "replacement" }, { readOnly: true }, { path: "other-dataset" }])("discards an older-batch response after scope changes %#", async change => {
    const pending = deferred<unknown>(), h = harness([], request => request.before ? pending.promise : Promise.resolve([]));
    await h.controller.open(); h.controller.changeCutoff("2026-01-01T00:00"); const loaded = h.controller.open();
    h.change(change); expect(h.requests.mock.calls[1][0].signal.aborted).toBe(true);
    pending.resolve([{ ...row(), _createdAt: "2025-01-01T00:00:00Z" }]); await loaded;
    expect(h.controller.getSnapshot()).toMatchObject({ phase: "closed", rows: [], selected: [], cutoff: "" }); expect(h.append).not.toHaveBeenCalled();
  });
  it("fails closed for a stub provider ignoring the cutoff, retries the same cutoff and bounds replacement batches", async () => {
    let broken = true;
    const h = harness([], async () => broken ? [row()] : Array.from({ length: 257 }, (_, i) => ({ ...row(i + 1), _createdAt: "2025-01-01T00:00:00Z" })));
    await h.controller.open(); h.controller.changeCutoff("2026-01-01T00:00"); await h.controller.open();
    expect(h.controller.getSnapshot()).toMatchObject({ phase: "error", error: "load", cutoff: "2026-01-01T00:00", rows: [] });
    broken = false; await h.controller.open(); expect(h.controller.getSnapshot()).toMatchObject({ phase: "ready", truncated: true }); expect(h.controller.getSnapshot().rows).toHaveLength(256);
    h.controller.changeCutoff("2026-02-01T00:00"); expect(h.controller.getSnapshot().rows).toEqual([]); await h.controller.open(); expect(h.controller.getSnapshot().rows).toHaveLength(256);
    expect(h.requests.mock.calls.slice(1).every(([r]) => r.query === EXISTING_IMAGES_BEFORE_QUERY && r.before !== undefined)).toBe(true);
  });
});
