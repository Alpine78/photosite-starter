import { describe, expect, it } from "vitest";

import type {
  PrivateGallery,
  PrivateGalleryPlacement,
  PrivateGallerySession,
  PrivateGalleryZipVersion,
} from "@/lib/private-gallery";
import {
  authorizePrivateGalleryMint,
  computePrivateGallerySignedUrlTtlSeconds,
  evaluatePrivateGalleryAccessBudget,
  PRIVATE_GALLERY_ACCESS_BUDGET_WINDOW_MS,
  PRIVATE_GALLERY_DEFAULT_PREVIEW_URL_TTL_SECONDS,
  PRIVATE_GALLERY_MAX_PREVIEW_URL_TTL_SECONDS,
  PRIVATE_GALLERY_MAX_ZIP_URL_TTL_SECONDS,
  PrivateGalleryDeliveryError,
} from "@/lib/private-gallery-delivery";
import { PRIVATE_GALLERY_DEFAULT_ACCESS_BUDGET_BYTE_MULTIPLIER } from "@/lib/private-gallery-limits";

const MIB = 1024 * 1024;
const NOW = new Date("2026-09-02T12:00:00.000Z");
const FAR_FUTURE = new Date("2027-03-02T12:00:00.000Z");

const GALLERY: PrivateGallery = {
  galleryId: "gallery-1",
  galleryHandle: "handle-1",
  state: "published",
  capabilityGeneration: 2,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  publishedAt: new Date("2026-09-02T00:00:00.000Z"),
  accessExpiresAt: FAR_FUTURE,
  activeZipObjectKey: "private/gallery-1/zip/v2.zip",
};

const SESSION: PrivateGallerySession = {
  sessionIdHash: "hash",
  galleryId: "gallery-1",
  capabilityGeneration: 2,
  createdAt: NOW,
  expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
};

const PLACEMENT: PrivateGalleryPlacement = {
  galleryId: "gallery-1",
  placementId: "placement-1",
  objectKey: "private/gallery-1/preview/1.webp",
  order: 1,
  derivativeKind: "delivery-preview",
  nominalBytes: 2 * MIB,
  width: 2048,
  height: 1365,
};

const ZIP: PrivateGalleryZipVersion = {
  galleryId: "gallery-1",
  objectKey: "private/gallery-1/zip/v2.zip",
  nominalBytes: 4096 * MIB,
  createdAt: NOW,
};

const TOTAL_BYTES = 8192 * MIB;

function mint(
  overrides: Partial<Parameters<typeof authorizePrivateGalleryMint>[0]> = {},
) {
  return authorizePrivateGalleryMint({
    gallery: GALLERY,
    session: SESSION,
    request: { kind: "preview", placementId: PLACEMENT.placementId },
    subject: { placement: PLACEMENT },
    budget: undefined,
    now: NOW,
    budgetConfig: { totalGalleryBytes: TOTAL_BYTES },
    ...overrides,
  });
}

describe("computePrivateGallerySignedUrlTtlSeconds", () => {
  it("uses the configured lifetime while the window is wide open", () => {
    expect(
      computePrivateGallerySignedUrlTtlSeconds({
        kind: "preview",
        now: NOW,
        accessExpiresAt: FAR_FUTURE,
      }),
    ).toBe(PRIVATE_GALLERY_DEFAULT_PREVIEW_URL_TTL_SECONDS);
  });

  it("caps at the access window's remainder", () => {
    // The load-bearing cap: without it a URL minted on the last afternoon would
    // keep working after the gallery closed, and six months would mean six
    // months plus a TTL.
    expect(
      computePrivateGallerySignedUrlTtlSeconds({
        kind: "zip",
        now: NOW,
        accessExpiresAt: new Date(NOW.getTime() + 90 * 1000),
      }),
    ).toBe(90);
  });

  it("floors rather than rounds, so it can only ever be shorter", () => {
    expect(
      computePrivateGallerySignedUrlTtlSeconds({
        kind: "preview",
        now: NOW,
        accessExpiresAt: new Date(NOW.getTime() + 1999),
      }),
    ).toBe(1);
  });

  it("returns a non-positive lifetime once the window has closed", () => {
    expect(
      computePrivateGallerySignedUrlTtlSeconds({
        kind: "preview",
        now: NOW,
        accessExpiresAt: NOW,
      }),
    ).toBe(0);
  });

  it.each([
    ["preview", PRIVATE_GALLERY_MAX_PREVIEW_URL_TTL_SECONDS],
    ["zip", PRIVATE_GALLERY_MAX_ZIP_URL_TTL_SECONDS],
  ] as const)("accepts a %s TTL at its ceiling", (kind, maximum) => {
    expect(
      computePrivateGallerySignedUrlTtlSeconds({
        kind,
        now: NOW,
        accessExpiresAt: FAR_FUTURE,
        configuredTtlSeconds: maximum,
      }),
    ).toBe(maximum);
  });

  it.each([
    ["preview", PRIVATE_GALLERY_MAX_PREVIEW_URL_TTL_SECONDS + 1],
    ["zip", PRIVATE_GALLERY_MAX_ZIP_URL_TTL_SECONDS + 1],
  ] as const)("refuses a %s TTL above its ceiling", (kind, configured) => {
    // A deployment may shorten a signed-URL lifetime and never lengthen one: a
    // longer TTL is exactly how much a leaked URL is worth.
    expect(() =>
      computePrivateGallerySignedUrlTtlSeconds({
        kind,
        now: NOW,
        accessExpiresAt: FAR_FUTURE,
        configuredTtlSeconds: configured,
      }),
    ).toThrow(PrivateGalleryDeliveryError);
  });

  it("keeps the preview ceiling in single-digit minutes", () => {
    // ADR-0014 §5 fixes the class rather than the number, so this is what makes
    // "single-digit minutes" mean something a change would have to argue with.
    expect(PRIVATE_GALLERY_MAX_PREVIEW_URL_TTL_SECONDS / 60).toBeLessThan(10);
    expect(PRIVATE_GALLERY_MAX_ZIP_URL_TTL_SECONDS).toBe(6 * 60 * 60);
  });
});

