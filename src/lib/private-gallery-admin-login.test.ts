import { describe, expect, it, vi } from "vitest";

import type { ContactRateLimiter } from "@/lib/contact-rate-limit";
import {
  checkPrivateGalleryAdminLoginRequestHeaders,
  consumePrivateGalleryAdminLoginAttempt,
  createPrivateGalleryAdminLoginIpLimiter,
  evaluatePrivateGalleryAdminLoginRate,
  PRIVATE_GALLERY_ADMIN_LOGIN_IP_MAX_ATTEMPTS,
  PRIVATE_GALLERY_ADMIN_LOGIN_MAX_ATTEMPTS,
  PRIVATE_GALLERY_ADMIN_LOGIN_RATE_CONFIG,
  PRIVATE_GALLERY_ADMIN_LOGIN_WINDOW_MS,
  PrivateGalleryAdminLoginError,
  type PrivateGalleryAdminLoginRateCounter,
  type PrivateGalleryAdminLoginRateDecision,
  type PrivateGalleryAdminLoginStore,
} from "@/lib/private-gallery-admin-login";

const NOW = new Date("2026-09-02T12:00:00.000Z");
const ORIGIN = "https://admin.test";

const HOST = new URL(ORIGIN).host;

function loginRequest(init?: {
  readonly contentType?: string | null;
  readonly origin?: string | null;
}): Request {
  // `isSameOrigin` compares `Origin` against `X-Forwarded-Host`/`Host`, and the
  // `Request` constructor sets neither, so the host is explicit here.
  const headers = new Headers({ host: HOST });
  const contentType =
    init?.contentType === undefined ? "application/json" : init.contentType;
  if (contentType !== null) headers.set("content-type", contentType);
  const origin = init?.origin === undefined ? ORIGIN : init.origin;
  if (origin !== null) headers.set("origin", origin);
  return new Request(`${ORIGIN}/admin/login`, {
    method: "POST",
    headers,
    body: "{}",
  });
}

/** A store backed by the pure evaluator — what the adapter must match. */
function makeStore() {
  let counter: PrivateGalleryAdminLoginRateCounter | undefined;
  const calls: Date[] = [];
  const store: PrivateGalleryAdminLoginStore = {
    async consumeLoginAttempt(now, config) {
      calls.push(now);
      const decision = evaluatePrivateGalleryAdminLoginRate(counter, now, config);
      counter = decision.next;
      return decision;
    },
  };
  return { store, calls, read: () => counter };
}

function alwaysAllowedLimiter(): ContactRateLimiter {
  return { tryConsume: vi.fn(() => ({ allowed: true }) as const) };
}

function reason(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof PrivateGalleryAdminLoginError) return error.reason;
    throw error;
  }
  throw new Error("expected a PrivateGalleryAdminLoginError");
}

describe("the reused request boundary (ADR-0015 §3)", () => {
  it("accepts a same-origin JSON POST", () => {
    expect(
      checkPrivateGalleryAdminLoginRequestHeaders(loginRequest()),
    ).toBeUndefined();
  });

  it("refuses a non-JSON content type", () => {
    expect(
      checkPrivateGalleryAdminLoginRequestHeaders(
        loginRequest({ contentType: "text/plain" }),
      ),
    ).toBe("unsupported-media-type");
  });

  it("refuses a cross-origin request", () => {
    expect(
      checkPrivateGalleryAdminLoginRequestHeaders(
        loginRequest({ origin: "https://elsewhere.test" }),
      ),
    ).toBe("cross-origin");
  });

  it("checks the content type before the origin, so neither is skipped", () => {
    expect(
      checkPrivateGalleryAdminLoginRequestHeaders(
        loginRequest({ contentType: "text/plain", origin: "https://elsewhere.test" }),
      ),
    ).toBe("unsupported-media-type");
  });
});

