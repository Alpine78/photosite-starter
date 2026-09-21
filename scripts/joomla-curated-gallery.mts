/** Curated-gallery invariants at the owner-run migration boundary (AB#137).
 * The write API bypasses Studio validation. Supports visible, unpinned placements
 * with manual or fully materialized seeded ordering, and plain named sections.
 */
import { isRealCalendarDateTime, referencedId } from './sanity-document-checks.mts';
import { computeShuffledOrder } from '../src/lib/gallery-shuffle.ts';

// Pinned by tests to the runtime/Studio ceiling; keep the owner-run Node CLI alias-free.
export const MAX_IMPORT_ORDERING_SEED_LENGTH = 256 - 'seeded-random-v1:'.length;
const validSeed = (v: unknown): v is string => typeof v === 'string' &&
  v.trim().length > 0 && v === v.trim() && v.length <= MAX_IMPORT_ORDERING_SEED_LENGTH;

type Document = Readonly<Record<string, unknown>> & { readonly _id: string; readonly _type: string };
const identity = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const language = /^[a-z]{2,3}$/;
export const CURATED_GALLERY_FIELDS = new Set([
  '_id', '_type', 'contentId', 'language', 'title', 'slug', 'summary', 'publishedAt',
  'eventDate', 'endDate', 'tags', 'canonicalAtStoryRoot', 'canonicalCategory',
  'secondaryCategories', 'body', 'cover', 'orderingRule', 'orderingSeed', 'sections',
]);
export const CURATED_PLACEMENT_FIELDS = new Set([
  '_id', '_type', 'placementId', 'gallery', 'media', 'order', 'sectionId',
  'visible', 'pinned', 'altOverride', 'captionOverride', 'shuffledOrder', 'shuffledOrderSeed',
]);
const sectionFields = new Set(['_key', '_type', 'sectionId', 'slug', 'label']);
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonBlank = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

