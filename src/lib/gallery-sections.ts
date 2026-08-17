/**
 * Gallery sections: a gallery-local named subset of a curated gallery's
 * placements (ADR-0003 decision 8), and the bounded server-side query that
 * answers `All` or one named section across many pages without loading the
 * whole gallery.
 *
 * Section membership is placement-owned (ADR-0002): assigning or moving an
 * item into a section never touches the underlying `Media` document, and the
 * same photograph can sit in different sections of different galleries, or
 * repeat within one gallery, through separate placements.
 *
 * This module deliberately knows nothing about `content-tree.ts` — categories,
 * secondary listings, and redirect history are a different, unrelated
 * placement concept, and a section never consumes tree depth or a route.
 *
 * `route.ts`, the catch-all content route, the grid, and the lightbox are not
 * touched here: reading `?section=` from a real request, rendering controls,
 * managing browser history, and composing the filtered set with the grid and
 * lightbox are AB#115's job. This module only has to define what a correct
 * answer *is*, so that story inherits correct behaviour by construction.
 */

import {
  assertBoundedString,
  buildCuratedGalleryPage,
  comparePlacementIds,
  MAX_ITEM_ID_LENGTH,
  MAX_SCOPE_FIELD_LENGTH,
  resolveGalleryWindowRequest,
  type CuratedGalleryPlacement,
  type GalleryCursorCodec,
  type GalleryWindowRequest,
  type GalleryWindowResult,
} from "@/lib/gallery-pagination";
import type { CuratedGalleryResultItem, GalleryPage } from "@/lib/gallery-result";

const SECTION_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Reserved: names the unfiltered view, so no authored section may claim it. */
export const RESERVED_ALL_SECTION_SLUG = "all";

/**
 * `normalizedFilterKey` prefixes a section id with this to build
 * `GalleryCursorScope.normalizedFilter`, which `assertScope` in
 * `gallery-pagination.ts` bounds to `MAX_SCOPE_FIELD_LENGTH` (256). A
 * `sectionId` validated only against that same 256-char bound could exceed the
 * scope field once prefixed — accepted by `assertGallerySections`, then
 * rejected by `buildCuratedGalleryPage` for a reason no author could see.
 * `MAX_SECTION_ID_LENGTH` is derived from the prefix's own length so the two
 * can never drift back out of sync.
 */
const SECTION_FILTER_PREFIX = "section:";
export const MAX_SECTION_ID_LENGTH =
  MAX_SCOPE_FIELD_LENGTH - SECTION_FILTER_PREFIX.length;

/**
 * A gallery's full section catalog is serialized on every returned page
 * (`selectGallerySectionSummaries`, for a future section control), so an
 * unbounded count would make an otherwise 24-item page's payload grow without
 * limit. Same order of magnitude as this module's other small-list bounds
 * (`MAX_LIST_ITEMS`, `MAX_SPANS_PER_BLOCK`) — a gallery organized into more
 * than this many named sections is not what the control this feeds is for.
 */
export const MAX_GALLERY_SECTIONS = 20;

// --- Section intro: a small, restricted, provider-neutral rich-text model ---
//
// `ContentBlock` (`content-page.ts`) already has `paragraph`/`list` kinds, but
// their text is a plain string with no inline structure — nothing in this
// codebase can represent a link or emphasis *within* a run of text. ADR-0003
// decision 3 requires both for a section intro, so this is a dedicated model
// rather than a narrowed `ContentBlock`, restricted to exactly the two kinds
// the ADR allows: no heading, media, or embed block exists in this union at
// all, which is what "headings, media, and embeds are not allowed" enforces.

export type GallerySectionInlineMark = "emphasis";

const KNOWN_MARKS: ReadonlySet<GallerySectionInlineMark> = new Set(["emphasis"]);

/** One run of text, optionally emphasised and/or a link. */
export type GallerySectionInlineSpan = {
  readonly text: string;
  readonly marks?: readonly GallerySectionInlineMark[];
  /** Root-relative internal path or an absolute `http(s)` URL. */
  readonly href?: string;
};

export type GallerySectionParagraphBlock = {
  readonly type: "paragraph";
  readonly spans: readonly GallerySectionInlineSpan[];
  readonly key?: string;
};

export type GallerySectionListItem = {
  readonly spans: readonly GallerySectionInlineSpan[];
  readonly key?: string;
};

