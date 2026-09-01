import { describe, expect, it, vi } from "vitest";

import type {
  PrivateGallery,
  PrivateGalleryCapability,
  PrivateGallerySession,
} from "@/lib/private-gallery";
import { exchangePrivateGalleryCapability } from "@/lib/private-gallery-access";
import {
  generateCapabilitySecret,
  generateGalleryHandle,
  sealCapability,
} from "@/lib/private-gallery-capability";
import type { PrivateGalleryCapabilityKeyring } from "@/lib/private-gallery-config";
import {
  evaluatePrivateGalleryExchangeRate,
  type PrivateGalleryExchangeLookup,
  type PrivateGalleryExchangeRateCounter,
  type PrivateGalleryExchangeStore,
} from "@/lib/private-gallery-exchange";
import {
  assertPrivateGallerySessionAuthorizesGallery,
  hashPrivateGallerySessionId,
  PrivateGallerySessionError,
  type PrivateGallerySessionStore,
} from "@/lib/private-gallery-session";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(10 * DAY);
const KEY_ID = "k1";

function keyring(keyFill = 5): PrivateGalleryCapabilityKeyring {
  const key = Buffer.alloc(32, keyFill);
  return {
    activeKeyId: KEY_ID,
    keyIds: Object.freeze([KEY_ID]),
    getKey: (id) => (id === KEY_ID ? Uint8Array.from(key) : undefined),
  };
}

function makeSessionStore() {
  const rows: PrivateGallerySession[] = [];
  const store: PrivateGallerySessionStore = {
    async create(session) {
      rows.push(session);
    },
    async findByHash(hash) {
      return rows.find((s) => s.sessionIdHash === hash);
    },
    async deleteByHash(hash) {
      const i = rows.findIndex((s) => s.sessionIdHash === hash);
      if (i >= 0) rows.splice(i, 1);
    },
  };
  return { store, rows };
}

function alwaysAllowLimiter() {
  return { tryConsume: vi.fn(() => ({ allowed: true as const })) };
}

function build(
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
  const sealed = sealCapability(ring, { galleryId, handle, generation }, secret);

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

  const counters = new Map<string, PrivateGalleryExchangeRateCounter>();
  const exchangeStore: PrivateGalleryExchangeStore = {
    consumeExchangeAttempt: vi.fn(
      async (requested, now, config): Promise<PrivateGalleryExchangeLookup> => {
        if (requested !== gallery.galleryHandle) {
          return { outcome: "unknown-handle" };
        }
        const decision = evaluatePrivateGalleryExchangeRate(
          counters.get(galleryId),
          now,
          config,
        );
        counters.set(galleryId, decision.next);
        if (!decision.allowed) {
          return {
            outcome: "rate-limited",
            firstRefusalInWindow: decision.firstRefusalInWindow,
          };
        }
        return { outcome: "ok", gallery, capability };
      },
    ),
  };

  const sessions = makeSessionStore();
  return {
    ring,
    handle,
    secret,
    gallery,
    exchangeStore,
    sessionStore: sessions.store,
    sessionRows: sessions.rows,
    deps: {
      exchangeStore,
      sessionStore: sessions.store,
      keyring: ring,
      routePrefix: "private",
      ipLimiter: alwaysAllowLimiter(),
    },
  };
}

