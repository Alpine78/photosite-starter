import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getPrivateGalleryRuntimeConfig,
  loadPrivateGalleryRuntimeConfig,
  PrivateGalleryConfigurationError,
} from "@/lib/private-gallery-config";

const KEY_A = Buffer.alloc(32, 1).toString("base64");
const KEY_B = Buffer.alloc(32, 2).toString("base64");

function validEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    PRIVATE_GALLERY_DATABASE_URL:
      "postgres://user:pw@db.example.com:5432/private",
    PRIVATE_GALLERY_S3_ENDPOINT: "https://obj.example.com",
    PRIVATE_GALLERY_S3_REGION: "fi-hel2",
    PRIVATE_GALLERY_S3_BUCKET: "photosite-private-galleries",
    PRIVATE_GALLERY_S3_KEY_PREFIX: "galleries",
    PRIVATE_GALLERY_S3_VERIFIER_ACCESS_KEY_ID: "AKIAEXAMPLE01",
    PRIVATE_GALLERY_S3_VERIFIER_SECRET_ACCESS_KEY: "s3cr3t-verifier-key",
    PRIVATE_GALLERY_CAPABILITY_KEYS: `k1:${KEY_A},k2:${KEY_B}`,
    PRIVATE_GALLERY_CAPABILITY_ACTIVE_KEY_ID: "k2",
    ...overrides,
  };
}

