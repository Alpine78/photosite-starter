import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  RESERVED_LOCALE_ROUTE_SEGMENTS,
  RESERVED_ROOT_SEGMENTS,
  defaultLocaleRouteExists,
} from "@/lib/public-routes";
import { getServices } from "@/lib/services";

/**
 * Literal root segments the App Router serves. Route groups contribute no URL
 * segment, so their children are inspected at the same level; dynamic and
 * private directories claim no literal segment and are skipped.
 */
function readAppRootSegments(directory: string): string[] {
  const appEntries = readdirSync(directory, {
    withFileTypes: true,
  });

  return appEntries.flatMap((entry) => {
    if (entry.isDirectory() && /^\(.+\)$/.test(entry.name)) {
      return readAppRootSegments(join(directory, entry.name));
    }
    if (entry.isDirectory() && !/^[[(_@]/.test(entry.name)) {
      return [entry.name];
    }
    if (entry.isFile() && !/\.(tsx?|css)$/.test(entry.name)) {
      return [entry.name];
    }
    return [];
  });
}

/** Root App Router segments plus public files and asset directories. */
function readRootSegments(): string[] {
  return [
    ...readAppRootSegments(join(process.cwd(), "src/app")),
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

describe("RESERVED_LOCALE_ROUTE_SEGMENTS", () => {
  it("contains localized static routes but excludes root-only assets", () => {
    expect(RESERVED_LOCALE_ROUTE_SEGMENTS).toContain("services");
    expect(RESERVED_LOCALE_ROUTE_SEGMENTS).not.toContain("gallery");
    expect(RESERVED_LOCALE_ROUTE_SEGMENTS).not.toContain("favicon.ico");
  });
});

describe("defaultLocaleRouteExists", () => {
  it("resolves the site root", async () => {
    await expect(defaultLocaleRouteExists("/")).resolves.toBe(true);
  });

  it("resolves the static listing routes", async () => {
    await expect(defaultLocaleRouteExists("/services")).resolves.toBe(true);
    await expect(defaultLocaleRouteExists("/contact")).resolves.toBe(true);
  });

  it("resolves a detail route that has content behind it", async () => {
    const [service] = await getServices();

    await expect(
      defaultLocaleRouteExists(`/services/${service.slug}`),
    ).resolves.toBe(true);
  });

  it("rejects a detail route whose content does not exist", async () => {
    // An unknown slug is a 404 in the default locale, so a redundantly
    // prefixed request to it must not be redirected onto that 404.
    await expect(
      defaultLocaleRouteExists("/services/no-such-service"),
    ).resolves.toBe(false);
  });

  it("rejects unknown and over-deep paths", async () => {
    await expect(defaultLocaleRouteExists("/nothing-here")).resolves.toBe(false);
    await expect(defaultLocaleRouteExists("/contact/extra")).resolves.toBe(
      false,
    );
    await expect(defaultLocaleRouteExists("/services/one/two")).resolves.toBe(
      false,
    );
  });

  it("does not resolve the removed portfolio route", async () => {
    // AB#104 moved the curated gallery into the content tree. ADR-0003's
    // amendment removes a pre-launch route rather than redirecting it, because
    // nobody can be holding a URL that was never deployed or indexed.
    await expect(defaultLocaleRouteExists("/portfolio")).resolves.toBe(false);
  });

  it("does not resolve the removed article scaffold routes", async () => {
    // `/blog` and `/blog/<slug>` were pre-launch scaffold routes that were
    // never deployed or indexed, so AB#124 removed them outright rather than
    // leaving compatibility redirects behind. Articles live at their canonical
    // paths in the story namespace, which this registry never answers for.
    await expect(defaultLocaleRouteExists("/blog")).resolves.toBe(false);
    await expect(
      defaultLocaleRouteExists("/blog/choosing-a-telephoto-lens"),
    ).resolves.toBe(false);
  });

  it("does not treat a public asset directory as a route", async () => {
    await expect(defaultLocaleRouteExists("/gallery")).resolves.toBe(false);
  });
});
