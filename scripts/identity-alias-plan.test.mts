import { describe, expect, it } from "vitest";
import { createIdentityAliasResolver, IDENTITY_ALIAS_FORMAT_VERSION, MAX_IDENTITY_ALIAS_PAYLOAD_BYTES } from "@/lib/identity-aliases";
import { MAX_PUBLIC_IDENTITY_LENGTH, isPublicIdentity } from "@/lib/public-identity";
import { canonicalJson, digest } from "./identity-retirement-reconciliation.mts";
import { encode, fixture, ndjson } from "./identity-change-plan-fixture.mts";
import { ALIAS_PAYLOAD_FORMAT, ALIAS_PLAN_LIMITS, planIdentityAliases } from "./identity-alias-plan.mts";

// Independent canonical wire writer for synthetic fixtures and digest assertions.
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
const sha = (value: unknown) => digest(Buffer.from(canonical(value)));

function placementInput(rows: { field: "placementId"; newId: string; oldId: string }[]) {
  const docs = rows.map((row, i) => ({ _id: `placement-${i}`, _rev: "r1", _type: "galleryPlacement", placementId: row.oldId }));
  const baseline = ndjson(docs);
  const proposedChanges = rows.map((row, i) => ({ documentId: docs[i]._id, expectedRevision: "r1", fields: { placementId: { before: row.oldId, after: row.newId } } }));
  const map = encode({ version: "ab257-private-proposal-v1", writable: false, snapshotSha256: digest(baseline), mapping: rows, proposedChanges });
  const approval = encode({ candidateFileSha256: digest(map), snapshotFileSha256: digest(baseline), productionWriteApproved: false,
    acceptedScope: { retainSanityDocumentIds: true, retainSanityReferences: true, contentId: 0, categoryId: 0, endGalleryId: 0, placementId: rows.length, totalDomainIdentities: rows.length, documents: rows.length, fieldChanges: rows.length } });
  return { map, approval, baseline, snapshot: baseline, approvedDigest: digest(map) };
}
function payloadSizedInput(bytes: number) {
  const rows = Array.from({ length: 480 }, (_, i) => ({ field: "placementId" as const, oldId: `joomla-${i}`, newId: `image-${i}` }));
  let remaining = bytes - Buffer.byteLength(canonical({ aliases: rows, formatVersion: ALIAS_PAYLOAD_FORMAT, sourceMapSha256: "a".repeat(64) }));
  for (const row of rows) for (const key of ["oldId", "newId"] as const) {
    const padding = Math.min(remaining, 256 - row[key].length);
    row[key] += "x".repeat(padding); remaining -= padding;
  }
  expect(remaining).toBe(0);
  return placementInput(rows);
}

