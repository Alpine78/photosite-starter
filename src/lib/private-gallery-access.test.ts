import { describe, expect, it, vi } from "vitest";

import type {
  PrivateGallery,
  PrivateGalleryCapability,
  PrivateGallerySession,
} from "@/lib/private-gallery";
import {
  authorizePrivateGalleryView,
  exchangePrivateGalleryCapability,
} from "@/lib/private-gallery-access";
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
  createPrivateGallerySession,
  hashPrivateGallerySessionId,
  PRIVATE_GALLERY_SESSION_COOKIE_NAME,
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

// ---------------------------------------------------------------------------
// Session-authorized view (ADR-0014 §5 Stage 1)
// ---------------------------------------------------------------------------

const VIEW_GALLERY: PrivateGallery = {
  galleryId: "gallery-under-test",
  galleryHandle: generateGalleryHandle(),
  state: "published",
  capabilityGeneration: 3,
  createdAt: new Date(NOW.getTime() - DAY),
  publishedAt: new Date(NOW.getTime() - DAY),
  accessExpiresAt: new Date(NOW.getTime() + 30 * DAY),
};

/**
 * A view fixture with a real session minted through the real session module, so
 * the cookie value under test is one the exchange would actually have issued.
 */
async function viewFixture(
  overrides: { gallery?: Partial<PrivateGallery> } = {},
) {
  const gallery: PrivateGallery = { ...VIEW_GALLERY, ...overrides.gallery };
  const { store: sessionStore, rows } = makeSessionStore();
  const { cookie } = await createPrivateGallerySession(sessionStore, {
    galleryId: VIEW_GALLERY.galleryId,
    galleryHandle: VIEW_GALLERY.galleryHandle,
    routePrefix: "private",
    capabilityGeneration: VIEW_GALLERY.capabilityGeneration,
    accessExpiresAt: VIEW_GALLERY.accessExpiresAt as Date,
    now: NOW,
  });

  const findGalleryById = vi.fn(async (id: string) =>
    id === gallery.galleryId ? gallery : undefined,
  );

  return {
    gallery,
    rows,
    findGalleryById,
    deps: { sessionStore, viewStore: { findGalleryById } },
    header: `${PRIVATE_GALLERY_SESSION_COOKIE_NAME}=${cookie.value}`,
    cookieValue: cookie.value,
  };
}

