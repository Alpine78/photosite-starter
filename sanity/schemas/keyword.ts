/**
 * The controlled keyword vocabulary (ADR-0039 decisions 1, 4 and 5). Lightroom
 * terms are imported audit data; these documents are what the site's public
 * keyword queries resolve against. The governance rules are in `keyword-rules.ts`.
 *
 * ## Publication
 *
 * Studio publishes a keyword with its own action, never natively. One transaction
 * writes the document and advances `keywordTaxonomyState` under that state's
 * revision guard, so two concurrent publications cannot each pass validation
 * against the old graph, and a structural change cannot be published without its
 * re-sync request. Content Releases and scheduled drafts would bypass that, so
 * they are refused. An API write bypasses Studio validation altogether: the import
 * (AB#57) and the re-sync (AB#69) must take the same guard.
 *
 * ## Deliberately not here
 *
 * The re-sync itself (AB#69), the private keyword record and import mapping
 * (AB#57), and public projection (AB#68). Studio creates ordinary public documents;
 * `internal` keywords on a private path arrive through the import path, and the
 * visibility transitions of decision 7 have no tool yet.
 */

import {
  isPrivateKeywordPath,
  KEYWORD_CATEGORY_TYPE_NAME,
  KEYWORD_GRAPH_QUERY,
  KEYWORD_ID_PATTERN,
  KEYWORD_TAXONOMY_STATE_TYPE_NAME,
  KEYWORD_TYPE_NAME,
  keywordMatchKey,
  proposeKeywordId,
  validateProspectiveKeywordGraph,
} from "./keyword-rules";
import { LOCALIZED_TEXT_TYPE_NAME, uniqueLanguages } from "./localized-text";
import type {
  SchemaTypeDefinition,
  SchemaValidationContext,
  SchemaValidationResult,
} from "./schema-types";
import { publishedIdOf, validationClientOf } from "./validation";

export type KeywordSchemaOptions = Readonly<{
  /** The language subtag of the site's default locale; its title is then required. */
  defaultContentLanguage?: string;
}>;

const CATEGORY_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type TitleEntry = Readonly<{ language?: unknown; value?: unknown }>;

function titleEntries(value: unknown): readonly TitleEntry[] {
  return Array.isArray(value) ? (value as readonly TitleEntry[]) : [];
}

function proposalFrom(document: SchemaValidationContext["document"], options: KeywordSchemaOptions): string | undefined {
  const entries = titleEntries(document?.title);
  const source = entries.find((entry) => entry.language === options.defaultContentLanguage) ?? entries[0];
  return typeof source?.value === "string" ? proposeKeywordId(source.value) : undefined;
}

function defineKeywordIdentityCheck(options: KeywordSchemaOptions) {
  return async function validateKeywordIdentity(
    value: string | undefined,
    context: SchemaValidationContext,
  ): Promise<SchemaValidationResult> {
    if (value === undefined || !KEYWORD_ID_PATTERN.test(value)) {
      const proposal = proposalFrom(context.document, options);
      return proposal === undefined
        ? "Use 2–40 lowercase letters, digits and single hyphens."
        : `Use 2–40 lowercase letters, digits and single hyphens. Proposed from the title: ${proposal}`;
    }
    const documentId = context.document?._id;
    if (typeof documentId !== "string") return true;

    const published = publishedIdOf(documentId);
    const { taken, publishedKeywordId } = await validationClientOf(context).fetch<{
      taken: boolean;
      publishedKeywordId: string | null;
    }>(
      `{
        "taken": defined(*[
          _type == $type &&
          keywordId == $keywordId &&
          !sanity::versionOf($published)
        ][0]._id),
        "publishedKeywordId": *[_id == $published][0].keywordId
      }`,
      { type: KEYWORD_TYPE_NAME, keywordId: value, published },
    );
    if (taken) return `Another keyword already uses "${value}", published or not. A keyword ID is never reused, even after a merge or retirement.`;
    if (publishedKeywordId !== null && publishedKeywordId !== value) {
      return `This keyword was published as "${publishedKeywordId}". Changing a keyword ID breaks public URLs and cursors — create a new keyword instead.`;
    }
    return true;
  };
}

function defineTitleCheck(options: KeywordSchemaOptions) {
  return (value: readonly TitleEntry[] | undefined): SchemaValidationResult => {
    const language = options.defaultContentLanguage;
    if (language === undefined) return true;
    return (value ?? []).some((entry) => entry.language === language && typeof entry.value === "string" && entry.value.trim().length > 0)
      ? true
      : `Add a title in the site's default language (${language}).`;
  };
}

