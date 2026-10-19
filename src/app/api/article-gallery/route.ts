/** Progressive enhancement endpoint for one bounded article end-gallery slice. */

import {
  GalleryCursorError,
  getArticleEndGalleryPage,
} from "@/lib/article-end-gallery";
import { resolveArticleEndGalleryRequestTarget } from "@/lib/article-end-gallery-request";
import { resolveArticleEndSection } from "@/lib/article-end-gallery-selection";
import { UnknownGallerySectionError } from "@/lib/gallery-sections";
import { MAX_ITEM_ID_LENGTH } from "@/lib/gallery-pagination";
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
  const sections = url.searchParams.getAll("section");
  const [section] = sections;
  const [path] = paths;
  const [cursor] = cursors;
  if (
    [...url.searchParams.keys()].some(
      (key) => key !== "path" && key !== "cursor" && key !== "section",
    ) ||
    sections.length > 1 ||
    (section !== undefined && (section.length > MAX_ITEM_ID_LENGTH || section === "all" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(section))) ||
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
  const selection = resolveArticleEndSection({ endGallerySections: target.sections }, section);
  if (selection.kind === "not-found" || (section !== undefined && selection.kind !== "selected")) return response({ status: "not-found" }, 404);
  try {
    const page = await getArticleEndGalleryPage(
      target.locale,
      target.contentId,
      target.endGalleryId,
      cursor,
      ...(selection.kind === "selected" ? [selection.section.sectionId] as const : []),
    );
    return page === undefined
      ? response({ status: "not-found" }, 404)
      : response(projectGallerySlice(page), 200);
  } catch (error) {
    if (error instanceof GalleryCursorError || error instanceof UnknownGallerySectionError) {
      return response({ status: "not-found" }, 404);
    }
    throw error;
  }
}
