import type { SchemaFieldDefinition, SchemaValidationResult } from "./schema-types";

/** A copied-language draft may be saved, but Studio refuses publication until an editor clears its review list. */
export function validateLocalizationReview(document: Readonly<Record<string, unknown>> | undefined): SchemaValidationResult {
  const review = document?.localizationReview;
  if (typeof review !== "object" || review === null || Array.isArray(review)) {
    return document?.localizedFrom === undefined ? true : "Localized drafts need a review list before publication.";
  }
  const pending = (review as { readonly pendingFields?: unknown }).pendingFields;
  if (!Array.isArray(pending)) return "Localization review must contain a pending-fields list.";
  return pending.length > 0
    ? `Review the copied source-language text before publishing: ${pending.slice(0, 5).join(", ")}${pending.length > 5 ? ` (+${pending.length - 5} more)` : ""}.`
    : true;
}

export function defineLocalizationSourceField(): SchemaFieldDefinition {
  return { name: "localizedFrom", title: "Copied from language", type: "string", readOnly: true };
}

export function defineLocalizationReviewField(): SchemaFieldDefinition {
  return {
    name: "localizationReview",
    title: "Localization review",
    type: "object",
    description: "Copied source text remains an editing base. Remove each pending field only after checking its target-language wording. Studio blocks publication while any item remains.",
    fields: [
      { name: "sourceLanguage", title: "Source language", type: "string", readOnly: true },
      { name: "pendingFields", title: "Fields awaiting review", type: "array", of: [{ type: "string" }] },
      { name: "notices", title: "Related content to check", type: "array", of: [{ type: "string" }], readOnly: true },
    ],
  };
}
