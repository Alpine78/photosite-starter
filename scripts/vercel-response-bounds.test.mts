import { afterEach, describe, expect, it, vi } from "vitest";
import { getEventListeners } from "node:events";
import { describePreviewFailure } from "./preview-probe.mts";
import {
  assignPreviewAlias,
  deleteAlias,
  deletePreviewDeployment,
  deletePreviewDeploymentFromUrl,
  inspectPreviewDeployment,
  readAliasCurrentTarget,
  resolveDeploymentIfLive,
  VercelApiError,
} from "./vercel-preview-api.mts";

const SETTINGS = { token: "synthetic-secret", orgId: "team_expected123", projectId: "prj_expected123" };
const DEPLOYMENT = {
  id: "dpl_expected123", projectId: SETTINGS.projectId, ownerId: SETTINGS.orgId,
  url: "photosite-starter-abc123-acme.vercel.app", createdAt: 1_724_000_000_000,
};
const ALIAS = "acme-photosite-preview.vercel.app";
const LIMIT = 16 * 1024 * 1024;
const json = (value: unknown) => new Response(JSON.stringify(value));
const encode = (value: string) => new TextEncoder().encode(value);

function chunksResponse(chunks: readonly Uint8Array[], options: { status?: number; declared?: string; cancel?: () => void | PromiseLike<void> } = {}) {
  let index = 0;
  const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (index < chunks.length) controller.enqueue(chunks[index++]);
    else controller.close();
  });
  const cancel = vi.fn(options.cancel ?? (() => {}));
  const response = new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), {
    status: options.status ?? 200,
    headers: options.declared === undefined ? {} : { "content-length": options.declared },
  });
  return { response, pull, cancel };
}

function paddedEvidence(size: number): Uint8Array {
  const base = JSON.stringify({ ...DEPLOYMENT, padding: "" });
  return encode(JSON.stringify({ ...DEPLOYMENT, padding: "x".repeat(size - encode(base).byteLength) }));
}

afterEach(() => { vi.restoreAllMocks(); });

