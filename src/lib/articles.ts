/**
 * Article content type: serves both short blog posts and long-form story
 * articles (same type, more content blocks). Mock data for now; will be
 * served by the CMS (Sanity) once integrated — accessors are async for
 * that reason, mirroring src/lib/site-settings.ts.
 *
 * Body is a typed block list (Portable Text shape), so the CMS migration
 * is a mapping exercise rather than a model rewrite.
 */

import type { ServiceImage } from "@/lib/services";

export type ArticleCategory = {
  slug: string;
  name: string;
};

// Re-use the image shape from services for consistency.
export type ArticleImage = ServiceImage;

export type ContentBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "blockquote"; text: string; attribution?: string }
  | {
      type: "image";
      src: string;
      alt: string;
      width: number;
      height: number;
      caption?: string;
    }
  | { type: "list"; ordered: boolean; items: string[] }
  | {
      type: "youtube";
      videoId: string;
      /** Accessible title used for the button label and link text. */
      title: string;
    };

export type Article = {
  slug: string;
  title: string;
  /** ISO 8601 date string, e.g. "2024-03-15". */
  publishedAt: string;
  /** One- to two-sentence summary shown on the listing card. */
  excerpt: string;
  categories: ArticleCategory[];
  tags?: string[];
  /** Optional cover image; listing card and detail page work without one. */
  coverImage?: ArticleImage;
  body: ContentBlock[];
};

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const ARTICLE_CATEGORIES: ArticleCategory[] = [
  { slug: "gear", name: "Gear" },
  { slug: "technique", name: "Technique" },
  { slug: "travel", name: "Travel" },
  { slug: "behind-the-scenes", name: "Behind the scenes" },
];

// ---------------------------------------------------------------------------
// Mock articles
// ---------------------------------------------------------------------------

