import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRemoteZipDeclaration, REMOTE_ZIP_MAX_BYTES, verifyRemoteDeliveryZip } from "./delivery-zip-remote-integrity.mts";

const data = Buffer.from("synthetic complete file bytes; no format or eligibility claim");
const digest = (kind: "sha1" | "sha256", bytes: Uint8Array) => createHash(kind).update(bytes).digest("hex");
const sha1 = digest("sha1", data), sha256 = digest("sha256", data);
const declaration = () => ({ projectId: "synthetic-project", dataset: "production", assetId: `file-${sha1}-zip`, bytes: data.length, sha256 });
function response(body: BodyInit | ReadableStream<Uint8Array> | null = data, headers: Record<string, string> = {}) {
  return new Response(body, { headers: { "content-type": "application/zip", "content-disposition": 'attachment; filename="photographs.zip"', ...headers } });
}
function verify(fetcher: typeof fetch, input: unknown = declaration(), timeoutMs = 1000) {
  return verifyRemoteDeliveryZip(input, { fetchImplementation: fetcher, timeoutMs });
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("whole Sanity ZIP byte agreement", () => {
  it("builds only the own canonical asset URL and never sends authentication, Range or transforms", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(data, { "content-length": String(data.length) }));
    const report = await verify(fetcher);
    expect(report.status).toBe("matched");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe(`https://cdn.sanity.io/files/synthetic-project/production/${sha1}.zip?dl=photographs.zip`);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "GET", redirect: "manual", credentials: "omit", headers: { "accept-encoding": "identity" } });
    expect(Object.keys(fetcher.mock.calls[0][1]!.headers!)).toEqual(["accept-encoding"]);
    expect(fetcher.mock.calls[0][1]!.signal!.aborted).toBe(true);
    expect(report.readyToPublish).toBe(false);
    expect(Object.keys(report)).toEqual(["version", "status", "result", "declarationDigest", "readyToPublish", "limitations"]);
    expect(report.declarationDigest).toMatch(/^[a-f0-9]{64}$/u);
    for (const value of [sha1, sha256, "synthetic-project", "https://", "sourceLocator"]) expect(JSON.stringify(report)).not.toContain(value);
    expect(report.limitations).toContain("local-manifest-authority-unproven");
  });
  it("binds the closed declaration without exposing target identities and normalizes hash casing", async () => {
    const check = (input: unknown) => verify(vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 })), input);
    const original = await check(declaration());
    expect((await check({ ...declaration(), sha256: sha256.toUpperCase() })).declarationDigest).toBe(original.declarationDigest);
    for (const patch of [{ projectId: "other-project" }, { dataset: "other" }, { assetId: `file-${"0".repeat(40)}-zip` },
      { bytes: data.length + 1 }, { sha256: "0".repeat(64) }]) {
      expect((await check({ ...declaration(), ...patch })).declarationDigest).not.toBe(original.declarationDigest);
    }
  });
  it("accepts absent length and compatible MIME casing/parameters with identity encoding", async () => {
    expect((await verify(vi.fn<typeof fetch>().mockResolvedValue(response(data, {
      "content-type": "Application/X-Zip-Compressed; charset=binary", "content-encoding": "identity",
    })))).status).toBe("matched");
    expect(parseRemoteZipDeclaration({ ...declaration(), sha256: sha256.toUpperCase() }).sha256).toBe(sha256);
  });
  it.each([
    { projectId: "../other" }, { projectId: "https://other.test" }, { projectId: "a".repeat(64) }, { projectId: "Uppercase" },
    { dataset: "../production" }, { dataset: "x?token=PRIVATE" }, { dataset: "a".repeat(65) }, { dataset: "-test" },
    { assetId: `file-${sha1}-jpg` }, { assetId: `file-${sha1.toUpperCase()}-zip` }, { assetId: `file-${sha1}-zip?dl=PRIVATE` },
    { bytes: 0 }, { bytes: -1 }, { bytes: 1.5 }, { bytes: NaN }, { bytes: Infinity }, { bytes: "100" }, { bytes: REMOTE_ZIP_MAX_BYTES + 1 },
    { sha256: "x".repeat(64) }, { sha256: "0".repeat(65) }, { url: "https://other.test/PRIVATE" },
  ])("refuses malformed or extra fields before fetch: %j", async (patch) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(verify(fetcher, { ...declaration(), ...patch })).rejects.toThrow("[remote-zip] INVALID_INPUT");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("refuses missing, inherited, accessor, symbol and proxy fields without reflecting or executing them", async () => {
    const getter = vi.fn(() => { throw new Error("PRIVATE_ACCESSOR"); });
    const accessor = Object.defineProperty(declaration(), "bytes", { get: getter });
    const missing = { ...declaration() } as Partial<ReturnType<typeof declaration>>; delete missing.bytes;
    const proxy = new Proxy({}, { getPrototypeOf() { throw new Error("PRIVATE_PROXY"); } });
    const fetcher = vi.fn<typeof fetch>();
    for (const input of [null, [], missing, Object.create(declaration()), accessor, { ...declaration(), [Symbol("PRIVATE")]: 1 }, proxy]) {
      await expect(verify(fetcher, input)).rejects.toThrow("[remote-zip] INVALID_INPUT");
    }
    expect(getter).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([201, 204, 206, 301, 302, 307, 308, 401, 403, 404, 413, 500])("never follows or approves HTTP %s", async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status, headers: { location: "https://other.test/PRIVATE" } }));
    const report = await verify(fetcher);
    expect(report.status).toBe("unverified");
    expect(report.result).toEqual(status === 404 ? { status: "absent", httpStatus: 404 } : { status: "failed", code: "http", httpStatus: status });
    expect(fetcher).toHaveBeenCalledOnce(); expect(JSON.stringify(report)).not.toContain("PRIVATE");
  });
  it.each<Record<string, string>>([
    { "content-length": "1" }, { "content-length": String(data.length - 1) }, { "content-length": String(data.length + 1) },
    { "content-length": `0${data.length}` }, { "content-length": "1e3" }, { "content-length": "0" },
    { "content-encoding": "gzip" }, { "content-type": "application/octet-stream" }, { "content-type": "text/html" },
    { "content-disposition": "inline" }, { "content-disposition": "attachmentish" },
  ])("refuses incompatible headers: %j", async (headers) => {
    expect((await verify(vi.fn<typeof fetch>().mockResolvedValue(response(data, headers)))).result).toEqual({ status: "failed", code: "headers" });
  });
  it("refuses missing MIME, attachment and body", async () => {
    for (const missing of ["content-type", "content-disposition"]) {
      const saved = response(); saved.headers.delete(missing);
      expect((await verify(vi.fn<typeof fetch>().mockResolvedValue(saved))).result.code).toBe("headers");
    }
    expect((await verify(vi.fn<typeof fetch>().mockResolvedValue(response(null)))).result.code).toBe("headers");
  });
  it.each([data.subarray(1), Buffer.concat([data, Buffer.from([0])])])("refuses truncated or extra bytes", async (body) => {
    expect((await verify(vi.fn<typeof fetch>().mockResolvedValue(response(body)))).result.code).toBe("bytes");
  });
  it("checks both SHA256 and asset SHA1 even when the length agrees", async () => {
    for (const patch of [{ sha256: "0".repeat(64) }, { assetId: `file-${"0".repeat(40)}-zip` }]) {
      expect((await verify(vi.fn<typeof fetch>().mockResolvedValue(response()), { ...declaration(), ...patch })).result.code).toBe("digest");
    }
    expect((await verify(vi.fn<typeof fetch>().mockResolvedValue(response(Buffer.alloc(data.length))))).result.code).toBe("digest");
  });
  it("admits the exact 1GB declaration but rejects missing bytes, without allocating a GB", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(new Uint8Array(), { "content-length": String(REMOTE_ZIP_MAX_BYTES) }));
    expect((await verify(fetcher, { ...declaration(), bytes: REMOTE_ZIP_MAX_BYTES })).result.code).toBe("bytes");
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("streams a whole 128MiB object from a reused 64KiB chunk with bounded read-ahead", async () => {
    const chunk = new Uint8Array(64 * 1024).fill(71), count = 2048;
    const hash1 = createHash("sha1"), hash256 = createHash("sha256");
    for (let i = 0; i < count; i++) { hash1.update(chunk); hash256.update(chunk); }
    const expected1 = hash1.digest("hex"), expected256 = hash256.digest("hex");
    let pulls = 0, queued = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) {
      if (pulls === count) { controller.close(); return; }
      pulls++; controller.enqueue(chunk); queued = Math.max(queued, -(controller.desiredSize ?? 0));
    } }, { highWaterMark: 0 });
    const saved = response(stream, { "content-length": String(count * chunk.length) });
    const wholeBuffer = vi.spyOn(saved, "arrayBuffer").mockRejectedValue(new Error("whole-buffer-forbidden"));
    const report = await verify(vi.fn<typeof fetch>().mockResolvedValue(saved), {
      ...declaration(), assetId: `file-${expected1}-zip`, bytes: count * chunk.length, sha256: expected256,
    }, 30_000);
    expect(report.status).toBe("matched"); expect(pulls).toBe(count); expect(queued).toBeLessThanOrEqual(1);
    expect(wholeBuffer).not.toHaveBeenCalled(); expect(stream.locked).toBe(false);
  });
  it("releases distinct streamed chunks while the shared deadline is still pending", () => {
    // A reused chunk cannot reveal retention by reactions attached to a shared deadline promise.
    // Measure in a separate real Node process so GC and buffer accounting stay isolated.
    const script = `
      import { createHash } from 'node:crypto';
      import { setImmediate } from 'node:timers/promises';
      const { verifyRemoteDeliveryZip } = await import(process.argv[1]);
      const count = 2048, size = 65536;
      const h1 = createHash('sha1'), h256 = createHash('sha256');
      for (let i = 0; i < count; i++) {
        const bytes = Buffer.alloc(size, i % 251); h1.update(bytes); h256.update(bytes);
      }
      async function collect() {
        // Let promise jobs and V8's backing-store sweep finish between collections.
        for (let turn = 0; turn < 3; turn++) { await setImmediate(); global.gc(); }
        await setImmediate();
      }
      await collect();
      const before = process.memoryUsage().arrayBuffers;
      let index = 0, retained = 0;
      const stream = new ReadableStream({ async pull(controller) {
        if (index > 0 && index % 512 === 0) {
          await collect();
          retained = Math.max(retained, process.memoryUsage().arrayBuffers - before);
        }
        if (index === count) { controller.close(); return; }
        controller.enqueue(Buffer.alloc(size, index++ % 251));
      } }, { highWaterMark: 0 });
      const result = await verifyRemoteDeliveryZip({ projectId: 'synthetic-project', dataset: 'production',
        assetId: 'file-' + h1.digest('hex') + '-zip', bytes: count * size, sha256: h256.digest('hex') }, {
        timeoutMs: 30000,
        fetchImplementation: async () => new Response(stream, { headers: {
          'content-type': 'application/zip', 'content-disposition': 'attachment',
        } }),
      });
      console.log(JSON.stringify({ status: result.status, retained, bytes: index * size }));
    `;
    const actual = JSON.parse(execFileSync(process.execPath, ["--expose-gc", "--input-type=module", "-e", script,
      new URL("./delivery-zip-remote-integrity.mts", import.meta.url).href], { encoding: "utf8", timeout: 45_000 }));
    expect(actual.status).toBe("matched");
    expect(actual.bytes).toBe(128 * 1024 * 1024);
    expect(actual.retained).toBeLessThan(16 * 1024 * 1024);
  }, 50_000);
  it("cancels a rejected or excessive body without waiting for stuck cleanup", async () => {
    for (const rejectHeaders of [true, false]) {
      const cancel = vi.fn(() => new Promise<void>(() => {}));
      const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(data.length + 1)); }, cancel }, { highWaterMark: 0 });
      const report = await verify(vi.fn<typeof fetch>().mockResolvedValue(response(stream, rejectHeaders ? { "content-type": "text/html" } : {})));
      expect(report.result.code).toBe(rejectHeaders ? "headers" : "bytes"); expect(cancel).toHaveBeenCalledOnce();
      expect(stream.locked).toBe(false);
    }
  });
  it("shares one total deadline across headers and a stalled body", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => resolve(response(new ReadableStream({ pull() {}, cancel }))), 6);
    }));
    const pending = verify(fetcher, declaration(), 10);
    await vi.advanceTimersByTimeAsync(11);
    expect((await pending).result.code).toBe("request"); expect(cancel).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1]!.signal!.aborted).toBe(true);
  });
  it("cancels a late header response after the total deadline", async () => {
    vi.useFakeTimers(); let resolve!: (r: Response) => void;
    const cancel = vi.fn(), fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise((r) => { resolve = r; }));
    const pending = verify(fetcher, declaration(), 10); await vi.advanceTimersByTimeAsync(11);
    expect((await pending).result.code).toBe("request");
    resolve(response(new ReadableStream({ cancel })));
    await Promise.resolve(); await Promise.resolve(); expect(cancel).toHaveBeenCalledOnce();
  });
  it("enforces time even if an endless source resolves empty chunks immediately", async () => {
    let clock = 0, pulls = 0; const cancel = vi.fn();
    vi.spyOn(performance, "now").mockImplementation(() => clock++);
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { pulls++; controller.enqueue(new Uint8Array()); }, cancel }, { highWaterMark: 0 });
    expect((await verify(vi.fn<typeof fetch>().mockResolvedValue(response(stream)), declaration(), 10)).result.code).toBe("request");
    expect(pulls).toBeLessThan(20); expect(cancel).toHaveBeenCalledOnce();
  });
  it("refuses late headers even if immediate completion prevented the timer callback", async () => {
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      clock = 11; return new Response(null, { status: 404 });
    });
    expect((await verify(fetcher, declaration(), 10)).result).toEqual({ status: "failed", code: "request" });
    expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher.mock.calls[0][1]!.signal!.aborted).toBe(true);
  });
  it("redacts fetch and reader exceptions", async () => {
    const failedBody = new ReadableStream<Uint8Array>({ pull() { throw new Error("PRIVATE_PROVIDER_BODY"); } });
    for (const fetcher of [vi.fn<typeof fetch>().mockRejectedValue(new Error("PRIVATE_TOKEN")), vi.fn<typeof fetch>().mockResolvedValue(response(failedBody))]) {
      const report = await verify(fetcher); expect(report.result.code).toBe("request"); expect(JSON.stringify(report)).not.toContain("PRIVATE");
    }
  });
  it.each([0, -1, NaN, Infinity, 330_001, 1.5])("refuses invalid deadline %s before fetch", async (timeoutMs) => {
    const fetcher = vi.fn<typeof fetch>(); await expect(verify(fetcher, declaration(), timeoutMs)).rejects.toThrow("INVALID_INPUT");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
