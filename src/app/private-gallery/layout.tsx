import type { Metadata } from "next";

import { DocumentRoot } from "@/components/document-root";
import { getDeploymentConfig } from "@/lib/deployment-config";

import "../globals.css";

/**
 * The private client-gallery document shell.
 *
 * Deliberately **not** `SiteRoot`: ADR-0014 §2 makes the private surface
 * structurally separate from the public one, so it carries no site header,
 * navigation, or footer — none of which a customer opening a delivery link
 * needs, and all of which would read the public content tree on a page that
 * must not touch it.
 *
 * `robots` here is the page-level half of §6's `noindex, nofollow`; the Proxy
 * sets the `X-Robots-Tag` header half on every response in this namespace.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function PrivateGalleryLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <DocumentRoot locale={getDeploymentConfig().localeRoutes.defaultLocale}>
      {children}
    </DocumentRoot>
  );
}