const mockArticles: Article[] = [
  {
    slug: "choosing-a-telephoto-lens",
    title: "Choosing a telephoto lens: what the specs don't tell you",
    publishedAt: "2024-09-12",
    excerpt:
      "Focal length and maximum aperture are only the start. Here is what I look for after years of shooting sports and wildlife with long glass.",
    categories: [{ slug: "gear", name: "Gear" }],
    tags: ["lenses", "telephoto", "sports photography"],
    coverImage: {
      src: "/hero-placeholder.svg",
      alt: "Placeholder telephoto lens cover",
      width: 1600,
      height: 1067,
    },
    body: [
      {
        type: "paragraph",
        text: "A telephoto lens purchase is one of the most significant investments a photographer makes. The headline specs — focal length range and maximum aperture — are easy to compare, but they rarely tell you how a lens actually behaves in the field. Placeholder copy; replaced with real content from the CMS.",
      },
      { type: "heading", level: 2, text: "Autofocus: speed vs. accuracy" },
      {
        type: "paragraph",
        text: "For action shooting, autofocus accuracy matters more than raw speed. A lens that locks on instantly but hunts under challenging light will cost you more keepers than a slightly slower one that hits reliably. Placeholder copy.",
      },
      {
        type: "blockquote",
        text: "The best telephoto is the one you can hand-hold reliably — weight and balance matter as much as optics.",
      },
      { type: "heading", level: 2, text: "Key specifications to evaluate" },
      {
        type: "list",
        ordered: false,
        items: [
          "Minimum focusing distance (especially for events and portraits)",
          "Tripod collar included or optional",
          "Weather sealing rating",
          "Teleconverter compatibility",
          "Image stabilisation effectiveness in stops",
        ],
      },
      {
        type: "image",
        src: "/hero-placeholder.svg",
        alt: "Placeholder: telephoto lens mounted on a camera body",
        width: 1600,
        height: 1067,
        caption:
          "A telephoto mounted on a tripod collar — essential for long focal lengths.",
      },
      { type: "heading", level: 2, text: "Video walkthrough" },
      {
        type: "paragraph",
        text: "The video below shows the lens in use during a real motorsport event. Placeholder copy.",
      },
      {
        type: "youtube",
        videoId: "dQw4w9WgXcQ",
        title: "Telephoto lens field test — motorsport",
      },
      { type: "heading", level: 2, text: "Conclusion" },
      {
        type: "paragraph",
        text: "No single telephoto suits every photographer. Define your primary use case first, then evaluate lenses against those real-world demands rather than spec-sheet numbers. Placeholder copy.",
      },
    ],
  },
  {
    slug: "understanding-exposure-triangle",
    title: "The exposure triangle in practice",
    publishedAt: "2024-07-04",
    excerpt:
      "Aperture, shutter speed, and ISO are taught as separate controls, but mastering them means learning to trade one against another fluently.",
    categories: [{ slug: "technique", name: "Technique" }],
    tags: ["exposure", "basics", "technique"],
    coverImage: {
      src: "/hero-placeholder.svg",
      alt: "Placeholder exposure triangle cover",
      width: 1600,
      height: 1000,
    },
    body: [
      {
        type: "paragraph",
        text: "Every exposure decision is a trade-off. Freeze motion with a fast shutter and you pay with a wider aperture or higher ISO. Placeholder copy; replaced with real content from the CMS.",
      },
      { type: "heading", level: 2, text: "Aperture: depth of field vs. light" },
      {
        type: "paragraph",
        text: "A wide aperture (small f-number) gathers more light and compresses depth of field. This is desirable for portraits and isolating subjects, but counterproductive for landscapes where front-to-back sharpness is the goal. Placeholder copy.",
      },
      {
        type: "image",
        src: "/hero-placeholder.svg",
        alt: "Placeholder: two photos showing shallow vs. deep depth of field",
        width: 1600,
        height: 800,
        caption:
          "Left: f/1.8 — shallow depth of field. Right: f/11 — foreground to background in focus.",
      },
      { type: "heading", level: 2, text: "Shutter speed: motion and camera shake" },
      {
        type: "paragraph",
        text: "The classic rule is to keep shutter speed above the reciprocal of focal length (1/200s at 200 mm). Image stabilisation buys you extra stops, but cannot freeze a moving subject. Placeholder copy.",
      },
      {
        type: "blockquote",
        text: "Expose to the right: a slightly overexposed raw file recovers better than an underexposed one.",
        attribution: "Common digital photography guideline",
      },
      { type: "heading", level: 2, text: "ISO: noise vs. exposure" },
      {
        type: "list",
        ordered: true,
        items: [
          "Set aperture for desired depth of field",
          "Set shutter speed to freeze or blur motion as needed",
          "Raise ISO until exposure is correct",
          "Check noise at 100% and adjust if necessary",
        ],
      },
    ],
  },
  {
    // No cover image — listing card and detail page must work without one.
    slug: "packing-for-a-photo-trip",
    title: "What I pack for a week-long photo trip",
    publishedAt: "2024-05-20",
    excerpt:
      "Camera gear is only part of the story. After dozens of trips I have settled on a system that keeps me mobile without leaving anything essential at home.",
    categories: [
      { slug: "travel", name: "Travel" },
      { slug: "behind-the-scenes", name: "Behind the scenes" },
    ],
    tags: ["travel", "packing", "gear"],
    body: [
      {
        type: "paragraph",
        text: "The single biggest mistake photographers make when packing for travel is over-packing lenses and under-packing accessories. Placeholder copy; replaced with real content from the CMS.",
      },
      { type: "heading", level: 2, text: "The camera bag" },
      {
        type: "list",
        ordered: false,
        items: [
          "Camera body + one spare battery",
          "Two lenses: a versatile zoom and one prime",
          "Circular polariser and ND filter",
          "Cleaning kit: sensor swabs, blower, microfibre cloth",
          "Two memory cards plus one backup card in wallet",
        ],
      },
      { type: "heading", level: 2, text: "What stays in the hold luggage" },
      {
        type: "paragraph",
        text: "Heavier support gear travels in checked luggage: tripod, extra lenses, laptop and hard drives. Everything I need for a day of shooting fits in the carry-on. Placeholder copy.",
      },
      {
        type: "blockquote",
        text: "If the airline loses my hold luggage I can still shoot. That is the test.",
      },
    ],
  },
  {
    slug: "shooting-in-low-light",
    title: "Low-light photography without a tripod",
    publishedAt: "2024-02-29",
    excerpt:
      "Modern sensors have changed what is possible hand-held after dark. Here is how I approach concerts, street scenes, and indoor events.",
    categories: [{ slug: "technique", name: "Technique" }],
    tags: ["low light", "technique", "ISO"],
    coverImage: {
      src: "/hero-placeholder.svg",
      alt: "Placeholder low-light cover",
      width: 1600,
      height: 1067,
    },
    body: [
      {
        type: "paragraph",
        text: "Shooting hand-held in low light used to mean accepting significant noise or motion blur. Current camera bodies at ISO 3200–6400 produce files that clean up well in post. Placeholder copy; replaced with real content from the CMS.",
      },
      { type: "heading", level: 2, text: "Maximise light gathering" },
      {
        type: "list",
        ordered: false,
        items: [
          "Use the fastest lens available (f/1.4–f/2.8)",
          "Enable in-body image stabilisation if available",
          "Switch to electronic shutter to eliminate vibration",
          "Shoot raw: more latitude for noise reduction in post",
        ],
      },
      {
        type: "image",
        src: "/hero-placeholder.svg",
        alt: "Placeholder: concert shot at ISO 6400",
        width: 1600,
        height: 1067,
        caption: "ISO 6400, f/2.8, 1/250 s — placeholder EXIF example.",
      },
      { type: "heading", level: 2, text: "Post-processing" },
      {
        type: "paragraph",
        text: "Luminance noise reduction has improved dramatically with AI-based tools. Apply it selectively: reduce chroma noise aggressively, luminance noise more conservatively to preserve texture. Placeholder copy.",
      },
      {
        type: "blockquote",
        text: "A slightly noisy, sharp image beats a noise-free, blurry one every time.",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Intro copy for the listing page
// ---------------------------------------------------------------------------

const mockBlogIntro =
  "Thoughts on photography, gear, travel, and the craft. Placeholder copy; replaced with real wording from the CMS.";

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

export async function getArticles(categorySlug?: string): Promise<Article[]> {
  if (!categorySlug) return mockArticles;
  return mockArticles.filter((a) =>
    a.categories.some((c) => c.slug === categorySlug),
  );
}

export async function getArticle(slug: string): Promise<Article | undefined> {
  return mockArticles.find((a) => a.slug === slug);
}

export async function getBlogIntro(): Promise<string> {
  return mockBlogIntro;
}
