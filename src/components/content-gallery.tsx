import Link from "next/link";
import { Breadcrumbs, type BreadcrumbStep } from "@/components/breadcrumbs";
import { GallerySectionControls } from "@/components/gallery-section-controls";
import { GallerySectionIntro } from "@/components/gallery-section-intro";
import { GalleryGrid } from "@/components/gallery-grid";
import {
  LanguageSwitch,
  type LanguageLink,
} from "@/components/language-switch";
import type { GalleryContentPage } from "@/lib/content-page";
import { formatDate } from "@/lib/date-format";
import type { BuiltInLabels } from "@/lib/deployment-config";
import type {
  GallerySection,
  GallerySectionSummary,
} from "@/lib/gallery-sections";
import type { GallerySlice } from "@/lib/gallery-slice";

type ContentGalleryProps = {
  locale: string;
  page: GalleryContentPage;
  /**
   * One bounded page of the gallery's result, in its authoritative order. The
   * page and its result are read separately on purpose: a listing card projects
   * the page's fields without ever loading this.
   */
  slice: GallerySlice;
  /**
   * The request position that produced `slice`: the opaque cursor, or the
   * parameter-free first-page identity. It keys the stateful grid so a client
   * navigation to another server-rendered slice cannot retain the previous
   * request's items. This cannot be derived from an item id because adjacent
   * slices are explicitly allowed to overlap.
   */
  initialSliceKey: string;
  /**
   * This gallery's canonical, parameter-free path. The grid builds both the
   * continuation link and the endpoint address from it, so no content id
   * reaches the browser and no route knowledge is duplicated into a component.
   */
  galleryPath: string;
  /** The gallery's declared section catalog, already ordered. Empty for a
   * gallery with no sections, which renders no section controls at all. */
  sections: readonly GallerySectionSummary[];
  /**
   * The active named section, resolved from the request's slug against
   * `sections` on every slice — cursored or not. Drives the controls'
   * selected state and the grid's section-scoped continuation. `undefined`
   * means the unfiltered `All` view.
   */
  activeSection?: GallerySectionSummary;
  /**
   * The active named section, present only on the first, uncursored slice of
   * it — the one state that renders `GallerySectionIntro`'s required heading
   * and optional introduction. Distinct from `activeSection`, which is
   * present on every slice of that same section: this field's *absence* on a
   * continuation is what keeps the heading and introduction from repeating.
   */
  selectedSection?: GallerySection;
  /**
   * The gallery's parameter-free first page, present only when the visitor is
   * looking at a continuation. A continuation URL is indexable, so somebody can
   * arrive on slice four straight from a search result; without this they would
   * have no way back to the first three, because a cursor only points forward.
   */
  firstPageHref?: string;
  /**
   * Whether this render is a later slice rather than the gallery's first page.
   *
   * ADR-0003 decision 3 gives a continuation page a deliberately reduced shape:
   * a compact heading naming the gallery and the continuation, then the grid.
   * The lead, the long body, and the page-jump navigation are not repeated.
   */
  isContinuation?: boolean;
  /** Canonical ancestry, story root first, ending at this page. */
  breadcrumbs: readonly BreadcrumbStep[];
  languages: readonly LanguageLink[];
  labels: BuiltInLabels;
};

/**
 * One `gallery`-variant content page at its canonical detail route.
 *
 * The document order is ADR-0003 decision 3's, as far as this slice of it
 * exists: title, short lead, section controls, the selected section's own
 * heading and introduction, then the image grid. The page-jump navigation and
 * long-form body sit between the lead and the controls once AB#106 authors
 * them; neither renders here yet, so neither is stubbed.
 *
 * The cover is deliberately not repeated at the head of the page. A gallery's
 * cover is what a listing card shows, and the deterministic fallback makes it
 * the gallery's own first item — printing it above the grid would open every
 * gallery with the same photograph twice.
 *
 * A published gallery with no public items renders its own accessible empty
 * state rather than a 404: the page exists, it is simply between selections, and
 * an address a visitor may already hold should say so.
 *
 * A gallery longer than one page ends with a continuation link rather than a
 * button. ADR-0003 decision 8 requires a real `href`, so the next slice is
 * reachable, shareable, and crawlable with no JavaScript at all; AB#72's second
 * slice progressively enhances that same link into an in-place append.
 *
 * A continuation also offers the way back that a cursor cannot: tokens point
 * forward only, and a continuation URL is indexable, so a visitor can land on a
 * middle slice from a search result with no route to the items before it.
 *
 * That continuation page is deliberately thinner than the first (decision 3): a
 * compact heading naming the gallery and the continuation, then the grid. The
 * lead is editorial content that belongs to the gallery, and repeating it on
 * every slice would publish it several times over under several URLs.
 */
