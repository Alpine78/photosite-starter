/**
 * The site-search endpoint behind the dialog (ADR-0033).
 *
 * `POST`, not `GET`, on purpose: a search term in a URL lands in browser
 * history, hosting request logs, and `Referer`, none of which the visitor
 * chose. In a JSON body it appears in none of them. Only `POST` is exported, so
 * the framework refuses every other method before any of this runs.
 *
 * The posture is the contact endpoint's (ADR-0004 §5): headers decide first and
 * cost nothing, the body is read only to a small byte bound, the answer is
 * never cacheable and carries no CORS headers. Nothing is stored and no search
 * term is logged — not on success, and not when the read fails: the failure
 * record carries the error's class and message, which describe the content
 * store and never the query.
 *
 * There is no application rate limit. A search reads the cached story index in
 * memory and makes no upstream request on a warm cache, so a flood of distinct
 * terms costs CPU on bounded input rather than quota; the platform firewall
 * stays the defence in depth above it, and ADR-0033 names the trigger for
 * adding one.
 */

import {
  CONTACT_REJECTION_STATUS,
  checkContactRequestHeaders,
  jsonNoStore,
  readBoundedBody,
} from "@/lib/contact-request";
import { getDeploymentConfig } from "@/lib/deployment-config";
import { getLocaleRoute } from "@/lib/locale-routes";
import { SITE_SEARCH_DIALOG_LIMIT, searchSite } from "@/lib/site-search";

export const runtime = "nodejs";

/**
 * The body is `{"q": …, "lang": …}`. A query is at most
 * `SEARCH_MAX_QUERY_CHARACTERS` (100) characters, at most four bytes each in
 * UTF-8, so this leaves room for the envelope and nothing more. Anything larger
 * is not a search and is refused without being parsed.
 */
const SEARCH_REQUEST_MAX_BYTES = 1024;

function isSearchEnvelope(
  value: unknown,
): value is { readonly q: string; readonly lang: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return (
    keys.length === 2 &&
    keys.includes("q") &&
    keys.includes("lang") &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function rejected(reason: keyof typeof CONTACT_REJECTION_STATUS | "invalid-locale"): Response {
  const status = reason === "invalid-locale" ? 422 : CONTACT_REJECTION_STATUS[reason];
  return jsonNoStore({ status: "rejected", reason }, status);
}

export async function POST(request: Request): Promise<Response> {
  const headerRejection = checkContactRequestHeaders(request);
  if (headerRejection !== undefined) return rejected(headerRejection);

  const body = await readBoundedBody(request, SEARCH_REQUEST_MAX_BYTES);
  if (body === undefined) return rejected("payload-too-large");

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return rejected("malformed-body");
  }
  if (!isSearchEnvelope(parsed)) return rejected("malformed-body");

  const route = getLocaleRoute(getDeploymentConfig().localeRoutes, parsed.lang);
  if (route === undefined) return rejected("invalid-locale");

  try {
    const results = await searchSite({
      rawQuery: parsed.q,
      locale: route.locale,
      limit: SITE_SEARCH_DIALOG_LIMIT,
    });
    return jsonNoStore({ status: "ok", results }, 200);
  } catch (error) {
    console.error(
      "[site-search] search unavailable",
      error instanceof Error ? `${error.name}: ${error.message}` : "unknown error",
    );
    return jsonNoStore({ status: "unavailable" }, 503);
  }
}
