import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type {
  PrivateGalleryAdminSession,
} from "@/lib/private-gallery";
import {
  attemptPrivateGalleryAdminLogin,
  authorizePrivateGalleryAdministrator,
  buildPrivateGalleryAdminLogoutCookie,
  requirePrivateGalleryAdminReauthentication,
} from "@/lib/private-gallery-access";
import {
  encodePrivateGalleryAdminCredential,
  PRIVATE_GALLERY_ADMIN_SALT_BYTES,
  PRIVATE_GALLERY_ADMIN_SECRET_HASH_SETTING,
} from "@/lib/private-gallery-admin-credential";
import {
  evaluatePrivateGalleryAdminLoginRate,
  type PrivateGalleryAdminLoginRateCounter,
  type PrivateGalleryAdminLoginStore,
} from "@/lib/private-gallery-admin-login";
import {
  PRIVATE_GALLERY_ADMIN_REAUTHENTICATION_WINDOW_MS,
  PRIVATE_GALLERY_ADMIN_SESSION_COOKIE_NAME,
  type PrivateGalleryAdminSessionStore,
} from "@/lib/private-gallery-admin-session";
import type { ContactRateLimiter } from "@/lib/contact-rate-limit";

const SECRET = randomBytes(32).toString("base64url");
const OTHER_SECRET = randomBytes(32).toString("base64url");
const ENCODED = encodePrivateGalleryAdminCredential({
  secret: SECRET,
  salt: Buffer.alloc(PRIVATE_GALLERY_ADMIN_SALT_BYTES, 3),
});
const ROTATED = encodePrivateGalleryAdminCredential({
  secret: OTHER_SECRET,
  salt: Buffer.alloc(PRIVATE_GALLERY_ADMIN_SALT_BYTES, 4),
});
const ENV = { [PRIVATE_GALLERY_ADMIN_SECRET_HASH_SETTING]: ENCODED };
const NOW = new Date("2026-09-02T14:00:00.000Z");

function loginStore() {
  let counter: PrivateGalleryAdminLoginRateCounter | undefined;
  const store: PrivateGalleryAdminLoginStore = {
    async consumeLoginAttempt(now, config) {
      const decision = evaluatePrivateGalleryAdminLoginRate(counter, now, config);
      counter = decision.next;
      return decision;
    },
  };
  return store;
}

/** A persisted counter that has already been spent. */
function exhaustedLoginStore(): PrivateGalleryAdminLoginStore {
  return {
    async consumeLoginAttempt() {
      return {
        allowed: false,
        firstRefusalInWindow: true,
        next: { windowStartedAt: NOW, attempts: 99 },
      };
    },
  };
}

function sessionStore() {
  const rows: PrivateGalleryAdminSession[] = [];
  const store: PrivateGalleryAdminSessionStore = {
    async create(session) {
      rows.push(session);
    },
    async findByHash(hash) {
      return rows.find((row) => row.sessionIdHash === hash);
    },
    async deleteByHash(hash) {
      const i = rows.findIndex((row) => row.sessionIdHash === hash);
      if (i >= 0) rows.splice(i, 1);
    },
  };
  return { store, rows };
}

const openLimiter = (): ContactRateLimiter => ({
  tryConsume: vi.fn(() => ({ allowed: true }) as const),
});

const closedLimiter = (): ContactRateLimiter => ({
  tryConsume: vi.fn(
    () => ({ allowed: false, firstRefusalInWindow: true }) as const,
  ),
});

async function loginWith(overrides: {
  readonly environment?: Record<string, string | undefined>;
  readonly secret?: string;
  readonly ipLimiter?: ContactRateLimiter;
  readonly loginStore?: PrivateGalleryAdminLoginStore;
}) {
  const sessions = sessionStore();
  const outcome = await attemptPrivateGalleryAdminLogin(
    {
      loginStore: overrides.loginStore ?? loginStore(),
      sessionStore: sessions.store,
      ipLimiter: overrides.ipLimiter ?? openLimiter(),
      environment: overrides.environment ?? ENV,
    },
    {
      submittedSecret: overrides.secret ?? SECRET,
      clientKey: "client",
      now: NOW,
    },
  );
  return { outcome, sessions };
}

