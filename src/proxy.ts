import { NextResponse, type NextRequest } from "next/server";
import {
  REQUEST_HAS_CURSOR_HEADER,
  REQUEST_HAS_CURSOR_VALUE,
  REQUEST_PATH_HEADER,
  isCarryableRequestPath,
} from "@/lib/request-path";

/**
 * The project's Proxy (Next.js 16's name for what was Middleware).
 *
 * It does exactly one thing: copy the requested pathname into a project-owned
 * request header so a `not-found.tsx` boundary can know which address was
 * refused. App Router gives that boundary no props and renders it before the
 * page, so there is no in-tree way to tell it (ADR-0007).
 *
 * ## What it deliberately does not do
 *
 * This runs on every matched request, so its cost is the site's cost. It is
 * O(1) and stays that way:
 *
 * - **No query string, and no cursor value.** A continuation token is a signed
 *   value whose only legitimate reader is the gallery adapter, and copying it
 *   into a header would spread it across a layer with no business holding it.
 *   What is carried instead is one bit — whether a `cursor` parameter was
 *   present — because the 404 needs to know why an address was refused, not what
 *   was in it. Without that bit a gallery whose *content* failed to load would
 *   be offered a link straight back to the address that just failed.
 * - **No content, config, or adapter reads.** Deciding whether that path is a
 *   published gallery is the boundary's job, on the rare 404, not this one's on
 *   every request.
 * - **No secrets.** The signing key is server-only and lazily resolved; nothing
 *   here touches it.
 *
 * ## Trust
 *
 * The header is unconditionally overwritten, never merged or defaulted. A
 * visitor may send `x-photosite-request-path` themselves; `Headers.set` replaces
 * any such value (case-insensitively, per the Headers contract), so what reaches
 * the application is this function's value and not the client's. The reader
 * validates it a second time, because paths excluded by the matcher below never
 * pass through here at all.
 */
export function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  const { pathname } = request.nextUrl;

  if (isCarryableRequestPath(pathname)) {
    requestHeaders.set(REQUEST_PATH_HEADER, pathname);
  } else {
    // An unusable path leaves no header rather than a partial one, so the
    // boundary sees "nothing was carried" instead of a truncated path that
    // could name a different real route.
    requestHeaders.delete(REQUEST_PATH_HEADER);
  }

  // Presence only, never the value, and always overwritten for the same reason
  // the path is.
  if (request.nextUrl.searchParams.has("cursor")) {
    requestHeaders.set(REQUEST_HAS_CURSOR_HEADER, REQUEST_HAS_CURSOR_VALUE);
  } else {
    requestHeaders.delete(REQUEST_HAS_CURSOR_HEADER);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

/**
 * Only the routes that can render a content 404.
 *
 * Excluded, because none of them renders the not-found boundary and every one
 * of them would just pay the cost: the contact endpoint and any other API route,
 * Next's own build output and image optimizer, and every static asset — which is
 * what the final clause matches, since a public file always carries an
 * extension and a content route never does.
 */
export const config = {
  matcher: ["/((?!api/|_next/|.*\\.[^/]*$).*)"],
};
