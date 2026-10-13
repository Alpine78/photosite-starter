"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { LanguageLink } from "./language-switch";

const subscribeToNothing = () => () => {};
const subscribeToUrl = (listener: () => void) => {
  window.addEventListener("hashchange", listener);
  window.addEventListener("pageshow", listener);
  return () => {
    window.removeEventListener("hashchange", listener);
    window.removeEventListener("pageshow", listener);
  };
};

/** Plain document navigation; conservatively warn after an edit until reload. */
export function RestrictedLanguageSwitch({ label, links, warning, requireCleanUrl = false }: {
  readonly label: string;
  readonly links: readonly LanguageLink[];
  readonly warning: string;
  readonly requireCleanUrl?: boolean;
}) {
  const clean = useSyncExternalStore(
    requireCleanUrl ? subscribeToUrl : subscribeToNothing,
    () => !requireCleanUrl || window.location.hash === "",
    () => !requireCleanUrl,
  );
  const edited = useRef(false);
  useEffect(() => {
    const markEdited = () => { edited.current = true; };
    document.addEventListener("input", markEdited, true);
    document.addEventListener("change", markEdited, true);
    return () => {
      document.removeEventListener("input", markEdited, true);
      document.removeEventListener("change", markEdited, true);
    };
  }, []);
  if (links.length === 0 || !clean) return null;
  return (
    <nav aria-label={label} className="my-4 text-sm">
      <ul className="flex flex-wrap gap-4">
        {links.map((link) => (
          <li key={link.locale}>
            <a href={link.href} lang={link.locale} hrefLang={link.locale}
              onClick={(event) => {
                if (edited.current && !window.confirm(warning)) event.preventDefault();
              }}
              className="rounded-sm underline text-muted focus-visible:outline-2 focus-visible:outline-focus">
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
