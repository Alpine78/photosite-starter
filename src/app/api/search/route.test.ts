import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildLocaleRouteConfig } from "@/lib/locale-routes";
import { EMPTY_SITE_SEARCH_RESPONSE } from "@/lib/site-search-types";

const search = vi.hoisted(() => ({ searchSite: vi.fn() }));

vi.mock("@/lib/site-search", () => ({
  SITE_SEARCH_DIALOG_LIMIT: 5,
  searchSite: search.searchSite,
}));

vi.mock("@/lib/deployment-config", () => ({
  getDeploymentConfig: () => ({
    localeRoutes: buildLocaleRouteConfig({
      locales: [
        { locale: "fi", prefix: null, storyNamespace: "tarinat" },
        { locale: "en-GB", prefix: "en", storyNamespace: "stories" },
      ],
      reservedRootSegments: [],
      reservedLocaleRouteSegments: [],
    }),
  }),
}));

import { POST } from "@/app/api/search/route";

const ENDPOINT = "https://studio.example/api/search";

function searchRequest({
  body = JSON.stringify({ q: "rally", lang: "fi" }),
  contentType = "application/json",
  origin = "https://studio.example",
}: {
  body?: string;
  contentType?: string;
  origin?: string | null;
} = {}): Request {
  return new Request(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": contentType,
      host: "studio.example",
      ...(origin === null ? {} : { origin }),
    },
    body,
  });
}

beforeEach(() => {
  search.searchSite.mockReset();
  search.searchSite.mockResolvedValue(EMPTY_SITE_SEARCH_RESPONSE);
  vi.restoreAllMocks();
});

describe("POST /api/search", () => {
  it("answers a valid query with the grouped results, uncached", async () => {
    const response = await POST(searchRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(await response.json()).toEqual({
      status: "ok",
      results: EMPTY_SITE_SEARCH_RESPONSE,
    });
    expect(search.searchSite).toHaveBeenCalledWith({
      rawQuery: "rally",
      locale: "fi",
      limit: 5,
    });
  });

  it("normalizes the language to the configured locale", async () => {
    await POST(searchRequest({ body: JSON.stringify({ q: "rally", lang: "en-gb" }) }));
    expect(search.searchSite).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "en-GB" }),
    );
  });

  it("refuses another origin, a missing origin, and a non-JSON body without searching", async () => {
    for (const request of [
      searchRequest({ origin: "https://evil.example" }),
      searchRequest({ origin: null }),
    ]) {
      expect((await POST(request)).status).toBe(403);
    }
    expect((await POST(searchRequest({ contentType: "text/plain" }))).status).toBe(415);
    expect(search.searchSite).not.toHaveBeenCalled();
  });

  it("refuses an oversized, malformed, or mis-shaped body", async () => {
    const huge = JSON.stringify({ q: "x".repeat(2000), lang: "fi" });
    expect((await POST(searchRequest({ body: huge }))).status).toBe(413);
    for (const body of [
      "not json",
      "[]",
      "null",
      JSON.stringify({ q: "rally" }),
      JSON.stringify({ q: "rally", lang: "fi", extra: "x" }),
      JSON.stringify({ q: 5, lang: "fi" }),
      JSON.stringify({ q: "rally", lang: null }),
    ]) {
      expect((await POST(searchRequest({ body }))).status).toBe(400);
    }
    expect(search.searchSite).not.toHaveBeenCalled();
  });

  it("refuses a language the deployment does not route", async () => {
    const response = await POST(
      searchRequest({ body: JSON.stringify({ q: "rally", lang: "sv" }) }),
    );
    expect(response.status).toBe(422);
    expect(search.searchSite).not.toHaveBeenCalled();
  });

  it("answers an unavailable index generically and never logs the term", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    search.searchSite.mockRejectedValue(new Error("content store timed out"));
    const response = await POST(
      searchRequest({ body: JSON.stringify({ q: "secret-term", lang: "fi" }) }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
    expect(JSON.stringify(error.mock.calls)).not.toContain("secret-term");
  });
});
