import { beforeEach, describe, expect, it, vi } from "vitest";

const delivery = vi.hoisted(() => ({ deliver: vi.fn() }));
const enquiryMedia = vi.hoisted(() => ({ resolveEnquiryTarget: vi.fn() }));
const siteSettings = vi.hoisted(() => ({ getSiteSettings: vi.fn() }));

vi.mock("@/lib/contact-delivery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/contact-delivery")>();
  return {
    ...actual,
    buildEnquiryEmail: () => ({
      subject: "Gallery enquiry: some-photo — Route Test",
      text: "Bounded synthetic enquiry",
      replyTo: "visitor@route.test",
    }),
    getContactDeliveryAdapter: () => ({ name: "test", deliver: delivery.deliver }),
  };
});

vi.mock("@/lib/enquiry-media", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/enquiry-media")>();
  return { ...actual, resolveEnquiryTarget: enquiryMedia.resolveEnquiryTarget };
});

vi.mock("@/lib/deployment-config", () => ({
  getDefaultLocaleLabels: () => ({}),
}));

vi.mock("@/lib/site-settings", () => ({
  getSiteSettings: siteSettings.getSiteSettings,
}));

import { POST } from "@/app/api/enquiry/route";
import { EnquiryResolutionError } from "@/lib/enquiry-media";

const ENDPOINT = "https://studio.example/api/enquiry";

const CURATED_CONTEXT = {
  kind: "curated",
  locale: "en-GB",
  contentId: "content-selected-work",
  itemId: "selected-work-coastal-landscape",
};

const VALID_BODY = {
  name: "Harness Visitor",
  email: "visitor@route.test",
  message: "Is this photograph available as a print?",
  company: "",
  submissionId: "73e66a66-8d17-4dd7-9d9a-2efa2412318c",
  ...CURATED_CONTEXT,
};

const RESOLVED_TARGET = {
  kind: "curated" as const,
  mediaId: "coastal-landscape",
  placementId: "selected-work-coastal-landscape",
  contentId: "content-selected-work",
  archiveLocator: "archive-locator-sentinel",
  caption: "caption-sentinel",
  credit: "credit-sentinel",
};

// The route's rate limiter is a per-module singleton that `beforeEach` cannot
// reset, so each request defaults to its own synthetic address — the same
// approach the contact route test takes. A test that exercises the throttle
// passes one fixed address on purpose.
let addressCounter = 0;
function nextAddress(): string {
  addressCounter += 1;
  return `192.0.2.${addressCounter % 200}`;
}

function enquiryRequest({
  address,
  contentType = "application/json",
  origin = "https://studio.example",
  body = VALID_BODY,
}: {
  address?: string;
  contentType?: string;
  origin?: string;
  body?: unknown;
} = {}): Request {
  const clientAddress = address ?? nextAddress();
  return new Request(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": contentType,
      host: "studio.example",
      origin,
      "x-forwarded-for": clientAddress,
    },
    body: JSON.stringify(body),
  });
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

let logLines: string[];

beforeEach(() => {
  vi.restoreAllMocks();
  delivery.deliver.mockReset().mockResolvedValue({ status: "delivered" });
  enquiryMedia.resolveEnquiryTarget.mockReset().mockResolvedValue(RESOLVED_TARGET);
  siteSettings.getSiteSettings
    .mockReset()
    .mockResolvedValue({ siteName: "Route Test" });

  logLines = [];
  const capture = (line: unknown) => {
    logLines.push(String(line));
  };
  vi.spyOn(console, "info").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
});

function events(): Array<Record<string, unknown>> {
  return logLines
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return undefined;
      }
    })
    .filter((event): event is Record<string, unknown> => event !== undefined);
}

describe("POST /api/enquiry — before a submission exists", () => {
  it.each([
    { label: "another origin", overrides: { origin: "https://attacker.example" }, status: 403, reason: "cross-origin" },
    { label: "a non-JSON content type", overrides: { contentType: "text/plain" }, status: 415, reason: "unsupported-media-type" },
  ])("refuses $label without resolving, delivering, or logging", async ({ overrides, status, reason }) => {
    const response = await POST(enquiryRequest({ address: "192.0.2.10", ...overrides }));

    expect(response.status).toBe(status);
    expect(await responseBody(response)).toMatchObject({ status: "rejected", reason });
    expect(enquiryMedia.resolveEnquiryTarget).not.toHaveBeenCalled();
    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(logLines).toHaveLength(0);
  });

  it("throttles a client after the window allowance, logging once", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const ok = await POST(enquiryRequest({ address: "198.51.100.5" }));
      expect(ok.status).toBe(200);
    }
    const limited = await POST(enquiryRequest({ address: "198.51.100.5" }));

    expect(limited.status).toBe(429);
    expect(await responseBody(limited)).toMatchObject({ status: "rejected", reason: "rate-limited" });
    expect(events().filter((e) => e.errorClass === "rate-limited")).toHaveLength(1);

    const again = await POST(enquiryRequest({ address: "198.51.100.5" }));
    expect(again.status).toBe(429);
    expect(events().filter((e) => e.errorClass === "rate-limited")).toHaveLength(1);
  });
});

