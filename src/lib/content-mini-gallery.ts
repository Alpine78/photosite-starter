import type { ContentBlock } from "@/lib/content-page";

/** Small authored sets render whole; this is not the curated result contract. */
export const MAX_MINI_GALLERY_ITEMS = 12;
export const MAX_MINI_GALLERY_TITLE_LENGTH = 120;
export type MiniGalleryBlock = Extract<ContentBlock, { type: "mini-gallery" }>;

/** Build body-local, distinct names, including authored/fallback collisions. */
export function miniGalleryNames(
  blocks: readonly ContentBlock[],
  fallback: string,
): ReadonlyMap<number, string> {
  const galleries = blocks.flatMap((block, index) =>
    block.type === "mini-gallery" ? [{ block, index }] : [],
  );
  const bases = galleries.map(({ block }, ordinal) =>
    block.title?.trim() || `${fallback} ${ordinal + 1}`,
  );
  const reserved = new Set(bases);
  const used = new Set<string>();
  return new Map(galleries.map(({ index }, ordinal) => {
    const base = bases[ordinal];
    let name = base;
    // Keep authored names available even when one resembles a generated suffix.
    if (used.has(name)) {
      name = `${base} (${ordinal + 1})`;
      while (used.has(name) || reserved.has(name)) name += ` (${ordinal + 1})`;
    }
    used.add(name);
    return [index, name];
  }));
}

/** Reuse the body slide builder while keeping each set's occurrence identities. */
export function miniGalleryImageBlocks(block: MiniGalleryBlock): readonly ContentBlock[] {
  return block.items.flatMap((item, ordinal) => item.media.type === "image" ? [{
    type: "media" as const,
    media: item.media,
    key: item.key === undefined ? `mini-image-${ordinal}` : `mini-key-${item.key}`,
  }] : []);
}
