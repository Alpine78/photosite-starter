import { beforeEach, describe, expect, it, vi } from "vitest";
import { GalleryCursorError } from "@/lib/gallery-pagination";

const dependencies = vi.hoisted(() => ({
  resolveTarget: vi.fn(),
  getPage: vi.fn(),
  projectSlice: vi.fn(),
}));

vi.mock("@/lib/article-end-gallery-request", () => ({
  resolveArticleEndGalleryRequestTarget: dependencies.resolveTarget,
}));
vi.mock("@/lib/article-end-gallery", async () => {
  const actual = await vi.importActual<typeof import("@/lib/gallery-pagination")>(
    "@/lib/gallery-pagination",
  );
  return { GalleryCursorError: actual.GalleryCursorError, getArticleEndGalleryPage: dependencies.getPage };
});
vi.mock("@/lib/gallery-slice-server", () => ({
  projectGallerySlice: dependencies.projectSlice,
}));

import { GET } from "@/app/api/article-gallery/route";

const path = "/stories/notes/one";
const cursor = "opaque-cursor";
function request(query = `path=${encodeURIComponent(path)}&cursor=${cursor}`, origin?: string) {
  return new Request(`https://site.example/api/article-gallery?${query}`, {
    headers: origin === undefined ? {} : { origin },
  });
}

beforeEach(() => {
  dependencies.resolveTarget.mockReset().mockResolvedValue({
    locale: "en-GB",
    contentId: "article-one",
    endGalleryId: "ending-one",
  });
  dependencies.getPage.mockReset().mockResolvedValue({
    items: [],
    page: { size: 24, hasNextPage: false, endCursor: null },
  });
  dependencies.projectSlice.mockReset().mockReturnValue({
    items: [], slides: [], nextCursor: null,
  });
});

describe("GET /api/article-gallery", () => {
  it("returns one no-store projected slice", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(dependencies.getPage).toHaveBeenCalledWith(
      "en-GB", "article-one", "ending-one", cursor,
    );
  });

  it.each([
    ["missing path", `cursor=${cursor}`],
    ["repeated cursor", `path=${encodeURIComponent(path)}&cursor=a&cursor=b`],
    ["empty cursor", `path=${encodeURIComponent(path)}&cursor=`],
    ["unknown field", `path=${encodeURIComponent(path)}&cursor=${cursor}&section=x`],
    ["unsafe path", `path=${encodeURIComponent("//attacker.example/x")}&cursor=${cursor}`],
  ])("rejects %s", async (_label, query) => {
    const response = await GET(request(query));
    expect(response.status).toBe(400);
    expect(dependencies.resolveTarget).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin browser request before content lookup", async () => {
    const response = await GET(request(undefined, "https://attacker.example"));
    expect(response.status).toBe(403);
    expect(dependencies.resolveTarget).not.toHaveBeenCalled();
  });

  it("returns 404 without exposing cursor failure details", async () => {
    dependencies.getPage.mockRejectedValue(new GalleryCursorError("tampered"));
    const response = await GET(request());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ status: "not-found" });
  });
});
