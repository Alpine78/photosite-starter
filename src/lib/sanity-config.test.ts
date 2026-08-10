import { describe, expect, it } from "vitest";

import { loadSanityConfig, SanityConfigurationError } from "@/lib/sanity-config";

/**
 * A fixture project, not a real one. `zp7mbokg` is the id Sanity's own public
 * documentation uses in its URL examples, so nothing here addresses a project
 * anybody owns.
 */
const validEnvironment = {
  SANITY_PROJECT_ID: "zp7mbokg",
  SANITY_DATASET: "production",
  SANITY_API_VERSION: "v2026-06-24",
};

describe("loadSanityConfig", () => {
  it("loads valid connection settings", () => {
    expect(loadSanityConfig(validEnvironment)).toEqual({
      projectId: "zp7mbokg",
      dataset: "production",
      apiVersion: "v2026-06-24",
    });
  });

  it("trims surrounding whitespace a secrets UI may have kept", () => {
    expect(
      loadSanityConfig({
        SANITY_PROJECT_ID: "  zp7mbokg  ",
        SANITY_DATASET: " production ",
        SANITY_API_VERSION: " v2026-06-24 ",
      }).projectId,
    ).toBe("zp7mbokg");
  });

  it.each(["SANITY_PROJECT_ID", "SANITY_DATASET", "SANITY_API_VERSION"])(
    "requires %s",
    (settingName) => {
      const environment: Record<string, string | undefined> = {
        ...validEnvironment,
      };
      delete environment[settingName];

      expect(() => loadSanityConfig(environment)).toThrow(
        `Missing required deployment setting: ${settingName}`,
      );
    },
  );
});

describe("project id", () => {
  it.each([
    ["an uppercase letter", "ZP7MBOKG"],
    ["an underscore", "zp7_mbokg"],
    ["a leading hyphen", "-zp7mbokg"],
    ["a trailing hyphen", "zp7mbokg-"],
    ["a dot that would add a hostname label", "zp7mbokg.evil"],
    ["a slash that would change the path", "zp7mbokg/production"],
    ["more than 63 characters", "a".repeat(64)],
  ])("refuses %s", (_case, projectId) => {
    expect(() =>
      loadSanityConfig({ ...validEnvironment, SANITY_PROJECT_ID: projectId }),
    ).toThrow(SanityConfigurationError);
  });

  it("accepts a hostname label with inner hyphens", () => {
    expect(
      loadSanityConfig({
        ...validEnvironment,
        SANITY_PROJECT_ID: "studio-example-1",
      }).projectId,
    ).toBe("studio-example-1");
  });
});

describe("dataset", () => {
  it.each([
    ["a slash that would change the path", "production/secret"],
    ["a query separator", "production?perspective=raw"],
    ["a space", "my dataset"],
    ["a leading hyphen", "-production"],
  ])("refuses %s", (_case, dataset) => {
    expect(() =>
      loadSanityConfig({ ...validEnvironment, SANITY_DATASET: dataset }),
    ).toThrow(SanityConfigurationError);
  });

  it("accepts a name with underscores and hyphens", () => {
    expect(
      loadSanityConfig({
        ...validEnvironment,
        SANITY_DATASET: "staging_2026-06",
      }).dataset,
    ).toBe("staging_2026-06");
  });
});

describe("api version", () => {
  it.each([
    ["an undated version", "v1"],
    ["a legacy two-part version", "v2/2021-06-07"],
    ["a date without the leading v", "2026-06-24"],
    ["a date that does not exist", "v2026-02-31"],
    ["a month that does not exist", "v2026-13-01"],
    ["a partially padded date", "v2026-6-24"],
  ])("refuses %s", (_case, apiVersion) => {
    expect(() =>
      loadSanityConfig({ ...validEnvironment, SANITY_API_VERSION: apiVersion }),
    ).toThrow(SanityConfigurationError);
  });

  it("accepts a leap day that exists", () => {
    expect(
      loadSanityConfig({
        ...validEnvironment,
        SANITY_API_VERSION: "v2024-02-29",
      }).apiVersion,
    ).toBe("v2024-02-29");
  });
});

describe("read token", () => {
  it("is optional, because a public dataset needs none", () => {
    expect(loadSanityConfig(validEnvironment).readToken).toBeUndefined();
  });

  it("is carried when configured", () => {
    expect(
      loadSanityConfig({
        ...validEnvironment,
        SANITY_READ_TOKEN: "sk-fixture-token",
      }).readToken,
    ).toBe("sk-fixture-token");
  });

  it("refuses a token mirrored under a NEXT_PUBLIC_ name", () => {
    // That variable is compiled into the browser bundle, so ignoring it in
    // favour of the server-only copy would leave the credential published.
    expect(() =>
      loadSanityConfig({
        ...validEnvironment,
        NEXT_PUBLIC_SANITY_READ_TOKEN: "sk-fixture-token",
      }),
    ).toThrow("compiled into the browser bundle");
  });

  it("refuses a token that kept a quote or line break from a paste", () => {
    expect(() =>
      loadSanityConfig({
        ...validEnvironment,
        SANITY_READ_TOKEN: "sk-fixture\ntoken",
      }),
    ).toThrow("whitespace");
  });
});
