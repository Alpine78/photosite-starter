import { describe, expect, it, vi } from "vitest";
import { htmlHasMarkers, parseAvailabilityConfig, publicProbeUrl } from "./availability-probe.mts";
import { probeAvailability } from "./check-availability.mts";
const check = { url: "https://example.test/", heading: "Photographs", link: { text: "Stories", href: "/stories" } };
const options = (fetcher: typeof fetch) => ({ fetch: fetcher, timeoutMs: 100, maxBytes: 1000 });
const html = '<h1>Photographs</h1><a href="/stories">Stories</a>';
const response = (body = html) => new Response(body, { headers: { "content-type": "text/html" } });
describe("availability decisions", () => {
  it("requires semantic HTML markers, excluding inert and hidden markup", () => {
    expect(htmlHasMarkers(html, check)).toBe(true);
    for (const wrapper of ['<script>BODY</script>', '<template>BODY</template>', '<div hidden>BODY</div>', '<div aria-hidden="true">BODY</div>', '<div style="display:none !important">BODY</div>']) expect(htmlHasMarkers(wrapper.replace('BODY', html), check)).toBe(false);
    expect(htmlHasMarkers('<svg><text>Photographs</text></svg><a href="/stories">Stories</a>', check)).toBe(false);
    expect(htmlHasMarkers('<h1>Photo<span hidden>SECRET</span>graphs</h1><a href="/stories">Stories</a>', check)).toBe(true);
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
