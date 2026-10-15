import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "./joomla-intro-summary.mts";
import { planState, reviewPlan, versionConflicts } from "./reviewed-content-plan.mts";
import { parseArguments } from "./write-reviewed-content-plan.mts";

const before = { _id: "sample-service", _rev: "rev-1", _type: "service", pricing: [{ label: "General", price: "100" }, { label: "Specific", price: "120" }], startingPrice: "100" };
const after = { ...before, pricing: [{ label: "Specific", price: "120" }] };

function fixture(rows = [{ id: before._id, revision: before._rev, before, after }]) {
  const unsigned = { version: "reviewed-content-v1", target: { projectId: "example", dataset: "production" }, rows };
  const digest = createHash("sha256").update(canonicalJson(unsigned)).digest("hex");
  return { ...unsigned, digest };
}

describe("reviewed CMS content plan", () => {
  it("allows only approved field changes and produces a revision-guarded patch", () => {
    const { plan, mutations } = reviewPlan(fixture());
    expect(mutations).toEqual([{ patch: { id: "sample-service", ifRevisionID: "rev-1", set: { pricing: after.pricing } } }]);
    expect(planState(plan, [before])).toBe("before");
    expect(planState(plan, [{ ...after, _rev: "rev-2", _updatedAt: "later" }])).toBe("after");
    expect(planState(plan, [{ ...before, _rev: "rev-2" }])).toBe("unexpected");
    expect(versionConflicts(plan, ["sample-service", "drafts.sample-service", "versions.release.sample-service"])).toEqual([
      "drafts.sample-service", "versions.release.sample-service",
    ]);
  });

  it("rejects edited digests, identity changes, unrelated prices and duplicate rows", () => {
    expect(() => reviewPlan({ ...fixture(), digest: "0".repeat(64) })).toThrow(/digest/);
    expect(() => reviewPlan(fixture([{ id: before._id, revision: "wrong", before, after }]))).toThrow(/revision/);
    expect(() => reviewPlan(fixture([{ id: before._id, revision: before._rev, before, after: { ...after, startingPrice: "120" } }]))).toThrow(/Unapproved field/);
    expect(() => reviewPlan(fixture([fixture().rows[0], fixture().rows[0]]))).toThrow(/duplicate/);
  });

  it("defaults to dry run and requires explicit digest and recovery directory to write", () => {
    expect(parseArguments(["--plan", "/tmp/plan.json"])).toEqual({ planPath: "/tmp/plan.json", apply: false });
    expect(() => parseArguments(["--plan", "/tmp/plan.json", "--yes"])).toThrow(/requires/);
  });
});
