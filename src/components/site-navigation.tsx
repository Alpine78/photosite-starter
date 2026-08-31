"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import type { BuiltInLabels } from "@/lib/deployment-config";
import {
  resolveNavigationItemState,
  toAriaCurrent,
  type SiteNavigationItem,
} from "@/lib/site-navigation";

/**
 * The site menu: static links and the public content tree, in one list.
 *
 * The interaction is a disclosure, not a menu widget. Every entry is a real
 * link to a real page, and an entry that has children carries a separate button
 * that shows them — so the branch itself stays reachable in one keystroke,
 * which is what keeps the levels this menu does not show reachable at all
 * (`site-navigation.ts` bounds it at two). A `menu`/`menuitem` widget would
 * take the arrow keys over, hide the links behind a roving tab stop, and still
 * have to answer the same question about where the branch page went.
 *
 * The submenu is therefore never a modal: focus is not trapped, Tab leaves it,
 * and the page behind it stays operable. It closes on Escape — returning focus
 * to the button that opened it — on a pointer or focus landing outside, and on
 * a route change, including one the visitor makes with the browser's Back
 * button rather than a link.
 *
 * One submenu is open at a time. Two open panels in the wide layout would
 * overlap each other, and in the compact one they would push the rest of the
 * menu past the fold.
 */

export type SiteNavigationLabels = Pick<
  BuiltInLabels["navigation"],
  "main" | "submenu"
>;

type SiteNavigationProps = {
  readonly items: readonly SiteNavigationItem[];
  /**
   * `bar` is the wide layout's horizontal menu, whose submenus overlay the
   * page; `stack` is the compact panel's vertical one, whose submenus open in
   * flow so nothing is covered on a small screen.
   */
  readonly layout: "bar" | "stack";
  readonly labels: SiteNavigationLabels;
  /** Called when a link is followed, so an enclosing panel can close itself. */
  readonly onNavigate?: () => void;
  readonly className?: string;
};

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

/** DOM ids may not contain whitespace, and a route path or id may. */
function toIdPart(key: string): string {
  return key.replace(/[^A-Za-z0-9_-]+/g, "-");
}

function DisclosureIcon({ expanded }: { readonly expanded: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
    >
      <path d="m5 8 5 5 5-5" />
    </svg>
  );
}

function NavigationLink({
  item,
  pathname,
  onNavigate,
  className,
}: {
  readonly item: SiteNavigationItem;
  readonly pathname: string;
  readonly onNavigate?: () => void;
  readonly className: string;
}) {
  const state = resolveNavigationItemState(item.href, pathname);

  return (
    <Link
      href={item.href}
      aria-current={toAriaCurrent(state)}
      onClick={onNavigate}
      className={`${className} transition-colors ${focusRing} ${
        state === "elsewhere"
          ? "text-muted hover:text-foreground"
          : "font-medium text-foreground"
      }`}
    >
      {item.label}
    </Link>
  );
}

