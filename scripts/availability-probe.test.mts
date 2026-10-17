import { describe, expect, it, vi } from "vitest";
import { htmlHasMarkers, parseAvailabilityConfig, publicProbeUrl } from "./availability-probe.mts";
import { probeAvailability } from "./check-availability.mts";
const check = { url: "https://example.test/", heading: "Photographs", link: { text: "Stories", href: "/stories" } };
const options = (fetcher: typeof fetch) => ({ fetch: fetcher, timeoutMs: 100, maxBytes: 1000 });
const html = '<h1>Photographs</h1><a href="/stories">Stories</a>';
const response = (body = html) => new Response(body, { headers: { "content-type": "text/html" } });
describe("availability decisions", () => {
  it("requires semantic HTML markers, excluding non-rendered and hidden markup", () => {
    expect(htmlHasMarkers(html, check)).toBe(true);
    for (const wrapper of ['<script>BODY</script>', '<template>BODY</template>', '<div hidden>BODY</div>', '<div aria-hidden="true">BODY</div>', '<div style="display:none !important">BODY</div>']) expect(htmlHasMarkers(wrapper.replace('BODY', html), check)).toBe(false);
    expect(htmlHasMarkers('<svg><text>Photographs</text></svg><a href="/stories">Stories</a>', check)).toBe(false);
    expect(htmlHasMarkers('<h1>Photo<span hidden>SECRET</span>graphs</h1><a href="/stories">Stories</a>', check)).toBe(true);
  });
  it.each(['inert', 'inert=""', 'inert="false"', 'INERT'])
    ("excludes inert subtrees by attribute presence: %s", (attribute) => {
      expect(htmlHasMarkers(`<div ${attribute}>${html}</div>`, check)).toBe(false);
    });
  it.each([
    '<h1 inert>Photographs</h1><a href="/stories">Stories</a>',
    '<h1>Photographs</h1><a inert href="/stories">Stories</a>',
    '<h1>Photo<span inert>graphs</span></h1><a href="/stories">Stories</a>',
    '<h1><span inert>Photographs</span></h1><a href="/stories">Stories</a>',
    '<h1>Photographs</h1><a href="/stories"><span inert>Stories</span></a>',
  ])("does not assemble a marker from inert elements or text: %s", (markup) => {
    expect(htmlHasMarkers(markup, check)).toBe(false);
  });
  it("still accepts independent visible markers and excludes inert text within them", () => {
    expect(htmlHasMarkers(`<div inert>${html}</div>${html}`, check)).toBe(true);
    expect(htmlHasMarkers('<h1>Photo<span inert>SECRET</span>graphs</h1><a href="/stories">Stories</a>', check)).toBe(true);
  });
  it.each(['https://user:secret@example.test/','http://example.test/','https://example.test/?token=secret','https://example.test/#private','https://127.0.0.2/','https://example.test/en/%70rivate/x','https://example.test/api/contact','https://host.local/','https://example.test/private-gallery/synthetic-handle','https://example.test/en/private-gallery-admin/login','https://example.test/en/%70rivate-gallery/synthetic-handle/exchange'])('refuses unsafe URL %s', (url) => expect(() => publicProbeUrl(url)).toThrow('invalid-probe-config'));
  it("accepts explicit loopback test URLs and validates strict configuration", () => {
    expect(publicProbeUrl('http://127.0.0.1:3100/')).toContain('3100');
    expect(parseAvailabilityConfig({ checks: [check], timeoutMs: 100, maxBytes: 1000 }).checks).toEqual([check]);
    expect(() => parseAvailabilityConfig({ checks: [check, check], timeoutMs: 100, maxBytes: 1000 })).toThrow();
  });
  it("probes synthetic responses and never leaks network error text", async () => {
    expect(await probeAvailability(check, options(vi.fn().mockResolvedValue(response())))).toMatchObject({ status: 'healthy' });
    expect(await probeAvailability(check, options(vi.fn().mockRejectedValue(new Error('TOKEN_SECRET'))))).toEqual({ status: 'unhealthy', code: 'request-failed' });
  });
  it("follows only one explicitly recorded permanent canonical redirect", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 308, headers: { location: '/canonical' } })).mockResolvedValueOnce(response());
    expect((await probeAvailability({ ...check, canonicalUrl: 'https://example.test/canonical' }, options(fetcher))).status).toBe('healthy');
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const status of [302, 307, 308]) expect((await probeAvailability(check, options(vi.fn().mockResolvedValue(new Response(null, { status, headers: { location: 'https://other.test/' } }))))).code).toBe('unexpected-redirect');
  });
  it("distinguishes status, content type, body cap and missing marker", async () => {
    const cases: [Response, string][] = [
      [new Response('', { status: 503 }), 'not-200'],
      [new Response(html), 'not-html'],
      [response('X'.repeat(1001)), 'body-too-large'],
      [response('<script>'+html+'</script>'), 'missing-marker'],
    ];
    for (const [saved, code] of cases) {
      const result = await probeAvailability(check, options(vi.fn().mockResolvedValue(saved)));
      expect(result.code).toBe(code);
    }
  });
  it("bounds stalled headers and bodies even when injected IO ignores abort", async () => {
    const never = new Promise<Response>(() => {});
    expect((await probeAvailability(check, { ...options(vi.fn().mockReturnValue(never)), timeoutMs: 20 })).code).toBe('timeout');
    const stalled = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}), cancel: () => new Promise(() => {}) });
    expect((await probeAvailability(check, { ...options(vi.fn().mockResolvedValue(new Response(stalled, { headers: { 'content-type': 'text/html' } }))), timeoutMs: 20 })).code).toBe('timeout');
  });
});

