/**
 * JSON-shaped value readers shared by the server-only Sanity adapters.
 *
 * These helpers know nothing about media or category documents. Keeping them
 * here prevents one provider adapter from becoming another adapter's utility
 * module merely because both inspect the same network shape.
 */

import "server-only";

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
