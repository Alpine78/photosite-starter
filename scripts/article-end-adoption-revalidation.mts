/** AB#369: compare two supplied pre-write captures; no CMS or approval transport. */
import { ADOPTION_LIMITS, AdoptionPlanError, planArticleEndAdoption } from "./article-end-adoption-plan.mts";
import { canonicalJson, digest } from "./identity-retirement-reconciliation.mts";

type PlannerInput = Parameters<typeof planArticleEndAdoption>[0];
type Plan = ReturnType<typeof planArticleEndAdoption>;
const captureFields = new Set(["snapshotSha256", "snapshotDocumentCount", "observedAt", "manifestSha256"]);

export function validateAdoptionBaselineDigest(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new AdoptionPlanError("INVALID_BASELINE_PLAN_DIGEST");
  }
  return value;
}

function checkedPlan(input: PlannerInput, side: "baseline" | "current"): Plan {
  try {
    return planArticleEndAdoption(input);
  } catch (error) {
    if (error instanceof AdoptionPlanError) {
      throw new AdoptionPlanError(side === "baseline" ? "BASELINE_PLAN_INVALID" : "CURRENT_PLAN_INVALID");
    }
    throw error;
  }
}

function scopeOf(plan: Plan) {
  return {
    ...Object.fromEntries(Object.entries(plan).filter(([key]) => key !== "inputs" && key !== "planSha256")),
    inputs: Object.fromEntries(Object.entries(plan.inputs).filter(([key]) => !captureFields.has(key))),
  };
}

export function revalidateArticleEndAdoption(input: {
  baseline: PlannerInput;
  baselineDigest: unknown;
  current: PlannerInput;
}) {
  const expected = validateAdoptionBaselineDigest(input.baselineDigest);
  const baseline = checkedPlan(input.baseline, "baseline");
  if (baseline.planSha256 !== expected) throw new AdoptionPlanError("BASELINE_PLAN_DIGEST_MISMATCH");
  const current = checkedPlan(input.current, "current");
  if (Date.parse(current.inputs.observedAt) < Date.parse(baseline.inputs.observedAt)) {
    throw new AdoptionPlanError("CURRENT_CAPTURE_PRECEDES_BASELINE");
  }
  if (canonicalJson(scopeOf(baseline)) !== canonicalJson(scopeOf(current))) {
    throw new AdoptionPlanError("ADOPTION_SCOPE_CHANGED");
  }
  const report = {
    format: "article-end-adoption-revalidation-v1",
    writable: false, approved: false, backup: false, preWriteOnly: true,
    captureCompletenessVerified: false, sourceAuthenticityVerified: false,
    freshnessVerified: false, executionAtomicityVerified: false,
    baselinePlanSha256: baseline.planSha256, currentPlanSha256: current.planSha256,
    scopeUnchanged: true, plan: current,
    limitations: [
      "Two supplied captures agree on the scoped proposal; no live CMS state, capture completeness, authenticity or recency is established.",
      "The baseline digest is an explicit anchor, not owner approval. No revisions, classifications, copy or caller inputs were rebased.",
      "Pre-write only: existing adoption state is refused. This is not a post-apply verifier, writer, backup or transaction guard.",
      "Any touch to a scoped record, including an advisory record, refuses. Only records outside the scoped proposal may differ.",
      "Execution still needs a live recheck, an approved writer and separate concrete content approval.",
    ],
  };
  const result = { ...report, evidenceSha256: digest(Buffer.from(canonicalJson(report))) };
  if (Buffer.byteLength(canonicalJson(result)) > ADOPTION_LIMITS.reportBytes) {
    throw new AdoptionPlanError("REVALIDATION_OUTPUT_LIMIT");
  }
  return result;
}
