import type { Metadata } from "next";

import { DocumentRoot } from "@/components/document-root";
import { getDeploymentConfig } from "@/lib/deployment-config";

import "../globals.css";

/**
 * The administrator document shell (ADR-0015 §1).
 *
 * Its own shell rather than the customer namespace's, for the reason the whole
 * boundary exists: the two surfaces share no route space, no session, and no
 * layout that could accidentally read one another's state. It carries no site
 * header, navigation, or footer — an operator signing in needs none of it, and
 * all of it would read the public content tree.
 *
 * `robots` is the page-level half of the namespace's `noindex, nofollow`; the
 * Proxy sets the `X-Robots-Tag` header half on every response here.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function PrivateGalleryAdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <DocumentRoot locale={getDeploymentConfig().localeRoutes.defaultLocale}>
      {children}
    </DocumentRoot>
  );
}
