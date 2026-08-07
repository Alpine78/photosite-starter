import { describe, expect, it } from "vitest";

import {
  createContactRateLimiter,
  deriveClientKey,
} from "@/lib/contact-rate-limit";

describe("createContactRateLimiter", () => {
  const allowed = (limiter: ReturnType<typeof createContactRateLimiter>, at: number) =>
    limiter.tryConsume("client", at).allowed;

  it("allows attempts up to the window's allowance and refuses the next", () => {
    const limiter = createContactRateLimiter({ maxAttempts: 3, windowMs: 1000 });

    expect([0, 1, 2, 3].map((at) => allowed(limiter, at))).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it("starts a fresh allowance once the window has passed", () => {
    const limiter = createContactRateLimiter({ maxAttempts: 1, windowMs: 1000 });

    expect(allowed(limiter, 0)).toBe(true);
    expect(allowed(limiter, 999)).toBe(false);
    expect(allowed(limiter, 1000)).toBe(true);
  });

  it("counts each client separately", () => {
    const limiter = createContactRateLimiter({ maxAttempts: 1, windowMs: 1000 });

    expect(limiter.tryConsume("first", 0).allowed).toBe(true);
    expect(limiter.tryConsume("second", 0).allowed).toBe(true);
    expect(limiter.tryConsume("first", 0).allowed).toBe(false);
  });

  it("does not extend a window by attempting again inside it", () => {
    const limiter = createContactRateLimiter({ maxAttempts: 2, windowMs: 1000 });

    expect(allowed(limiter, 0)).toBe(true);
    expect(allowed(limiter, 900)).toBe(true);
    expect(allowed(limiter, 950)).toBe(false);
    expect(allowed(limiter, 1000)).toBe(true);
  });

  it("marks only the first refusal of a window, so a flood is logged once", () => {
    const limiter = createContactRateLimiter({ maxAttempts: 1, windowMs: 1000 });
    limiter.tryConsume("client", 0);

    expect([1, 2, 3].map((at) => limiter.tryConsume("client", at))).toEqual([
      { allowed: false, firstRefusalInWindow: true },
      { allowed: false, firstRefusalInWindow: false },
      { allowed: false, firstRefusalInWindow: false },
    ]);
  });

  it("marks a first refusal again in the next window", () => {
    const limiter = createContactRateLimiter({ maxAttempts: 1, windowMs: 1000 });
    limiter.tryConsume("client", 0);
    limiter.tryConsume("client", 1);
    limiter.tryConsume("client", 2);

    // A fresh window is allowed, and the refusal after it is a new first.
    expect(limiter.tryConsume("client", 1000).allowed).toBe(true);
    expect(limiter.tryConsume("client", 1001)).toEqual({
      allowed: false,
      firstRefusalInWindow: true,
    });
  });

  it("tracks refusals per client", () => {
    const limiter = createContactRateLimiter({ maxAttempts: 1, windowMs: 1000 });
    limiter.tryConsume("first", 0);
    limiter.tryConsume("second", 0);
    limiter.tryConsume("first", 0);

    expect(limiter.tryConsume("second", 0)).toEqual({
      allowed: false,
      firstRefusalInWindow: true,
    });
  });
});

describe("deriveClientKey", () => {
  function requestFrom(headers: Record<string, string>): Request {
    return new Request("https://example.com/api/contact", {
      method: "POST",
      headers,
    });
  }

  it("derives the same key for the same address", () => {
    const headers = { "x-forwarded-for": "203.0.113.7" };

    expect(deriveClientKey(requestFrom(headers))).toBe(
      deriveClientKey(requestFrom(headers)),
    );
  });

  it("derives different keys for different addresses", () => {
    expect(
      deriveClientKey(requestFrom({ "x-forwarded-for": "203.0.113.7" })),
    ).not.toBe(
      deriveClientKey(requestFrom({ "x-forwarded-for": "203.0.113.8" })),
    );
  });

  it("reads only the client entry of a proxy chain", () => {
    expect(
      deriveClientKey(
        requestFrom({ "x-forwarded-for": "203.0.113.7, 198.51.100.1" }),
      ),
    ).toBe(deriveClientKey(requestFrom({ "x-forwarded-for": "203.0.113.7" })));
  });

  it("never carries the address it was derived from", () => {
    const key = deriveClientKey(
      requestFrom({ "x-forwarded-for": "203.0.113.7" }),
    );

    expect(key).not.toContain("203.0.113.7");
    expect(key).not.toContain("203.0.113");
  });

  it("puts an address-less request in a bucket rather than outside the limit", () => {
    expect(deriveClientKey(requestFrom({}))).toBe(
      deriveClientKey(requestFrom({})),
    );
  });
});