describe("attemptPrivateGalleryAdminLogin", () => {
  it("mints a session bound to the credential's generation", async () => {
    const { outcome, sessions } = await loginWith({});
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(sessions.rows).toHaveLength(1);
    expect(outcome.session.credentialGeneration).toBe(
      sessions.rows[0]?.credentialGeneration,
    );
    expect(outcome.cookie.name).toBe(PRIVATE_GALLERY_ADMIN_SESSION_COOKIE_NAME);
    expect(outcome.cookie.options.sameSite).toBe("strict");
    // The raw identifier lives only in the cookie.
    expect(JSON.stringify(sessions.rows)).not.toContain(outcome.cookie.value);
  });

  it("refuses a wrong secret as an ordinary refusal, not a defect", async () => {
    const { outcome, sessions } = await loginWith({ secret: OTHER_SECRET });
    expect(outcome).toEqual({
      ok: false,
      failure: { reason: "wrong-secret", logWorthy: false },
    });
    expect(sessions.rows).toHaveLength(0);
  });

  it("throttles before it verifies — the ordering the facade exists for", async () => {
    // Proof by observation rather than by inspection: with no credential
    // configured at all, a refused throttle still reports `rate-limited`. If
    // verification ran first, this would be `not-provisioned` — and every
    // individual piece would still pass its own tests.
    const { outcome } = await loginWith({
      environment: {},
      loginStore: exhaustedLoginStore(),
    });
    expect(outcome).toEqual({
      ok: false,
      failure: { reason: "rate-limited", logWorthy: true },
    });
  });

  it("stops at the in-process layer before touching the persisted counter", async () => {
    const consumeLoginAttempt = vi.fn();
    const { outcome } = await loginWith({
      ipLimiter: closedLimiter(),
      loginStore: { consumeLoginAttempt } as unknown as PrivateGalleryAdminLoginStore,
    });
    expect(outcome).toMatchObject({ failure: { reason: "rate-limited" } });
    expect(consumeLoginAttempt).not.toHaveBeenCalled();
  });

  it("reports an unprovisioned deployment for the log while refusing like any other attempt", async () => {
    const { outcome } = await loginWith({ environment: {} });
    expect(outcome).toEqual({
      ok: false,
      failure: { reason: "not-provisioned", logWorthy: true },
    });
  });

  it("separates a malformed configured credential from a missing one", async () => {
    const { outcome } = await loginWith({
      environment: { [PRIVATE_GALLERY_ADMIN_SECRET_HASH_SETTING]: "nonsense" },
    });
    expect(outcome).toEqual({
      ok: false,
      failure: { reason: "credential-malformed", logWorthy: true },
    });
  });

  it("names a corrupt login counter rather than collapsing it to 'unexpected'", async () => {
    // Failing open here would make the expensive step free, so the counter
    // refuses — and says which row is wrong, because "nobody can log in" is
    // otherwise a long evening.
    const { outcome } = await loginWith({
      loginStore: {
        async consumeLoginAttempt(now, config) {
          return evaluatePrivateGalleryAdminLoginRate(
            { windowStartedAt: new Date("nope"), attempts: 1 },
            now,
            config,
          );
        },
      },
    });
    expect(outcome).toEqual({
      ok: false,
      failure: { reason: "login-counter-malformed", logWorthy: true },
    });
  });

  it("never throws, whatever the store does", async () => {
    const sessions = sessionStore();
    const outcome = await attemptPrivateGalleryAdminLogin(
      {
        loginStore: {
          async consumeLoginAttempt() {
            throw new Error("the database is on fire");
          },
        },
        sessionStore: sessions.store,
        ipLimiter: openLimiter(),
        environment: ENV,
      },
      { submittedSecret: SECRET, clientKey: "client", now: NOW },
    );
    expect(outcome).toEqual({
      ok: false,
      failure: { reason: "unexpected", logWorthy: true },
    });
  });

  it("puts neither the submitted secret nor the credential in the outcome", async () => {
    const { outcome } = await loginWith({ secret: OTHER_SECRET });
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain(OTHER_SECRET);
    expect(serialized).not.toContain(ENCODED);
  });
});

