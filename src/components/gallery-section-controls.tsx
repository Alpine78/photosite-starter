"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { BuiltInLabels } from "@/lib/deployment-config";
import { buildGalleryHref } from "@/lib/gallery-slice";
import type { GallerySectionSummary } from "@/lib/gallery-sections";
import { useScrollReveal } from "@/lib/use-scroll-reveal";

type GallerySectionControlsProps = {
  /** The gallery's declared section catalog, already ordered. */
  readonly sections: readonly GallerySectionSummary[];
  /** The active named section's slug, or `undefined` for the `All` view. */
  readonly activeSlug?: string;
  /** This gallery's canonical, parameter-free path. */
  readonly galleryPath: string;
  readonly labels: BuiltInLabels;
  /** A localized result summary, including an exact count or the empty state. */
  readonly resultSummary: string;
};

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

/**
 * A filter option (AB#173): the active section is marked by an underline and a
 * heavier weight, not by colour alone. The row wraps, so every option stays
 * visible without horizontal scrolling (owner decision, 2026-09-26), and a
 * single long label wraps within its own option.
 */
function optionClassName(isActive: boolean): string {
  return `${focusRing} scroll-mt-[var(--site-header-offset,0px)] -mb-px block max-w-full break-words border-b-2 px-4 py-3 text-base transition-colors ${
    isActive
      ? "border-foreground font-medium text-foreground"
      : "border-transparent text-muted hover:text-foreground"
  }`;
}

/** The reveal animation is not a change in the filter's document position. */
function layoutTop(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  // This row uses only Tailwind's native translate, with no rotation or scale.
  const y = getComputedStyle(element).translate.split(/\s+/)[1];
  const distance = y === undefined ? 0 : Number.parseFloat(y);
  const offset = Number.isFinite(distance)
    ? distance * (y?.endsWith("%") ? rect.height / 100 : 1)
    : 0;
  return rect.top - offset;
}

