"use client";

import { useEffect } from "react";
import { currentReadingChapter, CONTENT_READING_ADDRESS_EVENT } from "@/lib/content-reading-address";
import { browserReadingStore, readingInputGeneration, readingRestorationAllowed, READING_SETTINGS_EVENT } from "@/lib/browser-reading-position";
import { READING_DISABLED_KEY, READING_POSITIONS_KEY } from "@/lib/reading-position-store";

const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);
const WRITE_INTERVAL_MS = 500;
const MODAL = "dialog[open], [aria-modal='true']";

/** Existing reading address; article callers additionally opt into local continuity. */
export function ContentReadingAddress({ headingIds, readingPosition }: {
  headingIds: readonly string[];
  readingPosition?: { readonly contentId: string; readonly locale: string };
}) {
  const contentId = readingPosition?.contentId;
  const locale = readingPosition?.locale;
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
    let restoreFrame: number | undefined;
    let restoredLayout: ResizeObserver | undefined;
    let lastSavedId: string | undefined;
    let lastSavedAt = -Infinity;
    const store = contentId === undefined || locale === undefined ? undefined : browserReadingStore();
    const initialHref = window.location.href;

    const stopRestoration = () => {
      if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame);
      restoreFrame = undefined;
      restoredLayout?.disconnect();
      restoredLayout = undefined;
    };
    const lockTracking = () => {
      locked = true;
      ownedId = undefined;
      clearTimeout(timer);
      timer = undefined;
    };
    const lock = () => {
      lockTracking();
      stopRestoration();
    };
    const modalOpen = () => document.querySelector(MODAL) !== null;
    const unlock = (event: Event) => {
      // Any reader gesture takes over from automatic layout stabilization,
      // including a control key that does not itself unlock chapter tracking.
      stopRestoration();
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
      // The address observer accepts at most one chapter every 500ms. Save every
      // accepted chapter change immediately; only repeated same-chapter refreshes
      // wait a minute. Intro/outside/modal/programmatic movement never saves.
      if (store && contentId !== undefined && locale !== undefined && chapter.kind === "heading") {
        const now = Date.now();
        if (chapter.id !== lastSavedId || now - lastSavedAt >= 60_000) {
          if (store.save(contentId, locale, chapter)) {
            lastSavedId = chapter.id;
            lastSavedAt = now;
          }
        }
      }
      let hash: string;
      if (chapter.kind === "heading") hash = `#${encodeURIComponent(chapter.id)}`;
      else if (chapter.kind === "intro" && ownedId !== undefined &&
          window.location.hash === `#${encodeURIComponent(ownedId)}`) hash = "";
      else return;
      if (hash === window.location.hash) return;
      try {
        window.history.replaceState(window.history.state, "", pathname + search + hash);
        window.dispatchEvent(new Event(CONTENT_READING_ADDRESS_EVENT));
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
    const settingsChanged = () => { lock(); lastSavedId = undefined; lastSavedAt = -Infinity; };
    const visibilityChanged = () => { if (document.visibilityState !== "visible") lock(); };
    const storageChanged = (event: StorageEvent) => {
      if (event.key === null || event.key === READING_DISABLED_KEY ||
          (event.key === READING_POSITIONS_KEY && (event.newValue === null || event.newValue === "[]"))) settingsChanged();
    };
    const pageshow = (event: PageTransitionEvent) => {
      // Initial load completion is not native history restoration. It must not
      // cancel an already scheduled fresh visit's restore or its layout guard.
      if (event.persisted) lock();
      else lockTracking();
    };
    if (store && contentId !== undefined && locale !== undefined && store.isEnabled() && readingRestorationAllowed(initialHref)) {
      // One bounded attempt after hydration; no scrolling loop or focus change.
      // A History API fragment is deliberately not used: it does not update :target.
      restoreFrame = requestAnimationFrame(() => {
        restoreFrame = requestAnimationFrame(() => {
          restoreFrame = undefined;
          if (!store.isEnabled() || !readingRestorationAllowed(initialHref)) return;
          const saved = store.load(contentId, locale, new Set(headingIds));
          if (saved === null) return; // Eligible fresh visits already start at the top.
          const target = elements.find((heading) => heading.id === saved);
          if (!target?.isConnected || target.getClientRects().length === 0) return;
          try {
            target.scrollIntoView({ block: "start", behavior: "instant" });
            const top = target.getBoundingClientRect().top;
            const generation = readingInputGeneration();
            if (typeof ResizeObserver !== "undefined") {
              // Loaded comparison images may collapse their complete-image
              // fallback after the jump. Stabilize only this restored chapter
              // until input/navigation takes over. Scrolling does not resize the
              // body; this observer makes no layout/style writes or polling loop.
              restoredLayout = new ResizeObserver(() => {
                if (!target.isConnected || !body.isConnected ||
                    window.location.href !== initialHref || modalOpen() ||
                    document.visibilityState !== "visible" ||
                    readingInputGeneration() !== generation) { stopRestoration(); return; }
                const shift = target.getBoundingClientRect().top - top;
                if (Number.isFinite(shift) && Math.abs(shift) > 1) {
                  try { window.scrollBy({ top: shift, behavior: "instant" }); }
                  catch { stopRestoration(); }
                }
              });
              restoredLayout.observe(body);
            }
          }
          catch { /* Optional restoration must never break ordinary reading. */ }
        });
      });
    }
    document.addEventListener("click", anchorClick, true);
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("wheel", unlock, { passive: true });
    window.addEventListener("touchmove", unlock, { passive: true });
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock);
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("hashchange", lock);
    window.addEventListener("popstate", lock);
    window.addEventListener("pageshow", pageshow);
    window.addEventListener(READING_SETTINGS_EVENT, settingsChanged);
    window.addEventListener("storage", storageChanged);
    return () => {
      lock();
      document.removeEventListener("click", anchorClick, true);
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("wheel", unlock);
      window.removeEventListener("touchmove", unlock);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("hashchange", lock);
      window.removeEventListener("popstate", lock);
      window.removeEventListener("pageshow", pageshow);
      window.removeEventListener(READING_SETTINGS_EVENT, settingsChanged);
      window.removeEventListener("storage", storageChanged);
    };
  }, [headingIds, contentId, locale]);
  return null;
}
