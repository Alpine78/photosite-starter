/**
 * A development-only private-gallery store held in process memory
 * (`PRIVATE_GALLERY_STORE=memory`).
 *
 * It exists so the capability exchange can actually be *run* — locally and in
 * the Playwright harness — before the Postgres and object-store adapters land.
 * It is the same shape of safeguard `SITE_CONTENT_SOURCE=mock` and
 * `CONTACT_DELIVERY_ADAPTER=sink` already carry, and it is **refused outright in
 * a production deployment** by `readPrivateGalleryDeployment` for the same
 * reason: a gallery whose capability is a published constant is not something a
 * real photographer's site may ever serve.
 *
 * Three properties make that safe rather than merely discouraged:
 *
 * - The **keyring is ephemeral** — 32 random bytes minted at first use and never
 *   written anywhere. Nothing here reads `PRIVATE_GALLERY_CAPABILITY_KEYS`, so a
 *   fixture can never be sealed under a deployment's real key, and a restart
 *   simply re-seals the same fixture under a fresh key.
 * - The fixture's handle and capability are **deliberately constant and
 *   published below**, so a developer can open the link without a seeding step.
 *   They are not secrets and are not treated as any.
 * - Everything lives in one process. Two instances share nothing, so this is
 *   useless as anything but a single-machine development aid.
 *
 * **One process is not one module instance.** Next.js compiles each route into
 * its own server bundle, so a module imported by both the exchange Route
 * Handler and the gallery Page is *instantiated twice* even under a single
 * `next start` — measured with a construction probe against a production build,
 * which logged two builds under one pid. A plain module-level `let` therefore
 * gave the exchange and the page two different fixtures, and a session minted by
 * one was invisible to the other. The singleton is pinned to `globalThis`, the
 * same pattern Next.js documents for a development-only database client, so
 * every bundle in the process shares one store. This is a fixture concern only:
 * the Postgres adapter keeps its state in Postgres and has no such problem.
 */

import "server-only";

import { randomBytes } from "node:crypto";

import type {
  PrivateGallery,
  PrivateGalleryCapability,
  PrivateGalleryPlacement,
  PrivateGalleryProofPlacement,
  PrivateGallerySession,
} from "@/lib/private-gallery";
import {
  sealCapability,
  type PrivateGalleryCapabilityMaterial,
} from "@/lib/private-gallery-capability";
import type { PrivateGalleryCapabilityKeyring } from "@/lib/private-gallery-config";
import { getBuiltInLabels } from "@/lib/deployment-config";
import { createPrivateGalleryProofMemoryStore } from "@/lib/private-gallery-proof-memory-store";
import type { PrivateGalleryProofNotificationContext, PrivateGalleryProofStore } from "@/lib/private-gallery-proof-store";
import {
  computePrivateGalleryAccessExpiry,
  PRIVATE_GALLERY_MAX_PREPARATION_DAYS,
} from "@/lib/private-gallery-retention";
import {
  planPrivateGalleryFirstProofReady,
  planPrivateGalleryFirstProofPublication,
} from "@/lib/private-gallery-readiness";
import {
  evaluatePrivateGalleryExchangeRate,
  type PrivateGalleryExchangeLookup,
  type PrivateGalleryExchangeRateConfig,
  type PrivateGalleryExchangeRateCounter,
  type PrivateGalleryExchangeStore,
} from "@/lib/private-gallery-exchange";
import type { PrivateGallerySessionStore } from "@/lib/private-gallery-session";
import type { PrivateGalleryAdminSession } from "@/lib/private-gallery";
import {
  encodePrivateGalleryAdminCredential,
  PRIVATE_GALLERY_ADMIN_SALT_BYTES,
} from "@/lib/private-gallery-admin-credential";
import {
  evaluatePrivateGalleryAdminLoginRate,
  type PrivateGalleryAdminLoginRateCounter,
  type PrivateGalleryAdminLoginStore,
} from "@/lib/private-gallery-admin-login";
import type { PrivateGalleryAdminSessionStore } from "@/lib/private-gallery-admin-session";
import type {
  PrivateGalleryDeliveryStore,
  PrivateGalleryViewStore,
} from "@/lib/private-gallery-access";
import {
  evaluatePrivateGalleryAccessBudget,
  evaluatePrivateGalleryMintRate,
  type PrivateGalleryAccessBudgetCounter,
  type PrivateGalleryMintRateCounter,
} from "@/lib/private-gallery-delivery";

