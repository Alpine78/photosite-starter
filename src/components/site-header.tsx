"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { BrandMarks } from "@/components/brand-mark";
import { LanguageMenu } from "@/components/language-menu";
import type { LanguageLink } from "@/components/language-switch";
import { SiteNavigation } from "@/components/site-navigation";
import { SiteSearchDialog } from "@/components/site-search-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import type { BuiltInLabels } from "@/lib/deployment-config";
import { focusInPlace } from "@/lib/focus-in-place";
import type { PublicImageRendition } from "@/lib/media";
import type { BrandDescriptor } from "@/lib/site-settings";
import { useScrollReveal } from "@/lib/use-scroll-reveal";
import {
  getLanguageLinks,
  getServerLanguageLinks,
  subscribeLanguageLinks,
} from "@/lib/language-menu-store";
import {
  CONTACT_PATH,
  resolveNavigationItemState,
  toAriaCurrent,
  type SiteNavigationItem,
} from "@/lib/site-navigation";

type SiteHeaderProps = {
  /** This locale's site name (`resolveSiteName`), the brand link's whole name. */
  siteName: string;
  /** The optional brand mark: only its public rendition crosses to the client. */
  logo?: PublicImageRendition;
  /** The mark's dark-theme variant; only ever passed alongside `logo`. */
  logoDark?: PublicImageRendition;
  /**
   * This locale's descriptor line and the name it sits beside. Without both,
   * the brand is `siteName` on one line.
   */
  brandDescriptor?: BrandDescriptor;
  brandName?: string;
  /** Omitted where this locale's home copy is incomplete. */
  homeHref?: string;
  contactHref?: string;
  /** Composed by `buildSiteNavigation`, never a hand-written link list. */
  navigation: readonly SiteNavigationItem[];
  labels: BuiltInLabels["navigation"];
  themeLabels: BuiltInLabels["theme"];
  languageMenuLabels: BuiltInLabels["languageMenu"];
  /**
   * The menu's language links on a page that publishes none of its own — the
   * an untranslated content page or a 404: each other language's story root, with the
   * screen-reader note that it is not this page's translation (AB#262).
   */
  fallbackLanguageLinks: readonly LanguageLink[];
  /**
   * The site search (ADR-0033): this locale's results page, its UI copy, and
   * the locale the dialog searches in. The control is a link to that page that
   * script upgrades to the dialog, so it works with no JavaScript.
   */
  search: {
    readonly href: string;
    readonly locale: string;
    readonly labels: BuiltInLabels["search"];
  };
};

const subscribeNever = () => () => {};
const isClient = () => true;
const isServer = () => false;

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

/**
 * The brand: the mark (when there is one) and the brand text in one row, at
 * the design proposal's scale (16px / 19px, 10px / 14px gap). It may shrink,
 * so a long name wraps beside the mark rather than pushing the menu controls
 * off a narrow bar.
 */
const brandClass =
  "site-header-brand inline-flex min-w-0 max-w-full items-center gap-2.5 text-base font-semibold tracking-[-0.01em] sm:gap-3.5 sm:text-[1.1875rem]";

/**
 * DOM id of the compact-layout panel, named rather than generated because two
 * things outside this component point at it: the toggle's `aria-controls`, and
 * the public-journey harness, which has to find the one control a clone's
 * rebranding cannot rename.
 */
const COMPACT_PANEL_ID = "mobile-nav";

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 shrink-0">
      <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M15.5 15.5L21 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The search control. A real link to the results page, so a visitor without
 * script — or one who opens it in a new tab — gets the page; a plain primary
 * click is taken over to open the dialog in place. The opening element is
 * handed back so focus can return to it on close, because WebKit does not
 * focus a link or button a pointer activated.
 */
function SearchTrigger({
  href,
  label,
  showLabel,
  onOpen,
  className,
}: {
  readonly href: string;
  readonly label: string;
  readonly showLabel: boolean;
  readonly onOpen: (opener: HTMLElement) => void;
  readonly className: string;
}) {
  return (
    <a
      href={href}
      aria-haspopup="dialog"
      {...(showLabel ? {} : { "aria-label": label })}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        onOpen(event.currentTarget);
      }}
      className={className}
    >
      <SearchIcon />
      {showLabel && <span>{label}</span>}
    </a>
  );
}

/**
 * The brand text: one line of site name, or — where this locale has a
 * descriptor — the name with the small uppercase descriptor before or after
 * it, as authored. The two lines are in reading order in the DOM, so the
 * accessible name `brandLabel` returns reads the way the brand looks.
 */
