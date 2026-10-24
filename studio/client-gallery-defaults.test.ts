import { afterEach, describe, expect, it, vi } from "vitest";
import { deliveryExpiryFromCreation, initialClientGallery, initialDeliveryGallery, initialProofGallery, withClientGalleryDefaults } from "./client-gallery-defaults";
import { clientDeliveryGalleryType, isClientDeliveryInstant } from "../sanity/schemas/client-delivery-gallery";
import { parseClientGallery, clientGalleryAvailable } from "../src/lib/client-gallery-model";
import { clientProofGalleryType } from "../sanity/schemas/client-proof-gallery";
import { legacyDeliveryGalleryType } from "../sanity/schemas/legacy-delivery-gallery";
import { allowAction, allowTemplate, EDITORIAL_LISTS } from "./editorial-policy";
import { studioInterfaceText } from "./interface-locales";
import { localizedEditorialPreview } from "./localized-preview";

describe("new client gallery Studio creation", () => {
  it("uses all 16 supplied random bytes as a fixed lowercase identifier and starts paused", () => {
    expect(initialClientGallery((bytes) => { bytes.set(Array.from({ length: 16 }, (_, i) => i)); return bytes; }))
      .toEqual({ handle: "000102030405060708090a0b0c0d0e0f", available: false });
    const values = Array.from({ length: 20 }, () => initialClientGallery().handle);
    expect(new Set(values).size).toBe(values.length);
    expect(values.every((value) => /^[a-f0-9]{32}$/u.test(value))).toBe(true);
  });
  it("refuses missing cryptography rather than using a placeholder or insecure fallback", () => {
    expect(() => initialClientGallery(() => { throw new Error("crypto-unavailable"); })).toThrow("crypto-unavailable");
  });
  it("adds fresh initial values only to the new document and preserves validators", () => {
    const configured = withClientGalleryDefaults(clientDeliveryGalleryType);
    expect(configured.validation).toBe(clientDeliveryGalleryType.validation);
    expect("initialValue" in configured && configured.initialValue!()).toMatchObject({ available: false });
    expect(withClientGalleryDefaults(legacyDeliveryGalleryType)).toBe(legacyDeliveryGalleryType);
  });
  it("allows authenticated native editing while blocking identity-copy and restoration actions", () => {
    expect(allowTemplate("clientDeliveryGallery")).toBe(true);
    for (const action of ["unpublish", "discardChanges", "delete"]) expect(allowAction("clientDeliveryGallery", action)).toBe(true);
    for (const action of ["publish", "duplicate", "restore", "custom", undefined]) expect(allowAction("clientDeliveryGallery", action)).toBe(false);
    expect(allowTemplate("legacyDeliveryGallery")).toBe(false);
    expect(allowAction("legacyDeliveryGallery", "publish")).toBe(false);
  });
  it("makes the new list discoverable with FI/EN editor labels", () => {
    expect(EDITORIAL_LISTS).toContainEqual({ type: "clientDeliveryGallery", title: "Client galleries" });
    expect(studioInterfaceText("Client galleries", "fi-FI")).toBe("Asiakasgalleriat");
    expect(studioInterfaceText("Client galleries", "en-US")).toBe("Client galleries");
    const selection = { titles: [{ language: "fi", value: "Kuvatoimitus" }, { language: "en", value: "Delivery" }] };
    expect(localizedEditorialPreview("clientDeliveryGallery", selection, "fi-FI")?.title).toBe("Kuvatoimitus");
    expect(localizedEditorialPreview("clientDeliveryGallery", selection, "en-US")?.title).toBe("Delivery");
    expect(localizedEditorialPreview("clientDeliveryGallery", {}, "fi-FI")?.title).toBe("Asiakasgalleria");
  });
});

describe("six-calendar-month delivery default (AB#393)", () => {
  afterEach(() => vi.useRealTimers());
  it.each([
    ["2026-08-31T12:34:56.789Z", "2027-02-28T12:34:56.789Z"],
    ["2027-08-31T12:34:56.789Z", "2028-02-29T12:34:56.789Z"],
    ["2027-08-29T00:00:00.000Z", "2028-02-29T00:00:00.000Z"],
    ["2026-08-30T00:00:00.000Z", "2027-02-28T00:00:00.000Z"],
    ["2026-12-31T23:59:59.999Z", "2027-06-30T23:59:59.999Z"],
    ["2026-01-31T00:00:00.000Z", "2026-07-31T00:00:00.000Z"],
    ["2028-02-29T01:02:03.004Z", "2028-08-29T01:02:03.004Z"],
    ["2026-10-24T09:00:00.000Z", "2027-04-24T09:00:00.000Z"],
  ])("clamps %s to %s with the UTC time intact", (start, expected) => {
    const expiry = deliveryExpiryFromCreation(Date.parse(start));
    expect(expiry).toBe(expected);
    expect(isClientDeliveryInstant(expiry)).toBe(true);
  });
  it("the real reader agrees that the generated deadline closes at the exact instant", () => {
    const initial = initialDeliveryGallery(undefined, () => Date.parse("2026-08-31T12:34:56.789Z"));
    const gallery = parseClientGallery({ ...initial, _id: "delivery", _type: "clientDeliveryGallery", _rev: "r1", available: true,
      items: [{ _key: "one", _type: "clientDeliveryItem", mediaType: "image", image: { _type: "image", asset: { _type: "reference", _ref: `image-${"a".repeat(40)}-1600x1000-webp` } },
        alt: [{ _key: "en", _type: "localizedText", language: "en", value: "Coast" }] }] }, "delivery", initial.handle);
    const at = Date.parse(initial.expiryInstant);
    expect(clientGalleryAvailable(gallery, at - 1)).toBe(true);
    expect(clientGalleryAvailable(gallery, at)).toBe(false);
    expect(initial.available).toBe(false);
  });
  it.each([NaN, Infinity, -Infinity, 8.64e15, -8.64e15, 8.64e15 + 1, Date.parse("9999-08-01T00:00:00.000Z")])("refuses an invalid or unsupported clock %s", (now) => {
    expect(() => initialDeliveryGallery(undefined, () => now)).toThrow("invalid-gallery-clock");
  });
  it("does not fall back when the clock or secure entropy source fails", () => {
    expect(() => initialDeliveryGallery(undefined, () => { throw new Error("clock-unavailable"); })).toThrow("clock-unavailable");
    expect(() => initialDeliveryGallery(() => { throw new Error("crypto-unavailable"); })).toThrow("crypto-unavailable");
  });
  it("only the creation resolver computes a deadline; proof and legacy defaults stay separate", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-08-31T12:34:56.789Z"));
    const configured = withClientGalleryDefaults(clientDeliveryGalleryType);
    expect(configured.initialValue!()).toMatchObject({ available: false, availabilityMode: "until", expiryInstant: "2027-02-28T12:34:56.789Z" });
    const proof = initialProofGallery();
    expect(proof).toMatchObject({ available: false, availabilityMode: "indefinite", referenceHighWater: 0 });
    expect(proof).not.toHaveProperty("expiryInstant");
    expect(withClientGalleryDefaults(clientProofGalleryType).initialValue!()).not.toHaveProperty("expiryInstant");
    expect(withClientGalleryDefaults(legacyDeliveryGalleryType)).toBe(legacyDeliveryGalleryType);
    const unrelated = { name: "other", type: "document", initialValue: false } as const;
    expect(withClientGalleryDefaults(unrelated)).toBe(unrelated);
    expect(clientDeliveryGalleryType).not.toHaveProperty("initialValue");
  });
});
