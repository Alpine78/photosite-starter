/**
 * AB#137's import plan: approved manifest rows plus converted bodies composed
 * into the Sanity documents a later write would create — and, deliberately, not
 * written by anything in this slice.
 *
 * Pure and offline. The plan is a versioned, machine-readable handoff artifact:
 * it names every document, every unresolved requirement, the digests it was
 * built from, and the phase it covers, so the write step (a separate story) has
 * a reviewable input rather than re-deriving the same decisions from the source.
 *
 * ## The plan is never writable from here
 *
 * Two things a document needs cannot be known offline: which Sanity asset a
 * photograph's derivative becomes, and which document id a category identity
 * resolves to in the target dataset. Both are emitted as explicit *pending*
 * markers rather than guessed, and `ImportPlan.writable` is false while any
 * remains. A plan that looked writable while carrying a placeholder reference
 * is exactly the failure this shape exists to prevent — it would create
 * articles pointing at nothing.
 *
 * ## Four identities, kept apart
 *
 * A migration is where these quietly collapse into each other, and every
 * collapse is a defect:
 *
 * - **Photograph identity** (`mediaId`) — one photograph, forever. ADR-0002 §1
 *   requires it to survive a filename change, a re-upload, and a re-run, so it
 *   is read from a *persisted* map rather than derived from whatever the file
 *   is currently called. A new locator mints a new identity and is added to the
 *   map the plan returns, which the owner keeps between phases.
 * - **Placement identity** (`placementId`) — one *occurrence*. The same
 *   photograph appearing twice is two placements over one identity, never two
 *   photographs.
 * - **Source locator** — where the bytes are in the owner's private tree. Never
 *   published, never an identity.
 * - **Derivative and asset reference** — resolved by the write step from real
 *   bytes, which is also the only moment the public-delivery bound can honestly
 *   be checked.
 */

import { validateCuratedGalleryDocuments } from "./joomla-curated-gallery.mts";
import { validateHistoricalPollDocuments } from "./joomla-polls.mts";
import { createHash, randomBytes } from "node:crypto";

import {
  collectDuplicateIds,
  collectKeyViolations,
  isRealCalendarDateTime,
  referencedId,
} from "./sanity-document-checks.mts";
import {
  CONVERSION_POLICY_VERSION,
  resolvedConversionDigest,
  type ConversionResult,
  type SanityBlock,
} from "./joomla-html-conversion.mts";
import {
  assessApprovedConversion,
  IDENTITY_PATTERN,
  type ApprovedArticle,
} from "./joomla-import-manifest.mts";

/**
 * Bumped to v5 for curated gallery and galleryPlacement documents.
 * Bumped to v4 when an article gained the explicit `canonicalAtStoryRoot`
 * alternative to `canonicalCategory` (ADR-0003's 2026-09-19 amendment). A v3
 * writer would treat the missing category reference as malformed or unplaced.
 * Previously bumped to v3 for AB#162 historical poll/tally documents, and
 * to v2 when `AssetRequirement` gained `contentHash` (AB#137 write-half
 * planning, Codex plan-review round 1, finding 2): the plan's own format changed, so a
 * version-equality check would be meaningless against a constant that never moved — a
 * stale v1 plan, genuinely missing every hash, would otherwise satisfy it.
 */
export const IMPORT_PLAN_VERSION = "joomla-import-plan-v5";

/**
 * Restated from `sanity/schemas/article.ts` and `sanity/schemas/gallery-
 * placement.ts` (schemas import nothing from `scripts/`, so the copies are
 * pinned equal by a test rather than shared at runtime, the same convention
 * `content-block.ts`'s own bounds already follow here). An id built from an
 * approved `contentId` the manifest never length-bounds could exceed either
 * limit; the Studio's own validation cannot catch it because an API import
 * bypasses Studio entirely (found in Codex review round 4).
 */
export const MAX_ARTICLE_END_GALLERY_ID_LENGTH = 128;
export const MAX_PLACEMENT_ID_LENGTH = 256;

/**
 * Sanity's own document `_id` bound (verified against sanity.io/docs/content-
 * lake/ids and .../technical-limits, 2026-09-17): 128 characters. `migratedId`
 * validates its segments' *characters* but not the assembled result's length —
 * an arbitrarily long, otherwise-valid `content_id` could produce an `_id`
 * past this bound, which an offline plan would report clean while the
 * eventual write fails (found in Codex review round 5).
 */
export const MAX_SANITY_DOCUMENT_ID_LENGTH = 128;

/**
 * Migrated launch content lives in its own id namespace, deliberately not the
 * demo seeder's `seed--`. This is a safety property, not a naming preference:
 * `npm run seed:sanity -- --delete-all` deletes every `seed--` document, so real
 * launch content written under that prefix would be destroyable by the demo
 * seeder's own go-live cleanup command. A test pins the two namespaces apart.
 *
 * Dot-free and root-level, because Sanity restricts dot-path ids to
 * authenticated reads even in a public dataset — the same constraint AB#84 hit.
 */
export const MIGRATED_ID_PREFIX = "migrated--";

/** Placeholder references. Their presence is what makes a plan non-writable. */
export const PENDING_ASSET_PREFIX = "migrated-pending-asset:";
export const PENDING_CATEGORY_PREFIX = "migrated-pending-category:";

