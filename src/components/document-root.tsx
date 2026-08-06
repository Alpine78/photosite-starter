import { Geist, Geist_Mono } from "next/font/google";
import { getDeploymentConfig } from "@/lib/deployment-config";
import { getLocaleRoute } from "@/lib/locale-routes";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

type DocumentRootProps = Readonly<{
  children: React.ReactNode;
  locale: string;
}>;

/** Validated document boundary shared by every locale root layout. */
export function DocumentRoot({ children, locale }: DocumentRootProps) {
  const deployment = getDeploymentConfig();
  const route = getLocaleRoute(deployment.localeRoutes, locale);
  if (route === undefined) {
    throw new TypeError(`locale "${locale}" is not configured`);
  }

  return (
    <html lang={route.locale}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} flex min-h-screen flex-col font-sans antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
