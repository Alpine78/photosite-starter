import { argumentsOf, readPrivateBytes, newPrivateDirectory, writePrivateBytes } from "./private-operation-files.mts";
import { planLocaleAdditions, planReviewedArticlePublication } from "./locale-publication-plan.mts";
import { parsePublicReadTarget } from "./sanity-read-http.mts";
async function main() {
  const args = argumentsOf(process.argv.slice(2), ["kind", "snapshot", "review-packet", "project", "dataset", "api-version", "out"]);
  if (!["category-services", "articles"].includes(args.kind)) throw new Error("INVALID_KIND");
  const snapshot = await readPrivateBytes(args.snapshot, 256 * 1024 * 1024), review = await readPrivateBytes(args["review-packet"], 16 * 1024 * 1024);
  const target = parsePublicReadTarget({ projectId: args.project, dataset: args.dataset, apiVersion: args["api-version"] });
  const plan = (args.kind === "articles" ? planReviewedArticlePublication : planLocaleAdditions)(snapshot, JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(review)), target);
  const folder = await newPrivateDirectory(args.out); await writePrivateBytes(folder, "plan.json", JSON.stringify(plan, null, 2) + "\n");
  console.log(JSON.stringify({ digest: plan.digest, snapshotSha256: plan.snapshotSha256, transactions: plan.transactions.length, createdDocuments: plan.transactions.reduce((n, t) => n + t.created.length, 0), deletedEditingDrafts: plan.transactions.reduce((n, t) => n + t.removedDraftIds.length, 0), cmsMutated: false, ownerApprovalRequired: true }));
}
main().catch(() => { console.error("[plan-locale-publication] Private evidence or publication prerequisites are invalid; no writable approval issued."); process.exitCode = 1; });
