import { describe, expect, it } from "vitest";

import { loadDeploymentConfig } from "@/lib/deployment-config";

const validEnvironment = {
  SITE_LOCALE: "en-GB",
  SITE_CANONICAL_BASE_URL: "https://example.com",
  SITE_DEFAULT_SOCIAL_IMAGE: "/gallery/coastal-landscape.webp",
};

describe("loadDeploymentConfig", () => {
  it("loads and normalizes valid deployment settings", () => {
    const config = loadDeploymentConfig(validEnvironment);

    expect(config.locale).toBe("en-GB");
    expect(config.canonicalBaseUrl.href).toBe("https://example.com/");
    expect(config.defaultSocialImage.href).toBe(
      "https://example.com/gallery/coastal-landscape.webp",
    );
  });

  it.each([
    "SITE_LOCALE",
    "SITE_CANONICAL_BASE_URL",
    "SITE_DEFAULT_SOCIAL_IMAGE",
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

  it("rejects a non-HTTP default social image URL", () => {
    expect(() =>
      loadDeploymentConfig({
        ...validEnvironment,
        SITE_DEFAULT_SOCIAL_IMAGE: "data:image/png;base64,abc",
      }),
    ).toThrow("Invalid SITE_DEFAULT_SOCIAL_IMAGE");
  });
});
