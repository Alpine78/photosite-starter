/**
 * The one third-party origin this application ever loads into a page: the
 * privacy-respecting YouTube embed (`youtube-embed.tsx`). Shared with
 * `next.config.ts`'s CSP `frame-src` and `Permissions-Policy` so the allowed
 * origin cannot drift between the component that loads it and the header that
 * permits it — `next-config.test.ts` pins the two together.
 */
export const YOUTUBE_NOCOOKIE_ORIGIN = "https://www.youtube-nocookie.com";

/**
 * The exact browser features the embed's iframe requests via its `allow`
 * attribute. `youtube-embed.tsx` renders this list into that attribute, and
 * `next.config.ts`'s `Permissions-Policy` scopes the same list (plus
 * `fullscreen`, which the iframe requests separately via `allowFullScreen`,
 * not through `allow`) to `self` plus `YOUTUBE_NOCOOKIE_ORIGIN`. One array
 * feeding both means a future change to what the embed requests cannot drift
 * from what the header grants without also changing this file.
 */
export const YOUTUBE_EMBED_ALLOW_FEATURES = [
  "accelerometer",
  "autoplay",
  "clipboard-write",
  "encrypted-media",
  "gyroscope",
  "picture-in-picture",
] as const;
