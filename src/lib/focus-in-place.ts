/**
 * Return focus to a header control without moving a page that already shows it.
 *
 * A plain `focus()` on a control in the sticky header scrolls the page by the
 * header's scroll padding even though the control is on screen (AB#377).
 * `preventScroll` alone is wrong too: the short-screen fallback makes the
 * header static, and a visitor who scrolled through a long compact menu needs
 * the browser to bring its toggle back into view, including within clipping
 * ancestors.
 */
export function focusInPlace(element: HTMLElement | null | undefined): void {
  if (!element) return;
  const box = element.getBoundingClientRect();
  let visible =
    box.top >= 0 && box.bottom <= window.innerHeight &&
    box.left >= 0 && box.right <= window.innerWidth;
  // The viewport check covers the root scroller; a theme's `overflow-x` on
  // <html> or <body> must not compare against the whole document's box.
  for (
    let ancestor = element.parentElement;
    visible && ancestor && ancestor !== document.body && ancestor !== document.documentElement;
    ancestor = ancestor.parentElement
  ) {
    const style = window.getComputedStyle(ancestor);
    if (style.overflowX === "visible" && style.overflowY === "visible") continue;
    const bounds = ancestor.getBoundingClientRect();
    const top = bounds.top + ancestor.clientTop;
    const left = bounds.left + ancestor.clientLeft;
    visible =
      box.top >= top && box.bottom <= top + ancestor.clientHeight &&
      box.left >= left && box.right <= left + ancestor.clientWidth;
  }
  element.focus(visible ? { preventScroll: true } : undefined);
}
