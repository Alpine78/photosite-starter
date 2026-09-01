import { describe, expect, it } from "vitest";

import { buildRobotsPolicy } from "@/lib/robots";

const canonicalBaseUrl = new URL("https://example.test");

describe("buildRobotsPolicy", () => {
  it("allows everything but the private namespace, and names the sitemap, in production", () => {
    expect(
      buildRobotsPolicy("production", canonicalBaseUrl, "private"),
    ).toEqual({
      rules: { userAgent: "*", allow: "/", disallow: "/private/" },
      sitemap: "https://example.test/sitemap.xml",
    });
  });

  it("disallows the configured private prefix, whatever it is", () => {
    const policy = buildRobotsPolicy("production", canonicalBaseUrl, "clients");
    expect(policy.rules).toMatchObject({ disallow: "/clients/" });
  });

  it("disallows everything and names no sitemap in development", () => {
    expect(
      buildRobotsPolicy("development", canonicalBaseUrl, "private"),
    ).toEqual({
      rules: { userAgent: "*", disallow: "/" },
    });
  });

  it("disallows everything and names no sitemap in preview", () => {
    expect(
      buildRobotsPolicy("preview", canonicalBaseUrl, "private"),
    ).toEqual({
      rules: { userAgent: "*", disallow: "/" },
    });
  });
});
