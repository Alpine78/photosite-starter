import Image from "next/image";
import { Breadcrumbs, type BreadcrumbStep } from "@/components/breadcrumbs";
import { ContentBody } from "@/components/content-body";
import {
  LanguageSwitch,
  type LanguageLink,
} from "@/components/language-switch";
import type { ContentPage } from "@/lib/content-page";
import { formatDate } from "@/lib/date-format";
import type { BuiltInLabels } from "@/lib/deployment-config";
import { imageRenderProfiles } from "@/lib/image-delivery";

type ContentArticleProps = {
  locale: string;
  page: ContentPage;
  /** Canonical ancestry, story root first, ending at this page. */
  breadcrumbs: readonly BreadcrumbStep[];
  languages: readonly LanguageLink[];
  labels: BuiltInLabels;
};

/**
 * One `article`-variant content page at its canonical detail route.
 *
 * The breadcrumb follows canonical ancestry whichever listing the visitor
 * arrived through — a secondary listing links here rather than creating a
 * second page — so what the trail states is where the page lives, not where it
 * was found.
 *
 * The cover renders at its native ratio over the rendition's true intrinsic
 * dimensions, never cropped, and a page without one simply omits it. Tags are
 * plain text: ADR-0003 keeps them separate from categories, and they own no
 * public route until the reserved keyword-query route exists.
 */
export function ContentArticle({
  locale,
  page,
  breadcrumbs,
  languages,
  labels,
}: ContentArticleProps) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <Breadcrumbs label={labels.navigation.breadcrumb} steps={breadcrumbs} />

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
      </header>

      {page.cover && (
        <Image
          src={page.cover.rendition.src}
          alt={page.cover.alt}
          width={page.cover.rendition.width}
          height={page.cover.rendition.height}
          sizes={imageRenderProfiles.articleContent.sizes}
          className="mt-8 h-auto w-full rounded-lg"
          priority
        />
      )}

      {page.summary && (
        <p className="mt-8 text-lg leading-8 text-foreground/80">
          {page.summary}
        </p>
      )}

      <div className="mt-10">
        <ContentBody blocks={page.body} labels={labels} />
      </div>

      {page.tags && page.tags.length > 0 && (
        <footer className="mt-12 border-t border-black/10 pt-6 dark:border-white/15">
          <p className="text-xs font-medium uppercase tracking-wider text-foreground/50">
            {labels.contentTree.tags}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {page.tags.map((tag) => (
              <span
                key={tag}
                className="rounded border border-black/10 px-2.5 py-0.5 text-sm text-foreground/70 dark:border-white/15"
              >
                {tag}
              </span>
            ))}
          </div>
        </footer>
      )}
    </main>
  );
}
