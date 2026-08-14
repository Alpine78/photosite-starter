/**
 * The public category adapter: Sanity `category` documents in, one locale's
 * `ContentCategoryInput[]` out — the input half of `content-tree.ts`'s
 * `ContentTreeInput`.
 *
 * `content-tree.ts` is the vendor-neutral tree domain: identity, parent
 * reference, slug, label, order, and the deterministic rejection of
 * self-parenting, cycles, orphans, sibling-slug collisions, and bad
 * placements. This module does not reimplement any of that — ADR-0003
 * decision 4 names the domain validation the tree's authoritative backstop,
 * precisely so a provider adapter only has to *feed* it, never re-derive it.
 * `readPublicContentTree` below is that feed: it projects category documents,
 * accepts whatever placements the caller already read, and hands both to
 * `buildContentTree`, which throws `ContentTreeValidationError` on anything
 * structurally invalid — self-parenting, a cycle, an orphaned parent, or a
 * sibling-slug collision alike.
 *
 * ## Placements are not read here
 *
 * ADR-0003 decision 5 makes canonical and secondary category placement a
 * property of the gallery or article being placed, not of the category
 * receiving it. Those documents — and their own adapters — are AB#113's and
 * AB#81's. This module only ever produces categories; `readPublicContentTree`
 * accepts placements as plain `ContentPlacementInput[]`, already read by
 * whichever adapters own gallery and article content once they exist. That
 * keeps this module correct and useful before either lands: nothing here
 * guesses a `_type` name or a field shape that story hasn't decided yet.
 *
 * ## One document, every language
 *
 * `category.ts`'s module comment explains why `label` and `slug` are
 * language-keyed arrays on one document rather than one document per
 * language: a category has no per-language publication lifecycle to
 * preserve, unlike a gallery or article. A category missing a slug or a label
 * in the requested language is treated as not yet published in that
 * language — the same outcome as the document not existing at all — rather
 * than as a defect: ADR-0003 decision 6 explicitly allows a category to exist
 * in one locale before another.
 *
 * ## Resolving `parent` without trusting `_ref`
 *
 * A reference's `_ref` is Sanity's internal document id, which has no
 * relationship to this project's own `categoryId`. Dereferencing the
 * reference in GROQ (`parent->categoryId`) would collapse two different
 * failure states into the same `null`: "no parent was set" and "a parent was
 * set but does not resolve" — the second of which must become
 * `content-tree.ts`'s `missing-parent` issue, not a silently top-level
 * category. So the query reads the raw `_ref` instead, and this module
 * resolves it locally against every category id it fetched. An unresolved
 * reference is passed through unchanged as `parentId`: it will not match any
 * known `categoryId`, and `buildContentTree` reports exactly that.
 */

import "server-only";

import {
  buildContentTree,
  diffCanonicalPaths,
  type CanonicalPathDiff,
  type ContentCategoryInput,
  type ContentPlacementInput,
  type ContentTree,
} from "@/lib/content-tree";
import {
  isRecord,
  toLanguageSubtag,
} from "@/lib/sanity-values";
import { getSanityClient, type SanityClient } from "@/lib/sanity-client";

/**
 * The document type this adapter reads. Declared here rather than imported
 * from `sanity/schemas`: the Studio schema is content-store configuration,
 * not application code (ADR-0006). A test pins the two names together.
 */
export const CATEGORY_DOCUMENT_TYPE = "category";

/**
 * Schema field names the query reads. Exists as data so a test can check it
 * against the schema, the same way `sanity-media.ts` pins its own projection.
 */
export const PROJECTED_CATEGORY_FIELDS = [
  "categoryId",
  "parent",
  "slug",
  "label",
  "order",
] as const;

export const CATEGORY_FILTER = `_type == "${CATEGORY_DOCUMENT_TYPE}"`;

/**
 * The allow-listed projection. `_id` is read only to resolve `parent`
 * locally (see the module comment) and never appears in the projected
 * output.
 */
export const CATEGORY_PROJECTION = `{
  _id,
  categoryId,
  "parentRef": parent._ref,
  slug[]{language, value},
  label[]{language, value},
  order
}`;

/** Why a document could not become a category the tree can use. */
export type SanityContentTreeRejection =
  /** No usable `categoryId`, so nothing could reference this document. */
  | "incomplete-document"
  /** The store answered with something that is not a list of documents. */
  | "malformed-result";