function BrandText({ lines }: { lines: BrandLines }) {
  if (lines.kind === "single") return <span className="min-w-0">{lines.text}</span>;
  const descriptor = (
    <span className="text-xs font-semibold uppercase tracking-[0.14em] opacity-72">
      {lines.descriptor.text}
    </span>
  );
  const name = <span>{lines.name}</span>;
  return (
    <span className="flex min-w-0 flex-col leading-[1.15]">
      {lines.descriptor.position === "before" ? (
        <>
          {descriptor}
          {name}
        </>
      ) : (
        <>
          {name}
          {descriptor}
        </>
      )}
    </span>
  );
}

type BrandLines =
  | { kind: "single"; text: string }
  | { kind: "pair"; name: string; descriptor: BrandDescriptor };

function brandLines(
  siteName: string,
  brandName: string | undefined,
  brandDescriptor: BrandDescriptor | undefined,
): BrandLines {
  return brandName === undefined || brandDescriptor === undefined
    ? { kind: "single", text: siteName }
    : { kind: "pair", name: brandName, descriptor: brandDescriptor };
}

/**
 * The link's accessible name: the visible lines joined in reading order. Two
 * stacked blocks carry no space between them in the DOM, so without this a
 * screen reader could run "Valokuvaaja" and the name together.
 */
