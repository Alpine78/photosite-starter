import { buildHeadingIds } from "@/lib/content-headings";
import type { ContentBlock } from "@/lib/content-page";

/** Reuse a terminal authored gallery heading without changing its fragment. */
export function articleEndGalleryHeadingId(
  blocks: readonly ContentBlock[],
  galleryLabel: string,
): string | undefined {
  const last = blocks.at(-1);
  if (
    last?.type !== "heading" || ![2, 3, 4].includes(last.level) ||
    last.text.trim().toLowerCase() !== galleryLabel.trim().toLowerCase()
  ) return undefined;

  return buildHeadingIds(blocks).get(blocks.length - 1);
}
