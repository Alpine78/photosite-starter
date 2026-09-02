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
  PrivateGallerySession,
} from "@/lib/private-gallery";
import {
  sealCapability,
  type PrivateGalleryCapabilityMaterial,
} from "@/lib/private-gallery-capability";
import type { PrivateGalleryCapabilityKeyring } from "@/lib/private-gallery-config";
import { computePrivateGalleryAccessExpiry } from "@/lib/private-gallery-retention";
import {
  evaluatePrivateGalleryExchangeRate,
  type PrivateGalleryExchangeLookup,
  type PrivateGalleryExchangeRateConfig,
  type PrivateGalleryExchangeRateCounter,
  type PrivateGalleryExchangeStore,
} from "@/lib/private-gallery-exchange";
import type { PrivateGallerySessionStore } from "@/lib/private-gallery-session";
import type { PrivateGalleryViewStore } from "@/lib/private-gallery-access";

/**
 * The fixture gallery's link, in full:
 * `/<PRIVATE_GALLERY_ROUTE_PREFIX>/<handle>#<capability>`.
 *
 * Both halves are fixed constants, not secrets — see this module's own note.
 */
export const MEMORY_GALLERY_HANDLE = Buffer.alloc(16, 0x11).toString("base64url");
export const MEMORY_GALLERY_CAPABILITY =
  Buffer.alloc(32, 0x2d).toString("base64url");

const MEMORY_GALLERY_ID = "memory-fixture-gallery";

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
  readonly keyring: PrivateGalleryCapabilityKeyring;
  /** The fixture gallery, for a route that wants to render its authorized state. */
  readonly gallery: PrivateGallery;
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

function build(now: Date): PrivateGalleryMemoryStore {
  const keyring = ephemeralKeyring();
  const gallery: PrivateGallery = {
    galleryId: MEMORY_GALLERY_ID,
    galleryHandle: MEMORY_GALLERY_HANDLE,
    state: "published",
    capabilityGeneration: MEMORY_GALLERY_GENERATION,
    createdAt: now,
    publishedAt: now,
    // The real six-calendar-month rule, not a fixture approximation, so a
    // development gallery expires exactly when a published one would.
    accessExpiresAt: computePrivateGalleryAccessExpiry(now),
  };

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
      if (handle !== gallery.galleryHandle) return { outcome: "unknown-handle" };

      const decision = evaluatePrivateGalleryExchangeRate(
        counters.get(gallery.galleryId),
        attemptedAt,
        config,
      );
      counters.set(gallery.galleryId, decision.next);
      if (!decision.allowed) {
        return {
          outcome: "rate-limited",
          firstRefusalInWindow: decision.firstRefusalInWindow,
        };
      }
      return { outcome: "ok", gallery, capability };
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

  // Point reads by id, matching the seam's contract. They answer only for the
  // one fixture gallery — a handle a visitor invented resolves to nothing here
  // just as it would resolve to no row in Postgres.
  const viewStore: PrivateGalleryViewStore = {
    async findGalleryById(galleryId) {
      return galleryId === gallery.galleryId ? gallery : undefined;
    },
    async listPlacements(galleryId, limit) {
      if (galleryId !== gallery.galleryId) return [];
      // Ordered by the photographer's authored `order`, and bounded by the
      // caller's limit — the two properties a Postgres adapter has to reproduce.
      return [...placements]
        .sort((a, b) => a.order - b.order)
        .slice(0, limit);
    },
  };

  return { exchangeStore, sessionStore, viewStore, keyring, gallery };
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