export class SanityContentTreeError extends Error {
  readonly rejection: SanityContentTreeRejection;

  constructor(rejection: SanityContentTreeRejection, detail: string) {
    super(`[sanity-content-tree] ${detail}`);
    this.name = "SanityContentTreeError";
    this.rejection = rejection;
  }
}

/**
 * One document as the projection above returns it. Every field is `unknown`:
 * this is data that arrived over the network, typed as what it should be
 * only after it has been checked.
 */
export type RawPublicCategoryDocument = {
  readonly _id?: unknown;
  readonly categoryId?: unknown;
  readonly parentRef?: unknown;
  readonly slug?: unknown;
  readonly label?: unknown;
  readonly order?: unknown;
};

/**
 * The identity shape `category.ts`'s Studio validation enforces, enforced
 * again here. A Studio rule binds an editor; it does not bind the HTTP API,
 * an import, or a migration script, and all three can write a document.
 */
const CATEGORY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LANGUAGE_SUBTAG = /^[a-z]{2,3}$/;

/** Structural strings are validated as stored; this boundary never repairs them. */
function readStructuralString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && !/\s/.test(value)
    ? value
    : undefined;
}

function readParentReference(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const reference = readStructuralString(value);
  if (reference !== undefined) return reference;
  throw new SanityContentTreeError(
    "malformed-result",
    "a category document has a malformed parent reference",
  );
}

/**
 * Reads one language-keyed structural or authored field without normalizing
 * it. Malformed entries and duplicate language keys are broken store data.
 */
function readCategoryLocalizedValues(
  entries: unknown,
  field: "slug" | "label",
): ReadonlyMap<string, string> {
  if (!Array.isArray(entries)) {
    throw new SanityContentTreeError(
      "malformed-result",
      `a category document has a ${field} value that is not a language-keyed list`,
    );
  }

  const values = new Map<string, string>();
  for (const entry of entries) {
    if (
      !isRecord(entry) ||
      typeof entry.language !== "string" ||
      !LANGUAGE_SUBTAG.test(entry.language) ||
      typeof entry.value !== "string"
    ) {
      throw new SanityContentTreeError(
        "malformed-result",
        `a category document has a malformed ${field} language entry`,
      );
    }

    if (values.has(entry.language)) {
      throw new SanityContentTreeError(
        "malformed-result",
        `a category document has more than one ${field} entry for language "${entry.language}"`,
      );
    }
    values.set(entry.language, entry.value);
  }

  return values;
}

/**
 * Every fetched document's own id, mapped to its `categoryId` — used to
 * resolve `parentRef` locally. Only documents with a usable identity take
 * part: one with none cannot be any other category's resolvable parent
 * either.
 */
function indexCategoryIds(
  documents: readonly RawPublicCategoryDocument[],
): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  for (const document of documents) {
    const id = readStructuralString(document._id);
    if (id === undefined) continue;
    const categoryId = readStructuralString(document.categoryId);
    if (categoryId !== undefined && CATEGORY_ID.test(categoryId)) {
      index.set(id, categoryId);
    }
  }
  return index;
}

/**
 * Projects one document into one language's `ContentCategoryInput`, or
 * `undefined` when this category is not published in that language.
 *
 * Pure and exported so the mapping is testable with plain fixtures, wholly
 * independent of a live Sanity project — the same shape
 * `sanity-media.ts#projectPublicMedia` takes.
 */
export function projectPublicCategoryInput(
  document: RawPublicCategoryDocument,
  language: string,
  categoryIdsById: ReadonlyMap<string, string>,
): ContentCategoryInput | undefined {
  const categoryId = readStructuralString(document.categoryId);
  if (categoryId === undefined || !CATEGORY_ID.test(categoryId)) {
    throw new SanityContentTreeError(
      "incomplete-document",
      "a category document has no usable categoryId, so nothing can reference it",
    );
  }

  const resolvedLanguage = toLanguageSubtag(language);
  const slugs = readCategoryLocalizedValues(document.slug, "slug");
  const labels = readCategoryLocalizedValues(document.label, "label");
  const slug = slugs.get(resolvedLanguage);
  const label = labels.get(resolvedLanguage);
  if (slug === undefined || label === undefined) {
    return undefined;
  }

  const parentRef = readParentReference(document.parentRef);
  const parentId = parentRef === null
    ? null
    : (categoryIdsById.get(parentRef) ?? parentRef);

  return {
    categoryId,
    parentId,
    slug,
    label,
    // `content-tree.ts` owns the finite-number diagnostic. Preserve actual
    // numbers and map every other JSON type to its rejected representation;
    // coercion would turn null, false, or an empty string into an authored 0.
    order: typeof document.order === "number" ? document.order : Number.NaN,
  };
}

