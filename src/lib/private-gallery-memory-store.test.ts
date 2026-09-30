import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  exchangePrivateGalleryCapability,
  createPrivateGalleryExchangeIpLimiter,
} from "@/lib/private-gallery-access";
import {
  MEMORY_ADMIN_SECRET,
  MEMORY_GALLERY_CAPABILITY,
  MEMORY_GALLERY_HANDLE,
  MEMORY_PROOF_GALLERY_CAPABILITY,
  MEMORY_PROOF_GALLERY_HANDLE,
  getPrivateGalleryMemoryStore,
  resetPrivateGalleryMemoryStore,
} from "@/lib/private-gallery-memory-store";
import {
  parsePrivateGalleryAdminCredential,
  verifyPrivateGalleryAdminSecret,
} from "@/lib/private-gallery-admin-credential";
import { PRIVATE_GALLERY_ACCESS_BUDGET_WINDOW_MS } from "@/lib/private-gallery-delivery";

/**
 * The fixture store is exercised through the same facade a route uses, not
 * through its own seams: what matters is that a developer opening the published
 * link actually gets a session, and that nothing about the fixture weakens the
 * refusals the facade is responsible for.
 */
const NOW = new Date("2026-09-01T10:00:00.000Z");

function deps(overrides: Partial<Parameters<typeof exchangePrivateGalleryCapability>[0]> = {}) {
  const store = getPrivateGalleryMemoryStore();
  return {
    exchangeStore: store.exchangeStore,
    sessionStore: store.sessionStore,
    keyring: store.keyring,
    routePrefix: "private",
    ipLimiter: createPrivateGalleryExchangeIpLimiter(),
    ...overrides,
  };
}

function request(overrides: Partial<Parameters<typeof exchangePrivateGalleryCapability>[1]> = {}) {
  return {
    handle: MEMORY_GALLERY_HANDLE,
    submittedSecret: MEMORY_GALLERY_CAPABILITY,
    clientKey: "fixture-client",
    now: NOW,
    ...overrides,
  };
}

beforeEach(() => {
  resetPrivateGalleryMemoryStore();
});

afterEach(() => {
  resetPrivateGalleryMemoryStore();
});

