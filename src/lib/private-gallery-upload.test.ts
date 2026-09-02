import { describe, expect, it } from "vitest";

import { PRIVATE_GALLERY_STATES } from "@/lib/private-gallery";
import { isPrivateGalleryObjectKeyInPrefix } from "@/lib/private-gallery-object-key";
import { PRIVATE_GALLERY_MAX_PREPARATION_DAYS } from "@/lib/private-gallery-retention";
import {
  assertPrivateGalleryPreparationPublishable,
  isPrivateGalleryPreparationExpired,
  openPrivateGalleryUploadPreparation,
  PRIVATE_GALLERY_UPLOAD_LIMITS,
  PrivateGalleryUploadError,
  type PrivateGalleryManifestEntry,
} from "@/lib/private-gallery-upload";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-02T12:00:00.000Z");
const PREFIX = "private-galleries";

const derivative = (
  overrides: Partial<Extract<PrivateGalleryManifestEntry, { kind: "derivative" }>> = {},
): PrivateGalleryManifestEntry => ({
  kind: "derivative",
  derivativeKind: "delivery-preview",
  nominalBytes: 1_500_000,
  width: 2048,
  height: 1365,
  ...overrides,
});

const zip = (nominalBytes = 4_000_000_000): PrivateGalleryManifestEntry => ({
  kind: "zip",
  nominalBytes,
});

function open(
  overrides: Partial<Parameters<typeof openPrivateGalleryUploadPreparation>[0]> = {},
) {
  return openPrivateGalleryUploadPreparation({
    galleryId: "gallery-1",
    state: "draft",
    keyPrefix: PREFIX,
    preparationId: "prep-1",
    manifest: [derivative(), derivative(), zip()],
    now: NOW,
    ...overrides,
  });
}

