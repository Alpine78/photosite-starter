import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { getSiteSettings } from "@/lib/site-settings";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Root metadata comes from SiteSettings, never from hardcoded strings: a clone
 * rebrands by editing site settings (later, the CMS) and nothing else. The
 * template applies to child pages that set only a `title`, so each page defines
 * its own name and the site name is appended here.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { siteName, defaultSeo } = await getSiteSettings();

  return {
    title: {
      default: siteName,
      template: defaultSeo.titleTemplate,
    },
    description: defaultSeo.description,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const settings = await getSiteSettings();

  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} flex min-h-screen flex-col font-sans antialiased`}
      >
        <SiteHeader
          siteName={settings.siteName}
          navigation={settings.navigation}
        />
        <div className="flex-1">{children}</div>
        <SiteFooter
          contact={settings.contact}
          socialLinks={settings.socialLinks}
          footerLinks={settings.footerLinks}
          copyrightHolder={settings.copyrightHolder}
        />
      </body>
    </html>
  );
}
