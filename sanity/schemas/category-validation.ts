/**
 * Sanity Studio's publication guard for the public category tree.
 *
 * The application domain remains the authoritative backstop. This validator
 * applies the same externally visible invariants earlier, against the
 * published tree with the document currently being edited overlaid, so a
 * standard Studio publish cannot make the public site unreadable first.
 */

import { LOCALIZED_SLUG_PATTERN } from "./localized-slug";
import type {
  SchemaValidationContext,
  SchemaValidationResult,
} from "./schema-types";
import { publishedIdOf, validationClientOf } from "./validation";

const CATEGORY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LANGUAGE_SUBTAG = /^[a-z]{2,3}$/;
/** Restates content-tree.ts's domain limit; category.test.ts pins the copies. */
export const STUDIO_MAX_CATEGORY_DEPTH = 5;

export const CATEGORY_VALIDATION_QUERY = `*[_type == $type]{
  _id,
  categoryId,
  "parentRef": parent._ref,
  slug[]{language, value},
  label[]{language, value},
  order
}`;

type RawCategory = {
  readonly _id?: unknown;
  readonly categoryId?: unknown;
  readonly parentRef?: unknown;
  readonly slug?: unknown;
  readonly label?: unknown;
  readonly order?: unknown;
};

type ParsedCategory = {
  readonly documentId: string;
  readonly categoryId: string;
  readonly parentRef: string | null;
  readonly slug: ReadonlyMap<string, string>;
  readonly label: ReadonlyMap<string, string>;
  readonly order: number;
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && !/\s/.test(value)
    ? value
    : undefined;
}

function localizedValues(
  value: unknown,
  field: "slug" | "label",
  categoryId: string,
): ReadonlyMap<string, string> | string {
  if (!Array.isArray(value)) {
    return `Category "${categoryId}" has a malformed ${field} list.`;
  }

  const result = new Map<string, string>();
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      typeof entry.language !== "string" ||
      !LANGUAGE_SUBTAG.test(entry.language) ||
      typeof entry.value !== "string"
    ) {
      return `Category "${categoryId}" has a malformed ${field} language entry.`;
    }
    if (result.has(entry.language)) {
      return `Category "${categoryId}" has more than one ${field} entry for language "${entry.language}".`;
    }
    result.set(entry.language, entry.value);
  }
  return result;
}

function parseCategory(value: RawCategory): ParsedCategory | string {
  const documentId = exactString(value._id);
  const categoryId = exactString(value.categoryId);
  if (documentId === undefined || categoryId === undefined || !CATEGORY_ID.test(categoryId)) {
    return "Every category needs a valid document id and categoryId before the tree can be published.";
  }

  const parentRef = value.parentRef === undefined || value.parentRef === null
    ? null
    : exactString(value.parentRef);
  if (parentRef === undefined) {
    return `Category "${categoryId}" has a malformed parent reference.`;
  }

  const slug = localizedValues(value.slug, "slug", categoryId);
  if (typeof slug === "string") return slug;
  const label = localizedValues(value.label, "label", categoryId);
  if (typeof label === "string") return label;
  if (![...slug.keys()].some((language) => label.has(language))) {
    return `Category "${categoryId}" needs at least one language with both a path segment and a display label.`;
  }
  if (typeof value.order !== "number" || !Number.isFinite(value.order)) {
    return `Category "${categoryId}" needs a finite numeric sibling order.`;
  }

  return { documentId, categoryId, parentRef, slug, label, order: value.order };
}

function currentRawCategory(
  document: Readonly<Record<string, unknown>>,
): RawCategory | string {
  const documentId = exactString(document._id);
  if (documentId === undefined) return "The category being edited has no document id.";

  const parent = document.parent;
  let parentRef: unknown;
  if (parent !== undefined && parent !== null) {
    if (!isRecord(parent)) return "The category being edited has a malformed parent reference.";
    parentRef = parent._ref;
  }

  return {
    _id: publishedIdOf(documentId),
    categoryId: document.categoryId,
    parentRef,
    slug: document.slug,
    label: document.label,
    order: document.order,
  };
}

function preservesPublishedLocalePaths(
  published: ParsedCategory,
  proposed: ParsedCategory,
): boolean {
  for (const [language, value] of published.slug) {
    // A slug alone owns no route. The category becomes public in a language
    // only when both its slug and label exist in that language.
    if (!published.label.has(language)) continue;
    if (
      proposed.slug.get(language) !== value ||
      !proposed.label.has(language)
    ) {
      return false;
    }
  }
  return true;
}

function validatePublishedUrlFields(
  previous: ParsedCategory | undefined,
  current: ParsedCategory,
): string | undefined {
  if (previous === undefined) return undefined;

  const previousParent = previous.parentRef === null
    ? null
    : publishedIdOf(previous.parentRef);
  const currentParent = current.parentRef === null
    ? null
    : publishedIdOf(current.parentRef);
  const ownedPublishedRoute = [...previous.slug.keys()].some((language) =>
    previous.label.has(language));
  if (
    (ownedPublishedRoute && previousParent !== currentParent) ||
    !preservesPublishedLocalePaths(previous, current)
  ) {
    return `Category "${current.categoryId}" already owns published URLs. Its parent and path segments cannot be changed in the ordinary editor because that would lose the impact preview and permanent redirect history required by ADR-0003. Use the project-owned URL-change workflow.`;
  }

  return undefined;
}