describe("openPrivateGalleryUploadPreparation", () => {
  it("assigns one key per manifest entry, all inside the configured prefix", () => {
    const plan = open();

    expect(plan.objects).toHaveLength(3);
    expect(plan.preparation.objectKeys).toEqual(
      plan.objects.map((object) => object.objectKey),
    );
    for (const key of plan.preparation.objectKeys) {
      expect(isPrivateGalleryObjectKeyInPrefix(key, PREFIX)).toBe(true);
    }
  });

  it("gives every object its own key", () => {
    // Two derivatives of identical declared size must not collide: an immutable
    // key per object is what lets a regeneration add rather than overwrite.
    const plan = open({ manifest: [derivative(), derivative(), derivative()] });

    expect(new Set(plan.preparation.objectKeys).size).toBe(3);
  });

  it("names the object kind from the derivative kind", () => {
    const plan = open({
      manifest: [
        derivative({ derivativeKind: "delivery-preview" }),
        derivative({ derivativeKind: "watermarked-proof" }),
        zip(),
      ],
    });

    expect(plan.objects.map((object) => object.objectKind)).toEqual([
      "preview",
      "proof",
      "zip",
    ]);
  });

  it("carries the declared geometry for a derivative and none for the ZIP", () => {
    const plan = open({ manifest: [derivative(), zip()] });

    expect(plan.objects[0]).toMatchObject({ width: 2048, height: 1365 });
    expect(plan.objects[1]).not.toHaveProperty("width");
  });

  it("sets the deadline from the preparation window", () => {
    const plan = open();

    expect(plan.preparation.openedAt.getTime()).toBe(NOW.getTime());
    expect(plan.preparation.deadline.getTime()).toBe(
      NOW.getTime() + PRIVATE_GALLERY_MAX_PREPARATION_DAYS * DAY,
    );
  });

  it("totals the declared bytes", () => {
    const plan = open({ manifest: [derivative({ nominalBytes: 10 }), zip(20)] });

    expect(plan.totalBytes).toBe(30);
  });

  it.each(["draft", "preparing"] as const)("opens from %s", (state) => {
    // `preparing` too, because §8c lets a regenerated ZIP be planned for a
    // gallery that already holds objects — a new immutable key each time.
    expect(() => open({ state })).not.toThrow();
  });

  it.each(
    PRIVATE_GALLERY_STATES.filter(
      (state) => state !== "draft" && state !== "preparing",
    ),
  )("refuses to open from %s", (state) => {
    // `published` is deliberately among these: adding objects to a gallery a
    // customer is already reading would change what they see with no record of
    // when, and the ADR's path for that is a fresh publication.
    expect(() => open({ state })).toThrow(PrivateGalleryUploadError);
  });

  it("refuses an empty manifest", () => {
    expect(() => open({ manifest: [] })).toThrow(PrivateGalleryUploadError);
  });

  it("refuses more files than a gallery may hold", () => {
    const manifest = Array.from(
      { length: PRIVATE_GALLERY_UPLOAD_LIMITS.maxFiles + 1 },
      () => derivative({ nominalBytes: 1 }),
    );

    expect(() => open({ manifest })).toThrow(PrivateGalleryUploadError);
  });

  it("accepts a manifest exactly at the file ceiling", () => {
    const manifest = Array.from(
      { length: PRIVATE_GALLERY_UPLOAD_LIMITS.maxFiles },
      () => derivative({ nominalBytes: 1 }),
    );

    expect(open({ manifest }).objects).toHaveLength(
      PRIVATE_GALLERY_UPLOAD_LIMITS.maxFiles,
    );
  });

  it.each([
    [
      "a derivative past the byte ceiling",
      derivative({
        nominalBytes: PRIVATE_GALLERY_UPLOAD_LIMITS.maxDerivativeBytes + 1,
      }),
    ],
    [
      "a derivative past the pixel ceiling",
      derivative({
        width: PRIVATE_GALLERY_UPLOAD_LIMITS.maxDerivativeLongestEdgePx + 1,
      }),
    ],
    [
      "a ZIP past its own ceiling",
      zip(PRIVATE_GALLERY_UPLOAD_LIMITS.maxZipBytes + 1),
    ],
  ])("refuses %s", (_case, entry) => {
    // Bounded before any key exists, so an oversized plan is refused rather
    // than discovered after gigabytes are written.
    expect(() => open({ manifest: [entry] })).toThrow(PrivateGalleryUploadError);
  });

  it("refuses a manifest whose total exceeds the gallery ceiling", () => {
    const manifest = [
      zip(PRIVATE_GALLERY_UPLOAD_LIMITS.maxZipBytes),
      zip(PRIVATE_GALLERY_UPLOAD_LIMITS.maxZipBytes),
    ];

    expect(() => open({ manifest })).toThrow(PrivateGalleryUploadError);
  });

  it("refuses two ZIP objects in one plan", () => {
    // §8c: one active ZIP per gallery, named by an atomically-swapped pointer.
    // Two in one plan has no pointer that could answer for both.
    expect(() => open({ manifest: [zip(10), zip(10)] })).toThrow(
      PrivateGalleryUploadError,
    );
  });

  it.each([
    ["a missing size", derivative({ nominalBytes: 0 })],
    ["a fractional size", derivative({ nominalBytes: 1.5 })],
    ["no width", derivative({ width: 0 })],
    ["a fractional height", derivative({ height: 10.5 })],
    ["an unknown derivative kind", derivative({ derivativeKind: "master" as never })],
  ])("refuses an entry with %s", (_case, entry) => {
    expect(() => open({ manifest: [entry] })).toThrow(PrivateGalleryUploadError);
  });

  it("refuses the whole manifest when one entry is bad", () => {
    // A partial plan would leave the administrator believing a set was uploaded
    // that was not, and would put keys in the database for objects the CLI was
    // never told to write.
    expect(() =>
      open({ manifest: [derivative(), derivative({ width: 0 }), derivative()] }),
    ).toThrow(PrivateGalleryUploadError);
  });

  it("refuses a gallery id that would escape the key prefix", () => {
    expect(() => open({ galleryId: "../other" })).toThrow();
  });

  it("refuses an unusable preparation id or clock", () => {
    expect(() => open({ preparationId: "" })).toThrow(PrivateGalleryUploadError);
    expect(() => open({ now: new Date(NaN) })).toThrow(PrivateGalleryUploadError);
  });
});

describe("the preparation deadline", () => {
  const preparation = { deadline: new Date(NOW.getTime() + DAY) };

  it("is open before it, closed at it", () => {
    expect(isPrivateGalleryPreparationExpired(preparation, NOW)).toBe(false);
    expect(
      isPrivateGalleryPreparationExpired(preparation, preparation.deadline),
    ).toBe(true);
  });

  it("lets a publication through while it is open", () => {
    expect(() =>
      assertPrivateGalleryPreparationPublishable(preparation, NOW),
    ).not.toThrow();
  });

  it("refuses a publication once it has closed", () => {
    // The objects a late preparation wrote are already on the cleanup path, so
    // publishing would deliver a gallery whose bytes are scheduled for deletion.
    expect(() =>
      assertPrivateGalleryPreparationPublishable(
        preparation,
        new Date(NOW.getTime() + 2 * DAY),
      ),
    ).toThrow(PrivateGalleryUploadError);
  });

  it("is the same deadline the plan wrote", () => {
    // One stored field read by two callers: a publication check and a cleanup
    // check that disagreed by a millisecond would leave a gallery that can
    // neither be published nor collected.
    const plan = open();

    expect(
      isPrivateGalleryPreparationExpired(
        plan.preparation,
        new Date(plan.preparation.deadline.getTime() - 1),
      ),
    ).toBe(false);
    expect(
      isPrivateGalleryPreparationExpired(plan.preparation, plan.preparation.deadline),
    ).toBe(true);
  });

  it("refuses an unusable date rather than guessing", () => {
    expect(() =>
      isPrivateGalleryPreparationExpired({ deadline: new Date(NaN) }, NOW),
    ).toThrow(PrivateGalleryUploadError);
  });
});
