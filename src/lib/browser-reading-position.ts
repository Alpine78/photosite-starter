import { createReadingPositionStore, type ReadingPositionStorage } from "@/lib/reading-position-store";
import { mayRestoreReadingPosition } from "@/lib/reading-restoration";

export const READING_SETTINGS_EVENT = "photosite-reading-settings-change";
let store: ReturnType<typeof createReadingPositionStore> | undefined;
let initialDocumentHref: string | undefined;
let initialNavigationType: string | undefined;
let historyDestination: string | undefined;
let freshLinkDestination: string | undefined;
let lastInputHref: string | undefined;
let inputGeneration = 0;

export function readingInputGeneration(): number { return inputGeneration; }

/** Call only in browser effects/handlers/snapshots, never during server rendering. */
export function browserReadingStore() {
  if (!store) {
    let storage: ReadingPositionStorage | undefined;
    try { storage = window.localStorage; } catch { /* Optional browser facility. */ }
    store = createReadingPositionStore(storage);
  }
  return store;
}

function initializeNavigation() {
  if (initialDocumentHref !== undefined) return;
  initialDocumentHref = window.location.href;
  try {
    initialNavigationType = (performance.getEntriesByType("navigation")[0] as
      PerformanceNavigationTiming | undefined)?.type;
  } catch { /* Unknown navigation must not interrupt ordinary reading. */ }
}

/** Root-owned listeners survive article transitions; module state survives shell remounts. */
export function observeReadingNavigation(): () => void {
  initializeNavigation();
  const history = () => { inputGeneration++; historyDestination = window.location.href; freshLinkDestination = undefined; };
  const pageshow = (event: PageTransitionEvent) => { if (event.persisted) history(); };
  const input = () => { inputGeneration++; lastInputHref = window.location.href; };
  const link = (event: MouseEvent) => {
    if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute("download") ||
        (anchor.target && anchor.target !== "_self")) return;
    const destination = new URL(anchor.href, window.location.href);
    if (destination.origin !== window.location.origin ||
        (destination.pathname === window.location.pathname && destination.search === window.location.search)) return;
    // A cancelled click cannot release history/input protection on the current URL.
    freshLinkDestination = destination.href;
  };
  window.addEventListener("popstate", history, true);
  window.addEventListener("pageshow", pageshow);
  window.addEventListener("wheel", input, { passive: true, capture: true });
  window.addEventListener("touchmove", input, { passive: true, capture: true });
  window.addEventListener("pointerdown", input, true);
  window.addEventListener("keydown", input, true);
  document.addEventListener("click", link, true);
  return () => {
    window.removeEventListener("popstate", history, true);
    window.removeEventListener("pageshow", pageshow);
    window.removeEventListener("wheel", input, true);
    window.removeEventListener("touchmove", input, true);
    window.removeEventListener("pointerdown", input, true);
    window.removeEventListener("keydown", input, true);
    document.removeEventListener("click", link, true);
  };
}

export function readingRestorationAllowed(initialHref: string): boolean {
  initializeNavigation();
  const currentHref = window.location.href;
  const freshLink = freshLinkDestination === currentHref;
  return mayRestoreReadingPosition({
    initialHref, currentHref,
    hasFragment: window.location.hash !== "", historyDestination: freshLink ? undefined : historyDestination,
    initialDocumentHref: initialDocumentHref!, initialNavigationType,
    freshLinkDestination, interacted: lastInputHref === currentHref, scrollY: window.scrollY,
    modalOpen: document.querySelector("dialog[open], [aria-modal='true']") !== null,
    visible: document.visibilityState === "visible",
  });
}
