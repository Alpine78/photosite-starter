import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/json-ld";
import {
  getDefaultLocaleLabels,
  getDeploymentConfig,
} from "@/lib/deployment-config";
import { imageRenderProfiles } from "@/lib/image-delivery";
import { getPageMetadata } from "@/lib/page-metadata";
import { getService, getServices } from "@/lib/services";
import { buildServiceJsonLd } from "@/lib/structured-data";

type ServicePageProps = {
  params: Promise<{ slug: string }>;
};

/**
 * Pre-render every default-locale service detail at build time.
 *
 * Under `SITE_CONTENT_SOURCE=sanity`, `getServices()` can throw a classified
 * `SanityServiceError`/`SanityQueryError` (AB#139 review note: a duplicated
 * slug, an unauthorized or unavailable Content Lake, a timeout). Left
 * uncaught here, that fails the whole production build rather than only a
 * request — a materially larger blast radius than the mock fixture this
 * function read before Sanity was wired in, which could never fail.
 *
 * That is intentional, not an oversight: this codebase's own rule is that a
 * classified content-source failure fails through its documented boundary
 * rather than silently rendering degraded content (AB#135's own acceptance
 * criteria state this explicitly), and a build is exactly the boundary a
 * bad or unreachable service catalog should stop at. The alternative —
 * catching the error and returning `[]` — would make the build succeed
 * looking green while quietly dropping every service detail page from
 * static generation with no visible signal, which this project treats as
 * worse than a red, retriable build. `dynamicParams` is not set on this
 * page (defaults to `true`), so this only governs whether service pages are
 * *pre*-rendered at build time; it is not what stands between a slug and a
 * 404 at request time.
 */
export async function generateStaticParams() {
  const services = await getServices();
  return services.map((service) => ({ slug: service.slug }));
}

export async function generateMetadata({
  params,
}: ServicePageProps): Promise<Metadata> {
  const { slug } = await params;
  const service = await getService(slug);
  // An unknown slug renders the not-found page; it gets no canonical URL of
  // its own and keeps the site-level defaults.
  if (!service) return {};

  return getPageMetadata({
    path: `/services/${service.slug}`,
    title: service.name,
    description: service.shortDescription,
    image: service.coverMedia,
  });
}

export default async function ServicePage({ params }: ServicePageProps) {
  const { slug } = await params;
  const service = await getService(slug);
  if (!service) notFound();
  const labels = getDefaultLocaleLabels();

  const { name, description, coverMedia, pricing } = service;

  return (
    <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      {/* Service structured data, from the Service record and deployment config
          only — no provider/offers entity is synthesized (AB#86). */}
      <JsonLd
        data={buildServiceJsonLd({
          service,
          deployment: getDeploymentConfig(),
        })}
      />

      {/* Breadcrumb */}
      <nav
        aria-label={labels.navigation.breadcrumb}
        className="text-sm text-foreground/60"
      >
        <ol className="flex flex-wrap items-center gap-1">
          <li>
            <Link
              href="/services"
              className="hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {labels.pages.services}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-foreground/80">{name}</li>
        </ol>
      </nav>

      <div className="mt-6 grid gap-12 lg:grid-cols-[1fr_20rem]">
        {/* Main content */}
        <article>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {name}
          </h1>
          <div className="mt-6 space-y-4 text-foreground/80">
            {description.map((paragraph, index) => (
              <p key={index} className="leading-7">
                {paragraph}
              </p>
            ))}
          </div>
          {coverMedia?.type === "image" && (
            <Image
              src={coverMedia.rendition.src}
              alt={coverMedia.alt}
              width={coverMedia.rendition.width}
              height={coverMedia.rendition.height}
              sizes={imageRenderProfiles.serviceContent.sizes}
              className="mt-8 h-auto w-full rounded-lg"
            />
          )}
        </article>

        {/* Pricing + contact CTA */}
        <aside className="lg:sticky lg:top-8 lg:self-start">
          {pricing && pricing.length > 0 && (
            <div className="rounded-lg border border-black/10 p-6 dark:border-white/15">
              <h2 className="text-lg font-medium tracking-tight">
                {labels.services.pricing}
              </h2>
              <dl className="mt-4 space-y-4">
                {pricing.map((pkg) => (
                  <div key={pkg.name}>
                    <div className="flex items-baseline justify-between gap-4">
                      <dt className="text-sm font-medium">{pkg.name}</dt>
                      <dd className="text-sm font-medium text-foreground/80">
                        {pkg.price}
                      </dd>
                    </div>
                    {pkg.note && (
                      <p className="mt-1 text-sm text-foreground/60">
                        {pkg.note}
                      </p>
                    )}
                  </div>
                ))}
              </dl>
            </div>
          )}

          <Link
            href={`/contact?service=${encodeURIComponent(name)}`}
            className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {labels.actions.contactAboutService}
            <span aria-hidden="true"> →</span>
          </Link>
        </aside>
      </div>
    </main>
  );
}
