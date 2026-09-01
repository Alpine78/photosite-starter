import { describe, expect, it } from "vitest";

import {
  assertNoPublicPrivateGallerySecretMirror,
  DEFAULT_PRIVATE_GALLERY_ROUTE_PREFIX,
  PrivateGalleryDeploymentError,
  readPrivateGalleryDeployment,
} from "@/lib/private-gallery-deployment";

describe("readPrivateGalleryDeployment", () => {
  it("defaults to off with the default route prefix when nothing is set", () => {
    expect(readPrivateGalleryDeployment({}, "development")).toEqual({
      store: "off",
      routePrefix: DEFAULT_PRIVATE_GALLERY_ROUTE_PREFIX,
    });
  });

  it("accepts an explicit enabled switch and a custom prefix", () => {
    expect(
      readPrivateGalleryDeployment({
        PRIVATE_GALLERY_STORE: " enabled ",
        PRIVATE_GALLERY_ROUTE_PREFIX: "clients",
      }, "development"),
    ).toEqual({ store: "enabled", routePrefix: "clients" });
  });

  it.each(["development", "preview"] as const)(
    "accepts the memory fixture store in a %s deployment",
    (stage) => {
      expect(
        readPrivateGalleryDeployment({ PRIVATE_GALLERY_STORE: "memory" }, stage),
      ).toEqual({
        store: "memory",
        routePrefix: DEFAULT_PRIVATE_GALLERY_ROUTE_PREFIX,
      });
    },
  );

  it("refuses the memory fixture store in a production deployment", () => {
    // The fixture's capability is a published constant, so a production
    // deployment that reached this configuration would be serving a gallery
    // anyone holding this repository could open. It fails the build, the same
    // way `SITE_CONTENT_SOURCE=mock` and `CONTACT_DELIVERY_ADAPTER=sink` do.
    expect(() =>
      readPrivateGalleryDeployment(
        { PRIVATE_GALLERY_STORE: "memory" },
        "production",
      ),
    ).toThrow(PrivateGalleryDeploymentError);
  });

  it("rejects an unknown store mode", () => {
    expect(() =>
      readPrivateGalleryDeployment({ PRIVATE_GALLERY_STORE: "on" }, "development"),
    ).toThrow(PrivateGalleryDeploymentError);
  });

  it("rejects a prefix that is not one lowercase segment", () => {
    for (const bad of ["Private", "a/b", "with space", "trailing-", "-lead", "a".repeat(33)]) {
      expect(() =>
        readPrivateGalleryDeployment({ PRIVATE_GALLERY_ROUTE_PREFIX: bad }, "development"),
      ).toThrow(PrivateGalleryDeploymentError);
    }
  });

  it("refuses a NEXT_PUBLIC_ mirror of a secret even when the feature is off", () => {
    expect(() =>
      readPrivateGalleryDeployment({
        PRIVATE_GALLERY_STORE: "off",
        NEXT_PUBLIC_PRIVATE_GALLERY_DATABASE_URL: "postgres://x/y",
      }, "development"),
    ).toThrow(/NEXT_PUBLIC_PRIVATE_GALLERY_DATABASE_URL/);
  });

  it("refuses a NEXT_PUBLIC_ mirror of the capability keyring", () => {
    expect(() =>
      assertNoPublicPrivateGallerySecretMirror({
        NEXT_PUBLIC_PRIVATE_GALLERY_CAPABILITY_KEYS: "k:AAAA",
      }),
    ).toThrow(PrivateGalleryDeploymentError);
  });

  it.each([
    "NEXT_PUBLIC_PRIVATE_GALLERY_RETENTION_SECRET_ACCESS_KEY",
    "NEXT_PUBLIC_PRIVATE_GALLERY_RETENTION_ACCESS_KEY_ID",
    "NEXT_PUBLIC_PRIVATE_GALLERY_CLI_SECRET_ACCESS_KEY",
    "NEXT_PUBLIC_PRIVATE_GALLERY_CLI_ACCESS_KEY_ID",
    "NEXT_PUBLIC_PRIVATE_GALLERY_S3_VERIFIER_ACCESS_KEY_ID",
  ])("refuses a later slice's credential mirror %s", (name) => {
    expect(() =>
      assertNoPublicPrivateGallerySecretMirror({ [name]: "leaked" }),
    ).toThrow(PrivateGalleryDeploymentError);
  });

  it.each([
    "NEXT_PUBLIC_PRIVATE_GALLERY_S3_REGION",
    "NEXT_PUBLIC_PRIVATE_GALLERY_S3_ENDPOINT",
    "NEXT_PUBLIC_PRIVATE_GALLERY_S3_BUCKET",
    "NEXT_PUBLIC_PRIVATE_GALLERY_S3_KEY_PREFIX",
    "NEXT_PUBLIC_PRIVATE_GALLERY_CAPABILITY_ACTIVE_KEY_ID",
  ])("refuses a request-time setting mirror %s", (name) => {
    expect(() =>
      assertNoPublicPrivateGallerySecretMirror({ [name]: "value" }),
    ).toThrow(PrivateGalleryDeploymentError);
  });

  it.each([
    "NEXT_PUBLIC_PRIVATE_GALLERY_STORE",
    "NEXT_PUBLIC_PRIVATE_GALLERY_ROUTE_PREFIX",
  ])("allows a build-safe setting mirror %s", (name) => {
    expect(() =>
      assertNoPublicPrivateGallerySecretMirror({ [name]: "value" }),
    ).not.toThrow();
  });
});
