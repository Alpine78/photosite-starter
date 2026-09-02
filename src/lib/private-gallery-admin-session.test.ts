import { describe, expect, it, vi } from "vitest";

import type { PrivateGalleryAdminSession } from "@/lib/private-gallery";
import {
  MAX_PRIVATE_GALLERY_SESSION_TTL_MS,
  PRIVATE_GALLERY_SESSION_COOKIE_NAME,
} from "@/lib/private-gallery-session";
import {
  assertPrivateGalleryAdminReauthenticated,
  assertPrivateGalleryAdminSessionIdShape,
  assertPrivateGalleryAdminSessionIsCurrent,
  authorizePrivateGalleryAdminRequest,
  buildPrivateGalleryAdminSessionClearCookie,
  computePrivateGalleryAdminSessionLifetimeSeconds,
  createPrivateGalleryAdminSession,
  extractPrivateGalleryAdminSessionCookie,
  generatePrivateGalleryAdminSessionId,
  hashPrivateGalleryAdminSessionId,
  MAX_PRIVATE_GALLERY_ADMIN_ACTIVE_SESSION_CAP,
  MAX_PRIVATE_GALLERY_ADMIN_SESSION_TTL_MS,
  PRIVATE_GALLERY_ADMIN_ACTIVE_SESSION_CAP_DEFAULT,
  PRIVATE_GALLERY_ADMIN_REAUTHENTICATION_WINDOW_MS,
  PRIVATE_GALLERY_ADMIN_SESSION_COOKIE_NAME,
  PRIVATE_GALLERY_ADMIN_SESSION_TTL_MS,
  PrivateGalleryAdminSessionError,
  readPrivateGalleryAdminSession,
  type PrivateGalleryAdminSessionStore,
} from "@/lib/private-gallery-admin-session";

const GENERATION = "cred-gen-1";
const NOW = new Date("2026-09-02T10:00:00.000Z");

function makeStore() {
  const rows: PrivateGalleryAdminSession[] = [];
  const capCalls: number[] = [];
  const store: PrivateGalleryAdminSessionStore = {
    async create(session, cap) {
      capCalls.push(cap);
      rows.push(session);
      const group = rows
        .filter((s) => s.credentialGeneration === session.credentialGeneration)
        .sort(
          (a, b) =>
            a.createdAt.getTime() - b.createdAt.getTime() ||
            (a.sessionIdHash < b.sessionIdHash
              ? -1
              : a.sessionIdHash > b.sessionIdHash
                ? 1
                : 0),
        );
      for (const evicted of group.slice(0, Math.max(0, group.length - cap))) {
        rows.splice(rows.indexOf(evicted), 1);
      }
    },
    findByHash: vi.fn(async (hash: string) =>
      rows.find((s) => s.sessionIdHash === hash),
    ),
    async deleteByHash(hash) {
      const i = rows.findIndex((s) => s.sessionIdHash === hash);
      if (i >= 0) rows.splice(i, 1);
    },
  };
  return { store, rows, capCalls };
}

function reason(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof PrivateGalleryAdminSessionError) return error.reason;
    throw error;
  }
  throw new Error("expected a PrivateGalleryAdminSessionError");
}

async function asyncReason(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof PrivateGalleryAdminSessionError) return error.reason;
    throw error;
  }
  throw new Error("expected a PrivateGalleryAdminSessionError");
}

describe("isolation from the customer session (ADR-0015 §2)", () => {
  it("uses a different cookie name, so neither can be presented as the other", () => {
    expect(PRIVATE_GALLERY_ADMIN_SESSION_COOKIE_NAME).not.toBe(
      PRIVATE_GALLERY_SESSION_COOKIE_NAME,
    );
  });

  it("carries the __Host- prefix the customer cookie could not", () => {
    // The customer cookie needs a per-gallery `Path`, which `__Host-` forbids.
    // This one does not, so it takes the stronger prefix.
    expect(PRIVATE_GALLERY_ADMIN_SESSION_COOKIE_NAME.startsWith("__Host-")).toBe(
      true,
    );
    expect(PRIVATE_GALLERY_SESSION_COOKIE_NAME.startsWith("__Host-")).toBe(false);
  });

  it("reads none of the customer session's cookie", () => {
    const customerCookie = `${PRIVATE_GALLERY_SESSION_COOKIE_NAME}=${generatePrivateGalleryAdminSessionId()}`;
    expect(
      extractPrivateGalleryAdminSessionCookie(customerCookie),
    ).toBeUndefined();
  });

  it("keeps its ceiling well below the customer session's seven days", () => {
    // ADR-0015 §2's "short … well below the customer session's seven days",
    // made executable: raising the administrator ceiling past a quarter of the
    // customer maximum fails here rather than landing quietly.
    expect(MAX_PRIVATE_GALLERY_ADMIN_SESSION_TTL_MS).toBeLessThanOrEqual(
      MAX_PRIVATE_GALLERY_SESSION_TTL_MS / 4,
    );
    expect(PRIVATE_GALLERY_ADMIN_SESSION_TTL_MS).toBeLessThanOrEqual(
      MAX_PRIVATE_GALLERY_ADMIN_SESSION_TTL_MS,
    );
  });
});

