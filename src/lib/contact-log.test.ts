import { afterEach, describe, expect, it, vi } from "vitest";

import { createCorrelationId, logContactEvent } from "@/lib/contact-log";

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
    logContactEvent({ correlationId: "id", state: "rejected", errorClass: "x" });

    expect(info).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
  });

  it("emits one line, so nothing can break a value across log records", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    logContactEvent({ correlationId: "a\nb", state: "accepted" });

    expect(String(info.mock.calls[0][0])).not.toContain("\n");
  });
});

describe("createCorrelationId", () => {
  it("mints a distinct identifier per request", () => {
    expect(createCorrelationId()).not.toBe(createCorrelationId());
  });
});
