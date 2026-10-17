import { getEventListeners } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runMeasuredQuery, parseReadConnection } from "./keyword-benchmark-http.mts";

const connection = parseReadConnection({ projectId: "abc123", dataset: "kwbench", apiVersion: "v2024-01-01", token: "synthetic-token" });
const request = { query: "count(*)", endpoint: "api" } as const;
const limit = 16 * 1024 * 1024;
const run = (send: typeof fetch) => runMeasuredQuery(connection, request, { fetchImplementation: send });
afterEach(() => vi.useRealTimers());

describe("benchmark total response bounds", () => {
  it("times out an abort-ignoring fetch and cancels its late response", async () => {
    vi.useFakeTimers();
    let resolve!: (response: Response) => void;
    const cancel = vi.fn();
    const result = run(vi.fn(() => new Promise<Response>(done => { resolve = done; }))).catch(error => error);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toMatchObject({ message: "[keyword-benchmark-http] Request timed out", status: undefined });
    resolve(new Response(new ReadableStream({ cancel })));
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("keeps late fetch rejection observed and redacted", async () => {
    vi.useFakeTimers();
    let reject!: (error: Error) => void;
    const result = run(vi.fn(() => new Promise<Response>((_, fail) => { reject = fail; }))).catch(error => error);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toMatchObject({ message: "[keyword-benchmark-http] Request timed out" });
    reject(new Error("synthetic-provider-detail"));
    await vi.advanceTimersByTimeAsync(0);
  });

  it("shares the fetch deadline with an abort-ignoring body and stalled cleanup", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({ pull() { return new Promise<void>(() => {}); }, cancel });
    const response = new Response(body);
    const result = run(vi.fn(() => new Promise<Response>(resolve => setTimeout(() => resolve(response), 29_000)))).catch(error => error);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(cancel).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toMatchObject({ message: "[keyword-benchmark-http] Response body timed out" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it.each([0, 1])("accepts exactly the byte cap and rejects cap plus %s", async extra => {
    const payload = `{"result":0}${" ".repeat(limit - 12 + extra)}`;
    expect(Buffer.byteLength(payload)).toBe(limit + extra);
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.from(payload)); controller.close(); }, cancel }));
    if (extra) await expect(run(vi.fn().mockResolvedValue(response))).rejects.toMatchObject({ message: "[keyword-benchmark-http] Response body exceeds byte limit", status: undefined });
    else expect(await run(vi.fn().mockResolvedValue(response))).toMatchObject({ result: 0, payloadBytes: limit });
  });

  it("stops at the oversized chunk and cancels without consuming further data", async () => {
    const read = vi.fn().mockResolvedValue({ done: false, value: new Uint8Array(limit + 1) });
    const cancel = vi.fn(() => Promise.reject(new Error("synthetic-provider-detail")));
    const releaseLock = vi.fn();
    const response = { ok: true, body: { getReader: () => ({ read, cancel, releaseLock }) } } as unknown as Response;
    await expect(run(vi.fn().mockResolvedValue(response))).rejects.toMatchObject({ message: "[keyword-benchmark-http] Response body exceeds byte limit" });
    expect(read).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalledOnce(); expect(releaseLock).toHaveBeenCalledOnce();
  });

  it("preserves split BOM and Unicode without accumulating deadline listeners", async () => {
    const bytes = Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from(JSON.stringify({ result: "ä😀", ms: 3 }))]);
    let index = 0;
    let signal!: AbortSignal;
    const read = vi.fn(async () => {
      expect(getEventListeners(signal, "abort").length).toBeLessThanOrEqual(1);
      return index < bytes.length ? { done: false, value: bytes.subarray(index, ++index) } : { done: true };
    });
    const response = new Response(null);
    Object.defineProperty(response, "body", { value: { getReader: () => ({ read, cancel: async () => {}, releaseLock() {} }) } });
    const result = await run(vi.fn(async (_, init) => { signal = init!.signal!; return response; }));
    expect(result).toMatchObject({ result: "ä😀", serverMs: 3, payloadBytes: bytes.length });
    expect(getEventListeners(signal, "abort")).toHaveLength(0);
  });

  it("does not let an immediate empty-chunk stream starve its timer", async () => {
    const cancel = vi.fn(async () => {});
    const response = new Response(null);
    Object.defineProperty(response, "body", { value: { getReader: () => ({ read: async () => ({ done: false, value: new Uint8Array() }), cancel, releaseLock() {} }) } });
    const send = vi.fn(async (_, init?: RequestInit) => { setImmediate(() => (init!.signal as AbortSignal).dispatchEvent(new Event("abort"))); return response; });
    await expect(run(send)).rejects.toMatchObject({ message: "[keyword-benchmark-http] Response body timed out" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(["locked", "bad-chunk"])("redacts %s reader defects and cleanup throws", async kind => {
    const response = new Response(null);
    Object.defineProperty(response, "body", { value: { getReader() {
      if (kind === "locked") throw new Error("synthetic-provider-detail");
      return { read: async () => ({ done: false, value: "bad" }), cancel() { throw new Error("synthetic-provider-detail"); }, releaseLock() { throw new Error("synthetic-provider-detail"); } };
    }, cancel() { throw new Error("synthetic-provider-detail"); } } });
    const error = await run(vi.fn().mockResolvedValue(response)).catch(error => error);
    expect(error).toMatchObject({ message: "[keyword-benchmark-http] Response body could not be read" });
    expect(error).not.toHaveProperty("cause");
  });
});