describe("evaluatePrivateGalleryAccessBudget", () => {
  const config = {
    totalGalleryBytes: 1000,
    multiplier: PRIVATE_GALLERY_DEFAULT_ACCESS_BUDGET_BYTE_MULTIPLIER,
    windowMs: PRIVATE_GALLERY_ACCESS_BUDGET_WINDOW_MS,
  };

  it("charges the object's full nominal size", () => {
    const decision = evaluatePrivateGalleryAccessBudget(
      undefined,
      250,
      NOW,
      config,
    );

    expect(decision.allowed).toBe(true);
    expect(decision.next.chargedBytes).toBe(250);
  });

  it("accumulates across mints and refuses at the ceiling", () => {
    // Ten times the gallery's own size, so a normal customer reading their
    // gallery several times never notices and a scraper does.
    let counter = evaluatePrivateGalleryAccessBudget(
      undefined,
      9_000,
      NOW,
      config,
    ).next;
    const within = evaluatePrivateGalleryAccessBudget(counter, 1_000, NOW, config);
    expect(within.allowed).toBe(true);

    counter = within.next;
    const over = evaluatePrivateGalleryAccessBudget(counter, 1, NOW, config);
    expect(over).toMatchObject({ allowed: false, firstRefusalInWindow: true });
  });

  it("does not charge a refused mint", () => {
    // The bytes were never authorized, and charging them would let a refused
    // request push the counter — and so the window — further out.
    const counter = { windowStartedAt: NOW, chargedBytes: 10_000 };

    const decision = evaluatePrivateGalleryAccessBudget(
      counter,
      500,
      NOW,
      config,
    );

    expect(decision.allowed).toBe(false);
    expect(decision.next.chargedBytes).toBe(10_000);
  });

  it("reports the first refusal once, then not again", () => {
    const spent = { windowStartedAt: NOW, chargedBytes: 10_001 };

    expect(
      evaluatePrivateGalleryAccessBudget(spent, 1, NOW, config)
        .firstRefusalInWindow,
    ).toBe(false);
  });

  it("starts a new window once the old one lapsed", () => {
    const stale = {
      windowStartedAt: new Date(NOW.getTime() - config.windowMs),
      chargedBytes: 10_000,
    };

    const decision = evaluatePrivateGalleryAccessBudget(stale, 400, NOW, config);

    expect(decision.allowed).toBe(true);
    expect(decision.next.chargedBytes).toBe(400);
    expect(decision.next.windowStartedAt.getTime()).toBe(NOW.getTime());
  });

  it("throws on a corrupt counter rather than failing open", () => {
    // The one direction a budget must never fail: a damaged row that silently
    // reset would hand out a fresh allowance on every scrape.
    expect(() =>
      evaluatePrivateGalleryAccessBudget(
        { windowStartedAt: new Date(NaN), chargedBytes: 1 },
        1,
        NOW,
        config,
      ),
    ).toThrow(PrivateGalleryDeliveryError);
    expect(() =>
      evaluatePrivateGalleryAccessBudget(
        { windowStartedAt: NOW, chargedBytes: -1 },
        1,
        NOW,
        config,
      ),
    ).toThrow(PrivateGalleryDeliveryError);
  });
});

