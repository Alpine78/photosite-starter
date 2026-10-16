/** Shared Node-side field validation for private gallery stores and owner tooling. */
/** One bounded, single-line external customer or job reference. */
export function isPrivateGalleryProofBusinessReference(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Buffer.byteLength(value, "utf8") <= 128 &&
    !/[\x00-\x1f\x7f-\x9f\u2028\u2029]/u.test(value)
  );
}

/**
 * One complete local filename, never a path. Upload, reference assignment and
 * notification use the same check so a proof accepted at preparation cannot
 * become un-notifiable after confirmation.
 */
export function isPrivateGalleryProofFilename(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Buffer.byteLength(value, "utf8") <= 255 &&
    value !== "." &&
    value !== ".." &&
    !/[/\\\x00-\x1f\x7f-\x9f\u2028\u2029]/u.test(value)
  );
}

/** A stable gallery-local media identity, kept out of paths and log lines. */
export function isPrivateGalleryProofMediaId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Buffer.byteLength(value, "utf8") <= 128 &&
    !/[/\\\x00-\x1f\x7f-\x9f\u2028\u2029]/u.test(value)
  );
}

