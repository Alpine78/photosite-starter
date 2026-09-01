import { describe, expect, it, vi } from "vitest";

import { createContactRateLimiter } from "@/lib/contact-rate-limit";
import type {
  PrivateGallery,
  PrivateGalleryCapability,
} from "@/lib/private-gallery";
import {
  canonicalCapabilityAad,
  generateCapabilitySecret,
  generateGalleryHandle,
  sealCapability,
} from "@/lib/private-gallery-capability";
import type { PrivateGalleryCapabilityKeyring } from "@/lib/private-gallery-config";
import {
  assertPrivateGalleryHandleShape,
  createPrivateGalleryExchangeIpLimiter,
  evaluatePrivateGalleryExchangeRate,
  PRIVATE_GALLERY_EXCHANGE_HANDLE_MAX_ATTEMPTS,
  PRIVATE_GALLERY_EXCHANGE_IP_MAX_ATTEMPTS,
  PRIVATE_GALLERY_EXCHANGE_RATE_CONFIG,
  PrivateGalleryExchangeError,
  resolveVerifiedPrivateGalleryCapability,
  type PrivateGalleryExchangeLookup,
  type PrivateGalleryExchangeRateCounter,
  type PrivateGalleryExchangeStore,
} from "@/lib/private-gallery-exchange";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(10 * DAY);
const KEY_ID = "k1";

function keyring(): PrivateGalleryCapabilityKeyring {
  const key = Buffer.alloc(32, 5);
  return {
    activeKeyId: KEY_ID,
    keyIds: Object.freeze([KEY_ID]),
    getKey: (id) => (id === KEY_ID ? Uint8Array.from(key) : undefined),
  };
}

function expectReason(run: () => unknown, reason: string) {
  try {
    run();
    throw new Error("expected a throw");
  } catch (error) {
    expect(error).toBeInstanceOf(PrivateGalleryExchangeError);
    expect((error as PrivateGalleryExchangeError).reason).toBe(reason);
  }
}

async function expectAsyncReason(run: () => Promise<unknown>, reason: string) {
  try {
    await run();
    throw new Error("expected a throw");
  } catch (error) {
    expect(error).toBeInstanceOf(PrivateGalleryExchangeError);
    expect((error as PrivateGalleryExchangeError).reason).toBe(reason);
  }
}

/**
 * A fake store that follows the contract: the counter is owned by the gallery
 * row, so an unknown handle writes nothing, and an existing one is consumed with
 * the pure evaluator's semantics. This exercises the *policy*; atomicity and
 * isolation are the Postgres adapter's to prove.
 */
function makeStore(galleries: readonly {
  gallery: PrivateGallery;
  capability?: PrivateGalleryCapability;
}[]) {
  const counters = new Map<string, PrivateGalleryExchangeRateCounter>();
  const store: PrivateGalleryExchangeStore = {
    consumeExchangeAttempt: vi.fn(
      async (handle, now, config): Promise<PrivateGalleryExchangeLookup> => {
        const row = galleries.find((g) => g.gallery.galleryHandle === handle);
        if (row === undefined) return { outcome: "unknown-handle" };

        const decision = evaluatePrivateGalleryExchangeRate(
          counters.get(row.gallery.galleryId),
          now,
          config,
        );
        counters.set(row.gallery.galleryId, decision.next);
        if (!decision.allowed) {
          return {
            outcome: "rate-limited",
            firstRefusalInWindow: decision.firstRefusalInWindow,
          };
        }
        return {
          outcome: "ok",
          gallery: row.gallery,
          capability: row.capability,
        };
      },
    ),
  };
  return { store, counters };
}

function scenario(
  overrides: {
    gallery?: Partial<PrivateGallery>;
    capability?: Partial<PrivateGalleryCapability> | null;
  } = {},
) {
  const ring = keyring();
  const handle = generateGalleryHandle();
  const secret = generateCapabilitySecret();
  const galleryId = "gallery-01";
  const generation = 3;

  const sealed = sealCapability(
    ring,
    { galleryId, handle, generation },
    secret,
  );

  const gallery: PrivateGallery = {
    galleryId,
    galleryHandle: handle,
    state: "published",
    capabilityGeneration: generation,
    createdAt: new Date(0),
    accessExpiresAt: new Date(200 * DAY),
    ...overrides.gallery,
  };

  const capability: PrivateGalleryCapability | undefined =
    overrides.capability === null
      ? undefined
      : {
          galleryId,
          capabilityGeneration: generation,
          keyId: sealed.keyId,
          envelope: sealed.envelope,
          createdAt: new Date(0),
          ...overrides.capability,
        };

  const { store, counters } = makeStore([
    capability === undefined ? { gallery } : { gallery, capability },
  ]);
  return { ring, handle, secret, gallery, capability, store, counters };
}