describe("the session identifier", () => {
  it("mints a canonical 256-bit token and stores only its hash", () => {
    const id = generatePrivateGalleryAdminSessionId();
    expect(() => assertPrivateGalleryAdminSessionIdShape(id)).not.toThrow();
    expect(hashPrivateGalleryAdminSessionId(id)).not.toBe(id);
  });

  it("refuses a malformed identifier with its own error type", () => {
    expect(reason(() => assertPrivateGalleryAdminSessionIdShape("nope"))).toBe(
      "invalid-session",
    );
    expect(() => assertPrivateGalleryAdminSessionIdShape("nope")).toThrow(
      PrivateGalleryAdminSessionError,
    );
  });

  it("never puts the identifier or its hash in an error message", () => {
    const id = generatePrivateGalleryAdminSessionId();
    try {
      assertPrivateGalleryAdminSessionIdShape(`${id}extra`);
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as Error).message).not.toContain(id);
    }
  });
});

describe("the __Host- cookie contract", () => {
  it("is Secure, HttpOnly, SameSite=Strict, Path=/, and has no Domain", async () => {
    const { store } = makeStore();
    const { cookie } = await createPrivateGalleryAdminSession(store, {
      credentialGeneration: GENERATION,
      now: NOW,
    });

    expect(cookie.name).toBe(PRIVATE_GALLERY_ADMIN_SESSION_COOKIE_NAME);
    expect(cookie.options).toMatchObject({
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "strict",
    });
    // `__Host-` is rejected by the browser if a Domain is present, so the
    // descriptor must not be able to express one.
    expect(cookie.options).not.toHaveProperty("domain");
  });

  it("carries the raw identifier only in the cookie, never in the row", async () => {
    const { store, rows } = makeStore();
    const { session, cookie } = await createPrivateGalleryAdminSession(store, {
      credentialGeneration: GENERATION,
      now: NOW,
    });

    expect(session.sessionIdHash).toBe(
      hashPrivateGalleryAdminSessionId(cookie.value),
    );
    expect(JSON.stringify(rows)).not.toContain(cookie.value);
  });

  it("clears with the same attributes and a zero Max-Age", () => {
    const clear = buildPrivateGalleryAdminSessionClearCookie();
    expect(clear.value).toBe("");
    expect(clear.options.maxAge).toBe(0);
    expect(clear.options).toMatchObject({
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "strict",
    });
  });

  it("reads its own cookie out of a header and refuses a duplicate", () => {
    const id = generatePrivateGalleryAdminSessionId();
    const name = PRIVATE_GALLERY_ADMIN_SESSION_COOKIE_NAME;

    expect(extractPrivateGalleryAdminSessionCookie(`x=1; ${name}=${id}`)).toBe(id);
    expect(extractPrivateGalleryAdminSessionCookie(null)).toBeUndefined();
    expect(
      reason(() =>
        extractPrivateGalleryAdminSessionCookie(`${name}=a; ${name}=b`),
      ),
    ).toBe("invalid-session");
  });
});

