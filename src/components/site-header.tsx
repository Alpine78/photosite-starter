"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LanguageMenu } from "@/components/language-menu";
import { SiteNavigation } from "@/components/site-navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import type { BuiltInLabels } from "@/lib/deployment-config";
import type { PublicImageRendition } from "@/lib/media";
import type { BrandDescriptor } from "@/lib/site-settings";
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
  /** Omitted where this locale has no public home route yet. */
  homeHref?: string;
  /** Composed by `buildSiteNavigation`, never a hand-written link list. */
  navigation: readonly SiteNavigationItem[];
  labels: BuiltInLabels["navigation"];
  themeLabels: BuiltInLabels["theme"];
  languageMenuLabels: BuiltInLabels["languageMenu"];
};

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

/**
 * The brand: the mark (when there is one) and the brand text in one row, at
 * the design proposal's scale (16px / 19px, 10px / 14px gap). It may shrink,
 * so a long name wraps beside the mark rather than pushing the menu controls
 * off a narrow bar.
 */
const brandClass =
  "inline-flex min-w-0 items-center gap-2.5 text-base font-semibold tracking-[-0.01em] sm:gap-3.5 sm:text-[1.1875rem]";

/**
 * DOM id of the compact-layout panel, named rather than generated because two
 * things outside this component point at it: the toggle's `aria-controls`, and
 * the public-journey harness, which has to find the one control a clone's
 * rebranding cannot rename.
 */
const COMPACT_PANEL_ID = "mobile-nav";

/**
 * The brand mark's CSS bounds: the design proposal's 43px height (33px below
 * `sm`), and the widest a wordmark may get.
 */
const LOGO_MAX_HEIGHT_PX = 43;
const LOGO_MAX_WIDTH_PX = 160;

/**
 * The mark beside the site name, at its native ratio.
 *
 * Width and height both stay `auto`, each under its own maximum: CSS sizes a
 * replaced element with two auto dimensions and min/max constraints so that
 * its intrinsic ratio holds, so a square mark and a wide wordmark both fit the
 * bar without being cropped or stretched. The true pixel dimensions on the
 * `<Image>` give it that ratio and reserve its space while it loads.
 *
 * `alt` is empty because the mark is decorative here: the visible site name
 * beside it is already the link's whole accessible name, and a second name
 * would only repeat it. `sizes` is the exact rendered width the bounds
 * produce, so the optimizer is asked for nothing wider than the bar shows.
 */
function BrandMark({
  logo,
  modeClass = "",
}: {
  logo: PublicImageRendition;
  modeClass?: string;
}) {
  const renderedWidth = Math.ceil(
    Math.min(LOGO_MAX_WIDTH_PX, (LOGO_MAX_HEIGHT_PX * logo.width) / logo.height),
  );
  return (
    <Image
      src={logo.src}
      alt=""
      width={logo.width}
      height={logo.height}
      sizes={`${renderedWidth}px`}
      className={`h-auto max-h-[33px] w-auto max-w-40 shrink-0 sm:max-h-[43px] ${modeClass}`}
    />
  );
}

/**
 * The mark, or the light/dark pair. The pair swaps through the
 * `light-mode-only` / `dark-mode-only` rules in `globals.css`, which follow the
 * same OS preference and pinned mode as the palette, so the right variant
 * shows before hydration and without JavaScript.
 */
function BrandMarks({
  logo,
  logoDark,
}: {
  logo: PublicImageRendition;
  logoDark?: PublicImageRendition;
}) {
  if (logoDark === undefined) return <BrandMark logo={logo} />;
  return (
    <>
      <BrandMark logo={logo} modeClass="light-mode-only" />
      <BrandMark logo={logoDark} modeClass="dark-mode-only" />
    </>
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
  navigation,
  labels,
  themeLabels,
  languageMenuLabels,
}: SiteHeaderProps) {
  const pathname = usePathname();
  const lines = brandLines(siteName, brandName, brandDescriptor);
  const label = brandLabel(lines);
  const languageEntry = useSyncExternalStore(
    subscribeLanguageLinks,
    getLanguageLinks,
    getServerLanguageLinks,
  );
  const languageLinks = languageEntry?.links ?? [];

  // The bar shows a configured link to the contact route as the proposal's
  // contact button, last in the row; the compact panel keeps it in the list.
  const contactItem = navigation.find(
    (item) => item.href === CONTACT_PATH && item.children.length === 0,
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
    <header className="relative z-10 border-b border-border">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6 sm:py-6">
        {homeHref === undefined ? (
          <span className={brandClass}>
            {logo !== undefined && <BrandMarks logo={logo} logoDark={logoDark} />}
            <BrandText lines={lines} />
          </span>
        ) : (
          <Link
            href={homeHref}
            className={`${brandClass} transition-colors hover:text-link-hover ${focusRing}`}
            {...(label === undefined ? {} : { "aria-label": label })}
          >
            {logo !== undefined && <BrandMarks logo={logo} logoDark={logoDark} />}
            <BrandText lines={lines} />
          </Link>
        )}

        {/* The wide layout, in the proposal's order: navigation, theme,
            language, then the contact button. Kept back to `lg`: at `sm` the
            row (nav + toggle + language + pill) no longer fits the mock
            navigation and overflows the header (Codex review). */}
        <div className="hidden items-center gap-6 lg:flex">
          <SiteNavigation items={barItems} layout="bar" labels={labels} />
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

        <div className="flex items-center gap-2 lg:hidden">
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
        className="max-h-[70svh] overflow-y-auto border-t border-border px-4 pb-4 lg:hidden"
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
    </header>
  );
}
