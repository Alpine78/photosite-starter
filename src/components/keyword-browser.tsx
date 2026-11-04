import Link from "next/link";

import { getBuiltInLabels, getDeploymentConfig } from "@/lib/deployment-config";
import { buildKeywordBrowserTree, type KeywordBrowserNode } from "@/lib/keyword-browser";
import { keywordGalleryQuery } from "@/lib/keyword-gallery-route";
import { getKeywordIndex } from "@/lib/keyword-index-access";
import { buildSearchPath } from "@/lib/locale-routes";

function countText(locale: string, count: number): string {
  const copy = getBuiltInLabels(locale).search;
  return (count === 1 ? copy.keywordCountOne : copy.keywordCountOther).replace("{count}", new Intl.NumberFormat(locale).format(count));
}

function KeywordList({ nodes, locale, searchPath, nested = false }: {
  readonly nodes: readonly KeywordBrowserNode[];
  readonly locale: string;
  readonly searchPath: string;
  readonly nested?: boolean;
}) {
  return (
    <ul className={nested ? "mt-2 space-y-2 border-l border-border pl-4" : "mt-3 space-y-2"}>
      {nodes.map(({ entry, children }) => (
        <li key={entry.keywordId}>
          <Link
            href={`${searchPath}?${keywordGalleryQuery(entry.keywordId)}`}
            className="underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {entry.title}
          </Link>{" "}
          <span className="text-sm text-muted">({countText(locale, entry.count)})</span>
          {children.length > 0 && <KeywordList nodes={children} locale={locale} searchPath={searchPath} nested />}
        </li>
      ))}
    </ul>
  );
}

/**
 * The public vocabulary as plain links (AB#75), so photographs can be found without typing
 * and without JavaScript. It belongs to the search landing state, which ADR-0012 §8 reserves
 * for it. That state is `noindex` and outside the sitemap, and so is what it links to. With
 * nothing to show, or a store that cannot answer, the landing state stays as it was: this
 * is an extra way in, and search must keep working without it.
 */
export async function KeywordBrowser({ locale }: { readonly locale: string }) {
  const labels = getBuiltInLabels(locale).search;
  let categories;
  try {
    categories = buildKeywordBrowserTree(await getKeywordIndex(locale));
  } catch (error) {
    console.error("[keyword-browser] unavailable", error instanceof Error ? `${error.name}: ${error.message}` : "unknown error");
    return null;
  }
  if (categories.length === 0) return null;
  const searchPath = buildSearchPath(getDeploymentConfig().localeRoutes, locale);
  return (
    <section aria-labelledby="keyword-browser-heading" className="mt-12">
      <h2 id="keyword-browser-heading" className="text-2xl font-semibold tracking-tight">{labels.keywordBrowseHeading}</h2>
      <div className="mt-6 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((category) => (
          <section key={category.slug} aria-labelledby={`keyword-category-${category.slug}`}>
            <h3 id={`keyword-category-${category.slug}`} className="text-lg font-medium">{category.title}</h3>
            <KeywordList nodes={category.roots} locale={locale} searchPath={searchPath} />
          </section>
        ))}
      </div>
    </section>
  );
}
