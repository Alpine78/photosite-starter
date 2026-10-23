import type { LightboxSlide } from "@/lib/lightbox-slides";

/** Only presentation data crosses into the proof page; `reference` is the permanent, canonical proof number. */
export type ProofGalleryView = Readonly<{
  title?: string;
  availableUntil?: string;
  images: readonly (LightboxSlide & Readonly<{ reference: string }>)[];
}>;
