import { describe, expect, it } from "vitest";

import { MAX_CATEGORY_DEPTH as SCHEMA_MAX_CATEGORY_DEPTH } from "@/lib/content-tree";
import { ARTICLE_TYPE_NAME as SCHEMA_ARTICLE_TYPE_NAME } from "../sanity/schemas/article";
import { publishedIdOf as schemaPublishedIdOf } from "../sanity/schemas/validation";
import { CATEGORY_TYPE_NAME as SCHEMA_CATEGORY_TYPE_NAME } from "../sanity/schemas/category";
import { CONTENT_BLOCK_OBJECT_TYPES as SCHEMA_CONTENT_BLOCK_OBJECT_TYPES } from "../sanity/schemas/content-block";
import { GALLERY_TYPE_NAME as SCHEMA_GALLERY_TYPE_NAME } from "../sanity/schemas/gallery";
import {
  GALLERY_SECTION_INLINE_SPAN_TYPE_NAME as SCHEMA_GALLERY_SECTION_INLINE_SPAN_TYPE_NAME,
  GALLERY_SECTION_INTRO_LIST_ITEM_TYPE_NAME as SCHEMA_GALLERY_SECTION_INTRO_LIST_ITEM_TYPE_NAME,
  GALLERY_SECTION_INTRO_LIST_TYPE_NAME as SCHEMA_GALLERY_SECTION_INTRO_LIST_TYPE_NAME,
  GALLERY_SECTION_INTRO_PARAGRAPH_TYPE_NAME as SCHEMA_GALLERY_SECTION_INTRO_PARAGRAPH_TYPE_NAME,
} from "../sanity/schemas/gallery-section-intro";
import { GALLERY_PLACEMENT_TYPE_NAME as SCHEMA_GALLERY_PLACEMENT_TYPE_NAME } from "../sanity/schemas/gallery-placement";
import { HOME_PAGE_TYPE_NAME as SCHEMA_HOME_PAGE_TYPE_NAME } from "../sanity/schemas/home-page";
import { LANGUAGE_SUBTAG as SCHEMA_LANGUAGE_SUBTAG, LOCALIZED_TEXT_TYPE_NAME as SCHEMA_LOCALIZED_TEXT_TYPE_NAME } from "../sanity/schemas/localized-text";
import { LOCALIZED_SLUG_TYPE_NAME as SCHEMA_LOCALIZED_SLUG_TYPE_NAME } from "../sanity/schemas/localized-slug";
import {
  MAX_PUBLIC_DELIVERY_DIMENSION as SCHEMA_MAX_PUBLIC_DELIVERY_DIMENSION,
  MEDIA_TYPE_NAME as SCHEMA_MEDIA_TYPE_NAME,
  PUBLIC_DELIVERY_FORMATS as SCHEMA_PUBLIC_DELIVERY_FORMATS,
} from "../sanity/schemas/media";
import { SERVICE_TYPE_NAME as SCHEMA_SERVICE_TYPE_NAME } from "../sanity/schemas/service";
import {
  HOME_ACTION_TYPE_NAME as SCHEMA_HOME_ACTION_TYPE_NAME,
  HOME_SECTION_TYPE_NAME as SCHEMA_HOME_SECTION_TYPE_NAME,
  NAVIGATION_ITEM_TYPE_NAME as SCHEMA_NAVIGATION_ITEM_TYPE_NAME,
} from "../sanity/schemas/site-link";
import { SITE_SETTINGS_TYPE_NAME as SCHEMA_SITE_SETTINGS_TYPE_NAME } from "../sanity/schemas/site-settings";