const ARTICLE_TYPE_NAME = "article";
const MEDIA_TYPE_NAME = "media";
const ARTICLE_END_GALLERY_PLACEMENT_TYPE_NAME = "articleEndGalleryPlacement";

export type PlannedDocument = Readonly<Record<string, unknown>> & {
  readonly _id: string;
  readonly _type: string;
};

/** What the write step must produce before this photograph can be published. */
export type AssetRequirement = {
  readonly mediaId: string;
  /** Path inside the owner's private source tree. Private material — reports only. */
  readonly sourceLocator: string;
  /**
   * SHA-256 of the exact bytes this photograph's approval was bound to
   * (`resolvedConversionDigest` already folds this into the approval check at plan-build
   * time — see that function's own doc comment). The write step, which may run
   * arbitrarily later against a separately-minted credential, re-hashes the file at
   * `sourceLocator` immediately before uploading and refuses on any mismatch — otherwise
   * a file changed in that window (an accidental overwrite, a re-export) would be
   * uploaded unreviewed, reintroducing exactly the "approval not bound to actual pixels"
   * gap round 7 closed, just moved one step later in the pipeline.
   */
  readonly contentHash: string;
};

export type CategoryRequirement = {
  /** Stable category identity from the public content tree. */
  readonly categoryId: string;
};

/** Persisted between runs and phases so a photograph keeps one identity forever. */
export type PhotographIdentityMap = Readonly<Record<string, string>>;

export type PlannedArticleInput = {
  readonly approval: ApprovedArticle;
  readonly title: string;
  readonly summary?: string;
  readonly author?: string;
  readonly tags?: readonly string[];
  /** SHA-256 of the whole imported source record, compared against the approval's own digest. */
  readonly sourceDigest: string;
  readonly conversion: ConversionResult;
};

export type ImportPlan = {
  readonly version: string;
  readonly conversionPolicy: string;
  readonly phase: string;
  readonly manifestDigest: string;
  readonly sourceExportDigest: string;
  readonly documents: readonly PlannedDocument[];
  /**
   * SHA-256 over `documents` (see `writablePlanDigest`'s own doc comment) — printed for
   * the owner to record and later supply to `write:joomla` as `--approved-digest`,
   * mirroring the manifest's own `resolved_digest` column: a value the write step
   * recomputes and compares, never trusts from inside the (possibly tampered) file
   * itself, since a hand-edited plan could just as easily hand-edit this field to match.
   */
  readonly documentsDigest: string;
  readonly assetRequirements: readonly AssetRequirement[];
  readonly categoryRequirements: readonly CategoryRequirement[];
  /** The map to persist: every photograph identity known after this run. */
  readonly photographIdentities: PhotographIdentityMap;
  /** Source articles excluded from this plan, each with why. */
  readonly blocked: readonly { readonly sourceId: string; readonly language: string; readonly reasons: readonly string[] }[];
  readonly errors: readonly string[];
  /** Always false in this slice; the reasons say what a write step must resolve first. */
  readonly writable: boolean;
  readonly notWritableBecause: readonly string[];
};

/** Pure assembly, shared by `migratedId` and the pre-flight length checks below. */
function assembleMigratedId(segments: readonly string[]): string {
  return `${MIGRATED_ID_PREFIX}${segments.map((segment) => segment.trim().toLowerCase()).join("-")}`;
}

/**
 * `migrated--<segments joined by ->`, validated segment by segment and, once
 * assembled, against Sanity's own document id length bound. Throws rather than
 * silently truncating: a truncated id could collide with an unrelated one.
 *
 * Every call site in `buildImportPlan` checks the same length as a *blocker*
 * before reaching here (see `wouldExceedDocumentIdLimit`), so this throw is a
 * last-resort invariant, not the normal way a too-long id is reported — a
 * throw reaching a caller mid-construction would abort the whole plan instead
 * of reporting one blocked article.
 */
export function migratedId(...segments: readonly string[]): string {
  const joined = segments.map((segment) => segment.trim().toLowerCase()).join("-");
  if (!IDENTITY_PATTERN.test(joined)) {
    throw new TypeError(`[joomla-import-plan] "${joined}" is not a valid id segment set`);
  }
  const id = assembleMigratedId(segments);
  if (id.length > MAX_SANITY_DOCUMENT_ID_LENGTH) {
    throw new TypeError(
      `[joomla-import-plan] "${id}" is ${id.length} characters, past Sanity's ${MAX_SANITY_DOCUMENT_ID_LENGTH}-character document id limit`,
    );
  }
  return id;
}

/** Pre-flight check so a too-long id becomes a reported blocker, not a thrown exception mid-plan. */
function wouldExceedDocumentIdLimit(...segments: readonly string[]): boolean {
  return assembleMigratedId(segments).length > MAX_SANITY_DOCUMENT_ID_LENGTH;
}