/**
 * A gallery's section controls: real links, one per declared section plus
 * `All`, that select ADR-0003's gallery-local filter.
 *
 * Renders nothing when the gallery declares fewer than two sections — the condition
 * that has to hold everywhere a gallery renders, so it lives here rather than
 * being duplicated at every call site.
 *
 * Each option is an ordinary link (`Link` with `prefetch={false}`, so merely
 * scrolling one into view never triggers a real gallery read the way the
 * framework's default viewport-prefetch would). Selecting a different section
 * disables the router's default scroll reset while remaining a real navigation:
 * the App Router replaces the page with a
 * freshly rendered result for the new `?section=`, which is what gives
 * "changing section replaces results, resets the cursor, and ignores stale
 * in-flight responses" through the existing server navigation and grid guards.
 * No custom client fetch is introduced. Keyboard operation
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
  resultSummary,
}: GallerySectionControlsProps) {
  const showControls = sections.length > 1;
  const { ref: navRef, hidden } = useScrollReveal({ enabled: showControls });
  const pendingRef = useRef<{
    readonly galleryPath: string;
    readonly slug: string | undefined;
    readonly top: number;
    readonly scrollY: number;
    readonly focusAtStart: Element | null;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    const nav = navRef.current;
    if (!showControls || nav === null) return;
    const properties = ["transition-property", "translate", "top"] as const;
    let press: {
      readonly pointerId: number;
      readonly saved: readonly { name: typeof properties[number]; value: string; priority: string }[];
    } | undefined;
    let releaseFrame: number | undefined;

    const release = () => {
      if (releaseFrame !== undefined) window.cancelAnimationFrame(releaseFrame);
      releaseFrame = undefined;
      if (press !== undefined) {
        // Restore the transition first so the normal reveal can resume.
        for (const { name, value, priority } of press.saved) {
          if (value) nav.style.setProperty(name, value, priority);
          else nav.style.removeProperty(name);
        }
        press = undefined;
      }
      document.removeEventListener("pointerup", finish, true);
      document.removeEventListener("pointercancel", finish, true);
      document.removeEventListener("dragstart", release, true);
      document.removeEventListener("click", release, true);
      window.removeEventListener("blur", release);
    };
    const finish = (event: PointerEvent) => {
      if (event.pointerId !== press?.pointerId) return;
      if (event.type === "pointercancel") {
        release();
        return;
      }
      // Keep the pointerup target in place through native click targeting.
      // A drag outside the link may produce no click, so release next frame too.
      document.addEventListener("click", release, { capture: true, once: true });
      releaseFrame = window.requestAnimationFrame(release);
    };
    const hold = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0 || press !== undefined ||
          !(event.target instanceof Element)) return;
      const link = event.target.closest("a[href]");
      if (link === null || !nav.contains(link)) return;
      if (!nav.classList.contains("-translate-y-full") &&
          !nav.getAnimations().some((animation) => animation.playState === "running")) return;
      const computed = getComputedStyle(nav);
      // Capture strings before writing: the computed declaration is live.
      const translate = computed.translate;
      const top = computed.top;
      press = {
        pointerId: event.pointerId,
        saved: properties.map((name) => ({ name,
          value: nav.style.getPropertyValue(name), priority: nav.style.getPropertyPriority(name) })),
      };
      // Hold only the current press's painted position. Native drag, panning,
      // cancellation, modifiers and anchor activation remain browser-owned.
      nav.style.setProperty("transition-property", "none");
      nav.style.setProperty("translate", translate);
      nav.style.setProperty("top", top);
      document.addEventListener("pointerup", finish, true);
      document.addEventListener("pointercancel", finish, true);
      // Native link dragging may replace pointerup/cancel (notably WebKit).
      // Once a drag starts, this gesture can no longer activate the link.
      document.addEventListener("dragstart", release, true);
      window.addEventListener("blur", release);
    };
    nav.addEventListener("pointerdown", hold);
    return () => {
      nav.removeEventListener("pointerdown", hold);
      release();
    };
  }, [galleryPath, navRef, showControls]);

  useEffect(() => {
    const clear = () => { pendingRef.current = null; };
    const rememberScroll = () => {
      const pending = pendingRef.current;
      if (pending && Math.abs(window.scrollY - pending.scrollY) > 2) pending.moved = true;
    };
    window.addEventListener("popstate", clear);
    window.addEventListener("scroll", rememberScroll, { passive: true });
    return () => {
      clear();
      window.removeEventListener("popstate", clear);
      window.removeEventListener("scroll", rememberScroll);
    };
  }, []);

  const rememberNavigation = (slug?: string) => {
    const nav = navRef.current;
    if (nav === null || slug === activeSlug) {
      pendingRef.current = null;
      return;
    }
    pendingRef.current = { galleryPath, slug, top: layoutTop(nav),
      scrollY: window.scrollY, focusAtStart: document.activeElement, moved: false };
  };

  useLayoutEffect(() => {
    const pending = pendingRef.current;
    const nav = navRef.current;
    if (pending === null || nav === null) return;
    if (pending.galleryPath !== galleryPath) {
      pendingRef.current = null;
      return;
    }
    if (pending.slug !== activeSlug) return;
    pendingRef.current = null;
    // The visitor may have moved on while this server result was pending.
    // Preserve that deliberate focus/scroll instead of pulling them back.
    const focus = document.activeElement;
    if (pending.moved || (focus !== document.body &&
      (focus !== pending.focusAtStart || !nav.contains(focus)))) return;
    const selected = nav.querySelector<HTMLAnchorElement>('a[aria-current="true"]');
    if (selected === null) return;
    selected.focus({ preventScroll: true });
    const delta = layoutTop(nav) - pending.top;
    if (Math.abs(delta) > 1) window.scrollBy({ top: delta, behavior: "instant" });
    // A short/empty result may make the old scroll position impossible.
    // Use the closest native position, keeping the selected control visible.
    const rect = selected.getBoundingClientRect();
    const headerOffset = Number.parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue("--site-header-offset")) || 0;
    if (rect.top < headerOffset || rect.bottom > window.innerHeight) {
      selected.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    }
  }, [activeSlug, galleryPath, navRef]);
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!showControls || nav === null) return;
    const root = document.documentElement;
    const measure = () => root.style.setProperty(
      "--gallery-section-height", `${nav.getBoundingClientRect().height}px`,
    );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--gallery-section-height");
    };
  }, [navRef, showControls]);

  if (!showControls) return null;

  return (
    <nav
      ref={navRef}
      aria-label={labels.gallery.sectionsNav}
      className={`sticky top-[var(--site-header-offset,0px)] z-10 -mx-4 border-y border-border bg-surface/95 px-4 backdrop-blur transition-transform duration-200 motion-reduce:transition-none sm:-mx-6 sm:px-6 ${
        hidden ? "-translate-y-full" : "translate-y-0"
      }`}
    >
      <p className="px-4 pt-3 text-xs font-semibold uppercase tracking-widest text-muted">
        {labels.gallery.sectionsNav} · {sections.length}
      </p>
      <p role="status" aria-atomic="true" className="sr-only">{resultSummary}</p>
      <ul className="flex flex-wrap">
        {/* `min-w-0` overrides the flex item's automatic min-content floor:
            without it, a section label with one long unbroken word can widen
            its own <li> past the viewport instead of wrapping (Codex
            review) — `break-words` on the link alone does not shrink the
            item that holds it. */}
        <li className="min-w-0 max-w-full">
          <Link
            prefetch={false}
            scroll={false}
            onNavigate={() => rememberNavigation()}
            href={buildGalleryHref(galleryPath, {})}
            aria-current={activeSlug === undefined ? "true" : undefined}
            className={optionClassName(activeSlug === undefined)}
          >
            {labels.gallery.allSections}
          </Link>
        </li>
        {sections.map((section) => (
          <li key={section.sectionId} className="min-w-0 max-w-full">
            <Link
              prefetch={false}
              scroll={false}
              onNavigate={() => rememberNavigation(section.slug)}
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
