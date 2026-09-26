import type { LanguageLink } from "@/components/language-switch";

/**
 * Carries a page's language links up to the site menu (AB#173).
 *
 * The menu lives in the layout, which renders once for every page and cannot
 * know a page's other-language versions; only the page can, because ADR-0003
 * decision 7 resolves them from the content's identity, not from its URL. The
 * page's `LanguageSwitch` therefore publishes them here after it mounts, and
 * the header reads them.
 *
 * Every publication has an owner, and only that owner can withdraw it. When a
 * client navigation replaces one page's switch with another's, the new page's
 * links cannot be erased by the old page's cleanup, whichever runs first. A
 * page with no other languages publishes nothing, and its predecessor's
 * cleanup leaves the menu empty.
 */

export type LanguageMenuEntry = {
  readonly owner: symbol;
  readonly links: readonly LanguageLink[];
};

let current: LanguageMenuEntry | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function publishLanguageLinks(owner: symbol, links: readonly LanguageLink[]): void {
  current = { owner, links };
  emit();
}

export function withdrawLanguageLinks(owner: symbol): void {
  if (current?.owner !== owner) return;
  current = null;
  emit();
}

export function subscribeLanguageLinks(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLanguageLinks(): LanguageMenuEntry | null {
  return current;
}

/** The server renders no menu entry: it is published only after the page mounts. */
export function getServerLanguageLinks(): null {
  return null;
}

/**
 * The short code the menu shows for a language: its language subtag ("EN"),
 * or the whole tag ("EN-GB") when another link shares that subtag, so two
 * English versions are never both "EN".
 */
export function languageMenuCode(locale: string, all: readonly { readonly locale: string }[]): string {
  const subtag = locale.split("-")[0] ?? locale;
  const shared = all.filter((link) => (link.locale.split("-")[0] ?? link.locale) === subtag).length > 1;
  return (shared ? locale : subtag).toUpperCase();
}
