#!/usr/bin/env node
/**
 * AB#84's owner-run seed script: writes this repository's sample fixture
 * content into a Sanity dataset, and (with `--yes`) verifies the write
 * against the real Content Lake afterward. See `docs/sanity-seeding.md` for
 * the full runbook — this file is deliberately thin orchestration; the logic
 * worth testing lives in `sanity-seed-fixtures.mts` (pure) and
 * `sanity-seed-http.mts` (IO), both covered by their own Vitest suites.
 *
 *   npm run seed:sanity -- --project <id> --dataset <name> --api-version vYYYY-MM-DD
 *
 * Dry run is the default: builds and validates the fixture set, prints a
 * summary, and lists the six demo photograph files found in public/gallery/
 * (a local directory listing only — their bytes are never read and no
 * network request is made). Add --yes to actually write, which additionally
 * requires SANITY_SEED_TOKEN
 * — a write-scoped credential, never the runtime app's SANITY_READ_TOKEN.
 * Add --prune-stale (with --yes) to delete any existing seed-owned document
 * that this run's fixture set no longer includes; without it, such documents
 * are only reported. Add --delete-all (with --yes) to delete every seed-owned
 * document unconditionally, with no fixture build or write at all — the
 * real go-live cleanup command; see docs/sanity-seeding.md.
 */

import { readdir, readFile } from "node:fs/promises";

import {
  ARCHIVE_GALLERY_CONTENT_ID,
  ARCHIVE_GALLERY_PLACEMENT_COUNT,
  ARTICLE_FIXTURES,
  ARTICLE_TYPE_NAME,
  buildSeedFixtures,
  CATEGORY_FIXTURES,
  CATEGORY_TYPE_NAME,
  collectSeedIdentities,
  FEATURED_GALLERY_CONTENT_ID,
  GALLERY_LANGUAGE,
  GALLERY_PLACEMENT_TYPE_NAME,
  GALLERY_TYPE_NAME,
  HOME_PAGE_ID,
  HOME_PAGE_TYPE_NAME,
  isSeedDocumentId,
  MAX_PUBLIC_DELIVERY_DIMENSION,
  MEDIA_FIXTURES,
  MEDIA_TYPE_NAME,
  orderSeedDocumentsForDeletion,
  PUBLIC_DELIVERY_FORMATS,
  publishedIdOf,
  seedId,
  type SeedDocument,
  SERVICE_FIXTURES,
  SERVICE_TYPE_NAME,
  SITE_SETTINGS_ID,
  SITE_SETTINGS_TYPE_NAME,
  validateSeedFixtures,
} from "./sanity-seed-fixtures.mts";
import {
  chunk,
  parseSeedConnection,
  runSeedMutationBatches,
  runSeedQuery,
  SanitySeedConfigurationError,
  uploadSeedImageAsset,
  type SeedConnection,
} from "./sanity-seed-http.mts";

/**
 * A self-chosen, conservative chunk size for verifying the archive gallery's
 * 400 placementIds without exceeding Sanity's 11 KB GET limit in one
 * request — measured directly: all 400 alone URL-encode to ~9.8 KB, so 100
 * per request (≈2.5 KB) leaves generous headroom for the rest of the query
 * and its other params.
 */
const PLACEMENT_VERIFICATION_CHUNK_SIZE = 100;

const EXPECTED_CATEGORY_COUNT = CATEGORY_FIXTURES.length;
const EXPECTED_SERVICE_COUNT = SERVICE_FIXTURES.length;
const EXPECTED_ARTICLE_DOCUMENT_COUNT = ARTICLE_FIXTURES.reduce(
  (total, fixture) => total + fixture.languages.length,
  0,
);

const GALLERY_DIRECTORY = new URL("../public/gallery/", import.meta.url);

function fail(message: string): never {
  console.error(`Sanity seeding failed: ${message}`);
  process.exit(1);
}

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    fail(`--${name} requires a value`);
  }
  return value;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function requiredSetting(flagName: string, envName: string): string {
  const value = readFlag(flagName) ?? process.env[envName];
  if (!value) {
    fail(`missing ${envName} (or --${flagName})`);
  }
  return value;
}

