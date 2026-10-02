import { describe, expect, it } from "vitest";

import { getBuiltInLabels } from "@/lib/deployment-config";
import {
  buildPrivateGalleryProofNotification,
  PrivateGalleryProofNotificationError,
} from "@/lib/private-gallery-proof-notification";
import {
  planPrivateGalleryProofResend,
  summarizePrivateGalleryProofSelection,
  type PrivateGalleryProofConfirmation,
} from "@/lib/private-gallery-proof";

const pricing = {
  includedCount: 2,
  extraUnitPriceMinor: 1250,
  currency: "EUR",
} as const;

function confirmation(
  selectedImages: PrivateGalleryProofConfirmation["selectedImages"] = [
    { reference: "003", filename: "IMG_0003.JPG", mediaId: "media-c" },
    { reference: "001", filename: "DSC_0001.JPG", mediaId: "media-a" },
    { reference: "002", filename: "IMG_0002.JPG", mediaId: "media-b" },
  ],
): PrivateGalleryProofConfirmation {
  return {
    galleryId: "gallery-a",
    version: 2,
    confirmedAt: new Date("2026-09-30T10:15:00.000Z"),
    summary: summarizePrivateGalleryProofSelection(pricing, selectedImages.length),
    selectedImages,
  };
}

function build(
  snapshot: PrivateGalleryProofConfirmation = confirmation(),
  overrides: Partial<Parameters<typeof buildPrivateGalleryProofNotification>[0]> = {},
) {
  return buildPrivateGalleryProofNotification({
    confirmation: snapshot,
    galleryReference: "proof-job-42",
    customerReference: "customer-17",
    recipient: "owner@example.com",
    outboxIdempotencyKey: "proof-confirmation:gallery-a:2",
    locale: "en-GB",
    labels: getBuiltInLabels("en-GB").proofConfirmationEmail,
    ...overrides,
  });
}

function refused(
  snapshot: PrivateGalleryProofConfirmation,
  overrides: Partial<Parameters<typeof buildPrivateGalleryProofNotification>[0]>,
  expected: string,
) {
  try {
    build(snapshot, overrides);
    throw new Error("expected refusal");
  } catch (error) {
    expect(error).toBeInstanceOf(PrivateGalleryProofNotificationError);
    expect((error as PrivateGalleryProofNotificationError).reason).toBe(expected);
    expect(String(error)).not.toMatch(/IMG_|customer-17|owner@example.com|proof-job-42/);
  }
}

describe("buildPrivateGalleryProofNotification", () => {
  it("contains the complete immutable confirmation in a plain-text owner notice", () => {
    const message = build();
    expect(message.to).toBe("owner@example.com");
    expect(message.subject).toBe("Proof selection confirmed");
    expect(message.subject).not.toMatch(/IMG_|customer|proof-job/);
    expect(message.text).toContain("Gallery reference: proof-job-42");
    expect(message.text).toContain("Customer reference: customer-17");
    expect(message.text).toContain("Confirmed at: 2026-09-30T10:15:00.000Z");
    expect(message.text).toContain("Version: 2");
    expect(message.text).toContain("Included images: 2");
    expect(message.text).toContain("Selected images: 3");
    expect(message.text).toContain("Extra images: 1");
    expect(message.text).toContain("Price per extra image: €12.50");
    expect(message.text).toContain("Currency: EUR");
    expect(message.text).toContain("Extra-image total: €12.50");
    expect(message.text).toContain("003 — IMG_0003.JPG");
    expect(message.text).toContain("001 — DSC_0001.JPG");
    expect(message.text).toContain("002 — IMG_0002.JPG");
    expect(message.idempotencyKey).toBe("proof-confirmation:gallery-a:2");
  });

  it("names a valid empty selection and uses owner-locale labels", () => {
    const snapshot = confirmation([]);
    const message = build(snapshot, {
      locale: "fi-FI",
      labels: getBuiltInLabels("fi-FI").proofConfirmationEmail,
    });
    expect(message.subject).toBe("Vedosvalinta vahvistettu");
    expect(message.text).toContain("Valitut kuvat: 0");
    expect(message.text).toContain("Ei valittuja valokuvia");
    expect(message.text).toContain("Lisäkuvien yhteissumma: 0,00");
  });

  it("reuses the prior snapshot for resend with only a new outbox attempt key", () => {
    const snapshot = confirmation();
    const first = build(snapshot);
    const resend = planPrivateGalleryProofResend({
      confirmation: snapshot,
      attemptId: "attempt-2",
    });
    const second = build(snapshot, {
      outboxIdempotencyKey: resend.outboxIdempotencyKey,
    });
    expect(second.text).toBe(first.text);
    expect(second.subject).toBe(first.subject);
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(snapshot.version).toBe(2);
  });

  it("rejects malformed recipients, references and outbox keys", () => {
    const snapshot = confirmation();
    refused(snapshot, { recipient: "owner\r\nBcc: victim@example.com" }, "invalid-recipient");
    refused(snapshot, { recipient: "a".repeat(65) + "@example.com" }, "invalid-recipient");
    refused(snapshot, { galleryReference: "job\nother" }, "invalid-reference");
    refused(snapshot, { customerReference: " " }, "invalid-reference");
    refused(snapshot, { outboxIdempotencyKey: "bad\nkey" }, "invalid-idempotency-key");
  });

  it("rejects a corrupt or inconsistent stored confirmation", () => {
    const snapshot = confirmation();
    refused(null as never, {}, "invalid-confirmation");
    refused({ ...snapshot, version: 0 }, {}, "invalid-confirmation");
    refused({ ...snapshot, confirmedAt: new Date(NaN) }, {}, "invalid-confirmation");
    refused({
      ...snapshot,
      summary: { ...snapshot.summary, selectedCount: 2 },
    }, {}, "invalid-confirmation");
    refused({
      ...snapshot,
      summary: { ...snapshot.summary, extraTotalMinor: 1 },
    }, {}, "invalid-confirmation");
    refused({
      ...snapshot,
      selectedImages: [
        snapshot.selectedImages[0],
        { ...snapshot.selectedImages[1], reference: "003" },
      ],
      summary: summarizePrivateGalleryProofSelection(pricing, 2),
    }, {}, "invalid-confirmation");
    refused({
      ...snapshot,
      selectedImages: [
        { ...snapshot.selectedImages[0], filename: "IMG_0003.JPG\nInjected" },
      ],
      summary: summarizePrivateGalleryProofSelection(pricing, 1),
    }, {}, "invalid-confirmation");
  });

  it("classifies a failed currency format without exposing snapshot contents", () => {
    refused(confirmation(), { locale: "not a locale!" }, "format-unavailable");
  });
});