import {
  ARCHIVE_GALLERY_CONTENT_ID,
  ARCHIVE_GALLERY_PLACEMENT_COUNT,
  ARTICLE_TYPE_NAME,
  buildSeedFixtures,
  CATEGORY_TYPE_NAME,
  collectSeedIdentities,
  FEATURED_GALLERY_CONTENT_ID,
  FEATURED_GALLERY_PLACEMENT_COUNT,
  GALLERY_LANGUAGE,
  orderSeedDocumentsForDeletion,
  GALLERY_PLACEMENT_TYPE_NAME,
  GALLERY_TYPE_NAME,
  CONTENT_BLOCK_OBJECT_TYPES,
  GALLERY_SECTION_INLINE_SPAN_TYPE_NAME,
  GALLERY_SECTION_INTRO_LIST_ITEM_TYPE_NAME,
  GALLERY_SECTION_INTRO_LIST_TYPE_NAME,
  GALLERY_SECTION_INTRO_PARAGRAPH_TYPE_NAME,
  HOME_ACTION_TYPE_NAME,
  HOME_PAGE_ID,
  HOME_PAGE_TYPE_NAME,
  HOME_SECTION_TYPE_NAME,
  isPendingAssetRef,
  LANGUAGE_SUBTAG,
  LOCALIZED_SLUG_TYPE_NAME,
  LOCALIZED_TEXT_TYPE_NAME,
  MAX_CATEGORY_DEPTH,
  MAX_PUBLIC_DELIVERY_DIMENSION,
  MEDIA_KEYS,
  MEDIA_TYPE_NAME,
  NAVIGATION_ITEM_TYPE_NAME,
  PUBLIC_DELIVERY_FORMATS,
  publishedIdOf,
  SEED_ID_ROOT,
  SERVICE_TYPE_NAME,
  SITE_SETTINGS_ID,
  SITE_SETTINGS_TYPE_NAME,
  validateSeedFixtures,
} from "./sanity-seed-fixtures.mts";

describe("restated schema constants stay pinned to sanity/schemas", () => {
  it("matches every type-name constant", () => {
    expect(ARTICLE_TYPE_NAME).toBe(SCHEMA_ARTICLE_TYPE_NAME);
    expect(CATEGORY_TYPE_NAME).toBe(SCHEMA_CATEGORY_TYPE_NAME);
    expect(GALLERY_TYPE_NAME).toBe(SCHEMA_GALLERY_TYPE_NAME);
    expect(GALLERY_PLACEMENT_TYPE_NAME).toBe(SCHEMA_GALLERY_PLACEMENT_TYPE_NAME);
    expect(HOME_PAGE_TYPE_NAME).toBe(SCHEMA_HOME_PAGE_TYPE_NAME);
    expect(MEDIA_TYPE_NAME).toBe(SCHEMA_MEDIA_TYPE_NAME);
    expect(SERVICE_TYPE_NAME).toBe(SCHEMA_SERVICE_TYPE_NAME);
    expect(SITE_SETTINGS_TYPE_NAME).toBe(SCHEMA_SITE_SETTINGS_TYPE_NAME);
    expect(HOME_ACTION_TYPE_NAME).toBe(SCHEMA_HOME_ACTION_TYPE_NAME);
    expect(HOME_SECTION_TYPE_NAME).toBe(SCHEMA_HOME_SECTION_TYPE_NAME);
    expect(NAVIGATION_ITEM_TYPE_NAME).toBe(SCHEMA_NAVIGATION_ITEM_TYPE_NAME);
    expect(LOCALIZED_TEXT_TYPE_NAME).toBe(SCHEMA_LOCALIZED_TEXT_TYPE_NAME);
    expect(LOCALIZED_SLUG_TYPE_NAME).toBe(SCHEMA_LOCALIZED_SLUG_TYPE_NAME);
    expect(GALLERY_SECTION_INLINE_SPAN_TYPE_NAME).toBe(SCHEMA_GALLERY_SECTION_INLINE_SPAN_TYPE_NAME);
    expect(GALLERY_SECTION_INTRO_PARAGRAPH_TYPE_NAME).toBe(SCHEMA_GALLERY_SECTION_INTRO_PARAGRAPH_TYPE_NAME);
    expect(GALLERY_SECTION_INTRO_LIST_ITEM_TYPE_NAME).toBe(SCHEMA_GALLERY_SECTION_INTRO_LIST_ITEM_TYPE_NAME);
    expect(GALLERY_SECTION_INTRO_LIST_TYPE_NAME).toBe(SCHEMA_GALLERY_SECTION_INTRO_LIST_TYPE_NAME);
  });

  it("matches the content-block object type map", () => {
    expect(CONTENT_BLOCK_OBJECT_TYPES).toEqual(SCHEMA_CONTENT_BLOCK_OBJECT_TYPES);
  });

  it("matches the public-delivery policy", () => {
    expect(MAX_PUBLIC_DELIVERY_DIMENSION).toBe(SCHEMA_MAX_PUBLIC_DELIVERY_DIMENSION);
    expect(PUBLIC_DELIVERY_FORMATS).toEqual(SCHEMA_PUBLIC_DELIVERY_FORMATS);
  });

  it("matches the language-subtag pattern", () => {
    expect(LANGUAGE_SUBTAG.source).toBe(SCHEMA_LANGUAGE_SUBTAG.source);
  });

  it("matches the maximum category depth", () => {
    expect(MAX_CATEGORY_DEPTH).toBe(SCHEMA_MAX_CATEGORY_DEPTH);
  });
});

