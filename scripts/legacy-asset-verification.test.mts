import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { buildLegacyImportPlan } from "./legacy-delivery-import-plan.mts";
import { verifyLegacyAssetBytes } from "./legacy-asset-verification.mts";

const now = Date.parse("2026-10-12T12:00:00Z"), data = Buffer.from("synthetic unchanged archive bytes");
const sha1 = createHash("sha1").update(data).digest("hex"), sha256 = createHash("sha256").update(data).digest("hex");
function fixture(zip = true) {
  const file = { sourceLocator: zip ? "files/synthetic.zip" : "images/synthetic.jpg", sha1, sha256, bytes: data.length };
  const image = { ...file, sourceLocator: "images/fixture.jpg", sha1: "1".repeat(40), sha256: "1".repeat(64), width: 3, height: 2, orientation: 1, alt: "" };
  const source = { version: 1, target: { projectId: "synthetic-project", dataset: "production" },
    sourceEvidence: { backupSha256: "a".repeat(64), availabilitySha256: "b".repeat(64), orderingSha256: "c".repeat(64), inventorySha256: "d".repeat(64) },
    excludedLegacyIds: [], galleries: [{ legacyId: 1, handle: "1".repeat(32), legacyPath: "/synthetic", availability: { mode: "indefinite" },
      images: [zip ? image : { ...file, width: 3, height: 2, orientation: 1, alt: "" }], zip: zip ? file : null }] };
  const reviewDigest = buildLegacyImportPlan(source, now).reviewDigest;
  const assets = source.galleries.flatMap((g) => [...g.images.map((i) => ({ sourceSha256: i.sha256, assetId: `image-${i.sha1}-3x2-jpg`,
    sha1: i.sha1, bytes: i.bytes, mimeType: "image/jpeg", width: 3, height: 2, orientation: 1 })),
    ...(g.zip ? [{ sourceSha256: sha256, assetId: `file-${sha1}-zip`, sha1, bytes: data.length, mimeType: "application/zip" }] : [])]);
  return { source, reviewDigest, bindings: { version: 1, target: source.target, reviewDigest, assets } };
}
function response(body: BodyInit | ReadableStream<Uint8Array> = data, headers: Record<string, string> = {}) {
  return new Response(body, { headers: { "content-type": "image/jpeg", ...headers } });
}
function verify(fetchImplementation: typeof fetch, timeoutMs = 1000, f = fixture(false)) {
  return verifyLegacyAssetBytes(f.source, f.reviewDigest, f.bindings, now, { fetchImplementation, timeoutMs });
}

