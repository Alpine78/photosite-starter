/**
 * JSON-shaped value readers shared by the server-only Sanity adapters.
 *
 * These helpers know nothing about media or category documents. Keeping them
 * here prevents one provider adapter from becoming another adapter's utility
 * module merely because both inspect the same network shape.
 */

import "server-only";

import { MAX_SANITY_GET_URL_BYTES } from "@/lib/sanity-client";

type RawLocalizedText = {
  readonly language?: unknown;
  readonly value?: unknown;
};

/** The authored-text language subtag represented by a route locale. */
export function toLanguageSubtag(value: string): string {
  try {
    const { language } = new Intl.Locale(value);
    return typeof language === "string" && language.length > 0
      ? language
      : value;
  } catch {
    return value;
  }
}

export function isRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Human-facing optional text: surrounding whitespace counts as absent. */
export function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Selects one human-facing localized value. Structural ids and path segments
 * need stricter readers and deliberately do not use this function.
 */
export function selectLocalizedText(
  entries: unknown,
  language: string,
): string | undefined {
  if (!Array.isArray(entries)) return undefined;

  for (const entry of entries as readonly RawLocalizedText[]) {
    if (isRecord(entry) && entry.language === language) {
      return readString(entry.value);
    }
  }

  return undefined;
}

/**
 * Conservative share of `sanity-client.ts`'s whole-URL GET budget reserved for
 * a serialized `contentIds` array parameter, leaving room for the origin, API
 * version, dataset path, the rest of the query string, and any other params. A
 * category or gallery holding a few hundred content pages can otherwise put
 * more candidate ids in this one array than the whole request budget allows.
 * Shared by every adapter that chunks a bounded multi-id listing query
 * (`sanity-article.ts`, `sanity-gallery.ts`) so the budget cannot drift
 * between them.
 */
export const MAX_CONTENT_IDS_BYTES = Math.floor(MAX_SANITY_GET_URL_BYTES / 2);

/**
 * The exact byte cost one chunk adds to the request URL:
 * `sanity-client.ts#buildSanityQueryUrl` turns a parameter value into
 * `encodeURIComponent(JSON.stringify(value))` before measuring the assembled
 * URL with `TextEncoder`. A raw per-id character estimate systematically
 * under-counts here — `encodeURIComponent` expands every JSON quote, comma,
 * and bracket to a three-byte `%XX` escape — so this measures the same
 * encoded form the real request builds, not an approximation of it.
 */
export function encodedContentIdsBytes(contentIds: readonly string[]): number {
  return new TextEncoder().encode(encodeURIComponent(JSON.stringify(contentIds)))
    .length;
}

/**
 * Splits candidate ids into groups whose exact encoded size — measured the
 * same way `buildSanityQueryUrl` measures the real request — stays under
 * `maxBytes`, so a large category's listing read never builds one query the
 * transport refuses outright.
 *
 * Provider-neutral on purpose: it throws nothing itself. A single
 * pathologically large id that cannot fit any chunk by itself is reported
 * through the caller-supplied `onOversized`, so each adapter can raise its own
 * classified error (`SanityArticleError`, `SanityGalleryError`, ...) rather
 * than one variant's error type leaking into another's failure.
 */
export function chunkContentIds(
  contentIds: readonly string[],
  maxBytes: number,
  onOversized: (id: string) => never,
): readonly (readonly string[])[] {
  const chunks: string[][] = [];
  let current: string[] = [];

  for (const id of contentIds) {
    if (encodedContentIdsBytes([id]) > maxBytes) {
      onOversized(id);
    }

    const candidate = [...current, id];
    if (current.length > 0 && encodedContentIdsBytes(candidate) > maxBytes) {
      chunks.push(current);
      current = [id];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) chunks.push(current);

  return chunks;
}
