import { describe, expect, it } from "vitest";

import {
  assertNoPublicPrivateGallerySecretMirror,
  DEFAULT_PRIVATE_GALLERY_ADMIN_ROUTE_PREFIX,
  DEFAULT_PRIVATE_GALLERY_ROUTE_PREFIX,
  PRIVATE_GALLERY_SECRET_SETTING_NAMES,
  PrivateGalleryDeploymentError,
  readPrivateGalleryDeployment,
} from "@/lib/private-gallery-deployment";

describe("readPrivateGalleryDeployment", () => {
  it("defaults to off with the default route prefix when nothing is set", () => {
    expect(readPrivateGalleryDeployment({}, "development")).toEqual({
      store: "off",
      routePrefix: DEFAULT_PRIVATE_GALLERY_ROUTE_PREFIX,
      adminRoutePrefix: DEFAULT_PRIVATE_GALLERY_ADMIN_ROUTE_PREFIX,
    });
  });

  it("accepts an explicit enabled switch and a custom prefix", () => {
    expect(
      readPrivateGalleryDeployment({
        PRIVATE_GALLERY_STORE: " enabled ",
        PRIVATE_GALLERY_ROUTE_PREFIX: "clients",
        PRIVATE_GALLERY_ADMIN_ROUTE_PREFIX: " studio ",
      }, "development"),
    ).toEqual({
      store: "enabled",
      routePrefix: "clients",
      adminRoutePrefix: "studio",
    });
  });

  it("accepts the memory fixture store in a development deployment", () => {
    expect(
      readPrivateGalleryDeployment(
        { PRIVATE_GALLERY_STORE: "memory" },
        "development",
      ),
    ).toEqual({
      store: "memory",
      routePrefix: DEFAULT_PRIVATE_GALLERY_ROUTE_PREFIX,
      adminRoutePrefix: DEFAULT_PRIVATE_GALLERY_ADMIN_ROUTE_PREFIX,
    });
  });

  describe("the administrator route prefix (ADR-0015 §1)", () => {
    it("defaults to a segment that is not the customer namespace", () => {
      const deployment = readPrivateGalleryDeployment({}, "development");
      expect(deployment.adminRoutePrefix).toBe(
        DEFAULT_PRIVATE_GALLERY_ADMIN_ROUTE_PREFIX,
      );
      expect(deployment.adminRoutePrefix).not.toBe(deployment.routePrefix);
    });

    it("is validated by the same one-lowercase-segment rule as the customer prefix", () => {
      for (const value of [
        "Admin",
        "admin/panel",
        "admin-",
        "-admin",
        "ad min",
        "a".repeat(33),
      ]) {
        expect(() =>
          readPrivateGalleryDeployment(
            { PRIVATE_GALLERY_ADMIN_ROUTE_PREFIX: value },
            "development",
          ),
        ).toThrow(PrivateGalleryDeploymentError);
      }
    });

    it("names the setting that supplied a bad value, not the other one", () => {
      expect(() =>
        readPrivateGalleryDeployment(
          { PRIVATE_GALLERY_ADMIN_ROUTE_PREFIX: "Admin" },
          "development",
        ),
      ).toThrow(/PRIVATE_GALLERY_ADMIN_ROUTE_PREFIX/);
    });

    it("refuses a prefix equal to the customer namespace", () => {
      // ADR-0015 §1 keeps the two namespaces from overlapping at all. Both are
      // one segment, so equality is the only overlap available — and a real
      // one: the customer session cookie is `Path`-scoped beneath the customer
      // prefix, so a shared root would put an administrator route inside the
      // scope of a customer credential.
      expect(() =>
        readPrivateGalleryDeployment(
          {
            PRIVATE_GALLERY_ROUTE_PREFIX: "clients",
            PRIVATE_GALLERY_ADMIN_ROUTE_PREFIX: "clients",
          },
          "development",
        ),
      ).toThrow(/must not overlap/);
    });

    it("refuses the collision that only appears once one side is left at its default", () => {
      expect(() =>
        readPrivateGalleryDeployment(
          { PRIVATE_GALLERY_ROUTE_PREFIX: "admin" },
          "development",
        ),
      ).toThrow(PrivateGalleryDeploymentError);
    });

    it("refuses a NEXT_PUBLIC_ mirror of the administrator secret hash", () => {
      // A scrypt hash rather than the secret, and still never a browser value:
      // shipping it would hand an attacker an offline target and its salt.
      expect(PRIVATE_GALLERY_SECRET_SETTING_NAMES).toContain(
        "PRIVATE_GALLERY_ADMIN_SECRET_HASH",
      );
      expect(() =>
        assertNoPublicPrivateGallerySecretMirror({
          NEXT_PUBLIC_PRIVATE_GALLERY_ADMIN_SECRET_HASH: "scrypt$...",
        }),
      ).toThrow(PrivateGalleryDeploymentError);
    });
  });

  it.each(["preview", "production"] as const)(
    "refuses the memory fixture store in a %s deployment",
    (stage) => {
      // The fixture's capability is a published constant, so any deployment
      // that reached this configuration would serve a gallery anyone holding
      // this repository could open. Preview is refused as well as production:
      // it is a shared, access-protected environment standing in for
      // production, not a developer's machine. It fails the build, the same way
      // `SITE_CONTENT_SOURCE=mock` and `CONTACT_DELIVERY_ADAPTER=sink` do.
      expect(() =>
        readPrivateGalleryDeployment({ PRIVATE_GALLERY_STORE: "memory" }, stage),
      ).toThrow(PrivateGalleryDeploymentError);
    },
  );

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
