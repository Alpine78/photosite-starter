import { afterEach, describe, expect, it, vi } from "vitest";
import { createClientGalleryCleanupTransport, cleanupTransportLimits, CleanupTransportError } from "./client-gallery-cleanup-transport";

const date = "Sat, 24 Oct 2026 10:00:00 GMT";
const now = () => Date.parse(date);
const config = { projectId: "synthetic", dataset: "production", apiVersion: "v2026-10-20", token: "synthetic-cleanup-token" };
const encoder = new TextEncoder();
const doc = (id: string) => ({ _id: id, _rev: "r1", _type: "synthetic" });
const response = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(typeof value === "string" ? value : JSON.stringify(value), { status, headers: { date, ...headers } });
function transport(fetcher: ReturnType<typeof vi.fn>) { return createClientGalleryCleanupTransport(config, { fetch: fetcher as typeof fetch, now }); }
afterEach(() => vi.useRealTimers());

describe("cleanup Content Lake transport", () => {
  it("uses only the validated API origin, dedicated header credential and an unfiltered, non-cursor export", async () => {
    const send = vi.fn().mockResolvedValue(response(JSON.stringify(doc("one")) + "\n"));
    const result = await transport(send).snapshot();
    expect(result.documentCount).toBe(1);
    const [url, options] = send.mock.calls[0];
    expect(url).toBe("https://synthetic.api.sanity.io/v2026-10-20/data/export/production");
    expect(options).toMatchObject({ method: "GET", headers: { Authorization: "Bearer synthetic-cleanup-token" }, cache: "no-store", redirect: "error" });
    expect(url).not.toContain(config.token);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("uses a raw advisory query including pending attempts, never a deletion query", async () => {
    const send = vi.fn().mockResolvedValue(response({ result: true }));
    expect(await transport(send).due("2026-10-24T10:00:00.000Z")).toBe(true);
    const url = new URL(send.mock.calls[0][0]);
    expect(url.searchParams.get("perspective")).toBe("raw");
    expect(url.searchParams.get("query")).toContain('state != "enrolled"');
    expect(url.searchParams.get("query")).toContain('!defined(dateTime(policy.expiryInstant))');
    expect(url.searchParams.get("$now")).toBe('"2026-10-24T10:00:00.000Z"');
  });
  it.each([{}, { result: [] }, { result: 1 }, '{"result":false,"result":true}']) ("rejects malformed due-query responses (%j)", async (value) => {
    await expect(transport(vi.fn().mockResolvedValue(response(value))).due("2026-10-24T10:00:00.000Z")).rejects.toMatchObject({ code: "provider_invalid" });
  });
  it("accounts for requested missing documents and includes all draft/release copies even without published source", async () => {
    const send = vi.fn().mockResolvedValue(response({ documents: [doc("drafts.gallery"), doc("versions.release.gallery")], omitted: [{ id: "gallery", reason: "existence" }] }));
    const result = await transport(send).read(["gallery"], { includeAllVersions: true });
    expect([...result.documents.keys()]).toEqual(["drafts.gallery", "versions.release.gallery"]);
    expect([...result.omitted]).toEqual(["gallery"]);
    const url = new URL(send.mock.calls[0][0]);
    expect(url.searchParams.toString()).toBe("includeAllVersions=true");
    expect(url.searchParams.has("perspective")).toBe(false);
  });
  it("accepts no omission list only when every requested ID has a returned document", async () => {
    const complete = transport(vi.fn().mockResolvedValue(response({ documents: [doc("one"), doc("two")] })));
    expect([...(await complete.read(["one", "two"])).documents.keys()]).toEqual(["one", "two"]);
    const incomplete = transport(vi.fn().mockResolvedValue(response({ documents: [doc("one")] })));
    await expect(incomplete.read(["one", "two"])).rejects.toMatchObject({ code: "provider_invalid" });
  });
  it.each([
    { documents: [], omitted: [] },
    { documents: [], omitted: [{ id: "gallery", reason: "permission" }] },
    { documents: [], omitted: [{ id: "other", reason: "existence" }] },
    { documents: [doc("foreign")], omitted: [{ id: "gallery", reason: "existence" }] },
    { documents: [doc("gallery"), doc("gallery")], omitted: [] },
    { documents: [doc("gallery")], omitted: [{ id: "gallery", reason: "existence" }] },
    { documents: [], omitted: [{ id: "gallery", reason: "existence" }, { id: "gallery", reason: "existence" }] },
    { documents: [doc("versions.release.other")], omitted: [{ id: "gallery", reason: "existence" }] },
    { documents: null, omitted: [{ id: "gallery", reason: "existence" }] },
    { documents: [] },
    { documents: [doc("gallery")], omitted: null },
  ])("never treats incomplete or permission-filtered Doc responses as absence (%j)", async (value) => {
    await expect(transport(vi.fn().mockResolvedValue(response(value))).read(["gallery"], { includeAllVersions: true })).rejects.toMatchObject({ code: "provider_invalid" });
  });
  it("chunks maximum-length IDs and verifies omissions separately per chunk", async () => {
    const ids = Array.from({ length: 91 }, (_, i) => `id${i}`.padEnd(128, "a"));
    const send = vi.fn().mockImplementation((url: string) => {
      const selected = new URL(url).pathname.split("/").at(-1)!.split(",");
      return Promise.resolve(response({ documents: [], omitted: selected.map((id) => ({ id, reason: "existence" })) }));
    });
    const result = await transport(send).read(ids);
    expect(result.omitted.size).toBe(91);
    expect(send).toHaveBeenCalledTimes(3);
    for (const call of send.mock.calls) expect(call[0].length).toBeLessThan(6000);
  });
  it("refuses invalid config, IDs and invalid cap values before provider IO", async () => {
    const send = vi.fn();
    for (const override of [{ projectId: "evil.example/" }, { projectId: "synthetic\n" }, { dataset: "../other" }, { dataset: "production\n" }, { apiVersion: "v2024-01-01" }, { apiVersion: "v2026-02-31" }, { token: "split\ntoken" }]) {
      expect(() => createClientGalleryCleanupTransport({ ...config, ...override }, { fetch: send })).toThrow(CleanupTransportError);
    }
    for (const ids of [["../../other"], ["gallery\n"], ["gallery\r"], ["same", "same"], Array.from({ length: 601 }, (_, i) => `x${i}`)]) await expect(transport(send).read(ids)).rejects.toMatchObject({ code: "provider_invalid" });
    for (const limits of [{ maxSnapshotBytes: 1 }, { maxLineBytes: 2_000_000 }, { maxDocuments: 1 }, { exportTimeoutMs: 60_001 }, { requestTimeoutMs: 0 }]) expect(() => cleanupTransportLimits(limits)).toThrow(CleanupTransportError);
    expect(send).not.toHaveBeenCalled();
  });
  it.each([undefined, "nonsense", "Sat, 24 Oct 2026 09:50:00 GMT", "Sat, 24 Oct 2026 10:10:00 GMT"]) ("refuses missing, invalid or skewed provider clock (%s)", async (providerDate) => {
    const headers: Record<string, string> = providerDate === undefined ? {} : { date: providerDate };
    const send = vi.fn().mockResolvedValue(new Response(JSON.stringify(doc("one")), { headers }));
    await expect(transport(send).snapshot()).rejects.toMatchObject({ code: "clock_untrusted" });
  });
  it.each([400, 401, 403, 404, 429])("classifies provider read HTTP %s without retries or leaked response bodies", async (status) => {
    const send = vi.fn().mockResolvedValue(response({ error: "synthetic secret" }, status));
    await expect(transport(send).snapshot()).rejects.toMatchObject({ code: "provider_refused", message: "provider_refused" });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("rejects terminal export errors, cursor markers, stream failures and oversized chunks", async () => {
    for (const value of [JSON.stringify(doc("one")) + '\n{"error":{"description":"private"}}\n', JSON.stringify(doc("one")) + '\n{"nextCursor":"more"}\n']) {
      await expect(transport(vi.fn().mockResolvedValue(response(value))).snapshot()).rejects.toMatchObject({ code: "snapshot_invalid" });
    }
    const broken = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encoder.encode(JSON.stringify(doc("one")) + "\n")); controller.error(new Error("private provider details")); } });
    await expect(transport(vi.fn().mockResolvedValue(new Response(broken, { headers: { date } }))).snapshot()).rejects.toMatchObject({ code: "provider_unavailable" });
    const huge = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024)); controller.close(); } });
    await expect(createClientGalleryCleanupTransport(config, { fetch: vi.fn().mockResolvedValue(new Response(huge, { headers: { date } })), now, limits: { maxSnapshotBytes: 1024 * 1024 } }).snapshot()).rejects.toMatchObject({ code: "snapshot_limit_exceeded" });
  });
  it("bounds JSON body bytes before decoding and duplicate-key parsing", async () => {
    const send = vi.fn().mockResolvedValue(response(" ".repeat(1024 * 1024 + 1)));
    await expect(transport(send).read(["gallery"])).rejects.toMatchObject({ code: "snapshot_limit_exceeded" });
  });
  it("rejects a known truncated export even if it ends at a complete JSON boundary", async () => {
    const data = JSON.stringify(doc("one")) + "\n";
    const send = vi.fn().mockResolvedValue(response(data, 200, { "content-length": String(encoder.encode(data).length + 5) }));
    await expect(transport(send).snapshot()).rejects.toMatchObject({ code: "provider_invalid" });
  });
  it("does not compare decompressed body bytes against the compressed wire length", async () => {
    const data = JSON.stringify(doc("one")) + "\n";
    const send = vi.fn().mockResolvedValue(response(data, 200, { "content-length": "10", "content-encoding": "gzip" }));
    expect((await transport(send).snapshot()).documentCount).toBe(1);
  });
  it("enforces header deadlines even when fetch ignores abort, then cancels the late body", async () => {
    vi.useFakeTimers();
    let resolve!: (response: Response) => void;
    const send = vi.fn().mockReturnValue(new Promise<Response>((done) => { resolve = done; }));
    const result = transport(send).snapshot();
    const assertion = expect(result).rejects.toMatchObject({ code: "deadline_exceeded" });
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    const cancellation = vi.fn();
    resolve(new Response(new ReadableStream({ cancel: cancellation }), { headers: { date } }));
    await vi.runAllTimersAsync();
    expect(cancellation).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
  });
  it("ends a stalled body without awaiting cancellation even when the reader ignores abort", async () => {
    vi.useFakeTimers();
    const cancellation = vi.fn().mockReturnValue(new Promise(() => {}));
    const body = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}), cancel: cancellation });
    const result = transport(vi.fn().mockResolvedValue(new Response(body, { headers: { date } }))).read(["gallery"]);
    const assertion = expect(result).rejects.toMatchObject({ code: "deadline_exceeded" });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    expect(cancellation).toHaveBeenCalledOnce();
  });
  it("checks monotonic elapsed time even when resolved microtasks starve the abort timer", async () => {
    let elapsed = 0;
    const send = vi.fn().mockImplementation(async () => {
      elapsed = 30_001;
      return response(JSON.stringify(doc("one")) + "\n");
    });
    const client = createClientGalleryCleanupTransport(config, { fetch: send, now, monotonicNow: () => elapsed });
    await expect(client.snapshot()).rejects.toMatchObject({ code: "deadline_exceeded" });
    expect(send).toHaveBeenCalledOnce();
  });
  it("checks elapsed time between body chunks without depending on a timer callback", async () => {
    let elapsed = 0;
    const body = new ReadableStream<Uint8Array>({ pull(controller) {
      elapsed = 10_001;
      controller.enqueue(encoder.encode(JSON.stringify({ documents: [doc("gallery")], omitted: [] })));
      controller.close();
    } });
    const send = vi.fn().mockResolvedValue(new Response(body, { headers: { date } }));
    const client = createClientGalleryCleanupTransport(config, { fetch: send, now, monotonicNow: () => elapsed });
    await expect(client.read(["gallery"])).rejects.toMatchObject({ code: "deadline_exceeded" });
  });
  it("keeps an elapsed successful mutation uncertain when timer callbacks have not run", async () => {
    let elapsed = 0;
    const send = vi.fn().mockImplementation(async () => {
      elapsed = 10_001;
      return response({ transactionId: "t1", results: [{ operation: "delete", id: "gallery" }] });
    });
    const client = createClientGalleryCleanupTransport(config, { fetch: send, now, monotonicNow: () => elapsed });
    expect(await client.mutate([{ delete: { id: "gallery" } }])).toEqual({ kind: "uncertain" });
    expect(send).toHaveBeenCalledOnce();
  });
  it("honors the caller's hard deadline and does no IO for an already-aborted request", async () => {
    const abort = new AbortController(); abort.abort();
    const send = vi.fn();
    await expect(transport(send).snapshot(abort.signal)).rejects.toMatchObject({ code: "deadline_exceeded" });
    expect(send).not.toHaveBeenCalled();
  });
  it("checks an external abort immediately before the deferred fetch starts", async () => {
    const abort = new AbortController();
    const send = vi.fn();
    const result = transport(send).snapshot(abort.signal);
    abort.abort();
    await expect(result).rejects.toMatchObject({ code: "deadline_exceeded" });
    expect(send).not.toHaveBeenCalled();
  });
  it("keeps a timed-out successful mutation body uncertain and never resends it", async () => {
    vi.useFakeTimers();
    const body = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) });
    const send = vi.fn().mockResolvedValue(new Response(body, { headers: { date } }));
    const result = transport(send).mutate([{ delete: { id: "gallery" } }]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toEqual({ kind: "uncertain" });
    expect(send).toHaveBeenCalledOnce();
  });
  it("accepts fully validated mutation success, without returning provider data", async () => {
    const send = vi.fn().mockResolvedValue(response({ transactionId: "t1", results: [{ operation: "delete", id: "gallery" }] }));
    expect(await transport(send).mutate([{ delete: { id: "gallery", ifRevisionID: "r1" } }])).toEqual({ kind: "committed", transactionId: "t1" });
    expect(send).toHaveBeenCalledOnce();
    const [url, options] = send.mock.calls[0];
    expect(new URL(url).searchParams.get("returnDocuments")).toBe("false");
    expect(JSON.parse(options.body)).toEqual({ mutations: [{ delete: { id: "gallery", ifRevisionID: "r1" } }] });
  });
  it.each([[409, "conflict"], [400, "refused"], [403, "refused"], [429, "refused"], [500, "uncertain"], [503, "uncertain"]] as const)("classifies mutation HTTP %s as %s without retry", async (status, kind) => {
    const send = vi.fn().mockResolvedValue(response({ error: "private" }, status));
    expect(await transport(send).mutate([{ delete: { id: "gallery" } }])).toEqual({ kind });
    expect(send).toHaveBeenCalledOnce();
  });
  it.each([
    {}, { transactionId: "t1" }, { transactionId: "t1", results: [] }, { transactionId: "t1", results: [null] },
    { transactionId: "t1", results: [{ operation: "unknown", id: "gallery" }] },
    { transactionId: "t1", results: [{ operation: "delete", id: "foreign" }] },
    '{"transactionId":"t1","transactionId":"t2","results":[]}', "lost body",
  ])("keeps malformed 200 mutation responses uncertain (%j)", async (value) => {
    expect(await transport(vi.fn().mockResolvedValue(response(value))).mutate([{ delete: { id: "gallery" } }])).toEqual({ kind: "uncertain" });
  });
  it("keeps missing provider Date, rejected fetch and lost mutation body uncertain", async () => {
    for (const send of [vi.fn().mockRejectedValue(new Error("private")), vi.fn().mockResolvedValue(new Response('{"transactionId":"t1","results":[]}'))]) {
      expect(await transport(send).mutate([{ delete: { id: "gallery" } }])).toEqual({ kind: "uncertain" });
    }
  });
  it("refuses oversized mutation bodies before transmission", async () => {
    const send = vi.fn();
    expect(await transport(send).mutate([{ create: { _id: "gallery", _type: "x", extra: "x".repeat(3_500_000) } }])).toEqual({ kind: "refused" });
    expect(send).not.toHaveBeenCalled();
  });
  it("rejects query deletes and replacement writes at this dedicated boundary", async () => {
    const send = vi.fn();
    for (const mutation of [{ delete: { query: '*[_type == "clientDeliveryGallery"]' } }, { createOrReplace: doc("gallery") }, { delete: { id: "gallery" }, patch: { id: "other" } }]) {
      expect(await transport(send).mutate([mutation])).toEqual({ kind: "refused" });
    }
    expect(send).not.toHaveBeenCalled();
  });
  it("does not call an incomplete result set committed", async () => {
    const send = vi.fn().mockResolvedValue(response({ transactionId: "t1", results: [{ operation: "delete", id: "gallery" }] }));
    expect(await transport(send).mutate([{ delete: { id: "gallery" } }, { delete: { id: "asset" } }])).toEqual({ kind: "uncertain" });
  });
  it("allows the provider to coalesce a temporary create+delete assertion", async () => {
    const send = vi.fn().mockResolvedValue(response({ transactionId: "t1", results: [{ operation: "delete", id: "gallery" }] }));
    expect(await transport(send).mutate([{ delete: { id: "gallery" } }, { create: doc("drafts.gallery") }, { delete: { id: "drafts.gallery" } }])).toEqual({ kind: "committed", transactionId: "t1" });
  });
});