export type GallerySectionListBlock = {
  readonly type: "list";
  readonly ordered: boolean;
  readonly items: readonly GallerySectionListItem[];
  readonly key?: string;
};

export type GallerySectionIntroBlock =
  | GallerySectionParagraphBlock
  | GallerySectionListBlock;

/** A *short* introduction (ADR wording) — visibly smaller than an article body. */
export const MAX_INTRO_BLOCKS = 6;
export const MAX_SPANS_PER_BLOCK = 20;
/** Enough for the ADR's own example: an ordered race-results list. */
export const MAX_LIST_ITEMS = 20;
export const MAX_SPAN_TEXT_LENGTH = 300;

/**
 * Same pattern as `sanity/schemas/site-link.ts`'s `ROOT_RELATIVE_PATH` (and
 * `src/lib/sanity-site-values.ts`'s `STATIC_PATH`), duplicated locally per this
 * repo's convention (a Studio schema imports nothing from the application, and
 * vice versa — see ADR-0006). Exported, and pinned equal to `ROOT_RELATIVE_PATH`
 * by `gallery-sections.test.ts`, the same way `sanity-site-values.test.ts`
 * already pins `STATIC_PATH` — so the copies cannot silently drift apart.
 */
export const INTERNAL_LINK_PATH =
  /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*)?$/;

