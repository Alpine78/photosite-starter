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

export const metadata: Metadata = {
  title: "PhotoSite Starter",
  description: "A modern, clonable photography website template",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const settings = await getSiteSettings();

  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} flex min-h-screen flex-col antialiased`}
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
