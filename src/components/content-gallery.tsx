import Link from "next/link";
import { Breadcrumbs, type BreadcrumbStep } from "@/components/breadcrumbs";
import { GalleryGrid } from "@/components/gallery-grid";
import {
  LanguageSwitch,
  type LanguageLink,
} from "@/components/language-switch";
import type { GalleryContentPage } from "@/lib/content-page";
import { formatDate } from "@/lib/date-format";
import type { BuiltInLabels } from "@/lib/deployment-config";
import type { GalleryResultItem } from "@/lib/gallery-result";
import type { ImageMedia } from "@/lib/media";

type ContentGalleryProps = {
  locale: string;
  page: GalleryContentPage;
  /**
   * One bounded page of the gallery's result, in its authoritative order. The
   * page and its result are read separately on purpose: a listing card projects
   * the page's fields without ever loading this.
   */
  items: readonly GalleryResultItem<ImageMedia>[];
  /**
   * Where the next bounded page lives, when this one is not the last. The route
   * builds it, because it alone knows this gallery's canonical path; the token
   * inside it is the adapter's and is passed along untouched.
   */
  nextPageHref?: string;
  /**
   * The gallery's parameter-free first page, present only when the visitor is
   * looking at a continuation. A continuation URL is indexable, so somebody can
   * arrive on slice four straight from a search result; without this they would
   * have no way back to the first three, because a cursor only points forward.
   */
  firstPageHref?: string;
  /** Canonical ancestry, story root first, ending at this page. */
  breadcrumbs: readonly BreadcrumbStep[];
  languages: readonly LanguageLink[];
  labels: BuiltInLabels;
};

/**
 * One `gallery`-variant content page at its canonical detail route.
 *
 * The document order is ADR-0003 decision 3's, as far as this slice of it
 * exists: title, short lead, then the image grid. The page-jump navigation and
 * long-form body sit between them once AB#106 authors them, and the section
 * controls once AB#105 does; neither renders here, so neither is stubbed.
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
 */
export function ContentGallery({
  locale,
  page,
  items,
  nextPageHref,
  firstPageHref,
  breadcrumbs,
  languages,
  labels,
}: ContentGalleryProps) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <Breadcrumbs label={labels.navigation.breadcrumb} steps={breadcrumbs} />

      <article>
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

        <section
          aria-label={`${page.title} ${labels.gallery.images}`}
          className="mt-12"
        >
          {items.length > 0 ? (
            <GalleryGrid label={page.title} items={items} labels={labels} />
          ) : (
            <p className="text-foreground/70">{labels.gallery.empty}</p>
          )}

          {(nextPageHref !== undefined || firstPageHref !== undefined) && (
            <div className="mt-10 flex flex-col items-center gap-4">
              {nextPageHref !== undefined && (
                <Link
                  href={nextPageHref}
                  rel="next"
                  className="rounded-sm border border-black/15 px-5 py-2.5 text-sm font-medium transition-colors hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-white/20 dark:hover:bg-white/10"
                >
                  {labels.gallery.showMore}
                </Link>
              )}
              {firstPageHref !== undefined && (
                <Link
                  href={firstPageHref}
                  className="text-sm text-foreground/70 underline underline-offset-4 transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  {labels.gallery.backToStart}
                </Link>
              )}
            </div>
          )}
        </section>

        {page.tags && page.tags.length > 0 && (
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
