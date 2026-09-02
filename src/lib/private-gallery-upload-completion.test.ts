import { describe, expect, it } from "vitest";

import { PRIVATE_GALLERY_MAX_ZIP_URL_TTL_SECONDS } from "@/lib/private-gallery-delivery";
import {
  PRIVATE_GALLERY_MAX_REPORTED_VERIFICATION_FAILURES,
  PRIVATE_GALLERY_ZIP_PREDECESSOR_RETENTION_MS,
  PrivateGalleryCompletionError,
  verifyPrivateGalleryUpload,
  type PrivateGalleryObjectObservation,
  type PrivateGalleryPlannedObjectExpectation,
  type PrivateGalleryUploadReceipt,
} from "@/lib/private-gallery-upload-completion";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-02T12:00:00.000Z");
const PREFIX = "private-galleries";
const key = (n: string) => `${PREFIX}/g/gallery-1/preview/${n}`;
const ZIP_KEY = `${PREFIX}/g/gallery-1/zip/aaaa`;

const PREVIEW: PrivateGalleryPlannedObjectExpectation = {
  objectKey: key("aaaa"),
  objectKind: "preview",
  nominalBytes: 1_500_000,
};
const ZIP: PrivateGalleryPlannedObjectExpectation = {
  objectKey: ZIP_KEY,
  objectKind: "zip",
  nominalBytes: 4_000_000_000,
};

const seen = (
  item: PrivateGalleryPlannedObjectExpectation,
  overrides: Partial<PrivateGalleryObjectObservation> = {},
): PrivateGalleryObjectObservation => ({
  objectKey: item.objectKey,
  sizeBytes: item.nominalBytes,
  ...overrides,
});

function verify(
  overrides: Partial<Parameters<typeof verifyPrivateGalleryUpload>[0]> = {},
) {
  const expected = overrides.expected ?? [PREVIEW];
  return verifyPrivateGalleryUpload({
    preparation: {
      galleryId: "gallery-1",
      preparationId: "prep-1",
      objectKeys: expected.map((item) => item.objectKey),
      openedAt: new Date(NOW.getTime() - DAY),
      deadline: new Date(NOW.getTime() + 29 * DAY),
    },
    expected,
    receipts: [],
    observations: expected.map((item) => seen(item)),
    keyPrefix: PREFIX,
    now: NOW,
    ...overrides,
  });
}

describe("verifyPrivateGalleryUpload", () => {
  it("verifies a plan whose objects are all present at the right size", () => {
    const outcome = verify({
      expected: [PREVIEW],
      observations: [seen(PREVIEW, { etag: "\"abc-2\"" })],
    });

    expect(outcome).toMatchObject({
      verified: true,
      objects: [
        {
          objectKey: PREVIEW.objectKey,
          objectKind: "preview",
          sizeBytes: PREVIEW.nominalBytes,
          etag: "\"abc-2\"",
        },
      ],
    });
  });

  it("reports a key the store holds nothing at", () => {
    expect(verify({ observations: [] })).toEqual({
      verified: false,
      failures: [{ objectKey: PREVIEW.objectKey, reason: "missing" }],
      truncated: false,
    });
  });

  it("measures the declared size against the observed one", () => {
    // The declaration was a claim in the plan; this is the fact it is measured
    // against, which is the whole reason completion re-checks at all.
    expect(
      verify({ observations: [seen(PREVIEW, { sizeBytes: 1_500_001 })] }),
    ).toMatchObject({
      verified: false,
      failures: [{ objectKey: PREVIEW.objectKey, reason: "size-mismatch" }],
    });
  });

  it("reports an object the plan never assigned", () => {
    // The CLI wrote somewhere it was not told to, or the caller read a key from
    // outside this preparation. Either way nothing here vouches for it, and it
    // would sit in the bucket uncovered by any manifest.
    expect(
      verify({
        observations: [seen(PREVIEW), seen({ ...PREVIEW, objectKey: key("zzzz") })],
      }),
    ).toMatchObject({
      verified: false,
      failures: [{ objectKey: key("zzzz"), reason: "unplanned" }],
    });
  });

  it("refuses a key outside this deployment's prefix", () => {
    const stray: PrivateGalleryPlannedObjectExpectation = {
      ...PREVIEW,
      objectKey: "somewhere-else/g/gallery-1/preview/aaaa",
    };

    expect(verify({ expected: [stray] })).toMatchObject({
      verified: false,
      failures: [{ objectKey: stray.objectKey, reason: "outside-prefix" }],
    });
  });

  it("fails the whole completion when one object is wrong", () => {
    // Nothing is partially accepted: a half-verified gallery is one a customer
    // could be shown with photographs missing.
    const second = { ...PREVIEW, objectKey: key("bbbb") };

    expect(
      verify({
        expected: [PREVIEW, second],
        observations: [seen(PREVIEW), seen(second, { sizeBytes: 1 })],
      }),
    ).toMatchObject({ verified: false });
  });

  it("bounds how many failures it reports", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      ...PREVIEW,
      objectKey: key(`k${i}`),
    }));

    const outcome = verify({ expected: many, observations: [] });

    expect(outcome).toMatchObject({ verified: false, truncated: true });
    if (outcome.verified) return;
    expect(outcome.failures).toHaveLength(
      PRIVATE_GALLERY_MAX_REPORTED_VERIFICATION_FAILURES,
    );
  });
});

