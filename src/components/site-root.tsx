import {
  getBuiltInLabels,
  getDeploymentConfig,
} from "@/lib/deployment-config";
import { getContentTrees } from "@/lib/content";
import {
  buildSiteNavigation,
  resolveStaticNavigationLinks,
} from "@/lib/site-navigation";
import { getSiteSettings } from "@/lib/site-settings";
import { DocumentRoot } from "@/components/document-root";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

type SiteRootProps = Readonly<{
  children: React.ReactNode;
  locale: string;
}>;

/**
 * Default-locale document shell with the deployment-wide site chrome.
 * Localized route spaces add their own chrome only once localized settings and
 * labels exist; until then they use `DocumentRoot` directly for honest 404s.
 *
 * The menu and the footer links are composed here, on the server, from the
 * configured static links and this locale's category tree — the tree is read as
 * a category projection and carries no page body, cover, or listing row, so
 * putting the menu on every page costs the categories and nothing else. A
 * featured-page entry resolves against the same projection, which already holds
 * every placement's slug and canonical category.
 */
export async function SiteRoot({ children, locale }: SiteRootProps) {
  const [settings, trees] = await Promise.all([
    getSiteSettings(),
    getContentTrees(),
  ]);
  const labels = getBuiltInLabels(locale);
  const config = getDeploymentConfig().localeRoutes;
  const tree = trees.get(locale);

  return (
    <DocumentRoot locale={locale}>
      <SiteHeader
        siteName={settings.siteName}
        navigation={buildSiteNavigation({
          staticLinks: settings.navigation,
          config,
          locale,
          tree,
          ...(settings.featuredGalleryId === undefined
            ? {}
            : { featuredContentId: settings.featuredGalleryId }),
          storyLabel: labels.pages.stories,
        })}
        labels={labels.navigation}
      />
      <div className="flex-1">{children}</div>
      <SiteFooter
        contact={settings.contact}
        socialLinks={settings.socialLinks}
        footerLinks={resolveStaticNavigationLinks({
          links: settings.footerLinks,
          config,
          locale,
          tree,
          ...(settings.featuredGalleryId === undefined
            ? {}
            : { featuredContentId: settings.featuredGalleryId }),
        })}
        copyrightHolder={settings.copyrightHolder}
      />
    </DocumentRoot>
  );
}