describe("assertPrivateGalleryHandleShape", () => {
  it("accepts a generated handle", () => {
    expect(() =>
      assertPrivateGalleryHandleShape(generateGalleryHandle()),
    ).not.toThrow();
  });

  it.each([
    ["not a string", 1],
    ["empty", ""],
    ["too few bytes", Buffer.alloc(8, 1).toString("base64url")],
    ["too many bytes", Buffer.alloc(65, 1).toString("base64url")],
    ["padded base64", Buffer.alloc(16, 1).toString("base64") + "=="],
    ["the base64 alphabet", "+/v7+/v7+/v7+/v7+/v7+A"],
  ])("rejects %s", (_label, value) => {
    expectReason(
      () => assertPrivateGalleryHandleShape(value),
      "invalid-handle",
    );
  });

  it("agrees with the capability AAD's own handle rule", () => {
    // Both modules bound the handle; a value one accepts and the other rejects
    // would mean a handle that passes the store lookup then fails decryption.
    const accepted = [
      generateGalleryHandle(),
      Buffer.alloc(16, 2).toString("base64url"),
      Buffer.alloc(64, 3).toString("base64url"),
    ];
    for (const handle of accepted) {
      expect(() => assertPrivateGalleryHandleShape(handle)).not.toThrow();
      expect(() =>
        canonicalCapabilityAad({ galleryId: "g", handle, generation: 0 }),
      ).not.toThrow();
    }
    const rejected = [
      Buffer.alloc(8, 1).toString("base64url"),
      Buffer.alloc(65, 1).toString("base64url"),
      "not/base64url",
    ];
    for (const handle of rejected) {
      expect(() => assertPrivateGalleryHandleShape(handle)).toThrow();
      expect(() =>
        canonicalCapabilityAad({ galleryId: "g", handle, generation: 0 }),
      ).toThrow();
    }
  });
});

describe("the per-IP layer", () => {
  it("allows its own allowance and then refuses", () => {
    const limiter = createPrivateGalleryExchangeIpLimiter();
    for (let i = 0; i < PRIVATE_GALLERY_EXCHANGE_IP_MAX_ATTEMPTS; i += 1) {
      expect(limiter.tryConsume("client", 0).allowed).toBe(true);
    }
    const refused = limiter.tryConsume("client", 0);
    expect(refused.allowed).toBe(false);
    expect(refused.allowed === false && refused.firstRefusalInWindow).toBe(true);
  });

  it("does not share an allowance with another limiter instance", () => {
    const exchange = createPrivateGalleryExchangeIpLimiter();
    const contact = createContactRateLimiter();
    for (let i = 0; i < PRIVATE_GALLERY_EXCHANGE_IP_MAX_ATTEMPTS; i += 1) {
      exchange.tryConsume("client", 0);
    }
    expect(exchange.tryConsume("client", 0).allowed).toBe(false);
    expect(contact.tryConsume("client", 0).allowed).toBe(true);
  });
});

