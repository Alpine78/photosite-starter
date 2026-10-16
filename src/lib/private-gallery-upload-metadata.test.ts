import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openPrivateGalleryUploadPreparation, type PrivateGalleryUploadPlan } from "./private-gallery-upload";
import { collectPrivateGalleryUploadMetadata, PRIVATE_UPLOAD_METADATA_READ_TIMEOUT_MS, PRIVATE_UPLOAD_METADATA_PASS_TIMEOUT_MS } from "./private-gallery-upload-metadata";
import { createPrivateGalleryDeliveryDraftMemoryStore } from "./private-gallery-delivery-draft-store";
const NOW = new Date("2026-10-16T12:00:00Z");
const preview = { kind: "derivative", derivativeKind: "delivery-preview", nominalBytes: 1000, width: 1200, height: 800 } as const;
function plan(count = 1, proof = false) {
  return openPrivateGalleryUploadPreparation({ galleryId: "gallery-1", galleryKind: proof ? "proof" : "delivery", state: "draft", keyPrefix: "private",
    preparationId: "prep-1", now: NOW, manifest: Array.from({ length: count }, (_, index) => proof ? {
      ...preview, derivativeKind: "watermarked-proof", filename: `${index}.JPG`, mediaId: `media-${index}`,
    } : preview) });
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });
const collect = (uploadPlan: PrivateGalleryUploadPlan, head: Parameters<typeof collectPrivateGalleryUploadMetadata>[0]["reader"]["head"], extra: Partial<Parameters<typeof collectPrivateGalleryUploadMetadata>[0]> = {}) =>
  collectPrivateGalleryUploadMetadata({ plan: uploadPlan, keyPrefix: "private", reader: { head }, clock: () => new Date(), ...extra });

