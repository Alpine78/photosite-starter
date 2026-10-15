import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LanguageSwitch } from "@/components/language-switch";
import { languageName } from "@/lib/language-fallback";
import { buildStaticPagePath } from "@/lib/static-page-routes";
import { getStaticPageData, getStaticPageVersions } from "@/lib/static-pages";
import { ContactCallToAction } from "@/components/contact-call-to-action";
import { HeroOverlay } from "@/components/hero-overlay";
import { HomeLatestStories } from "@/components/home-latest-stories";
import { HomePhotographerIntroduction } from "@/components/home-photographer-introduction";
import { HomePortfolio } from "@/components/home-portfolio";
import { JsonLd } from "@/components/json-ld";
import { getBuiltInLabels, getDeploymentConfig } from "@/lib/deployment-config";
import { getContentTrees, getLatestContent } from "@/lib/content";
import { listStoryRootVersions } from "@/lib/content-routes";
import { effectiveArticleAuthor } from "@/lib/content-page";
import { buildServicePath, buildStoryPath } from "@/lib/locale-routes";

import { resolveFeaturedGalleryHref } from "@/lib/home-content";
import { getGalleryPage, GalleryOrderingStaleError, UnknownGallerySectionError } from "@/lib/gallery";
import { MAX_ITEM_ID_LENGTH } from "@/lib/gallery-pagination";
import { projectGallerySlice } from "@/lib/gallery-slice-server";
import type { CuratedGalleryPage } from "@/lib/gallery-sections";
import { getPageMetadata } from "@/lib/page-metadata";
import {
  LEGACY_FALLBACK_NOTICE_PARAM,
  isLegacyFallbackNotice,
} from "@/lib/legacy-redirects";
import {
  buildOrganizationJsonLd,
  buildWebSiteJsonLd,
} from "@/lib/structured-data";

/** How many stories the home page's latest-stories section shows (design frame 05). */
const HOME_LATEST_STORY_COUNT = 2;

/**
 * Each locale's home keeps its authored site name and shares its hero as the
 * page's social image.
 */
