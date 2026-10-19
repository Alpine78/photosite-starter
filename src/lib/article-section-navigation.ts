/** Browser-only transient navigation intent; never persisted or populated during SSR. */
export type SectionNavigation = {
  readonly galleryPath: string;
  readonly slug?: string;
  readonly top: number;
  readonly scrollY: number;
  readonly focusAtStart: Element | null;
  readonly moved: boolean;
};
let pending: SectionNavigation | undefined;
let dispose: (() => void) | undefined;
export function rememberArticleSectionNavigation(
  value: SectionNavigation,
): void {
  if (typeof window === "undefined") return;
  dispose?.();
  pending = value;
  const clear = () => {
    pending = undefined;
    dispose?.();
  };
  const events = [
    "wheel",
    "touchmove",
    "pointerdown",
    "keydown",
    "popstate",
    "pageshow",
  ] as const;
  for (const event of events)
    window.addEventListener(event, clear, { capture: true, passive: true });
  const timeout = window.setTimeout(clear, 8000);
  dispose = () => {
    window.clearTimeout(timeout);
    for (const event of events) window.removeEventListener(event, clear, true);
    dispose = undefined;
  };
}
export function consumeArticleSectionNavigation(
  path: string,
  slug?: string,
): SectionNavigation | undefined {
  if (
    typeof window === "undefined" ||
    pending?.galleryPath !== path ||
    pending.slug !== slug
  )
    return undefined;
  const value = pending;
  pending = undefined;
  dispose?.();
  return value;
}
export function articleSectionHref(
  path: string,
  carried: Readonly<Record<string, string | readonly string[] | undefined>>,
  slug?: string,
  hash = "",
): string {
  const params = new URLSearchParams();
  if (slug !== undefined) params.set("section", slug);
  for (const [key, values] of Object.entries(carried)) {
    if (key === "section" || key === "cursor" || values === undefined) continue;
    for (const value of typeof values === "string" ? [values] : values)
      params.append(key, value);
  }
  const query = params.toString();
  return path + (query ? `?${query}` : "") + hash;
}
