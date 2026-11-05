/**
 * Keyword suggestions behind the selector (AB#74). `POST`, like the site search and for the same
 * reason: a typed term in a URL lands in browser history and hosting logs. It reads the cached
 * index and makes no upstream request on a warm cache. Nothing is stored and no term is logged.
 */

import { CONTACT_REJECTION_STATUS, checkContactRequestHeaders, jsonNoStore, readBoundedBody } from "@/lib/contact-request";
import { getDeploymentConfig } from "@/lib/deployment-config";
import { getKeywordIndexWithinBudget } from "@/lib/keyword-index-access";
import { suggestKeywords } from "@/lib/keyword-suggest";
import { getLocaleRoute } from "@/lib/locale-routes";

export const runtime = "nodejs";

/** A query of at most 100 characters, at most four bytes each, plus the envelope. */
const REQUEST_MAX_BYTES = 1024;

function isEnvelope(value: unknown): value is { readonly q: string; readonly lang: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 2 && keys.includes("q") && keys.includes("lang") && Object.values(value).every((entry) => typeof entry === "string");
}

function rejected(reason: keyof typeof CONTACT_REJECTION_STATUS | "invalid-locale"): Response {
  return jsonNoStore({ status: "rejected", reason }, reason === "invalid-locale" ? 422 : CONTACT_REJECTION_STATUS[reason]);
}

export async function POST(request: Request): Promise<Response> {
  const headerRejection = checkContactRequestHeaders(request);
  if (headerRejection !== undefined) return rejected(headerRejection);
  const body = await readBoundedBody(request, REQUEST_MAX_BYTES);
  if (body === undefined) return rejected("payload-too-large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return rejected("malformed-body");
  }
  if (!isEnvelope(parsed)) return rejected("malformed-body");
  const route = getLocaleRoute(getDeploymentConfig().localeRoutes, parsed.lang);
  if (route === undefined) return rejected("invalid-locale");
  try {
    return jsonNoStore({ status: "ok", suggestions: suggestKeywords(await getKeywordIndexWithinBudget(route.locale), parsed.q) }, 200);
  } catch (error) {
    console.error("[keyword-suggest] unavailable", error instanceof Error ? `${error.name}: ${error.message}` : "unknown error");
    return jsonNoStore({ status: "unavailable" }, 503);
  }
}
