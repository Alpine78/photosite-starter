import { headers } from "next/headers";
import Link from "next/link";
import { getBuiltInLabels } from "@/lib/deployment-config";
import { getNotFoundReturn } from "@/lib/not-found-return";
import { REQUEST_PATH_HEADER, readRequestPath } from "@/lib/request-path";

/**
 * The 404 for the public content route space.
 *
 * Identical to the plain `RouteNotFound` except that it can offer a way back.
 * ADR-0003 decision 8 requires the 404 for an invalid gallery cursor to link to
 * that gallery's parameter-free first page: the visitor is holding a
 * continuation URL that has gone stale, and the first page is where they were
 * trying to be. The refused address arrives as a request header from the Proxy
 * (ADR-0007), because App Router renders this boundary with no props and
 * renders it before the page that refused the request.
 *
 * It is a separate component from `RouteNotFound` rather than a flag on it, and
 * that separation is load-bearing: reading `headers()` is a dynamic API, so a
 * boundary that reads one opts every route beneath it out of static rendering.
 * Confining it here keeps that cost where it is already paid — the content
 * routes are dynamic anyway, because they read `searchParams` — and leaves the
 * static routes in `(default)` prerendered.
 *
 * A link appears only when the refused path resolves to a published gallery.
 * Anything else keeps the bare 404, because a guessed destination would lead
 * from this 404 to another. Next.js marks the response `noindex` itself.
 */
export async function ContentRouteNotFound() {
  const requestPath = readRequestPath(
    (await headers()).get(REQUEST_PATH_HEADER),
  );
  const back = await getNotFoundReturn(requestPath);

  return (
    <main className="mx-auto flex min-h-[50vh] max-w-6xl flex-col items-center justify-center gap-6 px-4 py-20 sm:px-6">
      <h1 className="text-5xl font-semibold tracking-tight">404</h1>
      {back !== undefined && (
        <Link
          href={back.href}
          className="text-sm underline underline-offset-4 transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {getBuiltInLabels(back.locale).gallery.backToStart}
        </Link>
      )}
    </main>
  );
}
