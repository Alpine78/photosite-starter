import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAliasProbe } from "./preview-alias.mts";
import { describePreviewFailure, probePreviewDeployment } from "./preview-probe.mts";
import { VercelApiError } from "./vercel-preview-api.mts";

const URL_FIXTURE = new URL("https://synthetic.vercel.app/");
const TIMEOUT = "Preview probe timed out";
function response(status = 302) {
  const state = { reads: 0, cancels: 0 };
  const value = new Response(new ReadableStream({
    pull() { state.reads++; },
    cancel() { state.cancels++; },
  }, { highWaterMark: 0 }), { status, headers: { location: "https://vercel.com/sso-api", "x-robots-tag": "noindex" } });
  return { value, state };
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("header-only Preview response lifetime (AB#350)", () => {
  it("projects exact headers and cancels the unread body", async () => {
    const fixture = response();
    const send = vi.fn<typeof fetch>(async () => fixture.value);
    try {
      expect(await probePreviewDeployment(URL_FIXTURE, {}, send)).toEqual({ status: 302, location: "https://vercel.com/sso-api", robotsTag: "noindex" });
      expect(fixture.state).toEqual({ reads: 0, cancels: 1 });
      expect(send).toHaveBeenCalledExactlyOnceWith(URL_FIXTURE, { headers: {}, redirect: "manual", cache: "no-store", signal: expect.any(AbortSignal) });
    } finally { await fixture.value.body?.cancel(); }
  });

  it("disposes the unauthenticated body before the unchanged bypass GET", async () => {
    const first = response(); const second = response(200);
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(first.value).mockImplementationOnce(async () => {
      expect(first.state).toEqual({ reads: 0, cancels: 1 });
      return second.value;
    });
    try {
      expect(await createAliasProbe("synthetic-only", send)(URL_FIXTURE)).toEqual({ protectionStatus: 302, protectionLocation: "https://vercel.com/sso-api", bypassStatus: 200, robotsTag: "noindex" });
      expect(send.mock.calls.map(([url, init]) => ({ url, ...init, signal: undefined }))).toEqual([
        { url: URL_FIXTURE, headers: {}, redirect: "manual", cache: "no-store", signal: undefined },
        { url: URL_FIXTURE, headers: { "x-vercel-protection-bypass": "synthetic-only" }, redirect: "manual", cache: "no-store", signal: undefined },
      ]);
      expect(second.state).toEqual({ reads: 0, cancels: 1 });
    } finally { await first.value.body?.cancel(); await second.value.body?.cancel(); }
  });

  it.each(["generated", "alias"])("bounds an abort-ignoring %s fetch and disposes its late response", async kind => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let release!: (value: Response) => void;
    const send = vi.fn<typeof fetch>(() => new Promise(resolve => { release = resolve; }));
    const pending = kind === "generated" ? probePreviewDeployment(URL_FIXTURE, {}, send) : createAliasProbe("synthetic-only", send)(URL_FIXTURE);
    let outcome: unknown = "pending";
    void pending.then(() => { outcome = "resolved"; }, cause => { outcome = cause; });
    await vi.advanceTimersByTimeAsync(20_000);
    const late = response();
    release(late.value);
    await Promise.resolve(); await Promise.resolve();
    try {
      expect(outcome).toBeInstanceOf(VercelApiError);
      expect(describePreviewFailure(outcome)).toBe(TIMEOUT);
      expect(send.mock.calls[0][1]?.signal?.aborted).toBe(true);
      expect(send).toHaveBeenCalledTimes(1);
      expect(late.state).toEqual({ reads: 0, cancels: 1 });
      expect(vi.getTimerCount()).toBe(0);
    } finally { await late.value.body?.cancel(); }
  });

  it("keeps its own static timeout when abort immediately rejects the fetch", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pending = probePreviewDeployment(URL_FIXTURE, {}, async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => { reject(new Error("SYNTHETIC_PRIVATE_ABORT")); }, { once: true });
    }));
    const observed = pending.catch(cause => cause);
    await vi.advanceTimersByTimeAsync(20_000);
    const cause = await observed;
    expect(cause).toBeInstanceOf(VercelApiError);
    expect(describePreviewFailure(cause)).toBe(TIMEOUT);
    expect(cause.status).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("observes a late rejected fetch after the bounded result", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let rejectFetch!: (cause: unknown) => void;
    const observed = probePreviewDeployment(URL_FIXTURE, {}, () => new Promise((_resolve, reject) => { rejectFetch = reject; })).catch(cause => cause);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(describePreviewFailure(await observed)).toBe(TIMEOUT);
    rejectFetch(new Error("SYNTHETIC_PRIVATE_LATE_FAILURE"));
    await Promise.resolve(); await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([19_999, 20_000])("uses the original monotonic budget when headers arrive at %ims without a fired timer", async elapsed => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const fixture = response();
    let release!: (value: Response) => void;
    const send = vi.fn<typeof fetch>(() => new Promise(resolve => { release = resolve; }));
    const observed = probePreviewDeployment(URL_FIXTURE, {}, send).then(value => ({ value }), cause => ({ cause }));
    // Native performance is deliberately separate from the timer clock.
    await vi.advanceTimersByTimeAsync(19_000);
    now = elapsed;
    release(fixture.value);
    const result = await observed;
    if (elapsed < 20_000) expect(result).toHaveProperty("value.status", 302);
    else { expect(result).toHaveProperty("cause"); expect(describePreviewFailure("cause" in result ? result.cause : undefined)).toBe(TIMEOUT); }
    expect(send.mock.calls[0][1]?.signal?.aborted).toBe(false);
    expect(fixture.state).toEqual({ reads: 0, cancels: 1 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("refuses projection that crosses the original deadline and still disposes the response", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const fixture = response();
    const get = fixture.value.headers.get.bind(fixture.value.headers);
    vi.spyOn(fixture.value.headers, "get").mockImplementation(name => { now = 20_000; return get(name); });
    await expect(probePreviewDeployment(URL_FIXTURE, {}, async () => fixture.value)).rejects.toThrow(TIMEOUT);
    expect(fixture.state).toEqual({ reads: 0, cancels: 1 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not dispatch after the original budget is already spent", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(20_000);
    const send = vi.fn<typeof fetch>();
    await expect(probePreviewDeployment(URL_FIXTURE, {}, send)).rejects.toThrow(TIMEOUT);
    expect(send).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses a fresh original budget for the second alias GET", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const first = response(); const second = response(200);
    const send = vi.fn<typeof fetch>().mockImplementationOnce(async () => { now = 19_000; return first.value; })
      .mockImplementationOnce(async () => { now = 38_000; return second.value; });
    expect(await createAliasProbe("synthetic-only", send)(URL_FIXTURE)).toMatchObject({ protectionStatus: 302, bypassStatus: 200 });
    expect(first.state).toEqual({ reads: 0, cancels: 1 });
    expect(second.state).toEqual({ reads: 0, cancels: 1 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["throw", "reject", "stall"])("does not await or expose %s cancellation", async mode => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fixture = response();
    const cancel = vi.spyOn(fixture.value.body!, "cancel").mockImplementation(() => {
      if (mode === "throw") throw new Error("SYNTHETIC_PRIVATE_CANCEL");
      return mode === "reject" ? Promise.reject(new Error("SYNTHETIC_PRIVATE_CANCEL")) : new Promise<void>(() => {});
    });
    try {
      expect(await probePreviewDeployment(URL_FIXTURE, {}, async () => fixture.value)).toEqual({ status: 302, location: "https://vercel.com/sso-api", robotsTag: "noindex" });
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(fixture.state.reads).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally { cancel.mockRestore(); await fixture.value.body?.cancel(); }
  });

  it("keeps valid header evidence for null or locked bodies without taking the reader", async () => {
    expect(await probePreviewDeployment(URL_FIXTURE, {}, async () => new Response(null, { status: 204 }))).toEqual({ status: 204, location: null, robotsTag: null });
    const fixture = response();
    const reader = fixture.value.body!.getReader();
    try {
      expect(await probePreviewDeployment(URL_FIXTURE, {}, async () => fixture.value)).toMatchObject({ status: 302 });
      expect(fixture.value.body!.locked).toBe(true);
      expect(fixture.state).toEqual({ reads: 0, cancels: 0 });
    } finally { await reader.cancel(); reader.releaseLock(); }
  });

  it("withholds projection failures and cleans up the body", async () => {
    const fixture = response();
    const failure = new Error("SYNTHETIC_PRIVATE_PROJECTION");
    vi.spyOn(fixture.value.headers, "get").mockImplementation(() => { throw failure; });
    const cause = await probePreviewDeployment(URL_FIXTURE, {}, async () => fixture.value).catch(cause => cause);
    expect(cause).toBe(failure);
    expect(describePreviewFailure(cause)).toBe("request failed; details withheld");
    expect(fixture.state).toEqual({ reads: 0, cancels: 1 });
  });

  it.each([null, undefined, {}])("preserves the original malformed-response TypeError for %s", async value => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // Deliberately violate the injected transport contract, without weakening production types.
    const send = (async () => value) as typeof fetch;
    const cause = await probePreviewDeployment(URL_FIXTURE, {}, send).catch(cause => cause);
    expect(cause).toBeInstanceOf(TypeError);
    expect(describePreviewFailure(cause)).toBe("request failed; details withheld");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores a hostile body getter after valid header projection", async () => {
    const fixture = response();
    const body = fixture.value.body;
    Object.defineProperty(fixture.value, "body", { get() { throw new Error("SYNTHETIC_PRIVATE_BODY"); } });
    try { expect(await probePreviewDeployment(URL_FIXTURE, {}, async () => fixture.value)).toMatchObject({ status: 302 }); }
    finally { await body?.cancel(); }
  });

  it.each(["throw", "reject"])("preserves an ordinary %s without inspecting its cause and clears the timer", async mode => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const failure = new Proxy({}, { getPrototypeOf() { throw new Error("SYNTHETIC_PRIVATE_CAUSE"); } });
    const send: typeof fetch = () => { if (mode === "throw") throw failure; return Promise.reject(failure); };
    const cause = await probePreviewDeployment(URL_FIXTURE, {}, send).catch(cause => cause);
    expect(cause === failure).toBe(true);
    expect(describePreviewFailure(cause)).toBe("request failed; details withheld");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases a native unfinished loopback response without reading its body", async () => {
    let closed = false;
    const server = createServer((_request, reply) => {
      reply.on("close", () => { closed = true; });
      reply.writeHead(302, { location: "https://vercel.com/sso-api", "x-robots-tag": "noindex" });
      reply.flushHeaders(); reply.write("synthetic unfinished body");
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No loopback address");
      expect(await probePreviewDeployment(new URL(`http://127.0.0.1:${address.port}/`), {})).toEqual({ status: 302, location: "https://vercel.com/sso-api", robotsTag: "noindex" });
      await vi.waitFor(() => { expect(closed).toBe(true); }, { timeout: 2_000, interval: 10 });
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    expect(server.listening).toBe(false);
  });
});
