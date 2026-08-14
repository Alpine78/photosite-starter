/** Shared Sanity Studio validation primitives. */

import type {
  SchemaValidationClient,
  SchemaValidationContext,
} from "./schema-types";

/** Pinned Content Lake behavior for every schema validation query. */
export const STUDIO_VALIDATION_API_VERSION = "2026-08-13";

/** The published identity shared by a document, its draft, and a release version. */
export function publishedIdOf(id: string): string {
  if (id.startsWith("drafts.")) return id.slice("drafts.".length);

  if (id.startsWith("versions.")) {
    const withoutPrefix = id.slice("versions.".length);
    const separator = withoutPrefix.indexOf(".");
    return separator === -1
      ? withoutPrefix
      : withoutPrefix.slice(separator + 1);
  }

  return id;
}

/**
 * An uncached validation client with an explicit perspective. `raw` sees
 * identity collisions in every draft and release. `published`, with the
 * document being edited overlaid by its validator, models publishing that one
 * document now.
 */
export function validationClientOf(
  context: SchemaValidationContext,
  perspective: "raw" | "published" = "raw",
): SchemaValidationClient {
  return context
    .getClient({ apiVersion: STUDIO_VALIDATION_API_VERSION })
    .withConfig({ perspective, useCdn: false });
}
