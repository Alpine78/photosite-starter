import { describe, expect, it, vi } from "vitest";

import {
  GALLERY_DOCUMENT_TYPE,
  projectGalleryContentPage,
  projectGalleryPlacement,
  projectGalleryPlacementInput,
  projectGallerySectionIntro,
  projectGallerySectionSummary,
  readPublicGalleryPage,
  SanityGalleryError,
  type RawGalleryDetailDocument,
  type RawGalleryPlacementDocument,
  type RawGalleryPlacementItem,
} from "@/lib/sanity-gallery";
import { galleryType } from "../../sanity/schemas/gallery";
import {
  INTERNAL_LINK_PATH as SCHEMA_INTERNAL_LINK_PATH,
  MAX_INTRO_BLOCKS as SCHEMA_MAX_INTRO_BLOCKS,
  MAX_LIST_ITEMS as SCHEMA_MAX_LIST_ITEMS,
  MAX_SPANS_PER_BLOCK as SCHEMA_MAX_SPANS_PER_BLOCK,
  MAX_SPAN_TEXT_LENGTH as SCHEMA_MAX_SPAN_TEXT_LENGTH,
} from "../../sanity/schemas/gallery-section-intro";
import {
  INTERNAL_LINK_PATH,
  MAX_INTRO_BLOCKS,
  MAX_LIST_ITEMS,
  MAX_SPANS_PER_BLOCK,
  MAX_SPAN_TEXT_LENGTH,
} from "@/lib/gallery-sections";
import type { SanityClient, SanityQueryRequest } from "@/lib/sanity-client";
import type { SanityConfig } from "@/lib/sanity-config";
import type { RawPublicMediaDocument } from "@/lib/sanity-media";

vi.mock("@/lib/deployment-config", () => ({
  getDeploymentConfig: () => ({ localeRoutes: { defaultLocale: "fi-FI" } }),
}));

const config: SanityConfig = {
  projectId: "zp7mbokg",
  dataset: "production",
  datasetVisibility: "public",
  apiVersion: "v2026-06-24",
};

const languages = { language: "en", fallbackLanguage: "fi", config };

const EXPORTED_ASSET = "Tb9Ew8CXIwaY6R1kjMvI0uRR";

function assetOf() {
  const path = `images/${config.projectId}/${config.dataset}/${EXPORTED_ASSET}-1600x1067.webp`;
  return {
    url: `https://cdn.sanity.io/${path}`,
    path,
    extension: "webp",
    mimeType: "image/webp",
    width: 1600,
    height: 1067,
  };
}

function mediaDocumentOf(
  overrides: Partial<RawPublicMediaDocument> = {},
): RawPublicMediaDocument {
  return {
    mediaId: "northern-coast",
    mediaType: "image",
    publiclyRenderable: true,
    alt: [{ language: "en", value: "A rocky northern coastline" }],
    asset: assetOf(),
    ...overrides,
  };
}

function rejectionOf(run: () => unknown): SanityGalleryError {
  try {
    run();
  } catch (error) {
    if (error instanceof SanityGalleryError) return error;
    throw error;
  }
  throw new Error("expected projection to throw");
}

function fakeClient(
  answers: Readonly<Record<string, unknown>>,
): { client: SanityClient; requests: SanityQueryRequest[] } {
  const requests: SanityQueryRequest[] = [];
  return {
    requests,
    client: {
      async query(request) {
        requests.push(request);
        if (request.tag === undefined || !(request.tag in answers)) {
          throw new Error(`no fixture answer for tag "${request.tag}"`);
        }
        return answers[request.tag];
      },
    },
  };
}

describe("GALLERY_DOCUMENT_TYPE", () => {
  it("matches the Studio schema's own type name", () => {
    expect(GALLERY_DOCUMENT_TYPE).toBe(galleryType.name);
  });
});