describe("POST /api/enquiry — every response is uncacheable and same-origin only", () => {
  it.each([
    { label: "a success", arrange: () => {} },
    {
      label: "a resolver rejection",
      arrange: () =>
        enquiryMedia.resolveEnquiryTarget.mockRejectedValueOnce(
          new EnquiryResolutionError("unknown-item"),
        ),
    },
    {
      label: "a store failure",
      arrange: () =>
        enquiryMedia.resolveEnquiryTarget.mockRejectedValueOnce(
          new EnquiryResolutionError("source-unavailable"),
        ),
    },
  ])("sets no-store and no CORS headers on $label", async ({ arrange }) => {
    arrange();
    const response = await POST(enquiryRequest({ address: "203.0.113.9" }));

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });
});

describe("POST /api/enquiry — the body boundary", () => {
  it("refuses an un-whitelisted key as a malformed body", async () => {
    const response = await POST(
      enquiryRequest({ body: { ...VALID_BODY, nickname: "extra" } }),
    );
    expect(response.status).toBe(400);
    expect(await responseBody(response)).toMatchObject({ reason: "malformed-body" });
    expect(enquiryMedia.resolveEnquiryTarget).not.toHaveBeenCalled();
  });

  it("refuses a missing or malformed submissionId", async () => {
    const response = await POST(
      enquiryRequest({ body: { ...VALID_BODY, submissionId: "not-a-uuid" } }),
    );
    expect(response.status).toBe(400);
  });

  it("answers a filled honeypot exactly as a success and delivers nothing", async () => {
    const response = await POST(
      enquiryRequest({ body: { ...VALID_BODY, company: "Acme" } }),
    );
    expect(response.status).toBe(200);
    expect(await responseBody(response)).toMatchObject({ status: "delivered" });
    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(enquiryMedia.resolveEnquiryTarget).not.toHaveBeenCalled();
    expect(events().at(-1)).toMatchObject({ state: "rejected", errorClass: "honeypot" });
  });

  it("reports an invalid contact field before resolving, reading settings, or delivering", async () => {
    const response = await POST(
      enquiryRequest({ body: { ...VALID_BODY, email: "not-an-email" } }),
    );
    expect(response.status).toBe(422);
    expect(await responseBody(response)).toMatchObject({
      status: "rejected",
      reason: "invalid-fields",
    });
    expect(enquiryMedia.resolveEnquiryTarget).not.toHaveBeenCalled();
    expect(siteSettings.getSiteSettings).not.toHaveBeenCalled();
    expect(delivery.deliver).not.toHaveBeenCalled();
  });
});

describe("POST /api/enquiry — resolution outcomes", () => {
  it.each([
    "unknown-item",
    "container-unavailable",
    "not-public",
    "not-enquirable",
    "dynamic-unsupported",
  ] as const)("answers %s with one generic 404 that discloses nothing", async (rejection) => {
    enquiryMedia.resolveEnquiryTarget.mockRejectedValueOnce(
      new EnquiryResolutionError(rejection),
    );
    const response = await POST(enquiryRequest());
    const body = await responseBody(response);

    expect(response.status).toBe(404);
    expect(body).toEqual({
      status: "rejected",
      reason: "item-unavailable",
      correlationId: expect.any(String),
    });
    expect(JSON.stringify(body)).not.toContain(rejection);
    // The specific class is still in the operational log.
    expect(events().at(-1)).toMatchObject({ state: "rejected", errorClass: rejection });
  });

  it("answers a malformed reference with a 400 malformed-body", async () => {
    enquiryMedia.resolveEnquiryTarget.mockRejectedValueOnce(
      new EnquiryResolutionError("malformed-request"),
    );
    const response = await POST(enquiryRequest());
    expect(response.status).toBe(400);
    expect(await responseBody(response)).toMatchObject({ reason: "malformed-body" });
  });

  it("answers a retryable store failure with a 503 and a terminal event", async () => {
    enquiryMedia.resolveEnquiryTarget.mockRejectedValueOnce(
      new EnquiryResolutionError("source-unavailable"),
    );
    const response = await POST(enquiryRequest());

    expect(response.status).toBe(503);
    expect(await responseBody(response)).toMatchObject({ status: "failed", retryable: true });
    expect(events().at(-1)).toMatchObject({
      state: "delivery-failed",
      errorClass: "source-unavailable",
    });
  });

  it.each(["source-error", "malformed-source"] as const)(
    "answers %s with a non-retryable 500 and a terminal event",
    async (rejection) => {
      enquiryMedia.resolveEnquiryTarget.mockRejectedValueOnce(
        new EnquiryResolutionError(rejection),
      );
      const response = await POST(enquiryRequest());

      expect(response.status).toBe(500);
      expect(await responseBody(response)).toMatchObject({ status: "failed", retryable: false });
      expect(events().at(-1)).toMatchObject({
        state: "delivery-failed",
        errorClass: rejection,
      });
    },
  );

  it("records a terminal event and rethrows an unclassifiable defect", async () => {
    enquiryMedia.resolveEnquiryTarget.mockRejectedValueOnce(new Error("real bug"));
    await expect(POST(enquiryRequest())).rejects.toThrow("real bug");
    expect(events().at(-1)).toMatchObject({
      state: "delivery-failed",
      errorClass: "internal",
    });
  });

  it("answers a completed-but-untrusted content document as malformed-source, not a bare 500", async () => {
    enquiryMedia.resolveEnquiryTarget.mockRejectedValueOnce(
      Object.assign(new Error("bad category document"), {
        name: "SanityContentTreeError",
      }),
    );
    const response = await POST(enquiryRequest());

    expect(response.status).toBe(500);
    expect(await responseBody(response)).toMatchObject({
      status: "failed",
      retryable: false,
    });
    expect(events().at(-1)).toMatchObject({
      state: "delivery-failed",
      errorClass: "malformed-source",
    });
  });

  it("answers a settings-read outage with a terminal event, not a bare 500", async () => {
    const storeError = Object.assign(new Error("down"), {
      name: "SanityQueryError",
      retryable: true,
    });
    siteSettings.getSiteSettings.mockRejectedValueOnce(storeError);
    const response = await POST(enquiryRequest());

    expect(response.status).toBe(503);
    expect(events().at(-1)).toMatchObject({
      state: "delivery-failed",
      errorClass: "source-unavailable",
    });
  });
});

