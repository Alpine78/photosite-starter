import { describe, expect, it } from "vitest";

import { absoluteAssetUrl, canonicalRouteUrl } from "@/lib/canonical-url";

const base = new URL("https://studio.example");

describe("canonicalRouteUrl", () => {
  it("keeps the site root as the bare origin with a slash", () => {
    expect(canonicalRouteUrl("/", base)).toBe("https://studio.example/");
  });

  it("resolves a route path against the canonical base origin", () => {
    const url = new URL(canonicalRouteUrl("/services/weddings", base));
    expect(url.origin).toBe(base.origin);
    expect(url.pathname).toBe("/services/weddings");
  });

  it("strips a trailing slash from every path except the root (ADR-0003)", () => {
    expect(canonicalRouteUrl("/services/weddings/", base)).toBe(
      "https://studio.example/services/weddings",
    );
    expect(canonicalRouteUrl("/stories/travel///", base)).toBe(
      "https://studio.example/stories/travel",
    );
  });
});

describe("absoluteAssetUrl", () => {
  it("resolves a root-relative rendition against the canonical base", () => {
    expect(absoluteAssetUrl("/gallery/open-marsh.e679c408d1ee.webp", base)).toBe(
      "https://studio.example/gallery/open-marsh.e679c408d1ee.webp",
    );
  });

  it("preserves an already-absolute CDN rendition, origin and all", () => {
    const cdn =
      "https://cdn.sanity.io/images/p/d/abcdef012345-1200x800.webp";
    expect(absoluteAssetUrl(cdn, base)).toBe(cdn);
  });

  it("does not apply the trailing-slash route rule to an asset path", () => {
    expect(absoluteAssetUrl("/media/set/", base)).toBe(
      "https://studio.example/media/set/",
    );
  });
});