/**
 * Reads the documented answer shape, or says so. A query that evaluates to
 * something other than a list of documents is a broken contract, not an
 * empty tree.
 */
function readDocuments(result: unknown): readonly RawPublicCategoryDocument[] {
  if (!Array.isArray(result) || !result.every(isRecord)) {
    throw new SanityContentTreeError(
      "malformed-result",
      "the content store answered with something other than a list of category documents",
    );
  }

  return result;
}

/**
 * Projects a full query result into one language's category inputs. Exported
 * for the same reason `projectPublicCategoryInput` is: it is pure, and a test
 * can exercise a whole fixture tree — deep, mixed content, moved, renamed, or
 * structurally invalid — without a network.
 */
export function projectPublicCategoryInputs(
  documents: readonly RawPublicCategoryDocument[],
  language: string,
): readonly ContentCategoryInput[] {
  const categoryIdsById = indexCategoryIds(documents);

  const inputs: ContentCategoryInput[] = [];
  for (const document of documents) {
    const input = projectPublicCategoryInput(document, language, categoryIdsById);
    if (input !== undefined) inputs.push(input);
  }
  return inputs;
}

export type PublicCategorySnapshotDiffOptions = {
  readonly language: string;
  readonly previousDocuments: readonly RawPublicCategoryDocument[];
  readonly currentDocuments: readonly RawPublicCategoryDocument[];
  readonly previousPlacements: readonly ContentPlacementInput[];
  readonly currentPlacements: readonly ContentPlacementInput[];
};

/**
 * Resolves the URL impact of a confirmed Sanity category move or rename.
 *
 * The Studio schema blocks direct edits to published parent and slug fields.
 * A project-owned URL-change workflow supplies the before/after snapshots to
 * this seam, shows this complete category-and-content diff to the author, and
 * persists each accepted previous path in the redirect history. Keeping the
 * operation here ensures the workflow uses the same projection and domain
 * validation as a public read rather than reconstructing paths from CMS data.
 */
export function diffPublicCategorySnapshots(
  options: PublicCategorySnapshotDiffOptions,
): CanonicalPathDiff {
  const previous = buildContentTree({
    categories: projectPublicCategoryInputs(
      options.previousDocuments,
      options.language,
    ),
    placements: options.previousPlacements,
  });
  const current = buildContentTree({
    categories: projectPublicCategoryInputs(
      options.currentDocuments,
      options.language,
    ),
    placements: options.currentPlacements,
  });
  return diffCanonicalPaths(previous, current);
}

export type PublicCategoryReadOptions = {
  readonly language: string;
  /** Injected in tests; production resolves the deployment's own client. */
  readonly client?: SanityClient;
};

/**
 * Every published category, projected for one language. Unbounded: unlike a
 * media or gallery listing, `buildContentTree` needs the whole set to reject
 * a cycle or an orphan, so there is no page to push a limit into.
 */
export async function readPublicCategoryInputs(
  options: PublicCategoryReadOptions,
): Promise<readonly ContentCategoryInput[]> {
  const client = options.client ?? getSanityClient();

  const result = await client.query({
    query: `*[${CATEGORY_FILTER}]${CATEGORY_PROJECTION}`,
    tag: "category.tree",
  });

  return projectPublicCategoryInputs(readDocuments(result), options.language);
}

export type PublicContentTreeReadOptions = PublicCategoryReadOptions & {
  /**
   * Already read by whichever adapters own gallery and article content. See
   * the module comment: this module never fetches them itself.
   */
  readonly placements: readonly ContentPlacementInput[];
};

/**
 * Composes this deployment's categories with placements the caller already
 * read into one validated tree — the Sanity-backed counterpart of
 * `mock-content-tree.ts#buildMockContentTree`. Throws
 * `ContentTreeValidationError` for anything `content-tree.ts` rejects.
 */
export async function readPublicContentTree(
  options: PublicContentTreeReadOptions,
): Promise<ContentTree> {
  const categories = await readPublicCategoryInputs(options);
  return buildContentTree({ categories, placements: options.placements });
}
