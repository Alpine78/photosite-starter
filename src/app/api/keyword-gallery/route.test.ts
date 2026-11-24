import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";
import { getDeploymentConfig } from "@/lib/deployment-config";
import { createKeywordGalleryCursorCodec } from "@/lib/keyword-gallery";
import { resolveKeywordGalleryRoute, type KeywordGalleryStore } from "@/lib/keyword-gallery-route";
import { buildSearchPath } from "@/lib/locale-routes";
import { createMockKeywordGallerySource, getMockKeywordVocabulary } from "@/lib/mock-keyword-gallery";

const fixture = vi.hoisted(() => ({ store: undefined as KeywordGalleryStore | undefined }));
vi.mock("@/lib/deployment-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/deployment-config")>();
  const config = actual.loadDeploymentConfig({
    SITE_DEPLOYMENT_STAGE: "preview",
    SITE_CONTENT_SOURCE: "mock",
    SITE_LOCALE: "en-GB",
    SITE_LOCALE_ROUTES: "en-GB||stories",
    SITE_CANONICAL_BASE_URL: "https://site.example",
    SITE_DEFAULT_SOCIAL_IMAGE: "/gallery/coastal-landscape.1683eecb7e65.webp",
    SITE_DEFAULT_SOCIAL_IMAGE_WIDTH: "1536",
    SITE_DEFAULT_SOCIAL_IMAGE_HEIGHT: "1024",
  });
  return { ...actual, getDeploymentConfig: () => config };
});

vi.mock("@/lib/keyword-gallery-route", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/keyword-gallery-route")>();
  return {
    ...actual,
    resolveKeywordGalleryRoute: (locale: string, keywords: string, cursor?: string) =>
      actual.resolveKeywordGalleryRoute(locale, keywords, cursor, fixture.store),
  };
});

const origin = "https://site.example";
const { localeRoutes } = getDeploymentConfig();
const { defaultLocale } = localeRoutes;
const galleryPath = `${buildSearchPath(localeRoutes, defaultLocale)}?keywords=archive`;
const codec = createKeywordGalleryCursorCodec("k".repeat(32));

function request(cursor: string, path = galleryPath, headers?: HeadersInit): Request {
  const params = new URLSearchParams({ cursor, path });
  return new Request(`${origin}/api/keyword-gallery?${params}`, { headers });
}

function store(): KeywordGalleryStore {
  const locale = defaultLocale.split("-")[0];
  return {
    readVocabulary: vi.fn(async () => getMockKeywordVocabulary(locale)),
    source: vi.fn(() => createMockKeywordGallerySource(locale)),
    cursorCodec: codec,
  };
}

afterEach(() => { fixture.store = undefined; });

describe("GET /api/keyword-gallery", () => {
  it("continues a valid same-origin gallery and returns only the public slice", async () => {
    fixture.store = store();
    const first = await resolveKeywordGalleryRoute(defaultLocale, "archive", undefined);
    const response = await GET(request(first!.page.page.endCursor!, galleryPath, { origin }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(Object.keys(body).sort()).toEqual(["items", "nextCursor", "slides"]);
    expect(body.items).toHaveLength(6);
    expect(body.slides).toHaveLength(6);
    expect(body.nextCursor).toBeNull();
  });

  it("returns a no-store 404 without a source read when the cursor signature differs", async () => {
    fixture.store = store();
    const first = await resolveKeywordGalleryRoute(defaultLocale, "archive", undefined);
    const unauthenticatedStore = store();
    fixture.store = { ...unauthenticatedStore, cursorCodec: createKeywordGalleryCursorCodec("x".repeat(32)) };

    const response = await GET(request(first!.page.page.endCursor!));

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "not-found" });
    expect(unauthenticatedStore.readVocabulary).not.toHaveBeenCalled();
    expect(unauthenticatedStore.source).not.toHaveBeenCalled();
  });

  it.each([
    [galleryPath, { origin: "https://other.example" }, 403, "cross-origin"],
    [`${galleryPath}&enquire=example`, undefined, 400, "invalid-request"],
  ])("refuses an invalid envelope before calling the store", async (path, headers, status, reason) => {
    const unusedStore = store();
    fixture.store = unusedStore;
    const response = await GET(request("cursor", path, headers));
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "rejected", reason });
    expect(unusedStore.readVocabulary).not.toHaveBeenCalled();
  });
});
