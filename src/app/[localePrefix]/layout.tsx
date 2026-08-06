import type { Metadata } from "next";
import { DocumentRoot } from "@/components/document-root";
import { getDeploymentConfig } from "@/lib/deployment-config";
import { resolveRouteShellLocale } from "@/lib/locale-routes";
import { getLocaleShellMetadata } from "@/lib/page-metadata";
import "../globals.css";

type LocaleRootLayoutProps = Readonly<{
  children: React.ReactNode;
  params: Promise<{ localePrefix: string }>;
}>;

async function getRouteLocale(
  params: LocaleRootLayoutProps["params"],
): Promise<string> {
  const { localePrefix } = await params;
  const { localeRoutes } = getDeploymentConfig();
  return resolveRouteShellLocale(localeRoutes, localePrefix);
}

/** Locale defaults omit copy that has no localized settings source yet. */
export async function generateMetadata({
  params,
}: LocaleRootLayoutProps): Promise<Metadata> {
  return getLocaleShellMetadata(await getRouteLocale(params));
}

export default async function LocaleRootLayout({
  children,
  params,
}: LocaleRootLayoutProps) {
  return (
    <DocumentRoot locale={await getRouteLocale(params)}>
      {children}
    </DocumentRoot>
  );
}
