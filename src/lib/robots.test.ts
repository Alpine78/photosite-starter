import { describe, expect, it } from "vitest";

import { buildRobotsPolicy } from "@/lib/robots";

const canonicalBaseUrl = new URL("https://example.test");

describe("buildRobotsPolicy", () => {
  it("allows everything but the two reserved namespaces, and names the sitemap, in production", () => {
    expect(
      buildRobotsPolicy("production", canonicalBaseUrl, "private", "admin"),
    ).toEqual({
      rules: {
        userAgent: "*",
        allow: "/",
        disallow: ["/private/", "/admin/"],
      },
      sitemap: "https://example.test/sitemap.xml",
    });
  });

  it("disallows the configured prefixes, whatever they are", () => {
    const policy = buildRobotsPolicy(
      "production",
      canonicalBaseUrl,
      "clients",
      "studio",
    );
    expect(policy.rules).toMatchObject({
      disallow: ["/clients/", "/studio/"],
    });
  });

  it("keeps the trailing slash so an unrelated root path with the same prefix stays crawlable", () => {
    // `Disallow: /private` would also claim `/private-gallery-bootstrap.js`,
    // a real root file. The namespace root itself is covered by the Proxy's
    // `X-Robots-Tag: noindex, nofollow`, not by this file.
    const policy = buildRobotsPolicy(
      "production",
      canonicalBaseUrl,
      "private",
      "admin",
    );
    const disallow = policy.rules as { disallow: readonly string[] };
    for (const entry of disallow.disallow) {
      expect(entry.endsWith("/")).toBe(true);
    }
  });

  it("disallows everything and names no sitemap in development", () => {
    expect(
      buildRobotsPolicy("development", canonicalBaseUrl, "private", "admin"),
    ).toEqual({
      rules: { userAgent: "*", disallow: "/" },
    });
  });

  it("disallows everything and names no sitemap in preview", () => {
    expect(
      buildRobotsPolicy("preview", canonicalBaseUrl, "private", "admin"),
    ).toEqual({
      rules: { userAgent: "*", disallow: "/" },
    });
  });
});
