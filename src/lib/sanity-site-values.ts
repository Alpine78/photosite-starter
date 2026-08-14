/** Shared value projection for the Sanity-backed site settings and home page. */

import "server-only";

import { buildStoryPath, type LocaleRouteConfig } from "@/lib/locale-routes";
import { isRecord, toLanguageSubtag } from "@/lib/sanity-values";
import type { NavigationItem } from "@/lib/site-settings";

export type RejectSanitySiteValue = (detail: string) => never;

const LANGUAGE_SUBTAG = /^[a-z]{2,3}$/;
const STATIC_PATH = /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*)?$/;

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
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    reject(`${field} is not usable text`);
  }
  return value.trim();
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
  },
): readonly NavigationItem[] {
  if (!Array.isArray(value) || !value.every(isRecord)) {
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
    const identity = link.target === "story-root" ? "story-root" : `static:${href}`;
    if (identities.has(identity)) {
      options.reject(`${options.field} repeats destination "${identity}"`);
    }
    identities.add(identity);
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
