"use client";

import { useEffect, useRef, useState } from "react";
import { READING_RESTORED_EVENT } from "@/lib/browser-reading-position";
import type { BuiltInLabels } from "@/lib/deployment-config";

const DISMISS_AFTER_MS = 8000;
const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

/**
 * AB#372: after an automatic restore, a bottom status names the chapter and
 * offers the start of the story. It closes by itself after a few seconds, but
 * never while the pointer rests on it or focus is inside it, so a keyboard or
 * screen-reader user has time to reach its actions. It never moves focus.
 */
export function ReadingResumeNotice({ labels }: { labels: BuiltInLabels["readingPosition"] }) {
  const [chapter, setChapter] = useState<string | null>(null);
  const [held, setHeld] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const restored = (event: Event) => {
      const id = event instanceof CustomEvent && typeof event.detail === "string" ? event.detail : undefined;
      const text = id === undefined ? "" : document.getElementById(id)?.textContent?.trim() ?? "";
      if (text) setChapter(text);
    };
    window.addEventListener(READING_RESTORED_EVENT, restored);
    return () => window.removeEventListener(READING_RESTORED_EVENT, restored);
  }, []);

  useEffect(() => {
    if (chapter === null || held) return;
    const timer = setTimeout(() => setChapter(null), DISMISS_AFTER_MS);
    return () => clearTimeout(timer);
  }, [chapter, held]);

  const close = (toStart: boolean) => {
    const hadFocus = rootRef.current?.contains(document.activeElement) ?? false;
    setChapter(null);
    setHeld(false);
    if (!toStart) return;
    window.scrollTo({ top: 0, behavior: "instant" });
    // The control disappears; continue from the page's title, not the document start.
    const title = document.querySelector<HTMLElement>("main h1");
    if (hadFocus && title) {
      if (!title.hasAttribute("tabindex")) title.setAttribute("tabindex", "-1");
      title.focus({ preventScroll: true });
    }
  };

  return (
    <div ref={rootRef} role="status" aria-live="polite" className="reading-resume"
      onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(rootRef.current?.contains(document.activeElement) ?? false)}
      onFocus={() => setHeld(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeld(false); }}>
      {chapter !== null && (
        <div className="reading-resume__panel">
          <span className="reading-resume__text">{labels.resumed.replace("{chapter}", chapter)}</span>
          <span className="reading-resume__actions">
            <button type="button" className={`reading-resume__button ${focusRing}`} onClick={() => close(true)}>
              <span aria-hidden="true">↑ </span>{labels.backToStart}
            </button>
            <button type="button" className={`reading-resume__button reading-resume__dismiss ${focusRing}`}
              aria-label={labels.close} onClick={() => close(false)}>
              <span aria-hidden="true">×</span>
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
