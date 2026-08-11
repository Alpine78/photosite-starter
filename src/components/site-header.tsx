"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SiteNavigation } from "@/components/site-navigation";
import type { BuiltInLabels } from "@/lib/deployment-config";
import type { SiteNavigationItem } from "@/lib/site-navigation";

type SiteHeaderProps = {
  siteName: string;
  /** Composed by `buildSiteNavigation`, never a hand-written link list. */
  navigation: readonly SiteNavigationItem[];
  labels: BuiltInLabels["navigation"];
};

/**
 * DOM id of the compact-layout panel, named rather than generated because two
 * things outside this component point at it: the toggle's `aria-controls`, and
 * the public-journey harness, which has to find the one control a clone's
 * rebranding cannot rename.
 */
const COMPACT_PANEL_ID = "mobile-nav";

/**
 * Site chrome: the brand link, the menu, and the compact layout's disclosure.
 *
 * The menu itself lives in `SiteNavigation`, rendered twice — once inline for
 * the wide layout and once inside the panel below for the compact one — because
 * they are genuinely different navigation, not one list made narrower. Only one
 * of the two is ever displayed, so assistive technology sees a single menu.
 *
 * The panel is an ordinary block in the document flow with its own scroll
 * boundary: it pushes the page down instead of covering it, a long tree scrolls
 * inside it rather than past the bottom of the window, and nothing about it
 * traps focus or locks the page behind it.
 */
export function SiteHeader({ siteName, navigation, labels }: SiteHeaderProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Navigating ends the interaction that opened the panel. Keyed on the route
  // rather than only on a link click, so a browser Back closes it too, and
  // adjusted during render so the panel never paints over the new page first.
  const [renderedPathname, setRenderedPathname] = useState(pathname);
  if (renderedPathname !== pathname) {
    setRenderedPathname(pathname);
    setMenuOpen(false);
  }

  useEffect(() => {
    if (!menuOpen) return;

    const closeOnOutside = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      // The toggle counts as inside: closing here would be undone by its own
      // click handler, and the panel would appear not to respond at all.
      if (
        panelRef.current?.contains(target) ||
        toggleRef.current?.contains(target)
      ) {
        return;
      }
      setMenuOpen(false);
    };

    /**
     * Escape closes the panel and hands focus back to the control that opened
     * it, wherever focus happens to be — the same reason `SiteNavigation`
     * listens on the document: WebKit leaves the active element on
     * `document.body` after a pointer activates a button, so a handler on the
     * header would never see the key.
     *
     * The bubble phase, deliberately. An open submenu listens in the capture
     * phase and stops the event there, so it takes the first Escape and this
     * one takes the next: the menu unwinds a level at a time instead of
     * collapsing whole and losing the visitor's place in the tree.
     */
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      toggleRef.current?.focus();
      setMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("focusin", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("focusin", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  return (
    // The site chrome stays above page content. A hero whose overlay is taller
    // than its image — a wide frame on a narrow screen — otherwise spills over
    // the header and swallows taps on the menu button and the open menu panel.
    <header className="relative z-10 border-b border-black/10 dark:border-white/15">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link
          href="/"
          className="text-lg font-semibold tracking-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {siteName}
        </Link>

        <SiteNavigation
          items={navigation}
          layout="bar"
          labels={labels}
          className="hidden sm:block"
        />

        <button
          type="button"
          ref={toggleRef}
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-controls={COMPACT_PANEL_ID}
          className="inline-flex items-center gap-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 sm:hidden"
        >
          {menuOpen ? labels.closeMenu : labels.menu}
        </button>
      </div>

      <div
        id={COMPACT_PANEL_ID}
        ref={panelRef}
        hidden={!menuOpen}
        className="max-h-[70svh] overflow-y-auto border-t border-black/10 px-4 pb-4 dark:border-white/15 sm:hidden"
      >
        <SiteNavigation
          items={navigation}
          layout="stack"
          labels={labels}
          onNavigate={() => setMenuOpen(false)}
          className="pt-2"
        />
      </div>
    </header>
  );
}
