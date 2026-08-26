import { describe, expect, it, vi } from "vitest";

import {
  ContentSourceConfigurationError,
  dispatchContentSource,
  readContentSource,
} from "@/lib/content-source";
import { readDeploymentStage } from "@/lib/deployment-stage";

/**
 * The stage is a separate argument, so these read it the way
 * `loadDeploymentConfig` does — including the unset case, which is production.
 */
function read(environment: Record<string, string | undefined>) {
  return readContentSource(environment, readDeploymentStage(environment));
}

describe("readContentSource", () => {
  it("reads a declared mock source outside production", () => {
    expect(
      read({
        SITE_CONTENT_SOURCE: "mock",
        SITE_DEPLOYMENT_STAGE: "development",
      }),
    ).toBe("mock");

    expect(
      read({
        SITE_CONTENT_SOURCE: "mock",
        SITE_DEPLOYMENT_STAGE: "preview",
      }),
    ).toBe("mock");
  });

  it("reads a declared sanity source in every stage", () => {
    expect(
      read({
        SITE_CONTENT_SOURCE: "sanity",
        SITE_DEPLOYMENT_STAGE: "production",
      }),
    ).toBe("sanity");
  });

  it("has no default, so a forgotten setting cannot become demo content", () => {
    expect(() => read({})).toThrow(ContentSourceConfigurationError);
    expect(() => read({})).toThrow("SITE_CONTENT_SOURCE");
  });

  it("refuses a source it does not recognize", () => {
    expect(() => read({ SITE_CONTENT_SOURCE: "contentful" })).toThrow(
      "Invalid SITE_CONTENT_SOURCE",
    );
  });

  it("refuses mock content in a declared production deployment", () => {
    expect(() =>
      read({
        SITE_CONTENT_SOURCE: "mock",
        SITE_DEPLOYMENT_STAGE: "production",
      }),
    ).toThrow("must not run in a production deployment");
  });

  it("refuses mock content when no stage is declared", () => {
    // An undeclared stage is production, so this is the case that matters: a
    // clone that copied .env.example, set nothing else, and deployed must not
    // publish the project's demo photographs as the photographer's work.
    expect(() => read({ SITE_CONTENT_SOURCE: "mock" })).toThrow(
      "must not run in a production deployment",
    );
  });
});

describe("dispatchContentSource", () => {
  it("calls the sanity handler for \"sanity\" and never the mock one", async () => {
    const mock = vi.fn(async () => "mock-result");
    const sanity = vi.fn(async () => "sanity-result");

    const result = await dispatchContentSource("sanity", { mock, sanity });

    expect(result).toBe("sanity-result");
    expect(sanity).toHaveBeenCalledTimes(1);
    expect(mock).not.toHaveBeenCalled();
  });

  it("calls the mock handler for \"mock\" and never the sanity one", async () => {
    const mock = vi.fn(async () => "mock-result");
    const sanity = vi.fn(async () => "sanity-result");

    const result = await dispatchContentSource("mock", { mock, sanity });

    expect(result).toBe("mock-result");
    expect(mock).toHaveBeenCalledTimes(1);
    expect(sanity).not.toHaveBeenCalled();
  });

  it("propagates a handler's rejection rather than swallowing it", async () => {
    await expect(
      dispatchContentSource("sanity", {
        mock: async () => "mock-result",
        sanity: async () => {
          throw new Error("classified sanity failure");
        },
      }),
    ).rejects.toThrow("classified sanity failure");
  });
});
