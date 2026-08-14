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
  SANITY_DATASET_VISIBILITY: "public",
  SANITY_API_VERSION: "v2026-06-24",
};

describe("loadSanityConfig", () => {
  it("loads valid connection settings", () => {
    expect(loadSanityConfig(validEnvironment)).toEqual({
      projectId: "zp7mbokg",
      dataset: "production",
      datasetVisibility: "public",
      apiVersion: "v2026-06-24",
    });
  });

  it("trims surrounding whitespace a secrets UI may have kept", () => {
    expect(
      loadSanityConfig({
        SANITY_PROJECT_ID: "  zp7mbokg  ",
        SANITY_DATASET: " production ",
        SANITY_DATASET_VISIBILITY: " public ",
        SANITY_API_VERSION: " v2026-06-24 ",
      }).projectId,
    ).toBe("zp7mbokg");
  });

  it.each([
    "SANITY_PROJECT_ID",
    "SANITY_DATASET",
    "SANITY_DATASET_VISIBILITY",
    "SANITY_API_VERSION",
  ])(
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
  // Sanity's rule: 1–64 characters of lowercase letters, digits, hyphens, and
  // underscores, beginning and ending with a lowercase letter or digit.
  it.each([
    ["a slash that would change the path", "production/secret"],
    ["a query separator", "production?perspective=raw"],
    ["a space", "my dataset"],
    ["an uppercase letter", "Production"],
    ["a leading hyphen", "-production"],
    ["a trailing hyphen", "production-"],
    ["a trailing underscore", "production_"],
    ["more than 64 characters", "a".repeat(65)],
    ["an empty name", ""],
  ])("refuses %s", (_case, dataset) => {
    expect(() =>
      loadSanityConfig({ ...validEnvironment, SANITY_DATASET: dataset }),
    ).toThrow(SanityConfigurationError);
  });

  it.each([
    ["inner underscores and hyphens", "staging_2026-06"],
    ["a single character", "p"],
    ["exactly 64 characters", "a".repeat(64)],
  ])("accepts %s", (_case, dataset) => {
    expect(
      loadSanityConfig({ ...validEnvironment, SANITY_DATASET: dataset }).dataset,
    ).toBe(dataset);
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

  // Asserted against a fixed clock, so these do not change meaning with time.
  const now = new Date("2026-08-10T11:00:00Z");

  it("refuses a version dated after today", () => {
    // A future date pins nothing: it names API behavior that does not exist,
    // so the deployment cannot have been built or tested against it.
    expect(() =>
      loadSanityConfig(
        { ...validEnvironment, SANITY_API_VERSION: "v2099-01-01" },
        { now },
      ),
    ).toThrow("in the future");

    expect(() =>
      loadSanityConfig(
        { ...validEnvironment, SANITY_API_VERSION: "v2026-08-11" },
        { now },
      ),
    ).toThrow("in the future");
  });

  it("accepts today's UTC date, which is what Sanity recommends pinning", () => {
    expect(
      loadSanityConfig(
        { ...validEnvironment, SANITY_API_VERSION: "v2026-08-10" },
        { now },
      ).apiVersion,
    ).toBe("v2026-08-10");
  });

  it("compares in UTC rather than the machine's timezone", () => {
    // Late enough in the UTC day that a machine ahead of UTC would already be
    // on the next date locally. The version must still be judged against the
    // UTC day, which is how Sanity versions.
    expect(
      loadSanityConfig(
        { ...validEnvironment, SANITY_API_VERSION: "v2026-08-10" },
        { now: new Date("2026-08-10T23:30:00Z") },
      ).apiVersion,
    ).toBe("v2026-08-10");
  });
});

describe("dataset visibility", () => {
  it.each(["Public", "restricted", ""])(
    "refuses a visibility that is not one of the two: %s",
    (visibility) => {
      expect(() =>
        loadSanityConfig({
          ...validEnvironment,
          SANITY_DATASET_VISIBILITY: visibility,
        }),
      ).toThrow(/SANITY_DATASET_VISIBILITY/);
    },
  );

  it("refuses a private dataset with no credential to read it with", () => {
    // The failure this prevents is silent: Sanity answers an unauthenticated
    // read of a private dataset with 200 and an empty result, so the site would
    // render as though nothing had been authored yet and every diagnostic would
    // agree with it.
    expect(() =>
      loadSanityConfig({
        ...validEnvironment,
        SANITY_DATASET_VISIBILITY: "private",
      }),
    ).toThrow(/SANITY_READ_TOKEN/);
  });

  it("accepts a private dataset with one", () => {
    expect(
      loadSanityConfig({
        ...validEnvironment,
        SANITY_DATASET_VISIBILITY: "private",
        SANITY_READ_TOKEN: "sk-fixture-token",
      }).datasetVisibility,
    ).toBe("private");
  });
});

describe("read token", () => {
  it("is optional for a public dataset, which needs none", () => {
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
