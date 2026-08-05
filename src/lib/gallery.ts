/**
 * Route-facing data-access seam. The CMS adapter can replace the mock without
 * changing route or component imports.
 */
import { buildPortfolioGallery, type Gallery } from "@/lib/mock-gallery";

export type { Gallery } from "@/lib/mock-gallery";

export async function getPortfolioGallery(): Promise<Gallery> {
  return buildPortfolioGallery();
}
