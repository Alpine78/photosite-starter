import type { LanguageLink } from "@/components/language-switch";
import type { LocaleVersion } from "@/lib/locale-routes";

/**
 * The language's own name, read in that language. `Intl` supplies it, so adding
 * a locale never means adding a translated label to the codebase; an ICU build
 * that has no name for it falls back to the tag itself rather than to ours.
 */
export function languageName(locale: string): string {
  return new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale;
}

/**
 * The site menu's language links for a page that has no translation of its own
 * to offer — an untranslated content page or a 404.
 *
 * Each other language opens its story root, the same defensive target
 * ADR-0003 decision 7 names for a switch with nothing nearer, and says so in
 * visible text (`note`), because the visitor is not getting this page in
 * another language. A language whose story root is not public is not offered:
 * `storyRoots` comes from `listStoryRootVersions`, which already leaves it out.
 */
export function buildFallbackLanguageLinks(
  storyRoots: readonly LocaleVersion[],
  locale: string,
  note: string,
): readonly LanguageLink[] {
  return storyRoots.flatMap((version) =>
    version.locale === locale
      ? []
      : [{ locale: version.locale, label: languageName(version.locale), href: version.path, note }],
  );
}