export function ContentGallery({
  locale,
  page,
  slice,
  initialSliceKey,
  galleryPath,
  sections,
  activeSection,
  selectedSection,
  firstPageHref,
  isContinuation = false,
  breadcrumbs,
  languages,
  labels,
}: ContentGalleryProps) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <Breadcrumbs label={labels.navigation.breadcrumb} steps={breadcrumbs} />

      <article>
        {isContinuation ? (
          // Compact and reduced, per decision 3: the heading still says which
          // gallery this is, and adds that it is a later part of it, so the page
          // has context and heading semantics without restating the editorial
          // content the first page already carries. The lead, the date, and the
          // tags belong to the gallery rather than to this slice of it.
          //
          // The language switch stays. Decision 7 gives it a defined behaviour
          // here — it opens the target language's first page and drops the
          // cursor — so removing it would take away working navigation the ADR
          // specifies. That it leads to a first page rather than an equivalent
          // slice is exactly why this page also names no `hreflang` alternates:
          // the visible control can explain itself, a metadata pair cannot.
          <header className="mt-6">
            <h1 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
              {page.title} — {labels.gallery.continued}
            </h1>
            <LanguageSwitch
              label={labels.contentTree.languages}
              links={languages}
            />
          </header>
        ) : (
          <header className="mt-6">
            <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
              {page.title}
            </h1>
            <time
              dateTime={page.publishedAt}
              className="mt-2 block text-sm text-foreground/60"
            >
              {formatDate(page.publishedAt, locale)}
            </time>
            <LanguageSwitch
              label={labels.contentTree.languages}
              links={languages}
            />
            {page.summary && (
              <p className="mt-6 max-w-2xl text-lg leading-8 text-foreground/80">
                {page.summary}
              </p>
            )}
          </header>
        )}

        <section
          aria-label={`${page.title} ${labels.gallery.images}`}
          className={isContinuation ? "mt-8" : "mt-12"}
        >
          {/*
            Section controls and the selected section's own heading render on
            every slice, including a continuation and the empty-section state
            (ADR-0003 decision 3): a visitor mid-gallery, or looking at a
            section with nothing in it yet, still needs a way to switch. The
            controls render nothing on their own when the gallery declares no
            sections; the heading and introduction render only when
            `selectedSection` is set, which the server limits to a named
            section's first, uncursored slice.
          */}
          <GallerySectionControls
            sections={sections}
            activeSlug={activeSection?.slug}
            galleryPath={galleryPath}
            labels={labels}
          />
          {selectedSection !== undefined && (
            <GallerySectionIntro section={selectedSection} />
          )}

          {slice.items.length > 0 ? (
            <GalleryGrid
              // Keyed by the slice this render starts from, so a client-side
              // navigation that lands on a different slice of the *same*
              // gallery remounts the grid instead of reusing it. The request
              // cursor, not the first item, identifies the slice: adjacent
              // pages may legally overlap. An in-place append does not change
              // this server-owned prop, so the accumulated items survive.
              key={initialSliceKey}
              label={page.title}
              initialSlice={slice}
              galleryPath={galleryPath}
              activeSection={activeSection?.slug}
              labels={labels}
            />
          ) : (
            <p className="mt-6 text-foreground/70">{labels.gallery.empty}</p>
          )}

          {/*
            The continuation control belongs to the grid, which owns what is
            loaded. This one only offers the way back, which is a property of
            the address rather than of the items on it.
          */}
          {firstPageHref !== undefined && (
            <p className="mt-6 flex justify-center">
              <Link
                href={firstPageHref}
                className="text-sm text-foreground/70 underline underline-offset-4 transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {labels.gallery.backToStart}
              </Link>
            </p>
          )}
        </section>

        {!isContinuation && page.tags && page.tags.length > 0 && (
          <footer className="mt-12 border-t border-black/10 pt-6 dark:border-white/15">
            <p className="text-xs font-medium uppercase tracking-wider text-foreground/70">
              {labels.contentTree.tags}
            </p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {page.tags.map((tag) => (
                <li
                  key={tag}
                  className="rounded border border-black/10 px-2.5 py-0.5 text-sm text-foreground/70 dark:border-white/15"
                >
                  {tag}
                </li>
              ))}
            </ul>
          </footer>
        )}
      </article>
    </main>
  );
}