describe("authorizePrivateGalleryMint", () => {
  it("authorizes a preview against the placement's own key", () => {
    const authorization = mint();

    expect(authorization).toMatchObject({
      kind: "preview",
      objectKey: PLACEMENT.objectKey,
      ttlSeconds: PRIVATE_GALLERY_DEFAULT_PREVIEW_URL_TTL_SECONDS,
      chargedBytes: PLACEMENT.nominalBytes,
    });
    expect(authorization.expiresAt.getTime()).toBe(
      NOW.getTime() + PRIVATE_GALLERY_DEFAULT_PREVIEW_URL_TTL_SECONDS * 1000,
    );
  });

  it("authorizes the ZIP against the gallery's active pointer", () => {
    const authorization = mint({
      request: { kind: "zip" },
      subject: { zipVersion: ZIP },
    });

    expect(authorization).toMatchObject({
      kind: "zip",
      objectKey: GALLERY.activeZipObjectKey,
      ttlSeconds: PRIVATE_GALLERY_MAX_ZIP_URL_TTL_SECONDS,
      chargedBytes: ZIP.nominalBytes,
    });
  });

  it("refuses a ZIP version that is not the one the pointer names", () => {
    // §8c makes the pointer the only answer to "which version is current", so a
    // superseded row handed in here is refused rather than signed.
    expect(() =>
      mint({
        request: { kind: "zip" },
        subject: {
          zipVersion: { ...ZIP, objectKey: "private/gallery-1/zip/v1.zip" },
        },
      }),
    ).toThrow(PrivateGalleryDeliveryError);
  });

  it("refuses a ZIP when the gallery has none", () => {
    const withoutZip: PrivateGallery = { ...GALLERY };
    delete (withoutZip as { activeZipObjectKey?: string }).activeZipObjectKey;

    expect(() =>
      mint({
        gallery: withoutZip,
        request: { kind: "zip" },
        subject: { zipVersion: ZIP },
      }),
    ).toThrow(PrivateGalleryDeliveryError);
  });

  it("refuses a placement belonging to another gallery", () => {
    // The IDOR guard. A resolver bug that returned a neighbouring gallery's row
    // is refused here rather than turned into a signed URL for it.
    expect(() =>
      mint({ subject: { placement: { ...PLACEMENT, galleryId: "gallery-2" } } }),
    ).toThrow(PrivateGalleryDeliveryError);
  });

  it("refuses a resolved placement that is not the one requested", () => {
    expect(() =>
      mint({
        request: { kind: "preview", placementId: "placement-9" },
        subject: { placement: PLACEMENT },
      }),
    ).toThrow(PrivateGalleryDeliveryError);
  });

  it("refuses an identifier that resolved to nothing", () => {
    expect(() => mint({ subject: {} })).toThrow(PrivateGalleryDeliveryError);
  });

  it.each(["access-suspended", "expiring", "ready", "deleted"] as const)(
    "refuses a gallery in %s",
    (state) => {
      // Re-checked rather than inherited from Stage 1: a gallery can leave
      // `published` between a page render and a click on the download control.
      expect(() => mint({ gallery: { ...GALLERY, state } })).toThrow(
        PrivateGalleryDeliveryError,
      );
    },
  );

  it("refuses a session whose generation was superseded", () => {
    expect(() =>
      mint({ session: { ...SESSION, capabilityGeneration: 1 } }),
    ).toThrow(PrivateGalleryDeliveryError);
  });

  it("refuses a session belonging to another gallery", () => {
    expect(() => mint({ session: { ...SESSION, galleryId: "gallery-2" } })).toThrow(
      PrivateGalleryDeliveryError,
    );
  });

  it("refuses once the access window has closed", () => {
    expect(() => mint({ now: FAR_FUTURE })).toThrow(PrivateGalleryDeliveryError);
  });

  it("refuses when the remaining window leaves no usable lifetime", () => {
    expect(() =>
      mint({ now: new Date(FAR_FUTURE.getTime() - 500) }),
    ).toThrow(PrivateGalleryDeliveryError);
  });

  it("refuses when the budget is exhausted, and charges nothing", () => {
    expect(() =>
      mint({
        budget: {
          windowStartedAt: NOW,
          chargedBytes:
            TOTAL_BYTES * PRIVATE_GALLERY_DEFAULT_ACCESS_BUDGET_BYTE_MULTIPLIER,
        },
      }),
    ).toThrow(PrivateGalleryDeliveryError);
  });

  it("checks everything free before it spends the budget", () => {
    // A request that was never going to be authorized must not consume a
    // gallery's allowance — the same ordering the exchange endpoint uses for
    // its header guard and its throttle.
    const spentBudget = {
      windowStartedAt: NOW,
      chargedBytes:
        TOTAL_BYTES * PRIVATE_GALLERY_DEFAULT_ACCESS_BUDGET_BYTE_MULTIPLIER,
    };
    let thrown: unknown;
    try {
      mint({
        gallery: { ...GALLERY, state: "access-suspended" },
        budget: spentBudget,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PrivateGalleryDeliveryError);
    expect((thrown as PrivateGalleryDeliveryError).reason).toBe(
      "gallery-unavailable",
    );
  });

  it("carries no object key or identifier in a refusal", () => {
    let message = "";
    try {
      mint({ subject: { placement: { ...PLACEMENT, galleryId: "gallery-2" } } });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).not.toContain(PLACEMENT.objectKey);
    expect(message).not.toContain(PLACEMENT.placementId);
    expect(message).not.toContain(SESSION.sessionIdHash);
  });

  it("returns the budget the caller must persist", () => {
    const authorization = mint({
      budget: { windowStartedAt: NOW, chargedBytes: 1000 },
    });

    expect(authorization.nextBudget.chargedBytes).toBe(
      1000 + PLACEMENT.nominalBytes,
    );
  });
});