describe("buildSeedFixtures", () => {
  it("passes its own invariant checks with no asset map (dry-run shape)", () => {
    const { documents } = buildSeedFixtures();
    expect(validateSeedFixtures(documents)).toEqual([]);
  });

  it("passes its own invariant checks with a resolved asset map (apply shape)", () => {
    const assetRefsByKey = new Map(MEDIA_KEYS.map((key) => [key, `image-${key}-abc123-1200x800-webp`]));
    const { documents } = buildSeedFixtures({ assetRefsByKey });
    expect(validateSeedFixtures(documents)).toEqual([]);
  });

  it("uses a recognizable placeholder asset ref when no map is given, never a real one", () => {
    const { documents } = buildSeedFixtures();
    const mediaDocs = documents.filter((doc) => doc._type === MEDIA_TYPE_NAME);
    expect(mediaDocs).toHaveLength(MEDIA_KEYS.length);
    for (const doc of mediaDocs) {
      const image = doc.image as { readonly asset: { readonly _ref: string } };
      expect(isPendingAssetRef(image.asset._ref)).toBe(true);
    }
  });

  it("resolves a real ref when the asset map supplies one", () => {
    const assetRefsByKey = new Map([["coastal-landscape", "image-real-ref-123"]]);
    const { documents } = buildSeedFixtures({ assetRefsByKey });
    const doc = documents.find(
      (item) => item._type === MEDIA_TYPE_NAME && item.mediaId === "coastal-landscape",
    );
    const image = doc?.image as { readonly asset: { readonly _ref: string } };
    expect(image.asset._ref).toBe("image-real-ref-123");
  });

  it("creates exactly one media document per real photograph, never more", () => {
    const { documents } = buildSeedFixtures();
    const mediaDocs = documents.filter((doc) => doc._type === MEDIA_TYPE_NAME);
    expect(mediaDocs).toHaveLength(6);
    expect(new Set(mediaDocs.map((doc) => doc.mediaId))).toEqual(new Set(MEDIA_KEYS));
  });

  it("gives every document a dot-path id under the seed.** namespace", () => {
    const { documents } = buildSeedFixtures();
    for (const doc of documents) {
      expect(doc._id.startsWith(`${SEED_ID_ROOT}.`)).toBe(true);
    }
    expect(SITE_SETTINGS_ID).toBe("seed.site-settings");
    expect(HOME_PAGE_ID).toBe("seed.home-page");
  });

  it("builds exactly one singleton site-settings and one home-page document", () => {
    const { documents } = buildSeedFixtures();
    expect(documents.filter((doc) => doc._type === SITE_SETTINGS_TYPE_NAME)).toHaveLength(1);
    expect(documents.filter((doc) => doc._type === HOME_PAGE_TYPE_NAME)).toHaveLength(1);
  });

  it("builds a 3-level category tree with no cycles or orphaned parents", () => {
    const { documents } = buildSeedFixtures();
    const categories = documents.filter((doc) => doc._type === CATEGORY_TYPE_NAME);
    expect(categories.length).toBeGreaterThanOrEqual(6);

    const byId = new Map(categories.map((doc) => [doc.categoryId as string, doc]));
    let maxDepth = 0;
    for (const category of categories) {
      let depth = 1;
      let current = category;
      const visited = new Set<string>();
      while (true) {
        const parentRef = (current.parent as { readonly _ref?: string } | undefined)?._ref;
        if (parentRef === undefined) break;
        const parentCategoryId = parentRef.replace("seed.category.", "");
        expect(visited.has(parentCategoryId)).toBe(false);
        visited.add(parentCategoryId);
        const parent = byId.get(parentCategoryId);
        expect(parent).toBeDefined();
        current = parent!;
        depth += 1;
      }
      maxDepth = Math.max(maxDepth, depth);
    }
    expect(maxDepth).toBe(3);
  });

  it("builds exactly one gallery with sections+body and one with neither", () => {
    const { documents } = buildSeedFixtures();
    const galleries = documents.filter((doc) => doc._type === GALLERY_TYPE_NAME);
    expect(galleries).toHaveLength(2);

    const withBoth = galleries.filter((doc) => {
      const sections = doc.sections as readonly unknown[];
      const body = doc.body as readonly unknown[] | undefined;
      return sections.length > 0 && (body?.length ?? 0) > 0;
    });
    const withNeither = galleries.filter((doc) => {
      const sections = doc.sections as readonly unknown[];
      const body = doc.body as readonly unknown[] | undefined;
      return sections.length === 0 && (body?.length ?? 0) === 0;
    });
    expect(withBoth).toHaveLength(1);
    expect(withNeither).toHaveLength(1);
  });

  it("builds exactly the documented archive placement count", () => {
    const { documents } = buildSeedFixtures();
    const archiveGalleryId = `seed.gallery.${ARCHIVE_GALLERY_CONTENT_ID}.${GALLERY_LANGUAGE}`;
    const archivePlacements = documents.filter(
      (doc) =>
        doc._type === GALLERY_PLACEMENT_TYPE_NAME &&
        (doc.gallery as { readonly _ref?: string } | undefined)?._ref === archiveGalleryId,
    );
    expect(archivePlacements).toHaveLength(400);
    expect(ARCHIVE_GALLERY_PLACEMENT_COUNT).toBe(400);
  });

  it("builds the documented featured-gallery placement count across two sections", () => {
    const { documents } = buildSeedFixtures();
    const featuredGalleryId = `seed.gallery.${FEATURED_GALLERY_CONTENT_ID}.${GALLERY_LANGUAGE}`;
    const featuredPlacements = documents.filter(
      (doc) =>
        doc._type === GALLERY_PLACEMENT_TYPE_NAME &&
        (doc.gallery as { readonly _ref?: string } | undefined)?._ref === featuredGalleryId,
    );
    expect(featuredPlacements).toHaveLength(FEATURED_GALLERY_PLACEMENT_COUNT);
    const sectionIds = new Set(featuredPlacements.map((doc) => doc.sectionId));
    expect(sectionIds).toEqual(new Set(["high-tide", "low-tide"]));
  });

  it("places the same media document in both galleries under distinct placement ids", () => {
    const { documents } = buildSeedFixtures();
    const placements = documents.filter((doc) => doc._type === GALLERY_PLACEMENT_TYPE_NAME);
    const archiveGalleryId = `seed.gallery.${ARCHIVE_GALLERY_CONTENT_ID}.${GALLERY_LANGUAGE}`;
    const featuredGalleryId = `seed.gallery.${FEATURED_GALLERY_CONTENT_ID}.${GALLERY_LANGUAGE}`;

    const mediaRef = (doc: (typeof placements)[number]) =>
      (doc.media as { readonly _ref?: string } | undefined)?._ref;
    const galleryRef = (doc: (typeof placements)[number]) =>
      (doc.gallery as { readonly _ref?: string } | undefined)?._ref;

    const inArchive = new Set(
      placements.filter((doc) => galleryRef(doc) === archiveGalleryId).map(mediaRef),
    );
    const inFeatured = new Set(
      placements.filter((doc) => galleryRef(doc) === featuredGalleryId).map(mediaRef),
    );
    const sharedMedia = [...inArchive].filter((id) => inFeatured.has(id));
    expect(sharedMedia.length).toBeGreaterThan(0);

    const [sharedMediaId] = sharedMedia;
    const archivePlacement = placements.find(
      (doc) => galleryRef(doc) === archiveGalleryId && mediaRef(doc) === sharedMediaId,
    );
    const featuredPlacement = placements.find(
      (doc) => galleryRef(doc) === featuredGalleryId && mediaRef(doc) === sharedMediaId,
    );
    expect(archivePlacement?.placementId).not.toBe(featuredPlacement?.placementId);
  });

  it("gives every article and gallery a canonicalCategory", () => {
    const { documents } = buildSeedFixtures();
    for (const doc of documents) {
      if (doc._type !== ARTICLE_TYPE_NAME && doc._type !== GALLERY_TYPE_NAME) continue;
      expect(doc.canonicalCategory).toBeDefined();
    }
  });

  it("builds exactly the documented service count", () => {
    const { documents } = buildSeedFixtures();
    expect(documents.filter((doc) => doc._type === SERVICE_TYPE_NAME)).toHaveLength(3);
  });

  it("has no invariant violations", () => {
    const { documents } = buildSeedFixtures();
    expect(validateSeedFixtures(documents)).toEqual([]);
  });
});

