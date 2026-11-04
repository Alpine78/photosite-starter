import Link from "next/link";

import { GalleryGrid } from "@/components/gallery-grid";
import { GalleryItemEnquiry } from "@/components/gallery-item-enquiry";
import { LanguageSwitch, type LanguageLink } from "@/components/language-switch";
import { getBuiltInLabels, getDeploymentConfig } from "@/lib/deployment-config";
import { effectiveGalleryPresentation } from "@/lib/gallery-presentation";
import { projectGallerySlice } from "@/lib/gallery-slice-server";
import { keywordGalleryQuery, type KeywordGalleryRoute } from "@/lib/keyword-gallery-route";
import { languageName } from "@/lib/language-fallback";
import { buildSearchPath } from "@/lib/locale-routes";
import { getSiteSettings } from "@/lib/site-settings";

/** One first screen of a three-column grid, as a curated gallery page loads. */
const EAGER_ITEMS = 4;

export function keywordGalleryTitle(locale: string, titles: readonly string[]): string {
  const names = new Intl.ListFormat(locale, { type: "conjunction" }).format(titles);
  return getBuiltInLabels(locale).search.keywordTitle.replace("{names}", names);
}

/** The same selection in another language. The ids are language-neutral; a cursor is not. */
function languageLinks(locale: string, canonicalParam: string): readonly LanguageLink[] {
  const { localeRoutes } = getDeploymentConfig();
  return localeRoutes.locales.flatMap((route) =>
    route.locale === locale
      ? []
      : [{ locale: route.locale, label: languageName(route.locale), href: `${buildSearchPath(localeRoutes, route.locale)}?${keywordGalleryQuery(canonicalParam)}` }],
  );
}

/**
 * A virtual gallery from the address alone (ADR-0012 §8): the selection lives in the URL, so
 * a reload, a shared link and browser history all restore it. Rendered on the server, with
 * one bounded page; the grid appends the rest and offers a real link without JavaScript.
 */
export async function KeywordGalleryPage({ locale, route, enquire }: { readonly locale: string; readonly route: KeywordGalleryRoute; readonly enquire?: string }) {
  const labels = getBuiltInLabels(locale);
  const { localeRoutes } = getDeploymentConfig();
  const galleryPath = `${buildSearchPath(localeRoutes, locale)}?${keywordGalleryQuery(route.canonicalParam)}`;
  const title = keywordGalleryTitle(locale, route.titles);
  // Authorized on submit by `/api/enquiry`, as a curated gallery's form is.
  if (enquire !== undefined) return <GalleryItemEnquiry locale={locale} itemId={enquire} galleryTitle={title} galleryPath={galleryPath} labels={labels} />;
  const slice = projectGallerySlice(route.page);
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <LanguageSwitch label={labels.contentTree.languages} links={languageLinks(locale, route.canonicalParam)} />
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-muted">{labels.search.keywordSummary}</p>
      {slice.items.length > 0 ? (
        <div className="mt-6">
          <GalleryGrid
            // Client navigation to another selection or slice must not keep this one's items.
            key={`${locale}:${route.canonicalParam}:${route.cursor ?? ""}`}
            label={title}
            initialSlice={slice}
            galleryPath={galleryPath}
            continuationKind="keyword-gallery"
            // No gallery owns this page, so the site-wide settings decide.
            presentation={effectiveGalleryPresentation({}, await getSiteSettings())}
            eagerCount={route.cursor === undefined ? EAGER_ITEMS : 0}
            labels={labels}
          />
        </div>
      ) : (
        <p className="mt-6 text-muted">{labels.search.keywordNoResults}</p>
      )}
      {route.cursor !== undefined && (
        <p className="mt-6 flex justify-center">
          <Link href={galleryPath} className="underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
            {labels.search.keywordBackToStart}
          </Link>
        </p>
      )}
    </main>
  );
}
