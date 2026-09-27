import type { Metadata } from "next";
import { ContactForm } from "@/components/contact-form";
import { MediaFigure } from "@/components/media-figure";
import { resolveContactSubjectPrefill } from "@/lib/contact-details";
import { getServices } from "@/lib/services";
import { getDefaultLocaleLabels } from "@/lib/deployment-config";
import { getPageMetadata } from "@/lib/page-metadata";
import { getSiteSettings } from "@/lib/site-settings";

/**
 * The page carries no description of its own: the site's authored default
 * describes the deployment better than a sentence invented here would, and
 * `getPageMetadata` already supplies it in the locale it was authored in.
 */
export async function generateMetadata(): Promise<Metadata> {
  return getPageMetadata({
    path: "/contact",
    title: getDefaultLocaleLabels().pages.contact,
  });
}

type ContactPageProps = {
  searchParams: Promise<{ service?: string | string[] }>;
};

export default async function ContactPage({ searchParams }: ContactPageProps) {
  const [settings, services, query] = await Promise.all([
    getSiteSettings(),
    getServices(),
    searchParams,
  ]);
  const labels = getDefaultLocaleLabels();
  const subjects = services.map(({ serviceId, name }) => ({ serviceId, name }));
  const initialSubject = resolveContactSubjectPrefill(query.service, subjects);

  return (
    <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <h1 className="text-4xl font-semibold leading-none tracking-tight sm:text-6xl">
        {labels.pages.contact}
      </h1>
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
