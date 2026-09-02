/**
 * AWS Signature Version 4 query-string presigning for one private object
 * (ADR-0014 §5 Stage 2).
 *
 * This is the last step before bytes move: `private-gallery-delivery.ts` decides
 * *whether* a URL may be minted, for which key and for how long, and this turns
 * that authorization into a URL the object store will honour. Nothing here
 * decides anything — handed the wrong key or an unbounded expiry it would
 * faithfully sign both, which is exactly why the decision lives elsewhere.
 *
 * ## Why this is hand-written
 *
 * ADR-0014 §8a: "a small, justified dependency; a full cloud-vendor SDK is not
 * required and is avoided". Presigning is four HMACs and a string concatenation
 * over `node:crypto`; an SDK would bring a credential-provider chain, a retry
 * layer, and a request pipeline this code path wants none of.
 *
 * ## How it is verified
 *
 * The algorithm is implemented from AWS's own specification, and the core —
 * canonical-request hashing, the string to sign, the four-step key derivation,
 * and the final HMAC — is pinned in tests against AWS's **published worked
 * example**, which the test reproduces exactly from its documented inputs to its
 * documented signature. That is a real known-answer test, not the implementation
 * agreeing with itself.
 *
 * What a vector cannot establish is whether *this deployment's* provider accepts
 * the result. ADR-0014 §8a's provisioning gate owns that: "a presigned `GET`
 * minted with the verifier credential succeeds" against the real bucket, along
 * with `Range` on a large object. Until that runs, this is verified against the
 * specification and unverified against the provider — those are different
 * claims and only the first is made here.
 *
 * ## Path-style addressing
 *
 * The URL is `<endpoint>/<bucket>/<key>`. `PRIVATE_GALLERY_S3_ENDPOINT` is a
 * bare provider origin rather than a bucket host, so path-style is what that
 * configuration describes. Virtual-host style (`<bucket>.<endpoint>/<key>`) is a
 * small change if the provider requires it; which one to use is a fact about the
 * provider, so the live gate settles it rather than a guess here.
 */

import { createHash, createHmac } from "node:crypto";

const ALGORITHM = "AWS4-HMAC-SHA256";
const TERMINATOR = "aws4_request";

/**
 * S3's documented payload value for a presigned request: the body is not part
 * of the signature, because a presigned `GET` has none and the signer does not
 * see one.
 */
const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

/** The one header a presigned URL signs. It is what binds the URL to a host. */
const SIGNED_HEADER = "host";

export class PrivateGallerySigningError extends Error {
  constructor(message: string) {
    super(`[private-gallery-signed-url] ${message}`);
    this.name = "PrivateGallerySigningError";
  }
}

function fail(message: string): never {
  throw new PrivateGallerySigningError(message);
}

/**
 * AWS's `UriEncode`: every byte except the unreserved set, uppercase hex, and
 * a space as `%20` rather than `+`.
 *
 * Written out rather than delegated to `encodeURIComponent`, which leaves
 * `!'()*` unencoded — AWS's own guidance is that platform encoders "might not
 * work because of differences in implementation", and a single differing byte
 * changes the canonical request and therefore the signature.
 */
