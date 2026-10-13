import { describe, expect, it } from "vitest";
import { canonicalJson } from "./joomla-intro-summary.mts";
import { compilePublicationPlan, contentDigest, reconcilePublication, requireRecoveryEvidence, restoreRevision, sha256, singleCurrentDocument, smokeMutation, validatePublicationPlan } from "./publication-smoke-plan.mts";
import { runPublicationSmoke } from "./publication-smoke-run.mts";

const target = { projectId: "synthetic-project", dataset: "production", apiVersion: "v2026-03-01" };
const nonce = "11111111-1111-4111-8111-111111111111";
const source = () => ({ _id: "synthetic-home", _rev: "revision-before", _type: "homePage", _createdAt: "2026-01-01T00:00:00Z", _updatedAt: "2026-01-02T00:00:00Z",
  heroMedia: { _type: "reference", _ref: "synthetic-media" }, extra: { preserved: true },
  intro: [{ _type: "localizedText", _key: "fi", language: "fi", value: "Synteettinen esittely." }, { _type: "localizedText", _key: "en", language: "en", value: "Synthetic introduction." }] });
const plan = () => compilePublicationPlan(source(), target, "fi", nonce, "a".repeat(64));
const changed = () => ({ ...plan().proposed, _rev: "revision-applied", _updatedAt: "2026-02-01T00:00:00Z" });
const applied = () => ({ version: 1, phase: "apply", status: "applied", planDigest: plan().digest, observedRevision: "revision-applied", contentDigest: contentDigest(plan().proposed) });