describe("the session lifetime", () => {
  it("defaults to the module's TTL and matches the cookie Max-Age", async () => {
    const { store } = makeStore();
    const { session, cookie } = await createPrivateGalleryAdminSession(store, {
      credentialGeneration: GENERATION,
      now: NOW,
    });

    const seconds = PRIVATE_GALLERY_ADMIN_SESSION_TTL_MS / 1000;
    expect(cookie.options.maxAge).toBe(seconds);
    expect(session.expiresAt.getTime() - session.createdAt.getTime()).toBe(
      seconds * 1000,
    );
  });

  it("lets a deployment lower the TTL", () => {
    expect(
      computePrivateGalleryAdminSessionLifetimeSeconds({ ttlMs: 60_000 }),
    ).toBe(60);
  });

  it("clamps a TTL above the ceiling rather than honouring it", () => {
    // A deployment may lower this window and never raise it: a longer one is
    // only ever worth more to whoever stole the cookie.
    expect(
      computePrivateGalleryAdminSessionLifetimeSeconds({
        ttlMs: MAX_PRIVATE_GALLERY_ADMIN_SESSION_TTL_MS * 10,
      }),
    ).toBe(MAX_PRIVATE_GALLERY_ADMIN_SESSION_TTL_MS / 1000);
  });

  it("refuses a nonsensical TTL", () => {
    for (const ttlMs of [0, 999, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        reason(() => computePrivateGalleryAdminSessionLifetimeSeconds({ ttlMs })),
      ).toBe("invalid-parameter");
    }
  });

  it("does not slide: reading a session never moves its expiry", async () => {
    const { store } = makeStore();
    const { session, cookie } = await createPrivateGalleryAdminSession(store, {
      credentialGeneration: GENERATION,
      now: NOW,
    });

    const later = new Date(NOW.getTime() + 60 * 60 * 1000);
    const read = await readPrivateGalleryAdminSession(store, cookie.value, later);
    expect(read.expiresAt.getTime()).toBe(session.expiresAt.getTime());
  });
});

describe("creation", () => {
  it("starts reauthenticatedAt equal to createdAt", async () => {
    const { store } = makeStore();
    const { session } = await createPrivateGalleryAdminSession(store, {
      credentialGeneration: GENERATION,
      now: NOW,
    });
    expect(session.reauthenticatedAt.getTime()).toBe(session.createdAt.getTime());
  });

  it("passes the default cap to the store", async () => {
    const { store, capCalls } = makeStore();
    await createPrivateGalleryAdminSession(store, {
      credentialGeneration: GENERATION,
      now: NOW,
    });
    expect(capCalls).toEqual([PRIVATE_GALLERY_ADMIN_ACTIVE_SESSION_CAP_DEFAULT]);
  });

  it("refuses an out-of-range cap", async () => {
    const { store } = makeStore();
    for (const activeSessionCap of [
      0,
      -1,
      1.5,
      MAX_PRIVATE_GALLERY_ADMIN_ACTIVE_SESSION_CAP + 1,
    ]) {
      expect(
        await asyncReason(() =>
          createPrivateGalleryAdminSession(store, {
            credentialGeneration: GENERATION,
            now: NOW,
            activeSessionCap,
          }),
        ),
      ).toBe("invalid-parameter");
    }
  });

  it("refuses a malformed credential generation", async () => {
    const { store } = makeStore();
    for (const credentialGeneration of ["", "has space", "a".repeat(129), "!"]) {
      expect(
        await asyncReason(() =>
          createPrivateGalleryAdminSession(store, {
            credentialGeneration,
            now: NOW,
          }),
        ),
      ).toBe("invalid-parameter");
    }
  });

  it("refuses an invalid clock", async () => {
    const { store } = makeStore();
    expect(
      await asyncReason(() =>
        createPrivateGalleryAdminSession(store, {
          credentialGeneration: GENERATION,
          now: new Date("nope"),
        }),
      ),
    ).toBe("invalid-parameter");
  });
});