describe("evaluatePrivateGalleryExchangeRate", () => {
  const config = { maxAttempts: 3, windowMs: 1000 };

  it("starts a fresh window for an absent counter", () => {
    const decision = evaluatePrivateGalleryExchangeRate(
      undefined,
      new Date(500),
      config,
    );
    expect(decision).toEqual({
      allowed: true,
      firstRefusalInWindow: false,
      next: { windowStartedAt: new Date(500), attempts: 1 },
    });
  });

  it("counts within the window and refuses at the limit, once", () => {
    const started = new Date(0);
    const second = evaluatePrivateGalleryExchangeRate(
      { windowStartedAt: started, attempts: 1 },
      new Date(100),
      config,
    );
    expect(second.allowed).toBe(true);
    expect(second.next.attempts).toBe(2);

    const atLimit = evaluatePrivateGalleryExchangeRate(
      { windowStartedAt: started, attempts: 3 },
      new Date(100),
      config,
    );
    expect(atLimit.allowed).toBe(false);
    expect(atLimit.firstRefusalInWindow).toBe(true);
    expect(atLimit.next.attempts).toBe(4);

    // Saturated: refused, but no longer the first refusal and no further growth.
    const saturated = evaluatePrivateGalleryExchangeRate(
      { windowStartedAt: started, attempts: 4 },
      new Date(200),
      config,
    );
    expect(saturated.allowed).toBe(false);
    expect(saturated.firstRefusalInWindow).toBe(false);
    expect(saturated.next.attempts).toBe(4);
  });

  it("resets at the window boundary, not before it", () => {
    const started = new Date(0);
    expect(
      evaluatePrivateGalleryExchangeRate(
        { windowStartedAt: started, attempts: 99 },
        new Date(999),
        config,
      ).allowed,
    ).toBe(false);
    const reset = evaluatePrivateGalleryExchangeRate(
      { windowStartedAt: started, attempts: 99 },
      new Date(1000),
      config,
    );
    expect(reset.allowed).toBe(true);
    expect(reset.next).toEqual({
      windowStartedAt: new Date(1000),
      attempts: 1,
    });
  });

  it.each([
    ["an unparseable window start", { windowStartedAt: new Date("x"), attempts: 1 }],
    ["a negative count", { windowStartedAt: new Date(0), attempts: -1 }],
    ["a fractional count", { windowStartedAt: new Date(0), attempts: 1.5 }],
    ["a NaN count", { windowStartedAt: new Date(0), attempts: Number.NaN }],
  ])("fails closed on a corrupt counter: %s", (_label, counter) => {
    expectReason(
      () =>
        evaluatePrivateGalleryExchangeRate(counter, new Date(100), config),
      "malformed-record",
    );
  });

  it.each([
    [{ now: new Date("x"), config }],
    [{ now: new Date(0), config: { maxAttempts: 0, windowMs: 1000 } }],
    [{ now: new Date(0), config: { maxAttempts: 1.5, windowMs: 1000 } }],
    [{ now: new Date(0), config: { maxAttempts: 3, windowMs: 0 } }],
    [{ now: new Date(0), config: { maxAttempts: 3, windowMs: Number.NaN } }],
  ])("rejects a malformed input %o", ({ now, config: bad }) => {
    expectReason(
      () => evaluatePrivateGalleryExchangeRate(undefined, now, bad),
      "invalid-parameter",
    );
  });
});

