import { describe, expect, it, vi } from "vitest";
import { contactSmokePlan, sendContactSmoke } from "./contact-delivery-smoke.mts";

const origin = "https://release.example.test", id = "12345678-1234-4234-8234-123456789abc";
function response(value: unknown = { status: "delivered", correlationId: id }, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
}
describe("one-shot contact delivery evidence", () => {
  it("sends one synthetic closed payload with same-origin headers and no honeypot", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(response());
    const report = await sendContactSmoke(origin, id, { fetchImplementation: f });
    expect(report).toMatchObject({ status: "provider-accepted", correlationId: id, mailboxArrivalVerified: false, replyToVerified: false, automaticRetry: false });
    expect(f).toHaveBeenCalledOnce();
    expect(f.mock.calls[0][0]).toBe(origin + "/api/contact");
    const options = f.mock.calls[0][1]!;
    expect(options).toMatchObject({ method: "POST", redirect: "manual", credentials: "omit", headers: { origin, "sec-fetch-site": "same-origin" } });
    const body = JSON.parse(String(options.body));
    expect(Object.keys(body).sort()).toEqual(["company", "email", "message", "name", "subject", "submissionId"]);
    expect(body.company).toBe(""); expect(body.email).toBe("release-verification@example.com"); expect(body.submissionId).toBe(id);
    expect(JSON.stringify(report)).not.toContain(body.email);
  });
  it.each(["https://example.test/path", "https://user:secret@example.test", "https://example.test?token=x", "https://example.test#x", "http://external.test"])("refuses unsafe target %s before sending", async (target) => {
    const f = vi.fn<typeof fetch>();
    await expect(sendContactSmoke(target, id, { fetchImplementation: f })).rejects.toThrow(); expect(f).not.toHaveBeenCalled();
  });
  it("requires a bounded UUID before any request", async () => {
    const f = vi.fn<typeof fetch>(); await expect(sendContactSmoke(origin, "PRIVATE", { fetchImplementation: f })).rejects.toThrow("CONTACT_SMOKE_ID"); expect(f).not.toHaveBeenCalled();
    expect(contactSmokePlan("http://127.0.0.1:3000", id).origin).toBe("http://127.0.0.1:3000");
  });
  it.each([302, 403, 422, 429, 500, 503])("does not follow or retry HTTP %s", async (status) => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response("PRIVATE_PROVIDER", { status }));
    expect(await sendContactSmoke(origin, id, { fetchImplementation: f })).toMatchObject({ status: "unverified", httpStatus: status }); expect(f).toHaveBeenCalledOnce();
  });
  it.each([{ status: "delivered" }, { status: "delivered", correlationId: "PRIVATE" }, { status: "delivered", correlationId: id, secret: "PRIVATE" }, { status: "accepted", correlationId: id }, []])("does not accept an unverified 200 body %j", async (value) => {
    const report = await sendContactSmoke(origin, id, { fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(response(value)) });
    expect(report.status).toBe("ambiguous"); expect(JSON.stringify(report)).not.toContain("PRIVATE");
  });
  it.each<Record<string, string>>([{ "cache-control": "public" }, { "content-type": "text/html" }, { "access-control-allow-origin": "*" }])("refuses unexpected headers %j", async (headers) => {
    expect((await sendContactSmoke(origin, id, { fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(response(undefined, headers)) })).status).toBe("ambiguous");
  });
  it("bounds response bytes and never echoes oversized response data", async () => {
    const report = await sendContactSmoke(origin, id, { fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(response("PRIVATE".repeat(1000))) });
    expect(report.status).toBe("ambiguous"); expect(JSON.stringify(report)).not.toContain("PRIVATE");
  });
  it("times out header and body hangs and cancels body reads without hanging on cleanup", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({ pull() {}, cancel });
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { headers: { "cache-control": "no-store", "content-type": "application/json" } }));
    const report = await sendContactSmoke(origin, id, { fetchImplementation: f, timeoutMs: 15 });
    expect(report.status).toBe("ambiguous"); expect(cancel).toHaveBeenCalledOnce(); expect(f.mock.calls[0][1]?.signal?.aborted).toBe(true);
    const stalled = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    expect((await sendContactSmoke(origin, id, { fetchImplementation: stalled, timeoutMs: 15 })).status).toBe("ambiguous"); expect(stalled).toHaveBeenCalledOnce();
  });
  it("redacts injected request and JSON errors", async () => {
    const f = vi.fn<typeof fetch>().mockRejectedValue(new Error("PRIVATE_TOKEN"));
    expect(JSON.stringify(await sendContactSmoke(origin, id, { fetchImplementation: f }))).not.toContain("PRIVATE_TOKEN");
    f.mockResolvedValue(new Response("PRIVATE_MALFORMED", { headers: { "cache-control": "no-store", "content-type": "application/json" } }));
    expect((await sendContactSmoke(origin, id, { fetchImplementation: f })).status).toBe("ambiguous");
  });
});
