"use client";

import Link from "next/link";
import { useId } from "react";

import type { LanguageLink } from "@/components/language-switch";
import { languageMenuCode } from "@/lib/language-menu-store";

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

type LanguageMenuProps = {
  readonly links: readonly LanguageLink[];
  readonly layout: "bar" | "stack";
  /** Names the group in the stacked panel, e.g. "Kieli". */
  readonly label: string;
};

/**
 * The site menu's language entry (AB#173): links to this page's other
 * published languages, as ADR-0003 decision 7 defines them.
 *
 * The bar shows the proposal's short code ("EN") and the stacked panel the
 * language's own name. Either way the link's accessible name is that own name,
 * in its own language (`lang`), and a link that opens a nearer page instead of
 * an exact translation says so in visible text, bound with `aria-describedby`.
 */
export function LanguageMenu({ links, layout, label }: LanguageMenuProps) {
  const id = useId();
  if (links.length === 0) return null;
  const isBar = layout === "bar";

  const items = links.map((language) => {
    const noteId = language.note ? `${id}-${language.locale}-note` : undefined;
    return (
      <li key={language.locale} className={isBar ? "flex items-baseline gap-2" : undefined}>
        <Link
          href={language.href}
          hrefLang={language.locale}
          lang={language.locale}
          aria-describedby={noteId}
          className={`${focusRing} ${
            isBar
              ? "text-base text-muted transition-colors hover:text-link-hover"
              : "block py-2 text-base"
          }`}
        >
          {isBar ? (
            <>
              <span aria-hidden="true">{languageMenuCode(language.locale, links)}</span>
              <span className="sr-only">{language.label}</span>
            </>
          ) : (
            language.label
          )}
        </Link>
        {language.note && (
          <span id={noteId} className="text-sm text-muted">
            {isBar ? language.note : ` (${language.note})`}
          </span>
        )}
      </li>
    );
  });

  if (isBar) return <ul className="flex items-center gap-4">{items}</ul>;

  return (
    <div className="border-t border-border pt-2">
      <p className="pt-2 text-xs font-semibold uppercase tracking-widest text-muted">{label}</p>
      <ul className="flex flex-col gap-1">{items}</ul>
    </div>
  );
}
