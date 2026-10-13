import type { LanguageLink } from "@/components/language-switch";
import { languageName } from "./language-fallback";
import type { LocaleVersion } from "./locale-routes";

/** Only actual published counterparts; association stays with serviceId. */
export function serviceLanguageLinks(versions: readonly LocaleVersion[], locale: string): readonly LanguageLink[] {
  return versions.flatMap((version) => version.locale === locale
    ? [] : [{ locale: version.locale, label: languageName(version.locale), href: version.path }]);
}