export function SiteNavigation({
  items,
  layout,
  labels,
  onNavigate,
  className,
}: SiteNavigationProps) {
  const pathname = usePathname();
  // Unique per rendered menu: the wide and compact layouts are two instances of
  // this component in one document, and their panel ids must not collide.
  const instanceId = useId();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const toggles = useRef(new Map<string, HTMLButtonElement>());

  const isBar = layout === "bar";

  // Navigating ends the interaction that opened a submenu, including a
  // navigation made with the browser's Back button, which no click handler here
  // would see. Adjusted during render rather than in an effect: an effect would
  // paint the open panel over the new page once before closing it.
  const [renderedPathname, setRenderedPathname] = useState(pathname);
  if (renderedPathname !== pathname) {
    setRenderedPathname(pathname);
    setOpenKey(null);
  }

  useEffect(() => {
    if (openKey === null) return;

    const closeOnOutside = (event: Event) => {
      const navigation = navigationRef.current;
      const target = event.target;
      if (
        navigation === null ||
        (target instanceof Node && navigation.contains(target))
      ) {
        return;
      }
      setOpenKey(null);
    };

    /**
     * Escape dismisses the submenu wherever focus happens to be.
     *
     * Listened for on the document rather than on the menu, because WebKit does
     * not focus a button a pointer activated: after a tap or a click the active
     * element is still `document.body`, and key events from there never enter
     * this subtree. A handler on the menu itself works in Chromium and does
     * nothing at all in Safari — for exactly the visitor who opens the menu
     * with a thumb and then reaches for the keyboard.
     *
     * The capture phase is what gives nested disclosures a defined order.
     * Stopping propagation here means the submenu consumes the Escape that
     * dismissed it, so the compact panel around it — listening in the bubble
     * phase — keeps its place and closes on the next one.
     */
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();

      // Focus goes to the control that owns the submenu, not to the top of the
      // document: someone who dismissed it has not left the menu. After a
      // pointer activation it also puts focus where the visitor already is, so
      // the next Tab continues through the menu instead of from the top.
      toggles.current.get(openKey)?.focus();
      setOpenKey(null);
    };

    // Pointer *down* rather than click: a panel that stayed open until the
    // button came back up would swallow the first tap on the page behind it.
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("focusin", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("focusin", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [openKey]);

  return (
    <nav ref={navigationRef} aria-label={labels.main} className={className}>
      <ul className={isBar ? "flex items-center gap-6" : "flex flex-col gap-1"}>
        {items.map((item) => {
          const expanded = openKey === item.key;
          const panelId = `${instanceId}-${toIdPart(item.key)}`;

          return (
            <li key={item.key}>
              <div className="flex items-center gap-1">
                <NavigationLink
                  item={item}
                  pathname={pathname}
                  onNavigate={onNavigate}
                  className={isBar ? "text-sm" : "block py-2 text-base"}
                />

                {item.children.length > 0 && (
                  <button
                    type="button"
                    ref={(node) => {
                      if (node === null) {
                        toggles.current.delete(item.key);
                      } else {
                        toggles.current.set(item.key, node);
                      }
                    }}
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    // The branch link beside it already reads the label, so the
                    // button says which submenu it is rather than repeating it
                    // as a second link-alike with the same name.
                    aria-label={labels.submenu.replace("{name}", item.label)}
                    onClick={() => setOpenKey(expanded ? null : item.key)}
                    className={`inline-flex h-9 w-9 items-center justify-center rounded-sm text-muted transition-colors hover:text-foreground ${focusRing}`}
                  >
                    <DisclosureIcon expanded={expanded} />
                  </button>
                )}
              </div>

              {item.children.length > 0 && (
                <div
                  id={panelId}
                  hidden={!expanded}
                  className={
                    isBar
                      ? // Anchored to the header, not to the entry: a panel
                        // hung under a menu entry near the right edge would
                        // open off the side of the window. Overlaid rather than
                        // in flow so it does not reflow the page beneath it,
                        // and height-capped so a wide tree cannot grow past the
                        // bottom of the window.
                        "absolute inset-x-0 top-full z-20 max-h-[70svh] overflow-y-auto border-b border-border bg-surface shadow-lg"
                      : "pb-2 pl-3"
                  }
                >
                  <ul
                    className={
                      isBar
                        ? "mx-auto grid max-w-6xl gap-x-8 gap-y-4 px-4 py-6 sm:grid-cols-2 sm:px-6 lg:grid-cols-4"
                        : "flex flex-col gap-1"
                    }
                  >
                    {item.children.map((child) => (
                      <li key={child.key}>
                        <NavigationLink
                          item={child}
                          pathname={pathname}
                          onNavigate={onNavigate}
                          className="block py-1 text-sm"
                        />

                        {child.children.length > 0 && (
                          <ul className="mt-1 flex flex-col gap-1 border-l border-border pl-3">
                            {child.children.map((grandchild) => (
                              <li key={grandchild.key}>
                                <NavigationLink
                                  item={grandchild}
                                  pathname={pathname}
                                  onNavigate={onNavigate}
                                  className="block py-1 text-sm"
                                />
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
