"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { BuiltInLabels } from "@/lib/deployment-config";
import { buildGalleryHref } from "@/lib/gallery-slice";
import type { GallerySectionSummary } from "@/lib/gallery-sections";

type GallerySectionControlsProps = {
  /** The gallery's declared section catalog, already ordered. */
  readonly sections: readonly GallerySectionSummary[];
  /** The active named section's slug, or `undefined` for the `All` view. */
  readonly activeSlug?: string;
  /** This gallery's canonical, parameter-free path. */
  readonly galleryPath: string;
  readonly labels: BuiltInLabels;
};

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

function optionClassName(isActive: boolean): string {
  return `${focusRing} shrink-0 rounded-full border px-4 py-1.5 text-sm transition-colors ${
    isActive
      ? "border-foreground bg-foreground text-background"
      : "border-black/15 text-foreground/80 hover:border-black/30 hover:text-foreground dark:border-white/20 dark:hover:border-white/35"
  }`;
}

/**
 * A gallery's section controls: real links, one per declared section plus
 * `All`, that select ADR-0003's gallery-local filter.
 *
 * Renders nothing when the gallery declares no sections — the one condition
 * that has to hold everywhere a gallery renders, so it lives here rather than
 * being duplicated at every call site.
 *
 * Each option is an ordinary link (`Link` with `prefetch={false}`, so merely
 * scrolling one into view never triggers a real gallery read the way the
 * framework's default viewport-prefetch would). Selecting a different section
 * is therefore a real navigation: the App Router replaces the page with a
 * freshly rendered result for the new `?section=`, which is what gives
 * "changing section replaces results, resets the cursor, and ignores stale
 * in-flight responses" for free — there is no client fetch to race, and no
 * abort logic to write, because there is no fetch at all. Keyboard operation
 * is the ordinary anchor contract: Tab to focus, Enter to activate.
 *
 * The active option carries `aria-current="true"` plus a visual treatment
 * that does not rely on color alone.
 *
 * Reveal-on-scroll-up: the row is `position: sticky` at the top of the
 * viewport, translated out of view while a visitor scrolls down to preserve
 * image space, and revealed immediately on any upward scroll or when
 * keyboard focus enters it. A visitor who prefers reduced motion still gets
 * this — it is a functional layout behavior, not a decorative one — but sees
 * it snap rather than slide, since only the CSS transition is skipped. Either
 * way the controls remain in normal document order and reachable exactly as
 * they would be without the enhancement.
 */
export function GallerySectionControls({
  sections,
  activeSlug,
  galleryPath,
  labels,
}: GallerySectionControlsProps) {
  const [hidden, setHidden] = useState(false);
  const lastScrollYRef = useRef(0);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (sections.length === 0) return;

    // Reduced motion turns off the *animation*, not the reveal-on-scroll-up
    // behavior itself: preserving image space by moving the controls out of
    // view on scroll-down is a functional layout decision the ADR still
    // requires, not a decorative effect a motion preference should disable
    // wholesale. Only the CSS transition on the element below is skipped.
    lastScrollYRef.current = window.scrollY;

    const onScroll = () => {
      const currentY = window.scrollY;
      // Focus can stay put while the page scrolls under it — a mouse wheel or
      // trackpad gesture moves nothing else. ADR-0003 decision 3 requires
      // focus inside the controls to *keep* them visible, not just reveal
      // them once on the focus event that put it there, so hiding is skipped
      // for as long as focus remains inside rather than only suppressed at
      // the moment focus arrives.
      if (navRef.current === null || !navRef.current.contains(document.activeElement)) {
        const delta = currentY - lastScrollYRef.current;
        if (delta > 0 && currentY > 0) {
          setHidden(true);
        } else if (delta < 0) {
          setHidden(false);
        }
      }
      lastScrollYRef.current = currentY;
    };
    const onFocusIn = (event: FocusEvent) => {
      if (
        navRef.current !== null &&
        event.target instanceof Node &&
        navRef.current.contains(event.target)
      ) {
        setHidden(false);
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [sections.length]);

  if (sections.length === 0) return null;

  return (
    <nav
      ref={navRef}
      aria-label={labels.gallery.sectionsNav}
      className={`sticky top-0 z-10 -mx-4 bg-background/95 px-4 py-2 backdrop-blur transition-transform duration-200 motion-reduce:transition-none sm:-mx-6 sm:px-6 ${
        hidden ? "-translate-y-full" : "translate-y-0"
      }`}
    >
      <ul className="flex gap-2 overflow-x-auto">
        <li>
          <Link
            prefetch={false}
            href={buildGalleryHref(galleryPath, {})}
            aria-current={activeSlug === undefined ? "true" : undefined}
            className={optionClassName(activeSlug === undefined)}
          >
            {labels.gallery.allSections}
          </Link>
        </li>
        {sections.map((section) => (
          <li key={section.sectionId}>
            <Link
              prefetch={false}
              href={buildGalleryHref(galleryPath, { section: section.slug })}
              aria-current={activeSlug === section.slug ? "true" : undefined}
              className={optionClassName(activeSlug === section.slug)}
            >
              {section.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
