import { describe, expect, it, vi } from "vitest";

import { CONTACT_DELIVERY_TIMEOUT_MS } from "@/lib/contact-delivery";
import { createResendDeliveryAdapter } from "@/lib/contact-delivery-resend";

const settings = {
  apiKey: "re_test_key",
  from: "Studio Example <contact@studio.example>",
  to: "hello@studio.example",
};

const request = {
  subject: "New contact message — Studio Example",
  text: "Name: Jane Example",
  replyTo: "jane@example.com",
  idempotencyKey: "3f1d2b8c-6a4e-4c2f-9b7a-1d0e5c8f2a41",
};

function adapterAnswering(
  answer: Response | Error,
): { deliver: () => Promise<unknown>; fetchImplementation: ReturnType<typeof vi.fn> } {
  const fetchImplementation = vi.fn(async () => {
    if (answer instanceof Error) throw answer;
    return answer;
  });

  const adapter = createResendDeliveryAdapter({
    ...settings,
    fetchImplementation: fetchImplementation as unknown as typeof fetch,
  });

  return {
    deliver: () => adapter.deliver(request),
    fetchImplementation,
  };
}

function providerError(status: number, name?: string): Response {
  return Response.json(
    { name: name ?? "application_error", statusCode: status, message: "…" },
    { status },
  );
}

describe("createResendDeliveryAdapter", () => {
  it("posts the documented request to the documented endpoint", async () => {
    const { deliver, fetchImplementation } = adapterAnswering(
      Response.json({ id: "email-id" }, { status: 200 }),
    );

    await expect(deliver()).resolves.toEqual({ status: "delivered" });

    const [url, init] = fetchImplementation.mock.calls[0] as [
      string,
      RequestInit,
    ];
    const headers = init.headers as Record<string, string>;

    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(headers.Authorization).toBe(`Bearer ${settings.apiKey}`);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Idempotency-Key"]).toBe(
      `contact-form/${request.idempotencyKey}`,
    );
    expect(init.cache).toBe("no-store");
    expect(JSON.parse(String(init.body))).toEqual({
      from: settings.from,
      to: [settings.to],
      reply_to: request.replyTo,
      subject: request.subject,
      text: request.text,
    });
  });

  it("keeps the idempotency key inside the provider's 256-character limit", async () => {
    const { deliver, fetchImplementation } = adapterAnswering(
      Response.json({ id: "email-id" }, { status: 200 }),
    );
    await deliver();

    const headers = (fetchImplementation.mock.calls[0][1] as RequestInit)
      .headers as Record<string, string>;

    expect(headers["Idempotency-Key"].length).toBeLessThanOrEqual(256);
    expect(headers["Idempotency-Key"].length).toBeGreaterThan(0);
  });

  it("sends no HTML part, no attachments, and no tracking fields", async () => {
    const { deliver, fetchImplementation } = adapterAnswering(
      Response.json({ id: "email-id" }, { status: 200 }),
    );
    await deliver();

    const body = JSON.parse(
      String((fetchImplementation.mock.calls[0][1] as RequestInit).body),
    );

    expect(Object.keys(body).sort()).toEqual([
      "from",
      "reply_to",
      "subject",
      "text",
      "to",
    ]);
  });

  it("bounds the attempt with the endpoint's own timeout", async () => {
    const { deliver, fetchImplementation } = adapterAnswering(
      Response.json({ id: "email-id" }, { status: 200 }),
    );
    await deliver();

    const { signal } = fetchImplementation.mock.calls[0][1] as RequestInit;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(CONTACT_DELIVERY_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it.each([401, 403])(
    "treats a %d as the deployment's own configuration problem",
    async (status) => {
      const { deliver } = adapterAnswering(providerError(status));

      await expect(deliver()).resolves.toEqual({
        status: "failed",
        errorClass: "configuration",
        retryable: false,
      });
    },
  );

  it("treats a rate-limited call as retryable rather than as a rejection", async () => {
    const { deliver } = adapterAnswering(providerError(429, "rate_limit_exceeded"));

    await expect(deliver()).resolves.toEqual({
      status: "failed",
      errorClass: "provider-unavailable",
      retryable: true,
    });
  });

  it("treats a provider outage as retryable", async () => {
    const { deliver } = adapterAnswering(providerError(503));

    await expect(deliver()).resolves.toEqual({
      status: "failed",
      errorClass: "provider-unavailable",
      retryable: true,
    });
  });

  it("offers a retry while an identical request is still in flight", async () => {
    const { deliver } = adapterAnswering(
      providerError(409, "concurrent_idempotent_requests"),
    );

    await expect(deliver()).resolves.toEqual({
      status: "failed",
      errorClass: "provider-unavailable",
      retryable: true,
    });
  });

  it("does not offer a retry when the key was reused for a different message", async () => {
    const { deliver } = adapterAnswering(
      providerError(409, "invalid_idempotent_request"),
    );

    await expect(deliver()).resolves.toEqual({
      status: "failed",
      errorClass: "provider-rejected",
      retryable: false,
    });
  });

  it("does not offer a retry for a request the provider refused outright", async () => {
    const { deliver } = adapterAnswering(providerError(422, "validation_error"));

    await expect(deliver()).resolves.toEqual({
      status: "failed",
      errorClass: "provider-rejected",
      retryable: false,
    });
  });

  it("classifies an exceeded timeout as a timeout", async () => {
    const { deliver } = adapterAnswering(
      new DOMException("The operation timed out.", "TimeoutError"),
    );

    await expect(deliver()).resolves.toEqual({
      status: "failed",
      errorClass: "timeout",
      retryable: true,
    });
  });

  it("classifies an unreachable provider as unavailable", async () => {
    const { deliver } = adapterAnswering(new TypeError("fetch failed"));

    await expect(deliver()).resolves.toEqual({
      status: "failed",
      errorClass: "provider-unavailable",
      retryable: true,
    });
  });

  it("survives a provider error that is not JSON", async () => {
    const { deliver } = adapterAnswering(
      new Response("<html>gateway</html>", { status: 502 }),
    );

    await expect(deliver()).resolves.toEqual({
      status: "failed",
      errorClass: "provider-unavailable",
      retryable: true,
    });
  });
});
