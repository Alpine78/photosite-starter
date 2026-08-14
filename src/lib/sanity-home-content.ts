/** Published Sanity home-page content projected into `HomeContent`. */

import "server-only";

import type { HomeContent, HomeSectionLink } from "@/lib/home-content";
import type { LocaleRouteConfig } from "@/lib/locale-routes";
import { getSanityClient, type SanityClient } from "@/lib/sanity-client";
import { getSanityConfig, type SanityConfig } from "@/lib/sanity-config";
import {
  projectPublicMedia,
  PUBLIC_MEDIA_PROJECTION,
  type RawPublicMediaDocument,
} from "@/lib/sanity-media";
import {
  projectHomeLink,
  readLocalizedText,
  type RawSiteLink,
} from "@/lib/sanity-site-values";
import { isRecord } from "@/lib/sanity-values";

export const HOME_PAGE_DOCUMENT_TYPE = "homePage";
export const PROJECTED_HOME_PAGE_FIELDS = [
  "heroMedia",
  "heroAction",
  "intro",
  "sections",
] as const;

export const HOME_PAGE_PROJECTION = `{
  "heroMedia": heroMedia->${PUBLIC_MEDIA_PROJECTION},
  heroAction{label[]{language, value}, target, href},
  intro[]{language, value},
  sections[]{title[]{language, value}, description[]{language, value}, target, href}
}`;

export type SanityHomeContentRejection =
  | "missing-document"
  | "ambiguous-document"
  | "incomplete-document"
  | "invalid-navigation"
  | "malformed-result";

export class SanityHomeContentError extends Error {
  readonly rejection: SanityHomeContentRejection;

  constructor(rejection: SanityHomeContentRejection, detail: string) {
    super(`[sanity-home-content] ${detail}`);
    this.name = "SanityHomeContentError";
    this.rejection = rejection;
  }
}

export type RawHomePageDocument = {
  readonly heroMedia?: unknown;
  readonly heroAction?: unknown;
  readonly intro?: unknown;
  readonly sections?: unknown;
};

export function projectHomeContent(
  document: RawHomePageDocument,
  options: {
    readonly language: string;
    readonly fallbackLanguage: string;
    readonly locale: string;
    readonly routeConfig: LocaleRouteConfig;
    readonly sanityConfig: SanityConfig;
    readonly featuredGalleryHref?: string;
  },
): HomeContent {
  const rejectIncomplete = (detail: string): never => {
    throw new SanityHomeContentError("incomplete-document", detail);
  };
  const rejectNavigation = (detail: string): never => {
    throw new SanityHomeContentError("invalid-navigation", detail);
  };

  if (!isRecord(document.heroMedia)) {
    rejectIncomplete("heroMedia does not resolve to a published media document");
  }
  const media = projectPublicMedia(
    document.heroMedia as RawPublicMediaDocument,
    {
      language: options.language,
      fallbackLanguage: options.fallbackLanguage,
      config: options.sanityConfig,
    },
  );

  let action: HomeContent["hero"]["action"];
  if (document.heroAction !== undefined && document.heroAction !== null) {
    if (!isRecord(document.heroAction)) {
      rejectIncomplete("heroAction is malformed");
    }
    const projected = projectHomeLink(document.heroAction, {
      language: options.language,
      locale: options.locale,
      config: options.routeConfig,
      ...(options.featuredGalleryHref === undefined
        ? {}
        : { featuredGalleryHref: options.featuredGalleryHref }),
      field: "heroAction",
      reject: rejectNavigation,
    });
    if (projected !== undefined) action = projected;
  }

  const rawSections = document.sections;
  if (!Array.isArray(rawSections) || !rawSections.every(isRecord)) {
    rejectIncomplete("sections is not a list");
  }
  const sectionDocuments = rawSections as readonly Readonly<Record<string, unknown>>[];
  const sections: HomeSectionLink[] = [];
  const destinations = new Set<string>();
  for (const [index, section] of sectionDocuments.entries()) {
    const field = `sections[${index}]`;
    const link = projectHomeLink(section as RawSiteLink, {
      language: options.language,
      locale: options.locale,
      config: options.routeConfig,
      ...(options.featuredGalleryHref === undefined
        ? {}
        : { featuredGalleryHref: options.featuredGalleryHref }),
      field,
      reject: rejectNavigation,
    });
    // An unpublished or unplaced featured gallery is deliberately omitted,
    // matching the mock seam and site chrome rather than producing a dead link.
    if (link === undefined) continue;
    if (destinations.has(link.href)) {
      rejectNavigation(`sections repeats destination "${link.href}"`);
    }
    destinations.add(link.href);
    sections.push({
      title: link.label,
      href: link.href,
      description: readLocalizedText(
        section.description,
        options.language,
        `${field}.description`,
        rejectIncomplete,
      ),
    });
  }

  return {
    hero: { media, ...(action === undefined ? {} : { action }) },
    intro: readLocalizedText(
      document.intro,
      options.language,
      "intro",
      rejectIncomplete,
    ),
    sections,
  };
}

function readSingleton(result: unknown): RawHomePageDocument {
  if (!Array.isArray(result) || !result.every(isRecord)) {
    throw new SanityHomeContentError(
      "malformed-result",
      "the content store answered with something other than a list",
    );
  }
  if (result.length === 0) {
    throw new SanityHomeContentError(
      "missing-document",
      "no published home page document exists",
    );
  }
  if (result.length > 1) {
    throw new SanityHomeContentError(
      "ambiguous-document",
      "more than one published home page document exists",
    );
  }
  return result[0];
}

export async function readSanityHomeContent(options: {
  readonly language: string;
  readonly fallbackLanguage: string;
  readonly locale: string;
  readonly routeConfig: LocaleRouteConfig;
  readonly featuredGalleryHref?: string;
  readonly client?: SanityClient;
  readonly sanityConfig?: SanityConfig;
}): Promise<HomeContent> {
  const client = options.client ?? getSanityClient();
  const result = await client.query({
    query: `*[_type == "${HOME_PAGE_DOCUMENT_TYPE}"]${HOME_PAGE_PROJECTION}`,
    tag: "home-page",
  });
  return projectHomeContent(readSingleton(result), {
    ...options,
    sanityConfig: options.sanityConfig ?? getSanityConfig(),
  });
}
