import type { LightboxSlide } from "@/lib/lightbox-slides";

/** Only presentation data crosses into the proof page; `reference` is the permanent, canonical proof number. */
export type ProofGalleryView = Readonly<{
  title?: string;
  availableUntil?: string;
  images: readonly (LightboxSlide & Readonly<{ reference: string }>)[];
}>;

/** The replacing delivery gallery a published proof gallery names (ADR-0038 owner answer 5). */
export type ProofReplacement = Readonly<{ id: string; handle: string }>;