function rejectsEmptyAliases(value: readonly unknown[] | undefined): SchemaValidationResult {
  return (value ?? []).every((alias) => typeof alias === "string" && keywordMatchKey(alias).length > 0)
    ? true
    : "An alias cannot be empty.";
}

function rejectsSelfReference(
  value: { readonly _ref?: unknown } | undefined,
  context: SchemaValidationContext,
): SchemaValidationResult {
  const ref = value?._ref, documentId = context.document?._id;
  if (typeof ref !== "string" || typeof documentId !== "string") return true;
  return publishedIdOf(ref) === publishedIdOf(documentId) ? "A keyword cannot refer to itself." : true;
}

async function validateKeywordPublication(
  value: Readonly<Record<string, unknown>> | undefined,
  context: SchemaValidationContext,
): Promise<SchemaValidationResult> {
  const current = value ?? context.document;
  if (current === undefined) return true;
  if (typeof current._id === "string" && current._id.startsWith("versions.")) {
    return "Keywords must be published with their own publication action, outside Content Releases and scheduled drafts.";
  }
  const published = await validationClientOf(context, "published").fetch<unknown>(KEYWORD_GRAPH_QUERY, { type: KEYWORD_TYPE_NAME });
  return validateProspectiveKeywordGraph(published, current);
}

async function validateCategorySlug(
  value: string | undefined,
  context: SchemaValidationContext,
): Promise<SchemaValidationResult> {
  if (value === undefined || !CATEGORY_SLUG.test(value)) return "Use lowercase letters, digits, and single hyphens";
  const documentId = context.document?._id;
  if (typeof documentId !== "string") return true;
  if (isPrivateKeywordPath(documentId)) return "A keyword category must be an ordinary public document.";
  const taken = await validationClientOf(context).fetch<boolean>(
    `defined(*[_type == $type && slug == $slug && !sanity::versionOf($published)][0]._id)`,
    { type: KEYWORD_CATEGORY_TYPE_NAME, slug: value, published: publishedIdOf(documentId) },
  );
  return taken ? `Another keyword category already uses "${value}".` : true;
}

export function defineKeywordType(options: KeywordSchemaOptions = {}): SchemaTypeDefinition {
  return {
    name: KEYWORD_TYPE_NAME,
    title: "Keyword",
    type: "document",
    description:
      "One term of the controlled image vocabulary. Lightroom terms map to these documents, and photographs refer to them, so a rename here changes every page without touching a photograph.",
    validation: (rule) => rule.custom<Readonly<Record<string, unknown>>>(validateKeywordPublication),
    fields: [
      {
        name: "title",
        title: "Title",
        type: "array",
        of: [{ type: LOCALIZED_TEXT_TYPE_NAME }],
        description:
          "The name shown to visitors, exactly as written. A name normally needs one title; other languages fall back to the default language. A replaced title stays as an alias automatically, so the next Lightroom import still finds this keyword.",
        validation: (rule) => uniqueLanguages(rule.required().min(1)).custom(defineTitleCheck(options)),
      },
      {
        name: "keywordId",
        title: "Keyword ID",
        type: "string",
        description:
          "Permanent identity used in public URLs: 2–40 lowercase letters, digits and single hyphens. Mint it once. It is never changed or reused, even after a merge or retirement.",
        validation: (rule) => rule.required().custom(defineKeywordIdentityCheck(options)),
      },
      {
        name: "category",
        title: "Category",
        type: "reference",
        to: [{ type: KEYWORD_CATEGORY_TYPE_NAME }],
        options: { disableNew: true },
        description: "The group this keyword belongs to. The same name may exist once in each category.",
        validation: (rule) => rule.required(),
      },
      {
        name: "parent",
        title: "Parent keyword",
        type: "reference",
        to: [{ type: KEYWORD_TYPE_NAME }],
        options: { filter: 'status == "active"', disableNew: true },
        description:
          "Optional, and at most one. Choosing the parent in a search also finds this keyword. Moving a published keyword requires a re-sync of its photographs, which the publication records.",
        validation: (rule) => rule.custom(rejectsSelfReference),
      },
      {
        name: "aliases",
        title: "Aliases",
        type: "array",
        of: [{ type: "string" }],
        description:
          "Other spellings, former names and Lightroom synonyms, used for import matching and search. On a public keyword anyone can read them and a visitor's search matches them, though they never appear in public URLs.",
        validation: (rule) => rule.custom(rejectsEmptyAliases),
      },
      {
        name: "description",
        title: "Description",
        type: "array",
        of: [{ type: LOCALIZED_TEXT_TYPE_NAME }],
        description: "Optional explanation of what this keyword covers.",
        validation: (rule) => uniqueLanguages(rule),
      },
      {
        name: "status",
        title: "Status",
        type: "string",
        options: {
          layout: "radio",
          list: [
            { title: "Active", value: "active" },
            { title: "Merged into another keyword", value: "merged" },
            { title: "Retired", value: "retired" },
          ],
        },
        initialValue: "active",
        description:
          "Retire or merge only after re-parenting active child keywords. A published merge cannot be reversed. To honour a removal request for a named person, do not retire: a retired public document stays readable.",
        validation: (rule) => rule.required(),
      },
      {
        name: "mergedInto",
        title: "Merged into",
        type: "reference",
        to: [{ type: KEYWORD_TYPE_NAME }],
        options: { filter: 'status == "active"', disableNew: true },
        description: "The active keyword that replaces this one. Its old ID then redirects there, and its names map there.",
        validation: (rule) => rule.custom(rejectsSelfReference),
      },
      {
        name: "visibility",
        title: "Visibility",
        type: "string",
        readOnly: true,
        options: {
          list: [
            { title: "Public", value: "public" },
            { title: "Internal", value: "internal" },
          ],
        },
        initialValue: "public",
        description: "Fixed by where the document is stored, because an ordinary document in a public dataset can be read by anyone.",
        validation: (rule) => rule.required(),
      },
    ],
    preview: {
      select: { title: "keywordId", subtitle: "status" },
    },
  };
}