describe("authorizePrivateGalleryAdministrator", () => {
  async function authorizedSession() {
    const { outcome, sessions } = await loginWith({});
    if (!outcome.ok) throw new Error("expected a login");
    return { outcome, sessions };
  }

  it("authorizes a request carrying the session cookie", async () => {
    const { outcome, sessions } = await authorizedSession();
    const result = await authorizePrivateGalleryAdministrator(
      { sessionStore: sessions.store, environment: ENV },
      {
        cookieHeader: `${PRIVATE_GALLERY_ADMIN_SESSION_COOKIE_NAME}=${outcome.cookie.value}`,
        now: NOW,
      },
    );
    expect(result).toEqual({ ok: true, session: outcome.session });
  });

  it("treats an absent cookie as ordinary, not as something to alert on", async () => {
    const { sessions } = await authorizedSession();
    expect(
      await authorizePrivateGalleryAdministrator(
        { sessionStore: sessions.store, environment: ENV },
        { cookieHeader: null, now: NOW },
      ),
    ).toEqual({ ok: false, failure: { reason: "no-session", logWorthy: false } });
  });

  it("refuses every live session once the credential is rotated", async () => {
    // ADR-0015 §2's central revocation, end to end: nothing clears a table, the
    // configured value simply changes.
    const { outcome, sessions } = await authorizedSession();
    const cookieHeader = `${PRIVATE_GALLERY_ADMIN_SESSION_COOKIE_NAME}=${outcome.cookie.value}`;

    expect(
      (
        await authorizePrivateGalleryAdministrator(
          { sessionStore: sessions.store, environment: ENV },
          { cookieHeader, now: NOW },
        )
      ).ok,
    ).toBe(true);

    expect(
      await authorizePrivateGalleryAdministrator(
        {
          sessionStore: sessions.store,
          environment: {
            [PRIVATE_GALLERY_ADMIN_SECRET_HASH_SETTING]: ROTATED,
          },
        },
        { cookieHeader, now: NOW },
      ),
    ).toEqual({
      ok: false,
      failure: { reason: "session-refused", logWorthy: false },
    });
  });

  it("flags a corrupt stored row as a defect but a stale cookie as ordinary", async () => {
    const { outcome, sessions } = await authorizedSession();
    const cookieHeader = `${PRIVATE_GALLERY_ADMIN_SESSION_COOKIE_NAME}=${outcome.cookie.value}`;

    sessions.rows[0] = {
      ...(sessions.rows[0] as PrivateGalleryAdminSession),
      expiresAt: new Date("nope"),
    };
    expect(
      await authorizePrivateGalleryAdministrator(
        { sessionStore: sessions.store, environment: ENV },
        { cookieHeader, now: NOW },
      ),
    ).toEqual({
      ok: false,
      failure: { reason: "session-refused", logWorthy: true },
    });
  });

  it("refuses a request carrying two session cookies", async () => {
    const { outcome, sessions } = await authorizedSession();
    const name = PRIVATE_GALLERY_ADMIN_SESSION_COOKIE_NAME;
    expect(
      await authorizePrivateGalleryAdministrator(
        { sessionStore: sessions.store, environment: ENV },
        {
          cookieHeader: `${name}=${outcome.cookie.value}; ${name}=other`,
          now: NOW,
        },
      ),
    ).toMatchObject({ ok: false, failure: { reason: "session-refused" } });
  });

  it("reports an unprovisioned deployment rather than authorizing", async () => {
    const { outcome, sessions } = await authorizedSession();
    expect(
      await authorizePrivateGalleryAdministrator(
        { sessionStore: sessions.store, environment: {} },
        {
          cookieHeader: `${PRIVATE_GALLERY_ADMIN_SESSION_COOKIE_NAME}=${outcome.cookie.value}`,
          now: NOW,
        },
      ),
    ).toEqual({
      ok: false,
      failure: { reason: "not-provisioned", logWorthy: true },
    });
  });
});

describe("requirePrivateGalleryAdminReauthentication", () => {
  it("passes inside the window and refuses outside it", async () => {
    const { outcome } = await loginWith({});
    if (!outcome.ok) throw new Error("expected a login");

    expect(
      requirePrivateGalleryAdminReauthentication(outcome.session, NOW),
    ).toEqual({ ok: true });

    const late = new Date(
      NOW.getTime() + PRIVATE_GALLERY_ADMIN_REAUTHENTICATION_WINDOW_MS + 1,
    );
    expect(
      requirePrivateGalleryAdminReauthentication(outcome.session, late),
    ).toEqual({
      ok: false,
      failure: { reason: "reauthentication-required", logWorthy: false },
    });
  });

  it("never throws on a malformed session", () => {
    expect(
      requirePrivateGalleryAdminReauthentication(
        { reauthenticatedAt: new Date("nope") } as PrivateGalleryAdminSession,
        NOW,
      ),
    ).toMatchObject({ ok: false });
  });
});

describe("logout", () => {
  it("clears the cookie with the same attributes it was set with", () => {
    const cookie = buildPrivateGalleryAdminLogoutCookie();
    expect(cookie.value).toBe("");
    expect(cookie.options.maxAge).toBe(0);
    expect(cookie.options).toMatchObject({
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "strict",
    });
  });
});
