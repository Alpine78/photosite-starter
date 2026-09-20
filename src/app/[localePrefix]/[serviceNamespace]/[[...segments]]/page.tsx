import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { JsonLd } from "@/components/json-ld";
import { ServiceDetail, ServiceListing } from "@/components/service-pages";
import type { LanguageLink } from "@/components/language-switch";
import {
  getBuiltInLabels,
  getDeploymentConfig,
} from "@/lib/deployment-config";
import { buildServicePath, resolvePrefixedRoute } from "@/lib/locale-routes";
import { getPageMetadata } from "@/lib/page-metadata";
import {
  getServiceLocaleVersions,
  getServiceListingLocaleVersions,
  getServiceRoute,
  getServiceRoutes,
  getServicesIntro,
} from "@/lib/services";
import { buildServiceJsonLd } from "@/lib/structured-data";

type LocalizedServicePageProps = {
  params: Promise<{
    localePrefix: string;
    serviceNamespace: string;
    segments?: string[];
  }>;
};

function languageName(locale: string): string {
  return new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale;
}

async function serviceListingLanguageLinks(
  locale: string,
): Promise<readonly LanguageLink[]> {
  return (await getServiceListingLocaleVersions()).flatMap((version) =>
    version.locale === locale
      ? []
      : [{ locale: version.locale, label: languageName(version.locale), href: version.path }],
  );
}

async function resolveLocalizedServiceRequest(
  params: LocalizedServicePageProps["params"],
) {
  const { localePrefix, serviceNamespace, segments = [] } = await params;
  const { localeRoutes } = getDeploymentConfig();
  const resolved = resolvePrefixedRoute(localeRoutes, localePrefix, [
    serviceNamespace,
    ...segments,
  ]);
  if (resolved.kind !== "localized") notFound();
  const route = localeRoutes.byLocale.get(resolved.locale);
  if (route === undefined) throw new Error("a resolved locale route was not configured");
  if (!resolved.prefixIsCanonical || serviceNamespace !== route.serviceNamespace) {
    if (
      serviceNamespace.toLowerCase() === route.serviceNamespace &&
      resolved.prefixIsCanonical
    ) {
      permanentRedirect(buildServicePath(localeRoutes, route.locale, segments));
    }
    if (!resolved.prefixIsCanonical && serviceNamespace === route.serviceNamespace) {
      permanentRedirect(buildServicePath(localeRoutes, route.locale, segments));
    }
    notFound();
  }
  return { locale: route.locale, segments, localeRoutes };
}

export async function generateStaticParams() {
  const { localeRoutes } = getDeploymentConfig();
  const localizedRoutes = localeRoutes.locales.filter((route) => !route.isDefault);
  const entries = await Promise.all(
    localizedRoutes.map(async (route) => ({
      route,
      services: await getServiceRoutes(route.locale),
    })),
  );
  return entries.flatMap(({ route, services }) => [
    { localePrefix: route.prefix!, serviceNamespace: route.serviceNamespace },
    ...services.map((service) => ({
      localePrefix: route.prefix!,
      serviceNamespace: route.serviceNamespace,
      segments: [...service.path],
    })),
  ]);
}

export async function generateMetadata({ params }: LocalizedServicePageProps): Promise<Metadata> {
  const request = await resolveLocalizedServiceRequest(params);
  const labels = getBuiltInLabels(request.locale);
  const path = buildServicePath(request.localeRoutes, request.locale, request.segments);
  if (request.segments.length === 0) {
    return getPageMetadata({
      path,
      title: labels.pages.services,
      description: await getServicesIntro(),
      locale: request.locale,
      localeVersions: await getServiceListingLocaleVersions(),
    });
  }
  const route = await getServiceRoute(request.segments, request.locale);
  if (route === undefined) return {};
  return getPageMetadata({
    path,
    title: route.service.name,
    description: route.service.shortDescription,
    image: route.service.coverMedia,
    locale: request.locale,
    localeVersions: await getServiceLocaleVersions(route.service.serviceId),
  });
}

export default async function LocalizedServicePage({ params }: LocalizedServicePageProps) {
  const request = await resolveLocalizedServiceRequest(params);
  const labels = getBuiltInLabels(request.locale);
  const serviceRootPath = buildServicePath(request.localeRoutes, request.locale);
  const routes = await getServiceRoutes(request.locale);
  if (request.segments.length === 0) {
    return (
      <ServiceListing
        title={labels.pages.services}
        intro={await getServicesIntro()}
        serviceRootPath={serviceRootPath}
        routes={routes}
        languages={await serviceListingLanguageLinks(request.locale)}
        languageLabel={labels.contentTree.languages}
      />
    );
  }
  const route = await getServiceRoute(request.segments, request.locale);
  if (route === undefined) notFound();
  const servicePath = buildServicePath(request.localeRoutes, request.locale, route.path);
  const languages: readonly LanguageLink[] = (await getServiceLocaleVersions(
    route.service.serviceId,
  )).flatMap((version) =>
    version.locale === request.locale
      ? []
      : [{ locale: version.locale, label: languageName(version.locale), href: version.path }],
  );
  return (
    <>
      <JsonLd
        data={buildServiceJsonLd({
          service: route.service,
          deployment: getDeploymentConfig(),
          canonicalPath: servicePath,
        })}
      />
      <ServiceDetail
        service={route.service}
        serviceSegments={route.path}
        serviceRootPath={serviceRootPath}
        routes={routes}
        languages={languages}
        labels={labels}
      />
    </>
  );
}
