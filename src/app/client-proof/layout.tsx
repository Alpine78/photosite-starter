import type { Metadata } from "next";
import { DocumentRoot } from "@/components/document-root";
import { getBuiltInLabels } from "@/lib/deployment-config";
import { getRestrictedPageLocale } from "@/lib/restricted-page-locale-request";
import "../globals.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: getBuiltInLabels(await getRestrictedPageLocale()).proofGallery.title,
    robots: { index: false, follow: false }, referrer: "no-referrer" };
}

export default async function ProofGalleryLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <DocumentRoot locale={await getRestrictedPageLocale()}>{children}</DocumentRoot>;
}