describe("checksums", () => {
  const receipt = (
    checksum: PrivateGalleryUploadReceipt["checksum"],
  ): PrivateGalleryUploadReceipt[] => [
    { objectKey: PREVIEW.objectKey, ...(checksum ? { checksum } : {}) },
  ];

  it("compares a declared digest against the store's own", () => {
    expect(
      verify({
        receipts: receipt({ algorithm: "sha256", value: "abc" }),
        observations: [
          seen(PREVIEW, { checksum: { algorithm: "sha256", value: "abc" } }),
        ],
      }),
    ).toMatchObject({ verified: true });
  });

  it("reports a disagreement", () => {
    expect(
      verify({
        receipts: receipt({ algorithm: "sha256", value: "abc" }),
        observations: [
          seen(PREVIEW, { checksum: { algorithm: "sha256", value: "def" } }),
        ],
      }),
    ).toMatchObject({
      verified: false,
      failures: [{ objectKey: PREVIEW.objectKey, reason: "checksum-mismatch" }],
    });
  });

  it("refuses to compare two different algorithms", () => {
    expect(
      verify({
        receipts: receipt({ algorithm: "sha256", value: "abc" }),
        observations: [
          seen(PREVIEW, { checksum: { algorithm: "crc32c", value: "abc" } }),
        ],
      }),
    ).toMatchObject({
      verified: false,
      failures: [
        { objectKey: PREVIEW.objectKey, reason: "checksum-algorithm-mismatch" },
      ],
    });
  });

  it("never accepts an ETag in place of a content hash", () => {
    // ADR-0014 §8c states this outright, and it is the one plausible shortcut
    // that would be wrong: a multipart ETag is a digest of part digests, so
    // comparing it against a hash of the file fails for correct data — and
    // sometimes passes, which is worse than always failing.
    expect(
      verify({
        receipts: receipt({ algorithm: "sha256", value: "abc" }),
        observations: [seen(PREVIEW, { etag: "abc" })],
      }),
    ).toMatchObject({
      verified: false,
      failures: [
        { objectKey: PREVIEW.objectKey, reason: "checksum-unavailable" },
      ],
    });
  });

  it("verifies without a checksum when the CLI declared none", () => {
    // The provider-supported semantics are selected at provisioning; a
    // deployment whose store offers none still gets presence and size.
    expect(
      verify({
        receipts: receipt(undefined),
        observations: [seen(PREVIEW, { etag: "\"abc\"" })],
      }),
    ).toMatchObject({ verified: true });
  });

  it("records the store's digest on a verified object", () => {
    const outcome = verify({
      observations: [
        seen(PREVIEW, { checksum: { algorithm: "sha256", value: "abc" } }),
      ],
    });

    expect(outcome).toMatchObject({
      verified: true,
      objects: [{ checksum: { algorithm: "sha256", value: "abc" } }],
    });
  });
});