/**
 * The fixture gallery's link, in full:
 * `/<PRIVATE_GALLERY_ROUTE_PREFIX>/<handle>#<capability>`.
 *
 * Both halves are fixed constants, not secrets — see this module's own note.
 */
export const MEMORY_GALLERY_HANDLE = Buffer.alloc(16, 0x11).toString("base64url");
export const MEMORY_GALLERY_CAPABILITY =
  Buffer.alloc(32, 0x2d).toString("base64url");

/** A second, equally public development-only link for the proof workflow. */
export const MEMORY_PROOF_GALLERY_HANDLE = Buffer.alloc(16, 0x22).toString("base64url");
export const MEMORY_PROOF_GALLERY_CAPABILITY =
  Buffer.alloc(32, 0x3e).toString("base64url");

const MEMORY_GALLERY_ID = "memory-fixture-gallery";
const MEMORY_PROOF_GALLERY_ID = "memory-fixture-proof-gallery";

/**
 * The administrator secret this fixture accepts. Published, constant, and **not
 * a secret** — the same status as {@link MEMORY_GALLERY_CAPABILITY} above, and
 * safe for the same already-reviewed reason: `PRIVATE_GALLERY_STORE=memory` is
 * refused outside a `development` deployment at build time.
 *
 * It is spelled out rather than generated so a developer can sign in without a
 * provisioning step, and so the Playwright journey has something to type. Its
 * hash is computed at first use rather than hardcoded, which keeps the two from
 * ever drifting apart.
 */
export const MEMORY_ADMIN_SECRET =
  "development-fixture-administrator-secret-not-for-any-real-deployment";

/**
 * The fixture's photographs, as placements.
 *
 * Deliberately mixed shapes — landscape, portrait, square, and one panorama —
 * because the one thing this fixture exists to exercise before any byte can be
 * delivered is that a frame is reserved at its **own** ratio. A set of
 * uniformly-shaped items would make a cropping grid look correct.
 *
 * The dimensions sit inside §8e's 2 048 px ceiling, and the byte sizes are
 * plausible web derivatives, so the projection's read-time bounds are exercised
 * by real-looking values rather than round numbers that happen to pass.
 */
const MEMORY_PLACEMENTS: readonly Omit<PrivateGalleryPlacement, "galleryId">[] = [
  {
    placementId: "memory-placement-01",
    objectKey: "memory/preview/01.webp",
    order: 1,
    derivativeKind: "delivery-preview",
    nominalBytes: 1_482_000,
    width: 2048,
    height: 1365,
    alt: "Landscape frame",
  },
  {
    placementId: "memory-placement-02",
    objectKey: "memory/preview/02.webp",
    order: 2,
    derivativeKind: "delivery-preview",
    nominalBytes: 1_268_400,
    width: 1365,
    height: 2048,
    alt: "Portrait frame",
  },
  {
    placementId: "memory-placement-03",
    objectKey: "memory/preview/03.webp",
    order: 3,
    derivativeKind: "delivery-preview",
    nominalBytes: 1_104_900,
    width: 1600,
    height: 1600,
    alt: "Square frame",
  },
  {
    placementId: "memory-placement-04",
    objectKey: "memory/preview/04.webp",
    order: 4,
    derivativeKind: "delivery-preview",
    nominalBytes: 1_930_200,
    width: 2048,
    height: 768,
    alt: "Panorama frame",
  },
  {
    placementId: "memory-placement-05",
    objectKey: "memory/preview/05.webp",
    order: 5,
    derivativeKind: "watermarked-proof",
    nominalBytes: 872_300,
    width: 1800,
    height: 1200,
  },
];
const MEMORY_GALLERY_GENERATION = 1;

