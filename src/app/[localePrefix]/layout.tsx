import type { Metadata } from "next";
import { DocumentRoot } from "@/components/document-root";
import { SiteRoot } from "@/components/site-root";
import { getDeploymentConfig } from "@/lib/deployment-config";
import { resolveRouteShell, type RouteShell } from "@/lib/locale-routes";
import { getLocaleShellMetadata, getSiteMetadata } from "@/lib/page-metadata";
import "../globals.css";

type LocaleRootLayoutProps = Readonly<{
  children: React.ReactNode;
  params: Promise<{ localePrefix: string }>;
}>;

async function getRouteShell(
  params: LocaleRootLayoutProps["params"],
): Promise<RouteShell> {
  const { localePrefix } = await params;
  return resolveRouteShell(getDeploymentConfig().localeRoutes, localePrefix);
}

export async function generateMetadata({
  params,
}: LocaleRootLayoutProps): Promise<Metadata> {
  const { locale, isDefaultSpace } = await getRouteShell(params);
  // The unprefixed space is the one SiteSettings already describes; a prefixed
  // locale keeps the defaults that have no localized settings source yet.
  return isDefaultSpace ? getSiteMetadata() : getLocaleShellMetadata(locale);
}

/**
 * Document shell for the dynamic prefix segment.
 *
 * The unprefixed space gets the same site chrome as every other default-locale
 * page — its header and footer links are exactly the routes that space owns. A
 * prefixed locale gets the bare document instead: SiteSettings navigation and
 * footer content are authored once and point at unprefixed static routes, so
 * rendering them inside `/en` would lead a visitor out of the language they
 * chose. Pages there carry their own breadcrumbs and language switch until
 * localized settings and localized static routes land.
 */
export default async function LocaleRootLayout({
  children,
  params,
}: LocaleRootLayoutProps) {
  const { locale, isDefaultSpace } = await getRouteShell(params);

  return isDefaultSpace ? (
    <SiteRoot locale={locale}>{children}</SiteRoot>
  ) : (
    <DocumentRoot locale={locale}>{children}</DocumentRoot>
  );
}
