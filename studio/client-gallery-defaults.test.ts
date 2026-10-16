import { describe, expect, it } from "vitest";
import { initialClientGallery, withClientGalleryDefaults } from "./client-gallery-defaults";
import { clientDeliveryGalleryType } from "../sanity/schemas/client-delivery-gallery";
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
    for (const action of ["publish", "unpublish", "discardChanges", "delete"]) expect(allowAction("clientDeliveryGallery", action)).toBe(true);
    for (const action of ["duplicate", "restore", "custom", undefined]) expect(allowAction("clientDeliveryGallery", action)).toBe(false);
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