describe("reading a session", () => {
  it("round-trips a freshly minted session", async () => {
    const { store } = makeStore();
    const { session, cookie } = await createPrivateGalleryAdminSession(store, {
      credentialGeneration: GENERATION,
      now: NOW,
    });
    await expect(
      readPrivateGalleryAdminSession(store, cookie.value, NOW),
    ).resolves.toEqual(session);
  });

  it("never reaches the store for a malformed cookie", async () => {
    const { store } = makeStore();
    expect(
      await asyncReason(() =>
        readPrivateGalleryAdminSession(store, "not-a-token", NOW),
      ),
    ).toBe("invalid-session");
    expect(store.findByHash).not.toHaveBeenCalled();
  });

  it("refuses an absent cookie", async () => {
    const { store } = makeStore();
    expect(
      await asyncReason(() =>
        readPrivateGalleryAdminSession(store, undefined, NOW),
      ),
    ).toBe("invalid-session");
  });

  it("refuses a well-formed identifier with no row", async () => {
    const { store } = makeStore();
    expect(
      await asyncReason(() =>
        readPrivateGalleryAdminSession(
          store,
          generatePrivateGalleryAdminSessionId(),
          NOW,
        ),
      ),
    ).toBe("invalid-session");
  });

  it("expires at expiresAt, not after it", async () => {
    const { store } = makeStore();
    const { session, cookie } = await createPrivateGalleryAdminSession(store, {
      credentialGeneration: GENERATION,
      now: NOW,
    });

    const justBefore = new Date(session.expiresAt.getTime() - 1);
    await expect(
      readPrivateGalleryAdminSession(store, cookie.value, justBefore),
    ).resolves.toBeDefined();

    expect(
      await asyncReason(() =>
        readPrivateGalleryAdminSession(store, cookie.value, session.expiresAt),
      ),
    ).toBe("expired-session");
  });

  it.each([
    [
      "invalid dates",
      { createdAt: new Date("nope") },
    ],
    [
      "an unordered span",
      { createdAt: new Date(NOW.getTime() + 1000), expiresAt: NOW },
    ],
    [
      "a lifetime past the ceiling",
      {
        expiresAt: new Date(
          NOW.getTime() + MAX_PRIVATE_GALLERY_ADMIN_SESSION_TTL_MS + 1000,
        ),
      },
    ],
    [
      "a re-authentication before the session began",
      { reauthenticatedAt: new Date(NOW.getTime() - 1000) },
    ],
    [
      "a re-authentication after the session ends",
      { reauthenticatedAt: new Date(NOW.getTime() + 10 * 60 * 60 * 1000) },
    ],
    [
      "a malformed credential generation",
      { credentialGeneration: "not a token" },
    ],
  ])("refuses a stored row with %s as a defect, not a stale cookie", async (_label, patch) => {
    const { store, rows } = makeStore();
    const { cookie } = await createPrivateGalleryAdminSession(store, {
      credentialGeneration: GENERATION,
      now: NOW,
    });
    rows[0] = { ...(rows[0] as PrivateGalleryAdminSession), ...patch };

    expect(
      await asyncReason(() =>
        readPrivateGalleryAdminSession(store, cookie.value, NOW),
      ),
    ).toBe("malformed-record");
  });

  it("keeps a corrupt row apart from a cookie with no row", async () => {
    // Both refuse the request identically, but only one is something an
    // operator has to act on, and the reason is what reaches their log.
    const { store, rows } = makeStore();
    const { cookie } = await createPrivateGalleryAdminSession(store, {
      credentialGeneration: GENERATION,
      now: NOW,
    });

    const absent = await asyncReason(() =>
      readPrivateGalleryAdminSession(
        store,
        generatePrivateGalleryAdminSessionId(),
        NOW,
      ),
    );

    rows[0] = {
      ...(rows[0] as PrivateGalleryAdminSession),
      createdAt: new Date("nope"),
    };
    const corrupt = await asyncReason(() =>
      readPrivateGalleryAdminSession(store, cookie.value, NOW),
    );

    expect(absent).toBe("invalid-session");
    expect(corrupt).toBe("malformed-record");
  });
});

describe("the credential generation (central revocation)", () => {
  it("accepts a session minted against the current credential", async () => {
    const { store } = makeStore();
    const { session } = await createPrivateGalleryAdminSession(store, {
      credentialGeneration: GENERATION,
      now: NOW,
    });
    expect(() =>
      assertPrivateGalleryAdminSessionIsCurrent(session, GENERATION),
    ).not.toThrow();
  });

  it("refuses every live session once the credential rotates", async () => {
    // ADR-0015 §2's central revocation: rotating the administrator secret ends
    // every session by itself, with no operator action and no second mechanism.
    const { store } = makeStore();
    const first = await createPrivateGalleryAdminSession(store, {
      credentialGeneration: GENERATION,
      now: NOW,
    });
    const second = await createPrivateGalleryAdminSession(store, {
      credentialGeneration: GENERATION,
      now: NOW,
    });

    for (const { session } of [first, second]) {
      expect(
        reason(() =>
          assertPrivateGalleryAdminSessionIsCurrent(session, "cred-gen-2"),
        ),
      ).toBe("stale-credential");
    }
  });

  it("refuses a malformed current generation rather than comparing it", async () => {
    const { store } = makeStore();
    const { session } = await createPrivateGalleryAdminSession(store, {
      credentialGeneration: GENERATION,
      now: NOW,
    });
    expect(
      reason(() => assertPrivateGalleryAdminSessionIsCurrent(session, "")),
    ).toBe("invalid-parameter");
  });

  it("never names the credential digest in the error", async () => {
    const { store } = makeStore();
    const { session } = await createPrivateGalleryAdminSession(store, {
      credentialGeneration: GENERATION,
      now: NOW,
    });
    try {
      assertPrivateGalleryAdminSessionIsCurrent(session, "cred-gen-2");
      throw new Error("expected a throw");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(GENERATION);
      expect(message).not.toContain("cred-gen-2");
    }
  });
});