describe("validateSeedFixtures", () => {
  it("catches a duplicate mediaId", () => {
    const { documents } = buildSeedFixtures();
    const mediaDocs = documents.filter((doc) => doc._type === MEDIA_TYPE_NAME);
    const [first, second] = mediaDocs;
    const tampered = documents.map((doc) => (doc._id === second._id ? { ...doc, mediaId: first.mediaId } : doc));
    const violations = validateSeedFixtures(tampered);
    expect(violations.some((message) => message.includes("duplicate mediaId"))).toBe(true);
  });

  it("catches an unresolved canonicalCategory reference", () => {
    const { documents } = buildSeedFixtures();
    const tampered = documents.map((doc) =>
      doc._type === ARTICLE_TYPE_NAME
        ? { ...doc, canonicalCategory: { _type: "reference", _ref: "seed.category.does-not-exist" } }
        : doc,
    );
    const violations = validateSeedFixtures(tampered);
    expect(violations.some((message) => message.includes("does not resolve to a category"))).toBe(true);
  });

  it("catches a duplicate _key within one array", () => {
    const { documents } = buildSeedFixtures();
    const tampered = documents.map((doc) => {
      if (doc._type !== SITE_SETTINGS_TYPE_NAME) return doc;
      const navigation = doc.navigation as readonly Record<string, unknown>[];
      return {
        ...doc,
        navigation: navigation.map((item, index) => (index === 1 ? { ...item, _key: navigation[0]._key } : item)),
      };
    });
    const violations = validateSeedFixtures(tampered);
    expect(violations.some((message) => message.includes("duplicate _key"))).toBe(true);
  });

  it("catches a claimed contentId shared between an article and a gallery", () => {
    const { documents } = buildSeedFixtures();
    const gallery = documents.find((doc) => doc._type === GALLERY_TYPE_NAME);
    const tampered = documents.map((doc) =>
      doc._type === ARTICLE_TYPE_NAME ? { ...doc, contentId: gallery!.contentId } : doc,
    );
    const violations = validateSeedFixtures(tampered);
    expect(violations.some((message) => message.includes("is claimed by both"))).toBe(true);
  });

  it("catches a publishedAt that is not a real calendar date", () => {
    const { documents } = buildSeedFixtures();
    const tampered = documents.map((doc) =>
      doc._type === ARTICLE_TYPE_NAME ? { ...doc, publishedAt: "2026-02-31T08:00:00.000Z" } : doc,
    );
    const violations = validateSeedFixtures(tampered);
    expect(violations.some((message) => message.includes("publishedAt is not a real ISO calendar date"))).toBe(
      true,
    );
  });

  it("catches a blank category label", () => {
    const { documents } = buildSeedFixtures();
    const tampered = documents.map((doc) => {
      if (doc._type !== CATEGORY_TYPE_NAME) return doc;
      const label = doc.label as readonly Record<string, unknown>[];
      return { ...doc, label: label.map((entry, index) => (index === 0 ? { ...entry, value: "   " } : entry)) };
    });
    const violations = validateSeedFixtures(tampered);
    expect(violations.some((message) => message.includes("blank label value"))).toBe(true);
  });

  it("catches a category tree deeper than the maximum", () => {
    const { documents } = buildSeedFixtures();
    const tidalPools = documents.find(
      (doc) => doc._type === CATEGORY_TYPE_NAME && doc.categoryId === "tidal-pools",
    )!;
    const extraLevels = Array.from({ length: MAX_CATEGORY_DEPTH }, (_unused, index) => ({
      _id: `seed.category.too-deep-${index}`,
      _type: CATEGORY_TYPE_NAME,
      categoryId: `too-deep-${index}`,
      parent: { _type: "reference", _ref: index === 0 ? tidalPools._id : `seed.category.too-deep-${index - 1}` },
      slug: [{ _key: "fi", _type: LOCALIZED_SLUG_TYPE_NAME, language: "fi", value: `too-deep-${index}` }],
      label: [{ _key: "fi", _type: LOCALIZED_TEXT_TYPE_NAME, language: "fi", value: `Too deep ${index}` }],
      order: 0,
    }));
    const violations = validateSeedFixtures([...documents, ...extraLevels]);
    expect(violations.some((message) => message.includes("exceeds the maximum"))).toBe(true);
  });
});

