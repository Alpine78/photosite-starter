import Image from "next/image";
import Link from "next/link";
import { Breadcrumbs, type BreadcrumbStep } from "@/components/breadcrumbs";
import { CategoryDescription } from "@/components/category-description";
import {
  LanguageSwitch,
  type LanguageLink,
} from "@/components/language-switch";
import { formatDate } from "@/lib/date-format";
import type { BuiltInLabels } from "@/lib/deployment-config";
import { imageRenderProfiles } from "@/lib/image-delivery";
import type { ImageMedia } from "@/lib/media";
import type { CategoryDescriptionBlock } from "@/lib/category-description";

export type BranchCategoryLink = {
  readonly categoryId: string;
  readonly label: string;
  readonly href: string;
};

export type BranchContentCard = {
  readonly contentId: string;
  readonly title: string;
  readonly summary?: string;
  /**
   * ISO 8601 date: the page's effective event date (`eventDate ?? publishedAt`,
   * AB#150, ADR-0017) — never the raw `publishedAt`.
   */
  readonly eventDate: string;
  readonly author: string;
  readonly cover?: ImageMedia;
  /** The one canonical detail route, whichever listing the card appears in. */
  readonly href: string;
};

type CategoryBranchProps = {
  locale: string;
  title: string;
  /** Generic orientation copy shown only on the story root. */
  introduction?: string;
  /** Localized editorial copy shown below a category's sole h1. */
  description?: readonly CategoryDescriptionBlock[];
  /** Fixed explanatory copy carried by an explicit legacy fallback redirect. */
  legacyFallbackNotice?: string;
  /** Omitted on the story root, which would be a one-step trail to itself. */
  breadcrumbs?: readonly BreadcrumbStep[];
  languages: readonly LanguageLink[];
  childCategories: readonly BranchCategoryLink[];
  content: readonly BranchContentCard[];
  /** The root calls its cross-category overview "latest"; branches do not. */
  contentHeading: string;
  /**
   * This is a `?cursor=` continuation slice, not the branch's first page
   * (AB#140, ADR-0003 decision 8). The heading is marked "continued" and no
   * editorial framing (the story-root introduction or category description) is
   * repeated; child-category links stay, being navigation rather than
   * republished content.
   */
  isContinuation?: boolean;
  /** The branch's own parameter-free path, for the "back to the start" link. */
  firstPageHref?: string;
  /**
   * Present when a further page exists: a real `href` carrying the next
   * `?cursor=` URL, so the listing pages through with no JavaScript at all
   * (decision 8). Progressive in-place append is a later story.
   */
  continuation?: { readonly moreHref: string };
  labels: BuiltInLabels;
};

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

/**
 * One public content-tree branch: its ancestry, its public child categories,
 * and the content listed there.
 *
 * Covers render at their native ratio — `h-auto w-full` over the rendition's
 * true intrinsic dimensions — so a card never crops the photograph it presents.
 * The design proposal's fixed 3:2 crop is deliberately not reproduced (AB#173).
 * The summary is clamped to three lines on the card only; the page's own lead
 * and the card's accessible name are unaffected.
 * A page with no cover renders as a text card rather than borrowing an image,
 * and a section with nothing in it is left out instead of announcing itself
 * empty.
 */
export function CategoryBranch({
  locale,
  title,
  introduction,
  description,
  legacyFallbackNotice,
  breadcrumbs,
  languages,
  childCategories,
  content,
  contentHeading,
  isContinuation = false,
  firstPageHref,
  continuation,
  labels,
}: CategoryBranchProps) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumbs label={labels.navigation.breadcrumb} steps={breadcrumbs} />
      )}

      <header className="mt-6">
        <h1 className="text-4xl font-semibold leading-none tracking-tight sm:text-6xl">
          {isContinuation
            ? `${title} (${labels.contentTree.continued})`
            : title}
        </h1>
        {isContinuation && firstPageHref ? (
          <Link
            href={firstPageHref}
            className={`mt-3 inline-block text-sm underline underline-offset-4 transition-colors hover:text-foreground ${focusRing}`}
          >
            {labels.contentTree.backToStart}
          </Link>
        ) : (
          description !== undefined ? (
            <CategoryDescription blocks={description} />
          ) : (
            introduction && (
              <p className="mt-5 max-w-2xl text-lg text-muted sm:text-xl">{introduction}</p>
            )
          )
        )}
      </header>

      {legacyFallbackNotice && (
        <p
          role="status"
          className="mt-4 max-w-2xl rounded border border-border-control px-4 py-3 text-body"
        >
          {legacyFallbackNotice}
        </p>
      )}

      <LanguageSwitch
        label={labels.contentTree.languages}
        links={languages}
      />


      {childCategories.length > 0 && (
        <section aria-labelledby="branch-categories" className="mt-10">
          <h2
            id="branch-categories"
            className="text-xs font-semibold uppercase tracking-widest text-muted"
          >
            {labels.contentTree.categories}
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {childCategories.map((category) => (
              <li key={category.categoryId}>
                <Link
                  href={category.href}
                  className={`inline-block rounded-full border border-border-control px-5 py-2.5 text-base transition-colors hover:border-foreground ${focusRing}`}
                >
                  {category.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {content.length > 0 && (
        <section aria-labelledby="branch-content" className="mt-16 sm:mt-20">
          <h2
            id="branch-content"
            className="text-xs font-semibold uppercase tracking-widest text-muted"
          >
            {contentHeading}
          </h2>
          <ul className="mt-7 grid items-start gap-x-10 gap-y-14 sm:grid-cols-2">
            {content.map((entry) => (
              <li key={entry.contentId}>
                <Link
                  href={entry.href}
                  className={`group flex h-full flex-col gap-4 ${focusRing}`}
                >
                  {entry.cover && (
                    <Image
                      src={entry.cover.rendition.src}
                      alt={entry.cover.alt}
                      width={entry.cover.rendition.width}
                      height={entry.cover.rendition.height}
                      sizes={imageRenderProfiles.contentListingGrid.sizes}
                      className="h-auto w-full rounded-sm bg-surface-muted"
                    />
                  )}
                  <div className="flex flex-1 flex-col">
                    <h3 className="text-xl font-semibold leading-snug tracking-tight transition-colors group-hover:text-link-hover sm:text-2xl">
                      {entry.title}
                    </h3>
                    {entry.summary && (
                      <p className="mt-2 line-clamp-3 max-w-prose text-base leading-relaxed text-muted sm:text-lg">
                        {entry.summary}
                      </p>
                    )}
                    <p className="mt-3 text-sm text-muted">
                      <span>{entry.author}</span>
                      <span className="mx-1.5">·</span>
                      <time dateTime={entry.eventDate}>
                        {formatDate(entry.eventDate, locale)}
                      </time>
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {continuation && (
            <p className="mt-10">
              <Link
                href={continuation.moreHref}
                className={`inline-block rounded-full border border-border-control px-5 py-2 text-sm transition-colors hover:border-border-strong ${focusRing}`}
              >
                {labels.contentTree.showMoreContent}
              </Link>
            </p>
          )}
        </section>
      )}
    </main>
  );
}
