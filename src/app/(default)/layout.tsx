import type { Metadata } from "next";
import { SiteRoot } from "@/components/site-root";
import { getDeploymentConfig } from "@/lib/deployment-config";
import { getSiteMetadata } from "@/lib/page-metadata";
import "../globals.css";

/** Site-wide metadata in the unprefixed default-locale route space. */
export async function generateMetadata(): Promise<Metadata> {
  return getSiteMetadata();
}

export default function DefaultLocaleRootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <SiteRoot locale={getDeploymentConfig().localeRoutes.defaultLocale}>
      {children}
    </SiteRoot>
  );
}
