import { createHash, createHmac } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createPrivateGalleryS3MetadataReader } from "./private-gallery-s3-metadata";
import { buildPrivateGalleryObjectKey } from "./private-gallery-object-key";
import { snapshotPrivateGalleryObjectStoreConfig } from "./private-gallery-config";
import { collectPrivateGalleryUploadMetadata, PRIVATE_UPLOAD_METADATA_READ_TIMEOUT_MS } from "./private-gallery-upload-metadata";
import { openPrivateGalleryUploadPreparation } from "./private-gallery-upload";
import { verifyPrivateGalleryUpload } from "./private-gallery-upload-completion";
import { PRIVATE_GALLERY_DEFAULT_MAX_DERIVATIVE_BYTES, PRIVATE_GALLERY_DEFAULT_MAX_ZIP_BYTES } from "./private-gallery-limits";

const NOW = new Date("2026-10-16T12:00:00Z");
const config = { endpoint: "https://objects.example.test", bucket: "private.photos", region: "auto", keyPrefix: "private/photos",
  verifierAccessKeyId: "VERIFIER_TEST_KEY", verifierSecretAccessKey: "synthetic-verifier-secret" };
const objectKey = "private/photos/g/gallery-1/proof/AAAAAAAAAAAAAAAAAAAAAA";
const response = (status = 200, headers: HeadersInit = { "content-length": "1000", etag: '"opaque-multipart-2"' }) => new Response(null, { status, headers });
function setup(result: Response | (() => Promise<Response>) = response(), overrides = {}) {
  const request = vi.fn<typeof fetch>(async () => typeof result === "function" ? result() : result);
  return { request, reader: createPrivateGalleryS3MetadataReader({ ...config, ...overrides }, { fetch: request, now: () => new Date(NOW) }) };
}
const head = (reader: ReturnType<typeof createPrivateGalleryS3MetadataReader>, key = objectKey, signal = new AbortController().signal) => reader.head({ objectKey: key, signal });
afterEach(() => { vi.useRealTimers(); });

it.each(["https://objects.example.test", "https://objects.example.test:443", "https://objects.example.test:9443"])("signs only the exact HEAD request at normalized origin %s", async (endpoint) => {
  const { reader, request } = setup(response(), { endpoint });
  expect(await head(reader)).toEqual({ sizeBytes: 1000, etag: '"opaque-multipart-2"' });
  expect(request).toHaveBeenCalledTimes(1);
  const [input, options] = request.mock.calls[0];
  const url = new URL(String(input));
  expect(url.origin).toBe(new URL(endpoint).origin);
  expect(url.pathname).toBe(`/private.photos/${objectKey}`);
  expect(url.search).toBe(""); expect(url.hash).toBe("");
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const hmac = (key: string | Buffer, value: string) => createHmac("sha256", key).update(value).digest();
  // Independent serialization and crypto, not the implementation's signing helpers.
  // This is a HEAD regression vector, not an AWS-published HEAD example.
  const empty = hash("");
  const canonical = `HEAD\n/private.photos/${objectKey}\n\nhost:${url.host}\nx-amz-content-sha256:${empty}\nx-amz-date:20261016T120000Z\n\nhost;x-amz-content-sha256;x-amz-date\n${empty}`;
  const key = hmac(hmac(hmac(hmac(`AWS4${config.verifierSecretAccessKey}`, "20261016"), "auto"), "s3"), "aws4_request");
  const signature = hmac(key, `AWS4-HMAC-SHA256\n20261016T120000Z\n20261016/auto/s3/aws4_request\n${hash(canonical)}`).toString("hex");
  expect(options).toEqual({ method: "HEAD", redirect: "error", cache: "no-store", signal: expect.any(AbortSignal), headers: {
    "accept-encoding": "identity", "x-amz-content-sha256": empty, "x-amz-date": "20261016T120000Z",
    authorization: `AWS4-HMAC-SHA256 Credential=${config.verifierAccessKeyId}/20261016/auto/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`,
  } });
});