type HomePageProps = {
  locale: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function homeMetadata({ searchParams, locale }: HomePageProps): Promise<Metadata> {
  const data = await getStaticPageData("home", locale);
  if (data?.home === undefined) return {};
  const { hero } = data.home;
  const params = await searchParams;

  return getPageMetadata({
    path: buildStaticPagePath(getDeploymentConfig().localeRoutes, locale, "home"),
    locale,
    description: data.settings.defaultSeo.description,
    ...(isLegacyFallbackNotice(params[LEGACY_FALLBACK_NOTICE_PARAM]) || params.topic !== undefined
      ? {} : { localeVersions: await getStaticPageVersions("home") }),
    image: hero.media,
    ...(isLegacyFallbackNotice(params[LEGACY_FALLBACK_NOTICE_PARAM]) || params.topic !== undefined
      ? { noindex: true }
      : {}),
  });
}

export async function HomePage({ searchParams, locale }: HomePageProps) {
  const data = await getStaticPageData("home", locale);
  if (data?.home === undefined) notFound();
  const { settings, home } = data;
  const languages = (await getStaticPageVersions("home")).flatMap((version) =>
    version.locale === locale
      ? []
      : [{ locale: version.locale, label: languageName(version.locale), href: version.path }],
  );
  const { hero, intro, photographerIntroduction, contactCallToAction, sections } = home;
  const deployment = getDeploymentConfig();
  const labels = getBuiltInLabels(locale);
  const params = await searchParams;
  const legacyFallbackNotice = isLegacyFallbackNotice(
    params[LEGACY_FALLBACK_NOTICE_PARAM],
  )
    ? labels.contentTree.legacyFallbackNotice
    : undefined;
  const galleryPath = await resolveFeaturedGalleryHref(deployment.localeRoutes, locale);
  // The latest stories (AB#252): the two most recently updated public stories,
  // and the story root they lead to when this locale publishes one.
  const [latest, trees] = await Promise.all([
    getLatestContent(locale, HOME_LATEST_STORY_COUNT),
    getContentTrees(),
  ]);
  const storiesHref = listStoryRootVersions(deployment.localeRoutes, trees).some(
    (version) => version.locale === locale,
  )
    ? buildStoryPath(deployment.localeRoutes, locale)
    : undefined;
  const latestStories = latest.map((entry) => ({
    contentId: entry.contentId,
    title: entry.title,
    variant: entry.variant,
    ...(entry.imageCount === undefined ? {} : { imageCount: entry.imageCount }),
    ...(entry.summary === undefined ? {} : { summary: entry.summary }),
    eventDate: entry.eventDate,
    author: entry.variant === "article"
      ? effectiveArticleAuthor(entry, settings)
      : settings.photographerName,
    ...(entry.cover === undefined ? {} : { cover: entry.cover }),
    href: buildStoryPath(deployment.localeRoutes, locale, entry.path),
  }));
  // Authored section slugs are bounded by the same identity limit. Longer
  // untrusted values cannot match a published topic and stay on the All view.
  const requestedTopic =
    typeof params.topic === "string" && params.topic.length <= MAX_ITEM_ID_LENGTH
      ? params.topic
      : undefined;
  let portfolioPage: CuratedGalleryPage | undefined;
  let portfolioReordering = false;
  if (galleryPath !== undefined && settings.featuredGalleryId !== undefined) {
    try {
      portfolioPage = await getGalleryPage(
        locale, settings.featuredGalleryId, undefined, requestedTopic,
        { includeTopicCounts: true },
      );
    } catch (error) {
      if (error instanceof UnknownGallerySectionError) {
        // The home entry point stays usable when an old or mistyped topic URL arrives.
        try {
          portfolioPage = await getGalleryPage(
            locale, settings.featuredGalleryId, undefined, undefined,
            { includeTopicCounts: true },
          );
        } catch (retryError) {
          if (retryError instanceof GalleryOrderingStaleError) portfolioReordering = true;
          else throw retryError;
        }
      } else if (error instanceof GalleryOrderingStaleError) {
        portfolioReordering = true;
      } else {
        throw error;
      }
    }
  }

  return (
    <main>
      {/* WebSite + Organization: the site's identity, from SiteSettings and
          deployment config only (AB#86). Emitted here rather than in the
          layout so it stays on the site root, not every default-locale page. */}
      {locale === deployment.localeRoutes.defaultLocale && (
        <JsonLd
          data={[
            buildWebSiteJsonLd({ settings, deployment }),
            buildOrganizationJsonLd({ settings, deployment }),
          ]}
        />
      )}
      {/* Hero image — full width, native aspect ratio, never cropped, never
          capped: it may render taller than the viewport (AB#148, ADR-0016).
          `HeroOverlay` (extracted for AB#149, ADR-0016's own action item) is
          the one shared mechanism for this and the content-page heroes.
          Video rendering is intentionally outside the current scope. */}
      {hero.media.type === "image" && (
        <HeroOverlay
          media={hero.media}
          title={settings.siteName}
          description={settings.tagline}
          action={hero.action}
        />
      )}

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <LanguageSwitch label={labels.contentTree.languages} links={languages} />
      </div>

      {legacyFallbackNotice && (
        <div className="mx-auto max-w-3xl px-4 pt-8 sm:px-6">
          <p
            role="status"
            className="rounded border border-border-control px-4 py-3 text-body"
          >
            {legacyFallbackNotice}
          </p>
        </div>
      )}

      {photographerIntroduction ? (
        <HomePhotographerIntroduction
          introduction={photographerIntroduction}
          contactLabel={labels.pages.contact}
          servicesLabel={labels.pages.services}
          contactHref={buildStaticPagePath(deployment.localeRoutes, locale, "contact")}
          servicesHref={buildServicePath(deployment.localeRoutes, locale)}
        />
      ) : (
        <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <p className="text-lg leading-8 text-body">{intro}</p>
        </section>
      )}

      <HomeLatestStories
        entries={latestStories}
        {...(storiesHref === undefined ? {} : { storiesHref })}
        locale={locale}
        labels={labels}
      />

      {galleryPath && portfolioPage && (
        <HomePortfolio
          galleryPath={galleryPath}
          sections={portfolioPage.sections}
          activeSlug={portfolioPage.selectedSection?.slug}
          topicCounts={portfolioPage.topicCounts}
          slice={projectGallerySlice(portfolioPage)}
          enquiriesEnabled={portfolioPage.allowPhotoEnquiries !== false}
          locale={locale}
          labels={labels}
        />
      )}
      {portfolioReordering && (
        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6" aria-labelledby="home-portfolio-heading">
          <h2 id="home-portfolio-heading" className="text-3xl font-semibold tracking-tight">
            {labels.homePortfolio.heading}
          </h2>
          <p className="mt-4 text-body">{labels.gallery.reorderingTitle}</p>
        </section>
      )}

      {/* Links to main sections */}
      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <ul className="grid gap-4 sm:grid-cols-3">
          {sections.map((section) => (
            <li key={section.href}>
              <Link
                href={section.href}
                className="group block h-full rounded-lg border border-border p-6 transition-colors hover:border-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <h2 className="text-lg font-medium tracking-tight">
                  {section.title}
                </h2>
                <p className="mt-2 text-sm text-muted">
                  {section.description}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      {contactCallToAction && (
        <ContactCallToAction
          content={contactCallToAction}
          contactLabel={labels.pages.contact}
          contactHref={buildStaticPagePath(deployment.localeRoutes, locale, "contact")}
          headingId="home-contact-call-to-action"
        />
      )}
    </main>
  );
}
