import { describe, expect, it } from "vitest";

import { loadDeploymentConfig } from "@/lib/deployment-config";

const validEnvironment = {
  SITE_LOCALE: "en-GB",
  SITE_CANONICAL_BASE_URL: "https://example.com",
  SITE_DEFAULT_SOCIAL_IMAGE:
    "/gallery/coastal-landscape.1683eecb7e65.webp",
  SITE_DEFAULT_SOCIAL_IMAGE_WIDTH: "1536",
  SITE_DEFAULT_SOCIAL_IMAGE_HEIGHT: "1024",
};

describe("loadDeploymentConfig", () => {
  it("loads and normalizes valid deployment settings", () => {
    const config = loadDeploymentConfig(validEnvironment);

    expect(config.locale).toBe("en-GB");
    expect(config.canonicalBaseUrl.href).toBe("https://example.com/");
    expect(config.defaultSocialImage.rendition).toMatchObject({
      src: "/gallery/coastal-landscape.1683eecb7e65.webp",
      version: "1683eecb7e65",
      width: 1536,
      height: 1024,
    });
  });

  it("treats an undeclared default social image alt text as decorative", () => {
    expect(loadDeploymentConfig(validEnvironment).defaultSocialImage.alt).toBe(
      "",
    );
  });

  it("keeps a declared default social image alt text", () => {
    const config = loadDeploymentConfig({
      ...validEnvironment,
      SITE_DEFAULT_SOCIAL_IMAGE_ALT: " Rocky shoreline beside calm water ",
    });

    expect(config.defaultSocialImage.alt).toBe(
      "Rocky shoreline beside calm water",
    );
  });

  it.each([
    "SITE_LOCALE",
    "SITE_CANONICAL_BASE_URL",
    "SITE_DEFAULT_SOCIAL_IMAGE",
    "SITE_DEFAULT_SOCIAL_IMAGE_WIDTH",
    "SITE_DEFAULT_SOCIAL_IMAGE_HEIGHT",
  ])("fails clearly when %s is missing", (settingName) => {
    expect(() =>
      loadDeploymentConfig({
        ...validEnvironment,
        [settingName]: " ",
      }),
    ).toThrow(`Missing required deployment setting: ${settingName}`);
  });

  it("rejects an invalid locale", () => {
    expect(() =>
      loadDeploymentConfig({
        ...validEnvironment,
        SITE_LOCALE: "not_a_locale",
      }),
    ).toThrow("Invalid SITE_LOCALE");
  });

  it("rejects a non-HTTP canonical base URL", () => {
    expect(() =>
      loadDeploymentConfig({
        ...validEnvironment,
        SITE_CANONICAL_BASE_URL: "ftp://example.com",
      }),
    ).toThrow("Invalid SITE_CANONICAL_BASE_URL");
  });

  // A canonical base URL is published verbatim in rel="canonical" and og:url,
  // and a base path would be dropped when a route path resolves against it.
  it("rejects canonical base URL credentials", () => {
    expect(() =>
      loadDeploymentConfig({
        ...validEnvironment,
        SITE_CANONICAL_BASE_URL: "https://user:secret@example.com",
      }),
    ).toThrow("credentials must not appear in a published canonical URL");
  });

  it.each(["https://example.com?utm=x", "https://example.com#top"])(
    "rejects the canonical base URL %s",
    (value) => {
      expect(() =>
        loadDeploymentConfig({
          ...validEnvironment,
          SITE_CANONICAL_BASE_URL: value,
        }),
      ).toThrow("expected an origin without a query or fragment");
    },
  );

  it("rejects a canonical base URL carrying a path", () => {
    expect(() =>
      loadDeploymentConfig({
        ...validEnvironment,
        SITE_CANONICAL_BASE_URL: "https://example.com/site",
      }),
    ).toThrow("expected an origin without a path");
  });

  it.each([
    "data:image/png;base64,abc",
    "/private/master.jpg",
    "/gallery/coastal-landscape.webp",
    "http://cdn.example.com/social.1683eecb7e65.webp",
  ])("rejects the default social image source %s", (value) => {
    expect(() =>
      loadDeploymentConfig({
        ...validEnvironment,
        SITE_DEFAULT_SOCIAL_IMAGE: value,
      }),
    ).toThrow(
      "expected a versioned local /gallery path or an HTTPS URL",
    );
  });

  it("rejects a local social image whose filename version was edited away", () => {
    expect(() =>
      loadDeploymentConfig({
        ...validEnvironment,
        SITE_DEFAULT_SOCIAL_IMAGE: "/gallery/coastal-landscape.nothex12345.webp",
      }),
    ).toThrow("expected a versioned local /gallery path or an HTTPS URL");
  });

  it("accepts a remote derivative that declares its byte version", () => {
    const config = loadDeploymentConfig({
      ...validEnvironment,
      SITE_DEFAULT_SOCIAL_IMAGE:
        "https://cdn.example.com/social.1683eecb7e65.webp",
      SITE_DEFAULT_SOCIAL_IMAGE_VERSION: "1683eecb7e65",
    });

    expect(config.defaultSocialImage.rendition.src).toBe(
      "https://cdn.example.com/social.1683eecb7e65.webp",
    );
  });

  it("requires a declared version for a remote derivative", () => {
    expect(() =>
      loadDeploymentConfig({
        ...validEnvironment,
        SITE_DEFAULT_SOCIAL_IMAGE:
          "https://cdn.example.com/social.1683eecb7e65.webp",
      }),
    ).toThrow(
      "Missing required deployment setting: SITE_DEFAULT_SOCIAL_IMAGE_VERSION",
    );
  });

  it("rejects a remote derivative whose URL omits the declared version", () => {
    expect(() =>
      loadDeploymentConfig({
        ...validEnvironment,
        SITE_DEFAULT_SOCIAL_IMAGE: "https://cdn.example.com/social.webp",
        SITE_DEFAULT_SOCIAL_IMAGE_VERSION: "1683eecb7e65",
      }),
    ).toThrow("rendition.version must appear in rendition.src");
  });

  it.each([
    "https://user:secret@cdn.example.com/social.1683eecb7e65.webp",
    "https://cdn.example.com/social.1683eecb7e65.webp#preview",
  ])("rejects the unsafe remote social image URL %s", (value) => {
    expect(() =>
      loadDeploymentConfig({
        ...validEnvironment,
        SITE_DEFAULT_SOCIAL_IMAGE: value,
        SITE_DEFAULT_SOCIAL_IMAGE_VERSION: "1683eecb7e65",
      }),
    ).toThrow("Invalid SITE_DEFAULT_SOCIAL_IMAGE");
  });

  it.each(["0", "-1", "12.5", "1e3", "0x10", "wide", "99999"])(
    "rejects the invalid default social image dimension %s",
    (value) => {
      expect(() =>
        loadDeploymentConfig({
          ...validEnvironment,
          SITE_DEFAULT_SOCIAL_IMAGE_WIDTH: value,
        }),
      ).toThrow("Invalid SITE_DEFAULT_SOCIAL_IMAGE_WIDTH");
    },
  );
});
