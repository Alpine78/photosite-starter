/**
 * The visitor's colour-theme preference (AB#173). The palettes themselves live
 * in `src/app/globals.css`: with no `data-theme` on `<html>` the site follows
 * the device's `prefers-color-scheme`, and `data-theme="light"` or `"dark"`
 * pins one. This module owns the stored preference that decides which.
 *
 * The choice is kept in `localStorage`, never a cookie: the server does not
 * need it, and the site sets no cookies without a visitor's action. Only an
 * explicit light or dark choice is stored; until a visitor uses the toggle,
 * nothing is stored and the device decides.
 */

export const THEME_STORAGE_KEY = "photosite-theme";

export type PinnedTheme = "light" | "dark";

/** A stored or attribute value as a pinned theme, or `undefined` for anything else. */
export function parsePinnedTheme(value: unknown): PinnedTheme | undefined {
  return value === "light" || value === "dark" ? value : undefined;
}

/**
 * Runs in `<head>` before the first paint and applies a stored pin, so a
 * visitor who chose a theme never sees the other one flash first. A constant:
 * it reads no request input. Anything but "light" or "dark" is ignored, and a
 * browser that blocks storage simply follows the device.
 */
export const THEME_BOOTSTRAP_SCRIPT =
  `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});` +
  `if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

/** The theme the page shows: a pin if there is one, otherwise the device's. */
export function effectiveTheme(
  pin: PinnedTheme | undefined,
  devicePrefersDark: boolean,
): PinnedTheme {
  return pin ?? (devicePrefersDark ? "dark" : "light");
}

/** What one press of the toggle pins: always the opposite of what is showing. */
export function toggledTheme(showing: PinnedTheme): PinnedTheme {
  return showing === "dark" ? "light" : "dark";
}
