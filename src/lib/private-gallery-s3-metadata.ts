/** Read-only exact-object S3 HEAD adapter; intentionally not registered in production. */
import "server-only";
import {
  snapshotPrivateGalleryObjectStoreConfig,
  type PrivateGalleryObjectStoreConfig,
} from "@/lib/private-gallery-config";
import { assignedPrivateGalleryObjectKind } from "@/lib/private-gallery-object-key";
import { PRIVATE_GALLERY_DEFAULT_MAX_DERIVATIVE_BYTES, PRIVATE_GALLERY_DEFAULT_MAX_ZIP_BYTES } from "@/lib/private-gallery-limits";
import { computePrivateGallerySignature, derivePrivateGallerySigningKey, formatAmzDate, uriEncode } from "@/lib/private-gallery-signed-url";
import type { PrivateGalleryUploadMetadataReader } from "@/lib/private-gallery-upload-metadata";

type Reason = "invalid-config" | "invalid-key" | "invalid-time" | "invalid-signal" |
  "aborted" | "request-failed" | "provider-refused" | "invalid-metadata";
export class PrivateGalleryS3MetadataError extends Error {
  constructor(readonly reason: Reason) {
    super(`[private-gallery-s3-metadata] ${reason}`);
    this.name = "PrivateGalleryS3MetadataError";
  }
}
function fail(reason: Reason): never { throw new PrivateGalleryS3MetadataError(reason); }
// HEAD has no request payload. This is the SHA-256 of the empty string.
const EMPTY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const SIGNED_HEADERS = "host;x-amz-content-sha256;x-amz-date";

/** No retries, LIST, body reads, checksum inference, credential lookup or writes. */
export function createPrivateGalleryS3MetadataReader(
  input: PrivateGalleryObjectStoreConfig,
  dependencies: { readonly fetch?: typeof fetch; readonly now?: () => Date } = {},
): PrivateGalleryUploadMetadataReader {
  let config: PrivateGalleryObjectStoreConfig;
  try { config = snapshotPrivateGalleryObjectStoreConfig(input); }
  catch { fail("invalid-config"); }
  const request = dependencies.fetch ?? fetch;
  const clock = dependencies.now ?? (() => new Date());
  return {
    async head({ objectKey, signal }) {
      const kind = assignedPrivateGalleryObjectKind(objectKey, config.keyPrefix);
      if (!kind) fail("invalid-key");
      if (!(signal instanceof AbortSignal)) fail("invalid-signal");
      if (signal.aborted) fail("aborted");
      let time: ReturnType<typeof formatAmzDate>;
      try {
        const now = clock();
        // SigV4 uses a four-digit year; formatAmzDate's general Date validation
        // alone also permits extended ISO years.
        if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || now.getUTCFullYear() < 1 || now.getUTCFullYear() > 9999) fail("invalid-time");
        time = formatAmzDate(now);
      } catch { fail("invalid-time"); }
      const path = `/${config.bucket}/${objectKey}`.split("/").map(uriEncode).join("/");
      const url = new URL(path, config.endpoint);
      const { amzDate, date } = time;
      const scope = `${date}/${config.region}/s3/aws4_request`;
      const canonical = ["HEAD", path, "", `host:${url.host}\nx-amz-content-sha256:${EMPTY_HASH}\nx-amz-date:${amzDate}\n`, SIGNED_HEADERS, EMPTY_HASH].join("\n");
      const key = derivePrivateGallerySigningKey({ secretAccessKey: config.verifierSecretAccessKey, date, region: config.region, service: "s3" });
      let signature: string;
      try { signature = computePrivateGallerySignature({ canonicalRequest: canonical, amzDate, scope, signingKey: key }); }
      finally { key.fill(0); } // Only this derived buffer can be wiped; JS strings remain managed.
      let response: Response;
      try {
        response = await request(url, { method: "HEAD", redirect: "error", cache: "no-store", signal,
          headers: { "accept-encoding": "identity", "x-amz-content-sha256": EMPTY_HASH, "x-amz-date": amzDate,
            authorization: `AWS4-HMAC-SHA256 Credential=${config.verifierAccessKeyId}/${scope}, SignedHeaders=${SIGNED_HEADERS}, Signature=${signature}` } });
      } catch { fail(signal.aborted ? "aborted" : "request-failed"); }
      try {
        if (signal.aborted) fail("aborted");
        if (response.redirected) fail("provider-refused");
        if (response.status === 404) return undefined;
        if (response.status !== 200) fail("provider-refused");
        const length = response.headers.get("content-length");
        const encoding = response.headers.get("content-encoding");
        const etag = response.headers.get("etag");
        const maximum = kind === "zip" ? PRIVATE_GALLERY_DEFAULT_MAX_ZIP_BYTES : PRIVATE_GALLERY_DEFAULT_MAX_DERIVATIVE_BYTES;
        if (length === null || !/^(0|[1-9][0-9]{0,15})$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > maximum ||
            (encoding !== null && encoding.toLowerCase() !== "identity") ||
            (etag !== null && (etag.length < 1 || etag.length > 512 || !/^[\x20-\x7e]+$/.test(etag)))) fail("invalid-metadata");
        return { sizeBytes: Number(length), ...(etag === null ? {} : { etag }) };
      } catch (error) {
        if (error instanceof PrivateGalleryS3MetadataError) throw error;
        fail("invalid-metadata");
      } finally {
        // A real HEAD has no body. Release a misbehaving response without reading
        // bytes or letting an uncooperative cancellation hold the caller open.
        try { void response.body?.cancel().catch(() => {}); } catch { /* redacted */ }
      }
    },
  };
}
