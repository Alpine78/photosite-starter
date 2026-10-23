import type { SchemaTypeDefinition } from "./schema-types";

/**
 * Private proof records the site writes (ADR-0038 decisions 3, 5 and 6, AB#130):
 * an immutable confirmed selection and the photographer's notice for it. They
 * live on dotted private IDs, readable only by signed-in editors, and Studio
 * shows them read-only so a failed notice can still be acted on from the
 * confirmed version. Nothing here is created, edited or resent in Studio
 * (owner answer 2).
 */
export const CLIENT_PROOF_RECORD_TYPES = ["clientProofSelectionVersion", "clientProofNotice"] as const;

export const clientProofSelectionVersionType: SchemaTypeDefinition = {
  name: "clientProofSelectionVersion", title: "Confirmed proof selection", type: "document",
  description: "Written by the site when a customer confirms. Read-only and never changed.",
  fields: [
    { name: "galleryId", title: "Proof gallery document", type: "string", readOnly: true },
    { name: "version", title: "Version", type: "number", readOnly: true },
    { name: "confirmedAt", title: "Confirmed (UTC)", type: "datetime", readOnly: true },
    { name: "galleryRevision", title: "Gallery revision confirmed against", type: "string", readOnly: true },
    { name: "terms", title: "Terms at confirmation", type: "object", readOnly: true, fields: [
      { name: "jobReference", title: "Job reference", type: "string", readOnly: true },
      { name: "includedCount", title: "Images included in the price", type: "number", readOnly: true },
      { name: "extraUnitPriceMinor", title: "Additional image price in minor units", type: "number", readOnly: true },
      { name: "currency", title: "Currency", type: "string", readOnly: true },
    ] },
    { name: "totals", title: "Totals", type: "object", readOnly: true, fields: [
      { name: "selected", title: "Selected", type: "number", readOnly: true },
      { name: "extra", title: "Additional", type: "number", readOnly: true },
      { name: "extraTotalMinor", title: "Additional total in minor units", type: "number", readOnly: true },
    ] },
    { name: "items", title: "Selected proofs", type: "array", readOnly: true, of: [{ type: "object", fields: [
      { name: "reference", title: "Proof number", type: "string", readOnly: true },
      { name: "originalFilename", title: "Complete original filename", type: "string", readOnly: true },
    ] }] },
  ],
  preview: { select: { title: "terms.jobReference", subtitle: "confirmedAt" } },
};

export const clientProofNoticeType: SchemaTypeDefinition = {
  name: "clientProofNotice", title: "Proof selection notice", type: "document",
  description: "The photographer's email for one confirmed version. Pending for more than a few minutes or failed means the email may not have arrived: open the confirmed selection.",
  fields: [
    { name: "state", title: "Email state", type: "string", readOnly: true,
      options: { list: [{ title: "Pending", value: "pending" }, { title: "Sent", value: "sent" }, { title: "Failed", value: "failed" }] } },
    { name: "selection", title: "Confirmed selection", type: "reference", to: [{ type: "clientProofSelectionVersion" }], weak: true, readOnly: true },
    { name: "galleryId", title: "Proof gallery document", type: "string", readOnly: true },
    { name: "version", title: "Version", type: "number", readOnly: true },
    { name: "createdAt", title: "Created (UTC)", type: "datetime", readOnly: true },
    { name: "attemptedAt", title: "Email attempted (UTC)", type: "datetime", readOnly: true },
    { name: "errorClass", title: "Failure class", type: "string", readOnly: true },
  ],
  preview: { select: { title: "galleryId", subtitle: "state" } },
};
