/**
 * Return focus to a header control without moving a page that already shows it.
 *
 * A plain `focus()` on a control in the sticky header scrolls the page by the
 * header's scroll padding even though the control is on screen (AB#377).
 * `preventScroll` alone is wrong too: the short-screen fallback makes the
 * header static, and a visitor who scrolled through a long compact menu needs
 * the browser to bring its toggle back into view.
 */
export function focusInPlace(element: HTMLElement | null | undefined): void {
  if (!element) return;
  const box = element.getBoundingClientRect();
  const visible = box.top >= 0 && box.bottom <= window.innerHeight;
  element.focus(visible ? { preventScroll: true } : undefined);
}
