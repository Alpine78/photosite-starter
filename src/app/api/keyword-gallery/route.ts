/** Progressive enhancement endpoint for one bounded keyword gallery slice (ADR-0012, AB#71). */

import { getDeploymentConfig } from "@/lib/deployment-config";
import { projectGallerySlice } from "@/lib/gallery-slice-server";
import { resolveKeywordGalleryRoute } from "@/lib/keyword-gallery-route";
import { resolveSearchRoute } from "@/lib/locale-routes";

export const runtime = "nodejs";

const MAX_PATH_LENGTH = 1024;

function response(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
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

/**
 * The grid's own `galleryPath`: the search namespace plus exactly one `keywords`. A carried
 * path may hold nothing else, so this can only ever repeat the address the page already
 * validated, in its canonical spelling.
 */
function parseGalleryPath(path: string): { readonly locale: string; readonly keywords: string } | undefined {
  if (path.length > MAX_PATH_LENGTH || !path.startsWith("/") || path.startsWith("//") || /[\\#\s]/u.test(path)) return undefined;
  const [pathname, query, ...rest] = path.split("?");
  if (query === undefined || rest.length > 0) return undefined;
  const params = new URLSearchParams(query);
  const keywords = params.getAll("keywords");
  if (keywords.length !== 1 || [...params.keys()].length !== 1) return undefined;
  const [prefix, ...segments] = pathname.slice(1).split("/");
  const resolved = resolveSearchRoute(getDeploymentConfig().localeRoutes, prefix, segments);
  if (resolved === undefined || resolved.canonicalPath !== undefined) return undefined;
  return { locale: resolved.locale, keywords: keywords[0] };
}

export async function GET(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return response({ status: "rejected", reason: "cross-origin" }, 403);
  const url = new URL(request.url);
  const paths = url.searchParams.getAll("path");
  const cursors = url.searchParams.getAll("cursor");
  if ([...url.searchParams.keys()].some((key) => key !== "path" && key !== "cursor") || paths.length !== 1 || cursors.length !== 1) {
    return response({ status: "rejected", reason: "invalid-request" }, 400);
  }
  const target = parseGalleryPath(paths[0]);
  if (target === undefined) return response({ status: "rejected", reason: "invalid-request" }, 400);
  const route = await resolveKeywordGalleryRoute(target.locale, target.keywords, cursors[0]);
  if (route === undefined || route.redirect) return response({ status: "not-found" }, 404);
  return response(projectGallerySlice(route.page), 200);
}
