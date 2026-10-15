/**
 * Fills the site-search label templates (`BuiltInLabels["search"]`).
 *
 * The replacement is always a function, never the value itself: a visitor's
 * query is untrusted text, and `String.prototype.replace` would otherwise treat
 * a `$&` or `$1` inside it as a substitution pattern.
 */

import type { BuiltInLabels } from "@/lib/deployment-config";

export type SiteSearchLabels = BuiltInLabels["search"];

function fill(template: string, placeholder: string, value: string): string {
  return template.replace(placeholder, () => value);
}

/** "1 result" / "3 results", chosen by the count so no plural rule leaks into markup. */
export function resultCountText(labels: SiteSearchLabels, count: number): string {
  return fill(count === 1 ? labels.resultsOne : labels.resultsOther, "{count}", String(count));
}

export function noResultsText(labels: SiteSearchLabels, query: string): string {
  return fill(labels.noResults, "{query}", query);
}

export function showAllText(labels: SiteSearchLabels, query: string): string {
  return fill(labels.showAll, "{query}", query);
}

export function narrowSearchText(labels: SiteSearchLabels, shown: number): string {
  return fill(labels.narrowSearch, "{count}", String(shown));
}
