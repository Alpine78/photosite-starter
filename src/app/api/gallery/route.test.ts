import { beforeEach, describe, expect, it, vi } from "vitest";
import { GalleryCursorError } from "@/lib/gallery-pagination";

const dependencies = vi.hoisted(() => ({
  resolveTarget: vi.fn(),
  getGalleryPage: vi.fn(),
  projectSlice: vi.fn(),
}));

vi.mock("@/lib/gallery-request", () => ({
  resolveGalleryRequestTarget: dependencies.resolveTarget,
}));

vi.mock("@/lib/gallery", async () => {
  const { GalleryCursorError: CursorError } = await vi.importActual<
    typeof import("@/lib/gallery-pagination")
  >("@/lib/gallery-pagination");

  return {
    GalleryCursorError: CursorError,
    getGalleryPage: dependencies.getGalleryPage,
  };
});

vi.mock("@/lib/gallery-slice-server", () => ({
  projectGallerySlice: dependencies.projectSlice,
}));

import { GET } from "@/app/api/gallery/route";

const ENDPOINT = "https://studio.example/api/gallery";
const PATH = "/stories/portfolio/large-archive";
const CURSOR = "bounded-valid-looking-cursor";
const PAGE = {
  items: [],
  page: { size: 24, hasNextPage: false, endCursor: null },
};
const SLICE = { items: [], slides: [], nextCursor: null };

function galleryRequest({
  paths = [PATH],
  cursors = [CURSOR],
  origin,
}: {
  paths?: readonly string[];
  cursors?: readonly string[];
  origin?: string;
} = {}): Request {
  const url = new URL(ENDPOINT);
  for (const path of paths) url.searchParams.append("path", path);
  for (const cursor of cursors) url.searchParams.append("cursor", cursor);

  return new Request(url, {
    headers: origin === undefined ? {} : { origin },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  dependencies.resolveTarget.mockReset();
  dependencies.getGalleryPage.mockReset();
  dependencies.projectSlice.mockReset();

  dependencies.resolveTarget.mockResolvedValue({
    locale: "en-GB",
    contentId: "content-large-archive",
  });
  dependencies.getGalleryPage.mockResolvedValue(PAGE);
  dependencies.projectSlice.mockReturnValue(SLICE);
});

describe("GET /api/gallery", () => {
  it("answers one bounded projected slice without caching it", async () => {
    const response = await GET(galleryRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(SLICE);
    expect(dependencies.resolveTarget).toHaveBeenCalledWith(PATH);
    expect(dependencies.getGalleryPage).toHaveBeenCalledWith(
      "en-GB",
      "content-large-archive",
      CURSOR,
    );
    expect(dependencies.projectSlice).toHaveBeenCalledWith(PAGE);
  });

  it("allows an explicit same-origin browser request", async () => {
    expect(
      (await GET(galleryRequest({ origin: "https://studio.example" }))).status,
    ).toBe(200);
  });

  it("refuses a browser request from another origin before resolving content", async () => {
    const response = await GET(
      galleryRequest({ origin: "https://attacker.example" }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      status: "rejected",
      reason: "cross-origin",
    });
    expect(dependencies.resolveTarget).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing path", { paths: [] }],
    ["a repeated path", { paths: [PATH, PATH] }],
    ["a missing cursor", { cursors: [] }],
    ["a repeated cursor", { cursors: [CURSOR, CURSOR] }],
    ["an empty cursor", { cursors: [""] }],
    ["an oversized cursor", { cursors: ["x".repeat(2049)] }],
    ["a protocol-relative path", { paths: ["//attacker.example/gallery"] }],
  ])("refuses %s as an invalid request", async (_case, request) => {
    const response = await GET(galleryRequest(request));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      status: "rejected",
      reason: "invalid-request",
    });
    expect(dependencies.resolveTarget).not.toHaveBeenCalled();
  });

  it("answers 404 when the path names no canonical published gallery", async () => {
    dependencies.resolveTarget.mockResolvedValueOnce(undefined);

    const response = await GET(galleryRequest());

    expect(response.status).toBe(404);
    expect(dependencies.getGalleryPage).not.toHaveBeenCalled();
  });

  it("answers 404 when the gallery source no longer serves the result", async () => {
    dependencies.getGalleryPage.mockResolvedValueOnce(undefined);

    const response = await GET(galleryRequest());

    expect(response.status).toBe(404);
    expect(dependencies.projectSlice).not.toHaveBeenCalled();
  });

  it("answers 404 for a malformed, tampered, wrong-scope, or stale cursor", async () => {
    dependencies.getGalleryPage.mockRejectedValueOnce(
      new GalleryCursorError("tampered"),
    );

    const response = await GET(galleryRequest());

    expect(response.status).toBe(404);
    expect(dependencies.projectSlice).not.toHaveBeenCalled();
  });

  it("does not disguise an unexpected adapter failure as a missing slice", async () => {
    dependencies.getGalleryPage.mockRejectedValueOnce(
      new Error("synthetic adapter failure"),
    );

    await expect(GET(galleryRequest())).rejects.toThrow(
      "synthetic adapter failure",
    );
  });
});