describe("the published fixture link", () => {
  it("exchanges for a session", async () => {
    const outcome = await exchangePrivateGalleryCapability(deps(), request());

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.session.galleryId).toBe(
      getPrivateGalleryMemoryStore().gallery.galleryId,
    );
    // The cookie is scoped to this gallery's own path, not the whole site.
    expect(outcome.cookie.options.path).toBe(
      `/private/${MEMORY_GALLERY_HANDLE}`,
    );
  });

  it("publishes a handle and capability of the real shapes", () => {
    // A fixture whose values were not shaped like real ones would exercise a
    // different code path than a real link does.
    expect(MEMORY_GALLERY_HANDLE).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(MEMORY_GALLERY_CAPABILITY).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("pins the exact published values", () => {
    // `e2e/private-gallery-link.spec.ts` writes these literals out rather than
    // importing this module, which carries the `server-only` marker Playwright
    // has no stub for. This pin is what stops the two copies drifting.
    expect(MEMORY_GALLERY_HANDLE).toBe("EREREREREREREREREREREQ");
    expect(MEMORY_GALLERY_CAPABILITY).toBe(
      "LS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0",
    );
    // `e2e/private-gallery-admin.spec.ts` writes this one out for the same
    // reason.
    expect(MEMORY_ADMIN_SECRET).toBe(
      "development-fixture-administrator-secret-not-for-any-real-deployment",
    );
  });

  it("accepts its own published administrator secret and nothing else", () => {
    const credential = parsePrivateGalleryAdminCredential(
      getPrivateGalleryMemoryStore().adminCredentialHash,
    );
    expect(verifyPrivateGalleryAdminSecret(credential, MEMORY_ADMIN_SECRET)).toBe(
      true,
    );
    expect(
      verifyPrivateGalleryAdminSecret(credential, `${MEMORY_ADMIN_SECRET}x`),
    ).toBe(false);
  });

  it("never reads the deployment's own administrator credential", () => {
    // The same rule the ephemeral keyring follows: a development fixture must
    // not be able to authenticate against a real deployment's configuration.
    const source = getPrivateGalleryMemoryStore().adminCredentialHash;
    expect(source).not.toBe(process.env.PRIVATE_GALLERY_ADMIN_SECRET_HASH);
    expect(source.startsWith("scrypt$1$")).toBe(true);
  });
});

describe("the distinct development proof gallery", () => {
  it("exchanges its own sealed capability and refuses the delivery capability", async () => {
    const accepted = await exchangePrivateGalleryCapability(deps(), request({
      handle: MEMORY_PROOF_GALLERY_HANDLE,
      submittedSecret: MEMORY_PROOF_GALLERY_CAPABILITY,
    }));
    expect(accepted).toMatchObject({ ok: true });
    if (!accepted.ok) return;
    expect(accepted.session.galleryId).toBe(getPrivateGalleryMemoryStore().proofGallery.galleryId);
    expect(accepted.cookie.options.path).toBe(`/private/${MEMORY_PROOF_GALLERY_HANDLE}`);

    await expect(exchangePrivateGalleryCapability(deps(), request({
      handle: MEMORY_PROOF_GALLERY_HANDLE,
      submittedSecret: MEMORY_GALLERY_CAPABILITY,
    }))).resolves.toMatchObject({ ok: false });
    await expect(exchangePrivateGalleryCapability(deps(), request({
      handle: MEMORY_GALLERY_HANDLE,
      submittedSecret: MEMORY_PROOF_GALLERY_CAPABILITY,
    }))).resolves.toMatchObject({ ok: false });
  });

  it("keeps proof placements, draft, notification and delivery rate buckets scoped", async () => {
    const store = getPrivateGalleryMemoryStore();
    expect(MEMORY_PROOF_GALLERY_HANDLE).not.toBe(MEMORY_GALLERY_HANDLE);
    expect(MEMORY_PROOF_GALLERY_CAPABILITY).not.toBe(MEMORY_GALLERY_CAPABILITY);
    expect(await store.viewStore.findGalleryById(store.proofGallery.galleryId))
      .toBe(store.proofGallery);
    expect((await store.viewStore.listPlacements(store.proofGallery.galleryId, 100))
      .map((row) => row.placementId)).toEqual(["memory-proof-01", "memory-proof-02"]);
    expect(await store.deliveryStore.findPlacement(store.gallery.galleryId, "memory-proof-01"))
      .toBeUndefined();
    expect(await store.deliveryStore.findPlacement(store.proofGallery.galleryId, "memory-placement-01"))
      .toBeUndefined();
    expect(await store.proofStore.read(store.gallery.galleryId)).toBeUndefined();

    const edit = await store.proofStore.editDraft({
      galleryId: store.proofGallery.galleryId, expectedCapabilityGeneration: 1,
      expectedRevision: 0, selectedReferences: ["002"], now: NOW,
    });
    await store.proofStore.confirm({
      galleryId: store.proofGallery.galleryId, expectedCapabilityGeneration: 1,
      expectedRevision: edit.draft.revision, now: NOW,
      notification: store.proofNotification(),
    });
    expect((await store.proofStore.read(store.proofGallery.galleryId))?.latestConfirmationVersion)
      .toBe(1);
    expect(await store.proofStore.readOutbox(store.gallery.galleryId,
      `proof-confirmation:${store.proofGallery.galleryId}:1`)).toBeUndefined();
    expect((await store.viewStore.listPlacements(store.gallery.galleryId, 100)).map(
      (row) => row.placementId)).toContain("memory-placement-01");

    // Saturating one gallery's exchange window leaves the other gallery's own
    // counter untouched; unknown handles still allocate no bucket at all.
    const tight = deps({ rateConfig: { maxAttempts: 1, windowMs: 60_000 } });
    expect((await exchangePrivateGalleryCapability(tight, request())).ok).toBe(true);
    expect((await exchangePrivateGalleryCapability(tight, request())).ok).toBe(false);
    expect((await exchangePrivateGalleryCapability(tight, request({
      handle: MEMORY_PROOF_GALLERY_HANDLE,
      submittedSecret: MEMORY_PROOF_GALLERY_CAPABILITY,
    }))).ok).toBe(true);
  });

  it("pins the second published fixture link's shape and exact values", () => {
    expect(MEMORY_PROOF_GALLERY_HANDLE).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(MEMORY_PROOF_GALLERY_CAPABILITY).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(MEMORY_PROOF_GALLERY_HANDLE).toBe("IiIiIiIiIiIiIiIiIiIiIg");
    expect(MEMORY_PROOF_GALLERY_CAPABILITY).toBe(
      "Pj4-Pj4-Pj4-Pj4-Pj4-Pj4-Pj4-Pj4-Pj4-Pj4-Pj4",
    );
  });
});

describe("the fixture refuses everything a real store would", () => {
  it("refuses the right handle with a wrong capability", async () => {
    const outcome = await exchangePrivateGalleryCapability(
      deps(),
      request({ submittedSecret: "A".repeat(43) }),
    );

    expect(outcome.ok).toBe(false);
  });

  it("refuses an unknown handle", async () => {
    const outcome = await exchangePrivateGalleryCapability(
      deps(),
      request({ handle: "B".repeat(22) }),
    );

    expect(outcome.ok).toBe(false);
  });

  it("creates no rate-limit row for an unknown handle", async () => {
    // The contract `consumeExchangeAttempt` states, and the property the
    // Postgres adapter will enforce with a foreign key: an unknown handle must
    // not be able to make the store allocate anything.
    const store = getPrivateGalleryMemoryStore();
    const lookup = await store.exchangeStore.consumeExchangeAttempt(
      "C".repeat(22),
      NOW,
      { maxAttempts: 1, windowMs: 60_000 },
    );

    expect(lookup.outcome).toBe("unknown-handle");
    // The known handle still has its full allowance, so nothing was consumed
    // on its behalf.
    await expect(
      exchangePrivateGalleryCapability(deps(), request()),
    ).resolves.toMatchObject({ ok: true });
  });

  it("throttles a known handle after the configured attempts", async () => {
    const shared = deps({ rateConfig: { maxAttempts: 2, windowMs: 60_000 } });

    await exchangePrivateGalleryCapability(shared, request());
    await exchangePrivateGalleryCapability(shared, request());
    const third = await exchangePrivateGalleryCapability(shared, request());

    expect(third.ok).toBe(false);
  });
});

describe("the fixture's own safety properties", () => {
  it("mints a fresh ephemeral key per process, never a deployment key", () => {
    const first = getPrivateGalleryMemoryStore().keyring;
    resetPrivateGalleryMemoryStore();
    const second = getPrivateGalleryMemoryStore().keyring;

    expect(first.activeKeyId).toBe(second.activeKeyId);
    // Same key id, different key material: nothing here is derived from
    // `PRIVATE_GALLERY_CAPABILITY_KEYS`, so a fixture envelope can never have
    // been sealed under a deployment's real key.
    expect(first.getKey(first.activeKeyId)).not.toEqual(
      second.getKey(second.activeKeyId),
    );
  });

  it("resolves the fixture gallery by id, and nothing else", async () => {
    const store = getPrivateGalleryMemoryStore();

    await expect(
      store.viewStore.findGalleryById(store.gallery.galleryId),
    ).resolves.toBe(store.gallery);
    await expect(
      store.viewStore.findGalleryById("some-other-gallery"),
    ).resolves.toBeUndefined();
  });

  it("returns one store for the whole process", () => {
    expect(getPrivateGalleryMemoryStore()).toBe(getPrivateGalleryMemoryStore());
  });

  it("publishes a gallery a customer would actually be able to see", () => {
    const { gallery } = getPrivateGalleryMemoryStore();

    expect(gallery.state).toBe("published");
    // A published gallery carries an access window; the fixture's is generous
    // so a long-lived development checkout does not silently expire.
    expect(gallery.accessExpiresAt?.getTime() ?? 0).toBeGreaterThan(Date.now());
  });
});

describe("the in-memory access budget", () => {
  const config = {
    totalGalleryBytes: 1_000,
    multiplier: 10,
    windowMs: PRIVATE_GALLERY_ACCESS_BUDGET_WINDOW_MS,
  };

  it("persists the first-refusal marker across fixture reads and window rollover", async () => {
    const store = getPrivateGalleryMemoryStore();
    const request = {
      galleryId: store.gallery.galleryId,
      capabilityGeneration: store.gallery.capabilityGeneration,
      chargeBytes: 10_001,
      now: NOW,
      config,
    };

    const first = await store.budgetStore.consumeAccessBudget(request);
    const repeated = await getPrivateGalleryMemoryStore().budgetStore
      .consumeAccessBudget({
        ...request,
        now: new Date(NOW.getTime() + 1_000),
      });
    const newWindow = await store.budgetStore.consumeAccessBudget({
      ...request,
      now: new Date(NOW.getTime() + config.windowMs),
    });

    expect(
      [first, repeated, newWindow].map(
        (decision) => decision.firstRefusalInWindow,
      ),
    ).toEqual([true, false, true]);
    expect(repeated.next).toMatchObject({
      chargedBytes: 0,
      refusalReported: true,
      windowStartedAt: NOW,
    });
    expect(newWindow.next.windowStartedAt.getTime()).toBe(
      NOW.getTime() + config.windowMs,
    );
  });

  it("atomically reports only one of concurrent refusals per gallery generation", async () => {
    const store = getPrivateGalleryMemoryStore();
    const request = {
      galleryId: store.gallery.galleryId,
      capabilityGeneration: store.gallery.capabilityGeneration,
      chargeBytes: 10_001,
      now: NOW,
      config,
    };
    const decisions = await Promise.all(
      Array.from({ length: 8 }, () =>
        store.budgetStore.consumeAccessBudget(request),
      ),
    );

    expect(decisions.every((decision) => !decision.allowed)).toBe(true);
    expect(
      decisions.filter((decision) => decision.firstRefusalInWindow),
    ).toHaveLength(1);
    expect(decisions.every((decision) => decision.next.chargedBytes === 0)).toBe(
      true,
    );

    // The budget key includes the capability generation: a replaced link is a
    // new grant with its own allowance and first-refusal report.
    const replaced = await store.budgetStore.consumeAccessBudget({
      ...request,
      capabilityGeneration: request.capabilityGeneration + 1,
    });
    expect(replaced.firstRefusalInWindow).toBe(true);
  });
});
