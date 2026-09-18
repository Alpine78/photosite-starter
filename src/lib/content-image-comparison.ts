import type { ContentBlock } from "@/lib/content-page";

export const MAX_COMPARISON_LABEL_LENGTH = 200;
export const MAX_COMPARISON_TITLE_LENGTH = 120;
export type ImageComparisonBlock = Extract<ContentBlock, { type: "image-comparison" }>;

export function isComparisonText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

/** Exact integer ratio comparison; never invent alignment by stretching. */
export function canOverlayComparison(block: ImageComparisonBlock): boolean {
  const a = block.first.rendition;
  const b = block.second.rendition;
  return a.width * b.height === b.width * a.height;
}
