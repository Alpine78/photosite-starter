"use client";

import { useEffect } from "react";
import { currentReadingChapter } from "@/lib/content-reading-address";

const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);
const WRITE_INTERVAL_MS = 500;
const MODAL = "dialog[open], [aria-modal='true']";

/** Optional reading address only; never storage, scroll restoration or a new history entry. */
export function ContentReadingAddress({ headingIds }: { headingIds: readonly string[] }) {
  useEffect(() => {
    const headings = headingIds.map((id) => document.getElementById(id));
    const body = headings[0]?.closest("[data-content-body]");
    if (!body || !headings.length || headings.some((heading) =>
      !heading || !/^H[234]$/.test(heading.tagName) ||
      heading.closest("[data-content-body]") !== body)) return;
    const elements = headings as HTMLElement[];
    const pathname = window.location.pathname;
    const search = window.location.search;
    let locked = true;
    let disabled = false;
    let ownedId: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const lock = () => {
      locked = true;
      ownedId = undefined;
      clearTimeout(timer);
      timer = undefined;
    };
    const modalOpen = () => document.querySelector(MODAL) !== null;
    const unlock = (event: Event) => {
      if (disabled || modalOpen()) { lock(); return; }
      if (event instanceof KeyboardEvent) {
        const target = event.target;
        if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey ||
            !SCROLL_KEYS.has(event.key) ||
            (target instanceof HTMLElement &&
              (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
                (target.tagName === "BUTTON" && event.key === " ")))) return;
      }
      if (event instanceof PointerEvent && event.target !== document.documentElement) return;
      locked = false;
    };
    const anchorClick = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement)) return;
      const destination = new URL(link.href, window.location.href);
      if (destination.origin === window.location.origin &&
          destination.pathname === window.location.pathname &&
          destination.search === window.location.search) lock();
    };
    const update = () => {
      timer = undefined;
      if (locked || disabled) return;
      if (modalOpen()) { lock(); return; }
      if (window.location.pathname !== pathname || window.location.search !== search ||
          !body.isConnected || elements.some((heading) => !heading.isConnected)) { lock(); return; }
      const rect = body.getBoundingClientRect();
      // Native fragment alignment combines the root scroll padding with the target margin.
      const rootPadding = window.getComputedStyle(document.documentElement).scrollPaddingTop;
      const padding = rootPadding === "auto" ? 0 : Number.parseFloat(rootPadding);
      const chapter = currentReadingChapter(elements.map((heading) => {
        const bounds = heading.getBoundingClientRect();
        return { id: heading.id, top: bounds.top, height: bounds.height,
          margin: padding + Number.parseFloat(window.getComputedStyle(heading).scrollMarginTop) };
      }), rect);
      let hash: string;
      if (chapter.kind === "heading") hash = `#${encodeURIComponent(chapter.id)}`;
      else if (chapter.kind === "intro" && ownedId !== undefined &&
          window.location.hash === `#${encodeURIComponent(ownedId)}`) hash = "";
      else return;
      if (hash === window.location.hash) return;
      try {
        window.history.replaceState(window.history.state, "", pathname + search + hash);
        ownedId = chapter.kind === "heading" ? chapter.id : undefined;
      } catch {
        // A denied/throttled History API must never interrupt reading.
        disabled = true;
        lock();
      }
    };
    const scroll = () => {
      if (modalOpen()) { lock(); return; }
      if (!locked && !disabled && timer === undefined) timer = setTimeout(update, WRITE_INTERVAL_MS);
    };
    document.addEventListener("click", anchorClick, true);
    window.addEventListener("wheel", unlock, { passive: true });
    window.addEventListener("touchmove", unlock, { passive: true });
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock);
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("hashchange", lock);
    window.addEventListener("popstate", lock);
    window.addEventListener("pageshow", lock);
    return () => {
      lock();
      document.removeEventListener("click", anchorClick, true);
      window.removeEventListener("wheel", unlock);
      window.removeEventListener("touchmove", unlock);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("hashchange", lock);
      window.removeEventListener("popstate", lock);
      window.removeEventListener("pageshow", lock);
    };
  }, [headingIds]);
  return null;
}
