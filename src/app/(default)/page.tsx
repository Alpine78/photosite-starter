import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { JsonLd } from "@/components/json-ld";
import { getDeploymentConfig } from "@/lib/deployment-config";
import { getSiteSettings } from "@/lib/site-settings";
import { getHomeContent } from "@/lib/home-content";
import {
  HERO_CHROME_RESERVE_PX,
  HERO_IMAGE_SIZES,
} from "@/lib/image-delivery";
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
          Height follows its own ratio; width/height reserve space (no CLS).
          Video rendering is intentionally outside the current scope. */}
      {hero.media.type === "image" && (
        <section className="relative">
          <Image
            src={hero.media.rendition.src}
            alt={hero.media.alt}
            width={hero.media.rendition.width}
            height={hero.media.rendition.height}
            preload
            sizes={HERO_IMAGE_SIZES}
            className="h-auto w-full"
          />
          {/* The overlay band, not the photograph, is what's fold-safe
              (ADR-0016): its height is min(the image's own rendered height,
              the viewport height below the header), so the title, tagline
              and CTA always land inside the visible area on load, however
              tall the photograph itself turns out to be at this width. It's
              anchored to the TOP of the hero, not the image's bottom edge —
              anchoring to the bottom is exactly what let the overlay drift
              off-screen as the window widened. `dvh` (not `vh`) so a mobile
              browser's collapsing chrome can't reintroduce the same fault. */}
          <div
            className="absolute inset-x-0 top-0 flex flex-col justify-end bg-gradient-to-t from-black/80 via-black/40 to-transparent px-4 pb-8 sm:px-6 sm:pb-14 lg:pb-20"
            style={{
              height: `min(calc(100vw * ${hero.media.rendition.height} / ${hero.media.rendition.width}), calc(100dvh - ${HERO_CHROME_RESERVE_PX}px))`,
            }}
          >
            <div className="mx-auto max-w-6xl">
              <h1 className="text-4xl font-semibold tracking-tight text-white drop-shadow-sm sm:text-6xl lg:text-7xl">
                {settings.siteName}
              </h1>
              {settings.tagline && (
                <p className="mt-3 max-w-2xl text-lg text-white/90 drop-shadow-sm sm:text-xl">
                  {settings.tagline}
                </p>
              )}
              {hero.action && (
                <Link
                  href={hero.action.href}
                  className="mt-6 inline-flex items-center rounded-full bg-white px-6 py-3 text-sm font-medium text-black transition-colors hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:mt-8 sm:text-base"
                >
                  {hero.action.label}
                </Link>
              )}
            </div>
          </div>
        </section>
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
