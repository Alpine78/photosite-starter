/** Owner-approved legacy module resolution; never infers labels or image identity. */
export type ResolvedComparison = {
  readonly first: { readonly src: string; readonly label: string };
  readonly second: { readonly src: string; readonly label: string };
  readonly title?: string;
};

/** Restated from the Studio schema; converter tests pin these bounds. */
export const MAX_COMPARISON_LABEL_LENGTH = 200;
export const MAX_COMPARISON_TITLE_LENGTH = 120;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, maximum: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= maximum;

/** Module img1/img2 stay private; side labels and optional title are language-keyed. */
export function resolveLegacyComparison(value: unknown, language: string): ResolvedComparison | undefined {
  if (!record(value) || !text(value.img1, 2048) || !text(value.img2, 2048) || !record(value.labels)) return undefined;
  const labels = value.labels[language];
  if (!record(labels) || !text(labels.first, MAX_COMPARISON_LABEL_LENGTH) || !text(labels.second, MAX_COMPARISON_LABEL_LENGTH)) return undefined;
  const title = record(value.title) ? value.title[language] : undefined;
  if (value.title != null && !record(value.title)) return undefined;
  if (title != null && !text(title, MAX_COMPARISON_TITLE_LENGTH)) return undefined;
  return { first: { src: value.img1.trim(), label: labels.first }, second: { src: value.img2.trim(), label: labels.second }, ...(title == null ? {} : { title: title as string }) };
}