describe("Vercel response bounds (AB#347)", () => {
  it("cancels unused absent-deployment bytes without reading them", async () => {
    const cancel = vi.fn(), pull = vi.fn();
    const response = new Response(new ReadableStream({ cancel, pull }, { highWaterMark: 0 }), { status: 404 });
    await expect(resolveDeploymentIfLive(DEPLOYMENT.id, SETTINGS, vi.fn<typeof fetch>().mockResolvedValue(response))).resolves.toBeNull();
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("refuses oversized valid ownership evidence before accepting its identity", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ ...DEPLOYMENT, padding: "x".repeat(LIMIT) }));
    await expect(inspectPreviewDeployment(`https://${DEPLOYMENT.url}`, SETTINGS, DEPLOYMENT.id, fetcher))
      .rejects.toThrow(/local byte limit/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("settles when an injected fetch ignores its aborted signal", async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    let release!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => { release = resolve; }));
    const pending = resolveDeploymentIfLive(DEPLOYMENT.id, SETTINGS, fetcher);
    let state = "pending";
    void pending.then(() => { state = "resolved"; }, () => { state = "rejected"; });
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 5));
    try { expect(state).toBe("rejected"); }
    finally { release(json(DEPLOYMENT)); await pending.catch(() => {}); }
  });

  it("withholds multiline provider alias prose in the actual operator formatter", async () => {
    const canary = "provider-private-canary\ninjected detail";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ uid: "al_synthetic", alias: canary }));
    let failure: unknown;
    try { await assignPreviewAlias(DEPLOYMENT.id, ALIAS, SETTINGS, fetcher); } catch (cause) { failure = cause; }
    expect(failure).toBeInstanceOf(VercelApiError);
    expect(describePreviewFailure(failure)).not.toContain("provider-private-canary");
    expect(describePreviewFailure(failure)).toBe("Vercel alias assignment returned a different alias; outcome unverified");
  });

  it.each([4 * 1024 * 1024, LIMIT])("accepts in-budget valid evidence of %i decoded bytes", async size => {
    const bytes = paddedEvidence(size);
    expect(bytes.byteLength).toBe(size);
    const { response, cancel } = chunksResponse([bytes.subarray(0, 100), bytes.subarray(100)]);
    await expect(resolveDeploymentIfLive(DEPLOYMENT.id, SETTINGS, vi.fn<typeof fetch>().mockResolvedValue(response)))
      .resolves.toEqual({ id: DEPLOYMENT.id, createdAt: DEPLOYMENT.createdAt });
    expect(cancel).not.toHaveBeenCalled();
    expect(response.body?.locked).toBe(false);
  });

  it("refuses exactly one extra streamed byte even with a misleading small declared length", async () => {
    const { response, cancel } = chunksResponse([paddedEvidence(LIMIT + 1)], { declared: "1" });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expect(deletePreviewDeployment(DEPLOYMENT.id, SETTINGS, fetcher)).rejects.toThrow(/local byte limit/);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1); // Refused lookup cannot start DELETE.
  });

  it("rejects declared oversize without pulling or allocating its announced size", async () => {
    const { response, pull, cancel } = chunksResponse([], { declared: "9".repeat(100) });
    await expect(resolveDeploymentIfLive(DEPLOYMENT.id, SETTINGS, vi.fn<typeof fetch>().mockResolvedValue(response)))
      .rejects.toThrow(/local byte limit/);
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each(["invalid", "-1", "1.5"])("counts actual bytes when content-length is %s", async declared => {
    const { response } = chunksResponse([encode(JSON.stringify(DEPLOYMENT))], { declared });
    await expect(resolveDeploymentIfLive(DEPLOYMENT.id, SETTINGS, vi.fn<typeof fetch>().mockResolvedValue(response)))
      .resolves.toEqual({ id: DEPLOYMENT.id, createdAt: DEPLOYMENT.createdAt });
  });

  it("decodes only populated bytes and retains split Unicode/BOM JSON behavior", async () => {
    const bytes = encode("\uFEFF" + JSON.stringify({ ...DEPLOYMENT, note: "å漢🙂" }));
    const { response } = chunksResponse(Array.from(bytes, byte => new Uint8Array([byte])));
    await expect(resolveDeploymentIfLive(DEPLOYMENT.id, SETTINGS, vi.fn<typeof fetch>().mockResolvedValue(response)))
      .resolves.toMatchObject({ id: DEPLOYMENT.id });
  });

  it.each([new Uint8Array([0xff]), encode("not-json provider-private-canary"), new Uint8Array()])("withholds malformed or empty evidence and cannot start deletion", async bytes => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(chunksResponse([bytes]).response);
    const failure = await deletePreviewDeploymentFromUrl(`https://${DEPLOYMENT.url}`, SETTINGS, fetcher).catch(cause => cause);
    expect(failure).toBeInstanceOf(VercelApiError);
    expect(failure.message).toBe("Vercel deployment lookup returned invalid JSON");
    expect(failure.cause).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("classifies a null successful body as invalid JSON, never owned evidence", async () => {
    await expect(resolveDeploymentIfLive(DEPLOYMENT.id, SETTINGS, vi.fn<typeof fetch>().mockResolvedValue(new Response(null))))
      .rejects.toThrow("Vercel deployment lookup returned invalid JSON");
  });

  it.each(["throw", "reject", "stall"])("unused cleanup may %s without replacing an absent result", async kind => {
    const cleanup = () => {
      if (kind === "throw") throw new Error("provider-private-canary");
      if (kind === "reject") return Promise.reject(new Error("provider-private-canary"));
      return new Promise<void>(() => {});
    };
    const { response, cancel } = chunksResponse([], { status: 404, cancel: cleanup });
    await expect(resolveDeploymentIfLive(DEPLOYMENT.id, SETTINGS, vi.fn<typeof fetch>().mockResolvedValue(response))).resolves.toBeNull();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each(["lookup", "assignment", "alias deletion", "deployment deletion"])("preserves HTTP503 and cleans the unused %s body", async phase => {
    const { response, pull, cancel } = chunksResponse([], { status: 503 });
    const fetcher = vi.fn<typeof fetch>();
    const operation = phase === "lookup" ? () => readAliasCurrentTarget(ALIAS, SETTINGS, fetcher.mockResolvedValue(response))
      : phase === "assignment" ? () => assignPreviewAlias(DEPLOYMENT.id, ALIAS, SETTINGS, fetcher.mockResolvedValue(response))
      : phase === "alias deletion" ? () => deleteAlias("al_synthetic", SETTINGS, fetcher.mockResolvedValue(response))
      : () => deletePreviewDeployment(DEPLOYMENT.id, SETTINGS, fetcher.mockResolvedValueOnce(json(DEPLOYMENT)).mockResolvedValueOnce(response));
    const failure = await operation().catch(cause => cause);
    expect(failure).toBeInstanceOf(VercelApiError);
    expect(failure.status).toBe(503);
    expect(failure.message).toContain("failed with status 503");
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(phase === "deployment deletion" ? 2 : 1);
  });

  it.each([404, 200])("cleans discarded alias DELETE status%i without parsing its body", async status => {
    const { response, pull, cancel } = chunksResponse([encode("not JSON")], { status });
    await expect(deleteAlias("al_synthetic", SETTINGS, vi.fn<typeof fetch>().mockResolvedValue(response)))
      .resolves.toEqual({ removed: status === 200 });
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("keeps one original deadline across slow headers and late body bytes", async () => {
    let now = 0;
    const controller = new AbortController();
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({
      pull(stream) { now = 20_001; stream.enqueue(encode(JSON.stringify(DEPLOYMENT))); }, cancel,
    }, { highWaterMark: 0 }));
    const fetcher = vi.fn<typeof fetch>(async () => { now = 19_000; return response; });
    await expect(resolveDeploymentIfLive(DEPLOYMENT.id, SETTINGS, fetcher)).rejects.toThrow("Vercel deployment lookup request timed out");
    expect(controller.signal.aborted).toBe(false);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(AbortSignal.timeout).toHaveBeenCalledExactlyOnceWith(20_000);
  });

  it.each(["value", "rejection"])("rejects late header %s even before the native signal fires", async kind => {
    let now = 0;
    const controller = new AbortController();
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const { response, pull, cancel } = chunksResponse([]);
    const fetcher = vi.fn<typeof fetch>(async () => {
      now = 20_001;
      if (kind === "rejection") throw new Error("provider-private-canary");
      return response;
    });
    await expect(resolveDeploymentIfLive(DEPLOYMENT.id, SETTINGS, fetcher)).rejects.toThrow(/request timed out/);
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(kind === "value" ? 1 : 0);
  });

  it("bounds zero-progress microtasks by the original monotonic clock", async () => {
    let now = 0, pulls = 0;
    const controller = new AbortController();
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({
      pull(stream) { pulls++; now += 5001; stream.enqueue(new Uint8Array()); }, cancel,
    }, { highWaterMark: 0 }));
    await expect(resolveDeploymentIfLive(DEPLOYMENT.id, SETTINGS, vi.fn<typeof fetch>().mockResolvedValue(response)))
      .rejects.toThrow(/request timed out/);
    expect(controller.signal.aborted).toBe(false);
    expect(pulls).toBe(4);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("observes late fetch rejection and cleans late success without waiting", async () => {
    for (const outcome of ["resolve", "reject"]) {
      const controller = new AbortController();
      vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
      let resolve!: (response: Response) => void, reject!: (cause: unknown) => void;
      const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>((res, rej) => { resolve = res; reject = rej; }));
      const pending = resolveDeploymentIfLive(DEPLOYMENT.id, SETTINGS, fetcher);
      const rejected = expect(pending).rejects.toThrow(/request timed out/);
      controller.abort(); await rejected;
      const { response, cancel } = chunksResponse([], { cancel: () => Promise.reject(new Error("provider-private-canary")) });
      if (outcome === "resolve") resolve(response); else reject(new Error("provider-private-canary"));
      await new Promise<void>(res => setImmediate(res));
      expect(cancel).toHaveBeenCalledTimes(outcome === "resolve" ? 1 : 0);
      vi.restoreAllMocks();
    }
  });

  it("removes per-wait abort listeners after many small body reads", async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const bytes = encode(JSON.stringify({ ...DEPLOYMENT, padding: "x".repeat(1000) }));
    let index = 0, maxListeners = 0;
    const response = new Response(new ReadableStream({ pull(stream) {
      maxListeners = Math.max(maxListeners, getEventListeners(controller.signal, "abort").length);
      if (index < bytes.length) stream.enqueue(bytes.subarray(index, ++index)); else stream.close();
    } }, { highWaterMark: 0 }));
    await expect(resolveDeploymentIfLive(DEPLOYMENT.id, SETTINGS, vi.fn<typeof fetch>().mockResolvedValue(response))).resolves.toMatchObject({ id: DEPLOYMENT.id });
    expect(index).toBeGreaterThan(1000);
    expect(maxListeners).toBeLessThanOrEqual(1);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it.each(["assignment", "deployment deletion"])("oversized %s acknowledgement remains unverified without resubmission", async phase => {
    const ack = chunksResponse([new Uint8Array(LIMIT + 1)]);
    const fetcher = vi.fn<typeof fetch>();
    const operation = phase === "assignment"
      ? assignPreviewAlias(DEPLOYMENT.id, ALIAS, SETTINGS, fetcher.mockResolvedValue(ack.response))
      : deletePreviewDeployment(DEPLOYMENT.id, SETTINGS, fetcher.mockResolvedValueOnce(json(DEPLOYMENT)).mockResolvedValueOnce(ack.response));
    const failure = await operation.catch(cause => cause);
    expect(failure).toBeInstanceOf(VercelApiError);
    expect(failure.status).toBeUndefined();
    expect(failure.message).toMatch(/local byte limit; outcome unverified$/);
    expect(ack.cancel).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(phase === "assignment" ? 1 : 2);
  });

  it.each(["assignment", "alias deletion", "deployment deletion"])("stalled %s acknowledgement remains unverified without resubmission", async phase => {
    const controllers: AbortController[] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const controller = new AbortController(); controllers.push(controller); return controller.signal;
    });
    const pull = vi.fn();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const response = new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }));
    let release!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>();
    const operation = phase === "assignment"
      ? assignPreviewAlias(DEPLOYMENT.id, ALIAS, SETTINGS, fetcher.mockResolvedValue(response))
      : phase === "alias deletion"
        ? deleteAlias("al_synthetic", SETTINGS, fetcher.mockImplementation(() => new Promise(resolve => { release = resolve; })))
        : deletePreviewDeployment(DEPLOYMENT.id, SETTINGS, fetcher.mockResolvedValueOnce(json(DEPLOYMENT)).mockResolvedValueOnce(response));
    const observed = operation.catch(cause => cause);
    if (phase === "alias deletion") await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    else await vi.waitFor(() => expect(pull).toHaveBeenCalledTimes(1));
    controllers.at(-1)!.abort();
    const failure = await observed;
    expect(failure).toBeInstanceOf(VercelApiError);
    expect(failure.status).toBeUndefined();
    expect(failure.message).toMatch(/request timed out; outcome unverified$/);
    expect(fetcher).toHaveBeenCalledTimes(phase === "deployment deletion" ? 2 : 1);
    if (phase === "alias deletion") { release(response); await new Promise<void>(resolve => setImmediate(resolve)); }
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("checks the original elapsed deadline on a rejected body read", async () => {
    let now = 0;
    const controller = new AbortController();
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const response = new Response(new ReadableStream({ pull(stream) {
      now = 20_001; stream.error(new Error("provider-private-canary"));
    } }, { highWaterMark: 0 }));
    await expect(resolveDeploymentIfLive(DEPLOYMENT.id, SETTINGS, vi.fn<typeof fetch>().mockResolvedValue(response)))
      .rejects.toThrow("Vercel deployment lookup request timed out");
    expect(controller.signal.aborted).toBe(false);
  });

  it("observes an abandoned read rejected by lock release even if cancel throws", async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    let rejectRead!: (cause: unknown) => void;
    const read = vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array<ArrayBuffer>>>((_resolve, reject) => { rejectRead = reject; }));
    const cancel = vi.fn(() => { throw new Error("provider-private-canary"); });
    const releaseLock = vi.fn(() => { rejectRead(new TypeError("Reader was released")); });
    const response = new Response("unconsumed synthetic bytes");
    vi.spyOn(response.body!, "getReader").mockReturnValue({ read, cancel, releaseLock } as unknown as ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>);
    const unhandled: unknown[] = [];
    const record = (cause: unknown) => { unhandled.push(cause); };
    process.on("unhandledRejection", record);
    try {
      const observed = resolveDeploymentIfLive(DEPLOYMENT.id, SETTINGS, vi.fn<typeof fetch>().mockResolvedValue(response)).catch(cause => cause);
      await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
      controller.abort();
      expect((await observed).message).toBe("Vercel deployment lookup request timed out");
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(releaseLock).toHaveBeenCalledTimes(1);
      expect(unhandled).toEqual([]);
    } finally { process.removeListener("unhandledRejection", record); }
  });
});
