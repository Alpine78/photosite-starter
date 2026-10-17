import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSanityClient,
  createSanityDocumentReader,
  SANITY_QUERY_TIMEOUT_MS,
} from "@/lib/sanity-client";

const config = {
  projectId: "abcdefgh", dataset: "fixture", datasetVisibility: "public" as const,
  apiVersion: "v2026-06-24",
};
const id = "fixture-document";
const modes = ["query", "document"] as const;
type Mode = typeof modes[number];
function read(mode: Mode, send: typeof fetch, signal?: AbortSignal, limit = 64) {
  return mode === "query"
    ? createSanityClient({ config, fetchImplementation: send, maxResponseBytes: limit })
        .query({ query: "*[false]", tag: "fixture.cleanup", signal })
    : createSanityDocumentReader({ config, fetchImplementation: send, maxResponseBytes: limit })
        .read(id, signal);
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function outcome(promise: Promise<unknown>) {
  const state: { value?: unknown; error?: unknown; settled: boolean } = { settled: false };
  void promise.then(value => { state.value = value; state.settled = true; }, error => { state.error = error; state.settled = true; });
  return state;
}
async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
function timeoutClock() {
  vi.useFakeTimers();
  return vi.spyOn(AbortSignal, "timeout").mockImplementation(milliseconds => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("fixture deadline", "TimeoutError")), milliseconds);
    return controller.signal;
  });
}
beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe.each(modes)("%s response cleanup", mode => {
  it.each([
    [400, "query-rejected", false], [401, "unauthorized", false],
    [403, "unauthorized", false], [404, "not-found", false],
    [429, "rate-limited", true], [503, "unavailable", true],
  ] as const)("cancels unused HTTP%d bodies once and preserves classification", async (status, errorClass, retryable) => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), { status });
    const send = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expect(read(mode, send)).rejects.toMatchObject({ errorClass, retryable });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it.each(["throw", "reject", "stall"] as const)("does not let %s cleanup replace or delay an HTTP failure", async behavior => {
    const response = new Response("PRIVATE", { status: 503 });
    const cancel = vi.spyOn(response.body!, "cancel").mockImplementation(() => {
      if (behavior === "throw") throw new Error("PRIVATE");
      return behavior === "reject" ? Promise.reject(new Error("PRIVATE")) : new Promise(() => {});
    });
    const state = outcome(read(mode, vi.fn<typeof fetch>().mockResolvedValue(response)));
    await flush();
    expect(state.settled).toBe(true);
    expect(state.error).toMatchObject({ errorClass: "unavailable", retryable: true });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("PRIVATE");
  });
  it("classifies an empty non-OK body without trying to consume it", async () => {
    await expect(read(mode, vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 })))).rejects.toMatchObject({ errorClass: "unavailable" });
  });
  it.each(["declared", "streamed"] as const)("finishes %s overflow even when cancellation never settles", async source => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(65)); }, cancel });
    const response = new Response(body, { headers: source === "declared" ? { "content-length": "65" } : {} });
    const state = outcome(read(mode, vi.fn<typeof fetch>().mockResolvedValue(response)));
    await flush();
    expect(state.settled).toBe(true);
    expect(state.error).toMatchObject({ errorClass: "malformed-response", retryable: false });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });
  it("bounds a fetch ignoring abort and cancels its late response once", async () => {
    const pending = deferred<Response>(), controller = new AbortController(), cancel = vi.fn();
    const state = outcome(read(mode, vi.fn<typeof fetch>().mockReturnValue(pending.promise), controller.signal));
    controller.abort(new Error("PRIVATE")); await flush();
    expect(state.error).toMatchObject({ errorClass: "timeout", retryable: true });
    pending.resolve(new Response(new ReadableStream({ cancel }), { status: 503 })); await flush();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.error)).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("PRIVATE");
  });
  it("observes a late fetch rejection after an abort", async () => {
    const pending = deferred<Response>(), controller = new AbortController();
    const state = outcome(read(mode, vi.fn<typeof fetch>().mockReturnValue(pending.promise), controller.signal));
    controller.abort(); await flush(); pending.reject(new Error("PRIVATE")); await flush();
    expect(state.error).toMatchObject({ errorClass: "timeout" });
    expect(vi.mocked(console.error)).toHaveBeenCalledTimes(1);
  });
  it("aborts a stalled body without waiting for its cancellation", async () => {
    const controller = new AbortController(), cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({ cancel });
    const state = outcome(read(mode, vi.fn<typeof fetch>().mockResolvedValue(new Response(body)), controller.signal));
    await flush(); controller.abort(); await flush();
    expect(state.error).toMatchObject({ errorClass: "timeout", retryable: true });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });
  it.each(["fetch", "body"] as const)("enforces the original ten-second deadline on a stalled %s", async stage => {
    const clock = timeoutClock();
    const send = vi.fn<typeof fetch>(() => stage === "fetch" ? new Promise(() => {}) : Promise.resolve(new Response(new ReadableStream())));
    const state = outcome(read(mode, send)); await flush();
    await vi.advanceTimersByTimeAsync(SANITY_QUERY_TIMEOUT_MS - 1); expect(state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(state.error).toMatchObject({ errorClass: "timeout", retryable: true });
    expect(clock).toHaveBeenCalledExactlyOnceWith(10_000);
  });
  it("does not restart the deadline when headers and chunks make progress", async () => {
    const clock = timeoutClock(); let stream!: ReadableStreamDefaultController<Uint8Array>;
    const send = vi.fn<typeof fetch>(() => new Promise(resolve => {
      setTimeout(() => resolve(new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }))), 4000);
    }));
    const state = outcome(read(mode, send));
    await vi.advanceTimersByTimeAsync(4000); stream.enqueue(new TextEncoder().encode('{"'));
    await vi.advanceTimersByTimeAsync(4000); stream.enqueue(new TextEncoder().encode('result":'));
    await vi.advanceTimersByTimeAsync(1999); expect(state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(state.error).toMatchObject({ errorClass: "timeout" });
    expect(clock).toHaveBeenCalledTimes(1);
  });
  it("checks abort between the fetch observer and the caller continuation", async () => {
    const pending = deferred<Response>(), controller = new AbortController(), cancel = vi.fn();
    const state = outcome(read(mode, vi.fn<typeof fetch>().mockReturnValue(pending.promise), controller.signal));
    pending.resolve(new Response(new ReadableStream({ cancel }), { status: 503 }));
    queueMicrotask(() => controller.abort());
    await flush();
    expect(state.error).toMatchObject({ errorClass: "timeout", retryable: true });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it.each(["declared", "streamed"] as const)("observes throwing cancellation on %s overflow", async source => {
    const cancel = vi.fn(() => { throw new Error("PRIVATE"); });
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(65)); }, cancel });
    const response = new Response(body, { headers: source === "declared" ? { "content-length": "65" } : {} });
    await expect(read(mode, vi.fn<typeof fetch>().mockResolvedValue(response))).rejects.toMatchObject({ errorClass: "malformed-response", retryable: false });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });
  it("does not consume an empty bounded body", async () => {
    await expect(read(mode, vi.fn<typeof fetch>().mockResolvedValue(new Response(null)))).rejects.toMatchObject({ errorClass: "malformed-response", retryable: false });
  });
  it("keeps synchronous provider exceptions redacted and classified", async () => {
    const send = vi.fn<typeof fetch>(() => { throw new Error("PRIVATE"); });
    await expect(read(mode, send)).rejects.toMatchObject({ errorClass: "unavailable", retryable: true });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("PRIVATE");
  });
  it("removes each pending-operation listener while reading many chunks", async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const active = new Set<EventListenerOrEventListenerObject>(), signal = controller.signal;
    const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
    let peak = 0;
    vi.spyOn(signal, "addEventListener").mockImplementation((type, listener, options) => {
      if (type === "abort" && listener) { active.add(listener); peak = Math.max(peak, active.size); }
      add(type, listener, options);
    });
    vi.spyOn(signal, "removeEventListener").mockImplementation((type, listener, options) => {
      if (listener) active.delete(listener);
      remove(type, listener, options);
    });
    const payload = new TextEncoder().encode(JSON.stringify(mode === "query" ? { result: null } : { documents: [{ _id: id }] }));
    let offset = 0;
    const body = new ReadableStream<Uint8Array>({ pull(stream) {
      if (offset === payload.length) stream.close();
      else stream.enqueue(payload.subarray(offset, ++offset));
    } });
    await expect(read(mode, vi.fn<typeof fetch>().mockResolvedValue(new Response(body)))).resolves.toEqual(mode === "query" ? null : { _id: id });
    expect(peak).toBe(1);
    expect(active.size).toBe(0);
    expect(signal.addEventListener).toHaveBeenCalledTimes(payload.length + 2);
    expect(signal.removeEventListener).toHaveBeenCalledTimes(payload.length + 2);
    expect(body.locked).toBe(false);
  });
  it("does not accept headers returned by a synchronously aborting provider", async () => {
    const controller = new AbortController(), cancel = vi.fn();
    const send = vi.fn<typeof fetch>(() => {
      controller.abort();
      return Promise.resolve(new Response(new ReadableStream({ cancel }), { status: 503 }));
    });
    await expect(read(mode, send, controller.signal)).rejects.toMatchObject({ errorClass: "timeout" });
    await flush(); expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe("native ordinary query compatibility", () => {
  it("keeps native arrayBuffer decoding without introducing a global one-MiB cap", async () => {
    const value = "x".repeat(1024 * 1024 + 1), response = new Response(JSON.stringify({ result: value }));
    const native = vi.spyOn(response, "arrayBuffer");
    await expect(createSanityClient({ config, fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(response) }).query({ query: "fixture", tag: "fixture.native" })).resolves.toBe(value);
    expect(native).toHaveBeenCalledTimes(1);
  });
  it("preserves malformed-response for an unrelated native body AbortError", async () => {
    const response = new Response(new ReadableStream({ start(controller) { controller.error(new DOMException("PRIVATE", "AbortError")); } }));
    await expect(createSanityClient({ config, fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(response) }).query({ query: "fixture", tag: "fixture.native" })).rejects.toMatchObject({ errorClass: "malformed-response", retryable: false });
  });
  it("stops waiting on native arrayBuffer at the attempt deadline", async () => {
    timeoutClock();
    const response = new Response(new ReadableStream());
    const state = outcome(createSanityClient({ config, fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(response) }).query({ query: "fixture", tag: "fixture.native" }));
    await flush(); await vi.advanceTimersByTimeAsync(10_000);
    expect(state.error).toMatchObject({ errorClass: "timeout", retryable: true });
  });
});
