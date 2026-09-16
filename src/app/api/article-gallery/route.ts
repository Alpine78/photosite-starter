/** Progressive enhancement endpoint for one bounded article end-gallery slice. */

import {
  GalleryCursorError,
  getArticleEndGalleryPage,
} from "@/lib/article-end-gallery";
import { resolveArticleEndGalleryRequestTarget } from "@/lib/article-end-gallery-request";
import { MAX_GALLERY_CURSOR_LENGTH } from "@/lib/gallery-pagination";
import { projectGallerySlice } from "@/lib/gallery-slice-server";
import { isCarryableRequestPath } from "@/lib/request-path";

export const runtime = "nodejs";

function response(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function GET(request: Request): Promise<Response> {
  if (!sameOrigin(request)) {
    return response({ status: "rejected", reason: "cross-origin" }, 403);
  }
  const url = new URL(request.url);
  const paths = url.searchParams.getAll("path");
  const cursors = url.searchParams.getAll("cursor");
  const [path] = paths;
  const [cursor] = cursors;
  if (
    [...url.searchParams.keys()].some(
      (key) => key !== "path" && key !== "cursor",
    ) ||
    paths.length !== 1 ||
    cursors.length !== 1 ||
    path === undefined ||
    !isCarryableRequestPath(path) ||
    cursor === undefined ||
    cursor.length === 0 ||
    cursor.length > MAX_GALLERY_CURSOR_LENGTH
  ) {
    return response({ status: "rejected", reason: "invalid-request" }, 400);
  }
  const target = await resolveArticleEndGalleryRequestTarget(path);
  if (target === undefined) return response({ status: "not-found" }, 404);
  try {
    const page = await getArticleEndGalleryPage(
      target.locale,
      target.contentId,
      target.endGalleryId,
      cursor,
    );
    return page === undefined
      ? response({ status: "not-found" }, 404)
      : response(projectGallerySlice(page), 200);
  } catch (error) {
    if (error instanceof GalleryCursorError) {
      return response({ status: "not-found" }, 404);
    }
    throw error;
  }
}
