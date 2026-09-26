import Image from "next/image";
import Link from "next/link";

import { Breadcrumbs, type BreadcrumbStep } from "@/components/breadcrumbs";
import {
  LanguageSwitch,
  type LanguageLink,
} from "@/components/language-switch";
import { ServiceCard } from "@/components/service-card";
import type { BuiltInLabels } from "@/lib/deployment-config";
import { imageRenderProfiles } from "@/lib/image-delivery";
import type { ResolvedService } from "@/lib/service-routes";
import type { Service } from "@/lib/services";

type ServiceListingProps = {
  readonly title: string;
  readonly intro?: string;
  readonly serviceRootPath: string;
  readonly routes: readonly ResolvedService[];
  readonly languages?: readonly LanguageLink[];
  readonly languageLabel?: string;
};

/** The localized service catalog. Route resolution supplies every card URL. */
export function ServiceListing({
  title,
  intro,
  serviceRootPath,
  routes,
  languages = [],
  languageLabel,
}: ServiceListingProps) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <header className="max-w-2xl">
        <h1 className="text-4xl font-semibold leading-none tracking-tight sm:text-6xl">
          {title}
        </h1>
        {intro !== undefined && <p className="mt-5 text-lg text-muted sm:text-xl">{intro}</p>}
        {languageLabel !== undefined && (
          <LanguageSwitch label={languageLabel} links={languages} />
        )}
      </header>

      <ul className="mt-12 grid items-start gap-x-10 gap-y-14 sm:mt-16 sm:grid-cols-2">
        {routes.map((route) => (
          <li key={route.service.serviceId}>
            <ServiceCard
              service={route.service}
              href={`${serviceRootPath}/${route.path.join("/")}`}
            />
          </li>
        ))}
      </ul>
    </main>
  );
}

type ServiceDetailProps = {
  readonly service: Service;
  readonly serviceSegments: readonly string[];
  readonly serviceRootPath: string;
  /** The locale's resolved catalog, used only for parent breadcrumbs. */
  readonly routes: readonly ResolvedService[];
  readonly languages: readonly LanguageLink[];
  readonly labels: BuiltInLabels;
  /** Omitted until this locale publishes a same-language contact route. */
  readonly contactHref?: string;
};

/**
 * One localized service detail. It receives resolved paths and already-loaded
 * data, so it never guesses a namespace, a parent URL, or a language target.
 */
export function ServiceDetail({
  service,
  serviceSegments,
  serviceRootPath,
  routes,
  languages,
  labels,
  contactHref,
}: ServiceDetailProps) {
  const ancestors = routes
    .filter(
      (route) =>
        route.path.length < serviceSegments.length &&
        route.path.every((segment, index) => segment === serviceSegments[index]),
    )
    .sort((left, right) => left.path.length - right.path.length);
  const breadcrumbs: readonly BreadcrumbStep[] = [
    { label: labels.pages.services, href: serviceRootPath },
    ...ancestors.map((ancestor) => ({
      label: ancestor.service.name,
      href: `${serviceRootPath}/${ancestor.path.join("/")}`,
    })),
    { label: service.name },
  ];

  return (
    <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <Breadcrumbs label={labels.navigation.breadcrumb} steps={breadcrumbs} />

      <div className="mt-6 grid gap-12 lg:grid-cols-[1fr_20rem]">
        <article>
          <h1 className="text-4xl font-semibold leading-none tracking-tight sm:text-6xl">
            {service.name}
          </h1>
          <LanguageSwitch label={labels.contentTree.languages} links={languages} />
          <div className="mt-8 space-y-5 text-lg text-body">
            {service.description.map((paragraph, index) => (
              <p key={index} className="leading-8">
                {paragraph}
              </p>
            ))}
          </div>
          {service.coverMedia?.type === "image" && (
            <Image
              src={service.coverMedia.rendition.src}
              alt={service.coverMedia.alt}
              width={service.coverMedia.rendition.width}
              height={service.coverMedia.rendition.height}
              sizes={imageRenderProfiles.serviceContent.sizes}
              className="mt-8 h-auto w-full rounded-lg"
            />
          )}
        </article>

        <aside className="lg:sticky lg:top-8 lg:self-start">
          {service.pricing && service.pricing.length > 0 && (
            <div className="rounded-md border border-border p-8">
              <h2 className="text-xl font-semibold tracking-tight">
                {labels.services.pricing}
              </h2>
              <dl className="mt-4 space-y-4">
                {service.pricing.map((pkg) => (
                  <div key={pkg.name}>
                    <div className="flex items-baseline justify-between gap-4">
                      <dt className="text-sm font-medium">{pkg.name}</dt>
                      <dd className="text-sm font-medium text-body">{pkg.price}</dd>
                    </div>
                    {pkg.note && <p className="mt-1 text-sm text-subtle">{pkg.note}</p>}
                  </div>
                ))}
              </dl>
            </div>
          )}

          {contactHref !== undefined && (
            <Link
              href={`${contactHref}?service=${encodeURIComponent(service.name)}`}
              className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {labels.actions.contactAboutService}
              <span aria-hidden="true"> →</span>
            </Link>
          )}
        </aside>
      </div>
    </main>
  );
}
