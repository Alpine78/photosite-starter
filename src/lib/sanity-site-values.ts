/** Shared value projection for the Sanity-backed site settings and home page. */

import "server-only";

import { buildStoryPath, type LocaleRouteConfig } from "@/lib/locale-routes";
import { isRecord, toLanguageSubtag } from "@/lib/sanity-values";
import type { NavigationItem } from "@/lib/site-settings";

export type RejectSanitySiteValue = (detail: string) => never;

const LANGUAGE_SUBTAG = /^[a-z]{2,3}$/;

/**
 * Restated from `sanity/schemas/site-link.ts`'s `ROOT_RELATIVE_PATH`: a Studio
 * schema imports nothing from the application (ADR-0006), so this boundary
 * check is necessarily duplicated rather than shared. Pinned equal by
 * `sanity-site-values.test.ts` so the two copies cannot silently drift.
 */
export const STATIC_PATH = /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*)?$/;

export function readRequiredString(
  value: unknown,
  field: string,
  reject: RejectSanitySiteValue,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    reject(`${field} is missing or empty`);
  }
  return value.trim();
}

export function readOptionalString(
  value: unknown,
  field: string,
  reject: RejectSanitySiteValue,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    reject(`${field} is not usable text`);
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function readLocalizedValues(
  entries: unknown,
  field: string,
  reject: RejectSanitySiteValue,
): ReadonlyMap<string, string> {
  if (!Array.isArray(entries)) {
    reject(`${field} is not a language-keyed list`);
  }

  const values = new Map<string, string>();
  for (const entry of entries) {
    if (
      !isRecord(entry) ||
      typeof entry.language !== "string" ||
      !LANGUAGE_SUBTAG.test(entry.language) ||
      typeof entry.value !== "string"
    ) {
      reject(`${field} has a malformed language entry`);
    }
    if (values.has(entry.language)) {
      reject(`${field} has more than one entry for language "${entry.language}"`);
    }
    values.set(entry.language, entry.value);
  }
  return values;
}

export function readLocalizedText(
  entries: unknown,
  language: string,
  field: string,
  reject: RejectSanitySiteValue,
): string {
  const value = readLocalizedValues(entries, field, reject).get(
    toLanguageSubtag(language),
  );
  if (value === undefined || value.trim().length === 0) {
    reject(`${field} has no text in language "${toLanguageSubtag(language)}"`);
  }
  return value.trim();
}

export function readOptionalLocalizedText(
  entries: unknown,
  language: string,
  field: string,
  reject: RejectSanitySiteValue,
): string | undefined {
  if (entries === undefined || entries === null) return undefined;
  const value = readLocalizedValues(entries, field, reject).get(
    toLanguageSubtag(language),
  );
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

export type SingletonReject = (
  rejection: "malformed-result" | "missing-document" | "ambiguous-document",
  detail: string,
) => never;

/**
 * Reads the one published document a singleton query must answer with.
 * Shared by every Sanity-backed singleton (site settings, home page) so a
 * fix to this three-way check does not need to be repeated per adapter.
 */
export function readSingletonDocument<TDocument>(
  result: unknown,
  label: string,
  reject: SingletonReject,
): TDocument {
  if (!Array.isArray(result) || !result.every(isRecord)) {
    reject(
      "malformed-result",
      "the content store answered with something other than a list",
    );
  }
  if (result.length === 0) {
    reject("missing-document", `no published ${label} document exists`);
  }
  if (result.length > 1) {
    reject("ambiguous-document", `more than one published ${label} document exists`);
  }
  return result[0] as TDocument;
}

export type RawSiteLink = {
  readonly label?: unknown;
  readonly title?: unknown;
  readonly description?: unknown;
  readonly target?: unknown;
  readonly href?: unknown;
};

function readLinkTarget(
  link: RawSiteLink,
  config: LocaleRouteConfig,
  locale: string,
  featuredGalleryHref: string | undefined,
  field: string,
  reject: RejectSanitySiteValue,
): string | undefined {
  switch (link.target) {
    case "static":
      if (typeof link.href !== "string" || !STATIC_PATH.test(link.href)) {
        reject(`${field} has an invalid static route path`);
      }
      return link.href;
    case "story-root":
      if (link.href !== undefined && link.href !== null && link.href !== "") {
        reject(`${field} stores a path for the generated story root`);
      }
      return buildStoryPath(config, locale);
    case "featured-gallery":
      if (link.href !== undefined && link.href !== null && link.href !== "") {
        reject(`${field} stores a path for the featured gallery`);
      }
      return featuredGalleryHref;
    default:
      reject(`${field} has an unknown target`);
  }
}

export function projectNavigationItems(
  value: unknown,
  options: {
    readonly language: string;
    readonly locale: string;
    readonly config: LocaleRouteConfig;
    readonly field: string;
    readonly reject: RejectSanitySiteValue;
    readonly minItems?: number;
  },
): readonly NavigationItem[] {
  if (
    !Array.isArray(value) ||
    !value.every(isRecord) ||
    value.length < (options.minItems ?? 0)
  ) {
    options.reject(`${options.field} is not a list of navigation items`);
  }

  const result: NavigationItem[] = [];
  const identities = new Set<string>();
  for (const [index, link] of value.entries()) {
    const field = `${options.field}[${index}]`;
    const label = readLocalizedText(
      link.label,
      options.language,
      `${field}.label`,
      options.reject,
    );

    if (link.target === "featured-gallery") {
      if (link.href !== undefined && link.href !== null && link.href !== "") {
        options.reject(`${field} stores a path for the featured gallery`);
      }
      if (identities.has("featured-gallery")) {
        options.reject(`${options.field} repeats the featured gallery`);
      }
      identities.add("featured-gallery");
      result.push({ label, featured: true });
      continue;
    }

    const href = readLinkTarget(
      link,
      options.config,
      options.locale,
      undefined,
      field,
      options.reject,
    );
    if (href === undefined) options.reject(`${field} has no destination`);
    if (identities.has(href)) {
      options.reject(`${options.field} repeats destination "${href}"`);
    }
    identities.add(href);
    result.push({ label, href });
  }
  return result;
}

export function projectHomeLink(
  link: RawSiteLink,
  options: {
    readonly language: string;
    readonly locale: string;
    readonly config: LocaleRouteConfig;
    readonly featuredGalleryHref?: string;
    readonly field: string;
    readonly reject: RejectSanitySiteValue;
  },
): { readonly href: string; readonly label: string } | undefined {
  const href = readLinkTarget(
    link,
    options.config,
    options.locale,
    options.featuredGalleryHref,
    options.field,
    options.reject,
  );
  if (href === undefined) return undefined;

  return {
    href,
    label: readLocalizedText(
      link.label ?? link.title,
      options.language,
      `${options.field}.${link.label === undefined ? "title" : "label"}`,
      options.reject,
    ),
  };
}