describe("collectSeedIdentities", () => {
  it("collects every mediaId/categoryId/service slug/(contentId, language) with its expected _id", () => {
    const { documents } = buildSeedFixtures();
    const identities = collectSeedIdentities(documents);

    expect(identities.mediaIds).toContain("coastal-landscape");
    expect(identities.expectedIdByIdentity.get("media:coastal-landscape")).toBe("seed.media.coastal-landscape");

    expect(identities.categoryIds).toContain("tidal-pools");
    expect(identities.expectedIdByIdentity.get("category:tidal-pools")).toBe("seed.category.tidal-pools");

    expect(identities.serviceSlugs).toContain("portrait-sessions");
    expect(identities.expectedIdByIdentity.get("service:portrait-sessions")).toBe(
      "seed.service.portrait-sessions",
    );

    expect(identities.contentIds).toContain("coastal-light");
    expect(identities.expectedIdByIdentity.get("content:coastal-light:fi")).toBe(
      "seed.article.coastal-light.fi",
    );
    expect(identities.expectedIdByIdentity.get("content:coastal-light:en")).toBe(
      "seed.article.coastal-light.en",
    );
    expect(identities.expectedIdByIdentity.get("content:featured:fi")).toBe("seed.gallery.featured.fi");
  });

  it("collects every placementId, unchunked, with its expected _id", () => {
    const { documents } = buildSeedFixtures();
    const identities = collectSeedIdentities(documents);
    expect(identities.placementIds.length).toBe(FEATURED_GALLERY_PLACEMENT_COUNT + ARCHIVE_GALLERY_PLACEMENT_COUNT);
    expect(identities.placementIds).toContain("archive-0001");
    expect(identities.expectedIdByIdentity.get("placement:archive-0001")).toBe("seed.placement.archive-0001");
  });

  it("records one variant per contentId, regardless of how many language versions it has", () => {
    const { documents } = buildSeedFixtures();
    const identities = collectSeedIdentities(documents);
    // "coastal-light" is authored in both fi and en (two article documents,
    // one contentId) — the variant map must still resolve to a single value.
    expect(identities.expectedVariantByContentId.get("coastal-light")).toBe(ARTICLE_TYPE_NAME);
    expect(identities.expectedVariantByContentId.get("featured")).toBe(GALLERY_TYPE_NAME);
  });
});