describe("restated section-intro bounds stay pinned to gallery-sections.ts", () => {
  it("matches every restated constant", () => {
    expect(SCHEMA_MAX_INTRO_BLOCKS).toBe(MAX_INTRO_BLOCKS);
    expect(SCHEMA_MAX_SPANS_PER_BLOCK).toBe(MAX_SPANS_PER_BLOCK);
    expect(SCHEMA_MAX_LIST_ITEMS).toBe(MAX_LIST_ITEMS);
    expect(SCHEMA_MAX_SPAN_TEXT_LENGTH).toBe(MAX_SPAN_TEXT_LENGTH);
    expect(SCHEMA_INTERNAL_LINK_PATH.source).toBe(INTERNAL_LINK_PATH.source);
  });
});

describe("projectGalleryPlacementInput", () => {
  it("projects the gallery variant, always published", () => {
    const document: RawGalleryPlacementDocument = {
      contentId: "content-northern-coast",
      slug: "northern-coast",
      canonicalCategoryRef: "doc-landscape",
      secondaryCategoryRefs: [],
    };
    const index = new Map([["doc-landscape", "cat-landscape"]]);

    expect(projectGalleryPlacementInput(document, index)).toEqual({
      contentId: "content-northern-coast",
      variant: "gallery",
      slug: "northern-coast",
      published: true,
      canonicalCategoryId: "cat-landscape",
    });
  });

  it("throws for a missing slug", () => {
    const error = rejectionOf(() =>
      projectGalleryPlacementInput(
        { contentId: "content-x", canonicalCategoryRef: null },
        new Map(),
      ),
    );
    expect(error.rejection).toBe("incomplete-document");
  });
});

describe("projectGalleryContentPage", () => {
  const detailOf = (overrides: Partial<RawGalleryDetailDocument> = {}): RawGalleryDetailDocument => ({
    contentId: "content-northern-coast",
    title: "Northern Coast",
    publishedAt: "2026-01-15T00:00:00Z",
    ...overrides,
  });

  it("allows an empty body, unlike an article", () => {
    const page = projectGalleryContentPage(detailOf(), languages);
    expect(page.variant).toBe("gallery");
    expect(page.body).toEqual([]);
  });

  it("projects an explicit cover when authored", () => {
    const page = projectGalleryContentPage(
      detailOf({ cover: mediaDocumentOf() }),
      languages,
    );
    expect(page.cover?.mediaId).toBe("northern-coast");
  });

  it("omits cover when none is authored — no fallback resolution here", () => {
    const page = projectGalleryContentPage(detailOf(), languages);
    expect(page.cover).toBeUndefined();
  });

  it("throws for a missing title", () => {
    const error = rejectionOf(() =>
      projectGalleryContentPage(detailOf({ title: undefined }), languages),
    );
    expect(error.rejection).toBe("incomplete-document");
  });
});