describe("exchangePrivateGalleryCapability", () => {
  it("mints a session and a path-scoped cookie for a genuine capability", async () => {
    const built = build();
    const result = await exchangePrivateGalleryCapability(built.deps, {
      handle: built.handle,
      submittedSecret: built.secret,
      clientKey: "client",
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cookie.options.path).toBe(`/private/${built.handle}`);
    expect(result.cookie.options).toMatchObject({
      secure: true,
      httpOnly: true,
      sameSite: "lax",
    });
    expect(result.session.sessionIdHash).toBe(
      hashPrivateGallerySessionId(result.cookie.value),
    );
    expect(result.session.capabilityGeneration).toBe(3);
    expect(built.sessionRows).toHaveLength(1);
  });

  it("creates no session when the capability does not match", async () => {
    const built = build();
    const result = await exchangePrivateGalleryCapability(built.deps, {
      handle: built.handle,
      submittedSecret: generateCapabilitySecret(),
      clientKey: "client",
      now: NOW,
    });

    expect(result.ok).toBe(false);
    expect(built.sessionRows).toHaveLength(0);
  });

  it("short-circuits on the per-IP layer without touching the store", async () => {
    const built = build();
    const deps = {
      ...built.deps,
      ipLimiter: {
        tryConsume: vi.fn(() => ({
          allowed: false as const,
          firstRefusalInWindow: true,
        })),
      },
    };
    const result = await exchangePrivateGalleryCapability(deps, {
      handle: built.handle,
      submittedSecret: built.secret,
      clientKey: "client",
      now: NOW,
    });

    expect(result).toEqual({
      ok: false,
      failure: { reason: "rate-limited", logWorthy: true },
    });
    expect(built.exchangeStore.consumeExchangeAttempt).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown handle", { useUnknownHandle: true }, "not-found", false],
    [
      "a revoked (access-suspended) gallery",
      { gallery: { state: "access-suspended" as const } },
      "not-available",
      false,
    ],
    [
      "a closed access window",
      { gallery: { accessExpiresAt: NOW } },
      "access-expired",
      false,
    ],
    [
      "a published gallery with no capability row",
      { capability: null },
      "no-capability",
      true,
    ],
    [
      "a capability row from another generation",
      { capability: { capabilityGeneration: 9 } },
      "malformed-record",
      true,
    ],
  ])(
    "refuses %s with the right log classification",
    async (_label, overrides, reason, logWorthy) => {
      const { useUnknownHandle, ...scenarioOverrides } = overrides as {
        useUnknownHandle?: boolean;
      } & Parameters<typeof build>[0];
      const built = build(scenarioOverrides);
      const result = await exchangePrivateGalleryCapability(built.deps, {
        handle: useUnknownHandle ? generateGalleryHandle() : built.handle,
        submittedSecret: built.secret,
        clientKey: "client",
        now: NOW,
      });

      expect(result).toEqual({ ok: false, failure: { reason, logWorthy } });
      expect(built.sessionRows).toHaveLength(0);
    },
  );

  it("returns one structurally identical failure for every class", async () => {
    const cases: Parameters<typeof build>[0][] = [
      {}, // a wrong capability against an otherwise valid gallery
      { gallery: { state: "access-suspended" as const } },
      { gallery: { accessExpiresAt: NOW } },
      { capability: null },
      { capability: { capabilityGeneration: 9 } },
    ];

    const reasons = new Set<string>();
    for (const overrides of cases) {
      const built = build(overrides);
      const result = await exchangePrivateGalleryCapability(built.deps, {
        handle: built.handle,
        submittedSecret: generateCapabilitySecret(),
        clientKey: "client",
        now: NOW,
      });

      expect(result.ok).toBe(false);
      if (result.ok) continue;
      // Nothing but the two log-only fields exists on a refusal, and their
      // names never vary — so a route that answers `{ ok: false }` uniformly
      // has nothing left with which to leak whether the handle exists.
      expect(Object.keys(result).sort()).toEqual(["failure", "ok"]);
      expect(Object.keys(result.failure).sort()).toEqual([
        "logWorthy",
        "reason",
      ]);
      reasons.add(result.failure.reason);
    }

    // The cases really do differ underneath — the shape is what is uniform.
    expect(reasons.size).toBeGreaterThan(1);
  });

  it("never throws, even when a store fails outright", async () => {
    const built = build();
    const deps = {
      ...built.deps,
      exchangeStore: {
        consumeExchangeAttempt: async () => {
          throw new Error("connection reset");
        },
      },
    };
    const result = await exchangePrivateGalleryCapability(deps, {
      handle: built.handle,
      submittedSecret: built.secret,
      clientKey: "client",
      now: NOW,
    });
    expect(result).toEqual({
      ok: false,
      failure: { reason: "unexpected", logWorthy: true },
    });
  });

  it("reports a refused session mint as a defect", async () => {
    const built = build();
    const deps = {
      ...built.deps,
      sessionStore: {
        ...built.sessionStore,
        create: async () => {
          throw new PrivateGallerySessionError(
            "invalid-parameter",
            "test failure",
          );
        },
      },
    };
    const result = await exchangePrivateGalleryCapability(deps, {
      handle: built.handle,
      submittedSecret: built.secret,
      clientKey: "client",
      now: NOW,
    });
    expect(result).toEqual({
      ok: false,
      failure: { reason: "session-refused", logWorthy: true },
    });
  });

  it("leaves a session minted just before a revoke unable to authorize once", async () => {
    // The verified lookup and the session insert are separate operations, so a
    // concurrent revoke can produce a session bound to the previous generation.
    // It must never authorize even a single request.
    const built = build();
    const result = await exchangePrivateGalleryCapability(built.deps, {
      handle: built.handle,
      submittedSecret: built.secret,
      clientKey: "client",
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const revoked: PrivateGallery = {
      ...built.gallery,
      state: "access-suspended",
      capabilityGeneration: built.gallery.capabilityGeneration + 1,
    };
    expect(() =>
      assertPrivateGallerySessionAuthorizesGallery(
        result.session,
        revoked,
        new Date(NOW.getTime() + 1000),
      ),
    ).toThrow(PrivateGallerySessionError);
  });
});
