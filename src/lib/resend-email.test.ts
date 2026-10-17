import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendResendEmail } from "@/lib/resend-email";
import { createResendDeliveryAdapter } from "@/lib/contact-delivery-resend";
import { createResendGalleryNotificationTransport } from "@/lib/gallery-notification-resend";

const cap = 16_384;
const settings = { apiKey: "synthetic-key", from: "synthetic@example.test" };
const request = { to: "recipient@example.test", subject: "synthetic", text: "synthetic", providerIdempotencyKey: "synthetic-key" };
const timeout = { status: "failed", errorClass: "timeout", retryable: true };
function deliver(answer: Response, milliseconds = 100) {
  const fetcher = vi.fn(async () => answer);
  return { fetcher, pending: sendResendEmail({ ...settings, fetchImplementation: fetcher }, request, milliseconds) };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function streamed(chunks: readonly Uint8Array[], status = 429, cancel: () => void | PromiseLike<void> = () => {}) {
  let index = 0;
  const cancellation = vi.fn(cancel);
  const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (index < chunks.length) controller.enqueue(chunks[index++]); else controller.close();
  });
  const body = new ReadableStream<Uint8Array>({ pull, cancel: cancellation }, { highWaterMark: 0 });
  return { response: new Response(body, { status }), pull, cancellation };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("shared Resend response resource bounds", () => {
  it("releases an unused successful body without reading it", async () => {
    const f = streamed([new Uint8Array(128)], 200), json = vi.spyOn(f.response, "json");
    const { pending, fetcher } = deliver(f.response);
    await expect(pending).resolves.toEqual({ status: "delivered" });
    expect(f.pull).not.toHaveBeenCalled(); expect(json).not.toHaveBeenCalled(); expect(f.cancellation).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledOnce();
  });
  it("stops an oversized error body instead of reading the original 1,638,400-byte reproduction", async () => {
    const f = streamed(Array.from({ length: 100 }, () => new Uint8Array(cap).fill(120)), 502);
    await expect(deliver(f.response).pending).resolves.toMatchObject({ errorClass: "provider-unavailable" });
    expect(f.pull.mock.calls.length).toBeLessThanOrEqual(2); expect(f.cancellation).toHaveBeenCalledOnce();
  });
  it("keeps a valid error name at the exact cap and rejects its over-limit equivalent", async () => {
    const body = JSON.stringify({ name: "daily_quota_exceeded", message: "private" });
    const exact = new TextEncoder().encode(body + " ".repeat(cap - Buffer.byteLength(body)));
    await expect(deliver(streamed([exact]).response).pending).resolves.toMatchObject({ errorClass: "provider-quota-exceeded", retryable: false });
    for (const chunks of [[new Uint8Array(cap + 1)], [exact, new Uint8Array([32])]]) {
      const f = streamed(chunks); await expect(deliver(f.response).pending).resolves.toMatchObject({ errorClass: "provider-unavailable", retryable: true });
      expect(f.cancellation).toHaveBeenCalledOnce();
    }
  });
  it("measures decoded stream bytes even when Content-Length lies", async () => {
    const f = streamed([new Uint8Array(cap + 1)]); f.response.headers.set("content-length", "1");
    await expect(deliver(f.response).pending).resolves.toMatchObject({ errorClass: "provider-unavailable" }); expect(f.cancellation).toHaveBeenCalledOnce();
    const valid = Response.json({ name: "monthly_quota_exceeded" }, { status: 429 }); valid.headers.set("content-length", "999999999");
    await expect(deliver(valid).pending).resolves.toMatchObject({ errorClass: "provider-quota-exceeded" });
  });
  it("counts UTF-8 bytes rather than characters", async () => {
    const body = new TextEncoder().encode(JSON.stringify({ name: "daily_quota_exceeded", message: "é".repeat(cap / 2) }));
    expect(body.length).toBeGreaterThan(cap);
    await expect(deliver(streamed([body]).response).pending).resolves.toMatchObject({ errorClass: "provider-unavailable" });
  });
  it.each(["rate_limit_exceeded", "concurrent_idempotent_requests", "daily_quota_exceeded", "monthly_quota_exceeded"])("preserves the bounded %s name classification", async name => {
    await expect(deliver(Response.json({ name }, { status: 429 })).pending).resolves.toMatchObject({ errorClass: name.includes("quota") ? "provider-quota-exceeded" : "provider-unavailable" });
  });
  it("strips a UTF-8 BOM and discards malformed or non-object error bodies without echoing provider prose", async () => {
    await expect(deliver(new Response("\ufeff" + JSON.stringify({ name: "daily_quota_exceeded" }), { status: 429 })).pending).resolves.toMatchObject({ errorClass: "provider-quota-exceeded" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {}), info = vi.spyOn(console, "info").mockImplementation(() => {});
    for (const body of ["{private-provider-body", "<html>private-provider-body</html>", "null", "[]", '{"name":42}', JSON.stringify({ name: "private-provider-body".repeat(200) }), new Uint8Array([0xff])]) {
      const result = await deliver(new Response(body, { status: 401 })).pending;
      expect(result).toEqual({ status: "failed", errorClass: "configuration", retryable: false }); expect(JSON.stringify(result)).not.toContain("private-provider-body");
    }
    expect(error).not.toHaveBeenCalled(); expect(info).not.toHaveBeenCalled();
  });
  it.each([200, 302, 502])("handles a null body with status %i", async status => {
    await expect(deliver(new Response(null, { status })).pending).resolves.toMatchObject(status === 200 ? { status: "delivered" } : { status: "failed", errorClass: status === 302 ? "provider-rejected" : "provider-unavailable" });
  });
  it("refuses redirects without parsing or trusting their error name", async () => {
    const f = streamed([new TextEncoder().encode('{"name":"daily_quota_exceeded"}')], 307);
    await expect(deliver(f.response).pending).resolves.toMatchObject({ errorClass: "provider-rejected" });
    expect(f.pull).not.toHaveBeenCalled(); expect(f.cancellation).toHaveBeenCalledOnce();
  });
  it("uses HTTP fallback for an unrelated provider-body AbortError", async () => {
    const body = new ReadableStream({ pull(controller) { controller.error(new DOMException("private-provider-body", "AbortError")); } });
    await expect(deliver(new Response(body, { status: 401 })).pending).resolves.toMatchObject({ errorClass: "configuration", retryable: false });
  });
  it("refuses non-byte error chunks with the existing status fallback", async () => {
    const cancellation = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue("private-provider-body" as unknown as Uint8Array); }, cancel: cancellation });
    await expect(deliver(new Response(body, { status: 401 })).pending).resolves.toEqual({ status: "failed", errorClass: "configuration", retryable: false });
    expect(cancellation).toHaveBeenCalledOnce();
  });
  it("observes rejected reader cleanup and synchronous body-cancel throws", async () => {
    const f = streamed([new Uint8Array(cap + 1)], 429, () => Promise.reject(new Error("private-provider-body")));
    await expect(deliver(f.response).pending).resolves.toMatchObject({ errorClass: "provider-unavailable" }); expect(f.cancellation).toHaveBeenCalledOnce();
    const success = streamed([], 200); vi.spyOn(success.response.body!, "cancel").mockImplementation(() => { throw new Error("private-provider-body"); });
    await expect(deliver(success.response).pending).resolves.toEqual({ status: "delivered" });
  });
  it("does not await rejected or never-settling success-body cancellation", async () => {
    for (const cancel of [() => Promise.reject(new Error("private-provider-body")), () => new Promise<void>(() => {})]) {
      const f = streamed([], 200, cancel); await expect(deliver(f.response).pending).resolves.toEqual({ status: "delivered" }); expect(f.cancellation).toHaveBeenCalledOnce();
    }
  });
  it.each([0, -1, 1.5, NaN, Infinity, 2 ** 31])("refuses invalid timeout %s without invoking fetch", async milliseconds => {
    const f = deliver(new Response(null), milliseconds); await expect(f.pending).resolves.toEqual({ status: "failed", errorClass: "configuration", retryable: false }); expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("enforces a fetch deadline when the port ignores AbortSignal and cleans its late response once", async () => {
    vi.useFakeTimers(); const response = deferred<Response>(), cancellation = vi.fn();
    const fetcher = vi.fn(() => response.promise), pending = sendResendEmail({ ...settings, fetchImplementation: fetcher }, request, 20);
    await vi.advanceTimersByTimeAsync(20); await expect(pending).resolves.toEqual(timeout);
    response.resolve(new Response(new ReadableStream({ cancel: cancellation }))); await vi.advanceTimersByTimeAsync(0);
    expect(cancellation).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it("observes a fetch rejection arriving after the deadline", async () => {
    vi.useFakeTimers(); const response = deferred<Response>();
    const pending = sendResendEmail({ ...settings, fetchImplementation: () => response.promise }, request, 20);
    await vi.advanceTimersByTimeAsync(20); await expect(pending).resolves.toEqual(timeout);
    response.reject(new Error("private-provider-body")); await vi.advanceTimersByTimeAsync(0);
  });
  it("spends the remaining deadline on the body instead of starting a second timeout", async () => {
    vi.useFakeTimers();
    const body = new ReadableStream<Uint8Array>({ pull() { return new Promise<void>(() => {}); } }, { highWaterMark: 0 });
    const fetcher = () => new Promise<Response>(resolve => { setTimeout(() => resolve(new Response(body, { status: 429 })), 15); });
    const pending = sendResendEmail({ ...settings, fetchImplementation: fetcher }, request, 20);
    let settled = false; void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(15); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(5); await expect(pending).resolves.toEqual(timeout); expect(settled).toBe(true);
  });
  it.each([409, 429])("uses the same attempt deadline for a stalled %i error body and never-settling cancel", async status => {
    vi.useFakeTimers(); const cancellation = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({ pull() { return new Promise<void>(() => {}); }, cancel: cancellation }, { highWaterMark: 0 });
    const pending = deliver(new Response(body, { status }), 20).pending;
    await vi.advanceTimersByTimeAsync(20); await expect(pending).resolves.toEqual(timeout); expect(cancellation).toHaveBeenCalledOnce(); expect(body.locked).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });
  it("does not let endless empty chunks starve the deadline", async () => {
    vi.useFakeTimers(); const cancellation = vi.fn();
    const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array()); }, cancel: cancellation }, { highWaterMark: 0 });
    const pending = deliver(new Response(body, { status: 429 }), 20).pending;
    await vi.advanceTimersByTimeAsync(20); await expect(pending).resolves.toEqual(timeout); expect(cancellation).toHaveBeenCalledOnce();
  });
  it("keeps at most one live deadline subscription over many reads and removes it on completion", async () => {
    const active = new Set<EventListenerOrEventListenerObject>(); let peak = 0;
    const bytes = new TextEncoder().encode(JSON.stringify({ name: "daily_quota_exceeded" }) + " ".repeat(1000));
    const f = streamed([...bytes].map(byte => new Uint8Array([byte])));
    const fetcher = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      const signal = init!.signal!, add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
      vi.spyOn(signal, "addEventListener").mockImplementation((type, listener, options) => {
        if (type === "abort" && listener) { active.add(listener); peak = Math.max(peak, active.size); }
        add(type, listener, options);
      });
      vi.spyOn(signal, "removeEventListener").mockImplementation((type, listener, options) => {
        if (type === "abort" && listener) active.delete(listener);
        remove(type, listener, options);
      });
      return Promise.resolve(f.response);
    });
    await expect(sendResendEmail({ ...settings, fetchImplementation: fetcher }, request, 1000)).resolves.toMatchObject({ errorClass: "provider-quota-exceeded" });
    expect(f.pull.mock.calls.length).toBeGreaterThan(1000); expect(peak).toBeLessThanOrEqual(1); expect(active.size).toBe(0);
  });
  it("does not retain completed read buffers behind the still-running attempt deadline", () => {
    // A separate pinned Node process provides explicit GC without changing the
    // test runner's heap. Inspect while the attempt is live, before final cleanup.
    const script = `
      import { pathToFileURL } from 'node:url';
      const { sendResendEmail } = await import(pathToFileURL(process.argv[1]).href);
      const references = []; let produced = 0, retained = -1;
      const body = new ReadableStream({ pull(controller) {
        if (produced++ < 256) {
          const bytes = new Uint8Array(); references.push(new WeakRef(bytes)); controller.enqueue(bytes);
        } else return new Promise(resolve => setImmediate(() => {
          global.gc();
          retained = references.slice(0, -8).filter(reference => reference.deref() !== undefined).length;
          controller.enqueue(new TextEncoder().encode('{"name":"daily_quota_exceeded"}'));
          controller.close(); resolve();
        }));
      } }, { highWaterMark: 0 });
      const outcome = await sendResendEmail({ apiKey: 'synthetic', from: 'synthetic@example.test', fetchImplementation: async () => new Response(body, { status: 429 }) },
        { to: 'synthetic@example.test', subject: 'synthetic', text: 'synthetic', providerIdempotencyKey: 'synthetic' }, 10000);
      console.log(JSON.stringify({ retained, outcome }));
    `;
    const result = JSON.parse(execFileSync(process.execPath, ["--expose-gc", "--conditions=react-server", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--input-type=module", "-e", script, fileURLToPath(new URL("./resend-email.ts", import.meta.url))], { encoding: "utf8", timeout: 20_000, maxBuffer: 4096 }));
    expect(result.outcome).toMatchObject({ errorClass: "provider-quota-exceeded" });
    expect(result.retained).toBeGreaterThanOrEqual(0); expect(result.retained).toBeLessThan(8);
  });
  it("cancels a response that resolves in the same tick as the deadline exactly once", async () => {
    vi.useFakeTimers(); const cancellation = vi.fn();
    const fetcher = () => new Promise<Response>(resolve => { setTimeout(() => resolve(new Response(new ReadableStream({ cancel: cancellation }))), 20); });
    const pending = sendResendEmail({ ...settings, fetchImplementation: fetcher }, request, 20);
    await vi.advanceTimersByTimeAsync(20); await expect(pending).resolves.toEqual(timeout); expect(cancellation).toHaveBeenCalledOnce();
  });
  it.each(["contact", "gallery"])("applies bounded body fallback and success cleanup through the real %s caller", async caller => {
    for (const status of [200, 429]) {
      const f = streamed([new Uint8Array(cap + 1)], status), fetcher = vi.fn(async () => f.response);
      const outcome = caller === "contact"
        ? await createResendDeliveryAdapter({ ...settings, to: request.to, fetchImplementation: fetcher }).deliver({ subject: request.subject, text: request.text, replyTo: "synthetic@example.test", idempotencyKey: "synthetic-key" })
        : await createResendGalleryNotificationTransport({ ...settings, fetchImplementation: fetcher }).deliver({ to: request.to, subject: request.subject, text: request.text, idempotencyKey: "proof-confirmation:synthetic-gallery:1" });
      expect(outcome).toMatchObject(status === 200 ? { status: "delivered" } : { errorClass: "provider-unavailable" });
      expect(fetcher).toHaveBeenCalledOnce(); expect(f.cancellation).toHaveBeenCalledOnce(); if (status === 200) expect(f.pull).not.toHaveBeenCalled();
    }
  });
});