describe("orderSeedDocumentsForDeletion", () => {
  it("puts every galleryPlacement in the first wave, and accounts for every document exactly once", () => {
    const { documents } = buildSeedFixtures();
    const waves = orderSeedDocumentsForDeletion(documents);

    expect(waves[0].length).toBe(FEATURED_GALLERY_PLACEMENT_COUNT + ARCHIVE_GALLERY_PLACEMENT_COUNT);
    expect(waves[0].every((doc) => doc._type === "galleryPlacement")).toBe(true);
    expect(waves.slice(1).flat().every((doc) => doc._type !== "galleryPlacement")).toBe(true);
    expect(waves.flat().length).toBe(documents.length);
  });

  it("orders every category strictly after its own parent's wave never comes first", () => {
    const { documents } = buildSeedFixtures();
    const waves = orderSeedDocumentsForDeletion(documents);
    const waveIndexById = new Map(waves.flatMap((wave, index) => wave.map((doc) => [doc._id, index] as const)));

    for (const doc of documents) {
      if (doc._type !== "category") continue;
      const parentRef = (doc.parent as { readonly _ref?: string } | undefined)?._ref;
      if (parentRef === undefined) continue;
      // A category must be deleted (an earlier wave) before its own parent
      // (a later wave) — the child's wave index must be strictly smaller.
      expect(waveIndexById.get(doc._id)).toBeLessThan(waveIndexById.get(parentRef)!);
    }
  });

  it("orders media strictly after everything that can reference it", () => {
    const { documents } = buildSeedFixtures();
    const waves = orderSeedDocumentsForDeletion(documents);
    const waveIndexById = new Map(waves.flatMap((wave, index) => wave.map((doc) => [doc._id, index] as const)));
    const mediaWaveIndex = Math.min(
      ...documents.filter((doc) => doc._type === "media").map((doc) => waveIndexById.get(doc._id)!),
    );

    for (const doc of documents) {
      if (doc._type !== "article" && doc._type !== "gallery" && doc._type !== "service" && doc._type !== "homePage") {
        continue;
      }
      expect(waveIndexById.get(doc._id)!).toBeLessThan(mediaWaveIndex);
    }
  });

  it("orders siteSettings last, since nothing references it and it references nothing", () => {
    const { documents } = buildSeedFixtures();
    const waves = orderSeedDocumentsForDeletion(documents);
    expect(waves.at(-1)?.every((doc) => doc._type === "siteSettings")).toBe(true);
  });
});

describe("publishedIdOf", () => {
  it("matches sanity/schemas/validation.ts's implementation for a plain, a draft, and a version id", () => {
    for (const id of ["seed.media.coastal-landscape", "drafts.seed.media.coastal-landscape", "versions.release-1.seed.media.coastal-landscape"]) {
      expect(publishedIdOf(id)).toBe(schemaPublishedIdOf(id));
    }
  });

  it("strips a drafts. prefix", () => {
    expect(publishedIdOf("drafts.seed.category.landscapes")).toBe("seed.category.landscapes");
  });

  it("strips a versions.<release>. prefix", () => {
    expect(publishedIdOf("versions.summer-launch.seed.category.landscapes")).toBe("seed.category.landscapes");
  });

  it("leaves a plain id unchanged", () => {
    expect(publishedIdOf("seed.category.landscapes")).toBe("seed.category.landscapes");
  });
});
