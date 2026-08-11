import {
  getBuiltInLabels,
  getDeploymentConfig,
} from "@/lib/deployment-config";
import { getContentTrees } from "@/lib/content";
import { buildSiteNavigation } from "@/lib/site-navigation";
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
 * The menu is composed here, on the server, from the configured static links
 * and this locale's category tree — the tree is read as a category projection
 * and carries no page body, cover, or listing row, so putting the menu on every
 * page costs the categories and nothing else.
 */
export async function SiteRoot({ children, locale }: SiteRootProps) {
  const [settings, trees] = await Promise.all([
    getSiteSettings(),
    getContentTrees(),
  ]);
  const labels = getBuiltInLabels(locale);

  return (
    <DocumentRoot locale={locale}>
      <SiteHeader
        siteName={settings.siteName}
        navigation={buildSiteNavigation({
          staticLinks: settings.navigation,
          config: getDeploymentConfig().localeRoutes,
          locale,
          tree: trees.get(locale),
          storyLabel: labels.pages.stories,
        })}
        labels={labels.navigation}
      />
      <div className="flex-1">{children}</div>
      <SiteFooter
        contact={settings.contact}
        socialLinks={settings.socialLinks}
        footerLinks={settings.footerLinks}
        copyrightHolder={settings.copyrightHolder}
      />
    </DocumentRoot>
  );
}
