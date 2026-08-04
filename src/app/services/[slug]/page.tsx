import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { builtInLabels } from "@/lib/deployment-config";
import { imageRenderProfiles } from "@/lib/image-delivery";
import { getService, getServices } from "@/lib/services";

type ServicePageProps = {
  params: Promise<{ slug: string }>;
};

/** Pre-render a page for every service at build time. */
export async function generateStaticParams() {
  const services = await getServices();
  return services.map((service) => ({ slug: service.slug }));
}

export async function generateMetadata({
  params,
}: ServicePageProps): Promise<Metadata> {
  const { slug } = await params;
  const service = await getService(slug);
  if (!service) return {};
  return {
    title: service.name,
    description: service.shortDescription,
  };
}

export default async function ServicePage({ params }: ServicePageProps) {
  const { slug } = await params;
  const service = await getService(slug);
  if (!service) notFound();

  const { name, description, coverMedia, pricing } = service;

  return (
    <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      {/* Breadcrumb */}
      <nav
        aria-label={builtInLabels.navigation.breadcrumb}
        className="text-sm text-foreground/60"
      >
        <ol className="flex flex-wrap items-center gap-1">
          <li>
            <Link
              href="/services"
              className="hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {builtInLabels.pages.services}
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
                {builtInLabels.services.pricing}
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
            {builtInLabels.actions.contactAboutService}
            <span aria-hidden="true"> →</span>
          </Link>
        </aside>
      </div>
    </main>
  );
}