describe("POST /api/enquiry — the happy path and delivery", () => {
  it("resolves with exactly the context fields, delivers, and leaks nothing", async () => {
    const response = await POST(enquiryRequest());
    const body = await responseBody(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "delivered", correlationId: expect.any(String) });

    expect(enquiryMedia.resolveEnquiryTarget).toHaveBeenCalledTimes(1);
    expect(enquiryMedia.resolveEnquiryTarget).toHaveBeenCalledWith(CURATED_CONTEXT);

    expect(delivery.deliver).toHaveBeenCalledTimes(1);
    expect(delivery.deliver.mock.calls[0][0]).toMatchObject({
      idempotencyKey: `enquiry:${VALID_BODY.submissionId}`,
    });

    // The resolved target's server-only fields never reach the response or a log.
    const everything = JSON.stringify(body) + logLines.join("\n");
    for (const secret of [
      "archive-locator-sentinel",
      "caption-sentinel",
      "credit-sentinel",
      "coastal-landscape",
    ]) {
      expect(everything).not.toContain(secret);
    }
    for (const event of events()) {
      expect(event.event).toBe("enquiry.submission");
      // Only the ADR-0004 §5 fields: event name, correlation id, state, and —
      // on a non-success — a redacted class. Nothing else.
      const allowed = new Set(["event", "correlationId", "state", "errorClass"]);
      expect(Object.keys(event).every((key) => allowed.has(key))).toBe(true);
      expect(event.correlationId).toEqual(expect.any(String));
    }
  });

  it("namespaces the idempotency key so it cannot collide with a contact submission", async () => {
    await POST(enquiryRequest());
    const key = delivery.deliver.mock.calls[0][0].idempotencyKey as string;
    expect(key).toBe(`enquiry:${VALID_BODY.submissionId}`);
    expect(key).not.toBe(VALID_BODY.submissionId);
  });

  it("keeps the idempotency key stable across a retry of the same enquiry", async () => {
    await POST(enquiryRequest());
    await POST(enquiryRequest());
    expect(delivery.deliver.mock.calls[0][0].idempotencyKey).toBe(
      delivery.deliver.mock.calls[1][0].idempotencyKey,
    );
  });

  it("maps a retryable delivery failure to 503 and logs it", async () => {
    delivery.deliver.mockResolvedValueOnce({
      status: "failed",
      errorClass: "provider-unavailable",
      retryable: true,
    });
    const response = await POST(enquiryRequest());

    expect(response.status).toBe(503);
    expect(await responseBody(response)).toMatchObject({ status: "failed", retryable: true });
    expect(events().at(-1)).toMatchObject({
      state: "delivery-failed",
      errorClass: "provider-unavailable",
    });
  });

  it("treats a thrown delivery adapter as a configuration failure", async () => {
    delivery.deliver.mockRejectedValueOnce(new Error("no adapter"));
    const response = await POST(enquiryRequest());

    expect(response.status).toBe(500);
    expect(events().at(-1)).toMatchObject({
      state: "delivery-failed",
      errorClass: "configuration",
    });
  });
});
