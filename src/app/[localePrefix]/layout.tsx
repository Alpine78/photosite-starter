import type { Metadata } from "next";
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
 * Every configured route space gets the same shell. `SiteRoot` resolves the
 * service and story entries in that locale and suppresses static routes that
 * have no same-language destination, so the shell does not send a visitor out
 * of their chosen language.
 */
export default async function LocaleRootLayout({
  children,
  params,
}: LocaleRootLayoutProps) {
  const { locale } = await getRouteShell(params);
  return <SiteRoot locale={locale}>{children}</SiteRoot>;
}
