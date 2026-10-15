import type { BuiltInLabels } from "@/lib/deployment-config";

/**
 * The call-to-action wording of a listing card (AB#298): a gallery names how
 * many photographs it opens when the adapter counted them, otherwise it uses
 * count-free wording; an article invites reading. The count is data, never
 * authored copy, so the sentence comes from a localized template.
 */
export function storyCardCallToAction(
  entry: {
    readonly variant: "article" | "gallery";
    readonly imageCount?: number;
  },
  labels: BuiltInLabels,
): string {
  if (entry.variant !== "gallery") return labels.storyCard.readStory;
  if (entry.imageCount === undefined || entry.imageCount < 1) return labels.storyCard.viewPhotos;
  if (entry.imageCount === 1) return labels.storyCard.viewOnePhoto;
  return labels.storyCard.viewPhotosCount.replace("{count}", String(entry.imageCount));
}