describe("the ZIP pointer swap", () => {
  it("names the new active ZIP", () => {
    expect(verify({ expected: [ZIP] })).toMatchObject({
      verified: true,
      zipSwap: { objectKey: ZIP_KEY },
    });
  });

  it("retains a superseded predecessor past the longest URL it could have", () => {
    // Without the margin a regeneration would break an in-flight download —
    // including a Range resume — minted against the old immutable key.
    const previous = `${PREFIX}/g/gallery-1/zip/older`;

    const outcome = verify({
      expected: [ZIP],
      currentZipObjectKey: previous,
    });

    expect(outcome).toMatchObject({
      verified: true,
      zipSwap: {
        objectKey: ZIP_KEY,
        predecessorObjectKey: previous,
      },
    });
    if (!outcome.verified || outcome.zipSwap?.retainPredecessorUntil === undefined) {
      throw new Error("expected a retention deadline");
    }
    expect(
      outcome.zipSwap.retainPredecessorUntil.getTime() - NOW.getTime(),
    ).toBe(PRIVATE_GALLERY_ZIP_PREDECESSOR_RETENTION_MS);
    expect(PRIVATE_GALLERY_ZIP_PREDECESSOR_RETENTION_MS).toBeGreaterThan(
      PRIVATE_GALLERY_MAX_ZIP_URL_TTL_SECONDS * 1000,
    );
  });

  it.each([
    ["there was no previous ZIP", undefined],
    ["the pointer already names this key", ZIP_KEY],
  ])("names no predecessor to retain when %s", (_case, currentZipObjectKey) => {
    const outcome = verify({
      expected: [ZIP],
      ...(currentZipObjectKey === undefined ? {} : { currentZipObjectKey }),
    });

    if (!outcome.verified) throw new Error("expected verification to pass");
    expect(outcome.zipSwap).toBeDefined();
    expect(outcome.zipSwap).not.toHaveProperty("predecessorObjectKey");
    expect(outcome.zipSwap).not.toHaveProperty("retainPredecessorUntil");
  });

  it("proposes no swap for a plan that carried no ZIP", () => {
    expect(verify()).not.toHaveProperty("zipSwap");
  });

  it("proposes no swap when verification failed", () => {
    expect(verify({ expected: [ZIP], observations: [] })).not.toHaveProperty(
      "zipSwap",
    );
  });
});

describe("caller mistakes, as distinct from failed uploads", () => {
  it("refuses a preparation whose window already closed", () => {
    // Its objects are on the cleanup path; verifying them would bless bytes
    // already scheduled for deletion.
    expect(() => verify({ now: new Date(NOW.getTime() + 60 * DAY) })).toThrow(
      PrivateGalleryCompletionError,
    );
  });

  it("refuses expectations that do not match the preparation's keys", () => {
    expect(() =>
      verify({
        expected: [PREVIEW],
        preparation: {
          galleryId: "gallery-1",
          preparationId: "prep-1",
          objectKeys: [key("other")],
          openedAt: new Date(NOW.getTime() - DAY),
          deadline: new Date(NOW.getTime() + 29 * DAY),
        },
      }),
    ).toThrow(PrivateGalleryCompletionError);
  });

  it("refuses a plan naming one key twice", () => {
    expect(() => verify({ expected: [PREVIEW, PREVIEW] })).toThrow(
      PrivateGalleryCompletionError,
    );
  });

  it("refuses two observations of one key", () => {
    expect(() =>
      verify({ observations: [seen(PREVIEW), seen(PREVIEW)] }),
    ).toThrow(PrivateGalleryCompletionError);
  });

  it("refuses an unusable clock", () => {
    expect(() => verify({ now: new Date(NaN) })).toThrow(
      PrivateGalleryCompletionError,
    );
  });
});
