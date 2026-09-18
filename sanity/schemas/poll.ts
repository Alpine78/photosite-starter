/**
 * AB#162 / ADR-0018's Studio-authored poll: question, options, and a close
 * date. This document is the *only* one of ADR-0018's three poll document
 * kinds that has a Studio schema at all — `pollTally` and `pollVoteReceipt`
 * are written only through the vote endpoint's own scoped credential and
 * deliberately have no schema here, which is what makes "a Studio publish of
 * this document can never touch live vote counts" true by construction
 * (ADR-0018 §2) rather than a rule an editor has to remember.
 *
 * `pollId` is minted by hand and never derived from the question text, the
 * same identity discipline `mediaId`/`categoryId`/`contentId` already follow
 * (ADR-0002 §1). Unlike an article's `contentId`, a poll's identity is **not**
 * shared across language versions — the source Joomla site's own historical
 * polls prove why: a Finnish poll and its English counterpart were two
 * entirely separate polls with different questions asked at different times
 * (recorded on AB#26), not one question translated. So `pollId` is globally
 * unique, exactly like `mediaId`, rather than unique-per-language like
 * `contentId`.
 *
 * `src/lib/poll-identity.ts`'s `pollTallyDocumentId`/`pollVoteReceiptDocumentId`
 * are built from this document's `pollId`, never from its Sanity `_id` — the
 * two are independent identifiers for independent reasons (ADR-0002 §1's
 * "the CMS's own reference is not the identity" applies here exactly as it
 * does to a photograph).
 */

import type {
  SchemaTypeDefinition,
  SchemaValidationContext,
  SchemaValidationResult,
} from "./schema-types";
import { publishedIdOf, validationClientOf } from "./validation";

export const POLL_TYPE_NAME = "poll";

/** Restated from `src/lib/public-identity.ts`'s `PUBLIC_IDENTITY_PATTERN`; a test pins the two equal. */
const POLL_IDENTITY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A poll with one option cannot be voted on; a generous ceiling matches the largest legacy poll seen (10). */
export const MIN_POLL_OPTIONS = 2;
export const MAX_POLL_OPTIONS = 10;

function nonBlank(value: string | undefined): SchemaValidationResult {
  return value !== undefined && value.trim().length > 0 ? true : "Enter a non-empty value";
}

/**
 * Syntax, site-wide uniqueness, and immutability once published — the same
 * one-round-trip shape `media.ts#validateMediaIdentity` already established,
 * restated here because `pollId` is a distinct identity space from `mediaId`
 * (ADR-0002 §1: two different things must never share one identity, even by
 * accident of a copy-pasted validator matching on the wrong `_type`).
 */
async function validatePollIdentity(
  value: string | undefined,
  context: SchemaValidationContext,
): Promise<SchemaValidationResult> {
  if (value === undefined || !POLL_IDENTITY_PATTERN.test(value)) {
    return "Use lowercase letters, digits, and single hyphens, e.g. camera-preference";
  }

  const documentId = context.document?._id;
  if (typeof documentId !== "string") return true;

  const published = publishedIdOf(documentId);
  const { taken, publishedPollId } = await validationClientOf(context).fetch<{
    taken: boolean;
    publishedPollId: string | null;
  }>(
    `{
      "taken": defined(*[
        _type == $type &&
        pollId == $pollId &&
        !sanity::versionOf($published)
      ][0]._id),
      "publishedPollId": *[_id == $published][0].pollId
    }`,
    { type: POLL_TYPE_NAME, pollId: value, published },
  );

  if (taken) {
    return `Another poll already uses "${value}", published or not. A poll ID identifies one poll across the whole site.`;
  }

  if (publishedPollId !== null && publishedPollId !== value) {
    return `This poll was published as "${publishedPollId}". Changing a poll ID would silently strand its live vote tally and dedup records under the old id — create a new poll instead.`;
  }

  return true;
}

/** Every optionId must be non-blank and unique within the poll — a duplicate would make one tally bucket ambiguous. */
async function validateUniqueOptionIds(
  options: readonly { optionId?: string }[] | undefined,
  context: SchemaValidationContext,
): Promise<SchemaValidationResult> {
  if (options === undefined) return true;
  const ids = options.map((option) => option.optionId).filter((id): id is string => typeof id === "string");
  const seen = new Set<string>();
  for (const id of ids) {
    if (!POLL_IDENTITY_PATTERN.test(id)) {
      return `"${id}" must use lowercase letters, digits, and single hyphens.`;
    }
    if (seen.has(id)) {
      return `Option id "${id}" is used more than once in this poll.`;
    }
    seen.add(id);
  }
  const documentId = context.document?._id;
  if (typeof documentId === "string") {
    const publishedIds = await validationClientOf(context).fetch<readonly string[] | null>(
      `*[_id == $published][0].options[].optionId`, { published: publishedIdOf(documentId) },
    );
    if (publishedIds && publishedIds.some((id) => !seen.has(id))) {
      return "Published option IDs cannot be removed or changed: their vote counts refer to them. Create a new poll instead.";
    }
  }
  return true;
}

export const pollType: SchemaTypeDefinition = {
  name: POLL_TYPE_NAME,
  title: "Poll",
  type: "document",
  description:
    "A question, its options, and the date voting closes. Live vote counts are not stored here — they live in a separate record the vote endpoint alone writes, so publishing an edit to this poll never touches them.",
  fields: [
    {
      name: "pollId",
      title: "Poll ID",
      type: "string",
      description: "Stable identity for this poll, site-wide unique. Mint it once and never change it after publishing.",
      validation: (rule) => rule.required().max(64).custom(validatePollIdentity),
    },
    {
      name: "language",
      title: "Language",
      type: "string",
      description: "The language this poll's question and options are written in.",
      validation: (rule) =>
        rule.required().custom((value: string | undefined) =>
          typeof value === "string" && /^[a-z]{2,3}(-[A-Z]{2})?$/.test(value)
            ? true
            : "Use a two- or three-letter lowercase language subtag, e.g. fi or en",
        ),
    },
    {
      name: "question",
      title: "Question",
      type: "string",
      validation: (rule) => rule.required().max(500).custom(nonBlank),
    },
    {
      name: "options",
      title: "Options",
      type: "array",
      of: [
        {
          type: "object",
          fields: [
            {
              name: "optionId",
              title: "Option ID",
              type: "string",
              description: "Stable identity for this option within the poll, e.g. mirrorless.",
              validation: (rule) => rule.required().max(64),
            },
            {
              name: "label",
              title: "Label",
              type: "string",
              validation: (rule) => rule.required().max(500).custom(nonBlank),
            },
          ],
        },
      ],
      validation: (rule) =>
        rule
          .required()
          .min(MIN_POLL_OPTIONS)
          .max(MAX_POLL_OPTIONS)
          .custom<{ optionId?: string }[]>(validateUniqueOptionIds),
    },
    {
      name: "closeDate",
      title: "Closes on",
      type: "datetime",
      description: "Once this instant passes, the poll stops accepting votes and shows its results as final.",
      validation: (rule) => rule.required(),
    },
  ],
  preview: {
    select: { title: "question", subtitle: "pollId" },
  },
};