export function validateCuratedGalleryDocuments(documents: readonly Document[]): string[] {
  const errors: string[] = [];
  const byId = new Map(documents.map(d => [d._id, d]));
  const gallerySections = new Map<string, Set<string>>();
  const occurrences = new Map<string, { gallery: unknown; media: string; section: unknown; languages: Set<unknown> }>();
  const orders = new Map<string, Set<number>>();
  const identities = new Map<string, string>();
  const endPlacementIds = new Set(documents.filter(d => d._type === "articleEndGalleryPlacement").map(d => d.placementId));
  for (const d of documents) {
    if (d._type === 'article' || d._type === 'gallery') {
      const type = identities.get(String(d.contentId));
      if (type && type !== d._type) errors.push(`${d._id}: contentId cannot change variant between languages`);
      identities.set(String(d.contentId), d._type);
    }
    if (d._type !== 'gallery') continue;
    const fail = (message: string) => errors.push(`${d._id}: ${message}`);
    if (d._id.length > 128 || !/^migrated--[a-z0-9-]+$/.test(d._id)) fail('invalid document id');
    for (const k of Object.keys(d)) if (!CURATED_GALLERY_FIELDS.has(k)) fail(`unrecognized field ${k}`);
    if (!nonBlank(d.contentId) || !identity.test(d.contentId)) fail('invalid contentId');
    if (!nonBlank(d.language) || !language.test(d.language)) fail('invalid language');
    if (!nonBlank(d.title)) fail('title is required');
    if (!nonBlank(d.slug) || !identity.test(d.slug)) fail('invalid slug');
    if (!isRealCalendarDateTime(d.publishedAt)) fail('publishedAt must be a real ISO instant');
    for (const field of ['eventDate', 'endDate']) {
      if (d[field] !== undefined && !isRealCalendarDateTime(d[field])) fail(`${field} must be a real ISO instant`);
    }
    if (d.orderingRule === 'seeded-random') {
      if (!validSeed(d.orderingSeed)) fail('seeded-random requires a bounded, nonblank orderingSeed without surrounding whitespace');
    } else if (d.orderingRule === 'manual') {
      if (d.orderingSeed !== undefined) fail('manual ordering must not carry orderingSeed');
    } else fail('orderingRule must be manual or seeded-random');
    if (d.body !== undefined && !Array.isArray(d.body)) fail('body must be an array');
    if (d.secondaryCategories !== undefined && !Array.isArray(d.secondaryCategories)) fail('secondaryCategories must be an array of references');
    const canonical = referencedId(d.canonicalCategory);
    const secondaryIds = new Set<string>();
    for (const secondary of Array.isArray(d.secondaryCategories) ? d.secondaryCategories : []) {
      const id = referencedId(secondary);
      if (id === undefined) fail('secondaryCategories must contain references');
      else {
        if (id === canonical) fail('canonical category cannot also be a secondary category');
        if (secondaryIds.has(id)) fail('duplicate secondary category');
        secondaryIds.add(id);
      }
    }
    if (d.summary !== undefined && typeof d.summary !== 'string') fail('summary must be a string');
    if (d.tags !== undefined && (!Array.isArray(d.tags) || !d.tags.every(nonBlank))) fail('tags must contain nonempty strings');
    const cover = referencedId(d.cover);
    if (d.cover !== undefined && (cover === undefined || byId.get(cover)?._type !== 'media' || byId.get(cover)?.publiclyRenderable !== true || byId.get(cover)?.mediaType !== 'image')) fail('cover must resolve to a public image');
    const ids = new Set<string>(), slugs = new Set<string>();
    if (d.sections !== undefined && (!Array.isArray(d.sections) || d.sections.length > 20)) fail('sections must be an array of at most 20 sections');
    for (const s of Array.isArray(d.sections) ? d.sections : []) {
      if (!object(s)) { fail('section must be an object'); continue; }
      for (const k of Object.keys(s)) if (!sectionFields.has(k)) fail(`unrecognized section field ${k}`);
      if (s._type !== undefined && s._type !== 'object') fail('invalid section type');
      if (!nonBlank(s.sectionId) || !identity.test(s.sectionId) || s.sectionId.length > 248 || ids.has(s.sectionId)) fail('invalid or duplicate sectionId');
      else ids.add(s.sectionId);
      if (!nonBlank(s.slug) || !identity.test(s.slug) || s.slug === 'all' || s.slug.length > 256 || slugs.has(s.slug)) fail('invalid or duplicate section slug');
      else slugs.add(s.slug);
      if (!nonBlank(s.label) || s.label.length > 256) fail('invalid section label');
    }
    gallerySections.set(d._id, ids);
  }
  for (const d of documents) {
    if (d._type !== 'galleryPlacement') continue;
    const fail = (message: string) => errors.push(`${d._id}: ${message}`);
    if (d._id.length > 128 || !/^migrated--[a-z0-9-]+$/.test(d._id)) fail('invalid document id');
    for (const k of Object.keys(d)) if (!CURATED_PLACEMENT_FIELDS.has(k)) fail(`unrecognized field ${k}`);
    const gid = referencedId(d.gallery), mid = referencedId(d.media);
    const gallery = gid === undefined ? undefined : byId.get(gid);
    if (gallery?._type !== 'gallery') fail('gallery must resolve to a gallery document');
    if (mid === undefined || byId.get(mid)?._type !== 'media' || byId.get(mid)?.mediaType !== 'image' || byId.get(mid)?.publiclyRenderable !== true) fail('media must resolve to a public image');
    if (d.visible !== true) fail('only visible placements may be imported');
    if (d.pinned !== undefined && d.pinned !== false) fail('pinned placements are unsupported by the importer');
    if (gallery?.orderingRule === 'seeded-random') {
      if (d.shuffledOrderSeed !== gallery.orderingSeed) fail('shuffledOrderSeed must match its gallery seed');
      if (validSeed(gallery.orderingSeed) && nonBlank(d.placementId) &&
          d.shuffledOrder !== computeShuffledOrder(gallery.orderingSeed, d.placementId)) {
        fail('shuffledOrder must match the materialized key for its gallery seed and placementId');
      }
    } else if (d.shuffledOrder !== undefined || d.shuffledOrderSeed !== undefined) {
      fail('manual placements must not carry shuffle fields');
    }
    if (d.sectionId !== undefined && (typeof d.sectionId !== 'string' || !gallerySections.get(gid ?? '')?.has(d.sectionId))) fail('sectionId is not declared by its gallery');
    for (const field of ['altOverride', 'captionOverride']) if (d[field] !== undefined && typeof d[field] !== 'string') fail(`${field} must be a string`);
    const seen = orders.get(gid ?? '') ?? new Set<number>();
    if (typeof d.order !== 'number' || !Number.isSafeInteger(d.order) || d.order < 0 || seen.has(d.order)) fail('order must be a unique nonnegative safe integer in its gallery');
    else seen.add(d.order);
    orders.set(gid ?? '', seen);
    if (!nonBlank(d.placementId) || d.placementId.length > 256) { fail('invalid placementId'); continue; }
    if (endPlacementIds.has(d.placementId)) fail('placementId also belongs to an article end gallery');
    if (gallery && mid) {
      const occurrence = occurrences.get(d.placementId);
      if (occurrence) {
        if (occurrence.gallery !== gallery.contentId || occurrence.media !== mid || occurrence.section !== d.sectionId || occurrence.languages.has(gallery.language)) fail('placementId identifies different occurrences or repeats within one language');
        occurrence.languages.add(gallery.language);
      } else occurrences.set(d.placementId, { gallery: gallery.contentId, media: mid, section: d.sectionId, languages: new Set([gallery.language]) });
    }
  }
  return errors;
}
