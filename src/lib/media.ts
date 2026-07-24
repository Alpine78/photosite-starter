/**
 * Shared media model used at content boundaries.
 *
 * Images are the only locally rendered variant today. The video variant keeps
 * the content model extensible without adding playback UI, upload workflows,
 * or delivery decisions before those features are prioritized.
 */

type MediaMetadata = {
  caption?: string;
  credit?: string;
};

export type ImageMedia = MediaMetadata & {
  type: "image";
  src: string;
  /** Descriptive alt text; empty only when the image is decorative. */
  alt: string;
  /** Intrinsic dimensions used to reserve space and preserve native ratio. */
  width: number;
  height: number;
};

export type VideoMedia = MediaMetadata & {
  type: "video";
  src: string;
  /** Accessible title for a future video renderer. */
  title: string;
  /** Intrinsic dimensions for preserving the video's native ratio. */
  width: number;
  height: number;
};

export type Media = ImageMedia | VideoMedia;