export function uriEncode(value: string): string {
  let out = "";
  for (const byte of Buffer.from(value, "utf8")) {
    const char = String.fromCharCode(byte);
    if (
      (byte >= 0x41 && byte <= 0x5a) || // A-Z
      (byte >= 0x61 && byte <= 0x7a) || // a-z
      (byte >= 0x30 && byte <= 0x39) || // 0-9
      char === "-" ||
      char === "." ||
      char === "_" ||
      char === "~"
    ) {
      out += char;
      continue;
    }
    out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/** The canonical URI: each segment encoded, the separators left alone. */
function canonicalUri(path: string): string {
  return path
    .split("/")
    .map((segment) => uriEncode(segment))
    .join("/");
}

/**
 * The canonical query string: each name and value encoded individually, then
 * sorted by the **encoded** name. Sorting after encoding is the documented
 * order and is not interchangeable with sorting before it.
 */
function canonicalQueryString(
  parameters: ReadonlyArray<readonly [string, string]>,
): string {
  return parameters
    .map(([name, value]) => [uriEncode(name), uriEncode(value)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
}

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac("sha256", key).update(data, "utf8").digest();

/**
 * The four-step derivation: secret → date → region → service → terminator. The
 * result never leaves this module, and the intermediate values are not returned.
 */
export function derivePrivateGallerySigningKey(params: {
  readonly secretAccessKey: string;
  readonly date: string;
  readonly region: string;
  readonly service: string;
}): Buffer {
  const dateKey = hmac(`AWS4${params.secretAccessKey}`, params.date);
  const regionKey = hmac(dateKey, params.region);
  const serviceKey = hmac(regionKey, params.service);
  return hmac(serviceKey, TERMINATOR);
}

/**
 * The string-to-sign and final signature, given an already-built canonical
 * request. Exported because this is the part a published vector pins.
 */
export function computePrivateGallerySignature(params: {
  readonly canonicalRequest: string;
  readonly amzDate: string;
  readonly scope: string;
  readonly signingKey: Buffer;
}): string {
  const stringToSign = [
    ALGORITHM,
    params.amzDate,
    params.scope,
    sha256Hex(params.canonicalRequest),
  ].join("\n");
  return hmac(params.signingKey, stringToSign).toString("hex");
}

/** `20260902T120000Z` and `20260902`, the only two time formats SigV4 uses. */
export function formatAmzDate(now: Date): { amzDate: string; date: string } {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    fail("now must be a valid date");
  }
  const amzDate = `${now.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
  return { amzDate, date: amzDate.slice(0, 8) };
}

export type PresignPrivateGalleryObjectParams = {
  /** A bare `https://` origin — `PRIVATE_GALLERY_S3_ENDPOINT`. */
  readonly endpoint: string;
  readonly bucket: string;
  readonly region: string;
  readonly objectKey: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** From `computePrivateGallerySignedUrlTtlSeconds` — already double-capped. */
  readonly expiresInSeconds: number;
  readonly now: Date;
  /**
   * Response headers the store should return with the object, signed like any
   * other parameter so a recipient cannot alter them. This is how
   * `Content-Disposition: attachment` and `Cache-Control: no-store` are
   * guaranteed for a given URL regardless of what metadata the upload set.
   */
  readonly responseHeaders?: {
    readonly contentDisposition?: string;
    readonly cacheControl?: string;
  };
  /** Defaults to `s3`; a provider using another service name may override it. */
  readonly service?: string;
};

/**
 * A presigned, single-object, `GET`-only URL.
 *
 * Only `GET` is ever produced. A presigner that could be asked for a method
 * would be one mistake away from handing out a write URL for a bucket whose
 * whole security model assumes the browser never writes to it (§8c).
 */
export function presignPrivateGalleryObjectUrl(
  params: PresignPrivateGalleryObjectParams,
): string {
  const {
    endpoint,
    bucket,
    region,
    objectKey,
    accessKeyId,
    secretAccessKey,
    expiresInSeconds,
    now,
    service = "s3",
  } = params;

  let origin: URL;
  try {
    origin = new URL(endpoint);
  } catch {
    fail("the endpoint is not a URL");
  }
  if (origin.protocol !== "https:") {
    // A signed URL over plain HTTP would put the credential-derived signature,
    // and the object it names, on the wire in clear.
    fail("the endpoint must be an https:// origin");
  }
  if (origin.pathname !== "/" || origin.search !== "" || origin.hash !== "") {
    fail("the endpoint must be a bare origin with no path, query, or fragment");
  }
  if (bucket.length === 0 || objectKey.length === 0) {
    fail("the bucket and object key must both be present");
  }
  if (
    !Number.isSafeInteger(expiresInSeconds) ||
    expiresInSeconds < 1
  ) {
    fail("the expiry must be a positive whole number of seconds");
  }
  if (accessKeyId.length === 0 || secretAccessKey.length === 0) {
    fail("the signing credential is incomplete");
  }

  const { amzDate, date } = formatAmzDate(now);
  const scope = `${date}/${region}/${service}/${TERMINATOR}`;

  const query: Array<readonly [string, string]> = [
    ["X-Amz-Algorithm", ALGORITHM],
    ["X-Amz-Credential", `${accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expiresInSeconds)],
    ["X-Amz-SignedHeaders", SIGNED_HEADER],
  ];
  if (params.responseHeaders?.contentDisposition !== undefined) {
    query.push([
      "response-content-disposition",
      params.responseHeaders.contentDisposition,
    ]);
  }
  if (params.responseHeaders?.cacheControl !== undefined) {
    query.push(["response-cache-control", params.responseHeaders.cacheControl]);
  }

  const path = `/${bucket}/${objectKey}`;
  const canonicalRequest = [
    "GET",
    canonicalUri(path),
    canonicalQueryString(query),
    `${SIGNED_HEADER}:${origin.host}\n`,
    SIGNED_HEADER,
    UNSIGNED_PAYLOAD,
  ].join("\n");

  const signature = computePrivateGallerySignature({
    canonicalRequest,
    amzDate,
    scope,
    signingKey: derivePrivateGallerySigningKey({
      secretAccessKey,
      date,
      region,
      service,
    }),
  });

  // Appended after signing and deliberately not part of the canonical query
  // string — it is the output of the signature, not an input to it.
  return `${origin.origin}${canonicalUri(path)}?${canonicalQueryString(
    query,
  )}&X-Amz-Signature=${signature}`;
}
