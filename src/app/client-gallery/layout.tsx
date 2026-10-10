import type { Metadata } from "next";
import { DocumentRoot } from "@/components/document-root";
import { getBuiltInLabels, getDeploymentConfig } from "@/lib/deployment-config";
import "../globals.css";

export function generateMetadata(): Metadata {
  return { title: getBuiltInLabels(getDeploymentConfig().localeRoutes.defaultLocale).legacyGallery.title,
    robots: { index: false, follow: false }, referrer: "no-referrer" };
}

export default function LegacyGalleryLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <DocumentRoot locale={getDeploymentConfig().localeRoutes.defaultLocale}>{children}</DocumentRoot>;
}