/**
 * Environment-only — no CLI flag. A process's argument list is visible to
 * every other process on the same machine (`ps`) and is commonly persisted
 * to shell history; a write-scoped credential must never pass through it.
 * Used only for `SANITY_SEED_TOKEN`.
 */
function requiredEnvSetting(envName: string): string {
  const value = process.env[envName];
  if (!value) fail(`missing ${envName}`);
  return value;
}

// ---------------------------------------------------------------------------
// Locating the six demo image files
// ---------------------------------------------------------------------------

async function resolveAssetFilePaths(): Promise<ReadonlyMap<string, URL>> {
  const entries = await readdir(GALLERY_DIRECTORY);
  const byKey = new Map<string, URL>();
  for (const key of MEDIA_FIXTURES.map((item) => item.assetKey)) {
    const matches = entries.filter((name) => name.startsWith(`${key}.`) && name.endsWith(".webp"));
    if (matches.length === 0) {
      fail(`no file in public/gallery/ matches the demo photograph "${key}"`);
    }
    if (matches.length > 1) {
      fail(`more than one file in public/gallery/ matches "${key}": ${matches.join(", ")}`);
    }
    byKey.set(key, new URL(matches[0], GALLERY_DIRECTORY));
  }
  return byKey;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function summarize(documents: ReturnType<typeof buildSeedFixtures>["documents"]): void {
  const counts = new Map<string, number>();
  for (const doc of documents) {
    counts.set(doc._type, (counts.get(doc._type) ?? 0) + 1);
  }
  console.log(`Fixture set: ${documents.length} documents`);
  for (const [type, count] of [...counts].sort(([left], [right]) => left.localeCompare(right))) {
    console.log(`  ${type}: ${count}`);
  }
}

// ---------------------------------------------------------------------------
// Preflight: refuse to add a second document when an existing different id
// already claims one of this fixture's own public identities. This includes
// the legacy private `seed.…` ids: clean them with `--delete-all` before
// writing the public root-level fixture.
//
// The mutate API is `createOrReplace` against this script's own `seed--`
// ids — it does not, and cannot, know that a *different*-id document already
// claims the same `mediaId`/`categoryId`/`contentId`/service `slug` (or is
// the dataset's other siteSettings/homePage singleton). Every one of those
// fields is exactly the kind of site-wide public identity this codebase's
// own read adapters refuse to guess between when two documents claim one
// (see e.g. `sanity-media.ts`'s duplicate-mediaId handling) — and this
// fixture's own identity values ("landscapes", "featured",
// "coastal-landscape", "portrait-sessions", …) are ordinary, plausible names
// a dataset that already has some real content could easily already be
// using. So every one of those fields is checked against the target
// dataset, for every seeded type, before any asset is uploaded or any
// document is written — not just the two singletons a first draft of this
// check covered.
//
// `placementId` is checked too, but separately from the four fields above
// and after them: this fixture's 426 values would alone URL-encode past
// `MAX_SEED_QUERY_URL_BYTES` in one GET query (~10.4 KB measured directly),
// so it is checked via the same chunked-query technique the archive-gallery
// placement count verification uses (see that check's own comment) rather
// than folded into the one combined query below.
//
// Queried with `perspective: "raw"`, unlike every other read this script
// does: an *unpublished draft* can already claim one of these identities,
// and a published-only check would miss it — the collision only becomes
// visible once someone later publishes that draft, by which point this
// script has already written its own document. `publishedIdOf` normalizes
// a raw result's `_id` before comparing, since a draft's raw `_id` carries a
// `drafts.` prefix its published counterpart does not.
// ---------------------------------------------------------------------------

type IdentityCollisionRow = { readonly _id: string; readonly _type: string };

async function preflightIdentityCollisions(
  connection: SeedConnection,
  documents: readonly SeedDocument[],
): Promise<void> {
  const {
    mediaIds,
    categoryIds,
    serviceSlugs,
    contentIds,
    placementIds,
    expectedIdByIdentity,
    expectedVariantByContentId,
  } = collectSeedIdentities(documents);

  const result = (await runSeedQuery(connection, {
    query: `{
      "singletons": *[_type in [$settingsType, $homeType]]{_id, _type},
      "media": *[_type == $mediaType && mediaId in $mediaIds]{_id, "identity": mediaId, "kind": "media"},
      "categories": *[_type == $categoryType && categoryId in $categoryIds]{_id, "identity": categoryId, "kind": "category"},
      "services": *[_type == $serviceType && slug in $serviceSlugs]{_id, "identity": slug, "kind": "service"},
      "content": *[_type in [$articleType, $galleryType] && contentId in $contentIds]{_id, _type, contentId, language, "identity": contentId + ":" + language, "kind": "content"}
    }`,
    params: {
      settingsType: SITE_SETTINGS_TYPE_NAME,
      homeType: HOME_PAGE_TYPE_NAME,
      mediaType: "media",
      mediaIds,
      categoryType: CATEGORY_TYPE_NAME,
      categoryIds,
      serviceType: SERVICE_TYPE_NAME,
      serviceSlugs,
      articleType: ARTICLE_TYPE_NAME,
      galleryType: "gallery",
      contentIds,
    },
    perspective: "raw",
  })) as {
    readonly singletons: readonly IdentityCollisionRow[];
    readonly media: readonly { readonly _id: string; readonly identity: string; readonly kind: string }[];
    readonly categories: readonly { readonly _id: string; readonly identity: string; readonly kind: string }[];
    readonly services: readonly { readonly _id: string; readonly identity: string; readonly kind: string }[];
    readonly content: readonly {
      readonly _id: string;
      readonly _type: string;
      readonly contentId: string;
      readonly identity: string;
      readonly kind: string;
    }[];
  };

  const collisions: string[] = [];

  for (const doc of result.singletons) {
    const expectedId = doc._type === SITE_SETTINGS_TYPE_NAME ? SITE_SETTINGS_ID : HOME_PAGE_ID;
    if (publishedIdOf(doc._id) !== expectedId) {
      collisions.push(
        `a ${doc._type} document already exists at "${doc._id}" — this fixture's own ${expectedId} would be a second published ${doc._type} document`,
      );
    }
  }

  for (const row of [...result.media, ...result.categories, ...result.services, ...result.content]) {
    const expectedId = expectedIdByIdentity.get(`${row.kind}:${row.identity}`);
    if (expectedId !== undefined && publishedIdOf(row._id) !== expectedId) {
      collisions.push(`a ${row.kind} document already exists at "${row._id}" claiming identity "${row.identity}"`);
    }
  }

  // A contentId claimed under a *different* language than this fixture uses
  // it for is not caught by the exact (contentId, language) check above —
  // but if it names a different variant than this fixture's own, that is
  // still the real Studio invariant this preflight exists to enforce.
  for (const row of result.content) {
    const expectedVariant = expectedVariantByContentId.get(row.contentId);
    if (expectedVariant !== undefined && row._type !== expectedVariant) {
      collisions.push(
        `contentId "${row.contentId}" is already used by a ${row._type} document at "${row._id}" — this fixture writes it as a ${expectedVariant}, and a contentId names one variant site-wide across every language`,
      );
    }
  }

  // placementId, chunked and queried separately (see the module comment
  // above): each chunk asks only "which of exactly these N ids already
  // exist, and under what _id", so a document this fixture doesn't itself
  // own can never be missed just because it happened to fall in a
  // different chunk than something else.
  for (const idsChunk of chunk(placementIds, PLACEMENT_VERIFICATION_CHUNK_SIZE)) {
    const rows = (await runSeedQuery(
      connection,
      {
        query: `*[_type == $type && placementId in $ids]{_id, "identity": placementId, "kind": "placement"}`,
        params: { type: GALLERY_PLACEMENT_TYPE_NAME, ids: idsChunk },
        perspective: "raw",
      },
    )) as readonly { readonly _id: string; readonly identity: string; readonly kind: string }[];
    for (const row of rows) {
      const expectedId = expectedIdByIdentity.get(`${row.kind}:${row.identity}`);
      if (expectedId !== undefined && publishedIdOf(row._id) !== expectedId) {
        collisions.push(`a ${row.kind} document already exists at "${row._id}" claiming identity "${row.identity}"`);
      }
    }
  }

  if (collisions.length > 0) {
    fail(
      `${collisions.length} identity collision(s) with differently identified content — writing would create two documents claiming one public identity, which the site's own read adapters refuse to serve. If these are legacy "seed.…" ids, run --delete-all first:\n  ${collisions.join("\n  ")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Post-write live verification — the actual, live proof of "representative
// content queries pass". Hand-written GROQ existence/shape checks, not a
// call into src/lib's adapters (which carry the `server-only` marker and
// cannot be imported from a plain `node` process — see sanity-seed-http.mts's
// module comment).
// ---------------------------------------------------------------------------

type VerificationCheck = { readonly name: string; readonly run: () => Promise<void> };

/**
 * `count(...)` always answers a number, but nothing about `runSeedQuery`'s
 * `unknown` return guarantees Sanity actually did — the same reasoning
 * `sanity-client.ts` applies to its own envelope check. Every count-based
 * verification check reads its result through this rather than casting
 * straight to `number`, so a malformed response fails with a clear message
 * here instead of a confusing `NaN`/`TypeError` from a bare comparison.
 */
function readCount(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${context}: expected a numeric count, got ${JSON.stringify(value)}`);
  }
  return value;
}

async function runCountQuery(
  connection: SeedConnection,
  query: string,
  params: Readonly<Record<string, unknown>>,
  context: string,
): Promise<number> {
  return readCount(await runSeedQuery(connection, { query, params }), context);
}

/**
 * Verification's exact-count checks are scoped to *this run's own manifest*
 * (`_id in $ids`, or — for the 400-item archive gallery, where an id list
 * would repeat the placementId preflight's URL-size problem — `order <
 * $count`) rather than "every seed-owned document of this type". A stale
 * document from a shrunk fixture revision is deliberately left in place when
 * `--prune-stale` isn't passed (see `reportAndPruneStale`); it must not also
 * make an otherwise-successful write report a spurious verification failure.
 */
function buildVerificationChecks(
  connection: SeedConnection,
  documents: readonly SeedDocument[],
): readonly VerificationCheck[] {
  const archiveGalleryRef = seedId("gallery", ARCHIVE_GALLERY_CONTENT_ID, GALLERY_LANGUAGE);
  const featuredGalleryRef = seedId("gallery", FEATURED_GALLERY_CONTENT_ID, GALLERY_LANGUAGE);
  const countByIdsQuery = `count(*[_type == $type && _id in $ids])`;
  const idsOfType = (type: string) => documents.filter((doc) => doc._type === type).map((doc) => doc._id);

  return [
    {
      name: "site settings singleton is readable",
      run: async () => {
        const result = (await runSeedQuery(connection, {
          query: `*[_id == $id][0]{siteName, featuredGalleryId}`,
          params: { id: SITE_SETTINGS_ID },
        })) as { readonly siteName?: unknown } | null;
        if (typeof result?.siteName !== "string") {
          throw new Error("site settings document did not read back with a siteName");
        }
      },
    },
    {
      name: "home page singleton is readable",
      run: async () => {
        const result = (await runSeedQuery(connection, {
          query: `*[_id == $id][0]{heroMedia}`,
          params: { id: HOME_PAGE_ID },
        })) as { readonly heroMedia?: unknown } | null;
        if (result?.heroMedia === undefined) {
          throw new Error("home page document did not read back with heroMedia");
        }
      },
    },
    {
      name: "category tree has the expected document count",
      run: async () => {
        const ids = idsOfType(CATEGORY_TYPE_NAME);
        const count = await runCountQuery(connection, countByIdsQuery, { type: CATEGORY_TYPE_NAME, ids }, "category count");
        if (count !== EXPECTED_CATEGORY_COUNT) {
          throw new Error(`expected ${EXPECTED_CATEGORY_COUNT} seeded categories, found ${count}`);
        }
      },
    },
    {
      name: "services read back with the expected count",
      run: async () => {
        const ids = idsOfType(SERVICE_TYPE_NAME);
        const count = await runCountQuery(connection, countByIdsQuery, { type: SERVICE_TYPE_NAME, ids }, "service count");
        if (count !== EXPECTED_SERVICE_COUNT) {
          throw new Error(`expected ${EXPECTED_SERVICE_COUNT} seeded services, found ${count}`);
        }
      },
    },
    {
      name: "articles read back with the expected count",
      run: async () => {
        const ids = idsOfType(ARTICLE_TYPE_NAME);
        const count = await runCountQuery(connection, countByIdsQuery, { type: ARTICLE_TYPE_NAME, ids }, "article count");
        if (count !== EXPECTED_ARTICLE_DOCUMENT_COUNT) {
          throw new Error(
            `expected ${EXPECTED_ARTICLE_DOCUMENT_COUNT} seeded article documents (one per language version), found ${count}`,
          );
        }
      },
    },
    {
      name: `the archive gallery's placement window has ${ARCHIVE_GALLERY_PLACEMENT_COUNT} rows`,
      run: async () => {
        // Scoped to this run's own 400 placementIds, not an order-based
        // proxy: an earlier draft of this check used `order < $count`,
        // assuming a stale leftover placement could only ever have a
        // *higher* order than the current count — an assumption a review
        // round of this same story found false in general (placement
        // generation logic itself could change, not just the count),
        // which would misclassify a genuinely stale placement as current
        // and report a false failure on an otherwise-successful run.
        //
        // The 400 placementIds can't go in one `in $ids` query — that was
        // already measured to exceed the 11 KB GET budget by itself, so this
        // chunks them via the same `chunk` helper the placement-identity
        // preflight and `runSeedMutationBatches` use, and sums a `count(...
        // && placementId in $ids)` per chunk. Each chunk asks only "are
        // exactly these N of mine here", so a stale extra document (with
        // *any* order or placementId this fixture doesn't itself claim)
        // can never inflate any chunk's count — verifying the whole 400
        // this way is airtight against stale leftovers, in either
        // direction, without ever building an oversized request.
        const expectedPlacementIds = documents
          .filter(
            (doc) =>
              doc._type === GALLERY_PLACEMENT_TYPE_NAME &&
              (doc.gallery as { readonly _ref?: string } | undefined)?._ref === archiveGalleryRef,
          )
          .map((doc) => doc.placementId as string);

        let found = 0;
        for (const idsChunk of chunk(expectedPlacementIds, PLACEMENT_VERIFICATION_CHUNK_SIZE)) {
          found += await runCountQuery(
            connection,
            `count(*[_type == $type && gallery._ref == $galleryRef && placementId in $ids])`,
            { type: GALLERY_PLACEMENT_TYPE_NAME, galleryRef: archiveGalleryRef, ids: idsChunk },
            "archive gallery placement count",
          );
        }
        if (found !== expectedPlacementIds.length) {
          throw new Error(`expected ${expectedPlacementIds.length} archive gallery placements, found ${found}`);
        }
      },
    },
    {
      name: "the featured gallery declares its two sections",
      run: async () => {
        const sections = (await runSeedQuery(connection, {
          query: `*[_id == $id][0].sections[].sectionId`,
          params: { id: featuredGalleryRef },
        })) as readonly string[] | null;
        const found = new Set(sections ?? []);
        if (!found.has("high-tide") || !found.has("low-tide")) {
          throw new Error(`expected sections "high-tide" and "low-tide", found ${[...found].join(", ")}`);
        }
      },
    },
    {
      name: "at least one media document has a placement in both galleries",
      run: async () => {
        const result = (await runSeedQuery(connection, {
          query: `*[_type == $type && gallery._ref in [$archiveRef, $featuredRef]]{"galleryRef": gallery._ref, "mediaRef": media._ref}`,
          params: {
            type: GALLERY_PLACEMENT_TYPE_NAME,
            archiveRef: archiveGalleryRef,
            featuredRef: featuredGalleryRef,
          },
        })) as readonly { readonly galleryRef: string; readonly mediaRef: string }[];
        const inArchive = new Set(
          result.filter((row) => row.galleryRef === archiveGalleryRef).map((row) => row.mediaRef),
        );
        const inFeatured = new Set(
          result.filter((row) => row.galleryRef === featuredGalleryRef).map((row) => row.mediaRef),
        );
        const shared = [...inArchive].some((mediaRef) => inFeatured.has(mediaRef));
        if (!shared) throw new Error("no media document has a placement in both galleries");
      },
    },
  ];
}

async function runLiveVerification(connection: SeedConnection, documents: readonly SeedDocument[]): Promise<void> {
  console.log("\nVerifying against the live dataset:");
  let failures = 0;
  for (const check of buildVerificationChecks(connection, documents)) {
    try {
      await check.run();
      console.log(`  PASS  ${check.name}`);
    } catch (cause) {
      failures += 1;
      console.log(`  FAIL  ${check.name} — ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  if (failures > 0) {
    fail(`${failures} live verification check(s) failed. The write already completed — see docs/sanity-seeding.md.`);
  }
  console.log("All live verification checks passed.");
}

// ---------------------------------------------------------------------------
// Stale document reporting / pruning, and full deletion (--delete-all)
// ---------------------------------------------------------------------------

/** Every `_type` this fixture set ever writes — the scope for finding every seeded document, at any perspective. */
const SEEDED_TYPES = [
  SITE_SETTINGS_TYPE_NAME,
  HOME_PAGE_TYPE_NAME,
  MEDIA_TYPE_NAME,
  CATEGORY_TYPE_NAME,
  SERVICE_TYPE_NAME,
  ARTICLE_TYPE_NAME,
  GALLERY_TYPE_NAME,
  GALLERY_PLACEMENT_TYPE_NAME,
];

/**
 * Every document under the current `seed--` identity (or the legacy `seed.`
 * identity), at **any** perspective — a
 * seeded document a Studio editor has since opened as a draft, or copied
 * into a content release, is still found and still deleted. Querying only
 * the published perspective (this script's default everywhere else) would
 * miss that draft/version entirely. This asks for every document of a seeded
 * `_type`, `perspective: "raw"`, and recognizes the normalized seed identity
 * in JS rather than assuming the raw id has no `drafts.` or
 * `versions.<release>.` prefix. A draft
 * left behind would otherwise both survive `--delete-all`'s cleanup and, if
 * it holds a strong reference to a seeded document also being deleted,
 * could make that deletion fail outright.
 *
 * **Known scale limitation**, disclosed rather than solved here: this
 * fetches every document of a seeded `_type` — not filtered to the seed prefix on
 * Sanity's side at all, only afterward, in JS — because `path()` cannot
 * express "starts with the root-level seed prefix, allowing an optional `drafts.`/`versions.
 * <anything>.` prefix" without a filter shape this project has not verified
 * against Sanity's actual documented `path()` glob semantics for a
 * *variable* middle segment (the release id). On a dataset that has grown
 * large real content of these same types by the time cleanup runs, that is
 * a bigger read than the couple-hundred documents this fixture itself
 * seeds. `docs/sanity-seeding.md` says as much and recommends running
 * cleanup before real content grows, which is also the documented,
 * intended order of operations already.
 */
type SeedDocumentReference = { readonly _ref?: unknown };
type FoundSeedDocument = {
  readonly _id: string;
  readonly _type: string;
  readonly parent?: SeedDocumentReference;
};

async function findAllSeededDocuments(connection: SeedConnection): Promise<readonly FoundSeedDocument[]> {
  const result = (await runSeedQuery(connection, {
    query: `*[_type in $types]{_id, _type, parent}`,
    params: { types: SEEDED_TYPES },
    perspective: "raw",
  })) as readonly FoundSeedDocument[];
  return result.filter((doc) => isSeedDocumentId(doc._id));
}

/**
 * Deletes a set of seeded documents in the one order that is safe against
 * this schema set's own reference declarations — see
 * `orderSeedDocumentsForDeletion`'s own doc comment for the full reference
 * graph and why a naive two-way split (placements, then everything else in
 * one pass) is not correct in general. Each wave is its own batched write
 * (a mutation batch is its own transaction), and waves run strictly in
 * order: a later wave is never started before an earlier one's batches have
 * all completed. Shared by the stale-document prune below and
 * `--delete-all`.
 */
async function deleteInDependencySafeOrder(
  connection: SeedConnection,
  docs: readonly FoundSeedDocument[],
): Promise<void> {
  for (const wave of orderSeedDocumentsForDeletion(docs)) {
    await runSeedMutationBatches(
      connection,
      wave.map((doc) => ({ delete: { id: doc._id } })),
    );
  }
}

/**
 * Deletes every seed-owned document, unconditionally — the real go-live
 * cleanup path (see `docs/sanity-seeding.md`'s "Going live" section). This
 * intentionally never builds or validates the fixture set: an operator
 * emptying it out first (an earlier draft of this workflow suggested exactly
 * that) would just make `validateSeedFixtures` refuse to run at all, since
 * an empty document set fails every one of its structural invariants. This
 * path only ever queries and deletes; it never builds fixtures, uploads an
 * asset, or writes anything.
 */
async function deleteAllSeededDocuments(connection: SeedConnection): Promise<void> {
  const existing = await findAllSeededDocuments(connection);

  if (existing.length === 0) {
    console.log("Nothing to delete — no seed-owned documents were found.");
    return;
  }

  console.log(`Deleting ${existing.length} seed-owned document(s)...`);
  await deleteInDependencySafeOrder(connection, existing);
  const remaining = await findAllSeededDocuments(connection);
  if (remaining.length > 0) {
    fail(
      `${remaining.length} seed-owned document(s) remained after deletion:\n  ${remaining.map((doc) => doc._id).join("\n  ")}`,
    );
  }
  console.log(`Deleted and verified ${existing.length} document(s). Uploaded demo photograph assets are not seed-owned — see docs/sanity-seeding.md for how to find and remove those.`);
}

/**
 * Reports (and, with `prune`, deletes) every seed-owned document not part of
 * the current run's manifest. Returns whether anything was deleted, so the
 * caller can decide whether verification's exact-count checks need to run
 * again afterward.
 */
async function reportAndPruneStale(
  connection: SeedConnection,
  currentIds: ReadonlySet<string>,
  prune: boolean,
): Promise<boolean> {
  const existing = await findAllSeededDocuments(connection);

  // Normalized: a draft or release-version copy of a *current* document
  // (its published-identity `_id` is in currentIds) is not stale — only a
  // document whose published identity has genuinely left the fixture is.
  const stale = existing.filter((doc) => !currentIds.has(publishedIdOf(doc._id)));
  if (stale.length === 0) return false;

  console.log(`\n${stale.length} previously seeded document(s) are no longer part of this fixture set:`);
  for (const doc of stale) console.log(`  ${doc._id}`);

  if (!prune) {
    console.log("Re-run with --prune-stale to delete them, or leave them and remove by hand.");
    return false;
  }

  await deleteInDependencySafeOrder(connection, stale);
  console.log(`Deleted ${stale.length} stale document(s).`);
  return true;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const apply = hasFlag("yes");
  const prune = hasFlag("prune-stale");
  const deleteAll = hasFlag("delete-all");

  if (deleteAll) {
    // The real go-live cleanup path. Deliberately does not build or
    // validate the fixture set at all — see deleteAllSeededDocuments's own
    // doc comment for why "empty the fixtures and re-run" cannot work.
    if (!apply) {
      console.log("--delete-all found. Add --yes to actually delete every seed-owned document. No network request was made.");
      return;
    }
    const connection = parseSeedConnection({
      projectId: requiredSetting("project", "SANITY_PROJECT_ID"),
      dataset: requiredSetting("dataset", "SANITY_DATASET"),
      apiVersion: requiredSetting("api-version", "SANITY_API_VERSION"),
      token: requiredEnvSetting("SANITY_SEED_TOKEN"),
    });
    await deleteAllSeededDocuments(connection);
    return;
  }

  const { documents: dryRunDocuments } = buildSeedFixtures();
  const dryRunViolations = validateSeedFixtures(dryRunDocuments);
  if (dryRunViolations.length > 0) {
    fail(`the fixture set has ${dryRunViolations.length} invariant violation(s):\n  ${dryRunViolations.join("\n  ")}`);
  }

  summarize(dryRunDocuments);
  const assetFiles = await resolveAssetFilePaths();
  console.log(`\nResolved ${assetFiles.size} demo photograph file(s) in public/gallery/.`);

  if (!apply) {
    console.log("\nDry run only — no network request was made. Re-run with --yes to write.");
    return;
  }

  let connection: SeedConnection;
  try {
    connection = parseSeedConnection({
      projectId: requiredSetting("project", "SANITY_PROJECT_ID"),
      dataset: requiredSetting("dataset", "SANITY_DATASET"),
      apiVersion: requiredSetting("api-version", "SANITY_API_VERSION"),
      token: requiredEnvSetting("SANITY_SEED_TOKEN"),
    });
  } catch (cause) {
    fail(cause instanceof SanitySeedConfigurationError ? cause.message : String(cause));
  }

  await preflightIdentityCollisions(connection, dryRunDocuments);

  console.log("\nUploading demo photographs...");
  // The six uploads are fully independent — none depends on another's
  // result, `assetRefsByKey` is only assembled afterward — so they run
  // concurrently rather than one at a time.
  const uploads = await Promise.all(
    [...assetFiles].map(async ([key, fileUrl]) => {
      const bytes = new Uint8Array(await readFile(fileUrl));
      const uploaded = await uploadSeedImageAsset(
        connection,
        { bytes, contentType: "image/webp" },
        { maxDimension: MAX_PUBLIC_DELIVERY_DIMENSION, formatsByExtension: PUBLIC_DELIVERY_FORMATS },
      );
      console.log(`  uploaded ${key} -> ${uploaded.assetId} (${uploaded.width}x${uploaded.height})`);
      return [key, uploaded.assetId] as const;
    }),
  );
  const assetRefsByKey = new Map(uploads);

  const { documents } = buildSeedFixtures({ assetRefsByKey });
  const violations = validateSeedFixtures(documents);
  if (violations.length > 0) {
    fail(`the resolved fixture set has ${violations.length} invariant violation(s):\n  ${violations.join("\n  ")}`);
  }

  console.log(`\nWriting ${documents.length} documents...`);
  const summary = await runSeedMutationBatches(
    connection,
    documents.map((doc) => ({ createOrReplace: doc })),
  );
  console.log(`Wrote ${summary.mutationCount} documents in ${summary.batchesRun} batch(es).`);

  // Order no longer matters for verification's own correctness — its
  // exact-count checks are scoped to this run's own manifest (see
  // buildVerificationChecks's doc comment), so a stale leftover document
  // cannot skew them either way. Pruning first is still done here simply
  // because it is the more useful order to report in: the operator sees
  // what changed before seeing whether the new state reads back correctly.
  await reportAndPruneStale(connection, new Set(documents.map((doc) => doc._id)), prune);
  await runLiveVerification(connection, documents);
}

main().catch((cause) => {
  fail(cause instanceof Error ? cause.message : String(cause));
});
