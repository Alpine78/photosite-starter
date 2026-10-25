import { describe, expect, it, vi } from "vitest";
import { runProofPublication } from "@/lib/proof-publication-access";
import type { SanityConfig } from "@/lib/sanity-config";

const config: SanityConfig = { projectId: "abc123", dataset: "production", datasetVisibility: "public", apiVersion: "v2026-06-24" };
const secret = Buffer.alloc(32, 9);
const asset = `image-${"a".repeat(40)}-1600x1000-webp`;
const draft = { _id: "drafts.GALLERY", _type: "clientProofGallery", _rev: "r1", handle: "c".repeat(32), available: false, availabilityMode: "indefinite",
  items: [{ _key: "k1", _type: "clientProofItem", mediaType: "image", originalFilename: "IMG_1.jpg", image: { _type: "image", asset: { _type: "reference", _ref: asset } } }] };
const terms = { includedCount: 10, extraUnitPriceMinor: 1500, currency: "EUR", jobReference: "job-1", reminder: { delayDays: 7, customerEmail: "asiakas@example.fi", locale: "fi" } };
const assets = [{ _id: asset, _type: "sanity.imageAsset", extension: "webp", mimeType: "image/webp", sha1hash: "a".repeat(40), width: 1600, height: 1000, restricted: false }];

function sanity(responses: Record<string, () => Response>) {
  const calls: string[] = [];
  const send = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const body = init?.body ? String(init.body) : "";
    const kind = path === "/v2021-12-15/projects/abc123" ? "member" : path.startsWith("/v2026-06-24/data/mutate") ? "mutate" : body.includes("termsId") ? "state" : "related";
    calls.push(kind);
    return responses[kind]();
  });
  return { send: send as unknown as typeof fetch, calls };
}
const json = (value: unknown, status = 200) => () => new Response(JSON.stringify(value), { status });
const editor = { id: "abc123", members: [{ id: "editor-1", isCurrentUser: true, isRobot: false, roles: [{ name: "editor" }] }] };
const ok = { member: json(editor), state: json({ result: { draft, published: null, terms: null, versions: 0 } }), related: json({ result: { conflicts: [], assets } }), mutate: json({ transactionId: "t" }) };

describe("proof publication facade order", () => {
  it("proves a non-admin Editor, reads, plans and returns the key only after the commit", async () => {
    const { send, calls } = sanity(ok);
    const result = await runProofPublication({ galleryId: "GALLERY", operation: "publish", expectedDraftRevision: "r1", terms }, "token-0123456789-abcdefgh", secret, { config, fetchImplementation: send });
    expect(calls).toEqual(["member", "state", "related", "mutate"]);
    expect(result).toMatchObject({ outcome: "committed", firstPublication: true, selectionKey: expect.any(String) });
    for (const call of vi.mocked(send).mock.calls) expect(call[1]?.headers).toMatchObject({ Authorization: "Bearer token-0123456789-abcdefgh" });
  });
  it("stops at an unproven session before any read or allowance", async () => {
    const { send, calls } = sanity({ ...ok, member: json({}, 401) });
    expect(await runProofPublication({ galleryId: "OTHER1", operation: "publish", expectedDraftRevision: "r1", terms }, "token-0123456789-abcdefgh", secret, { config, fetchImplementation: send }))
      .toEqual({ outcome: "failed", reason: "unauthenticated" });
    expect(calls).toEqual(["member"]);
  });
  it("writes nothing for a rejected plan and returns no key when the commit fails", async () => {
    const rejected = sanity({ ...ok, related: json({ result: { conflicts: [{ _id: "x" }], assets } }) });
    expect(await runProofPublication({ galleryId: "OTHER2", operation: "publish", expectedDraftRevision: "r1", terms }, "token-0123456789-abcdefgh", secret, { config, fetchImplementation: rejected.send }))
      .toEqual({ outcome: "rejected", reason: "invalid-gallery" });
    expect(rejected.calls).not.toContain("mutate");
    for (const [status, reason] of [[409, "conflict"], [403, "forbidden"], [500, "store-unavailable"]] as const) {
      const id = `OTHER${status}`;
      const failing = sanity({ ...ok, state: json({ result: { draft: { ...draft, _id: `drafts.${id}` }, published: null, terms: null, versions: 0 } }), mutate: json({}, status) });
      const result = await runProofPublication({ galleryId: id, operation: "publish", expectedDraftRevision: "r1", terms }, "token-0123456789-abcdefgh", secret, { config, fetchImplementation: failing.send });
      expect(result).toEqual({ outcome: "failed", reason });
      expect(failing.calls).toContain("mutate");
    }
  });
  it("a human identity never substitutes for provider write permission", async () => {
    const viewer = { ...editor, members: [{ ...editor.members[0], roles: [{ name: "viewer" }] }] };
    const { send, calls } = sanity({ ...ok, member: json(viewer), mutate: json({}, 403) });
    expect(await runProofPublication({ galleryId: "GALLERY", operation: "publish", expectedDraftRevision: "r1", terms }, "token-0123456789-abcdefgh", secret, { config, fetchImplementation: send }))
      .toEqual({ outcome: "failed", reason: "forbidden" });
    expect(calls).toEqual(["member", "state", "related", "mutate"]);
  });
  it("robot denials cannot spend a gallery's allowance or reach content reads", async () => {
    const strangers = sanity({ ...ok, member: json({ ...editor, members: [{ ...editor.members[0], isRobot: true }] }) });
    for (let attempt = 0; attempt < 20; attempt++) {
      await runProofPublication({ galleryId: "TARGET", operation: "publish", expectedDraftRevision: "r1", terms }, "token-0123456789-abcdefgh", secret, { config, fetchImplementation: strangers.send });
    }
    expect(strangers.calls).toEqual(Array(20).fill("member"));
    const { send } = sanity({ ...ok, state: json({ result: { draft: { ...draft, _id: "drafts.TARGET" }, published: null, terms: null, versions: 0 } }) });
    expect((await runProofPublication({ galleryId: "TARGET", operation: "publish", expectedDraftRevision: "r1", terms }, "token-0123456789-abcdefgh", secret, { config, fetchImplementation: send })).outcome).toBe("committed");
  });
});
