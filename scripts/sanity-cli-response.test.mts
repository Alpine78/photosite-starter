import { afterEach, describe, expect, it, vi } from "vitest";
import { readSanityJsonResponse, runPublicReadQuery, runReadQuery, sendSanityHttpRequest } from "./sanity-read-http.mts";
import { runSeedMutationBatches, uploadSeedImageAsset } from "./sanity-seed-http.mts";

const limit = 16 * 1024 * 1024;
const connection = { projectId: "synthetic", dataset: "fixtures", apiVersion: "v2026-01-01", token: "synthetic-secret" };
const query = { query: "count(*[])" };
const read = (response: Response) => readSanityJsonResponse(response, "Synthetic query");
const json = (value: unknown) => new Response(JSON.stringify(value));
function clock() {
  vi.useFakeTimers();
  const signals: AbortSignal[] = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("synthetic-private-reason", "TimeoutError")), ms);
    signals.push(controller.signal);
    return controller.signal;
  });
  return signals;
}
function unreadBody(cancel = vi.fn((): void | Promise<void> => {})) {
  const pull = vi.fn();
  const response = new Response(new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 }));
  return { response, pull, cancel };
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("bounded owner-run Sanity HTTP responses", () => {
  it("refuses a declared oversized response without pulling it, cancelling once", async () => {
    const { response, pull, cancel } = unreadBody();
    response.headers.set("content-length", String(limit + 1));
    await expect(read(response)).rejects.toThrow("response byte limit");
    expect(pull).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("accepts exactly the byte budget and rejects an actual extra byte even with a small declared length", async () => {
    const prefix = '{"result":"', suffix = '"}';
    const text = "a".repeat(limit - prefix.length - suffix.length);
    expect(await read(new Response(prefix + text + suffix))).toEqual({ result: text });
    await expect(read(new Response(prefix + text + "a" + suffix, { headers: { "content-length": "1" } })))
      .rejects.toThrow("response byte limit");
  });
  it("refuses the first oversized chunk and cancels without pulling a second one", async () => {
    const cancel = vi.fn(); let pulls = 0;
    const response = new Response(new ReadableStream<Uint8Array>({ pull(controller) {
      pulls++; controller.enqueue(new Uint8Array(limit + 1));
    }, cancel }, { highWaterMark: 0 }));
    await expect(read(response)).rejects.toThrow("response byte limit");
    expect(pulls).toBe(1); expect(cancel).toHaveBeenCalledTimes(1);
  });
  it.each(["invalid", "-1", "1, 2", "1.5"])("ignores unusable declared length %s and parses only used capacity", async value => {
    expect(await read(new Response('{"result":1}', { headers: { "content-length": value } }))).toEqual({ result: 1 });
  });
  it("cancels HTTP errors without reading or exposing their content", async () => {
    const cancel = vi.fn(); const pull = vi.fn();
    const response = new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), { status: 503 });
    await expect(read(response)).rejects.toMatchObject({ status: 503, message: "[sanity-read-http] Synthetic query failed with HTTP 503" });
    expect(pull).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledTimes(1);
  });
  it.each(["throw", "reject", "stall"])("HTTP cleanup %s cannot delay or replace the error", async mode => {
    const cancel = vi.fn(() => {
      if (mode === "throw") throw new Error("synthetic-provider-detail");
      if (mode === "reject") return Promise.reject(new Error("synthetic-provider-detail"));
      return new Promise<void>(() => {});
    });
    const response = new Response(new ReadableStream({ cancel }), { status: 403 });
    await expect(read(response)).rejects.toMatchObject({ status: 403 });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("bounds abort-ignoring fetch and cancels its late response exactly once", async () => {
    clock(); let resolve!: (response: Response) => void;
    const fetchImplementation = vi.fn(() => new Promise<Response>(r => { resolve = r; }));
    const pending = runReadQuery(connection, query, { fetchImplementation }).catch(error => error);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await pending).toMatchObject({ message: "[sanity-read-http] Request timed out" });
    const { response, cancel, pull } = unreadBody(); resolve(response);
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledTimes(1); expect(pull).not.toHaveBeenCalled();
  });
  it("observes a late fetch rejection without exposing its private reason", async () => {
    clock(); let reject!: (error: Error) => void;
    const pending = runReadQuery(connection, query, { fetchImplementation: () => new Promise<Response>((_, r) => { reject = r; }) }).catch(error => error);
    await vi.advanceTimersByTimeAsync(20_000);
    const error = await pending; reject(new Error("synthetic-provider-detail"));
    await vi.advanceTimersByTimeAsync(0);
    expect(error).toMatchObject({ message: "[sanity-read-http] Request timed out" }); expect(error).not.toHaveProperty("cause");
  });
  it("keeps the original deadline after slow headers and cancels a stalled body", async () => {
    const signals = clock(); let resolve!: (response: Response) => void;
    const pending = runReadQuery(connection, query, { fetchImplementation: () => new Promise<Response>(r => { resolve = r; }) }).catch(error => error);
    await vi.advanceTimersByTimeAsync(19_000);
    const { response, cancel } = unreadBody(); resolve(response);
    await vi.advanceTimersByTimeAsync(0); await vi.advanceTimersByTimeAsync(1_000);
    expect(await pending).toMatchObject({ message: "[sanity-read-http] Request timed out" });
    expect(signals).toHaveLength(1); expect(cancel).toHaveBeenCalledTimes(1);
  });
  it.each(["throw", "reject", "stall"])("stalled-body cleanup %s cannot extend the original deadline", async mode => {
    clock();
    const cancel = vi.fn(() => {
      if (mode === "throw") throw new Error("synthetic-provider-detail");
      if (mode === "reject") return Promise.reject(new Error("synthetic-provider-detail"));
      return new Promise<void>(() => {});
    });
    const pending = runReadQuery(connection, query, { fetchImplementation: async () => unreadBody(cancel).response }).catch(error => error);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await pending).toMatchObject({ message: "[sanity-read-http] Request timed out" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("does not restart the deadline between body chunks", async () => {
    const signals = clock(); let controller!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(new ReadableStream<Uint8Array>({ start(c) { controller = c; } }));
    const pending = runReadQuery(connection, query, { fetchImplementation: async () => response }).catch(error => error);
    await vi.advanceTimersByTimeAsync(9_000); controller.enqueue(Buffer.from('{"result":'));
    await vi.advanceTimersByTimeAsync(9_000); controller.enqueue(Buffer.from("1"));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await pending).toMatchObject({ message: "[sanity-read-http] Request timed out" });
    expect(signals).toHaveLength(1);
  });
  it("enforces elapsed time even when immediate empty reads prevent the timeout callback", async () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0), cancel = vi.fn();
    let pulls = 0;
    const response = new Response(new ReadableStream<Uint8Array>({ pull(c) {
      if (++pulls === 1) c.enqueue(new Uint8Array(0));
      else { now.mockReturnValue(20_001); c.enqueue(Buffer.from('{"result":1}')); c.close(); }
    }, cancel }, { highWaterMark: 0 }));
    let signal: AbortSignal | null | undefined;
    const pending = runReadQuery(connection, query, { fetchImplementation: async (_url, init) => { signal = init?.signal; return response; } });
    await expect(pending).rejects.toMatchObject({ message: "[sanity-read-http] Request timed out" });
    expect(signal?.aborted).toBe(false); expect(pulls).toBe(2);
    // The stream is already closed; cancellation remains harmless.
    expect(cancel).not.toHaveBeenCalled();
  });
  it("cancels headers received past the monotonic deadline before any body read", async () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const { response, cancel, pull } = unreadBody();
    await expect(runReadQuery(connection, query, { fetchImplementation: async () => { now.mockReturnValue(20_001); return response; } }))
      .rejects.toMatchObject({ message: "[sanity-read-http] Request timed out" });
    expect(cancel).toHaveBeenCalledTimes(1); expect(pull).not.toHaveBeenCalled();
  });
  it("keeps timeout classification when a late transport rejects before its timer can run", async () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    await expect(runReadQuery(connection, query, { fetchImplementation: async () => {
      now.mockReturnValue(20_001); throw new Error("synthetic-provider-detail");
    } })).rejects.toMatchObject({ message: "[sanity-read-http] Request timed out" });
  });
  it("gives standalone and cloned responses a finite read deadline", async () => {
    const signals = clock(); const { response, cancel } = unreadBody();
    const pending = read(response).catch(error => error);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await pending).toMatchObject({ message: "[sanity-read-http] Request timed out" });
    expect(signals).toHaveLength(1); expect(cancel).toHaveBeenCalledTimes(1);
    // A clone is a standalone Response, not a continuation of an owned fetch.
    expect(await read(json({ result: 2 }).clone())).toEqual({ result: 2 });
    expect(signals).toHaveLength(2);
  });
  it("does not restart an owned response deadline even if its read begins after expiry", async () => {
    const signals = clock(); const { response, cancel } = unreadBody();
    const owned = await sendSanityHttpRequest("https://synthetic.invalid", {}, { fetchImplementation: async () => response });
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(read(owned)).rejects.toMatchObject({ message: "[sanity-read-http] Request timed out" });
    expect(signals).toHaveLength(1); expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("removes per-wait abort listeners across many successful reads", async () => {
    const signals = clock(); let chunks = 0;
    const response = new Response(new ReadableStream<Uint8Array>({ pull(c) {
      if (++chunks < 1_000) c.enqueue(new Uint8Array([32]));
      else { c.enqueue(Buffer.from('{"result":1}')); c.close(); }
    } }, { highWaterMark: 0 }));
    const owned = await sendSanityHttpRequest("https://synthetic.invalid", {}, { fetchImplementation: async () => response });
    const add = vi.spyOn(signals[0], "addEventListener"), remove = vi.spyOn(signals[0], "removeEventListener");
    expect(await read(owned)).toEqual({ result: 1 });
    expect(add).toHaveBeenCalledTimes(1_001); expect(remove).toHaveBeenCalledTimes(1_001);
  });
  it("preserves public and raw query envelopes and credential separation", async () => {
    const fetchImplementation = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.redirect).toBe("error"); return json({ result: [{ _id: "synthetic-document" }] });
    });
    expect(await runReadQuery(connection, { ...query, perspective: "raw" }, { fetchImplementation })).toEqual([{ _id: "synthetic-document" }]);
    expect(await runPublicReadQuery(connection, query, { fetchImplementation })).toEqual([{ _id: "synthetic-document" }]);
    expect(String(fetchImplementation.mock.calls[0][0])).toContain("perspective=raw");
    expect(new Headers(fetchImplementation.mock.calls[0][1]?.headers).get("authorization")).toBe("Bearer synthetic-secret");
    expect(new Headers(fetchImplementation.mock.calls[1][1]?.headers).has("authorization")).toBe(false);
  });
  it.each([200, 503])("releases an unused mutation response at HTTP%s without retry or body parse", async status => {
    const cancel = vi.fn(() => new Promise<void>(() => {})), pull = vi.fn();
    const fetchImplementation = vi.fn(async () => new Response(new ReadableStream({ cancel, pull }, { highWaterMark: 0 }), { status }));
    const result = runSeedMutationBatches(connection, [{ create: { _id: "synthetic-one" } }, { create: { _id: "synthetic-two" } }], { batchSize: 1, fetchImplementation });
    if (status === 200) { expect(await result).toEqual({ batchesRun: 2, mutationCount: 2 }); expect(cancel).toHaveBeenCalledTimes(2); }
    else { await expect(result).rejects.toMatchObject({ status: 503 }); expect(cancel).toHaveBeenCalledTimes(1); }
    expect(fetchImplementation).toHaveBeenCalledTimes(status === 200 ? 2 : 1); expect(pull).not.toHaveBeenCalled();
  });
  it("bounds upload response parsing without retrying an already submitted upload", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }, { highWaterMark: 0 }), { headers: { "content-length": String(limit + 1) } });
    const fetchImplementation = vi.fn(async () => response);
    await expect(uploadSeedImageAsset(connection, { bytes: new Uint8Array([1]), contentType: "image/webp" }, { maxDimension: 2048, formatsByExtension: { webp: "image/webp" } }, { fetchImplementation }))
      .rejects.toThrow("response byte limit");
    expect(fetchImplementation).toHaveBeenCalledTimes(1); expect(cancel).toHaveBeenCalledTimes(1);
  });
});
