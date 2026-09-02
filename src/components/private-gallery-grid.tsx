import type { PrivateGalleryItem } from "@/lib/private-gallery-access";

/**
 * The private gallery's grid of frames.
 *
 * Row-major, one to three columns, top-aligned, **every frame at its own native
 * ratio** — the same rules the public gallery grid follows, and for the same
 * reasons (`AGENTS.md`): a cropped preview misrepresents the work, and one
 * authoritative order has to govern the source, the DOM, keyboard focus, and a
 * future lightbox at once. A column-major masonry would let the visual reading
 * order contradict the authored one, which is why the public grid stopped being
 * one.
 *
 * **There are no photographs in these frames yet.** ADR-0014 §5 Stage 2 delivers
 * a private preview through a short-lived signed object-store URL, which needs
 * the object store this deployment has not provisioned. What exists now is the
 * geometry: each frame is reserved at the true intrinsic ratio of the derivative
 * that will fill it, so the `<img>` a later slice drops in cannot reflow the
 * page, and so the no-crop rule is testable before there is anything to crop.
 *
 * `aspect-ratio` is set from the item's real pixels as an inline style rather
 * than a utility class, because the value is per-item data — Tailwind cannot
 * generate a class for a ratio it has never seen, and rounding every photograph
 * to the nearest available class is cropping by another name. This is the same
 * exception the public renditions already take for their intrinsic dimensions.
 */
export function PrivateGalleryGrid({
  items,
  emptyLabel,
}: {
  readonly items: readonly PrivateGalleryItem[];
  readonly emptyLabel: string;
}) {
  if (items.length === 0) {
    return <p className="text-muted">{emptyLabel}</p>;
  }

  return (
    <ul className="grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <li key={item.itemId} className="m-0">
          <div
            // Reserved, not cropped: the box takes the photograph's shape rather
            // than the photograph taking the box's.
            className="w-full rounded-md border border-border-strong bg-surface"
            style={{ aspectRatio: `${item.width} / ${item.height}` }}
            data-item-id={item.itemId}
            data-aspect-width={item.width}
            data-aspect-height={item.height}
          />
        </li>
      ))}
    </ul>
  );
}
