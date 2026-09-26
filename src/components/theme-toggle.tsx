"use client";

import { useSyncExternalStore } from "react";

import type { BuiltInLabels } from "@/lib/deployment-config";
import {
  effectiveTheme,
  parsePinnedTheme,
  THEME_STORAGE_KEY,
  toggledTheme,
  type PinnedTheme,
} from "@/lib/theme-preference";

/** Fired on this window whenever this page changes the pin itself. */
const CHANGE_EVENT = "photosite-theme-change";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function applyPin(pin: PinnedTheme | undefined): void {
  if (pin === undefined) document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", pin);
}

function subscribe(onChange: () => void): () => void {
  // Another tab changed the choice: follow it here too, so the stored
  // preference, the page and the toggle's state never disagree.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    applyPin(parsePinnedTheme(event.newValue));
    onChange();
  };
  // Until a visitor pins a theme, the device decides — including when it
  // changes while the page is open.
  const media = window.matchMedia(DARK_QUERY);
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  media.addEventListener("change", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
    media.removeEventListener("change", onChange);
  };
}

/**
 * The theme showing now. The pin is read from `<html data-theme>` — set before
 * paint by `THEME_BOOTSTRAP_SCRIPT` — so the toggle can never disagree with the
 * page it sits on, even when storage is blocked.
 */
function getSnapshot(): PinnedTheme {
  return effectiveTheme(
    parsePinnedTheme(document.documentElement.getAttribute("data-theme")),
    window.matchMedia(DARK_QUERY).matches,
  );
}

/** The server cannot know the visitor's device or choice. */
function getServerSnapshot(): null {
  return null;
}

function toggle(showing: PinnedTheme): void {
  const pin = toggledTheme(showing);
  applyPin(pin);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pin);
  } catch {
    // Storage blocked: the choice still holds for this page, just not the next.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

const buttonClassName =
  "inline-flex h-11 w-11 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

type ThemeToggleProps = {
  readonly labels: BuiltInLabels["theme"];
  readonly className?: string;
};

/**
 * The site menu's light/dark toggle (AB#173), from the design proposal: a moon
 * while the light theme shows, a sun while the dark one does. Its name is
 * constant and `aria-pressed` carries the state, so assistive technology hears
 * "Dark theme, pressed" rather than a label that changes under the visitor.
 *
 * The first press pins a theme; from then on the device setting no longer
 * decides, until the visitor's stored choice is cleared (a two-state toggle, as
 * designed). Before hydration it renders a same-sized, inert placeholder: the
 * server cannot know which theme shows, and without JavaScript a toggle could
 * change nothing, so the site follows the device.
 */
export function ThemeToggle({ labels, className = "" }: ThemeToggleProps) {
  const showing = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (showing === null) {
    return <span aria-hidden="true" className={`inline-block h-11 w-11 ${className}`} />;
  }

  return (
    <button
      type="button"
      aria-pressed={showing === "dark"}
      aria-label={labels.darkTheme}
      onClick={() => toggle(showing)}
      className={`${buttonClassName} ${className}`}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        {showing === "dark" ? (
          <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none" />
            <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
          </g>
        ) : (
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="currentColor" />
        )}
      </svg>
    </button>
  );
}