describe("resolveVerifiedPrivateGalleryCapability", () => {
  it("verifies a genuine capability and returns the gallery", async () => {
    const { ring, handle, secret, store } = scenario();
    const resolved = await resolveVerifiedPrivateGalleryCapability(
      { store, keyring: ring },
      { handle, submittedSecret: secret, now: NOW },
    );
    expect(resolved.gallery.galleryHandle).toBe(handle);
    expect(resolved.capability.capabilityGeneration).toBe(3);
    expect(resolved.accessExpiresAt).toEqual(new Date(200 * DAY));
  });

  it("refuses a well-formed capability that is not this gallery's", async () => {
    const { ring, handle, store } = scenario();
    await expectAsyncReason(
      () =>
        resolveVerifiedPrivateGalleryCapability(
          { store, keyring: ring },
          {
            handle,
            submittedSecret: generateCapabilitySecret(),
            now: NOW,
          },
        ),
      "capability-mismatch",
    );
  });

  it("refuses a malformed submitted capability as the same class", async () => {
    const { ring, handle, store } = scenario();
    await expectAsyncReason(
      () =>
        resolveVerifiedPrivateGalleryCapability(
          { store, keyring: ring },
          { handle, submittedSecret: "hunter2", now: NOW },
        ),
      "capability-mismatch",
    );
  });

  it("never touches the store for a malformed handle", async () => {
    const { ring, secret, store } = scenario();
    await expectAsyncReason(
      () =>
        resolveVerifiedPrivateGalleryCapability(
          { store, keyring: ring },
          { handle: "too-short", submittedSecret: secret, now: NOW },
        ),
      "invalid-handle",
    );
    expect(store.consumeExchangeAttempt).not.toHaveBeenCalled();
  });

  it("creates no counter row for an unknown handle", async () => {
    const { ring, secret, store, counters } = scenario();
    for (let i = 0; i < 5; i += 1) {
      await expectAsyncReason(
        () =>
          resolveVerifiedPrivateGalleryCapability(
            { store, keyring: ring },
            {
              handle: generateGalleryHandle(),
              submittedSecret: secret,
              now: NOW,
            },
          ),
        "not-found",
      );
    }
    expect(counters.size).toBe(0);
  });

  it("refuses once the gallery's persistent window is exhausted", async () => {
    const { ring, handle, secret, store } = scenario();
    const attempt = () =>
      resolveVerifiedPrivateGalleryCapability(
        { store, keyring: ring },
        { handle, submittedSecret: secret, now: NOW },
      );
    for (let i = 0; i < PRIVATE_GALLERY_EXCHANGE_HANDLE_MAX_ATTEMPTS; i += 1) {
      await attempt();
    }
    await expectAsyncReason(attempt, "rate-limited");
  });

  it.each([
    [
      "a revoked gallery (access-suspended is the normal revoked state)",
      { gallery: { state: "access-suspended" as const } },
      "not-available",
    ],
    [
      "a gallery still in preparation",
      { gallery: { state: "ready" as const } },
      "not-available",
    ],
    [
      "a closed access window",
      { gallery: { accessExpiresAt: NOW } },
      "access-expired",
    ],
    [
      "a published gallery with no capability row (a defect, not a revoke)",
      { capability: null },
      "no-capability",
    ],
    [
      "a capability row from another generation",
      { capability: { capabilityGeneration: 2 } },
      "malformed-record",
    ],
    [
      "a capability row whose keyId disagrees with its envelope",
      { capability: { keyId: "k9" } },
      "malformed-record",
    ],
    [
      "a published gallery with an unusable access expiry",
      { gallery: { accessExpiresAt: undefined } },
      "malformed-record",
    ],
  ])("refuses %s", async (_label, overrides, reason) => {
    const built = scenario(overrides as Parameters<typeof scenario>[0]);
    await expectAsyncReason(
      () =>
        resolveVerifiedPrivateGalleryCapability(
          { store: built.store, keyring: built.ring },
          {
            handle: built.handle,
            submittedSecret: built.secret,
            now: NOW,
          },
        ),
      reason,
    );
  });

  it("refuses a gallery row whose own handle is not the requested one", async () => {
    // The requested handle — never a store-returned alias — is what binds the
    // capability's associated data, so a row answering under one handle while
    // carrying another is a defect, not an alias to accept.
    const { ring, handle, secret, gallery, capability } = scenario();
    const aliased: PrivateGalleryExchangeStore = {
      consumeExchangeAttempt: async () => ({
        outcome: "ok",
        gallery: { ...gallery, galleryHandle: generateGalleryHandle() },
        capability,
      }),
    };
    await expectAsyncReason(
      () =>
        resolveVerifiedPrivateGalleryCapability(
          { store: aliased, keyring: ring },
          { handle, submittedSecret: secret, now: NOW },
        ),
      "malformed-record",
    );
  });

  it("refuses an envelope this deployment's keyring cannot open", async () => {
    const { handle, secret, store } = scenario();
    const otherRing: PrivateGalleryCapabilityKeyring = {
      activeKeyId: KEY_ID,
      keyIds: Object.freeze([KEY_ID]),
      getKey: () => Uint8Array.from(Buffer.alloc(32, 9)),
    };
    await expectAsyncReason(
      () =>
        resolveVerifiedPrivateGalleryCapability(
          { store, keyring: otherRing },
          { handle, submittedSecret: secret, now: NOW },
        ),
      "malformed-record",
    );
  });

  it("never puts the handle or a capability into an error message", async () => {
    const { ring, handle, store } = scenario();
    try {
      await resolveVerifiedPrivateGalleryCapability(
        { store, keyring: ring },
        {
          handle,
          submittedSecret: generateCapabilitySecret(),
          now: NOW,
        },
      );
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(handle);
      expect(message).not.toContain("secret");
    }
  });

  it("rejects an invalid clock", async () => {
    const { ring, handle, secret, store } = scenario();
    await expectAsyncReason(
      () =>
        resolveVerifiedPrivateGalleryCapability(
          { store, keyring: ring },
          { handle, submittedSecret: secret, now: new Date("x") },
        ),
      "invalid-parameter",
    );
  });

  it("uses the shipped rate config by default", () => {
    expect(PRIVATE_GALLERY_EXCHANGE_RATE_CONFIG.maxAttempts).toBe(
      PRIVATE_GALLERY_EXCHANGE_HANDLE_MAX_ATTEMPTS,
    );
  });
});
