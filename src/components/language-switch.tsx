import Link from "next/link";

export type LanguageLink = {
  readonly locale: string;
  /** The language's own name, so a visitor recognizes it without reading ours. */
  readonly label: string;
  readonly href: string;
  /** Says so when the target is the nearest page, not this exact one. */
  readonly note?: string;
};

type LanguageSwitchProps = {
  /** Accessible name of the landmark, in the page's own locale. */
  label: string;
  links: readonly LanguageLink[];
};

/**
 * Explicit navigation to the other published languages of this page.
 *
 * ADR-0003 decision 7 makes language switching a deliberate choice — nothing
 * here reads `Accept-Language` — and requires the switch to say when it will
 * open a nearer page instead of an exact translation. That is what `note`
 * carries, and it renders as visible text rather than a title attribute so it
 * reaches every visitor who is about to follow the link.
 *
 * Two things make that promise hold for a screen reader as well as a sighted
 * one. The link carries `lang` as well as `hrefLang`, because its text is the
 * language's own name — "suomi" inside an English page — and without it a
 * speech synthesizer pronounces that name with the wrong voice. And the note is
 * bound to the link with `aria-describedby`, so a visitor tabbing through links
 * or reading a links list hears that this one opens the parent category rather
 * than meeting the caveat only if they happen to read the surrounding text.
 */
export function LanguageSwitch({ label, links }: LanguageSwitchProps) {
  if (links.length === 0) return null;

  return (
    <nav
      aria-label={label}
      className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm"
    >
      <span className="font-medium text-muted">{label}:</span>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {links.map((language) => {
          const noteId = language.note
            ? `language-switch-note-${language.locale}`
            : undefined;

          return (
            <li key={language.locale}>
              <Link
                href={language.href}
                hrefLang={language.locale}
                lang={language.locale}
                aria-describedby={noteId}
                className="inline-flex rounded-full border border-border-control px-3 py-1 text-muted transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {language.label}
              </Link>
              {language.note && (
                <span id={noteId} className="text-muted">
                  {" "}
                  ({language.note})
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
