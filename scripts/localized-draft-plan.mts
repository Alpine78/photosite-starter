import { createHash, createHmac } from "node:crypto";
import { createLocalizedDraftPlan, type LocalizedDraftInput } from "../sanity/localized-draft-plan.ts";

export { LocalizedDraftPlanError, selectCurrentPlacementVersions } from "../sanity/localized-draft-plan.ts";
export type { LocalizedDraftInput, LocalizedDraftPlan } from "../sanity/localized-draft-plan.ts";

/** Backwards-compatible synchronous operator facade; IDs and ordering hashes stay unchanged. */
export function planLocalizedDraft(input: LocalizedDraftInput) {
  return createLocalizedDraftPlan(input, {
    sha256: (value) => createHash("sha256").update(value, "utf8").digest("hex"),
    hmac: (key, value) => createHmac("sha256", key).update(value, "utf8").digest("hex"),
  });
}
