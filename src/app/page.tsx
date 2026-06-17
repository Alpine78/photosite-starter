import Image from "next/image";
import Link from "next/link";
import { getSiteSettings } from "@/lib/site-settings";
import { getHomeContent } from "@/lib/home-content";

export default async function Home() {
  const [settings, home] = await Promise.all([
    getSiteSettings(),
    getHomeContent(),
  ]);
  const { hero, intro, sections } = home;

  return (
    <main>
      {/* Hero — full width, native aspect ratio, never cropped. Height
          follows the image's own ratio; width/height reserve space (no CLS). */}
      <section className="relative">
        <Image
          src={hero.image.src}
          alt={hero.image.alt}
          width={hero.image.width}
          height={hero.image.height}
          priority
          unoptimized
          className="h-auto w-full"
        />
        {/* Scrim keeps overlaid text legible over any image. A taller,
            deeper gradient gives the title room to read big and bold. */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-4 pb-8 pt-28 sm:px-6 sm:pb-14 sm:pt-40 lg:pb-20">
          <div className="mx-auto max-w-6xl">
            <h1 className="text-4xl font-semibold tracking-tight text-white drop-shadow-sm sm:text-6xl lg:text-7xl">
              {settings.siteName}
            </h1>
            {settings.tagline && (
              <p className="mt-3 max-w-2xl text-lg text-white/90 drop-shadow-sm sm:text-xl">
                {settings.tagline}
              </p>
            )}
            <Link
              href="/portfolio"
              className="mt-6 inline-flex items-center rounded-full bg-white px-6 py-3 text-sm font-medium text-black transition-colors hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:mt-8 sm:text-base"
            >
              View portfolio
            </Link>
          </div>
        </div>
      </section>

      {/* Intro */}
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <p className="text-lg leading-8 text-foreground/80">{intro}</p>
      </section>

      {/* Links to main sections */}
      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <ul className="grid gap-4 sm:grid-cols-3">
          {sections.map((section) => (
            <li key={section.href}>
              <Link
                href={section.href}
                className="group block h-full rounded-lg border border-black/10 p-6 transition-colors hover:border-black/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-white/15 dark:hover:border-white/40"
              >
                <h2 className="text-lg font-medium tracking-tight">
                  {section.title}
                </h2>
                <p className="mt-2 text-sm text-foreground/70">
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
