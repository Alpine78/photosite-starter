import { describe, expect, it } from "vitest";
import { adoptionFixture } from "./article-end-adoption-fixture.mts";
import { planArticleEndAdoption, SECTION_CONTRACT } from "./article-end-adoption-plan.mts";
import { canonicalJson, digest } from "./identity-retirement-reconciliation.mts";
import { articleEndGallerySectionsField, readArticleEndSectionCatalog, MAX_ARTICLE_END_SECTION_HEADING_LENGTH } from "../sanity/schemas/article-end-sections";
import { MAX_GALLERY_SECTIONS, MAX_SECTION_ID_LENGTH, MAX_SECTION_SLUG_LENGTH, MAX_SECTION_LABEL_LENGTH } from "../sanity/schemas/gallery";
import { isContentEnded } from "../src/lib/content-page";

describe("offline article end-gallery first adoption", () => {
  it("plans only catalog/heading and visible membership, with advisory unchanged closure and exact schema parity", () => {
    const f = adoptionFixture(), input = f.input(), original = structuredClone(f.documents), p = planArticleEndAdoption(input);
    expect(p.writable).toBe(false); expect(p.approved).toBe(false); expect(p.backup).toBe(false);
    expect(p.snapshotCompletenessVerified).toBe(false); expect(p.sourceAuthenticityVerified).toBe(false);
    expect(p.counts).toMatchObject({ visible: 2, hidden: 1, changes: 3, readConditions: 9 });
    expect(p.counts.sections.map(s => s.members)).toEqual([1, 1, 0]);
    expect(p.changes.map(c => c.documentId)).toEqual(["article-fi", "placement-a", "placement-b"]);
    expect(p.changes[0].beforeFields).toEqual({ endGallerySectionHeading: { exists: false }, endGallerySections: { exists: false } });
    expect(Object.keys(p.changes[1].afterFields)).toEqual(["sectionId"]);
    expect(p.readConditions.find(c => c.documentId === "placement-hidden")?.advisory).toBe(true);
    expect(p.readConditions.find(c => c.documentId === "media-one")?.advisory).toBe(true);
    expect(f.documents).toEqual(original);
    expect(SECTION_CONTRACT).toEqual({ sections: MAX_GALLERY_SECTIONS, id: MAX_SECTION_ID_LENGTH, slug: MAX_SECTION_SLUG_LENGTH, label: MAX_SECTION_LABEL_LENGTH, heading: MAX_ARTICLE_END_SECTION_HEADING_LENGTH });
    expect(p.catalog.map(section => section._type)).toEqual(
      p.catalog.map(() => articleEndGallerySectionsField.of?.[0]?.type),
    );
    expect(readArticleEndSectionCatalog({ endGalleryId: f.manifest.article.endGalleryId, ...p.changes[0].afterFields })).toEqual(
      p.catalog.map(section => ({ _key: section._key, sectionId: section.sectionId, slug: section.slug, label: section.label })),
    );
  });
  it("binds raw snapshot bytes while canonicalizing manifest keys/member ordering and keeping catalog order", () => {
    const f = adoptionFixture(), first = f.input(), p = planArticleEndAdoption(first);
    const reversed = Object.fromEntries(Object.entries(f.manifest).reverse());
    reversed.members = [...f.manifest.members].reverse();
    expect(planArticleEndAdoption({ ...first, manifest: Buffer.from(JSON.stringify(reversed)) })).toEqual(p);
    expect(planArticleEndAdoption(first)).toEqual(p);
    const { planSha256, ...body } = p; expect(planSha256).toBe(digest(Buffer.from(canonicalJson(body))));
    const changed = { ...first, snapshot: Buffer.concat([first.snapshot, Buffer.from("\n")]) };
    expect(() => planArticleEndAdoption(changed)).toThrow();
  });
  it("changes digest when supplied evidence, revisions, preserved content or classification change", () => {
    for (const change of [
      (f: ReturnType<typeof adoptionFixture>) => { f.manifest.sourceEvidenceSha256 = "a".repeat(64); },
      (f: ReturnType<typeof adoptionFixture>) => { f.documents[0]._rev = "new"; f.manifest.article.expectedRevision = "new"; },
      (f: ReturnType<typeof adoptionFixture>) => { f.documents[2].captionOverride = "Updated supplied text"; },
      (f: ReturnType<typeof adoptionFixture>) => { f.manifest.members[0].sectionId = "texture"; },
    ]) {
      const f = adoptionFixture(), before = planArticleEndAdoption(f.input()); change(f);
      expect(planArticleEndAdoption(f.input()).planSha256).not.toBe(before.planSha256);
    }
  });
  it("refuses valid same-count raw bytes changed without rebinding the snapshot digest", () => {
    const f = adoptionFixture(), input = f.input();
    for (const source of [
      input.snapshot.toString().replace("Unchanged prose", "Changed prose"),
      input.snapshot.toString().replace("\n", "\r\n"),
    ]) {
      expect(() => planArticleEndAdoption({ ...input, snapshot: Buffer.from(source) })).toThrow("SNAPSHOT_PIN_MISMATCH");
    }
  });
  it.each([
    ["unknown section", "INVALID_MEMBER_BINDING", (f: ReturnType<typeof adoptionFixture>) => { f.manifest.members[0].sectionId = "missing"; }],
    ["foreign article content", "ARTICLE_BINDING_MISMATCH", (f: ReturnType<typeof adoptionFixture>) => { f.manifest.article.contentId = "other"; }],
    ["foreign article language", "ARTICLE_BINDING_MISMATCH", (f: ReturnType<typeof adoptionFixture>) => { f.manifest.article.language = "sv"; }],
    ["foreign end gallery", "ARTICLE_BINDING_MISMATCH", (f: ReturnType<typeof adoptionFixture>) => { f.manifest.article.endGalleryId = "other"; }],
    ["invalid observation time", "INVALID_OBSERVATION_TIME", (f: ReturnType<typeof adoptionFixture>) => { f.manifest.snapshot.observedAt = "invalid"; }],
    ["noncanonical observation time", "INVALID_OBSERVATION_TIME", (f: ReturnType<typeof adoptionFixture>) => { f.manifest.snapshot.observedAt = "2026-01-01T00:00:00Z"; }],
    ["oversized catalog", "INVALID_CATALOG", (f: ReturnType<typeof adoptionFixture>) => { f.manifest.sections = Array.from({ length: 21 }, (_, i) => ({ sectionId: `theme-${i}`, slug: `theme-${i}`, label: `Theme ${i}` })); }],
    ["duplicate own placement", "DUPLICATE_PLACEMENT_IDENTITY", (f: ReturnType<typeof adoptionFixture>) => { f.documents.push({ ...f.documents[2], _id: "duplicate-own" }); }],
  ] as const)("refuses %s independently of malformed raw data", (_, code, mutate) => {
    const f = adoptionFixture(); mutate(f);
    expect(() => planArticleEndAdoption(f.input())).toThrow(code);
  });
  it.each([null, [], "", false])("refuses existing catalog/membership state even when apparently empty: %j", value => {
    for (const [index, key] of [[0, "endGallerySections"], [0, "endGallerySectionHeading"], [1, "endGallerySections"], [4, "sectionId"], [5, "sectionId"]] as const) {
      const f = adoptionFixture(); f.documents[index][key] = value;
      expect(() => planArticleEndAdoption(f.input())).toThrow(/EXISTING_/);
    }
  });
  it.each([0, 2, 4, 6, 7, 8])("refuses draft/release counterparts anywhere in the referenced closure: %s", index => {
    for (const prefix of ["drafts.", "versions.release."]) {
      const f = adoptionFixture(); f.documents.push({ ...f.documents[index], _id: prefix + f.documents[index]._id });
      expect(() => planArticleEndAdoption(f.input())).toThrow(/CONFLICT|IDENTITY/);
    }
  });
  it("refuses draft article references and foreign documents occupying target identities", () => {
    const f = adoptionFixture(); f.documents[2].article = { _type: "reference", _ref: "drafts.article-fi" };
    expect(() => planArticleEndAdoption(f.input())).toThrow("UNPUBLISHED_REFERENCE");
    for (const added of [
      { _id: "foreign", _rev: "x", _type: "galleryPlacement", placementId: "occurrence-a" },
      { _id: "foreign", _rev: "x", _type: "gallery", contentId: "image-notes" },
      { _id: "foreign", _rev: "x", _type: "video", mediaId: "photograph-one" },
    ]) {
      const f = adoptionFixture(); f.documents.push(added);
      expect(() => planArticleEndAdoption(f.input())).toThrow(/FOREIGN/);
    }
  });
  it("refuses duplicate raw IDs, per-locale identities, placements and source occurrences", () => {
    const mutations = [
      (f: ReturnType<typeof adoptionFixture>) => f.documents.push({ ...f.documents[2] }),
      (f: ReturnType<typeof adoptionFixture>) => f.documents.push({ ...f.documents[0], _id: "duplicate-article" }),
      (f: ReturnType<typeof adoptionFixture>) => f.documents.push({ ...f.documents[5], _id: "duplicate-peer-placement" }),
      (f: ReturnType<typeof adoptionFixture>) => { f.manifest.members[1].sourceItemId = f.manifest.members[0].sourceItemId; },
      (f: ReturnType<typeof adoptionFixture>) => { f.manifest.members[1].documentId = f.manifest.members[0].documentId; },
    ];
    for (const mutate of mutations) { const f = adoptionFixture(); mutate(f); expect(() => planArticleEndAdoption(f.input())).toThrow(); }
  });
  it.each(["expectedRevision", "mediaRevision", "mediaDocumentId", "mediaId", "assetRef", "placementId"])("refuses wrong explicit member binding %s", key => {
    const f = adoptionFixture(); f.manifest.members[0][key as keyof typeof f.manifest.members[0]] = "different";
    expect(() => planArticleEndAdoption(f.input())).toThrow(/MISMATCH/);
  });
  it("requires exactly all visible occurrences while allowing same media reused and absent visible excluded", () => {
    const f = adoptionFixture(); f.manifest.members.pop(); expect(() => planArticleEndAdoption(f.input())).toThrow("VISIBLE_MEMBERSHIP_MISMATCH");
    const g = adoptionFixture(); delete g.documents[4].visible; expect(planArticleEndAdoption(g.input()).counts.hidden).toBe(1);
    const h = adoptionFixture(); h.documents[4].visible = true; expect(() => planArticleEndAdoption(h.input())).toThrow("VISIBLE_MEMBERSHIP_MISMATCH");
  });
  it.each([true, "false", 0])("refuses visible private or malformed-publicity media (%j)", value => {
    const f = adoptionFixture(); f.documents[6].privateOnly = value;
    expect(() => planArticleEndAdoption(f.input())).toThrow("NONPUBLIC_VISIBLE_MEDIA");
  });
  it.each([undefined, null, false])("matches the public privateOnly absent/null/false predicate (%j)", value => {
    const f = adoptionFixture(); if (value !== undefined) f.documents[6].privateOnly = value;
    expect(planArticleEndAdoption(f.input()).counts.visible).toBe(2);
  });
  it("refuses nonpublic media, expired article and unresolved unchanged-body references", () => {
    const f = adoptionFixture(); f.documents[6].publiclyRenderable = false; expect(() => planArticleEndAdoption(f.input())).toThrow("NONPUBLIC_VISIBLE_MEDIA");
    const g = adoptionFixture(); g.documents[0].endDate = "2025-12-01T00:00:00Z"; expect(() => planArticleEndAdoption(g.input())).toThrow("ARTICLE_NOT_PUBLIC_AT_OBSERVATION");
    const h = adoptionFixture(); h.documents.pop(); expect(() => planArticleEndAdoption(h.input())).toThrow("MISSING_OR_FOREIGN_DOCUMENT");
  });
  it.each([undefined, null, "2027-01-01", "2027-01-01T00:00:00.000Z", "2025-12-01", "2026-01-01T00:00:00.000Z", "2026-02-30", "invalid"])("matches public article expiry at the supplied observation time: %s", endDate => {
    const f = adoptionFixture(); if (endDate !== undefined) f.documents[0].endDate = endDate;
    let publicResult = false;
    try { publicResult = !isContentEnded(endDate ?? undefined, new Date(f.manifest.snapshot.observedAt)); } catch { /* malformed input is refused */ }
    if (publicResult) expect(planArticleEndAdoption(f.input()).counts.visible).toBe(2);
    else expect(() => planArticleEndAdoption(f.input())).toThrow("ARTICLE_NOT_PUBLIC_AT_OBSERVATION");
  });
  it("checks snapshot pins and expected article revision before planning", () => {
    const f = adoptionFixture(), input = f.input(); f.manifest.snapshot.documentCount++; input.manifest = Buffer.from(JSON.stringify(f.manifest)); expect(() => planArticleEndAdoption(input)).toThrow("SNAPSHOT_PIN_MISMATCH");
    const g = adoptionFixture(); g.documents[0]._rev = "changed"; expect(() => planArticleEndAdoption(g.input())).toThrow("ARTICLE_BINDING_MISMATCH");
  });
  it("rejects invalid catalogs, unknown fields, Unicode/number poison and duplicate decoded JSON keys without source snippets", () => {
    const changes = [
      (f: ReturnType<typeof adoptionFixture>) => { f.manifest.sections[1].slug = f.manifest.sections[0].slug; },
      (f: ReturnType<typeof adoptionFixture>) => { f.manifest.sections[0].slug = "all"; },
      (f: ReturnType<typeof adoptionFixture>) => { f.manifest.heading = "x".repeat(161); },
      (f: ReturnType<typeof adoptionFixture>) => { f.manifest.sections[0].label = "\ud800"; },
    ];
    for (const change of changes) { const f = adoptionFixture(); change(f); expect(() => planArticleEndAdoption(f.input())).toThrow(); }
    for (const extra of ['"__proto__":{"polluted":true},', '"constructor":"secret",', '"format":"repeat",']) {
      const f = adoptionFixture(), input = f.input(); input.manifest = Buffer.from(input.manifest.toString().replace('{', '{' + extra));
      expect(() => planArticleEndAdoption(input)).toThrow();
    }
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
    const f = adoptionFixture(), input = f.input();
    for (const replacement of ["-0", "9007199254740992", "1e999"]) {
      expect(() => planArticleEndAdoption({ ...input, manifest: Buffer.from(input.manifest.toString().replace('"documentCount":9', '"documentCount":' + replacement)) })).toThrow();
    }
    expect(() => planArticleEndAdoption({ ...input, manifest: Buffer.from('{"private":"SECRET malformed') })).toThrow("INVALID_JSON");
    expect(() => planArticleEndAdoption({ ...input, snapshot: Buffer.from([0xff]) })).toThrow("INVALID_UTF8");
  });
});