export type PrivateGalleryMemoryStore = {
  readonly exchangeStore: PrivateGalleryExchangeStore;
  readonly sessionStore: PrivateGallerySessionStore;
  readonly viewStore: PrivateGalleryViewStore;
  /** Stage 2 reads and budget state; the fixture has no object-store bytes. */
  readonly deliveryStore: PrivateGalleryDeliveryStore;
  /** Kept for focused budget tests. */
  readonly budgetStore: Pick<PrivateGalleryDeliveryStore, "consumeAccessBudget">;
  readonly keyring: PrivateGalleryCapabilityKeyring;
  /** The fixture gallery, for a route that wants to render its authorized state. */
  readonly gallery: PrivateGallery;
  /** Separate development proof gallery and its server-only selection state. */
  readonly proofGallery: PrivateGallery;
  readonly proofStore: PrivateGalleryProofStore;
  readonly proofNotification: () => PrivateGalleryProofNotificationContext;
  readonly adminSessionStore: PrivateGalleryAdminSessionStore;
  readonly adminLoginStore: PrivateGalleryAdminLoginStore;
  /**
   * The encoded credential the fixture accepts, computed from
   * {@link MEMORY_ADMIN_SECRET} at first use.
   *
   * The fixture **never reads `PRIVATE_GALLERY_ADMIN_SECRET_HASH`**, exactly as
   * it never reads the deployment's capability keyring: a development store must
   * not be able to authenticate against a real deployment's credential, and a
   * developer must not have to provision one to open the administrator page.
   */
  readonly adminCredentialHash: string;
};

function ephemeralKeyring(): PrivateGalleryCapabilityKeyring {
  const keyId = "memory";
  const key = randomBytes(32);
  return {
    activeKeyId: keyId,
    keyIds: Object.freeze([keyId]),
    getKey: (id) => (id === keyId ? Uint8Array.from(key) : undefined),
  };
}

function buildAdminStores(): {
  readonly adminSessionStore: PrivateGalleryAdminSessionStore;
  readonly adminLoginStore: PrivateGalleryAdminLoginStore;
} {
  const sessions: PrivateGalleryAdminSession[] = [];
  let counter: PrivateGalleryAdminLoginRateCounter | undefined;

  return {
    adminSessionStore: {
      async create(session, activeSessionCap) {
        sessions.push(session);
        // The same evict-oldest invariant the contract states, in memory. A
        // real adapter does this in one transaction; here there is one process
        // and no concurrency to lose to.
        const group = sessions
          .filter(
            (row) => row.credentialGeneration === session.credentialGeneration,
          )
          .sort(
            (a, b) =>
              a.createdAt.getTime() - b.createdAt.getTime() ||
              (a.sessionIdHash < b.sessionIdHash ? -1 : 1),
          );
        for (const evicted of group.slice(
          0,
          Math.max(0, group.length - activeSessionCap),
        )) {
          sessions.splice(sessions.indexOf(evicted), 1);
        }
      },
      async findByHash(sessionIdHash) {
        return sessions.find((row) => row.sessionIdHash === sessionIdHash);
      },
      async deleteByHash(sessionIdHash) {
        const index = sessions.findIndex(
          (row) => row.sessionIdHash === sessionIdHash,
        );
        if (index >= 0) sessions.splice(index, 1);
      },
    },
    adminLoginStore: {
      async consumeLoginAttempt(now, config) {
        const decision = evaluatePrivateGalleryAdminLoginRate(
          counter,
          now,
          config,
        );
        counter = decision.next;
        return decision;
      },
    },
  };
}

