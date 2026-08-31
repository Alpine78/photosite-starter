import Link from "next/link";
import { Breadcrumbs, type BreadcrumbStep } from "@/components/breadcrumbs";
import { ContentBody } from "@/components/content-body";
import { ContentPageJumpNav } from "@/components/content-page-jump-nav";
import {
  LanguageSwitch,
  type LanguageLink,
} from "@/components/language-switch";
import { MediaFigure } from "@/components/media-figure";
import { listContentHeadings } from "@/lib/content-headings";
import type { ArticleContentPage } from "@/lib/content-page";
import { formatDate } from "@/lib/date-format";
import type { BuiltInLabels } from "@/lib/deployment-config";
import { imageRenderProfiles } from "@/lib/image-delivery";

/** One neighbour in the global article sequence, at its canonical path. */
export type AdjacentPageLink = {
  readonly title: string;
  readonly href: string;
};

type ContentArticleProps = {
  locale: string;
  page: ArticleContentPage;
  /** Canonical ancestry, story root first, ending at this page. */
  breadcrumbs: readonly BreadcrumbStep[];
  languages: readonly LanguageLink[];
  /** The newer article in the global publication sequence, if there is one. */
  previous?: AdjacentPageLink;
  /** The older article in the global publication sequence, if there is one. */
  next?: AdjacentPageLink;
  labels: BuiltInLabels;
};

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

/**
 * One `article`-variant content page at its canonical detail route.
 *
 * The breadcrumb follows canonical ancestry whichever listing the visitor
 * arrived through — a secondary listing links here rather than creating a
 * second page — so what the trail states is where the page lives, not where it
 * was found. Sibling navigation preserves the pre-migration global article
 * sequence while each link still uses its page's canonical category path.
 *
 * The table of contents is derived from the body's level-2 headings, as
 * ADR-0003 decision 3 requires: no authoring toggle, and nothing rendered for a
 * body that has no headings to skip between.
 *
 * The cover renders through the same figure as body media, so a photograph's
 * caption and credit appear wherever it is placed, at its native ratio and
 * never cropped. A page without a cover simply omits it. Tags are plain text:
 * ADR-0003 keeps them separate from categories, and they own no public route
 * until the reserved keyword-query route exists.
 */
export function ContentArticle({
  locale,
  page,
  breadcrumbs,
  languages,
  previous,
  next,
  labels,
}: ContentArticleProps) {
  const headings = listContentHeadings(page.body);

  return (
    <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <Breadcrumbs label={labels.navigation.breadcrumb} steps={breadcrumbs} />

      <article>
        <header className="mt-6">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            {page.title}
          </h1>
          <time
            dateTime={page.publishedAt}
            className="mt-2 block text-sm text-subtle"
          >
            {formatDate(page.publishedAt, locale)}
          </time>
          <LanguageSwitch
            label={labels.contentTree.languages}
            links={languages}
          />
        </header>

        {page.cover && (
          <MediaFigure
            image={page.cover}
            sizes={imageRenderProfiles.contentBody.sizes}
            preload
            className="mt-8"
          />
        )}

        {page.summary && (
          <p className="mt-8 text-lg leading-8 text-body">
            {page.summary}
          </p>
        )}

        <ContentPageJumpNav
          label={labels.contentTree.onThisPage}
          headings={headings}
        />

        <div className="mt-10">
          <ContentBody blocks={page.body} labels={labels} />
        </div>

        {page.tags && page.tags.length > 0 && (
          <footer className="mt-12 border-t border-border pt-6">
            <p className="text-xs font-medium uppercase tracking-wider text-muted">
              {labels.contentTree.tags}
            </p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {page.tags.map((tag) => (
                <li
                  key={tag}
                  className="rounded-sm border border-border px-2.5 py-0.5 text-sm text-muted"
                >
                  {tag}
                </li>
              ))}
            </ul>
          </footer>
        )}
      </article>

      {(previous || next) && (
        <nav
          aria-label={labels.navigation.adjacentContent}
          className="mt-10 grid grid-cols-2 gap-4 border-t border-border pt-8"
        >
          <div>
            {previous && (
              <Link
                href={previous.href}
                className={`group flex flex-col gap-1 ${focusRing}`}
              >
                <span className="text-xs font-medium uppercase tracking-wider text-muted">
                  <span aria-hidden="true">← </span>
                  {labels.actions.previousPage}
                </span>
                <span className="text-sm font-medium leading-snug group-hover:underline">
                  {previous.title}
                </span>
              </Link>
            )}
          </div>
          <div className="text-right">
            {next && (
              <Link
                href={next.href}
                className={`group flex flex-col gap-1 ${focusRing}`}
              >
                <span className="text-xs font-medium uppercase tracking-wider text-muted">
                  {labels.actions.nextPage}
                  <span aria-hidden="true"> →</span>
                </span>
                <span className="text-sm font-medium leading-snug group-hover:underline">
                  {next.title}
                </span>
              </Link>
            )}
          </div>
        </nav>
      )}
    </main>
  );
}
