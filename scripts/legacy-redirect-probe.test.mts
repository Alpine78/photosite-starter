import { afterEach, describe, expect, it, vi } from "vitest";
import { probeLegacyRedirect } from "./legacy-redirect-probe.mts";
const url = "https://example.test/legacy";
const response = (chunks: readonly Uint8Array[], status = 200) => new Response(new ReadableStream<Uint8Array>({ start(controller) {
  for (const chunk of chunks) controller.enqueue(chunk); controller.close();
} }), { status, headers: { "content-type": "text/html", location: "/target" } });
const run = (saved: Response, readHtml = true, maxBytes = 1000) => probeLegacyRedirect(url, readHtml, { fetchImplementation: vi.fn().mockResolvedValue(saved), maxBytes, timeoutMs: 100 });
afterEach(() => { vi.useRealTimers(); });
describe("legacy HTTP probe boundaries", () => {
  it("keeps status/header contracts and never follows redirects", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response([Buffer.from("body")], 302));
    expect(await probeLegacyRedirect(url, true, { fetchImplementation: fetcher })).toEqual({ status: 302, location: "/target", contentType: "text/html", html: "" });
    expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual", headers: { accept: "text/html" } });
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
  it("does not wait for stalled cancellation", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const saved = new Response(new ReadableStream<Uint8Array>({ cancel }));
    expect((await run(saved, false)).html).toBe(""); expect(cancel).toHaveBeenCalledOnce();
  });
  it("observes rejected cancellation without losing a successful status", async () => {
    const saved = new Response(new ReadableStream<Uint8Array>({ cancel() { return Promise.reject(new Error("synthetic-provider-detail")); } }), { status: 302 });
    expect((await run(saved)).status).toBe(302);
  });
  it("bounds headers and cancels a fetch response that arrives after the shared deadline", async () => {
    vi.useFakeTimers(); let resolve!: (response: Response) => void;
    const cancel = vi.fn(); const late = new Response(new ReadableStream({ cancel }));
    const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>((done) => { resolve = done; }));
    const result = probeLegacyRedirect(url, true, { fetchImplementation: fetcher, timeoutMs: 20 }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(20);
    expect(await result).toMatchObject({ message: "legacy-probe-failed" });
    resolve(late); await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it("shares the total budget between headers and a stalled body even if abort and cancel are ignored", async () => {
    vi.useFakeTimers(); const cancel = vi.fn(() => new Promise<void>(() => {}));
    const stalled = new Response(new ReadableStream<Uint8Array>({ pull() { return new Promise<void>(() => {}); }, cancel }));
    const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => { setTimeout(() => resolve(stalled), 10); }));
    const result = probeLegacyRedirect(url, true, { fetchImplementation: fetcher, timeoutMs: 20 }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(19); expect(cancel).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(await result).toMatchObject({ message: "legacy-probe-failed" });
    expect(cancel).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it("accepts exact byte caps and refuses a cap crossed across chunks", async () => {
    expect((await run(response([Buffer.from("abcd")]), true, 4)).html).toBe("abcd");
    await expect(run(response([Buffer.from("ab"), Buffer.from("cde")]), true, 4)).rejects.toThrow("legacy-probe-failed");
    await expect(run(response([Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff])]), true, 4)).rejects.toThrow("legacy-probe-failed");
  });
  it("decodes split valid Unicode and split BOM and accepts null and BOM-only bodies", async () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("\u00e4\ud83d\ude00")]);
    expect((await run(response([...bytes].map(byte => new Uint8Array([byte]))))).html).toBe("\u00e4\ud83d\ude00");
    expect((await run(response([Buffer.from([0xef, 0xbb, 0xbf])]))).html).toBe("");
    expect((await run(new Response(null))).html).toBe("");
  });
  it.each([{ bytes: [0xff] }, { bytes: [0xe2, 0x82] }])("rejects malformed and truncated UTF-8 without echoing errors: $bytes", async ({ bytes }) => {
    await expect(run(response([new Uint8Array(bytes)]))).rejects.toThrow("legacy-probe-failed");
  });
  it("redacts request and body failures", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("synthetic-provider-detail"));
    await expect(probeLegacyRedirect(url, false, { fetchImplementation: fetcher })).rejects.toMatchObject({ message: "legacy-probe-failed" });
    await expect(run(new Response(new ReadableStream({ start(controller) { controller.error(new Error("synthetic-provider-detail")); } })))).rejects.toMatchObject({ message: "legacy-probe-failed" });
  });
});

it("clears its deadline after successful body reads", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("synthetic"));
  const result = await probeLegacyRedirect(url, true, { fetchImplementation: fetcher, timeoutMs: 100 });
  expect(result.html).toBe("synthetic"); expect(vi.getTimerCount()).toBe(0);
});
