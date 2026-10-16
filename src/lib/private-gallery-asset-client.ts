/** Browser-side Stage 1 only. Object bytes use native image/download requests. */
export type PrivateGalleryClientAssetRequest =
  | { readonly kind: "preview"; readonly placementId: string }
  | { readonly kind: "zip" };

export type PrivateGalleryClientAssetUrl = {
  readonly url: string;
  readonly expiresAt: number;
};

function unavailable(): never {
  // No provider response, signed URL, identifier or credential in an error.
  throw new Error("private-asset-unavailable");
}

/** Pure validation; server/store expiry remains authoritative after navigation. */
export function parsePrivateGalleryClientAssetUrl(
  value: unknown,
  origin: string,
  now: number,
): PrivateGalleryClientAssetUrl {
  if (typeof value !== "object" || value === null || Array.isArray(value)) unavailable();
  const body = value as Record<string, unknown>;
  if (body.ok !== true || typeof body.url !== "string" || body.url.length > 16_384 ||
      typeof body.expiresAt !== "string" || body.expiresAt.length > 64) unavailable();
  const expiresAt = Date.parse(body.expiresAt);
  if (!Number.isFinite(now) || !Number.isFinite(expiresAt) || expiresAt <= now) unavailable();
  let url: URL;
  try {
    url = new URL(body.url);
  } catch {
    unavailable();
  }
  if (url.username !== "" || url.password !== "" || url.hash !== "" ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && url.origin === origin))) unavailable();
  return { url: url.href, expiresAt };
}

/** Mint through the existing same-origin authorization endpoint, never the store. */
export async function requestPrivateGalleryClientAssetUrl(
  assetPath: string,
  request: PrivateGalleryClientAssetRequest,
  signal: AbortSignal,
  origin: string,
): Promise<PrivateGalleryClientAssetUrl> {
  const endpoint = new URL(assetPath, origin);
  if (endpoint.origin !== origin || endpoint.username !== "" || endpoint.password !== "" ||
      endpoint.hash !== "") unavailable();
  const response = await fetch(endpoint.href, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(request),
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    signal,
  });
  if (!response.ok) unavailable();
  // HTTP Date is server-issued and avoids rejecting a fresh five-minute URL
  // because the visitor's clock is fast. The local clock is only a fallback
  // for environments that omit that header (including test adapters).
  const serverNow = Date.parse(response.headers.get("date") ?? "");
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    unavailable();
  }
  return parsePrivateGalleryClientAssetUrl(body, origin,
    Number.isFinite(serverNow) ? serverNow : Date.now());
}
