import { beforeEach, describe, expect, it, vi } from "vitest";

const delivery = vi.hoisted(() => ({
  deliver: vi.fn(),
}));

vi.mock("@/lib/contact-delivery", () => ({
  buildContactEmail: () => ({
    subject: "Contact message",
    text: "Bounded synthetic test message",
    replyTo: "visitor@route.test",
  }),
  getContactDeliveryAdapter: () => ({
    name: "test",
    deliver: delivery.deliver,
  }),
}));

vi.mock("@/lib/deployment-config", () => ({
  getDefaultLocaleLabels: () => ({}),
}));

vi.mock("@/lib/site-settings", () => ({
  getSiteSettings: async () => ({ siteName: "Route Test" }),
}));

import { POST } from "@/app/api/contact/route";

const ENDPOINT = "https://studio.example/api/contact";
const VALID_BODY = {
  name: "Harness Visitor",
  email: "visitor@route.test",
  message: "Bounded synthetic test message.",
  company: "",
  submissionId: "73e66a66-8d17-4dd7-9d9a-2efa2412318c",
};

function contactRequest({
  address,
  contentType = "application/json",
  origin = "https://studio.example",
}: {
  address: string;
  contentType?: string;
  origin?: string;
}): Request {
  return new Request(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": contentType,
      host: "studio.example",
      origin,
      "x-forwarded-for": address,
    },
    body: JSON.stringify(VALID_BODY),
  });
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  vi.restoreAllMocks();
  delivery.deliver.mockReset();
  delivery.deliver.mockResolvedValue({ status: "delivered" });
});

describe("POST /api/contact", () => {
  it.each([
    {
      label: "another origin",
      address: "192.0.2.10",
      request: { origin: "https://attacker.example" },
      status: 403,
      reason: "cross-origin",
    },
    {
      label: "a non-JSON content type",
      address: "192.0.2.11",
      request: { contentType: "text/plain" },
      status: 415,
      reason: "unsupported-media-type",
    },
  ])(
    "refuses $label before reading the body or spending the throttle",
    async ({ address, request: requestOverrides, status, reason }) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(console, "info").mockImplementation(() => {});
      const refusedRequest = contactRequest({ address, ...requestOverrides });

      const refused = await POST(refusedRequest);

      expect(refused.status).toBe(status);
      expect(await responseBody(refused)).toEqual({
        status: "rejected",
        reason,
      });
      expect(refusedRequest.bodyUsed).toBe(false);
      expect(error).not.toHaveBeenCalled();

      // The refused request did not consume this address's allowance: all ten
      // plausible submissions still fit in the same limiter window.
      for (let attempt = 0; attempt < 10; attempt += 1) {
        expect((await POST(contactRequest({ address }))).status).toBe(200);
      }
    },
  );

  it("logs one throttling refusal and returns only its traceable reference", async () => {
    const address = "192.0.2.12";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await POST(contactRequest({ address }))).status).toBe(200);
    }

    const firstRequest = contactRequest({ address });
    const first = await POST(firstRequest);
    const firstBody = await responseBody(first);
    const second = await POST(contactRequest({ address }));

    expect(first.status).toBe(429);
    expect(firstRequest.bodyUsed).toBe(false);
    expect(firstBody).toMatchObject({
      status: "rejected",
      reason: "rate-limited",
      correlationId: expect.any(String),
    });
    expect(await responseBody(second)).toEqual({
      status: "rejected",
      reason: "rate-limited",
    });
    expect(error).toHaveBeenCalledOnce();
    expect(JSON.parse(String(error.mock.calls[0][0]))).toMatchObject({
      correlationId: firstBody.correlationId,
      state: "rejected",
      errorClass: "rate-limited",
    });
  });

  it.each([
    {
      errorClass: "provider-quota-exceeded",
      retryable: false,
      expectedStatus: 502,
      address: "198.51.100.20",
    },
    {
      errorClass: "provider-unavailable",
      retryable: true,
      expectedStatus: 503,
      address: "198.51.100.21",
    },
  ] as const)(
    "carries the adapter's $retryable retry decision in the response",
    async ({ errorClass, retryable, expectedStatus, address }) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(console, "info").mockImplementation(() => {});
      delivery.deliver.mockResolvedValueOnce({
        status: "failed",
        errorClass,
        retryable,
      });

      const response = await POST(contactRequest({ address }));

      expect(response.status).toBe(expectedStatus);
      expect(await responseBody(response)).toMatchObject({
        status: "failed",
        retryable,
        correlationId: expect.any(String),
      });
    },
  );
});
