import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createCorrelationId,
  logContactEvent,
  logEnquiryEvent,
} from "@/lib/contact-log";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logContactEvent", () => {
  it("emits only the event name, correlation identifier, and state", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    logContactEvent({ correlationId: "id", state: "delivered" });

    expect(JSON.parse(String(info.mock.calls[0][0]))).toEqual({
      event: "contact.submission",
      correlationId: "id",
      state: "delivered",
    });
  });

  it("adds the redacted error class and nothing else on a failure", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    logContactEvent({
      correlationId: "id",
      state: "delivery-failed",
      errorClass: "timeout",
    });

    expect(JSON.parse(String(error.mock.calls[0][0]))).toEqual({
      event: "contact.submission",
      correlationId: "id",
      state: "delivery-failed",
      errorClass: "timeout",
    });
  });

  it("separates failures from successes by console level", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    logContactEvent({ correlationId: "id", state: "accepted" });
    logContactEvent({
      correlationId: "id",
      state: "rejected",
      errorClass: "cross-origin",
    });

    expect(info).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
  });

  it("emits one line, so nothing can break a value across log records", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    logContactEvent({ correlationId: "a\nb", state: "accepted" });

    expect(String(info.mock.calls[0][0])).not.toContain("\n");
  });
});

describe("logEnquiryEvent", () => {
  it("writes its own event name and only the fixed schema fields", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    logEnquiryEvent({ correlationId: "id", state: "accepted" });

    expect(JSON.parse(String(info.mock.calls[0][0]))).toEqual({
      event: "enquiry.submission",
      correlationId: "id",
      state: "accepted",
    });
  });

  it("carries a redacted enquiry-only class on a non-success state", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    logEnquiryEvent({
      correlationId: "id",
      state: "delivery-failed",
      errorClass: "source-unavailable",
    });

    expect(JSON.parse(String(error.mock.calls[0][0]))).toEqual({
      event: "enquiry.submission",
      correlationId: "id",
      state: "delivery-failed",
      errorClass: "source-unavailable",
    });
  });

  it("shares the failure/success console split with the contact wrapper", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    logEnquiryEvent({ correlationId: "id", state: "delivered" });
    logEnquiryEvent({
      correlationId: "id",
      state: "rejected",
      errorClass: "honeypot",
    });

    expect(info).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
  });
});

describe("createCorrelationId", () => {
  it("mints a distinct identifier per request", () => {
    expect(createCorrelationId()).not.toBe(createCorrelationId());
  });
});
