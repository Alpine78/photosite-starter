import { LanguageSwitch } from "@/components/language-switch";
import { serviceLanguageLinks } from "@/lib/service-language-links";
import { buildServicePath } from "@/lib/locale-routes";
import type { Metadata } from "next";
import { ContactCallToAction } from "@/components/contact-call-to-action";
import { ServiceCard } from "@/components/service-card";
import { getDefaultLocaleLabels, getDeploymentConfig } from "@/lib/deployment-config";
import { getPageMetadata } from "@/lib/page-metadata";
import { getServices, getServicesIntro, getServiceListingLocaleVersions } from "@/lib/services";
import { getSiteSettings } from "@/lib/site-settings";

/** Unprefixed default-locale services listing. */
export async function generateMetadata(): Promise<Metadata> {
  const { localeRoutes } = getDeploymentConfig();
  return getPageMetadata({
    path: buildServicePath(localeRoutes, localeRoutes.defaultLocale),
    locale: localeRoutes.defaultLocale,
    localeVersions: await getServiceListingLocaleVersions(),
    title: getDefaultLocaleLabels().pages.services,
    description: await getServicesIntro(),
  });
}

export default async function ServicesPage() {
  const [services, settings] = await Promise.all([getServices(), getSiteSettings()]);
  const labels = getDefaultLocaleLabels();
  const locale = getDeploymentConfig().localeRoutes.defaultLocale;
  const versions = await getServiceListingLocaleVersions();

  return (
    <main>
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <header className="max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {labels.pages.services}
          </h1>
          {settings.servicesIntro !== undefined && (
            <p className="mt-3 text-muted">{settings.servicesIntro}</p>
          )}
          <LanguageSwitch label={labels.contentTree.languages} links={serviceLanguageLinks(versions, locale)} />
        </header>

        {/* 1 / 2 / 3 columns. items-start lets each card keep its natural height
            (covers vary by native ratio; image-less cards don't stretch to match). */}
        <ul className="mt-12 grid items-start gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {services.filter((service) => service.hideFromListing !== true).map((service) => (
            <li key={service.slug}>
              <ServiceCard service={service} href={`/services/${service.slug}`} />
            </li>
          ))}
        </ul>
      </div>
      {settings.servicesContactCallToAction && (
        <ContactCallToAction
          content={settings.servicesContactCallToAction}
          contactLabel={labels.pages.contact}
          headingId="services-contact-call-to-action"
        />
      )}
    </main>
  );
}