describe("one-field publication plan and recovery guards", () => {
  it("preserves references, other fields and every unselected translation", () => {
    const p = plan(), rows = p.proposed.intro as ReturnType<typeof source>["intro"];
    expect(rows[0].value).toBe(source().intro[0].value + "\n\n" + p.marker);
    expect(rows[1]).toEqual(source().intro[1]);
    expect({ ...p.proposed, intro: p.source.intro }).toEqual(p.source);
    expect(validatePublicationPlan(JSON.parse(JSON.stringify(p)), p.digest)).toEqual(p);
  });
  it.each([
    { source: { ...source(), _id: "drafts.synthetic-home" } },
    { source: { ...source(), _id: "versions.release.synthetic-home" } },
    { source: { ...source(), _type: "article" } },
    { source: { ...source(), _rev: "bad rev" } },
    { source: { ...source(), _createdAt: "not a timestamp" } },
    { source: { ...source(), intro: [] } },
    { source: { ...source(), intro: [source().intro[0], source().intro[0]] } },
    { source: { ...source(), intro: [{ ...source().intro[0], value: " " }] } },
    { source: { ...source(), intro: [{ ...source().intro[0], value: "x".repeat(10_001) }] } },
  ])("rejects malformed or non-published source %#", ({ source: bad }) => {
    expect(() => compilePublicationPlan(bad, target, "fi", nonce, "a".repeat(64))).toThrow();
  });
  it("rejects unknown language, repeated nonce, unsafe targets and oversized JSON", () => {
    expect(() => compilePublicationPlan(source(), target, "sv", nonce, "a".repeat(64))).toThrow();
    expect(() => compilePublicationPlan({ ...source(), extra: nonce }, target, "fi", nonce, "a".repeat(64))).toThrow();
    expect(() => compilePublicationPlan(source(), { ...target, projectId: "host.invalid/" }, "fi", nonce, "a".repeat(64))).toThrow();
    expect(() => compilePublicationPlan({ ...source(), extra: "x".repeat(129 * 1024) }, target, "fi", nonce, "a".repeat(64))).toThrow();
    expect(() => compilePublicationPlan({ ...source(), intro: [{ ...source().intro[0], value: "x".repeat(9_999) }] }, target, "fi", nonce, "a".repeat(64))).toThrow();
    expect(() => compilePublicationPlan({ ...source(), extra: { toJSON() { return "hidden"; } } }, target, "fi", nonce, "a".repeat(64))).toThrow();
  });
  it("binds every plan field and its exact approved digest", () => {
    const p = plan(); expect(() => validatePublicationPlan(p, "b".repeat(64))).toThrow();
    expect(() => validatePublicationPlan({ ...p, marker: "other" })).toThrow();
    expect(() => validatePublicationPlan({ ...p, target: { ...target, dataset: "preview" } })).toThrow();
    expect(() => validatePublicationPlan({ ...p, source: { ...p.source, extra: "changed" } })).toThrow();
    expect(() => validatePublicationPlan({ ...p, extra: true })).toThrow();
    expect(() => validatePublicationPlan({ ...p, field: "photographerIntroduction.text" })).toThrow();
  });
  it("patches only the selected introduction text, preserving intro, portrait and other languages", () => {
    const doc = { ...source(), photographerIntroduction: { _type: "homePhotographerIntroduction", portrait: { _type: "reference", _ref: "synthetic-portrait" }, text: source().intro } };
    const p = compilePublicationPlan(doc, target, "fi", nonce, "a".repeat(64), "photographerIntroduction.text");
    const proposed = p.proposed as typeof doc;
    expect(p.proposed.intro).toEqual(doc.intro);
    expect(proposed.photographerIntroduction.portrait).toEqual(doc.photographerIntroduction.portrait);
    expect(proposed.photographerIntroduction.text[1]).toEqual(doc.photographerIntroduction.text[1]);
    expect(smokeMutation(p, doc, "apply").patch.set).toEqual({ "photographerIntroduction.text": proposed.photographerIntroduction.text });
    expect(smokeMutation(p, { ...p.proposed, _rev: "nested-post" }, "restore", "nested-post").patch.set).toEqual({ "photographerIntroduction.text": doc.photographerIntroduction.text });
    expect(validatePublicationPlan(p)).toEqual(p);
    expect(() => compilePublicationPlan(source(), target, "fi", nonce, "a".repeat(64), "photographerIntroduction.text")).toThrow();
    expect(() => compilePublicationPlan(doc, target, "fi", nonce, "a".repeat(64), "hero.heading" as "intro")).toThrow();
  });
  it("requires exact, complete, owner-reviewed recovery attestations", () => {
    const p = plan(), evidence = { version: 1, target, documentsComplete: true, assetsComplete: true, restoreReady: true,
      sourceDocumentSha256: sha256(canonicalJson(p.source)), documentSnapshotSha256: "b".repeat(64), assetManifestSha256: "c".repeat(64) };
    expect(() => requireRecoveryEvidence(p, evidence)).not.toThrow();
    for (const key of ["documentsComplete", "assetsComplete", "restoreReady"]) expect(() => requireRecoveryEvidence(p, { ...evidence, [key]: false })).toThrow();
    expect(() => requireRecoveryEvidence(p, { ...evidence, sourceDocumentSha256: "0".repeat(64) })).toThrow();
    expect(() => requireRecoveryEvidence(p, { ...evidence, target: { ...target, dataset: "preview" } })).toThrow();
  });
  it("refuses draft/release collisions, missing docs and unexpected identities", () => {
    for (const rows of [[], [source(), { ...source(), _id: "drafts.synthetic-home" }], [{ ...source(), _id: "other" }]]) {
      expect(() => singleCurrentDocument(plan(), rows)).toThrow();
    }
  });
  it("builds only a revision-bound intro set and refuses unrelated source changes", () => {
    const p = plan(); expect(smokeMutation(p, source(), "apply")).toEqual({ patch: { id: "synthetic-home", ifRevisionID: "revision-before", set: { intro: p.proposed.intro } } });
    expect(() => smokeMutation(p, { ...source(), extra: false }, "apply")).toThrow();
    expect(() => smokeMutation(p, { ...source(), _rev: "other" }, "apply")).toThrow();
  });
  it("restores only against the observed post-write revision, preserving a later edit", () => {
    const p = plan(), rev = restoreRevision(p, applied());
    expect(smokeMutation(p, changed(), "restore", rev).patch).toEqual({ id: "synthetic-home", ifRevisionID: "revision-applied", set: { intro: p.source.intro } });
    expect(() => smokeMutation(p, { ...changed(), _rev: "later-edit" }, "restore", rev)).toThrow();
    expect(() => smokeMutation(p, { ...changed(), extra: "later edit" }, "restore", rev)).toThrow();
    for (const r of [{ ...applied(), status: "ambiguous" }, { ...applied(), observedRevision: "revision-before" }, { ...applied(), planDigest: "b".repeat(64) }, { ...applied(), contentDigest: "c".repeat(64) }]) expect(() => restoreRevision(p, r)).toThrow();
  });
  it("readback proves only exact content/revision states", () => {
    expect(reconcilePublication(plan(), [changed()], "apply", "revision-before").status).toBe("applied");
    expect(reconcilePublication(plan(), [source()], "apply", "revision-before").status).toBe("unchanged");
    expect(reconcilePublication(plan(), [{ ...changed(), extra: "unexpected" }], "apply", "revision-before").status).toBe("unexpected");
    expect(reconcilePublication(plan(), [{ ...changed(), _rev: "revision-before" }], "apply", "revision-before").status).toBe("unexpected");
  });
});