/**
 * Mints a fresh, opaque photograph identity — for a locator (and, when
 * available, a content hash) the persisted map has never seen.
 *
 * A public `mediaId` is minted once and immutable thereafter (ADR-0002 §1),
 * and ADR-0002 §1 says outright that it must *never* be derived from the
 * filename, a CDN URL, a provider asset id, or a content hash — the exact
 * mistake an earlier draft of this function made by hashing the source
 * locator (a private path that embeds the original filename) directly into
 * the returned id (found in Codex review round 9). A locator-derived id is
 * not "project-minted" in any meaningful sense: it is whatever the source
 * tree's naming happened to be at the moment this tool first saw the file,
 * exactly the environmental dependency the rule exists to keep out.
 *
 * A CSPRNG token (64 bits — the same "opaque, unguessable token" shape this
 * project already uses for a private-gallery object key) carries no such
 * dependency. The caller (`identityFor` in `convert-joomla-content.mts`)
 * still owns not calling this twice for the same photograph: it checks the
 * persisted locator and content-hash indexes first, and only calls this once
 * neither lookup found an existing identity. The result is then *recorded* in
 * the returned map — a later rename of the file survives through that
 * persisted mapping, never by recomputing the id from the (now different)
 * path.
 */
export function mintPhotographIdentity(): string {
  return `photo-${randomBytes(8).toString("hex")}`;
}

/**
 * One occurrence in one article's end gallery. Two of the same photograph are
 * two placements — but this id is deliberately **not** language-scoped: an
 * fi/en translation pair of the same article shares one photograph sequence,
 * and `sanity/schemas/article-end-gallery-placement.ts`'s own Studio validator
 * (`validatePlacementIdentity`) explicitly allows — requires — sibling
 * language versions to bind the same `placementId` to the same occurrence,
 * exactly the pattern `galleryPlacement` already established for a curated
 * gallery (ADR-0002 §1, `src/lib/sanity-enquiry-media.ts`'s own doc comment).
 * Baking `language` in here (an earlier draft did, found in Codex review
 * round 3) would give each translation its own identity for what is meant to
 * be one occurrence, breaking cross-language recognition and — because a
 * published placement id is immutable — unfixably so once written.
 */
export function endGalleryPlacementId(contentId: string, index: number): string {
  return `${contentId}-${String(index + 1).padStart(4, "0")}`;
}

function keyed<T extends Record<string, unknown>>(items: readonly T[], prefix: string): readonly (T & { _key: string })[] {
  return items.map((item, index) => ({ ...item, _key: `${prefix}-${String(index + 1).padStart(4, "0")}` }));
}

/**
 * Rewrites a converted block's `mediaId` strings into Sanity references, and
 * collects the photographs each one needs. The converter deliberately emits
 * plain identities so it stays independent of Sanity's reference shape.
 */
function resolveBlockMedia(
  block: SanityBlock,
  mediaDocumentIdOf: (mediaId: string) => string,
  used: Set<string>,
): SanityBlock {
  // A content block carries only a `media` reference — neither
  // `contentMediaBlockType` nor the mini-gallery's `images[].media` declares an
  // alt field (confirmed against sanity/schemas/content-block.ts). Alt text
  // lives solely on the shared media document, language-keyed (ADR-0008).
  if (block._type === "contentImageComparisonBlock") {
    const result: Record<string, unknown> = { ...block };
    for (const name of ["first", "second"] as const) {
      const mediaId = block[name];
      if (typeof mediaId === "string") {
        used.add(mediaId);
        result[name] = { _type: "reference", _ref: mediaDocumentIdOf(mediaId) };
      }
    }
    return result as SanityBlock;
  }
  if (typeof block.media === "string") {
    used.add(block.media);
    return { ...block, media: { _type: "reference", _ref: mediaDocumentIdOf(block.media) } };
  }
  if (Array.isArray(block.images)) {
    const images = (block.images as readonly { readonly media?: unknown }[]).map((image) => {
      if (typeof image.media !== "string") return image;
      used.add(image.media);
      return { ...image, media: { _type: "reference", _ref: mediaDocumentIdOf(image.media) } };
    });
    return { ...block, images: keyed(images as readonly Record<string, unknown>[], "image") };
  }
  if (Array.isArray(block.rows)) {
    return { ...block, rows: keyed(block.rows as readonly Record<string, unknown>[], "row") };
  }
  return block;
}

/**
 * SHA-256 over exactly what a write would publish — the documents (title, body, route,
 * dates, every other field) *and* the content hash each photograph is about to be
 * uploaded under — not just the source or resolved-conversion digests the manifest
 * already binds an approval to.
 *
 * Those two digests (`source_digest`, `resolved_digest`) bind an approval to what the
 * *conversion* produced at plan-build time; neither one is checked again once
 * `import-plan.json` is written to disk. A plan is a JSON file that can be hand-edited
 * or corrupted afterward with no trace — this digest is what a separate write run
 * (`write:joomla`, which has no access to the manifest, the source export, or the
 * resolution file, and so cannot re-derive either existing digest) can instead compare
 * against an owner-recorded value to confirm it is writing the *exact* plan that was
 * reviewed, mirroring the manifest's own "print a digest, the owner copies it forward,
 * a later step recomputes and compares" shape (found reviewing this plan's own write
 * half, Codex round 5, finding "Verify the write plan against the approved payload").
 *
 * `assetRequirements` is included too — a first version of this digest hashed only
 * `documents`, but the pixels a write actually publishes are authorized by
 * `assetRequirements[].contentHash`, not by anything `documents` itself carries (a
 * `media` document's own `image.asset` field is still a pending marker at digest time,
 * naming no bytes at all). Swapping a photograph's `sourceLocator` and `contentHash` to
 * point at a different, unreviewed local image would otherwise leave this digest
 * completely unchanged, and `write:joomla` would upload the substituted bytes under the
 * original, approved `mediaId` with the operator's own `--approved-digest` still
 * matching (found in Codex review round 6). Only `mediaId` and `contentHash` are
 * included, sorted by `mediaId` for order-independence — `sourceLocator` is a private
 * filesystem path that must never enter a digest an operator copies into a shell
 * command or a Board comment.
 *
 * `errors` and `blocked` are bound in too — the write step separately refuses to run
 * against a plan carrying either, but that check reads the *loaded* file's own
 * `errors`/`blocked` fields fresh, and this digest existed to prove the loaded file
 * matches what was reviewed. Without them here, an operator who reviewed and recorded
 * the digest of a plan that still had open errors or blocked articles — a routine step
 * before either is resolved, since `convert:joomla --plan` prints this digest
 * unconditionally — would see the same `--approved-digest` still validate after someone
 * quietly emptied those two arrays by hand, defeating exactly the protection this
 * mechanism exists to give (found in Codex review round 7).
 */
