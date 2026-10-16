import type { LightboxSlide } from "@/lib/lightbox-slides";

/** Only presentation data crosses into the customer page. */
export type ClientGalleryView = Readonly<{
  title?: string;
  images: readonly LightboxSlide[];
}> & Readonly<
  { kind: "web"; zipUrl?: never; availableUntil?: string } |
  { kind: "legacy"; zipUrl?: string }
>;
