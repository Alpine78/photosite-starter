import Image from "next/image";
import Link from "next/link";
import { Breadcrumbs, type BreadcrumbStep } from "@/components/breadcrumbs";
import { formatDate } from "@/lib/date-format";
import type { BuiltInLabels } from "@/lib/deployment-config";
import { imageRenderProfiles } from "@/lib/image-delivery";
import type { ImageMedia } from "@/lib/media";

export type BranchCategoryLink = {
  readonly categoryId: string;
  readonly label: string;
  readonly href: string;
};

export type BranchContentCard = {
  readonly contentId: string;
  readonly title: string;
  readonly summary?: string;
  /** ISO 8601 date. */
  readonly publishedAt: string;
  readonly cover?: ImageMedia;
  /** The one canonical detail route, whichever listing the card appears in. */
  readonly href: string;
};

export type BranchLanguageLink = {
  readonly locale: string;
  /** The language's own name, so a visitor recognizes it without reading ours. */
  readonly label: string;
  readonly href: string;
  /** Says so when the target is the nearest page, not this exact one. */
  readonly note?: string;
};

type CategoryBranchProps = {
  locale: string;
  title: string;
  /** Omitted on the story root, which would be a one-step trail to itself. */
  breadcrumbs?: readonly BreadcrumbStep[];
  languages: readonly BranchLanguageLink[];
  childCategories: readonly BranchCategoryLink[];
  content: readonly BranchContentCard[];
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
 * A page with no cover renders as a text card rather than borrowing an image,
 * and a section with nothing in it is left out instead of announcing itself
 * empty.
 */
export function CategoryBranch({
  locale,
  title,
  breadcrumbs,
  languages,
  childCategories,
  content,
  labels,
}: CategoryBranchProps) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumbs label={labels.navigation.breadcrumb} steps={breadcrumbs} />
      )}

      <header className="mt-6">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {title}
        </h1>
      </header>

      {languages.length > 0 && (
        <nav aria-label={labels.contentTree.languages} className="mt-4">
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            {languages.map((language) => (
              <li key={language.locale}>
                <Link
                  href={language.href}
                  hrefLang={language.locale}
                  className={`text-foreground/70 underline underline-offset-4 hover:text-foreground ${focusRing}`}
                >
                  {language.label}
                </Link>
                {language.note && (
                  <span className="text-foreground/50"> ({language.note})</span>
                )}
              </li>
            ))}
          </ul>
        </nav>
      )}

      {childCategories.length > 0 && (
        <section aria-labelledby="branch-categories" className="mt-10">
          <h2
            id="branch-categories"
            className="text-xs font-medium uppercase tracking-wider text-foreground/50"
          >
            {labels.contentTree.categories}
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {childCategories.map((category) => (
              <li key={category.categoryId}>
                <Link
                  href={category.href}
                  className={`inline-block rounded-full border border-black/20 px-4 py-1.5 text-sm transition-colors hover:border-black/40 dark:border-white/20 dark:hover:border-white/40 ${focusRing}`}
                >
                  {category.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {content.length > 0 && (
        <section aria-labelledby="branch-content" className="mt-12">
          <h2
            id="branch-content"
            className="text-xs font-medium uppercase tracking-wider text-foreground/50"
          >
            {labels.contentTree.content}
          </h2>
          <ul className="mt-4 grid items-start gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {content.map((entry) => (
              <li key={entry.contentId}>
                <Link
                  href={entry.href}
                  className={`group flex h-full flex-col overflow-hidden rounded-lg border border-black/10 transition-colors hover:border-black/30 dark:border-white/15 dark:hover:border-white/40 ${focusRing}`}
                >
                  {entry.cover && (
                    <Image
                      src={entry.cover.rendition.src}
                      alt={entry.cover.alt}
                      width={entry.cover.rendition.width}
                      height={entry.cover.rendition.height}
                      sizes={imageRenderProfiles.contentListingGrid.sizes}
                      className="h-auto w-full"
                    />
                  )}
                  <div className="flex flex-1 flex-col p-6">
                    <h3 className="text-lg font-medium leading-snug tracking-tight">
                      {entry.title}
                    </h3>
                    {entry.summary && (
                      <p className="mt-2 text-sm text-foreground/70">
                        {entry.summary}
                      </p>
                    )}
                    <time
                      dateTime={entry.publishedAt}
                      className="mt-4 text-xs text-foreground/50"
                    >
                      {formatDate(entry.publishedAt, locale)}
                    </time>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
