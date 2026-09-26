"use client";

import { useEffect } from "react";

import type { LanguageLink } from "@/components/language-switch";
import { publishLanguageLinks, withdrawLanguageLinks } from "@/lib/language-menu-store";

/**
 * Publishes this page's language links to the site menu while the page is
 * mounted (AB#173). Renders nothing itself; see `language-menu-store.ts`.
 */
export function LanguageLinksRegistrar({ links }: { readonly links: readonly LanguageLink[] }) {
  useEffect(() => {
    const owner = Symbol("language-links");
    publishLanguageLinks(owner, links);
    return () => withdrawLanguageLinks(owner);
  }, [links]);
  return null;
}