function assertSpanHref(href: string): void {
  if (INTERNAL_LINK_PATH.test(href)) return;

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    throw new TypeError(`Gallery section intro link href is not valid: ${href}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError(
      `Gallery section intro link href must be http(s) or root-relative: ${href}`,
    );
  }
}

function assertSpans(spans: readonly GallerySectionInlineSpan[], field: string): void {
  if (spans.length === 0 || spans.length > MAX_SPANS_PER_BLOCK) {
    throw new TypeError(
      `${field} must have between 1 and ${MAX_SPANS_PER_BLOCK} spans`,
    );
  }
  for (const span of spans) {
    assertBoundedString(span.text, `${field} span text`, MAX_SPAN_TEXT_LENGTH);
    if (span.marks !== undefined) {
      const seen = new Set<GallerySectionInlineMark>();
      for (const mark of span.marks) {
        if (!KNOWN_MARKS.has(mark)) {
          throw new TypeError(`Unknown gallery section intro mark: ${mark}`);
        }
        if (seen.has(mark)) {
          throw new TypeError(`Duplicate gallery section intro mark: ${mark}`);
        }
        seen.add(mark);
      }
    }
    if (span.href !== undefined) {
      assertSpanHref(span.href);
    }
  }
}

/**
 * Enforces named, testable bounds rather than a bare "bounded": block-count
 * cap, an allow-list of exactly `paragraph`/`list` (anything else — a
 * heading, media, or embed shape — throws), and span/item/text bounds.
 */
export function assertGallerySectionIntroBlocks(
  blocks: readonly GallerySectionIntroBlock[],
): void {
  if (blocks.length > MAX_INTRO_BLOCKS) {
    throw new TypeError(
      `Gallery section intro must have at most ${MAX_INTRO_BLOCKS} blocks`,
    );
  }

  for (const block of blocks) {
    if (block.type === "paragraph") {
      assertSpans(block.spans, "Gallery section intro paragraph");
    } else if (block.type === "list") {
      // Validated explicitly rather than trusted from the declared TS type:
      // this function's whole purpose is checking data crossing an external
      // boundary (a future CMS adapter reads raw JSON, where a type annotation
      // gives no runtime guarantee), the same posture `assertPlacements` and
      // `assertGallerySections` already take for every other field here. A
      // truthy non-boolean (e.g. the string `"false"`) would otherwise cross
      // into a renderer and silently turn an unordered list into an ordered one.
      if (typeof block.ordered !== "boolean") {
        throw new TypeError("Gallery section intro list.ordered must be a boolean");
      }
      if (block.items.length === 0 || block.items.length > MAX_LIST_ITEMS) {
        throw new TypeError(
          `Gallery section intro list must have between 1 and ${MAX_LIST_ITEMS} items`,
        );
      }
      for (const item of block.items) {
        assertSpans(item.spans, "Gallery section intro list item");
      }
    } else {
      throw new TypeError(
        `Gallery section intro block kind is not allowed: ${(block as { type: string }).type}`,
      );
    }
  }
}

// --- Section identity ---

export type GallerySection = {
  readonly sectionId: string;
  /** Lowercase-hyphenated, unique within the gallery, never `"all"`. */
  readonly slug: string;
  readonly label: string;
  readonly order: number;
  readonly intro?: readonly GallerySectionIntroBlock[];
};

export type GallerySectionSummary = Omit<GallerySection, "intro">;

export type GallerySectionFilter =
  | { readonly kind: "all" }
  | { readonly kind: "section"; readonly section: GallerySection };

export class UnknownGallerySectionError extends Error {
  readonly sectionSlug: string;

  constructor(sectionSlug: string) {
    super(`Unknown gallery section: ${sectionSlug}`);
    this.name = "UnknownGallerySectionError";
    this.sectionSlug = sectionSlug;
  }
}

/**
 * Validates one gallery's declared sections: bounded/unique identity and slug,
 * lowercase-hyphenated slug format, the reserved `all` slug rejected, a
 * non-negative integer order, and an allowed intro. Fails fast — matching
 * `gallery-pagination.ts`'s `assertScope`/`assertPlacements` rather than
 * `content-tree.ts`'s collect-every-issue style, since this sits at the same
 * layer as the former.
 */
export function assertGallerySections(sections: readonly GallerySection[]): void {
  if (sections.length > MAX_GALLERY_SECTIONS) {
    throw new TypeError(
      `A gallery may declare at most ${MAX_GALLERY_SECTIONS} sections`,
    );
  }

  const ids = new Set<string>();
  const slugs = new Set<string>();

  for (const section of sections) {
    assertBoundedString(section.sectionId, "section.sectionId", MAX_SECTION_ID_LENGTH);
    if (ids.has(section.sectionId)) {
      throw new TypeError(`Duplicate gallery section id: ${section.sectionId}`);
    }
    ids.add(section.sectionId);

    assertBoundedString(section.slug, "section.slug", MAX_ITEM_ID_LENGTH);
    if (!SECTION_SLUG_PATTERN.test(section.slug)) {
      throw new TypeError(`Gallery section slug is not valid: ${section.slug}`);
    }
    if (section.slug === RESERVED_ALL_SECTION_SLUG) {
      throw new TypeError(
        `Gallery section slug may not be the reserved token "${RESERVED_ALL_SECTION_SLUG}"`,
      );
    }
    if (slugs.has(section.slug)) {
      throw new TypeError(`Duplicate gallery section slug: ${section.slug}`);
    }
    slugs.add(section.slug);

    assertBoundedString(section.label, "section.label", MAX_SCOPE_FIELD_LENGTH);

    if (!Number.isSafeInteger(section.order) || section.order < 0) {
      throw new TypeError("section.order must be a non-negative safe integer");
    }

    if (section.intro !== undefined) {
      assertGallerySectionIntroBlocks(section.intro);
    }
  }
}

/**
 * Every placement naming a `sectionId` must reference a section declared for
 * this gallery — rejected rather than silently dropped into "unsectioned",
 * matching `content-tree.ts`'s treatment of an orphaned category reference.
 *
 * Runs against the *complete* placements+sections list at authoring/fixture-
 * construction time (see `mock-gallery.ts`), not per request: the bounded
 * request path (`readCuratedGallerySectionPage` below) only ever sees whatever
 * a source returns for the current filter and must not need the whole gallery
 * to answer one section's page.
 */
export function assertPlacementSectionReferences(
  placements: readonly CuratedGalleryPlacement[],
  sections: readonly GallerySection[],
): void {
  const ids = new Set(sections.map((section) => section.sectionId));
  for (const placement of placements) {
    if (placement.sectionId !== undefined && !ids.has(placement.sectionId)) {
      throw new TypeError(
        `Placement ${placement.placementId} references an unknown gallery section: ${placement.sectionId}`,
      );
    }
  }
}

/**
 * Resolves a requested `?section=` slug against a gallery's declared sections.
 *
 * `undefined`, an empty string, and the reserved `all` token all normalize to
 * the unfiltered view, per ADR-0003 decision 8. Anything else that fails to
 * match a declared slug throws `UnknownGallerySectionError` — which is also
 * "rename, delete, and stale URL" behaviour in full: a retired or renamed-away
 * slug simply matches nothing declared and takes this same path. No redirect
 * history is kept for sections, unlike category/content renames.
 */
export function resolveGallerySectionFilter(
  sections: readonly GallerySection[],
  sectionSlug: string | undefined,
): GallerySectionFilter {
  if (sectionSlug === undefined || sectionSlug === "" || sectionSlug === RESERVED_ALL_SECTION_SLUG) {
    return { kind: "all" };
  }

  const section = sections.find((candidate) => candidate.slug === sectionSlug);
  if (section === undefined) {
    throw new UnknownGallerySectionError(sectionSlug);
  }

  return { kind: "section", section };
}

/**
 * The value that becomes `GalleryCursorScope.normalizedFilter`. The existing,
 * already-tested HMAC scope-matching in `gallery-pagination.ts` is what then
 * makes a cursor minted for one section reject as `wrong-scope` if replayed
 * against another filter — this is the whole of "changing section resets the
 * cursor," with no new cursor logic required.
 */
export function normalizedFilterKey(filter: GallerySectionFilter): string {
  return filter.kind === "all"
    ? "all"
    : `${SECTION_FILTER_PREFIX}${filter.section.sectionId}`;
}

/** The gallery's full section catalog, ordered for a future section control. */
export function selectGallerySectionSummaries(
  sections: readonly GallerySection[],
): readonly GallerySectionSummary[] {
  return sections
    .toSorted(
      (left, right) =>
        left.order - right.order || comparePlacementIds(left.sectionId, right.sectionId),
    )
    .map(({ sectionId, slug, label, order }) => ({ sectionId, slug, label, order }));
}

// --- Published-slug immutability ---

export type GallerySectionSlugChange = {
  readonly sectionId: string;
  readonly previousSlug: string;
  readonly currentSlug: string;
};

/**
 * Sections whose `sectionId` is present in both snapshots but whose `slug`
 * differs between them. A brand-new or removed `sectionId` is not a change —
 * only a slug moving under a persisting identity is, matching the ADR: a
 * rename keeps the same section (placements referencing it by `sectionId`
 * need no changes) while retiring the old slug with no redirect kept.
 *
 * A pure diff, not wired into a call site by this story — the mock fixture is
 * static and never "republished" at runtime. It exists for a future writer
 * (AB#113's Sanity schema, which this ADR clause is explicitly written for) to
 * call as its backstop, the same relationship `content-tree.ts`'s
 * `diffCanonicalPaths` already has with `content-redirects.ts` and
 * `category-validation.ts`.
 */
export function diffGallerySectionSlugChanges(
  previous: readonly GallerySection[] | undefined,
  current: readonly GallerySection[],
): readonly GallerySectionSlugChange[] {
  if (previous === undefined) return [];

  const previousById = new Map(previous.map((section) => [section.sectionId, section]));
  const changes: GallerySectionSlugChange[] = [];

  for (const section of current) {
    const earlier = previousById.get(section.sectionId);
    if (earlier !== undefined && earlier.slug !== section.slug) {
      changes.push({
        sectionId: section.sectionId,
        previousSlug: earlier.slug,
        currentSlug: section.slug,
      });
    }
  }

  return changes;
}

/** Throws on the first change `diffGallerySectionSlugChanges` reports. */
export function assertGallerySectionsSlugStable(
  previous: readonly GallerySection[] | undefined,
  current: readonly GallerySection[],
): void {
  const [change] = diffGallerySectionSlugChanges(previous, current);
  if (change !== undefined) {
    throw new TypeError(
      `Gallery section slug is immutable after first publication: ${change.sectionId} (${change.previousSlug} -> ${change.currentSlug})`,
    );
  }
}

// --- Bounded query/source contract ---

export type CuratedGalleryPage = GalleryPage<CuratedGalleryResultItem> & {
  /** The gallery's full ordered section catalog. Always present, possibly empty. */
  readonly sections: readonly GallerySectionSummary[];
  /** The filtered section's own identity and intro — only on its first, uncursored slice. */
  readonly selectedSection?: GallerySection;
};

export type GallerySectionQuery = {
  readonly locale: string;
  readonly contentId: string;
  readonly sectionSlug?: string;
  readonly cursor?: string;
  readonly pageSize: number;
  readonly ordering: string;
  readonly visibilityVersion: string;
};

/**
 * Reads whichever placements answer one resolved filter's bounded window.
 * `filter` is always already resolved — `{kind:"all"}` or `{kind:"section",
 * section}` — never a raw slug, so a source can never be asked to filter on
 * untrusted input, and the section predicate reaches it *before* any
 * placement row is read. `window` (AB#134) is the bounded request a page
 * needs answered: up to `window.candidateLimit` items after `window.after`,
 * plus that boundary item's current state — never "give me everything
 * matching this filter." A store-backed adapter (AB#114) turns this into an
 * id lookup plus a `WHERE section_id = ? AND (order, id) > (?, ?) ORDER BY
 * order, id LIMIT ?`-shaped keyset query; the reference implementation in
 * `mock-gallery.ts` still filters an in-memory array before calling
 * `selectGalleryWindow`, which is a fixture property, not a contract one.
 *
 * Asynchronous, unlike `buildCuratedGalleryPage`/`selectCuratedGalleryCover`
 * (still sync, pure functions over already-available rows): a real store
 * query has to be awaited, and this is the seam that issues one, so the
 * async boundary belongs here rather than staying one level up in
 * `gallery.ts`'s `getGalleryPage` the way it did before AB#134.
 */
export type CuratedGallerySectionSource = (request: {
  readonly locale: string;
  readonly contentId: string;
  readonly filter: GallerySectionFilter;
  readonly window: GalleryWindowRequest;
}) => Promise<GalleryWindowResult>;

/**
 * Composes one bounded curated-gallery page: resolve the requested section,
 * resolve the requested cursor into the bounded window a source must answer
 * (AB#134's `resolveGalleryWindowRequest`), ask `source` for exactly that
 * window, build the page from the source's answer, and attach the section
 * catalog plus the selected section's own identity when this is its first
 * slice.
 *
 * What this makes bounded, and why it needed a pagination-core contract
 * change rather than composing against the old one: before AB#134,
 * `buildCuratedGalleryPage` took a gallery's *entire* section-filtered
 * placement set and did its own in-memory offset slicing — so a section
 * holding most or all of a large gallery cost a full-section fetch per page,
 * the same limitation the unfiltered `All` view already had. AB#105's own
 * review raised this as a P1 against its "without loading the full gallery"
 * acceptance criterion; AB#134 is the fix, changing what a source is asked
 * for from "everything matching this filter" to a bounded window — the
 * boundary item plus up to `pageSize + 1` items after it — which a
 * store-backed adapter (AB#114) can answer with one id lookup and one keyset
 * range query. What was already bounded and provable before AB#134, and
 * stays true now, is the axis AB#105 itself owns: a section-scoped read is
 * never required to load placements from a *different* section, or the rest
 * of an unsectioned gallery, to answer correctly — see
 * `gallery-sections.test.ts`'s source-stub tests.
 *
 * `sections` is trusted, not re-validated here: `assertGallerySections` is the
 * caller's authoring/fixture-construction-time responsibility (see
 * `mock-gallery.ts`'s `getOrBuildGallery`), the same one-time-not-per-request
 * split `assertPlacementSectionReferences` already documents above. Re-running
 * a full-catalog check on every paginated request — including every
 * continuation of the same section — would repeat the same "whole gallery" cost
 * this function otherwise avoids, just for the section catalog instead of the
 * placements.
 */
export async function readCuratedGallerySectionPage({
  query,
  sections,
  source,
  cursorCodec,
}: {
  readonly query: GallerySectionQuery;
  readonly sections: readonly GallerySection[];
  readonly source: CuratedGallerySectionSource;
  readonly cursorCodec?: GalleryCursorCodec;
}): Promise<CuratedGalleryPage> {
  const filter = resolveGallerySectionFilter(sections, query.sectionSlug);
  const scope = {
    sourceId: `${query.contentId}@${query.locale}`,
    normalizedFilter: normalizedFilterKey(filter),
    ordering: query.ordering,
    visibilityVersion: query.visibilityVersion,
    pageSize: query.pageSize,
  };
  const windowRequest = resolveGalleryWindowRequest({
    scope,
    ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    ...(cursorCodec === undefined ? {} : { cursorCodec }),
  });

  const windowResult = await source({
    locale: query.locale,
    contentId: query.contentId,
    filter,
    window: windowRequest,
  });

  const page = buildCuratedGalleryPage({
    windowResult,
    scope,
    windowRequest,
    ...(cursorCodec === undefined ? {} : { cursorCodec }),
  });

  return {
    ...page,
    sections: selectGallerySectionSummaries(sections),
    ...(filter.kind === "section" && query.cursor === undefined
      ? { selectedSection: filter.section }
      : {}),
  };
}
