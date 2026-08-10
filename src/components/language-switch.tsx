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
 */
export function LanguageSwitch({ label, links }: LanguageSwitchProps) {
  if (links.length === 0) return null;

  return (
    <nav aria-label={label} className="mt-4">
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {links.map((language) => (
          <li key={language.locale}>
            <Link
              href={language.href}
              hrefLang={language.locale}
              className="text-foreground/70 underline underline-offset-4 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {language.label}
            </Link>
            {language.note && (
              <span className="text-foreground/50"> ({language.note})</span>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