it("detaches configuration and preserves optional ETag without projecting checksum/provider headers", async () => {
  const settings = { ...config };
  const request = vi.fn<typeof fetch>(async () => response(200, { "content-length": "0", "x-amz-checksum-sha256": "not-projected", "x-amz-meta-canary": "private" }));
  const reader = createPrivateGalleryS3MetadataReader(settings, { fetch: request, now: () => NOW });
  settings.endpoint = "https://other.example.test"; settings.verifierSecretAccessKey = "changed";
  expect(await head(reader)).toEqual({ sizeBytes: 0 });
  expect(String(request.mock.calls[0][0])).toContain(config.endpoint);
  expect(snapshotPrivateGalleryObjectStoreConfig(config)).toEqual(config);
});

it.each(["zip", "preview", "proof"] as const)("accepts generator-assigned %s keys and the exact per-kind byte bound", async (kind) => {
  const key = buildPrivateGalleryObjectKey({ keyPrefix: config.keyPrefix, galleryId: "gallery-1", kind });
  const maximum = kind === "zip" ? PRIVATE_GALLERY_DEFAULT_MAX_ZIP_BYTES : PRIVATE_GALLERY_DEFAULT_MAX_DERIVATIVE_BYTES;
  expect(await head(setup(response(200, { "content-length": String(maximum) })).reader, key)).toEqual({ sizeBytes: maximum });
  await expect(head(setup(response(200, { "content-length": String(maximum + 1) })).reader, key)).rejects.toMatchObject({ reason: "invalid-metadata" });
});

it.each(["elsewhere/g/gallery-1/proof/AAAAAAAAAAAAAAAAAAAAAA", `${objectKey}?x=1`, `${objectKey}#x`, `${objectKey}%2f`,
  objectKey.replace("/gallery-1/", "/../"), objectKey.replace("/proof/", "/original/"), objectKey.replace("/g/", "/"),
  objectKey.replace("gallery-1", "GALLERY"), objectKey.replace("gallery-1", "g\\a"), objectKey + "\n", objectKey + "/extra",
  objectKey.replace(/A$/, "B"), objectKey.slice(0, -1), "x".repeat(513)])("refuses malformed or unscoped key before a request: %j", async (key) => {
  const { reader, request } = setup();
  await expect(head(reader, key)).rejects.toMatchObject({ reason: "invalid-key" });
  expect(request).not.toHaveBeenCalled();
});

it.each([{ endpoint: "http://objects.example.test" }, { endpoint: "https://secret@objects.example.test" }, { endpoint: "https://objects.example.test/path" },
  { bucket: "../escape" }, { region: "auto/else" }, { keyPrefix: "../outside" }, { verifierAccessKeyId: "canary\nsecret" }, { verifierSecretAccessKey: "" }])("reuses configuration guards with redacted errors %j", (overrides) => {
  expect(() => setup(response(), overrides)).toThrow("[private-gallery-s3-metadata] invalid-config");
});

it.each(["", "01", "-1", "+1", "1.0", "1e3", "5, 5", "9007199254740992", "99999999999999999"])("refuses noncanonical length %j", async (length) => {
  await expect(head(setup(response(200, { "content-length": length })).reader)).rejects.toMatchObject({ reason: "invalid-metadata" });
});
it.each([{}, { "content-length": "1", etag: "" }, { "content-length": "1", etag: "x".repeat(513) },
  { "content-length": "1", "content-encoding": "gzip" }, { "content-length": "1", etag: "non-ascii-ä" }])("refuses incomplete or unbounded metadata %j", async (headers) => {
  await expect(head(setup(response(200, headers as HeadersInit)).reader)).rejects.toMatchObject({ reason: "invalid-metadata" });
});
it("accepts explicit identity encoding and only definitive 404 as absence", async () => {
  expect(await head(setup(response(200, { "content-length": "1", "content-encoding": "identity" })).reader)).toEqual({ sizeBytes: 1 });
  expect(await head(setup(response(404)).reader)).toBeUndefined();
});
it("redacts malformed response access and refuses a redirected success", async () => {
  const malformed = { status: 200, headers: { get() { throw new Error("private provider response"); } } } as unknown as Response;
  await expect(head(setup(malformed).reader)).rejects.toMatchObject({ reason: "invalid-metadata" });
  const redirected = { status: 200, redirected: true } as Response;
  await expect(head(setup(redirected).reader)).rejects.toMatchObject({ reason: "provider-refused" });
});
it.each([201, 204, 206, 301, 307, 400, 403, 405, 429, 500, 503])("refuses uncertain provider status %i", async (status) => {
  await expect(head(setup(response(status)).reader)).rejects.toMatchObject({ reason: "provider-refused" });
});

