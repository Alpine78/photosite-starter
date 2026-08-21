import { describe, expect, it } from "vitest";

import { buildRobotsPolicy } from "@/lib/robots";

const canonicalBaseUrl = new URL("https://example.test");

describe("buildRobotsPolicy", () => {
  it("allows everything and names the sitemap in production", () => {
    expect(buildRobotsPolicy("production", canonicalBaseUrl)).toEqual({
      rules: { userAgent: "*", allow: "/" },
      sitemap: "https://example.test/sitemap.xml",
    });
  });

  it("disallows everything and names no sitemap in development", () => {
    expect(buildRobotsPolicy("development", canonicalBaseUrl)).toEqual({
      rules: { userAgent: "*", disallow: "/" },
    });
  });

  it("disallows everything and names no sitemap in preview", () => {
    expect(buildRobotsPolicy("preview", canonicalBaseUrl)).toEqual({
      rules: { userAgent: "*", disallow: "/" },
    });
  });
});
