import { buildPortfolioGallery, type Gallery } from "@/lib/mock-gallery";

export type { Gallery } from "@/lib/mock-gallery";

export async function getPortfolioGallery(): Promise<Gallery> {
  return buildPortfolioGallery();
}