describe("publication operator transaction sequencing", () => {
  it("persists preparation before one CAS mutation and returns unclaimed external proofs", async () => {
    const events: string[] = []; let doc: unknown = source();
    const result = await runPublicationSmoke(plan(), "apply", undefined, { read: async () => { events.push("read"); return [doc]; },
      prepare: async () => { events.push("durable"); }, mutate: async () => { events.push("patch"); doc = changed(); } });
    expect(events).toEqual(["read", "durable", "patch", "read"]);
    expect(result).toMatchObject({ status: "applied", mutationAcknowledged: true, automaticRetry: false, visibleUpdateVerified: false, genuineWebhookVerified: false, canonicalLaunchVerified: false });
  });
  it("a failed journal cannot cause a mutation", async () => {
    let writes = 0;
    await expect(runPublicationSmoke(plan(), "apply", undefined, { read: async () => [source()], prepare: async () => { throw new Error("disk failed"); }, mutate: async () => { writes++; } })).rejects.toThrow();
    expect(writes).toBe(0);
  });
  it("an uncertain committed write is read back once without retrying or exposing exceptions", async () => {
    let doc: unknown = source(), writes = 0;
    const result = await runPublicationSmoke(plan(), "apply", undefined, { read: async () => [doc], prepare: async () => {},
      mutate: async () => { writes++; doc = changed(); throw new Error("SYNTHETIC_SECRET"); } });
    expect(writes).toBe(1); expect(result).toMatchObject({ status: "applied", mutationAcknowledged: false });
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_SECRET");
  });
  it("failed readback leaves an ambiguous receipt without auto-restoration", async () => {
    let reads = 0, writes = 0;
    const result = await runPublicationSmoke(plan(), "apply", undefined, { read: async () => { if (reads++) throw new Error("read failed"); return [source()]; },
      prepare: async () => {}, mutate: async () => { writes++; } });
    expect(result.status).toBe("ambiguous"); expect(writes).toBe(1);
  });
  it("a concurrent editor after prepare defeats CAS and is never overwritten", async () => {
    let doc: unknown = source(), writes = 0;
    const result = await runPublicationSmoke(plan(), "apply", undefined, { read: async () => [doc],
      prepare: async () => { doc = { ...source(), _rev: "editor-revision", extra: "editor content" }; },
      mutate: async (patch) => { writes++; expect(patch.patch.ifRevisionID).toBe("revision-before"); throw new Error("409"); } });
    expect(result.status).toBe("unexpected"); expect(writes).toBe(1); expect(doc).toMatchObject({ extra: "editor content" });
  });
  it("restores the exact source content using the receipt's revision", async () => {
    let doc: unknown = changed();
    const result = await runPublicationSmoke(plan(), "restore", applied(), { read: async () => [doc], prepare: async () => {},
      mutate: async (patch) => { expect(patch.patch.ifRevisionID).toBe("revision-applied"); doc = { ...source(), _rev: "revision-restored" }; } });
    expect(result).toMatchObject({ status: "restored", observedRevision: "revision-restored" });
  });
});
