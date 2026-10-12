import { cache } from "react";
import { getDeploymentConfig } from "@/lib/deployment-config";
import { getHomeContent, type HomeContent } from "@/lib/home-content";
import { getSiteSettings, type SiteSettings } from "@/lib/site-settings";
import { staticPageVersions, type StaticPageKind } from "@/lib/static-page-routes";

export type StaticPageData = {
  readonly settings: SiteSettings;
  readonly home?: HomeContent;
};

/** Missing non-default translations are unavailable; required default copy still fails. */
export const getStaticPageData = cache(async (
  kind: StaticPageKind,
  locale: string,
): Promise<StaticPageData | undefined> => {
  try {
    if (kind === "contact") return { settings: await getSiteSettings(locale) };
    const [settings, home] = await Promise.all([
      getSiteSettings(locale),
      getHomeContent(locale),
    ]);
    return { settings, home };
  } catch (error) {
    const { contentSource, localeRoutes } = getDeploymentConfig();
    // The default singleton copy is required deployment configuration. Only
    // additional languages can be unpublished while translation is in progress.
    if (contentSource === "sanity" && locale !== localeRoutes.defaultLocale) {
      const [{ SanityHomeContentError }, { SanitySiteSettingsError }] = await Promise.all([
        import("@/lib/sanity-home-content"),
        import("@/lib/sanity-site-settings"),
      ]);
      if (
        (error instanceof SanityHomeContentError || error instanceof SanitySiteSettingsError)
        && error.rejection === "missing-translation"
      ) return undefined;
    }
    throw error;
  }
});

export const getStaticPageVersions = cache(async (kind: StaticPageKind) => {
  const { localeRoutes } = getDeploymentConfig();
  const available = await Promise.all(
    localeRoutes.locales.map(async (route) =>
      await getStaticPageData(kind, route.locale) === undefined ? [] : [route.locale]),
  );
  return staticPageVersions(localeRoutes, kind, available.flat());
});