export const keywordCategoryType: SchemaTypeDefinition = {
  name: KEYWORD_CATEGORY_TYPE_NAME,
  title: "Keyword category",
  type: "document",
  description: "A configurable group of keywords, such as a subject or a place. Categories are content, so each site defines its own.",
  fields: [
    {
      name: "title",
      title: "Title",
      type: "array",
      of: [{ type: LOCALIZED_TEXT_TYPE_NAME }],
      description: "This category's name in each published language.",
      validation: (rule) => uniqueLanguages(rule.required().min(1)),
    },
    {
      name: "slug",
      title: "Slug",
      type: "string",
      description: "Unique lowercase words separated by hyphens, e.g. places.",
      validation: (rule) => rule.required().custom(validateCategorySlug),
    },
    {
      name: "order",
      title: "Order",
      type: "number",
      description: "Where this category sits among the others, lowest first.",
      validation: (rule) => rule.required(),
    },
    {
      name: "description",
      title: "Description",
      type: "array",
      of: [{ type: LOCALIZED_TEXT_TYPE_NAME }],
      description: "Optional explanation of what belongs in this category.",
      validation: (rule) => uniqueLanguages(rule),
    },
  ],
  preview: {
    select: { title: "slug", subtitle: "order" },
  },
};

/**
 * The one record of keyword publications. It holds numbers only, so a public
 * dataset learns nothing from it. A re-sync is outstanding while `resyncedVersion`
 * is behind `taxonomyVersion`; AB#69 acknowledges the version it actually
 * processed, so a newer request is never cleared by an older run.
 */
export const keywordTaxonomyStateType: SchemaTypeDefinition = {
  name: KEYWORD_TAXONOMY_STATE_TYPE_NAME,
  title: "Keyword taxonomy state",
  type: "document",
  description: "Written by keyword publication and the keyword re-sync, never by hand.",
  fields: [
    {
      name: "taxonomyVersion",
      title: "Taxonomy version",
      type: "number",
      readOnly: true,
      description: "Raised by every structural change. Public cursors carry it, so they detect a changed hierarchy.",
    },
    {
      name: "resyncedVersion",
      title: "Re-synced version",
      type: "number",
      readOnly: true,
      description: "The newest taxonomy version the re-sync has finished.",
    },
    {
      name: "publicationSequence",
      title: "Publication sequence",
      type: "number",
      readOnly: true,
      description: "Raised by every keyword publication, so concurrent publications conflict rather than both succeed.",
    },
  ],
};