describe("loadPrivateGalleryRuntimeConfig", () => {
  it("accepts a well-formed environment", () => {
    const config = loadPrivateGalleryRuntimeConfig(validEnv());

    expect(config.databaseUrl).toBe(
      "postgres://user:pw@db.example.com:5432/private",
    );
    expect(config.objectStore).toEqual({
      endpoint: "https://obj.example.com",
      region: "fi-hel2",
      bucket: "photosite-private-galleries",
      keyPrefix: "galleries",
      verifierAccessKeyId: "AKIAEXAMPLE01",
      verifierSecretAccessKey: "s3cr3t-verifier-key",
    });
    expect(config.capabilityKeyring.activeKeyId).toBe("k2");
    expect([...config.capabilityKeyring.keyIds]).toEqual(["k1", "k2"]);
  });

  it("hands out a fresh copy of key material each call and hides unknown ids", () => {
    const { capabilityKeyring } = loadPrivateGalleryRuntimeConfig(validEnv());

    const first = capabilityKeyring.getKey("k1");
    expect(first).toBeInstanceOf(Uint8Array);
    expect(first).toHaveLength(32);
    first?.fill(9);
    expect([...(capabilityKeyring.getKey("k1") as Uint8Array)]).toEqual(
      new Array(32).fill(1),
    );

    expect(capabilityKeyring.getKey("nope")).toBeUndefined();
    expect(Object.isFrozen(capabilityKeyring.keyIds)).toBe(true);
  });

  it.each([
    "PRIVATE_GALLERY_DATABASE_URL",
    "PRIVATE_GALLERY_S3_ENDPOINT",
    "PRIVATE_GALLERY_S3_REGION",
    "PRIVATE_GALLERY_S3_BUCKET",
    "PRIVATE_GALLERY_S3_KEY_PREFIX",
    "PRIVATE_GALLERY_S3_VERIFIER_ACCESS_KEY_ID",
    "PRIVATE_GALLERY_S3_VERIFIER_SECRET_ACCESS_KEY",
    "PRIVATE_GALLERY_CAPABILITY_KEYS",
    "PRIVATE_GALLERY_CAPABILITY_ACTIVE_KEY_ID",
  ])("requires %s", (name) => {
    expect(() =>
      loadPrivateGalleryRuntimeConfig(validEnv({ [name]: undefined })),
    ).toThrow(/Missing required deployment setting/);
  });

  it("rejects whitespace inside any value", () => {
    expect(() =>
      loadPrivateGalleryRuntimeConfig(
        validEnv({ PRIVATE_GALLERY_S3_REGION: "fi hel2" }),
      ),
    ).toThrow(/whitespace/);
  });

  it.each([
    "PRIVATE_GALLERY_DATABASE_URL",
    "PRIVATE_GALLERY_S3_VERIFIER_SECRET_ACCESS_KEY",
    "PRIVATE_GALLERY_CAPABILITY_KEYS",
  ])("refuses a NEXT_PUBLIC_ mirror of %s", (name) => {
    expect(() =>
      loadPrivateGalleryRuntimeConfig(
        validEnv({ [`NEXT_PUBLIC_${name}`]: "leaked" }),
      ),
    ).toThrow(new RegExp(`NEXT_PUBLIC_${name}`));
  });

  it.each([
    ["mysql://h/d", /postgres/],
    ["not-a-url", /postgres/],
  ])("rejects database URL %s", (value, matcher) => {
    expect(() =>
      loadPrivateGalleryRuntimeConfig(
        validEnv({ PRIVATE_GALLERY_DATABASE_URL: value }),
      ),
    ).toThrow(matcher);
  });

  it.each([
    "http://obj.example.com",
    "https://obj.example.com/bucket",
    "https://obj.example.com?x=1",
    "https://user:pw@obj.example.com",
  ])("rejects object-store endpoint %s", (value) => {
    expect(() =>
      loadPrivateGalleryRuntimeConfig(
        validEnv({ PRIVATE_GALLERY_S3_ENDPOINT: value }),
      ),
    ).toThrow(PrivateGalleryConfigurationError);
  });

  it.each(["US_EAST", "region!", "a".repeat(65)])(
    "rejects region %s",
    (value) => {
      expect(() =>
        loadPrivateGalleryRuntimeConfig(
          validEnv({ PRIVATE_GALLERY_S3_REGION: value }),
        ),
      ).toThrow(PrivateGalleryConfigurationError);
    },
  );

  it.each(["Bad-Bucket", "a..b", "10.0.0.1", "ab"])(
    "rejects bucket %s",
    (value) => {
      expect(() =>
        loadPrivateGalleryRuntimeConfig(
          validEnv({ PRIVATE_GALLERY_S3_BUCKET: value }),
        ),
      ).toThrow(PrivateGalleryConfigurationError);
    },
  );

  it.each(["/leading", "trailing/", "a//b", "Upper"])(
    "rejects key prefix %s",
    (value) => {
      expect(() =>
        loadPrivateGalleryRuntimeConfig(
          validEnv({ PRIVATE_GALLERY_S3_KEY_PREFIX: value }),
        ),
      ).toThrow(PrivateGalleryConfigurationError);
    },
  );

  describe("capability keyring", () => {
    it.each([
      ["a doubled comma", `k1:${KEY_A},,k2:${KEY_B}`],
      ["a trailing comma", `k1:${KEY_A},`],
      ["a non-base64 value", "k1:not+base64!!"],
      ["a wrong-length key", "k1:QUJD"],
      ["a non-canonical encoding", "k1:QR=="],
      ["a duplicate id", `k1:${KEY_A},k1:${KEY_B}`],
      ["two ids with identical key bytes", `k1:${KEY_A},k2:${KEY_A}`],
      ["an uppercase id", `K1:${KEY_A}`],
      ["an entry without a colon", `k1${KEY_A}`],
    ])("rejects %s", (_label, value) => {
      expect(() =>
        loadPrivateGalleryRuntimeConfig(
          validEnv({ PRIVATE_GALLERY_CAPABILITY_KEYS: value }),
        ),
      ).toThrow(PrivateGalleryConfigurationError);
    });

    it("rejects more than sixteen keys", () => {
      const many = Array.from(
        { length: 17 },
        (_v, i) => `k${i}:${Buffer.alloc(32, i + 10).toString("base64")}`,
      ).join(",");
      expect(() =>
        loadPrivateGalleryRuntimeConfig(
          validEnv({
            PRIVATE_GALLERY_CAPABILITY_KEYS: many,
            PRIVATE_GALLERY_CAPABILITY_ACTIVE_KEY_ID: "k0",
          }),
        ),
      ).toThrow(/at most 16/);
    });

    it("requires the active key id to name a configured key", () => {
      expect(() =>
        loadPrivateGalleryRuntimeConfig(
          validEnv({ PRIVATE_GALLERY_CAPABILITY_ACTIVE_KEY_ID: "k9" }),
        ),
      ).toThrow(/not one of the configured/);
    });
  });
});

describe("getPrivateGalleryRuntimeConfig", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuses to run in a browser", () => {
    vi.stubGlobal("window", {});
    expect(() => getPrivateGalleryRuntimeConfig()).toThrow(/in a browser/);
  });

  it("refuses to run when the feature is off (the test environment default)", () => {
    expect(() => getPrivateGalleryRuntimeConfig()).toThrow(
      /PRIVATE_GALLERY_STORE is "off"/,
    );
  });
});