function brandLabel(lines: BrandLines): string | undefined {
  if (lines.kind === "single") return undefined;
  const { name, descriptor } = lines;
  return descriptor.position === "before"
    ? `${descriptor.text} ${name}`
    : `${name} ${descriptor.text}`;
}

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
export function SiteHeader({
  siteName,
  logo,
  logoDark,
  brandDescriptor,
  brandName,
  homeHref,
  contactHref,
  navigation,
  labels,
  themeLabels,
  languageMenuLabels,
  fallbackLanguageLinks,
  search,
}: SiteHeaderProps) {
  const pathname = usePathname();
  const lines = brandLines(siteName, brandName, brandDescriptor);
  const label = brandLabel(lines);
  const languageEntry = useSyncExternalStore(
    subscribeLanguageLinks,
    getLanguageLinks,
    getServerLanguageLinks,
  );
  // The fallback waits for hydration. A page's own links are published only
  // after it mounts, so a fallback in the server HTML would first offer every
  // translated page's visitor the story root instead of its exact translation.
  // Once published, the page's own links take precedence over the fallback.
  const hydrated = useSyncExternalStore(subscribeNever, isClient, isServer);
  const { ref: headerRef, hidden: headerHidden } = useScrollReveal({
    keepExpanded: true,
    keyboardFocusOnly: true,
  });
  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!hydrated || header === null) return;
    const root = document.documentElement;
    const bar = header.firstElementChild;
    const measure = () => {
      // Leave the rest of a short viewport to the disclosure's own scroll
      // region. A sticky header cannot scroll its off-screen bottom into view.
      const barHeight = bar?.getBoundingClientRect().height ?? 0;
      // A very tall bar must scroll with the page, otherwise its controls and
      // the panel below it cannot all be reached in a short enlarged viewport.
      const flows = barHeight > window.innerHeight / 2;
      header.toggleAttribute("data-header-flow", flows);
      header.style.setProperty("--site-header-bar-height", `${barHeight}px`);
      const height = `${header.getBoundingClientRect().height}px`;
      root.style.setProperty("--site-header-height", flows ? "0px" : height);
      root.style.setProperty("--site-header-offset", headerHidden || flows ? "0px" : height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    window.addEventListener("resize", measure);
    observer.observe(header);
    if (bar !== null) observer.observe(bar);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      header.removeAttribute("data-header-flow");
      header.style.removeProperty("--site-header-bar-height");
      root.style.removeProperty("--site-header-height");
      root.style.removeProperty("--site-header-offset");
    };
  }, [headerRef, headerHidden, hydrated]);
  const languageLinks = languageEntry?.links ?? (hydrated ? fallbackLanguageLinks : []);

  // The bar shows a configured link to the contact route as the proposal's
  // contact button, last in the row; the compact panel keeps it in the list.
  const contactItem = navigation.find(
    (item) => item.href === (contactHref ?? CONTACT_PATH) && item.children.length === 0,
  );
  const barItems =
    contactItem === undefined ? navigation : navigation.filter((item) => item !== contactItem);

  // Tell the page its in-page language switch is now redundant — only once the
  // menu really shows the links, so a failed script never hides the fallback.
  useEffect(() => {
    const root = document.documentElement;
    if (languageLinks.length > 0) root.setAttribute("data-language-menu", "");
    else root.removeAttribute("data-language-menu");
  }, [languageLinks.length]);
  useEffect(() => () => document.documentElement.removeAttribute("data-language-menu"), []);
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchOpenerRef = useRef<HTMLElement | null>(null);

  const openSearch = (opener: HTMLElement) => {
    searchOpenerRef.current = opener;
    // One overlay at a time: the compact menu would otherwise stay open behind
    // the dialog and take the next Escape from it.
    setMenuOpen(false);
    setSearchOpen(true);
  };
  const closeSearch = () => {
    setSearchOpen(false);
    focusInPlace(searchOpenerRef.current);
  };

  // Navigating ends the interaction that opened the panel. Keyed on the route
  // rather than only on a link click, so a browser Back closes it too, and
  // adjusted during render so the panel never paints over the new page first.
  const [renderedPathname, setRenderedPathname] = useState(pathname);
  if (renderedPathname !== pathname) {
    setRenderedPathname(pathname);
    setMenuOpen(false);
    setSearchOpen(false);
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
      focusInPlace(toggleRef.current);
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
    <header
      ref={headerRef}
      className={`site-header @container/site-header ${hydrated ? "sticky top-0" : "relative"} z-20 border-b border-border bg-surface transition-transform duration-200 motion-reduce:transition-none ${headerHidden ? "-translate-y-full" : ""}`}
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 sm:py-6">
        {homeHref === undefined ? (
          <span className={brandClass}>
            {logo !== undefined && <BrandMarks logo={logo} logoDark={logoDark} placement="header" />}
            <BrandText lines={lines} />
          </span>
        ) : (
          <Link
            href={homeHref}
            className={`${brandClass} transition-colors hover:text-link-hover ${focusRing}`}
            {...(label === undefined ? {} : { "aria-label": label })}
          >
            {logo !== undefined && <BrandMarks logo={logo} logoDark={logoDark} placement="header" />}
            <BrandText lines={lines} />
          </Link>
        )}

        {/* Root-relative container queries follow the space actually available
            to enlarged text; viewport media queries use the initial font size. */}
        <div className="ml-auto hidden max-w-full flex-wrap items-center gap-6 wrap-break-word @5xl/site-header:flex">
          <SiteNavigation items={barItems} layout="bar" labels={labels} className="min-w-0 [&>ul]:flex-wrap" />
          <SearchTrigger
            href={search.href}
            label={search.labels.open}
            showLabel
            onOpen={openSearch}
            className={`inline-flex min-h-11 items-center gap-2 text-[0.9375rem] transition-colors hover:text-link-hover ${focusRing}`}
          />
          <ThemeToggle labels={themeLabels} className="-mx-2" />
          <LanguageMenu
            links={languageLinks}
            layout="bar"
            label={languageMenuLabels.label}
          />
          {contactItem !== undefined && (
            <Link
              href={contactItem.href}
              aria-current={toAriaCurrent(
                resolveNavigationItemState(contactItem.href, pathname),
              )}
              className={`inline-flex min-h-10 items-center rounded-full bg-accent px-5 text-[0.9375rem] font-medium text-accent-foreground transition-opacity hover:opacity-90 ${focusRing}`}
            >
              {contactItem.label}
            </Link>
          )}
        </div>

        <div className="ml-auto flex max-w-full flex-wrap items-center gap-2 @5xl/site-header:hidden">
          <SearchTrigger
            href={search.href}
            label={search.labels.open}
            showLabel={false}
            onOpen={openSearch}
            className={`inline-flex h-11 w-11 items-center justify-center transition-colors hover:text-link-hover ${focusRing}`}
          />
          <ThemeToggle labels={themeLabels} />
          <button
            type="button"
            ref={toggleRef}
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls={COMPACT_PANEL_ID}
            className={`inline-flex min-h-11 items-center gap-2 text-sm ${focusRing}`}
          >
            {menuOpen ? labels.closeMenu : labels.menu}
          </button>
        </div>
      </div>

      <div
        id={COMPACT_PANEL_ID}
        ref={panelRef}
        hidden={!menuOpen}
        className="site-header-panel max-h-[min(70svh,calc(100svh-var(--site-header-bar-height,0px)))] overflow-y-auto border-t border-border px-4 pb-4 @5xl/site-header:hidden"
      >
        <SiteNavigation
          items={navigation}
          layout="stack"
          labels={labels}
          onNavigate={() => setMenuOpen(false)}
          className="pt-2"
        />
        <LanguageMenu
          links={languageLinks}
          layout="stack"
          label={languageMenuLabels.label}
        />
      </div>

      <SiteSearchDialog
        open={searchOpen}
        onClose={closeSearch}
        onNavigate={() => setSearchOpen(false)}
        locale={search.locale}
        searchHref={search.href}
        labels={search.labels}
      />
    </header>
  );
}
