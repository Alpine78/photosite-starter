import { builtInLabels } from "@/lib/deployment-config";
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
 */
export async function SiteRoot({ children, locale }: SiteRootProps) {
  const settings = await getSiteSettings();

  return (
    <DocumentRoot locale={locale}>
      <SiteHeader
        siteName={settings.siteName}
        navigation={settings.navigation}
        labels={builtInLabels.navigation}
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