describe("legacy CDN byte verification", () => {
  it("streams exact original bytes with GET only, no credentials, redirects or transforms", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(data, { "content-length": String(data.length) }));
    const report = await verify(fetcher);
    expect(report.status).toBe("matched");
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe(`https://cdn.sanity.io/images/synthetic-project/production/${sha1}-3x2.jpg`);
    expect(options).toMatchObject({ method: "GET", redirect: "manual", credentials: "omit", headers: { "accept-encoding": "identity" } });
    expect(JSON.stringify(options)).not.toMatch(/authorization|cookie|token/iu);
    expect(report.limitations).toContain("does-not-establish-supported-upload");
    expect(JSON.stringify(report)).not.toContain("sourceLocator");
  });
  it("verifies explicit original JPEG files with no image pipeline or ZIP attachment requirement", async () => {
    const f = fixture(false);
    Object.assign(f.bindings.assets[0], { kind: "file", assetId: `file-${sha1}-jpg` });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(data, { "content-length": String(data.length) }));
    const report = await verify(fetcher, 1000, f);
    expect(report.status).toBe("matched");
    expect(fetcher.mock.calls[0][0]).toBe(`https://cdn.sanity.io/files/synthetic-project/production/${sha1}.jpg`);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "GET", redirect: "manual", credentials: "omit" });
    expect(JSON.stringify(fetcher.mock.calls)).not.toMatch(/dl=|dlRaw|authorization|token/iu);
  });
  it("refuses altered original JPEG file bytes even when its asset identity is declared correctly", async () => {
    const f = fixture(false);
    Object.assign(f.bindings.assets[0], { kind: "file", assetId: `file-${sha1}-jpg` });
    expect((await verify(vi.fn<typeof fetch>().mockResolvedValue(response(Buffer.alloc(data.length))), 1000, f)).results[0].code).toBe("digest");
    expect((await verify(vi.fn<typeof fetch>().mockResolvedValue(response(data, { "content-type": "application/zip" })), 1000, f)).results[0].code).toBe("headers");
  });
  it("checks the runtime whole-ZIP link and attachment without splitting or recompression", async () => {
    const f = fixture(true);
    // Make image bytes/hash genuine too, and keep ZIP a distinct byte sequence.
    const imageBytes = Buffer.from("synthetic jpeg bytes");
    const i = f.source.galleries[0].images[0];
    i.sha1 = createHash("sha1").update(imageBytes).digest("hex"); i.sha256 = createHash("sha256").update(imageBytes).digest("hex"); i.bytes = imageBytes.length;
    const reviewDigest = buildLegacyImportPlan(f.source, now).reviewDigest;
    f.reviewDigest = reviewDigest; f.bindings.reviewDigest = reviewDigest;
    Object.assign(f.bindings.assets[0], { sourceSha256: i.sha256, sha1: i.sha1, bytes: i.bytes, assetId: `image-${i.sha1}-3x2-jpg` });
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => String(url).includes("/files/")
      ? response(data, { "content-type": "application/zip", "content-disposition": 'attachment; filename="photographs.zip"' }) : response(imageBytes));
    const report = await verify(fetcher, 1000, f);
    expect(report.status).toBe("matched");
    expect(fetcher.mock.calls.some(([url]) => url === `https://cdn.sanity.io/files/synthetic-project/production/${sha1}.zip?dl=photographs.zip`)).toBe(true);
  });
  it.each([301, 302, 403, 500])("does not follow or approve HTTP %s", async (status) => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response("private response", { status, headers: { location: "https://other.test/secret" } }));
    expect((await verify(f)).results).toEqual([{ status: "failed", code: "http", httpStatus: status }]);
    expect(f).toHaveBeenCalledOnce();
  });
  it("reports absence separately, with no invented provider or publication approval", async () => {
    expect((await verify(vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 })))).results).toEqual([{ status: "absent", httpStatus: 404 }]);
  });
  it.each<Record<string, string>>([{ "content-length": "1" }, { "content-length": "01" }, { "content-encoding": "gzip" }, { "content-type": "text/html" }])("refuses incompatible headers %j", async (headers) => {
    expect((await verify(vi.fn<typeof fetch>().mockResolvedValue(response(data, headers)))).results[0].code).toBe("headers");
  });
  it.each([Buffer.from("short"), Buffer.alloc(data.length + 1)])("refuses incomplete or excessive bodies", async (body) => {
    expect((await verify(vi.fn<typeof fetch>().mockResolvedValue(response(body)))).results[0].code).toBe("bytes");
  });
  it("refuses same-sized altered bytes", async () => {
    expect((await verify(vi.fn<typeof fetch>().mockResolvedValue(response(Buffer.alloc(data.length))))).results[0].code).toBe("digest");
  });
  it("cancels a body that stalls beyond the total deadline, without awaiting stuck cleanup", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({ pull() {}, cancel });
    const f = vi.fn<typeof fetch>().mockResolvedValue(response(body));
    const report = await verify(f, 15);
    expect(report.results[0]).toEqual({ status: "failed", code: "request" });
    expect(cancel).toHaveBeenCalledOnce(); expect(f.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it("cancels a late header response after timeout", async () => {
    let resolve!: (r: Response) => void;
    const cancel = vi.fn();
    const f = vi.fn<typeof fetch>().mockImplementation(() => new Promise((r) => { resolve = r; }));
    expect((await verify(f, 15)).results[0].code).toBe("request");
    resolve(response(new ReadableStream({ cancel })));
    await new Promise((r) => setTimeout(r, 0)); expect(cancel).toHaveBeenCalledOnce();
  });
  it("rejects malformed source/bindings/digest/clock before any request", async () => {
    const f = fixture(false), fetcher = vi.fn<typeof fetch>();
    for (const args of [[{}, f.reviewDigest, f.bindings, now], [f.source, "0".repeat(64), f.bindings, now], [f.source, f.reviewDigest, {}, now], [f.source, f.reviewDigest, f.bindings, NaN]] as const) {
      await expect(verifyLegacyAssetBytes(args[0], args[1], args[2], args[3], { fetchImplementation: fetcher })).rejects.toThrow();
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("never reflects injected network errors", async () => {
    const report = await verify(vi.fn<typeof fetch>().mockRejectedValue(new Error("TOKEN_PRIVATE")));
    expect(JSON.stringify(report)).not.toContain("TOKEN_PRIVATE");
  });
});
