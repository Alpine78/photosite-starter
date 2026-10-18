import "server-only";

type Environment = Readonly<Record<string, string | undefined>>;

/** Independent of normal deployment/CMS configuration; invalid attempts fail closed. */
export function readSiteMaintenanceMode(environment: Environment): "off" | "on" | "invalid" {
  const mirror = environment.NEXT_PUBLIC_SITE_MAINTENANCE_MODE;
  const raw = environment.SITE_MAINTENANCE_MODE;
  if ((mirror !== undefined && (mirror.length > 32 || mirror.trim())) || (raw !== undefined && raw.length > 32)) return "invalid";
  const mode = raw?.trim();
  if (!mode || mode === "off") return "off";
  return mode === "on" ? "on" : "invalid";
}

const MAINTENANCE_HTML = `<!doctype html><html lang="fi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Huoltotauko / Temporarily unavailable</title></head><body><main><h1>Tilapäinen huoltotauko</h1><p>Palvelu on tilapäisesti poissa käytöstä. Yritä hetken kuluttua uudelleen.</p><section lang="en" aria-labelledby="maintenance-en"><h2 id="maintenance-en">Temporarily unavailable</h2><p>The site is temporarily unavailable. Please try again shortly.</p></section></main></body></html>`;

export const MAINTENANCE_HYGIENE_HEADERS = {
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
} as const;

/** No settings, request values, cookies or external assets enter this response. */
export function siteMaintenanceResponse(method: string, api: boolean): Response {
  return new Response(method === "HEAD" ? null : api
    ? JSON.stringify({ status: "failed", retryable: true })
    : MAINTENANCE_HTML, {
    status: 503,
    headers: {
      ...MAINTENANCE_HYGIENE_HEADERS,
      "content-type": api ? "application/json; charset=utf-8" : "text/html; charset=utf-8",
      "retry-after": "60",
    },
  });
}