describe("bounded private upload metadata reads", () => {
  it.each([false, true])("returns only detached exact-key metadata in plan order (proof=%s)", async (proof) => {
    const upload = plan(12, proof);
    const metadata = { sizeBytes: 1000, etag: "multipart-etag-2", checksum: { algorithm: "sha256" as const, value: "provider-digest" } };
    const seen: string[] = [];
    let active = 0, peak = 0;
    const result = collect(upload, ({ objectKey }) => new Promise((resolve) => {
      seen.push(objectKey); active++; peak = Math.max(active, peak);
      setTimeout(() => { active--; resolve(metadata); }, 12 - upload.objects.findIndex((item) => item.objectKey === objectKey));
    }));
    await vi.runAllTimersAsync();
    const observations = await result;
    expect(observations.map((item) => item.objectKey)).toEqual(upload.objects.map((item) => item.objectKey));
    expect(peak).toBe(8);
    expect(seen).toHaveLength(12);
    metadata.checksum.value = "mutated";
    expect(observations.every((item) => item.checksum?.value === "provider-digest")).toBe(true);
    expect(Object.isFrozen(observations)).toBe(true);
    expect(Object.isFrozen(observations[0])).toBe(true);
    expect(Object.isFrozen(observations[0].checksum)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("omits only definitive not-found metadata and leaves an incomplete store preparation unready", async () => {
    const store = createPrivateGalleryDeliveryDraftMemoryStore();
    const draft = await store.create({}, NOW);
    const upload = await store.openFirstPreparation({ handle: draft.gallery.galleryHandle, expectedRevision: 0, manifest: [preview, { kind: "zip", nominalBytes: 100000 }], keyPrefix: "private", now: NOW });
    const observations = await collect(upload, async ({ objectKey }) => objectKey.includes("/zip/") ? undefined : { sizeBytes: 1000 });
    expect(observations).toHaveLength(1);
    const completion = { handle: draft.gallery.galleryHandle, expectedRevision: 1, preparationId: upload.preparation.preparationId, receipts: [], now: NOW };
    expect(await store.completeFirstPreparation({ ...completion, observations })).toMatchObject({ ready: false, failures: [{ reason: "missing" }] });
    const full = await collect(upload, async ({ objectKey }) => ({ sizeBytes: objectKey.includes("/zip/") ? 100000 : 1000 }));
    expect((await store.completeFirstPreparation({ ...completion, observations: full })).ready).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([null, [], {}, { sizeBytes: -1 }, { sizeBytes: NaN }, { sizeBytes: 1, etag: "x".repeat(513) },
    { sizeBytes: 1, checksum: { algorithm: "md5", value: "not-supported" } }, { sizeBytes: 1, objectKey: "foreign-key" }])("rejects malformed or key-echoing reader DTO %j", async (value) => {
    await expect(collect(plan(), async () => value as never)).rejects.toMatchObject({ reason: "invalid-metadata" });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("redacts synchronous and asynchronous transport refusals rather than mapping ambiguity to absence", async () => {
    for (const asyncFailure of [false, true]) {
      const upload = plan(20);
      const secret = `${upload.objects[0].objectKey} client@example.test`;
      const head = vi.fn(() => { if (asyncFailure) return Promise.reject(new Error(secret)); throw new Error(secret); });
      let error: unknown;
      try { await collect(upload, head); } catch (caught) { error = caught; }
      expect(error).toMatchObject({ reason: "reader-failed" });
      expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(secret);
      expect((error as Error).cause).toBeUndefined();
      expect(head.mock.calls.length).toBeLessThanOrEqual(8);
      expect(vi.getTimerCount()).toBe(0);
    }
  });
  it("terminates after an uncooperative timeout without admitting a ninth read or leaking late rejections", async () => {
    const rejectors: ((error: Error) => void)[] = [];
    const head = vi.fn(() => new Promise<never>((_resolve, reject) => { rejectors.push(reject); }));
    const result = collect(plan(30), head);
    const refusal = expect(result).rejects.toMatchObject({ reason: "read-timeout" });
    await vi.advanceTimersByTimeAsync(PRIVATE_UPLOAD_METADATA_READ_TIMEOUT_MS);
    await refusal;
    expect(head).toHaveBeenCalledTimes(8);
    expect(vi.getTimerCount()).toBe(0);
    for (const reject of rejectors) reject(new Error("late private key/provider response"));
    await Promise.resolve(); await Promise.resolve();
    expect(head).toHaveBeenCalledTimes(8);
  });
  it("caps the whole pass even when each individual read stays below its timeout", async () => {
    const head = vi.fn(({ signal }: { signal: AbortSignal }) => new Promise<{ sizeBytes: number }>((resolve, reject) => {
      const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve({ sizeBytes: 1000 }); }, 4000);
      const cancel = () => { clearTimeout(timer); reject(new Error("abort provider secret")); };
      signal.addEventListener("abort", cancel, { once: true });
    }));
    const result = collect(plan(100), head);
    const refusal = expect(result).rejects.toMatchObject({ reason: "pass-timeout" });
    await vi.advanceTimersByTimeAsync(PRIVATE_UPLOAD_METADATA_PASS_TIMEOUT_MS);
    await refusal;
    expect(head.mock.calls.length).toBeLessThan(100);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("ignores caller abort reasons, stops admission and removes all timers", async () => {
    const controller = new AbortController();
    const head = vi.fn(() => new Promise<never>(() => {}));
    const result = collect(plan(30), head, { signal: controller.signal });
    const refusal = expect(result).rejects.toMatchObject({ reason: "aborted" });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort("private-client@example.test");
    await refusal;
    expect(head).toHaveBeenCalledTimes(8);
    expect(vi.getTimerCount()).toBe(0);
    head.mockClear();
    await expect(collect(plan(), head, { signal: controller.signal })).rejects.toMatchObject({ reason: "aborted" });
    expect(head).not.toHaveBeenCalled();
  });
  it("refuses wrong scope, duplicate plans and expired preparations before any read", async () => {
    const upload = plan(2);
    const head = vi.fn(async () => ({ sizeBytes: 1000 }));
    for (const change of [
      { objects: [upload.objects[0], upload.objects[0]] },
      { galleryKind: "proof" }, { objects: [] },
      { objects: [{ ...upload.objects[0], objectKey: upload.objects[0].objectKey.replace("gallery-1", "gallery-10") }, upload.objects[1]] },
    ]) await expect(collect({ ...upload, ...change } as PrivateGalleryUploadPlan, head)).rejects.toMatchObject({ reason: "invalid-plan" });
    await expect(collect(upload, head, { keyPrefix: "private-other" })).rejects.toMatchObject({ reason: "invalid-plan" });
    await expect(collect(upload, head, { clock: () => upload.preparation.deadline })).rejects.toMatchObject({ reason: "preparation-expired" });
    expect(head).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("refuses a backward or expired wall-clock sample after metadata returns", async () => {
    for (const backward of [true, false]) {
      const upload = plan(); let wall = NOW;
      const result = collect(upload, async () => { wall = backward ? new Date(NOW.getTime() - 1) : upload.preparation.deadline; return { sizeBytes: 1000 }; }, { clock: () => wall });
      await expect(result).rejects.toMatchObject({ reason: backward ? "invalid-time" : "preparation-expired" });
      expect(vi.getTimerCount()).toBe(0);
    }
  });
});