describe("authorizePrivateGalleryAdminRequest", () => {
  it("composes the row check and the credential check", async () => {
    const { store } = makeStore();
    const { session, cookie } = await createPrivateGalleryAdminSession(store, {
      credentialGeneration: GENERATION,
      now: NOW,
    });

    await expect(
      authorizePrivateGalleryAdminRequest(store, cookie.value, GENERATION, NOW),
    ).resolves.toEqual(session);
  });

  it("refuses a valid unexpired session whose credential has rotated", async () => {
    const { store } = makeStore();
    const { cookie } = await createPrivateGalleryAdminSession(store, {
      credentialGeneration: GENERATION,
      now: NOW,
    });

    expect(
      await asyncReason(() =>
        authorizePrivateGalleryAdminRequest(
          store,
          cookie.value,
          "cred-gen-2",
          NOW,
        ),
      ),
    ).toBe("stale-credential");
  });

  it("refuses an expired session before it looks at the credential", async () => {
    const { store } = makeStore();
    const { session, cookie } = await createPrivateGalleryAdminSession(store, {
      credentialGeneration: GENERATION,
      now: NOW,
    });

    expect(
      await asyncReason(() =>
        authorizePrivateGalleryAdminRequest(
          store,
          cookie.value,
          "cred-gen-2",
          session.expiresAt,
        ),
      ),
    ).toBe("expired-session");
  });
});

describe("re-authentication for irreversible operations", () => {
  it("accepts a session inside the window", async () => {
    const { store } = makeStore();
    const { session } = await createPrivateGalleryAdminSession(store, {
      credentialGeneration: GENERATION,
      now: NOW,
    });

    const inside = new Date(
      NOW.getTime() + PRIVATE_GALLERY_ADMIN_REAUTHENTICATION_WINDOW_MS - 1,
    );
    expect(() =>
      assertPrivateGalleryAdminReauthenticated(session, inside),
    ).not.toThrow();
  });

  it("refuses an otherwise valid session once the window passes", async () => {
    // The session is still perfectly good for ordinary administration; only the
    // destructive operation needs the credential proved again.
    const { store } = makeStore();
    const { session, cookie } = await createPrivateGalleryAdminSession(store, {
      credentialGeneration: GENERATION,
      now: NOW,
    });

    const after = new Date(
      NOW.getTime() + PRIVATE_GALLERY_ADMIN_REAUTHENTICATION_WINDOW_MS + 1,
    );
    await expect(
      authorizePrivateGalleryAdminRequest(store, cookie.value, GENERATION, after),
    ).resolves.toBeDefined();
    expect(() => assertPrivateGalleryAdminReauthenticated(session, after)).toThrow(
      PrivateGalleryAdminSessionError,
    );
    expect(reason(() => assertPrivateGalleryAdminReauthenticated(session, after))).toBe(
      "reauthentication-required",
    );
  });

  it("refuses a re-authentication timestamped in the future", async () => {
    // A clock skew or a tampered row must not read as "very recent" and open a
    // destructive window.
    const { store } = makeStore();
    const { session } = await createPrivateGalleryAdminSession(store, {
      credentialGeneration: GENERATION,
      now: NOW,
    });

    const before = new Date(NOW.getTime() - 1000);
    expect(
      reason(() => assertPrivateGalleryAdminReauthenticated(session, before)),
    ).toBe("reauthentication-required");
  });

  it("honours a caller-supplied shorter window", async () => {
    const { store } = makeStore();
    const { session } = await createPrivateGalleryAdminSession(store, {
      credentialGeneration: GENERATION,
      now: NOW,
    });

    const at = new Date(NOW.getTime() + 2000);
    expect(() =>
      assertPrivateGalleryAdminReauthenticated(session, at, 5000),
    ).not.toThrow();
    expect(
      reason(() => assertPrivateGalleryAdminReauthenticated(session, at, 1000)),
    ).toBe("reauthentication-required");
  });

  it("refuses a nonsensical window rather than defaulting", async () => {
    const { store } = makeStore();
    const { session } = await createPrivateGalleryAdminSession(store, {
      credentialGeneration: GENERATION,
      now: NOW,
    });
    expect(
      reason(() => assertPrivateGalleryAdminReauthenticated(session, NOW, 0)),
    ).toBe("invalid-parameter");
  });
});
