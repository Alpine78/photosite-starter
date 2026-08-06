import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { getArticles } from "@/lib/articles";
import {
  RESERVED_ROOT_SEGMENTS,
  defaultLocaleRouteExists,
} from "@/lib/public-routes";
import { getServices } from "@/lib/services";

/**
 * Root segments the file system really serves: static route directories and
 * metadata files under `src/app`, plus everything in `public/`. Dynamic
 * segments and route groups own no literal segment, so they are skipped.
 */
function readRootSegments(): string[] {
  const appEntries = readdirSync(join(process.cwd(), "src/app"), {
    withFileTypes: true,
  });

  return [
    ...appEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => !/^[[(_]/.test(name)),
    ...appEntries
      .filter((entry) => entry.isFile() && !/\.(tsx?|css)$/.test(entry.name))
      .map((entry) => entry.name),
    ...readdirSync(join(process.cwd(), "public")),
  ];
}

describe("RESERVED_ROOT_SEGMENTS", () => {
  it("covers every root segment the application already serves", () => {
    // A missing entry would let a deployment configure a locale prefix that the
    // file system shadows, so the reservation is checked against the routes
    // themselves rather than against a remembered list.
    expect([...RESERVED_ROOT_SEGMENTS].sort()).toEqual(
      [...new Set(readRootSegments())].sort(),
    );
  });
});

describe("defaultLocaleRouteExists", () => {
  it("resolves the site root", async () => {
    await expect(defaultLocaleRouteExists("/")).resolves.toBe(true);
  });

  it("resolves the static listing routes", async () => {
    await expect(defaultLocaleRouteExists("/services")).resolves.toBe(true);
    await expect(defaultLocaleRouteExists("/portfolio")).resolves.toBe(true);
    await expect(defaultLocaleRouteExists("/blog")).resolves.toBe(true);
  });

  it("resolves a detail route that has content behind it", async () => {
    const [service] = await getServices();
    const [article] = await getArticles();

    await expect(
      defaultLocaleRouteExists(`/services/${service.slug}`),
    ).resolves.toBe(true);
    await expect(
      defaultLocaleRouteExists(`/blog/${article.slug}`),
    ).resolves.toBe(true);
  });

  it("rejects a detail route whose content does not exist", async () => {
    // An unknown slug is a 404 in the default locale, so a redundantly
    // prefixed request to it must not be redirected onto that 404.
    await expect(
      defaultLocaleRouteExists("/services/no-such-service"),
    ).resolves.toBe(false);
    await expect(defaultLocaleRouteExists("/blog/no-such-article")).resolves.toBe(
      false,
    );
  });

  it("rejects unknown and over-deep paths", async () => {
    await expect(defaultLocaleRouteExists("/nothing-here")).resolves.toBe(false);
    await expect(defaultLocaleRouteExists("/portfolio/extra")).resolves.toBe(
      false,
    );
    await expect(defaultLocaleRouteExists("/blog/one/two")).resolves.toBe(false);
  });

  it("does not treat a public asset directory as a route", async () => {
    await expect(defaultLocaleRouteExists("/gallery")).resolves.toBe(false);
  });
});
