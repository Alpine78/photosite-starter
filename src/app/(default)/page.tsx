import type { Metadata } from "next";
import Link from "next/link";
import { HeroOverlay } from "@/components/hero-overlay";
import { JsonLd } from "@/components/json-ld";
import { getDeploymentConfig } from "@/lib/deployment-config";
import { getSiteSettings } from "@/lib/site-settings";
import { getHomeContent } from "@/lib/home-content";
import { getPageMetadata } from "@/lib/page-metadata";
import {
  buildOrganizationJsonLd,
  buildWebSiteJsonLd,
} from "@/lib/structured-data";

/**
 * The unprefixed default-locale site root keeps the SiteSettings site name as
 * setting one of its own, and shares its hero as the page's social image.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { hero } = await getHomeContent();

  return getPageMetadata({ path: "/", image: hero.media });
}

export default async function Home() {
  const [settings, home] = await Promise.all([
    getSiteSettings(),
    getHomeContent(),
  ]);
  const { hero, intro, sections } = home;
  const deployment = getDeploymentConfig();

  return (
    <main>
      {/* WebSite + Organization: the site's identity, from SiteSettings and
          deployment config only (AB#86). Emitted here rather than in the
          layout so it stays on the site root, not every default-locale page. */}
      <JsonLd
        data={[
          buildWebSiteJsonLd({ settings, deployment }),
          buildOrganizationJsonLd({ settings, deployment }),
        ]}
      />
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

      {/* Intro */}
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <p className="text-lg leading-8 text-body">{intro}</p>
      </section>

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
    </main>
  );
}