type LocaleCategory = {
  readonly categoryId: string;
  readonly parentId: string | null;
  readonly slug: string;
};

function validateLocaleTree(
  language: string,
  categories: readonly ParsedCategory[],
  categoryIdsByDocumentId: ReadonlyMap<string, string>,
): string | undefined {
  const localized = new Map<string, LocaleCategory>();
  for (const category of categories) {
    const slug = category.slug.get(language);
    const label = category.label.get(language);
    if (slug === undefined || label === undefined) continue;
    if (!LOCALIZED_SLUG_PATTERN.test(slug)) {
      return `Category "${category.categoryId}" has an invalid ${language} path segment.`;
    }
    if (label.trim().length === 0) {
      return `Category "${category.categoryId}" has an empty ${language} label.`;
    }

    const parentId = category.parentRef === null
      ? null
      : (categoryIdsByDocumentId.get(publishedIdOf(category.parentRef)) ?? category.parentRef);
    localized.set(category.categoryId, { categoryId: category.categoryId, parentId, slug });
  }

  const siblingClaims = new Map<string, string>();
  for (const category of [...localized.values()].sort((a, b) =>
    a.categoryId.localeCompare(b.categoryId))) {
    const claim = `${category.parentId ?? ""}\u0000${category.slug}`;
    const existing = siblingClaims.get(claim);
    if (existing !== undefined) {
      return `Categories "${existing}" and "${category.categoryId}" claim the same ${language} path segment beneath one parent.`;
    }
    siblingClaims.set(claim, category.categoryId);

    const visited = new Set<string>();
    let current: LocaleCategory | undefined = category;
    let depth = 0;
    while (current !== undefined) {
      if (visited.has(current.categoryId)) {
        return `Category "${category.categoryId}" belongs to a cycle in the ${language} tree.`;
      }
      visited.add(current.categoryId);
      depth += 1;
      if (depth > STUDIO_MAX_CATEGORY_DEPTH) {
        return `Category "${category.categoryId}" exceeds the maximum ${STUDIO_MAX_CATEGORY_DEPTH}-level depth in the ${language} tree.`;
      }
      if (current.parentId === null) break;
      const parent = localized.get(current.parentId);
      if (parent === undefined) {
        return `Category "${category.categoryId}" has a parent that is missing from the ${language} tree.`;
      }
      current = parent;
    }
  }

  return undefined;
}

/** Pure prospective-tree validation, exported for deterministic fixture tests. */
export function validateProspectiveCategoryTree(
  publishedResult: unknown,
  currentDocument: Readonly<Record<string, unknown>>,
): SchemaValidationResult {
  if (!Array.isArray(publishedResult) || !publishedResult.every(isRecord)) {
    return "The content store returned a malformed category tree during publication validation.";
  }

  const currentRaw = currentRawCategory(currentDocument);
  if (typeof currentRaw === "string") return currentRaw;
  const currentId = exactString(currentRaw._id);
  if (currentId === undefined) return "The category being edited has no published identity.";

  const previousRaw = publishedResult.find((candidate) =>
    exactString(candidate._id) === currentId);
  const prospectiveRaw: RawCategory[] = [
    ...publishedResult.filter((candidate) => exactString(candidate._id) !== currentId),
    currentRaw,
  ];

  const parsed: ParsedCategory[] = [];
  for (const raw of prospectiveRaw) {
    const category = parseCategory(raw);
    if (typeof category === "string") return category;
    parsed.push(category);
  }

  const previous = previousRaw === undefined ? undefined : parseCategory(previousRaw);
  if (typeof previous === "string") return previous;
  const current = parsed.find((category) => category.documentId === currentId);
  if (current === undefined) return "The category being edited was not present in its prospective tree.";
  const urlIssue = validatePublishedUrlFields(previous, current);
  if (urlIssue !== undefined) return urlIssue;

  const categoryIds = new Set<string>();
  const categoryIdsByDocumentId = new Map<string, string>();
  const languages = new Set<string>();
  for (const category of parsed) {
    if (categoryIds.has(category.categoryId)) {
      return `More than one category document uses categoryId "${category.categoryId}".`;
    }
    categoryIds.add(category.categoryId);
    categoryIdsByDocumentId.set(publishedIdOf(category.documentId), category.categoryId);
    for (const language of category.slug.keys()) languages.add(language);
    for (const language of category.label.keys()) languages.add(language);
  }

  for (const language of [...languages].sort()) {
    const issue = validateLocaleTree(language, parsed, categoryIdsByDocumentId);
    if (issue !== undefined) return issue;
  }
  return true;
}

/** Document-level Studio validation; errors block the standard Publish action. */
export async function validateCategoryPublication(
  value: Readonly<Record<string, unknown>> | undefined,
  context: SchemaValidationContext,
  categoryType: string,
): Promise<SchemaValidationResult> {
  const current = value ?? context.document;
  if (current === undefined) return true;

  const published = await validationClientOf(context, "published").fetch<unknown>(
    CATEGORY_VALIDATION_QUERY,
    { type: categoryType },
  );
  return validateProspectiveCategoryTree(published, current);
}