function build(now: Date): PrivateGalleryMemoryStore {
  const keyring = ephemeralKeyring();
  const gallery: PrivateGallery = {
    galleryId: MEMORY_GALLERY_ID,
    galleryHandle: MEMORY_GALLERY_HANDLE,
    kind: "delivery",
    state: "published",
    capabilityGeneration: MEMORY_GALLERY_GENERATION,
    createdAt: now,
    publishedAt: now,
    // The real six-calendar-month rule, not a fixture approximation, so a
    // development gallery expires exactly when a published one would.
    accessExpiresAt: computePrivateGalleryAccessExpiry(now),
  };

  const proofPreparingGallery: PrivateGallery = {
    galleryId: MEMORY_PROOF_GALLERY_ID,
    galleryHandle: MEMORY_PROOF_GALLERY_HANDLE,
    kind: "proof",
    state: "preparing",
    capabilityGeneration: MEMORY_GALLERY_GENERATION,
    createdAt: now,
  };
  const proofCandidates: readonly PrivateGalleryProofPlacement[] = [
    {
      galleryId: proofPreparingGallery.galleryId, placementId: "memory-proof-01",
      mediaId: "memory-proof-media-01", filename: "IMG_0001.JPG",
      objectKey: "memory/proof/01.webp", derivativeKind: "watermarked-proof",
      order: 1, nominalBytes: 872_300, width: 1800, height: 1200,
      alt: "Watermarked landscape proof",
    },
    {
      galleryId: proofPreparingGallery.galleryId, placementId: "memory-proof-02",
      mediaId: "memory-proof-media-02", filename: "IMG_0002.JPG",
      objectKey: "memory/proof/02.webp", derivativeKind: "watermarked-proof",
      order: 2, nominalBytes: 1_024_000, width: 1200, height: 1800,
      alt: "Watermarked portrait proof",
    },
  ];
  const verifiedProofObjects = proofCandidates.map((item) => ({
    objectKey: item.objectKey,
    objectKind: "proof" as const,
    sizeBytes: item.nominalBytes,
  }));
  const proofPricing = {
    includedCount: 1, extraUnitPriceMinor: 1250, currency: "EUR",
  };
  const readyProof = planPrivateGalleryFirstProofReady({
    gallery: proofPreparingGallery,
    placements: proofCandidates,
    pricing: proofPricing,
    verifiedObjects: verifiedProofObjects,
  });
  if (!readyProof.ready) throw new Error("Invalid development proof fixture readiness");
  const readyProofGallery: PrivateGallery = {
    ...proofPreparingGallery,
    state: readyProof.nextState,
  };
  const publishedProof = planPrivateGalleryFirstProofPublication({
    gallery: readyProofGallery,
    proof: {
      pricingSnapshot: readyProof.pricingSnapshot,
      placements: readyProof.placements,
    },
    verifiedObjects: verifiedProofObjects,
    preparation: {
      galleryId: readyProofGallery.galleryId,
      openedAt: now,
      deadline: new Date(
        now.getTime() + PRIVATE_GALLERY_MAX_PREPARATION_DAYS * 24 * 60 * 60 * 1000,
      ),
    },
    now,
  });
  if (!publishedProof.publishable) throw new Error("Invalid development proof fixture publication");
  const proofGallery: PrivateGallery = {
    ...readyProofGallery,
    state: publishedProof.nextState,
    publishedAt: publishedProof.publishedAt,
    accessExpiresAt: publishedProof.accessExpiresAt,
  };
  const proofPlacements = readyProof.placements;

  const material: PrivateGalleryCapabilityMaterial = sealCapability(
    keyring,
    {
      galleryId: gallery.galleryId,
      handle: gallery.galleryHandle,
      generation: gallery.capabilityGeneration,
    },
    MEMORY_GALLERY_CAPABILITY,
  );
  const capability: PrivateGalleryCapability = {
    galleryId: gallery.galleryId,
    capabilityGeneration: gallery.capabilityGeneration,
    keyId: material.keyId,
    envelope: material.envelope,
    createdAt: now,
  };

  const proofMaterial = sealCapability(
    keyring,
    {
      galleryId: proofGallery.galleryId,
      handle: proofGallery.galleryHandle,
      generation: proofGallery.capabilityGeneration,
    },
    MEMORY_PROOF_GALLERY_CAPABILITY,
  );
  const proofCapability: PrivateGalleryCapability = {
    galleryId: proofGallery.galleryId,
    capabilityGeneration: proofGallery.capabilityGeneration,
    keyId: proofMaterial.keyId,
    envelope: proofMaterial.envelope,
    createdAt: now,
  };
  const byHandle = new Map([
    [gallery.galleryHandle, { gallery, capability }],
    [proofGallery.galleryHandle, { gallery: proofGallery, capability: proofCapability }],
  ]);
  const byId = new Map([
    [gallery.galleryId, gallery],
    [proofGallery.galleryId, proofGallery],
  ]);

  // Keyed by galleryId, never by a caller-supplied handle: an unknown handle
  // must not be able to create a row (the contract `consumeExchangeAttempt`
  // states, and the property the Postgres adapter enforces with a foreign key).
  const counters = new Map<string, PrivateGalleryExchangeRateCounter>();
  const sessions: PrivateGallerySession[] = [];

  const exchangeStore: PrivateGalleryExchangeStore = {
    async consumeExchangeAttempt(
      handle: string,
      attemptedAt: Date,
      config: PrivateGalleryExchangeRateConfig,
    ): Promise<PrivateGalleryExchangeLookup> {
      const resolved = byHandle.get(handle);
      if (resolved === undefined) return { outcome: "unknown-handle" };

      const decision = evaluatePrivateGalleryExchangeRate(
        counters.get(resolved.gallery.galleryId),
        attemptedAt,
        config,
      );
      counters.set(resolved.gallery.galleryId, decision.next);
      if (!decision.allowed) {
        return {
          outcome: "rate-limited",
          firstRefusalInWindow: decision.firstRefusalInWindow,
        };
      }
      return { outcome: "ok", ...resolved };
    },
  };

  const groupKey = (session: PrivateGallerySession) =>
    `${session.galleryId} ${session.capabilityGeneration}`;

  const sessionStore: PrivateGallerySessionStore = {
    async create(session, activeSessionCap) {
      sessions.push(session);
      const group = sessions
        .filter((row) => groupKey(row) === groupKey(session))
        .sort(
          (a, b) =>
            a.createdAt.getTime() - b.createdAt.getTime() ||
            (a.sessionIdHash < b.sessionIdHash ? -1 : 1),
        );
      for (const evicted of group.slice(
        0,
        Math.max(0, group.length - activeSessionCap),
      )) {
        sessions.splice(sessions.indexOf(evicted), 1);
      }
    },
    async findByHash(sessionIdHash) {
      return sessions.find((row) => row.sessionIdHash === sessionIdHash);
    },
    async deleteByHash(sessionIdHash) {
      const index = sessions.findIndex(
        (row) => row.sessionIdHash === sessionIdHash,
      );
      if (index >= 0) sessions.splice(index, 1);
    },
  };

  const placements: readonly PrivateGalleryPlacement[] = MEMORY_PLACEMENTS.map(
    (placement) => ({ ...placement, galleryId: gallery.galleryId }),
  );

  const proofStore = createPrivateGalleryProofMemoryStore({
    gallery: proofGallery,
    pricingSnapshot: readyProof.pricingSnapshot,
    placements: proofPlacements,
  });
  const proofNotification = (): PrivateGalleryProofNotificationContext => ({
    recipient: "owner@example.test",
    galleryReference: "fixture-job",
    customerReference: "fixture-customer",
    locale: "en-GB",
    labels: getBuiltInLabels("en-GB").proofConfirmationEmail,
  });
  const placementsByGalleryId = new Map<string, readonly PrivateGalleryPlacement[]>([
    [gallery.galleryId, placements],
    [proofGallery.galleryId, proofPlacements],
  ]);

  // Point reads by id, matching the seam's contract. They answer only for the
  // two fixture galleries — a handle a visitor invented resolves to nothing here
  // just as it would resolve to no row in Postgres.
  const viewStore: PrivateGalleryViewStore = {
    async findGalleryById(galleryId) {
      return byId.get(galleryId);
    },
    async listPlacements(galleryId, limit) {
      const rows = placementsByGalleryId.get(galleryId);
      if (rows === undefined) return [];
      // Ordered by the photographer's authored `order`, and bounded by the
      // caller's limit — the two properties a Postgres adapter has to reproduce.
      return [...rows]
        .sort((a, b) => a.order - b.order)
        .slice(0, limit);
    },
  };

  const accessBudgets = new Map<string, PrivateGalleryAccessBudgetCounter>();
  const budgetStore: Pick<PrivateGalleryDeliveryStore, "consumeAccessBudget"> = {
    async consumeAccessBudget({
      galleryId,
      capabilityGeneration,
      chargeBytes,
      now: attemptedAt,
      config,
    }) {
      // No await between read, evaluation, and write: calls in this one-process
      // fixture cannot both observe the pre-refusal state. A durable adapter
      // must perform the same transition in one database transaction.
      const key = JSON.stringify([galleryId, capabilityGeneration]);
      const decision = evaluatePrivateGalleryAccessBudget(
        accessBudgets.get(key),
        chargeBytes,
        attemptedAt,
        config,
      );
      accessBudgets.set(key, decision.next);
      return decision;
    },
  };

  const mintRates = new Map<string, PrivateGalleryMintRateCounter>();
  const deliveryStore: PrivateGalleryDeliveryStore = {
    async findPlacement(galleryId, placementId) {
      return placementsByGalleryId.get(galleryId)?.find(
        (row) => row.placementId === placementId,
      );
    },
    async findZipVersion() {
      // The fixture has no delivered ZIP. A ZIP request must fail closed.
      return undefined;
    },
    async consumeMintRate({ sessionIdHash, now: attemptedAt }) {
      // One process with no await between evaluation and write. A real store
      // must make this transition atomic across runtime instances.
      const decision = evaluatePrivateGalleryMintRate(
        mintRates.get(sessionIdHash),
        attemptedAt,
      );
      mintRates.set(sessionIdHash, decision.next);
      return {
        allowed: decision.allowed,
        firstRefusalInWindow: decision.firstRefusalInWindow,
      };
    },
    consumeAccessBudget: budgetStore.consumeAccessBudget,
    async totalGalleryBytes(galleryId) {
      const rows = placementsByGalleryId.get(galleryId) ?? [];
      return rows.reduce((total, row) => total + row.nominalBytes, 0);
    },
  };

  return {
    exchangeStore,
    sessionStore,
    viewStore,
    deliveryStore,
    budgetStore,
    keyring,
    gallery,
    proofGallery,
    proofStore,
    proofNotification,
    ...buildAdminStores(),
    adminCredentialHash: encodePrivateGalleryAdminCredential({
      secret: MEMORY_ADMIN_SECRET,
      salt: randomBytes(PRIVATE_GALLERY_ADMIN_SALT_BYTES),
    }),
  };
}

/**
 * Keyed on the global registry rather than a module-local binding, so the
 * exchange route's bundle and the page's bundle resolve to the same fixture —
 * see this module's own note on why one process is not one module instance.
 */
const MEMORY_STORE_KEY = Symbol.for(
  "photosite-starter.private-gallery.memory-store",
);

type GlobalWithMemoryStore = typeof globalThis & {
  [MEMORY_STORE_KEY]?: PrivateGalleryMemoryStore;
};

/**
 * The process-wide fixture store. Built on first use so the ephemeral keyring
 * and the sealed fixture capability are minted once per process.
 */
export function getPrivateGalleryMemoryStore(): PrivateGalleryMemoryStore {
  const scope = globalThis as GlobalWithMemoryStore;
  scope[MEMORY_STORE_KEY] ??= build(new Date());
  return scope[MEMORY_STORE_KEY];
}

/** Test-only: drop the singleton so a case can start from a clean fixture. */
export function resetPrivateGalleryMemoryStore(): void {
  delete (globalThis as GlobalWithMemoryStore)[MEMORY_STORE_KEY];
}