describe("authorizePrivateGalleryView", () => {
  it("authorizes the gallery the session was minted for", async () => {
    const f = await viewFixture();

    const outcome = await authorizePrivateGalleryView(f.deps, {
      handle: VIEW_GALLERY.galleryHandle,
      cookieHeader: f.header,
      now: NOW,
    });

    expect(outcome.authorized).toBe(true);
    if (!outcome.authorized) return;
    expect(outcome.gallery.galleryId).toBe(VIEW_GALLERY.galleryId);
    expect(outcome.session.capabilityGeneration).toBe(3);
  });

  it("reads the gallery by the session's id, never by the requested handle", async () => {
    // The load-bearing property: no store lookup is ever keyed by something the
    // URL supplied, so this page is not an enumeration primitive over handles.
    const f = await viewFixture();

    await authorizePrivateGalleryView(f.deps, {
      handle: VIEW_GALLERY.galleryHandle,
      cookieHeader: f.header,
      now: NOW,
    });

    expect(f.findGalleryById).toHaveBeenCalledExactlyOnceWith(
      VIEW_GALLERY.galleryId,
    );
  });

  it("consults no store at all without a session cookie", async () => {
    const f = await viewFixture();

    const outcome = await authorizePrivateGalleryView(f.deps, {
      handle: VIEW_GALLERY.galleryHandle,
      cookieHeader: null,
      now: NOW,
    });

    expect(outcome.authorized).toBe(false);
    expect(f.findGalleryById).not.toHaveBeenCalled();
  });

  it("refuses a valid session pointed at another gallery's address", async () => {
    const f = await viewFixture();

    const outcome = await authorizePrivateGalleryView(f.deps, {
      handle: generateGalleryHandle(),
      cookieHeader: f.header,
      now: NOW,
    });

    expect(outcome).toEqual({
      authorized: false,
      failure: { reason: "wrong-gallery", logWorthy: false },
    });
  });

  it("refuses a request carrying two session cookies", async () => {
    // A host-only cookie plus a cookie-tossed `Domain` sibling. Refused rather
    // than resolved to whichever one a name-keyed parser would have kept.
    const f = await viewFixture();

    const outcome = await authorizePrivateGalleryView(f.deps, {
      handle: VIEW_GALLERY.galleryHandle,
      cookieHeader: `${f.header}; ${f.header}`,
      now: NOW,
    });

    expect(outcome.authorized).toBe(false);
  });

  it.each([
    ["a malformed cookie value", "not-a-session-id"],
    ["a well-formed but unknown identifier", "B".repeat(43)],
  ])("refuses %s", async (_case, value) => {
    const f = await viewFixture();

    const outcome = await authorizePrivateGalleryView(f.deps, {
      handle: VIEW_GALLERY.galleryHandle,
      cookieHeader: `${PRIVATE_GALLERY_SESSION_COOKIE_NAME}=${value}`,
      now: NOW,
    });

    expect(outcome.authorized).toBe(false);
  });

  it("refuses once the session's own lifetime has run out", async () => {
    const f = await viewFixture();

    const outcome = await authorizePrivateGalleryView(f.deps, {
      handle: VIEW_GALLERY.galleryHandle,
      cookieHeader: f.header,
      now: new Date(NOW.getTime() + 8 * DAY),
    });

    expect(outcome).toEqual({
      authorized: false,
      failure: { reason: "expired-session", logWorthy: false },
    });
  });

  it("refuses a session whose capability generation was superseded", async () => {
    // What a revoke or replace actually does: the administrator bumps the
    // generation, and the next request on an old session stops working.
    const f = await viewFixture({ gallery: { capabilityGeneration: 4 } });

    const outcome = await authorizePrivateGalleryView(f.deps, {
      handle: VIEW_GALLERY.galleryHandle,
      cookieHeader: f.header,
      now: NOW,
    });

    expect(outcome).toEqual({
      authorized: false,
      failure: { reason: "stale-generation", logWorthy: false },
    });
  });

  it.each([
    // What a revoke leaves behind, what a gallery looks like before publication,
    // and what the retention worker moves it to at six months.
    ["access-suspended", "gallery-unavailable"],
    ["draft", "gallery-unavailable"],
    ["expiring", "gallery-unavailable"],
  ] as const)(
    "refuses a gallery in state %s",
    async (state, reason) => {
      const f = await viewFixture({ gallery: { state } });

      const outcome = await authorizePrivateGalleryView(f.deps, {
        handle: VIEW_GALLERY.galleryHandle,
        cookieHeader: f.header,
        now: NOW,
      });

      expect(outcome).toEqual({
        authorized: false,
        failure: { reason, logWorthy: false },
      });
    },
  );

  it("refuses once the gallery's own access window has closed", async () => {
    const f = await viewFixture();

    const outcome = await authorizePrivateGalleryView(f.deps, {
      handle: VIEW_GALLERY.galleryHandle,
      cookieHeader: f.header,
      // Past the gallery's expiry but well inside the session's own week, so
      // only the gallery-side check can catch this.
      now: new Date(NOW.getTime() + 31 * DAY),
    });

    expect(outcome.authorized).toBe(false);
  });

  it("logs a session naming a gallery that no longer exists, and nothing else", async () => {
    // The one genuine defect among these: an ordinary expiry or revoke is a
    // Tuesday, and logging those would let anyone fill the log by reloading.
    const f = await viewFixture();
    f.findGalleryById.mockResolvedValueOnce(undefined);

    const outcome = await authorizePrivateGalleryView(f.deps, {
      handle: VIEW_GALLERY.galleryHandle,
      cookieHeader: f.header,
      now: NOW,
    });

    expect(outcome).toEqual({
      authorized: false,
      failure: { reason: "gallery-missing", logWorthy: true },
    });
  });

  it("returns a failure rather than throwing when the store fails", async () => {
    const f = await viewFixture();
    f.findGalleryById.mockRejectedValueOnce(new Error("connection reset"));

    await expect(
      authorizePrivateGalleryView(f.deps, {
        handle: VIEW_GALLERY.galleryHandle,
        cookieHeader: f.header,
        now: NOW,
      }),
    ).resolves.toEqual({
      authorized: false,
      failure: { reason: "unexpected", logWorthy: true },
    });
  });

  it("never carries the handle, the session id, or its hash in a failure", async () => {
    const f = await viewFixture();
    const outcome = await authorizePrivateGalleryView(f.deps, {
      handle: VIEW_GALLERY.galleryHandle,
      cookieHeader: `${PRIVATE_GALLERY_SESSION_COOKIE_NAME}=${"B".repeat(43)}`,
      now: NOW,
    });

    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain(VIEW_GALLERY.galleryHandle);
    expect(serialized).not.toContain(f.cookieValue);
    expect(serialized).not.toContain(f.rows[0]?.sessionIdHash);
  });
});
