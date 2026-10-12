import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LanguageSwitch } from "@/components/language-switch";
import { languageName } from "@/lib/language-fallback";
import { buildStaticPagePath } from "@/lib/static-page-routes";
import { getStaticPageData, getStaticPageVersions } from "@/lib/static-pages";
import { ContactForm } from "@/components/contact-form";
import { MediaFigure } from "@/components/media-figure";
import { resolveContactSubjectPrefill } from "@/lib/contact-details";
import { getServices } from "@/lib/services";
import { getBuiltInLabels, getDeploymentConfig } from "@/lib/deployment-config";
import { getPageMetadata } from "@/lib/page-metadata";
/**
 * Reuse the site's authored SEO description in this page's requested language.
 */
export async function contactMetadata(locale: string): Promise<Metadata> {
  const data = await getStaticPageData("contact", locale);
  if (data === undefined) return {};
  return getPageMetadata({
    path: buildStaticPagePath(getDeploymentConfig().localeRoutes, locale, "contact"),
    title: getBuiltInLabels(locale).pages.contact,
    locale,
    description: data.settings.defaultSeo.description,
    localeVersions: await getStaticPageVersions("contact"),
  });
}

type ContactPageProps = {
  locale: string;
  searchParams: Promise<{ service?: string | string[] }>;
};

export async function ContactPage({ searchParams, locale }: ContactPageProps) {
  const [data, services, ownerServices, query] = await Promise.all([
    getStaticPageData("contact", locale),
    getServices(locale),
    getServices(),
    searchParams,
  ]);
  if (data === undefined) notFound();
  const { settings } = data;
  const labels = getBuiltInLabels(locale);
  // The fixed endpoint validates stable identities against the owner catalog.
  const acceptedIds = new Set(ownerServices.map((service) => service.serviceId));
  const subjects = services
    .filter((service) => acceptedIds.has(service.serviceId))
    .map(({ serviceId, name }) => ({ serviceId, name }));
  const languages = (await getStaticPageVersions("contact")).flatMap((version) =>
    version.locale === locale
      ? []
      : [{ locale: version.locale, label: languageName(version.locale), href: version.path }],
  );
  const initialSubject = resolveContactSubjectPrefill(query.service, subjects);

  return (
    <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <h1 className="text-4xl font-semibold leading-none tracking-tight sm:text-6xl">
        {labels.pages.contact}
      </h1>
      <LanguageSwitch label={labels.contentTree.languages} links={languages} />
      <div className="mt-12 grid gap-12 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
        <ContactForm
          key={initialSubject}
          labels={labels.contact}
          privacyNotice={settings.contact.privacyNotice}
          services={subjects}
          initialSubject={initialSubject}
        />

        <aside className="space-y-8 lg:self-start">
          {settings.contact.portrait && (
            <MediaFigure
              image={settings.contact.portrait}
              sizes="(min-width: 1024px) 352px, (min-width: 640px) 448px, calc(100vw - 32px)"
              className="max-w-md"
            />
          )}
          <div>
            <h2 className="font-medium">{labels.contact.directContactTitle}</h2>
            <ul className="mt-3 space-y-2 text-muted">
              <li>
                <a href={`mailto:${settings.contact.email}`} className="underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
                  {settings.contact.email}
                </a>
              </li>
              {settings.contact.phone && (
                <li>
                  <a href={`tel:${settings.contact.phone.replace(/\s+/g, "")}`} className="underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
                    {settings.contact.phone}
                  </a>
                </li>
              )}
            </ul>
          </div>
          {settings.socialLinks.length > 0 && (
            <div>
              <h2 className="font-medium">{labels.contact.socialLinksTitle}</h2>
              <ul className="mt-3 space-y-2 text-muted">
                {settings.socialLinks.map((link) => (
                  <li key={`${link.platform}-${link.url}`}>
                    <a href={link.url} className="underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