describe("evaluatePrivateGalleryAdminLoginRate", () => {
  it("starts a window on the first attempt", () => {
    const decision = evaluatePrivateGalleryAdminLoginRate(undefined, NOW);
    expect(decision).toEqual({
      allowed: true,
      firstRefusalInWindow: false,
      next: { windowStartedAt: NOW, attempts: 1 },
    });
  });

  it("allows attempts up to the limit and refuses the one past it", () => {
    let counter: PrivateGalleryAdminLoginRateCounter | undefined;
    const allowed: boolean[] = [];
    for (let i = 0; i < PRIVATE_GALLERY_ADMIN_LOGIN_MAX_ATTEMPTS + 3; i += 1) {
      const decision = evaluatePrivateGalleryAdminLoginRate(counter, NOW);
      allowed.push(decision.allowed);
      counter = decision.next;
    }
    expect(allowed.filter(Boolean)).toHaveLength(
      PRIVATE_GALLERY_ADMIN_LOGIN_MAX_ATTEMPTS,
    );
    expect(allowed.slice(PRIVATE_GALLERY_ADMIN_LOGIN_MAX_ATTEMPTS)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("marks the first refusal exactly once", () => {
    let counter: PrivateGalleryAdminLoginRateCounter | undefined;
    const edges: boolean[] = [];
    for (let i = 0; i < PRIVATE_GALLERY_ADMIN_LOGIN_MAX_ATTEMPTS + 3; i += 1) {
      const decision = evaluatePrivateGalleryAdminLoginRate(counter, NOW);
      edges.push(decision.firstRefusalInWindow);
      counter = decision.next;
    }
    expect(edges.filter(Boolean)).toHaveLength(1);
    expect(edges[PRIVATE_GALLERY_ADMIN_LOGIN_MAX_ATTEMPTS]).toBe(true);
  });

  it("saturates the stored count rather than incrementing forever", () => {
    let counter: PrivateGalleryAdminLoginRateCounter | undefined;
    for (let i = 0; i < PRIVATE_GALLERY_ADMIN_LOGIN_MAX_ATTEMPTS + 50; i += 1) {
      counter = evaluatePrivateGalleryAdminLoginRate(counter, NOW).next;
    }
    expect(counter?.attempts).toBe(PRIVATE_GALLERY_ADMIN_LOGIN_MAX_ATTEMPTS + 1);
  });

  it("opens a fresh window once the old one has elapsed", () => {
    const exhausted: PrivateGalleryAdminLoginRateCounter = {
      windowStartedAt: NOW,
      attempts: PRIVATE_GALLERY_ADMIN_LOGIN_MAX_ATTEMPTS + 1,
    };
    const after = new Date(
      NOW.getTime() + PRIVATE_GALLERY_ADMIN_LOGIN_WINDOW_MS,
    );

    expect(
      evaluatePrivateGalleryAdminLoginRate(exhausted, after).allowed,
    ).toBe(true);
    // One millisecond earlier is still inside the window.
    expect(
      evaluatePrivateGalleryAdminLoginRate(
        exhausted,
        new Date(after.getTime() - 1),
      ).allowed,
    ).toBe(false);
  });

  it("throws on a corrupt counter rather than resetting it", () => {
    // Failing open here would make the expensive step free, which is the one
    // thing this counter exists to prevent.
    for (const counter of [
      { windowStartedAt: new Date("nope"), attempts: 1 },
      { windowStartedAt: NOW, attempts: -1 },
      { windowStartedAt: NOW, attempts: 1.5 },
      { windowStartedAt: NOW, attempts: Number.NaN },
    ]) {
      expect(
        reason(() => evaluatePrivateGalleryAdminLoginRate(counter, NOW)),
      ).toBe("malformed-record");
    }
  });

  it("refuses an unusable clock or configuration", () => {
    expect(
      reason(() =>
        evaluatePrivateGalleryAdminLoginRate(undefined, new Date("nope")),
      ),
    ).toBe("invalid-parameter");
    for (const config of [
      { maxAttempts: 0, windowMs: 1000 },
      { maxAttempts: 1.5, windowMs: 1000 },
      { maxAttempts: 1, windowMs: 0 },
      { maxAttempts: 1, windowMs: Number.NaN },
    ]) {
      expect(
        reason(() =>
          evaluatePrivateGalleryAdminLoginRate(undefined, NOW, config),
        ),
      ).toBe("invalid-parameter");
    }
  });

  it("bounds scrypt cost to seconds of CPU per window", () => {
    // ADR-0015 §4 measures verification at ~74 ms. The limit's real job is this
    // ceiling, not defeating a search over a generated 256-bit secret.
    const worstCaseCpuMs = PRIVATE_GALLERY_ADMIN_LOGIN_MAX_ATTEMPTS * 74;
    expect(worstCaseCpuMs).toBeLessThan(5000);
    expect(PRIVATE_GALLERY_ADMIN_LOGIN_WINDOW_MS).toBeGreaterThan(
      worstCaseCpuMs,
    );
  });
});

describe("consumePrivateGalleryAdminLoginAttempt", () => {
  it("proceeds when both layers allow the attempt", async () => {
    const { store, calls } = makeStore();
    await expect(
      consumePrivateGalleryAdminLoginAttempt({
        ipLimiter: alwaysAllowedLimiter(),
        store,
        clientKey: "client-a",
        now: NOW,
      }),
    ).resolves.toEqual({ outcome: "proceed" });
    expect(calls).toHaveLength(1);
  });

  it("never reaches the persisted counter when the IP layer refuses", async () => {
    // The whole point of a cheap first layer: one noisy client must not be able
    // to exhaust the deployment-wide window by itself.
    const { store, calls } = makeStore();
    const ipLimiter = createPrivateGalleryAdminLoginIpLimiter();
    const attempt = () =>
      consumePrivateGalleryAdminLoginAttempt({
        ipLimiter,
        store,
        clientKey: "noisy",
        now: NOW,
      });

    for (let i = 0; i < PRIVATE_GALLERY_ADMIN_LOGIN_IP_MAX_ATTEMPTS; i += 1) {
      expect((await attempt()).outcome).toBe("proceed");
    }
    const refused = await attempt();
    expect(refused).toMatchObject({
      outcome: "refused",
      refusal: "ip-rate-limited",
    });
    expect(calls).toHaveLength(PRIVATE_GALLERY_ADMIN_LOGIN_IP_MAX_ATTEMPTS);
  });

  it("carries the IP layer's own first-refusal edge rather than logging every refusal", async () => {
    const { store } = makeStore();
    const ipLimiter = createPrivateGalleryAdminLoginIpLimiter();
    const attempt = () =>
      consumePrivateGalleryAdminLoginAttempt({
        ipLimiter,
        store,
        clientKey: "noisy",
        now: NOW,
      });

    for (let i = 0; i < PRIVATE_GALLERY_ADMIN_LOGIN_IP_MAX_ATTEMPTS; i += 1) {
      await attempt();
    }
    const first = await attempt();
    const second = await attempt();
    expect(first).toMatchObject({ firstRefusalInWindow: true });
    expect(second).toMatchObject({ firstRefusalInWindow: false });
  });

  it("refuses deployment-wide once the persisted window is spent, whatever the client", async () => {
    // A global counter is a shared budget: a fresh client key does not restore
    // it. This is the accepted availability cost the module documents.
    const { store } = makeStore();
    const ipLimiter = alwaysAllowedLimiter();
    for (let i = 0; i < PRIVATE_GALLERY_ADMIN_LOGIN_MAX_ATTEMPTS; i += 1) {
      await consumePrivateGalleryAdminLoginAttempt({
        ipLimiter,
        store,
        clientKey: `client-${i}`,
        now: NOW,
      });
    }

    expect(
      await consumePrivateGalleryAdminLoginAttempt({
        ipLimiter,
        store,
        clientKey: "a-brand-new-client",
        now: NOW,
      }),
    ).toMatchObject({
      outcome: "refused",
      refusal: "deployment-rate-limited",
      firstRefusalInWindow: true,
    });
  });

  it("recovers once the persisted window rolls over", async () => {
    const { store } = makeStore();
    const ipLimiter = alwaysAllowedLimiter();
    for (let i = 0; i < PRIVATE_GALLERY_ADMIN_LOGIN_MAX_ATTEMPTS + 1; i += 1) {
      await consumePrivateGalleryAdminLoginAttempt({
        ipLimiter,
        store,
        clientKey: "client",
        now: NOW,
      });
    }

    const later = new Date(
      NOW.getTime() + PRIVATE_GALLERY_ADMIN_LOGIN_WINDOW_MS,
    );
    expect(
      await consumePrivateGalleryAdminLoginAttempt({
        ipLimiter,
        store,
        clientKey: "client",
        now: later,
      }),
    ).toEqual({ outcome: "proceed" });
  });

  it("passes the module's own configuration to the store", async () => {
    const consumeLoginAttempt = vi.fn(
      async (): Promise<PrivateGalleryAdminLoginRateDecision> => ({
        allowed: true,
        firstRefusalInWindow: false,
        next: { windowStartedAt: NOW, attempts: 1 },
      }),
    );
    await consumePrivateGalleryAdminLoginAttempt({
      ipLimiter: alwaysAllowedLimiter(),
      store: { consumeLoginAttempt },
      clientKey: "client",
      now: NOW,
    });
    expect(consumeLoginAttempt).toHaveBeenCalledWith(
      NOW,
      PRIVATE_GALLERY_ADMIN_LOGIN_RATE_CONFIG,
    );
  });

  it("refuses an unusable clock or client key before spending anything", async () => {
    const { store, calls } = makeStore();
    const ipLimiter = alwaysAllowedLimiter();

    await expect(
      consumePrivateGalleryAdminLoginAttempt({
        ipLimiter,
        store,
        clientKey: "client",
        now: new Date("nope"),
      }),
    ).rejects.toBeInstanceOf(PrivateGalleryAdminLoginError);
    await expect(
      consumePrivateGalleryAdminLoginAttempt({
        ipLimiter,
        store,
        clientKey: "",
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(PrivateGalleryAdminLoginError);

    expect(calls).toHaveLength(0);
    expect(ipLimiter.tryConsume).not.toHaveBeenCalled();
  });

  it("never names the client key in an error", async () => {
    const { store } = makeStore();
    try {
      await consumePrivateGalleryAdminLoginAttempt({
        ipLimiter: alwaysAllowedLimiter(),
        store,
        clientKey: "",
        now: new Date("nope"),
      });
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as Error).message).not.toContain("clientKey must be a non");
    }
  });
});

describe("the two limiters are separate allowances", () => {
  it("gives each call site its own in-process instance", async () => {
    const a = createPrivateGalleryAdminLoginIpLimiter();
    const b = createPrivateGalleryAdminLoginIpLimiter();
    for (let i = 0; i < PRIVATE_GALLERY_ADMIN_LOGIN_IP_MAX_ATTEMPTS; i += 1) {
      a.tryConsume("client", NOW.getTime());
    }
    expect(a.tryConsume("client", NOW.getTime()).allowed).toBe(false);
    expect(b.tryConsume("client", NOW.getTime()).allowed).toBe(true);
  });
});
