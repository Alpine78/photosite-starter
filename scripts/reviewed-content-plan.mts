/** Pure validation and mutation planning for a small, explicitly reviewed CMS correction. */
import { createHash } from "node:crypto";
import { canonicalJson, publishedIdOfVersion } from "./joomla-intro-summary.mts";
import type { SeedMutation } from "./sanity-seed-http.mts";

type Document = Readonly<Record<string, unknown>>;
type Row = { readonly id: string; readonly revision: string; readonly before: Document; readonly after: Document };
export type ReviewedContentPlan = {
  readonly version: "reviewed-content-v1";
  readonly target: { readonly projectId: string; readonly dataset: string };
  readonly rows: readonly Row[];
  readonly digest: string;
};

const allowed: Readonly<Record<string, ReadonlySet<string>>> = {
  service: new Set(["pricing"]),
  article: new Set(["body", "canonicalCategory", "summary", "summaryListingOnly"]),
  homePage: new Set(["photographerIntroduction"]),
};
const record = (value: unknown): value is Document =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function reviewPlan(value: unknown): { plan: ReviewedContentPlan; mutations: readonly SeedMutation[] } {
  if (!record(value) || value.version !== "reviewed-content-v1" || !record(value.target) ||
      typeof value.target.projectId !== "string" || typeof value.target.dataset !== "string" ||
      !Array.isArray(value.rows) || value.rows.length === 0 || value.rows.length > 10 || typeof value.digest !== "string") {
    throw new Error("Malformed reviewed content plan");
  }
  const plan = value as ReviewedContentPlan;
  const { digest, ...unsigned } = plan;
  const actual = createHash("sha256").update(canonicalJson(unsigned)).digest("hex");
  if (digest !== actual) throw new Error("Reviewed content plan digest mismatch");
  const seen = new Set<string>();
  const mutations: SeedMutation[] = [];
  for (const row of plan.rows) {
    if (!record(row) || typeof row.id !== "string" || row.id.length === 0 ||
        typeof row.revision !== "string" || row.revision.length === 0 ||
        !record(row.before) || !record(row.after) || seen.has(row.id) || row.id.includes(".")) {
      throw new Error("Malformed, duplicate or non-published plan row");
    }
    seen.add(row.id);
    if (row.before._id !== row.id || row.after._id !== row.id ||
        row.before._rev !== row.revision || row.after._rev !== row.revision ||
        row.before._type !== row.after._type || typeof row.before._type !== "string") {
      throw new Error(`Identity or revision mismatch for ${row.id}`);
    }
    const allowedFields = allowed[row.before._type];
    if (allowedFields === undefined) throw new Error(`Unsupported document type for ${row.id}`);
    const changed = [...new Set([...Object.keys(row.before), ...Object.keys(row.after)])]
      .filter((key) => canonicalJson(row.before[key]) !== canonicalJson(row.after[key]));
    if (changed.length === 0 || changed.some((key) => !allowedFields.has(key))) {
      throw new Error(`Unapproved field change for ${row.id}: ${changed.join(", ")}`);
    }
    const set: Record<string, unknown> = {};
    for (const key of changed) {
      if (!Object.hasOwn(row.after, key)) throw new Error(`Field removal is not supported for ${row.id}`);
      set[key] = row.after[key];
    }
    mutations.push({ patch: { id: row.id, ifRevisionID: row.revision, set } });
  }
  return { plan, mutations };
}

export function versionConflicts(plan: ReviewedContentPlan, ids: readonly string[]): readonly string[] {
  const planned = new Set(plan.rows.map((row) => row.id));
  return ids.filter((id) => planned.has(publishedIdOfVersion(id) ?? "")).sort();
}

/** Source must match exactly; readback may differ in server-generated revision/timestamps. */
export function planState(plan: ReviewedContentPlan, documents: readonly Document[]): "before" | "after" | "unexpected" {
  const byId = new Map(documents.map((document) => [document._id, document]));
  const before = plan.rows.every((row) => canonicalJson(byId.get(row.id)) === canonicalJson(row.before));
  if (before) return "before";
  const after = plan.rows.every((row) => {
    const current = byId.get(row.id);
    if (!record(current) || current._type !== row.after._type) return false;
    const planned = Object.keys(row.after).filter((key) => key !== "_rev" && key !== "_updatedAt");
    return planned.every((key) => canonicalJson(current[key]) === canonicalJson(row.after[key]));
  });
  return after ? "after" : "unexpected";
}
