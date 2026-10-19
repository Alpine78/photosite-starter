import { describe, expect, it } from "vitest";
import { adoptionFixture } from "./article-end-adoption-fixture.mts";
import { ADOPTION_LIMITS, AdoptionPlanError, planArticleEndAdoption } from "./article-end-adoption-plan.mts";
import { revalidateArticleEndAdoption } from "./article-end-adoption-revalidation.mts";
import { canonicalJson, digest } from "./identity-retirement-reconciliation.mts";

type Fixture = ReturnType<typeof adoptionFixture>;
function pair(prepare?: (fixture: Fixture) => void) {
  const fixture = adoptionFixture(); prepare?.(fixture);
  const baseline = fixture.input(), baselineDigest = planArticleEndAdoption(baseline).planSha256;
  return { fixture, input: () => ({ baseline, baselineDigest, current: fixture.input() }) };
}
const unrelated = () => ({ _id: "unrelated-note", _type: "note", _rev: "u1", text: "Other content" });

describe("offline adoption proposal revalidation", () => {
  it("preserves inputs and the complete embedded plan while binding deterministic evidence", () => {
    const input = pair().input(), bytes = [input.baseline.manifest, input.baseline.snapshot, input.current.manifest, input.current.snapshot];
    const before = bytes.map(value => Buffer.from(value));
    const evidence = revalidateArticleEndAdoption(input);
    expect(evidence).toMatchObject({ writable: false, approved: false, backup: false, preWriteOnly: true,
      scopeUnchanged: true, captureCompletenessVerified: false, sourceAuthenticityVerified: false,
      freshnessVerified: false, executionAtomicityVerified: false });
    expect(evidence.plan).toEqual(planArticleEndAdoption(input.current));
    expect(evidence.baselinePlanSha256).toBe(input.baselineDigest);
    expect(evidence.currentPlanSha256).toBe(evidence.plan.planSha256);
    expect(revalidateArticleEndAdoption(input)).toEqual(evidence);
    const { evidenceSha256, ...body } = evidence;
    expect(evidenceSha256).toBe(digest(Buffer.from(canonicalJson(body))));
    expect(bytes).toEqual(before);
    // These are the public evidence input fields whose comparison policy must
    // be reconsidered deliberately if the parent format changes.
    expect(Object.keys(evidence.plan.inputs).sort()).toEqual([
      "manifestSha256", "observedAt", "snapshotDocumentCount", "snapshotSha256", "sourceEvidenceSha256",
    ]);
  });
  it.each(["add", "edit", "remove"] as const)("accepts an %s outside the entire scoped proposal", operation => {
    const p = pair(f => { if (operation !== "add") f.documents.push(unrelated()); });
    if (operation === "add") p.fixture.documents.push(unrelated());
    else if (operation === "remove") p.fixture.documents.pop();
    else Object.assign(p.fixture.documents.at(-1)!, { _rev: "u2", text: "Updated elsewhere" });
    p.fixture.manifest.snapshot.observedAt = "2026-01-01T01:00:00.000Z";
    const input = p.input(), result = revalidateArticleEndAdoption(input);
    expect(result.scopeUnchanged).toBe(true);
    expect(result.plan.counts).toMatchObject({ changes: 3, readConditions: 9 });
    expect(result.plan.inputs.snapshotSha256).not.toBe(planArticleEndAdoption(input.baseline).inputs.snapshotSha256);
  });
  it("accepts correctly repinned raw/key/member ordering without changing catalog or occurrence order", () => {
    const p = pair(); p.fixture.documents.reverse(); p.fixture.manifest.members.reverse();
    const input = p.input();
    input.current.manifest = Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(input.current.manifest.toString())).reverse())));
    expect(revalidateArticleEndAdoption(input).plan.changes.map(change => change.documentId))
      .toEqual(["article-fi", "placement-a", "placement-b"]);
  });
  it.each(["", "A".repeat(64), "g".repeat(64), "f".repeat(63), undefined, 0])("refuses invalid baseline digest %j", value => {
    expect(() => revalidateArticleEndAdoption({ ...pair().input(), baselineDigest: value }))
      .toThrow("INVALID_BASELINE_PLAN_DIGEST");
  });
  it("requires the actual baseline digest and distinguishes invalid sides with static codes", () => {
    const input = pair().input();
    expect(() => revalidateArticleEndAdoption({ ...input, baselineDigest: "0".repeat(64) }))
      .toThrow("BASELINE_PLAN_DIGEST_MISMATCH");
    expect(() => revalidateArticleEndAdoption({ ...input, baseline: { ...input.baseline, manifest: Buffer.from("PRIVATE invalid") } }))
      .toThrow("BASELINE_PLAN_INVALID");
    expect(() => revalidateArticleEndAdoption({ ...input, current: { ...input.current, manifest: Buffer.from("PRIVATE invalid") } }))
      .toThrow("CURRENT_PLAN_INVALID");
  });
  it("allows equal observation instants but refuses a regressing supplied instant", () => {
    const p = pair(); expect(revalidateArticleEndAdoption(p.input()).scopeUnchanged).toBe(true);
    p.fixture.manifest.snapshot.observedAt = "2025-12-31T23:59:59.000Z";
    expect(() => revalidateArticleEndAdoption(p.input())).toThrow("CURRENT_CAPTURE_PRECEDES_BASELINE");
  });
  it.each([
    ["format", (f: Fixture) => { f.manifest.format = "other"; }],
    ["source evidence", (f: Fixture) => { f.manifest.sourceEvidenceSha256 = "a".repeat(64); }],
    ["heading", (f: Fixture) => { f.manifest.heading = "Other supplied copy"; }],
    ["article document", (f: Fixture) => { f.manifest.article.documentId = "other"; }],
    ["article revision", (f: Fixture) => { f.manifest.article.expectedRevision = "other"; }],
    ["content identity", (f: Fixture) => { f.manifest.article.contentId = "other"; }],
    ["language", (f: Fixture) => { f.manifest.article.language = "sv"; }],
    ["end-gallery identity", (f: Fixture) => { f.manifest.article.endGalleryId = "other"; }],
    ["section identity", (f: Fixture) => { f.manifest.sections[0].sectionId = "other"; }],
    ["section slug", (f: Fixture) => { f.manifest.sections[0].slug = "other"; }],
    ["section label", (f: Fixture) => { f.manifest.sections[0].label = "Other label"; }],
    ["catalog order", (f: Fixture) => { f.manifest.sections.reverse(); }],
    ["source occurrence", (f: Fixture) => { f.manifest.members[0].sourceItemId = "other"; }],
    ["source image bytes", (f: Fixture) => { f.manifest.members[0].sourceImageSha256 = "a".repeat(64); }],
    ["placement document", (f: Fixture) => { f.manifest.members[0].documentId = "other"; }],
    ["placement revision", (f: Fixture) => { f.manifest.members[0].expectedRevision = "other"; }],
    ["placement identity", (f: Fixture) => { f.manifest.members[0].placementId = "other"; }],
    ["media document", (f: Fixture) => { f.manifest.members[0].mediaDocumentId = "other"; }],
    ["media revision", (f: Fixture) => { f.manifest.members[0].mediaRevision = "other"; }],
    ["media identity", (f: Fixture) => { f.manifest.members[0].mediaId = "other"; }],
    ["asset reference", (f: Fixture) => { f.manifest.members[0].assetRef = "other"; }],
    ["classification", (f: Fixture) => { f.manifest.members[0].sectionId = "texture"; }],
  ] as const)("does not silently accept a changed semantic manifest field: %s", (_, mutate) => {
    const p = pair(); mutate(p.fixture);
    expect(() => revalidateArticleEndAdoption(p.input())).toThrow(AdoptionPlanError);
  });
  it.each([
    ["advisory content", (f: Fixture) => { f.documents[8].title = "Changed category"; }],
    ["advisory revision", (f: Fixture) => { f.documents[8]._rev = "changed"; }],
    ["hidden content", (f: Fixture) => { f.documents[4].captionOverride = "Changed caption"; }],
    ["otherwise unrelated article text", (f: Fixture) => { f.documents[0].body = []; }],
    ["rebased article revision", (f: Fixture) => { f.documents[0]._rev = "changed"; f.manifest.article.expectedRevision = "changed"; }],
    ["new hidden member", (f: Fixture) => { f.documents.push({ ...f.documents[4], _id: "new-hidden", placementId: "new-occurrence", order: 3 }); }],
    ["new no-catalog peer", (f: Fixture) => { f.documents.push({ ...f.documents[1], _id: "article-sv", language: "sv" }); }],
    ["consistent new section identity", (f: Fixture) => { f.manifest.sections[0].sectionId = "other"; f.manifest.members[0].sectionId = "other"; }],
  ] as const)("refuses an otherwise plannable scoped change: %s", (_, mutate) => {
    const p = pair(); mutate(p.fixture);
    expect(() => revalidateArticleEndAdoption(p.input())).toThrow("ADOPTION_SCOPE_CHANGED");
  });
  it("binds expiry value through the article's full hash and refuses time-only expiry", () => {
    const p = pair(f => { f.documents[0].endDate = "2026-01-02T00:00:00.000Z"; });
    p.fixture.documents[0].endDate = "2027-01-02T00:00:00.000Z";
    expect(() => revalidateArticleEndAdoption(p.input())).toThrow("ADOPTION_SCOPE_CHANGED");
    const q = pair(f => { f.documents[0].endDate = "2026-01-02T00:00:00.000Z"; });
    q.fixture.manifest.snapshot.observedAt = "2026-01-03T00:00:00.000Z";
    expect(() => revalidateArticleEndAdoption(q.input())).toThrow("CURRENT_PLAN_INVALID");
  });
  it.each(["drafts.", "versions.release."])("retains first-adoption variant refusals (%s)", prefix => {
    const p = pair(); p.fixture.documents.push({ ...p.fixture.documents[7], _id: prefix + p.fixture.documents[7]._id });
    expect(() => revalidateArticleEndAdoption(p.input())).toThrow("CURRENT_PLAN_INVALID");
  });
  it("refuses missing references, wrong raw pins and already applied adoption state", () => {
    const p = pair(); p.fixture.documents.pop();
    expect(() => revalidateArticleEndAdoption(p.input())).toThrow("CURRENT_PLAN_INVALID");
    const input = pair().input(); input.current.snapshot = Buffer.from(input.current.snapshot.toString().replace("Unchanged prose", "Changed prose"));
    expect(() => revalidateArticleEndAdoption(input)).toThrow("CURRENT_PLAN_INVALID");
    const q = pair(); q.fixture.documents[0].endGallerySections = [];
    expect(() => revalidateArticleEndAdoption(q.input())).toThrow("CURRENT_PLAN_INVALID");
  });
  it("enforces the output cap including the wrapper while the embedded plans fit", () => {
    const input = pair().input(), limit = ADOPTION_LIMITS.reportBytes;
    const planBytes = Buffer.byteLength(canonicalJson(planArticleEndAdoption(input.current)));
    try {
      ADOPTION_LIMITS.reportBytes = planBytes + 1;
      expect(() => revalidateArticleEndAdoption(input)).toThrow("REVALIDATION_OUTPUT_LIMIT");
    } finally { ADOPTION_LIMITS.reportBytes = limit; }
  });
});