describe("terminal DNS-dot host classification", () => {
  it.each(["localhost", "local", "internal", "home", "invalid"].flatMap((suffix) =>
    ["", ".", ".."].map((dots) => `https://example.${suffix}${dots}/`)))
    ("refuses private-suffix host %s", (url) => expect(() => publicProbeUrl(url)).toThrow("invalid-probe-config"));
  it.each(["https://localhost./", "http://localhost./", "https://localhost../"])
    ("does not widen the explicit loopback exception to %s", (url) => expect(() => publicProbeUrl(url)).toThrow("invalid-probe-config"));
  it.each(["https://example.test./", "https://EXAMPLE.test./", "http://localhost:3100/", "http://127.0.0.1:3100/", "http://[::1]:3100/"])
    ("retains the original parsed URL for %s", (url) => expect(publicProbeUrl(url)).toBe(new URL(url).href));
});


describe("late availability response ownership (AB#317)", () => {
  function deferred<T>() {
    let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  }
  function watchedResponse(status = 200) {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(html)); } });
    const saved = new Response(body, { status, headers: { "content-type": "text/html", ...(status === 308 ? { location: "/canonical" } : {}) } });
    return { saved, cancel: vi.spyOn(body, "cancel"), getReader: vi.spyOn(body, "getReader") };
  }
  async function flush() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }

  it.each([200, 308])("cancels late initial status %s without reading or following it", async status => {
    vi.useFakeTimers();
    try {
      const pending = deferred<Response>(), late = watchedResponse(status);
      const fetcher = vi.fn().mockReturnValue(pending.promise);
      const result = probeAvailability({ ...check, canonicalUrl: "https://example.test/canonical" }, options(fetcher));
      await vi.advanceTimersByTimeAsync(100);
      expect(await result).toEqual({ status: "unhealthy", code: "timeout" });
      pending.resolve(late.saved); await flush();
      expect(late.cancel).toHaveBeenCalledTimes(1);
      expect(late.getReader).not.toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it("closes ownership before abort can synchronously resolve the fetch", async () => {
    vi.useFakeTimers();
    try {
      const late = watchedResponse();
      const fetcher = vi.fn<typeof fetch>((_url, init) => new Promise(resolve => {
        init!.signal!.addEventListener("abort", () => resolve(late.saved), { once: true });
      }));
      const result = probeAvailability(check, options(fetcher));
      await vi.advanceTimersByTimeAsync(100);
      expect(await result).toEqual({ status: "unhealthy", code: "timeout" });
      await flush(); expect(late.cancel).toHaveBeenCalledTimes(1);
      expect(late.getReader).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("uses the original deadline for canonical fetch and cancels each response once", async () => {
    vi.useFakeTimers();
    try {
      const first = deferred<Response>(), second = deferred<Response>();
      const redirect = watchedResponse(308), late = watchedResponse();
      const fetcher = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const result = probeAvailability({ ...check, canonicalUrl: "https://example.test/canonical" }, options(fetcher));
      await vi.advanceTimersByTimeAsync(40); first.resolve(redirect.saved);
      await vi.advanceTimersByTimeAsync(0); expect(fetcher).toHaveBeenCalledTimes(2);
      const initialSignal = fetcher.mock.calls[0][1].signal;
      expect(fetcher.mock.calls[1][1].signal).toBe(initialSignal);
      await vi.advanceTimersByTimeAsync(60);
      expect(await result).toEqual({ status: "unhealthy", code: "timeout" });
      expect(initialSignal.aborted).toBe(true);
      second.resolve(late.saved); await flush();
      expect(redirect.cancel).toHaveBeenCalledTimes(1);
      expect(late.cancel).toHaveBeenCalledTimes(1);
      expect(late.getReader).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it.each(["throw", "reject", "stall"])("does not await or expose late cleanup %s", async failure => {
    vi.useFakeTimers();
    try {
      const pending = deferred<Response>(), late = watchedResponse();
      late.cancel.mockImplementation(() => {
        if (failure === "throw") throw new Error("SYNTHETIC_PRIVATE_DETAIL");
        if (failure === "reject") return Promise.reject(new Error("SYNTHETIC_PRIVATE_DETAIL"));
        return new Promise<void>(() => {});
      });
      const result = probeAvailability(check, options(vi.fn().mockReturnValue(pending.promise)));
      await vi.advanceTimersByTimeAsync(100);
      expect(await result).toEqual({ status: "unhealthy", code: "timeout" });
      pending.resolve(late.saved); await flush();
      expect(late.cancel).toHaveBeenCalledTimes(1);
      expect(late.getReader).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it.each(["throw", "reject", "stall"])("keeps an HTTP refusal when current body cleanup %s", async failure => {
    const current = watchedResponse(503);
    current.cancel.mockImplementation(() => {
      if (failure === "throw") throw new Error("SYNTHETIC_PRIVATE_DETAIL");
      if (failure === "reject") return Promise.reject(new Error("SYNTHETIC_PRIVATE_DETAIL"));
      return new Promise<void>(() => {});
    });
    expect(await probeAvailability(check, options(vi.fn().mockResolvedValue(current.saved)))).toEqual({ status: "unhealthy", code: "not-200" });
    expect(current.cancel).toHaveBeenCalledTimes(1);
    expect(current.getReader).not.toHaveBeenCalled();
  });

  it("keeps synchronous transport errors redacted", async () => {
    const fetcher = vi.fn(() => { throw new Error("SYNTHETIC_PRIVATE_DETAIL"); });
    expect(await probeAvailability(check, options(fetcher))).toEqual({ status: "unhealthy", code: "request-failed" });
  });

  it.each([false, true])("observes a late transport rejection, canonical=%s", async canonical => {
    vi.useFakeTimers();
    try {
      const pending = deferred<Response>(), fetcher = vi.fn();
      if (canonical) fetcher.mockResolvedValueOnce(new Response(null, { status: 308, headers: { location: "/canonical" } }));
      fetcher.mockReturnValueOnce(pending.promise);
      const result = probeAvailability({ ...check, canonicalUrl: "https://example.test/canonical" }, options(fetcher));
      await vi.advanceTimersByTimeAsync(100);
      expect(await result).toEqual({ status: "unhealthy", code: "timeout" });
      pending.reject(new Error("SYNTHETIC_PRIVATE_DETAIL")); await flush();
      expect(fetcher).toHaveBeenCalledTimes(canonical ? 2 : 1);
    } finally { vi.useRealTimers(); }
  });

  it.each([false, true])("still consumes timely successful responses, canonical=%s", async canonical => {
    const fetcher = vi.fn(), saved = response();
    const prematureCancel = vi.spyOn(saved.body!, "cancel");
    if (canonical) fetcher.mockResolvedValueOnce(new Response(null, { status: 308, headers: { location: "/canonical" } }));
    fetcher.mockResolvedValueOnce(saved);
    expect(await probeAvailability({ ...check, canonicalUrl: "https://example.test/canonical" }, options(fetcher))).toEqual({ status: "healthy", code: "markers-present" });
    expect(prematureCancel).not.toHaveBeenCalled();
  });
});
