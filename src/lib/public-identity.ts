/**
 * The one grammar for a site-wide public identity — a `mediaId`, a
 * `placementId`, a `contentId`, a `categoryId`, a route segment.
 *
 * Lowercase alphanumeric words joined by single hyphens: no leading, trailing,
 * or doubled hyphen, no uppercase, no underscore. Several modules restated this
 * regex before AB#60; the enquiry flow needs the *route* layer
 * (`locale-prefix-request.ts`, parsing `?enquire=`) and the *authorization*
 * layer (`enquiry-media.ts`, validating the same value on submit) to agree
 * exactly, so the predicate lives here where both import it and neither can
 * drift.
 *
 * This module is a client-safe leaf: a bare regex, a length ceiling, and a pure
 * function, with no import that would pull `server-only` or `node:crypto` in
 * behind it. The length ceiling is restated from `gallery-pagination.ts`'s
 * `MAX_ITEM_ID_LENGTH` rather than imported for that reason, and a test pins the
 * two equal.
 */

/** Restated from `MAX_ITEM_ID_LENGTH`; pinned equal by a test. */
export const MAX_PUBLIC_IDENTITY_LENGTH = 256;

export const PUBLIC_IDENTITY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Whether `value` is a well-formed, bounded public identity. */
export function isPublicIdentity(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_PUBLIC_IDENTITY_LENGTH &&
    PUBLIC_IDENTITY_PATTERN.test(value)
  );
}
