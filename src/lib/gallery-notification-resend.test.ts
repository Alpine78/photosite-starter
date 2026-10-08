import { describe, expect, it, vi } from "vitest";

import {
  GalleryNotificationValidationError,
  type GalleryNotificationRequest,
} from "@/lib/gallery-notification";
import { createResendGalleryNotificationTransport } from "@/lib/gallery-notification-resend";

const request: GalleryNotificationRequest = {
  to: "photographer@studio.example",
  subject: "Proof confirmation",
  text: "001 — DSC_0001.jpg\nCustomer: private",
  idempotencyKey: "proof-confirmation:gallery-a:2",
};

function transportAnswering(answer: Response | Error) {
  const fetchImplementation = vi.fn(async (_url: string, _init: RequestInit) => {
    void _url;
    void _init;
    if (answer instanceof Error) throw answer;
    return answer;
  });
  const transport = createResendGalleryNotificationTransport({
    apiKey: "re_test_key",
    from: "Studio <notices@studio.example>",
    fetchImplementation: fetchImplementation as unknown as typeof fetch,
  });
  return { transport, fetchImplementation };
}

describe("gallery Resend notification transport", () => {
  it("sends exactly the per-message recipient and only plain text", async () => {
    const { transport, fetchImplementation } = transportAnswering(
      Response.json({ id: "email-id" }),
    );
    await expect(transport.deliver(request)).resolves.toEqual({ status: "delivered" });
    await transport.deliver({
      ...request,
      to: "second@studio.example",
      idempotencyKey: "proof-confirmation-resend:gallery-a:2:attempt-1",
    });

    const [url, init] = fetchImplementation.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.cache).toBe("no-store");
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init.body))).toEqual({
      from: "Studio <notices@studio.example>",
      to: [request.to],
      subject: request.subject,
      text: request.text,
    });
    const secondBody = JSON.parse(String(fetchImplementation.mock.calls[1][1].body));
    expect(secondBody.to).toEqual(["second@studio.example"]);

    const headers = init.headers as Record<string, string>;
    const secondHeaders = fetchImplementation.mock.calls[1][1].headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe(
      "gallery-notification/proof-confirmation:gallery-a:2",
    );
    expect(secondHeaders["Idempotency-Key"]).not.toBe(headers["Idempotency-Key"]);
    expect(headers["Idempotency-Key"]).not.toMatch(/^contact-form\//);
    expect(headers["Idempotency-Key"].length).toBeLessThanOrEqual(256);
  });

  it("reuses one provider key for an automatic retry of the same attempt", async () => {
    const { transport, fetchImplementation } = transportAnswering(new TypeError("offline"));
    await transport.deliver(request);
    await transport.deliver(request);
    const keys = fetchImplementation.mock.calls.map(
      ([, init]) => (init.headers as Record<string, string>)["Idempotency-Key"],
    );
    expect(keys[0]).toBe(keys[1]);
  });

  it.each([
    [{ ...request, to: "bad\nrecipient@studio.example" }, "invalid-recipient"],
    [{ ...request, to: "customer,owner@studio.example" }, "invalid-recipient"],
    [{ ...request, idempotencyKey: "bad/key" }, "invalid-idempotency-key"],
    [{ ...request, idempotencyKey: "x".repeat(201) }, "invalid-idempotency-key"],
    [{ ...request, subject: "bad\nsubject" }, "invalid-content"],
    [{ ...request, text: "" }, "invalid-content"],
  ] as const)("rejects an invalid request before provider access", async (bad, reason) => {
    const { transport, fetchImplementation } = transportAnswering(Response.json({ id: "email-id" }));
    await expect(transport.deliver(bad)).rejects.toMatchObject({
      name: "GalleryNotificationValidationError",
      reason,
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("returns only redacted failure classes for provider responses and exceptions", async () => {
    const secret = "001 — DSC_0001.jpg Customer: private";
    const response = Response.json(
      { name: "validation_error", message: secret },
      { status: 422 },
    );
    const rejected = transportAnswering(response);
    const result = await rejected.transport.deliver(request);
    expect(result).toEqual({ status: "failed", errorClass: "provider-rejected", retryable: false });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain(request.to);

    const thrown = transportAnswering(new Error(secret));
    const unavailable = await thrown.transport.deliver(request);
    expect(unavailable).toEqual({ status: "failed", errorClass: "provider-unavailable", retryable: true });
    expect(JSON.stringify(unavailable)).not.toContain(secret);
    expect(JSON.stringify(unavailable)).not.toContain(request.to);
  });

  it("keeps validation errors free of recipient and content", async () => {
    const { transport } = transportAnswering(Response.json({ id: "email-id" }));
    let error: unknown;
    try {
      await transport.deliver({ ...request, to: "private\nrecipient@studio.example" });
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(GalleryNotificationValidationError);
    expect(String(error)).not.toContain("private");
    expect(JSON.stringify(error)).not.toContain(request.text);
  });
});

describe("shared gallery provider redirect refusal", () => {
  it.each([301, 302, 303, 307, 308])("keeps HTTP %d from forwarding gallery notification content", async status => {
    let redirected = 0;
    const fetchImplementation = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.resend.com/emails");
      if (init?.redirect !== "manual") { redirected++; return Response.json({ id: "foreign-success" }); }
      return Response.json({ name: "monthly_quota_exceeded" }, { status, headers: { location: "https://redirect.example/emails" } });
    });
    const transport = createResendGalleryNotificationTransport({ apiKey: "re_test_key", from: "Studio <notices@studio.example>", fetchImplementation: fetchImplementation as typeof fetch });
    await expect(transport.deliver(request)).resolves.toEqual({ status: "failed", errorClass: "provider-rejected", retryable: false });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(redirected).toBe(0);
  });
});
