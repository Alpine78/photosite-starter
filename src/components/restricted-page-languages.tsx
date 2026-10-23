import { getBuiltInLabels, getDeploymentConfig } from "@/lib/deployment-config";
import { languageName } from "@/lib/language-fallback";
import { restrictedLocaleHref } from "@/lib/restricted-page-locale";
import { RestrictedLanguageSwitch } from "./restricted-language-switch";

export function RestrictedPageLanguages({ pathname, locale, requireCleanUrl = false, keepSelectionKey = false }: { pathname: string; locale: string; requireCleanUrl?: boolean; keepSelectionKey?: boolean }) {
  const labels = getBuiltInLabels(locale);
  const links = getDeploymentConfig().localeRoutes.locales
    .filter((route) => route.locale !== locale)
    .map((route) => ({ locale: route.locale, label: languageName(route.locale), href: restrictedLocaleHref(pathname, route.locale) }));
  return <RestrictedLanguageSwitch label={labels.contentTree.languages} links={links} warning={labels.restrictedLocale.changeWarning} requireCleanUrl={requireCleanUrl} keepSelectionKey={keepSelectionKey} />;
}
