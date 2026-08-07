import type { Metadata } from "next";
import { ContactForm } from "@/components/contact-form";
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

export default async function ContactPage() {
  const settings = await getSiteSettings();
  const labels = getDefaultLocaleLabels();

  return (
    <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {labels.pages.contact}
        </h1>

        {/*
          The direct address is repeated here rather than left to the footer.
          When delivery fails in a way retrying cannot fix, the form tells the
          visitor to write directly instead — advice that needs a target on the
          page they are already looking at.
        */}
        <ul className="mt-4 space-y-1 text-foreground/70">
          <li>
            <a
              href={`mailto:${settings.contact.email}`}
              className="underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {settings.contact.email}
            </a>
          </li>
          {settings.contact.phone && (
            <li>
              <a
                href={`tel:${settings.contact.phone.replace(/\s+/g, "")}`}
                className="underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {settings.contact.phone}
              </a>
            </li>
          )}
        </ul>
      </header>

      <div className="mt-12">
        <ContactForm
          labels={labels.contact}
          privacyNotice={settings.contact.privacyNotice}
        />
      </div>
    </main>
  );
}
