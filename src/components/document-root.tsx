import { Geist_Mono, Instrument_Sans } from "next/font/google";
import { getDeploymentConfig } from "@/lib/deployment-config";
import { getLocaleRoute } from "@/lib/locale-routes";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme-preference";

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
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
    // The bootstrap may set `data-theme` before React hydrates (AB#173); that
    // attribute is the one intended difference from the server markup.
    //
    // The font variables sit on <html>, not <body>: `--font-family-sans` in
    // globals.css is declared on `:root` and resolves `var(--font-*)` there, so
    // a variable first defined on <body> left it invalid and the page fell back
    // to the browser's default face (AB#173).
    <html
      lang={route.locale}
      className={`${instrumentSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      {/* The App Router root document's own <head>, as Next's "preventing
          flash before hydration" guide uses it; `no-head-element` targets the
          Pages Router's next/head, which does not apply here. */}
      {/* eslint-disable-next-line @next/next/no-head-element */}
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body
        className="flex min-h-screen flex-col font-sans antialiased"
      >
        {children}
      </body>
    </html>
  );
}
