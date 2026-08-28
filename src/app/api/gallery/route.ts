/**
 * The gallery continuation endpoint: one fixed GET route.
 *
 * ADR-0003 decision 8 makes the continuation control a real link that renders a
 * bounded page on its own. This endpoint is the progressive enhancement on top
 * of it (AB#72): the same slice, as data, so the grid can append in place
 * instead of navigating. The link keeps working with no JavaScript, and nothing
 * here is required for a visitor to reach any part of a gallery.
 *
 * A Route Handler rather than a Server Action, on the framework's own advice:
 * Server Actions are for mutations and are queued, which makes them the wrong
 * shape for reading a page of results.
 *
 * Only `GET` is exported, so every other method is refused before any of this
 * runs. Two things bound what it can be pointed at: the path is resolved
 * through the same resolver the page render uses, so only a route this
 * deployment publishes can be named, and the cursor is validated by the gallery
 * adapter, which alone holds the signing key.
 *
 * The response is public data — the identical items the server would have
 * rendered — but it is answered `no-store` all the same. What may be cached,
 * for how long, and how it is invalidated is AB#83's decision for the whole
 * site, and an endpoint that guessed ahead of it would be the thing that has to
 * be corrected later.
 */

import {
  GalleryCursorError,
  GalleryOrderingStaleError,
  UnknownGallerySectionError,
  getGalleryPage,
} from "@/lib/gallery";
import { MAX_GALLERY_CURSOR_LENGTH } from "@/lib/gallery-pagination";
import { resolveGalleryRequestTarget } from "@/lib/gallery-request";
import { projectGallerySlice } from "@/lib/gallery-slice-server";
import { isCarryableRequestPath } from "@/lib/request-path";

/**
 * `node:crypto` signs and verifies the cursor, and ADR-0004 §2 pins the runtime
 * for the whole application rather than leaving it to a platform default.
 */
export const runtime = "nodejs";

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      // See the module comment: caching policy is AB#83's, site-wide.
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Refuses a request a browser was made to send from another site.
 *
 * Not authentication — any non-browser client sends whatever `Origin` it likes,
 * and this data is public anyway. It exists so this endpoint cannot be used as
 * a same-origin-shaped side channel from another page, and so the site's own
 * fetch is the only browser caller. The response carries no CORS headers, so a
 * cross-origin script could not read it even if it provoked one.
 */
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  // A same-origin `fetch` in a browser omits `Origin` on GET, so its absence is
  // normal rather than suspicious; a cross-origin one always sends it.
  if (origin === null) return true;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function GET(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) {
    return jsonResponse({ status: "rejected", reason: "cross-origin" }, 403);
  }

  const url = new URL(request.url);
  const paths = url.searchParams.getAll("path");
  const cursors = url.searchParams.getAll("cursor");
  const sections = url.searchParams.getAll("section");
  const [path] = paths;
  const [cursor] = cursors;
  // Zero values means the unfiltered view; more than one is ambiguous the same
  // way a repeated `path` or `cursor` is.
  const [section] = sections;

  if (
    paths.length !== 1 ||
    cursors.length !== 1 ||
    sections.length > 1 ||
    path === undefined ||
    !isCarryableRequestPath(path) ||
    cursor === undefined ||
    cursor.length === 0 ||
    cursor.length > MAX_GALLERY_CURSOR_LENGTH
  ) {
    return jsonResponse({ status: "rejected", reason: "invalid-request" }, 400);
  }

  const target = await resolveGalleryRequestTarget(path);
  if (target === undefined) {
    return jsonResponse({ status: "not-found" }, 404);
  }

  try {
    const page = await getGalleryPage(
      target.locale,
      target.contentId,
      cursor,
      section,
    );
    if (page === undefined) {
      return jsonResponse({ status: "not-found" }, 404);
    }

    return jsonResponse(projectGallerySlice(page), 200);
  } catch (error) {
    // A token that is malformed, tampered with, scoped to another query, or
    // stale names no slice of this gallery, and an unresolvable section names
    // none either — the same answer the `?cursor=` route gives, for the same
    // reason.
    if (
      error instanceof GalleryCursorError ||
      error instanceof UnknownGallerySectionError
    ) {
      return jsonResponse({ status: "not-found" }, 404);
    }
    // A seeded-random gallery mid-recompute (AB#129, ADR-0009). Unlike the page
    // route — which cannot set a status from a render — this Route Handler can,
    // so it gives the honest one: 503 + `Retry-After`, retryable, indexes
    // nothing. The append control retries a failed continuation on its own.
    if (error instanceof GalleryOrderingStaleError) {
      return Response.json(
        { status: "unavailable", reason: "reordering" },
        {
          status: 503,
          headers: { "Cache-Control": "no-store", "Retry-After": "120" },
        },
      );
    }
    throw error;
  }
}