it("never reads a provider body and cancels it without delaying or leaking refusal details", async () => {
  const canary = `${objectKey} ${config.verifierSecretAccessKey} https://private.example.test Signature=private`;
  const cancel = vi.fn(async () => { throw new Error(canary); });
  const body = { cancel };
  const text = vi.fn(() => { throw new Error(canary); });
  const result = { status: 403, body, headers: new Headers(), text, json: text, arrayBuffer: text } as unknown as Response;
  const { reader } = setup(result);
  let caught: unknown;
  try { await head(reader); } catch (error) { caught = error; }
  expect(caught).toMatchObject({ reason: "provider-refused" });
  expect((caught as Error).cause).toBeUndefined();
  for (const value of [objectKey, config.verifierSecretAccessKey, "Signature=private", "https://private.example.test"]) {
    expect(String(caught) + JSON.stringify(caught)).not.toContain(value);
  }
  expect(cancel).toHaveBeenCalledOnce(); expect(text).not.toHaveBeenCalled();
  const transport = setup(async () => { throw new Error(canary); });
  await expect(head(transport.reader)).rejects.toMatchObject({ reason: "request-failed" });
});

it("propagates the mandatory signal and refuses pre-aborted, aborted late and invalid clocks", async () => {
  const controller = new AbortController(); controller.abort("private canary");
  const { reader, request } = setup();
  await expect(head(reader, objectKey, controller.signal)).rejects.toMatchObject({ reason: "aborted" });
  await expect(reader.head({ objectKey, signal: undefined as never })).rejects.toMatchObject({ reason: "invalid-signal" });
  expect(request).not.toHaveBeenCalled();
  const late = new AbortController();
  const fetcher = vi.fn<typeof fetch>(async (_url, options) => { expect(options?.signal).toBe(late.signal); late.abort("secret"); return response(); });
  await expect(head(createPrivateGalleryS3MetadataReader(config, { fetch: fetcher, now: () => NOW }), objectKey, late.signal)).rejects.toMatchObject({ reason: "aborted" });
  for (const now of [() => new Date(NaN), () => new Date("+010000-01-01T00:00:00Z"), () => { throw new Error("secret"); }]) {
    await expect(head(createPrivateGalleryS3MetadataReader(config, { fetch: request, now }))).rejects.toMatchObject({ reason: "invalid-time" });
  }
  expect(request).not.toHaveBeenCalled();
});

it("composes with collector timeout and preserves checksum-required completion refusal", async () => {
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  const plan = openPrivateGalleryUploadPreparation({ galleryId: "gallery-1", galleryKind: "proof", state: "draft", keyPrefix: config.keyPrefix,
    preparationId: "prep-1", now: NOW, manifest: [{ kind: "derivative", derivativeKind: "watermarked-proof", nominalBytes: 1000,
      width: 1200, height: 800, filename: "proof.JPG", mediaId: "media-1" }] });
  const waiting = vi.fn<typeof fetch>((_url, options) => new Promise((_resolve, reject) => {
    options!.signal!.addEventListener("abort", () => reject(new Error("provider secret")), { once: true });
  }));
  const reader = createPrivateGalleryS3MetadataReader(config, { fetch: waiting, now: () => new Date() });
  const pending = collectPrivateGalleryUploadMetadata({ plan, keyPrefix: config.keyPrefix, reader, clock: () => new Date() });
  const refusal = expect(pending).rejects.toMatchObject({ reason: "read-timeout" });
  await vi.advanceTimersByTimeAsync(PRIVATE_UPLOAD_METADATA_READ_TIMEOUT_MS); await refusal;
  expect(waiting.mock.calls[0][1]?.signal?.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
  const observations = await collectPrivateGalleryUploadMetadata({ plan, keyPrefix: config.keyPrefix, reader: setup().reader, clock: () => NOW });
  expect(verifyPrivateGalleryUpload({ preparation: plan.preparation, expected: plan.objects, observations,
    receipts: [{ objectKey: plan.objects[0].objectKey, checksum: { algorithm: "sha256", value: "requires-independent-checksum" } }], keyPrefix: config.keyPrefix, now: NOW }))
    .toMatchObject({ verified: false, failures: [{ reason: "checksum-unavailable" }] });
});