describe("readPublicGalleryPage", () => {
  it("returns undefined when this language has no published version", async () => {
    const { client } = fakeClient({ "gallery.detail": [] });
    const page = await readPublicGalleryPage("content-x", { language: "en", client, config });
    expect(page).toBeUndefined();
  });

  it("throws ambiguous-content-id when two documents claim one identity", async () => {
    const { client } = fakeClient({
      "gallery.detail": [
        { contentId: "content-x", title: "A", publishedAt: "2026-01-01T00:00:00Z" },
        { contentId: "content-x", title: "B", publishedAt: "2026-01-02T00:00:00Z" },
      ],
    });
    const error = await readPublicGalleryPage("content-x", { language: "en", client, config }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(SanityGalleryError);
    expect((error as SanityGalleryError).rejection).toBe("ambiguous-content-id");
  });
});

describe("projectGallerySectionSummary", () => {
  it("projects id, slug, label, and the caller-supplied order", () => {
    expect(
      projectGallerySectionSummary(
        { sectionId: "sec-a", slug: "behind-the-scenes", label: "Behind the scenes" },
        2,
        "content-x",
      ),
    ).toEqual({ sectionId: "sec-a", slug: "behind-the-scenes", label: "Behind the scenes", order: 2 });
  });

  it("throws malformed-section when a field is missing", () => {
    const error = rejectionOf(() =>
      projectGallerySectionSummary({ sectionId: "sec-a", slug: undefined, label: "x" }, 0, "content-x"),
    );
    expect(error.rejection).toBe("malformed-section");
  });
});

describe("projectGallerySectionIntro", () => {
  it("returns an empty array for an unauthored intro", () => {
    expect(projectGallerySectionIntro(undefined)).toEqual([]);
  });

  it("projects a paragraph with emphasis and a link, preserving _key", () => {
    const blocks = projectGallerySectionIntro([
      {
        _type: "gallerySectionIntroParagraphBlock",
        _key: "k1",
        spans: [
          { text: "Shot along the " },
          { text: "northern coast", marks: ["emphasis"], href: "/stories/northern-coast" },
          { text: "." },
        ],
      },
    ]);

    expect(blocks).toEqual([
      {
        type: "paragraph",
        key: "k1",
        spans: [
          { text: "Shot along the " },
          { text: "northern coast", marks: ["emphasis"], href: "/stories/northern-coast" },
          { text: "." },
        ],
      },
    ]);
  });

  it("projects a list block with its items, preserving each item's own _key", () => {
    const blocks = projectGallerySectionIntro([
      {
        _type: "gallerySectionIntroListBlock",
        _key: "list-1",
        ordered: true,
        items: [
          { _key: "item-1", spans: [{ text: "First" }] },
          { _key: "item-2", spans: [{ text: "Second" }] },
        ],
      },
    ]);

    expect(blocks).toEqual([
      {
        type: "list",
        key: "list-1",
        ordered: true,
        items: [
          { key: "item-1", spans: [{ text: "First" }] },
          { key: "item-2", spans: [{ text: "Second" }] },
        ],
      },
    ]);
  });

  it("rejects an unknown mark", () => {
    expect(() =>
      projectGallerySectionIntro([
        {
          _type: "gallerySectionIntroParagraphBlock",
          spans: [{ text: "x", marks: ["strikethrough"] }],
        },
      ]),
    ).toThrow(SanityGalleryError);
  });

  it("rejects an unknown block type", () => {
    expect(() =>
      projectGallerySectionIntro([
        { _type: "someOtherBlock" } as never,
      ]),
    ).toThrow(SanityGalleryError);
  });
});

describe("projectGalleryPlacement", () => {
  const rawOf = (overrides: Partial<RawGalleryPlacementItem> = {}): RawGalleryPlacementItem => ({
    placementId: "northern-coast-01",
    media: mediaDocumentOf(),
    visible: true,
    ...overrides,
  });

  it("projects a visible placement with order from the caller's index", () => {
    const placement = projectGalleryPlacement(rawOf(), 3, languages);
    expect(placement).toMatchObject({
      placementId: "northern-coast-01",
      order: 3,
      visible: true,
    });
    expect(placement?.media.mediaId).toBe("northern-coast");
  });

  it("passes through altOverride and captionOverride", () => {
    const placement = projectGalleryPlacement(
      rawOf({ altOverride: "Custom alt", captionOverride: "Custom caption" }),
      0,
      languages,
    );
    expect(placement?.altOverride).toBe("Custom alt");
    expect(placement?.captionOverride).toBe("Custom caption");
  });

  it("reflects the placement's own visible: false", () => {
    const placement = projectGalleryPlacement(rawOf({ visible: false }), 0, languages);
    expect(placement?.visible).toBe(false);
  });

  it("resolves to undefined — not a thrown error — when the media is not publicly renderable (ADR-0002 §3)", () => {
    const placement = projectGalleryPlacement(
      rawOf({ media: mediaDocumentOf({ publiclyRenderable: false }) }),
      0,
      languages,
    );
    expect(placement).toBeUndefined();
  });

  it("still throws for a genuinely malformed row: no placementId", () => {
    const error = rejectionOf(() => projectGalleryPlacement(rawOf({ placementId: undefined }), 0, languages));
    expect(error.rejection).toBe("malformed-result");
  });

  it("still throws when public media fails its own content checks (e.g. no alt text)", () => {
    expect(() =>
      projectGalleryPlacement(
        rawOf({ media: mediaDocumentOf({ alt: [] }) }),
        0,
        languages,
      ),
    ).toThrow();
  });
});