export function writablePlanDigest(
  documents: readonly PlannedDocument[],
  assetRequirements: readonly AssetRequirement[],
  errors: readonly string[],
  blocked: readonly { readonly sourceId: string; readonly language: string; readonly reasons: readonly string[] }[],
): string {
  const canonical = JSON.stringify({
    documents,
    assetRequirements: [...assetRequirements]
      .map((requirement) => ({ mediaId: requirement.mediaId, contentHash: requirement.contentHash }))
      .sort((left, right) => left.mediaId.localeCompare(right.mediaId)),
    errors: [...errors].sort(),
    blocked: [...blocked].sort((left, right) => `${left.sourceId}:${left.language}`.localeCompare(`${right.sourceId}:${right.language}`)),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Builds the plan. Never throws: a bad input becomes an error or a blocked
 * article in the result, so one run reports everything wrong at once rather
 * than stopping at the first problem — an operator told about one defect at a
 * time is how a migration takes twenty attempts.
 */
export function buildImportPlan(input: {
  readonly phase: string;
  readonly manifestDigest: string;
  readonly sourceExportDigest: string;
  readonly articles: readonly PlannedArticleInput[];
  /** Category identities that exist in the target public content tree. */
  readonly knownCategoryIds: readonly string[];
  /** Locator for each photograph identity the conversion referenced. */
  readonly sourceLocators: Readonly<Record<string, string>>;
  /** Identities carried over from earlier runs and phases. */
  readonly photographIdentities?: PhotographIdentityMap;
}): ImportPlan {
  const errors: string[] = [];
  const blocked: { sourceId: string; language: string; reasons: readonly string[] }[] = [];
  const acceptedArticles: PlannedArticleInput[] = [];
  const documents: PlannedDocument[] = [];
  const knownCategories = new Set(input.knownCategoryIds);
  const identities: Record<string, string> = { ...(input.photographIdentities ?? {}) };
  const usedPhotographs = new Set<string>();
  const requiredCategories = new Set<string>();

  const mediaDocumentIdOf = (mediaId: string): string => migratedId("media", mediaId);

  for (const article of input.articles) {
    const { approval, conversion } = article;

    const blockers = [
      ...assessApprovedConversion({
        approval,
        sourceDigest: article.sourceDigest,
        // Derived directly from `conversion`, never a separately-passed
        // field: computing it here rather than trusting a caller-supplied
        // value is what makes it impossible for this check to drift from
        // the conversion actually being planned.
        resolvedDigest: resolvedConversionDigest(conversion),
        findings: conversion.findings,
      }),
    ];

    if (approval.canonicalCategory !== null && !knownCategories.has(approval.canonicalCategory)) {
      blockers.push(`canonical category "${approval.canonicalCategory}" is not in the target content tree`);
    }
    for (const category of approval.secondaryCategories) {
      if (!knownCategories.has(category)) {
        blockers.push(`secondary category "${category}" is not in the target content tree`);
      }
    }
    if (article.title.trim().length === 0) blockers.push("the source article has no title");
    if (conversion.blocks.length === 0) blockers.push("the converted body holds no blocks");

    const endGalleryId =
      conversion.endGallery === undefined ? undefined : `${approval.contentId}-end`;
    if (endGalleryId !== undefined && endGalleryId.length > MAX_ARTICLE_END_GALLERY_ID_LENGTH) {
      blockers.push(
        `the derived end-gallery id "${endGalleryId}" is ${endGalleryId.length} characters, past the schema's ${MAX_ARTICLE_END_GALLERY_ID_LENGTH}-character limit — shorten contentId`,
      );
    }
    if (conversion.endGallery !== undefined) {
      const longestPlacementId = endGalleryPlacementId(
        approval.contentId,
        conversion.endGallery.mediaIds.length - 1,
      );
      if (longestPlacementId.length > MAX_PLACEMENT_ID_LENGTH) {
        blockers.push(
          `a derived end-gallery placement id would be ${longestPlacementId.length} characters, past the schema's ${MAX_PLACEMENT_ID_LENGTH}-character limit — shorten contentId`,
        );
      }
      if (wouldExceedDocumentIdLimit("end-gallery", longestPlacementId, approval.language)) {
        blockers.push(
          `the derived end-gallery placement document id would exceed Sanity's ${MAX_SANITY_DOCUMENT_ID_LENGTH}-character document id limit — shorten contentId`,
        );
      }
    }
    if (wouldExceedDocumentIdLimit("article", approval.contentId, approval.language)) {
      blockers.push(
        `the derived article document id would exceed Sanity's ${MAX_SANITY_DOCUMENT_ID_LENGTH}-character document id limit — shorten contentId`,
      );
    }

    if (blockers.length > 0) {
      blocked.push({ sourceId: approval.sourceId, language: approval.language, reasons: blockers });
      continue;
    }

    acceptedArticles.push(article);
    if (approval.canonicalCategory !== null) requiredCategories.add(approval.canonicalCategory);
    for (const category of approval.secondaryCategories) requiredCategories.add(category);

    for (const pollDocument of conversion.pollDocuments ?? []) {
      const existing = documents.find((d) => d._id === pollDocument._id);
      if (!existing) documents.push(pollDocument);
      else if (JSON.stringify(existing) !== JSON.stringify(pollDocument)) errors.push("Conflicting historical poll documents across articles");
    }
    const body = conversion.blocks.map((block) => resolveBlockMedia(block, mediaDocumentIdOf, usedPhotographs));
    const articleDocumentId = migratedId("article", approval.contentId, approval.language);

    documents.push({
      _id: articleDocumentId,
      _type: ARTICLE_TYPE_NAME,
      contentId: approval.contentId,
      language: approval.language,
      title: article.title.trim(),
      slug: approval.slug,
      ...(article.summary === undefined || article.summary.trim().length === 0
        ? {}
        : { summary: article.summary.trim() }),
      ...(article.author === undefined || article.author.trim().length === 0
        ? {}
        : { author: article.author.trim() }),
      ...(endGalleryId === undefined ? {} : { endGalleryId }),
      publishedAt: approval.publishedAt,
      ...(approval.eventDate === undefined ? {} : { eventDate: approval.eventDate }),
      ...(article.tags === undefined || article.tags.length === 0 ? {} : { tags: [...article.tags] }),
      ...(approval.canonicalAtStoryRoot
        ? { canonicalAtStoryRoot: true }
        : approval.canonicalCategory === null
          ? {}
          : {
              canonicalCategory: {
                _type: "reference",
                _ref: `${PENDING_CATEGORY_PREFIX}${approval.canonicalCategory}`,
              },
            }),
      ...(approval.secondaryCategories.length === 0
        ? {}
        : {
            secondaryCategories: keyed(
              approval.secondaryCategories.map((categoryId) => ({
                _type: "reference",
                _ref: `${PENDING_CATEGORY_PREFIX}${categoryId}`,
              })),
              "category",
            ),
          }),
      body: keyed(body as readonly Record<string, unknown>[], "block"),
    });

    if (conversion.endGallery !== undefined) {
      conversion.endGallery.mediaIds.forEach((mediaId, index) => {
        usedPhotographs.add(mediaId);
        const placementId = endGalleryPlacementId(approval.contentId, index);
        // `placementId` is deliberately shared across an fi/en translation
        // pair's matching occurrence (see `endGalleryPlacementId`'s own doc
        // comment), so the *document* id still needs the language to stay
        // unique — two real documents, one shared field value.
        documents.push({
          _id: migratedId("end-gallery", placementId, approval.language),
          _type: ARTICLE_END_GALLERY_PLACEMENT_TYPE_NAME,
          placementId,
          order: index,
          visible: true,
          article: { _type: "reference", _ref: articleDocumentId },
          media: { _type: "reference", _ref: mediaDocumentIdOf(mediaId) },
        });
      });
    }
  }

  // --- alt text, accumulated across every article that referenced a photograph ---
  // A shared identity may be used by more than one article, in more than one
  // language; each contributes its own localizedText entry (ADR-0008), and a
  // repeated (mediaId, language) pair with a differing value is a defect worth
  // surfacing rather than silently picking one.
  // Only from an *accepted* article: a blocked article's approval failed, so
  // its metadata — including alt text — must not partially reach a photograph
  // an accepted article also happens to use (found in Codex review round 3).
  const altTextByMediaId = new Map<string, Map<string, string>>();
  const altTextConflicts: string[] = [];
  for (const article of acceptedArticles) {
    for (const entry of article.conversion.resolvedImageAltText) {
      const byLanguage = altTextByMediaId.get(entry.mediaId) ?? new Map<string, string>();
      const existing = byLanguage.get(entry.language);
      if (existing !== undefined && existing !== entry.value) {
        altTextConflicts.push(
          `photograph "${entry.mediaId}" has two different ${entry.language} alt texts: "${existing}" vs "${entry.value}"`,
        );
      } else {
        byLanguage.set(entry.language, entry.value);
      }
      altTextByMediaId.set(entry.mediaId, byLanguage);
    }
  }
  errors.push(...altTextConflicts);

  // --- content hash, accumulated the same way alt text is (AB#137 write-half
  // planning, Codex plan-review round 1) ---------------------------------------
  // A shared identity's bytes must agree across every article that references
  // it — two different verified hashes for one mediaId is exactly the
  // "reprocessed photograph masquerading as the same identity" case
  // `convert-joomla-content.mts`'s own `identityFor` already refuses at
  // resolution time, so this should be unreachable in practice; it is still
  // checked here, independently, rather than trusted, the same posture every
  // other conflict class in this feature takes.
  const contentHashByMediaId = new Map<string, string>();
  const contentHashConflicts: string[] = [];
  for (const article of acceptedArticles) {
    for (const entry of article.conversion.resolvedImageContentHashes) {
      const existing = contentHashByMediaId.get(entry.mediaId);
      if (existing !== undefined && existing !== entry.contentHash) {
        contentHashConflicts.push(
          `photograph "${entry.mediaId}" resolved to two different content hashes: "${existing}" vs "${entry.contentHash}"`,
        );
      } else {
        contentHashByMediaId.set(entry.mediaId, entry.contentHash);
      }
    }
  }
  errors.push(...contentHashConflicts);

  // --- photograph documents, one per identity actually used ------------------
  const assetRequirements: AssetRequirement[] = [];
  for (const mediaId of [...usedPhotographs].sort()) {
    const locator = input.sourceLocators[mediaId];
    if (locator === undefined) {
      errors.push(`photograph "${mediaId}" is referenced but has no source locator.`);
      continue;
    }
    const contentHash = contentHashByMediaId.get(mediaId);
    if (contentHash === undefined) {
      // The write step re-verifies a photograph's bytes against this hash
      // immediately before uploading (see `AssetRequirement.contentHash`'s own
      // doc comment) — a photograph with none to record here must not silently
      // skip that check downstream.
      errors.push(`photograph "${mediaId}" has no recorded content hash, though it is referenced.`);
      continue;
    }
    const altEntries = [...(altTextByMediaId.get(mediaId) ?? new Map<string, string>())]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([language, value], index) => ({
        _key: `alt-${String(index + 1).padStart(2, "0")}`,
        _type: "localizedText",
        language,
        value,
      }));
    if (altEntries.length === 0) {
      // `media.alt` is `rule.required().min(1)` in the Studio schema — a
      // photograph the converter used but never resolved alt text for (should
      // not happen given the refusal in visitImage/visitGalleryMarker, but a
      // defect here must not silently publish an undescribed image).
      errors.push(`photograph "${mediaId}" has no alt text to publish, though it is referenced.`);
      continue;
    }
    identities[locator] = mediaId;
    assetRequirements.push({ mediaId, sourceLocator: locator, contentHash });
    documents.push({
      _id: mediaDocumentIdOf(mediaId),
      _type: MEDIA_TYPE_NAME,
      mediaId,
      mediaType: "image",
      alt: altEntries,
      publiclyRenderable: true,
      // Resolved by the write step from the real derivative's bytes. A guessed
      // asset reference would publish a broken image; a guessed dimension would
      // break the no-crop contract, which needs the photograph's true shape.
      image: { _type: "image", asset: { _type: "reference", _ref: `${PENDING_ASSET_PREFIX}${mediaId}` } },
    });
  }

  // --- migration-specific validation ---------------------------------------
  errors.push(...validateMigrationDocuments(documents));

  const notWritableBecause: string[] = [];
  if (assetRequirements.length > 0) {
    notWritableBecause.push(
      `${assetRequirements.length} photograph derivative(s) are not uploaded, so their asset references are unresolved`,
    );
  }
  if (requiredCategories.size > 0) {
    notWritableBecause.push(
      `${requiredCategories.size} category reference(s) are unresolved against the target dataset's document ids`,
    );
  }
  if (errors.length > 0) notWritableBecause.push(`${errors.length} validation error(s)`);
  if (blocked.length > 0) notWritableBecause.push(`${blocked.length} source article(s) are blocked`);
  // This slice performs no write under any circumstance.
  notWritableBecause.push("this tool converts and reports only; the write step is a separate command");

  return {
    version: IMPORT_PLAN_VERSION,
    conversionPolicy: CONVERSION_POLICY_VERSION,
    phase: input.phase,
    manifestDigest: input.manifestDigest,
    sourceExportDigest: input.sourceExportDigest,
    documents,
    documentsDigest: writablePlanDigest(documents, assetRequirements, errors, blocked),
    assetRequirements,
    categoryRequirements: [...requiredCategories].sort().map((categoryId) => ({ categoryId })),
    photographIdentities: identities,
    blocked,
    errors,
    writable: false,
    notWritableBecause,
  };
}

/**
 * Invariants of a *migration* document set. Deliberately not
 * `validateSeedFixtures`: that one also asserts demo-fixture coverage, which
 * says nothing about launch content. The genuinely shared primitives come from
 * `sanity-document-checks.mts` instead.
 */
export function validateMigrationDocuments(documents: readonly PlannedDocument[]): readonly string[] {
  const violations: string[] = [...validateHistoricalPollDocuments(documents), ...validateCuratedGalleryDocuments(documents)];
  const byId = new Map(documents.map((document) => [document._id, document]));

  for (const duplicate of collectDuplicateIds(documents)) {
    violations.push(`${duplicate}: more than one document claims this id`);
  }

  const identities = new Set<string>();
  const mediaIds = new Set<string>();
  // A placementId may legitimately repeat across an fi/en translation pair's
  // matching occurrence — the same rule the Studio's own
  // `validatePlacementIdentity` enforces — so this tracks the occurrence it
  // was first bound to rather than treating any repeat as a plain duplicate.
  const placementOccurrences = new Map<
    string,
    { readonly contentId: string; readonly endGalleryId: string; readonly mediaRef: string }
  >();
  const routes = new Set<string>();
  const endGalleryIds = new Map<string, string>();

  for (const document of documents) {
    if ((!document._id.startsWith(MIGRATED_ID_PREFIX) && document._type !== "pollTally") || document._id.includes(".")) {
      violations.push(
        `${document._id}: id is not a public root-level id under the "${MIGRATED_ID_PREFIX}" namespace`,
      );
    }
    collectKeyViolations(document._id, document, violations);

    if (document._type === MEDIA_TYPE_NAME) {
      const mediaId = document.mediaId;
      if (typeof mediaId !== "string" || !IDENTITY_PATTERN.test(mediaId)) {
        violations.push(`${document._id}: mediaId "${String(mediaId)}" is not a valid identity`);
      } else if (mediaIds.has(mediaId)) {
        violations.push(`media ${mediaId}: duplicate mediaId`);
      } else {
        mediaIds.add(mediaId);
      }
      // Restates the Studio schema's own required fields (sanity/schemas/media.ts):
      // `mediaType` is `rule.required()`, `alt` is `rule.required().min(1)` of
      // language-keyed entries. A media document missing either would publish an
      // undescribed or mistyped photograph.
      if (document.mediaType !== "image" && document.mediaType !== "video") {
        violations.push(`media ${String(mediaId)}: mediaType must be "image" or "video"`);
      }
      const alt = document.alt;
      if (!Array.isArray(alt) || alt.length === 0) {
        violations.push(`media ${String(mediaId)}: alt is required and must hold at least one language entry`);
      } else {
        const altLanguages = new Set<string>();
        for (const entry of alt as readonly Record<string, unknown>[]) {
          const language = entry.language;
          const value = entry.value;
          if (typeof language !== "string" || typeof value !== "string" || value.trim().length === 0) {
            violations.push(`media ${String(mediaId)}: an alt entry is missing a language or a non-empty value`);
          } else if (altLanguages.has(language)) {
            violations.push(`media ${String(mediaId)}: duplicate alt entry for language "${language}"`);
          } else {
            altLanguages.add(language);
          }
        }
      }
      const caption = document.caption;
      if (caption !== undefined) {
        if (!Array.isArray(caption)) {
          violations.push(`media ${String(mediaId)}: caption must be a localized text array when present`);
        } else {
          const captionLanguages = new Set<string>();
          for (const entry of caption as readonly Record<string, unknown>[]) {
            const language = entry.language;
            const value = entry.value;
            if (typeof language !== "string" || typeof value !== "string" || value.trim().length === 0) {
              violations.push(`media ${String(mediaId)}: a caption entry is missing a language or a non-empty value`);
            } else if (captionLanguages.has(language)) {
              violations.push(`media ${String(mediaId)}: duplicate caption entry for language "${language}"`);
            } else {
              captionLanguages.add(language);
            }
          }
        }
      }
      if (document.credit !== undefined && (typeof document.credit !== "string" || document.credit.trim().length === 0)) {
        violations.push(`media ${String(mediaId)}: credit must be a non-empty string when present`);
      }
    }

    if (document._type === ARTICLE_TYPE_NAME || document._type === "gallery") {
      const contentId = document.contentId;
      const language = document.language;
      const key = `${String(contentId)}:${String(language)}`;
      if (identities.has(key)) {
        violations.push(`article ${key}: two documents share one contentId and language`);
      }
      identities.add(key);

      if (!isRealCalendarDateTime(document.publishedAt)) {
        violations.push(`article ${key}: publishedAt "${String(document.publishedAt)}" is not a real ISO instant`);
      }
      if (document.eventDate !== undefined && !isRealCalendarDateTime(document.eventDate)) {
        violations.push(`article ${key}: eventDate "${String(document.eventDate)}" is not a real ISO instant`);
      }
      if (document._type === ARTICLE_TYPE_NAME && (!Array.isArray(document.body) || document.body.length === 0)) {
        violations.push(`article ${key}: body is required and must hold at least one block`);
      }
      // `article.slug` is a plain string field (sanity/schemas/article.ts), read
      // with `readString` — not a Sanity `slug` object. Found in Codex review
      // round 1: the plan originally emitted the wrong shape here.
      const slug = document.slug;
      const canonical = referencedId(document.canonicalCategory);
      const canonicalAtStoryRoot = document.canonicalAtStoryRoot === true;
      if (typeof slug !== "string" || !IDENTITY_PATTERN.test(slug)) {
        violations.push(`article ${key}: slug "${String(slug)}" is not a valid slug`);
      }
      if (canonicalAtStoryRoot === (canonical !== undefined)) {
        violations.push(`article ${key}: exactly one canonical story-root or category placement is required`);
      } else {
        const route = `${String(language)}:${canonicalAtStoryRoot ? "@story-root" : canonical}:${String(slug)}`;
        if (routes.has(route)) violations.push(`article ${key}: two articles claim the route ${route}`);
        routes.add(route);
      }
      if (typeof document.endGalleryId === "string") {
        const owner = endGalleryIds.get(document.endGalleryId);
        if (owner !== undefined && owner !== String(contentId)) {
          violations.push(
            `article ${key}: end-gallery id "${document.endGalleryId}" is also claimed by content "${owner}"`,
          );
        }
        endGalleryIds.set(document.endGalleryId, String(contentId));
      }

      // Every body media reference resolves to a media document in this set.
      for (const block of Array.isArray(document.body) ? document.body : []) {
        for (const reference of collectBlockMediaReferences(block)) {
          const medium = byId.get(reference);
          if ((block as SanityBlock)._type === "contentImageComparisonBlock" && (medium?.mediaType !== "image" || medium.publiclyRenderable !== true)) violations.push(`article ${key}: a comparison side must resolve to a public image`);
          if (medium?._type !== MEDIA_TYPE_NAME) {
            violations.push(`article ${key}: a body block references "${reference}", which is not a media document`);
          }
        }
      }
    }

    if (document._type === ARTICLE_END_GALLERY_PLACEMENT_TYPE_NAME) {
      const placementId = document.placementId;
      const order = document.order;
      if (typeof order !== "number" || !Number.isInteger(order) || order < 0) {
        violations.push(`placement ${String(placementId)}: order must be a non-negative integer`);
      }
      const articleRef = referencedId(document.article);
      const articleDocument = articleRef === undefined ? undefined : byId.get(articleRef);
      const articleContentId = typeof articleDocument?.contentId === "string" ? articleDocument.contentId : undefined;
      if (articleDocument?._type !== ARTICLE_TYPE_NAME) {
        violations.push(`placement ${String(placementId)}: "article" does not resolve to an article document`);
      } else if (typeof articleDocument.endGalleryId !== "string") {
        violations.push(
          `placement ${String(placementId)}: its article declares no endGalleryId, so the placement would never render`,
        );
      }
      const mediaRef = referencedId(document.media);
      if (mediaRef === undefined || byId.get(mediaRef)?._type !== MEDIA_TYPE_NAME) {
        violations.push(`placement ${String(placementId)}: "media" does not resolve to a media document`);
      }

      if (typeof placementId !== "string" || placementId.length === 0) {
        violations.push(`${document._id}: placementId is required`);
      } else if (
        articleContentId !== undefined &&
        typeof articleDocument?.endGalleryId === "string" &&
        mediaRef !== undefined
      ) {
        const occurrence = {
          contentId: articleContentId,
          endGalleryId: articleDocument.endGalleryId,
          mediaRef,
        };
        const existing = placementOccurrences.get(placementId);
        if (existing === undefined) {
          placementOccurrences.set(placementId, occurrence);
        } else if (
          existing.contentId !== occurrence.contentId ||
          existing.endGalleryId !== occurrence.endGalleryId ||
          existing.mediaRef !== occurrence.mediaRef
        ) {
          violations.push(
            `placement ${placementId}: bound to two different occurrences (contentId/endGalleryId/media must match across a translation pair)`,
          );
        }
        // Equal occurrence: this is the legitimate cross-language sharing case
        // — no violation.
      }
    }
  }

  // Every article declaring an end gallery has at least one placement, and the
  // orders within one article are a dense 0-based sequence.
  const placementsByArticle = new Map<string, number[]>();
  for (const document of documents) {
    if (document._type !== ARTICLE_END_GALLERY_PLACEMENT_TYPE_NAME) continue;
    const articleRef = referencedId(document.article);
    if (articleRef === undefined) continue;
    const orders = placementsByArticle.get(articleRef) ?? [];
    if (typeof document.order === "number") orders.push(document.order);
    placementsByArticle.set(articleRef, orders);
  }
  for (const document of documents) {
    if (document._type !== ARTICLE_TYPE_NAME || typeof document.endGalleryId !== "string") continue;
    const orders = (placementsByArticle.get(document._id) ?? []).slice().sort((left, right) => left - right);
    if (orders.length === 0) {
      violations.push(`article ${document._id}: declares an end gallery but has no placements`);
      continue;
    }
    const dense = orders.every((order, index) => order === index);
    if (!dense) {
      violations.push(`article ${document._id}: end-gallery orders are not a dense 0-based sequence`);
    }
  }

  return violations;
}

function collectBlockMediaReferences(block: unknown): readonly string[] {
  if (typeof block !== "object" || block === null) return [];
  const record = block as { readonly _type?: unknown; readonly media?: unknown; readonly images?: unknown; readonly first?: unknown; readonly second?: unknown };
  const references: string[] = [];
  if (record._type === "contentImageComparisonBlock") {
    for (const side of [record.first, record.second]) {
      const ref = referencedId(side);
      if (ref !== undefined) references.push(ref);
    }
  }
  const direct = referencedId(record.media);
  if (direct !== undefined) references.push(direct);
  if (Array.isArray(record.images)) {
    for (const image of record.images) {
      const reference = referencedId((image as { readonly media?: unknown })?.media);
      if (reference !== undefined) references.push(reference);
    }
  }
  return references;
}
