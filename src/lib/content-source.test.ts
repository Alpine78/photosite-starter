import { describe, expect, it } from "vitest";

import {
  ContentSourceConfigurationError,
  readContentSource,
} from "@/lib/content-source";

describe("readContentSource", () => {
  it("reads a declared mock source outside production", () => {
    expect(
      readContentSource({
        SITE_CONTENT_SOURCE: "mock",
        SITE_DEPLOYMENT_STAGE: "development",
      }),
    ).toBe("mock");

    expect(
      readContentSource({
        SITE_CONTENT_SOURCE: "mock",
        SITE_DEPLOYMENT_STAGE: "preview",
      }),
    ).toBe("mock");
  });

  it("reads a declared sanity source in every stage", () => {
    expect(
      readContentSource({
        SITE_CONTENT_SOURCE: "sanity",
        SITE_DEPLOYMENT_STAGE: "production",
      }),
    ).toBe("sanity");
  });

  it("has no default, so a forgotten setting cannot become demo content", () => {
    expect(() => readContentSource({})).toThrow(ContentSourceConfigurationError);
    expect(() => readContentSource({})).toThrow("SITE_CONTENT_SOURCE");
  });

  it("refuses a source it does not recognize", () => {
    expect(() =>
      readContentSource({ SITE_CONTENT_SOURCE: "contentful" }),
    ).toThrow("Invalid SITE_CONTENT_SOURCE");
  });

  it("refuses mock content in a declared production deployment", () => {
    expect(() =>
      readContentSource({
        SITE_CONTENT_SOURCE: "mock",
        SITE_DEPLOYMENT_STAGE: "production",
      }),
    ).toThrow("must not run in a production deployment");
  });

  it("refuses mock content when no stage is declared", () => {
    // An undeclared stage is production, so this is the case that matters: a
    // clone that copied .env.example, set nothing else, and deployed must not
    // publish the project's demo photographs as the photographer's work.
    expect(() => readContentSource({ SITE_CONTENT_SOURCE: "mock" })).toThrow(
      "must not run in a production deployment",
    );
  });
});
