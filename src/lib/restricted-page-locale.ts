import type { LocaleRouteConfig } from "./locale-routes";

export const REQUEST_UI_LOCALE_HEADER = "x-photosite-restricted-ui-locale";

/** Exact configured full tags only; invalid input cannot select a preference. */
export function restrictedLocale(value: string | null | undefined, routes: LocaleRouteConfig): string {
  return value !== null && value !== undefined && value.length <= 128 &&
    routes.locales.some((route) => route.locale === value)
    ? value : routes.defaultLocale;
}

export function restrictedLocaleFromSearch(search: URLSearchParams, routes: LocaleRouteConfig): string {
  const values = search.getAll("locale");
  return restrictedLocale(values.length === 1 ? values[0] : undefined, routes);
}

/** No fragment, capability, cursor, return target or unrelated query survives. */
export function restrictedLocaleHref(pathname: string, locale: string): string {
  if (!pathname.startsWith("/") || pathname.startsWith("//") || /[?#\\\u0000-\u0020]/.test(pathname)) {
    throw new TypeError("Expected a fixed root-relative page path");
  }
  return `${pathname}?${new URLSearchParams({ locale })}`;
}
