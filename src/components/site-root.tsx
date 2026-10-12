import {
  getBuiltInLabels,
  getDeploymentConfig,
} from "@/lib/deployment-config";
import { getContentTrees } from "@/lib/content";
import { listStoryRootVersions } from "@/lib/content-routes";
import { buildFallbackLanguageLinks } from "@/lib/language-fallback";
import {
  buildSiteNavigation,
  resolveStaticNavigationLinks,
} from "@/lib/site-navigation";
import {
  getSiteSettings,
  resolveBrandDescriptor,
  resolveSiteName,
  type SiteSettings,
} from "@/lib/site-settings";
import { buildStaticPagePath, type StaticPageKind } from "@/lib/static-page-routes";
import { getStaticPageData } from "@/lib/static-pages";
import { DocumentRoot } from "@/components/document-root";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

/** This locale's descriptor with the name it sits beside, or nothing. */
function brandDescriptorProps(settings: SiteSettings, locale: string) {
  const brandDescriptor = resolveBrandDescriptor(settings, locale);
  return brandDescriptor === undefined
    ? {}
    : { brandDescriptor, brandName: settings.photographerName };
}

type SiteRootProps = Readonly<{
  children: React.ReactNode;
  locale: string;
}>;

/**
 * Locale-aware document shell with deployment-wide site chrome. Site settings
 * remain deployment-wide, but navigation resolves every service and story
 * destination in the locale being rendered and omits static routes that do
 * not have a same-language public page yet.
 *
 * The menu and the footer links are composed here, on the server, from the
 * configured static links and this locale's category tree, which carries no
 * page body, cover, or listing row. Static availability also reads the localized
 * settings/home projections, deduplicated with the page by React's request cache.
 * A featured-page entry resolves against the tree's placement and canonical category.
 */
export async function SiteRoot({ children, locale }: SiteRootProps) {
  const [contactPage, homePage, trees] = await Promise.all([
    getStaticPageData("contact", locale),
    // This read controls a link, not this page's content. A defective home
    // must not break contact, service or story pages. The home render and
    // sitemap still use the strict accessor and surface its original failure.
    getStaticPageData("home", locale).catch(() => undefined),
    getContentTrees(),
  ]);
  // Story pages remain readable while shared copy is awaiting translation.
  const settings = contactPage?.settings ?? await getSiteSettings();
  const staticPages: StaticPageKind[] = [
    ...(homePage === undefined ? [] : ["home" as const]),
    ...(contactPage === undefined ? [] : ["contact" as const]),
  ];
  const labels = getBuiltInLabels(locale);
  const config = getDeploymentConfig().localeRoutes;
  const tree = trees.get(locale);
  const route = config.byLocale.get(locale);
  if (route === undefined) throw new Error(`site root locale "${locale}" is not configured`);
  const siteName = resolveSiteName(settings, locale);

  return (
    <DocumentRoot locale={locale}>
      <SiteHeader
        siteName={siteName}
        {...(settings.logo === undefined ? {} : { logo: settings.logo.rendition })}
        {...(settings.logoDark === undefined ? {} : { logoDark: settings.logoDark.rendition })}
        {...brandDescriptorProps(settings, locale)}
        {...(homePage === undefined ? {} : { homeHref: buildStaticPagePath(config, locale, "home") })}
        contactHref={buildStaticPagePath(config, locale, "contact")}
        navigation={buildSiteNavigation({
          staticLinks: settings.navigation,
          config,
          locale,
          staticPages,
          tree,
          ...(settings.featuredGalleryId === undefined
            ? {}
            : { featuredContentId: settings.featuredGalleryId }),
          storyLabel: labels.pages.stories,
        })}
        labels={labels.navigation}
        themeLabels={labels.theme}
        languageMenuLabels={labels.languageMenu}
        fallbackLanguageLinks={buildFallbackLanguageLinks(
          listStoryRootVersions(config, trees),
          locale,
          labels.contentTree.storyRootFallback,
        )}
      />
      <div className="flex-1">{children}</div>
      <SiteFooter
        siteName={siteName}
        siteHost={getDeploymentConfig().canonicalBaseUrl.host}
        {...(settings.logo === undefined ? {} : { logo: settings.logo.rendition })}
        {...(settings.logoDark === undefined ? {} : { logoDark: settings.logoDark.rendition })}
        contact={settings.contact}
        socialLinks={settings.socialLinks}
        footerLinks={resolveStaticNavigationLinks({
          links: settings.footerLinks,
          config,
          locale,
          staticPages,
          tree,
          ...(settings.featuredGalleryId === undefined
            ? {}
            : { featuredContentId: settings.featuredGalleryId }),
        })}
        copyrightHolder={settings.copyrightHolder}
        labels={labels}
      />
    </DocumentRoot>
  );
}