describe("offline canonical identity aliases", () => {
  it("pins the existing public format, grammar and actual default ceilings", () => {
    expect(ALIAS_PAYLOAD_FORMAT).toBe(IDENTITY_ALIAS_FORMAT_VERSION);
    expect(ALIAS_PLAN_LIMITS).toEqual({ identityLength: MAX_PUBLIC_IDENTITY_LENGTH, payloadBytes: MAX_IDENTITY_ALIAS_PAYLOAD_BYTES, planBytes: 1_048_576 });
    expect(ALIAS_PLAN_LIMITS.identityLength).toBe(256);
    expect(ALIAS_PLAN_LIMITS.payloadBytes).toBe(262_144);
  });

  it("projects only ordered triples, hashes canonical no-LF payload and wrapper body, and copies inputs", () => {
    const f = fixture(), input = f.makeInput(), original = { ...input, map: Buffer.from(input.map), approval: Buffer.from(input.approval), baseline: Buffer.from(input.baseline), snapshot: Buffer.from(input.snapshot) };
    const plan = planIdentityAliases(input);
    expect(plan).toEqual(planIdentityAliases(input));
    expect(input).toEqual(original);
    expect(Object.keys(plan.payload).sort()).toEqual(["aliases", "formatVersion", "sourceMapSha256"]);
    expect(plan.payload.aliases).toEqual(f.mapping);
    for (const row of plan.payload.aliases) {
      expect(Object.keys(row).sort()).toEqual(["field", "newId", "oldId"]);
      expect(isPublicIdentity(row.oldId) && isPublicIdentity(row.newId)).toBe(true);
    }
    expect(plan.familyCounts).toEqual({ contentId: 2, categoryId: 1, endGalleryId: 1, placementId: 1 });
    expect(plan.pins).toEqual({ sourceMapSha256: digest(input.map), payloadSha256: sha(plan.payload), expectedRowCount: 5 });
    expect(plan.canonicalByteCount).toBe(Buffer.byteLength(canonical(plan.payload)));
    const { planSha256, ...body } = plan;
    expect(planSha256).toBe(sha(body));
    expect(canonicalJson(plan)).toBe(canonical(plan));
    expect(canonical(plan.payload)).toMatch(/^\{"aliases":\[\{"field":"categoryId","newId":"category-trips","oldId":"joomla-category-1"\}/u);
    const extracted = JSON.parse(`${canonicalJson(plan)}\n`);
    expect(sha(extracted.payload)).toBe(extracted.pins.payloadSha256);
    expect(Buffer.byteLength(canonical(extracted.payload))).toBe(extracted.canonicalByteCount);
    expect(plan.writable).toBe(false); expect(plan.cutoverReady).toBe(false);
    expect(plan.remainingGates).toContain("supplied-snapshot-only-not-current-target-or-freeze-proof");
    expect(canonical(plan)).not.toMatch(/"(?:_id|_type|target|documentId|expectedRevision|mutations)"/u);
  });

  it.each(["renamed", "restored"] as const)("feeds exact emitted pins to the application resolver in %s mode", mode => {
    const plan = planIdentityAliases(fixture().makeInput());
    const resolve = createIdentityAliasResolver({ mode, pins: plan.pins, payload: plan.payload });
    for (const row of plan.payload.aliases) for (const id of [row.oldId, row.newId]) {
      expect(resolve(row.field, id)).toBe(mode === "renamed" ? row.newId : row.oldId);
    }
  });

  it("keeps payload pins stable when only supplied snapshot evidence changes", () => {
    const f = fixture(), input = f.makeInput(), first = planIdentityAliases(input);
    f.documents.push({ _id: "unrelated", _rev: "r1", _type: "media", mediaId: "new-media" });
    const second = planIdentityAliases({ ...input, snapshot: ndjson(f.documents) });
    expect(second.payload).toEqual(first.payload); expect(second.pins).toEqual(first.pins);
    expect(second.planSha256).not.toBe(first.planSha256);
    expect(second.digests.snapshot).not.toBe(first.digests.snapshot);
  });

  it("matches the core at exactly 256KiB and rejects one extra canonical byte", () => {
    const plan = planIdentityAliases(payloadSizedInput(262_144));
    expect(plan.canonicalByteCount).toBe(262_144);
    expect(() => createIdentityAliasResolver({ mode: "renamed", pins: plan.pins, payload: plan.payload })).not.toThrow();
    const overInput = payloadSizedInput(262_145);
    expect(() => planIdentityAliases(overInput)).toThrow("ALIAS_PAYLOAD_LIMIT");
    const overPayload = { ...plan.payload, aliases: JSON.parse(overInput.map.toString()).mapping, sourceMapSha256: digest(overInput.map) };
    expect(Buffer.byteLength(canonical(overPayload))).toBe(262_145);
    expect(() => createIdentityAliasResolver({ mode: "renamed", payload: overPayload, pins: { sourceMapSha256: overPayload.sourceMapSha256, payloadSha256: sha(overPayload), expectedRowCount: 480 } })).toThrow("payload-too-large");
  });

  it("matches the core at 256 ASCII characters and rejects 257 or invalid grammar", () => {
    const row = { field: "placementId" as const, oldId: "joomla-" + "a".repeat(249), newId: "b".repeat(256) };
    const plan = planIdentityAliases(placementInput([row]));
    expect(createIdentityAliasResolver({ mode: "renamed", payload: plan.payload, pins: plan.pins })("placementId", row.oldId)).toBe(row.newId);
    for (const id of ["b".repeat(257), "B", "b--c", "é", "b_"]) {
      expect(() => planIdentityAliases(placementInput([{ ...row, newId: id }]))).toThrow();
      const payload = { ...plan.payload, aliases: [{ ...row, newId: id }] };
      expect(() => createIdentityAliasResolver({ mode: "renamed", payload, pins: { ...plan.pins, payloadSha256: sha(payload) } })).toThrow();
    }
  });

  it("bounds payload and private wrapper independently, inclusively, with lower-only budgets", () => {
    const input = fixture().makeInput(), plan = planIdentityAliases(input);
    const planBytes = Buffer.byteLength(canonical(plan)) + 1;
    expect(planIdentityAliases(input, { payloadBytes: plan.canonicalByteCount, planBytes })).toEqual(plan);
    expect(() => planIdentityAliases(input, { payloadBytes: plan.canonicalByteCount - 1 })).toThrow("ALIAS_PAYLOAD_LIMIT");
    expect(() => planIdentityAliases(input, { planBytes: planBytes - 1 })).toThrow("ALIAS_PLAN_OUTPUT_LIMIT");
    for (const key of ["payloadBytes", "planBytes"] as const) for (const n of [0, -1, 1.5, NaN, Infinity, ALIAS_PLAN_LIMITS[key] + 1]) {
      expect(() => planIdentityAliases(input, { [key]: n })).toThrow("INVALID_ALIAS_LIMIT");
    }
  });

  it("fails the strict path on byte or receipt drift, duplicate keys, bad UTF8 and approval counts", () => {
    const input = fixture().makeInput();
    expect(() => planIdentityAliases({ ...input, map: Buffer.concat([input.map, Buffer.from(" ")]) })).toThrow("MAP_DIGEST_MISMATCH");
    expect(() => planIdentityAliases({ ...input, approvedDigest: "a".repeat(64) })).toThrow("MAP_DIGEST_MISMATCH");
    const duplicate = Buffer.from(input.map.toString().replace('"writable":false', '"writable":false,"writable":false'));
    expect(() => planIdentityAliases({ ...input, map: duplicate, approvedDigest: digest(duplicate) })).toThrow("DUPLICATE_JSON_KEY");
    expect(() => planIdentityAliases({ ...input, approval: Buffer.from([0xff]) })).toThrow("INVALID_UTF8");
    const receipt = JSON.parse(input.approval.toString()); receipt.acceptedScope.totalDomainIdentities++;
    expect(() => planIdentityAliases({ ...input, approval: encode(receipt) })).toThrow("APPROVAL_COUNTS_MISMATCH");
    const map = Buffer.concat([input.map, Buffer.from(" ")]);
    expect(() => planIdentityAliases({ ...input, map, approvedDigest: digest(map) })).toThrow("APPROVAL_MAP_MISMATCH");
  });

  it.each(["revision", "already-new", "partial", "conflict", "unknown-consumer"])("refuses a %s snapshot", variant => {
    const f = fixture(), input = f.makeInput();
    if (variant === "revision") f.documents[1]._rev = "r2";
    if (variant === "already-new" || variant === "partial") {
      for (const doc of variant === "partial" ? [f.documents[1]] : f.documents) {
        for (const row of f.mapping) if (doc[row.field] === row.oldId) doc[row.field] = row.newId;
        if (doc._type === "siteSettings") doc.featuredGalleryId = "gallery-coast";
      }
    }
    if (variant === "conflict") f.documents[1].contentId = "different";
    if (variant === "unknown-consumer") f.documents[8].label = "joomla-content-1";
    expect(() => planIdentityAliases({ ...input, snapshot: ndjson(f.documents) })).toThrow("RECONCILIATION_BLOCKED");
  });

  it.each(["empty", "old-collision", "new-collision", "chain", "unsupported"])("rejects %s mappings before emitting payload", variant => {
    const rows = [{ field: "placementId" as const, oldId: "joomla-1", newId: "image-1" }, { field: "placementId" as const, oldId: "joomla-2", newId: "image-2" }];
    if (variant === "empty") rows.splice(0);
    if (variant === "old-collision") rows[1].oldId = rows[0].oldId;
    if (variant === "new-collision") rows[1].newId = rows[0].newId;
    if (variant === "chain") rows[1].newId = rows[0].oldId;
    if (variant === "unsupported") (rows[1] as { field: string }).field = "mediaId";
    expect(() => planIdentityAliases(placementInput(rows))).toThrow();
  });
});
