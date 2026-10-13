import { describe, expect, it, vi } from "vitest";
import { planLocaleAdditions } from "./locale-publication-plan.mts";
import { boundedPublicationFetch, runLocalePublication } from "./locale-publication-run.mts";
const category = { _id: "category", _rev: "r", _type: "category", categoryId: "blog", label: [{ _key: "fi", language: "fi", value: "Fixture" }], slug: [{ _key: "fi", language: "fi", value: "fixture" }] };
const packet = { category: { sourceDocument: category, englishAdditions: { label: { _key: "en", _type: "localizedText", language: "en", value: "Blog" }, slug: { _key: "en", _type: "localizedSlug", language: "en", value: "blog" }, description: { _key: "en", _type: "categoryDescription", language: "en", blocks: [{ _key: "p", _type: "categoryDescriptionParagraph", spans: [{ _key: "s", _type: "categoryDescriptionInlineSpan", text: "Reviewed paragraph." }] }] } } }, services: [] };
const plan = () => planLocaleAdditions(Buffer.from(JSON.stringify(category) + "\n"), packet, { projectId: "fixture", dataset: "production", apiVersion: "v2026-03-01" });
describe("publication operator", () => {
  it("uses provider dry run without inferring publication approval", async () => {
    const mutate = vi.fn(), persist = vi.fn();
    const result = await runLocalePublication(plan(), { apply: false }, { read: async () => [category], mutate, persist });
    expect(mutate.mock.calls[0][1]).toBe(true); expect(result).toMatchObject({ applied: false, launchApproved: false, credentialRevocationVerified: false });
  });
  it("requires the exact approved digest before any live IO", async () => {
    const read = vi.fn(), mutate = vi.fn();
    await expect(runLocalePublication(plan(), { apply: true, approvedDigest: "wrong" }, { read, mutate, persist: vi.fn() })).rejects.toThrow("PUBLICATION_DIGEST_NOT_APPROVED");
    expect(read).not.toHaveBeenCalled(); expect(mutate).not.toHaveBeenCalled();
  });
  it("refuses stale source before mutation", async () => {
    const mutate = vi.fn(); await expect(runLocalePublication(plan(), { apply: false }, { read: async () => [{ ...category, _rev: "changed" }], mutate, persist: vi.fn() })).rejects.toThrow("LIVE_SOURCE_OR_TARGET_CHANGED"); expect(mutate).not.toHaveBeenCalled();
  });
  it("never retries an ambiguous write and persists a fixed result", async () => {
    const mutate = vi.fn(async () => { throw new Error("private upstream detail"); }), persist = vi.fn();
    await expect(runLocalePublication(plan(), { apply: false }, { read: async () => [category], mutate, persist })).rejects.toThrow("PUBLICATION_WRITE_REFUSED_OR_AMBIGUOUS");
    expect(mutate).toHaveBeenCalledTimes(1); expect(JSON.stringify(persist.mock.calls)).not.toContain("private upstream detail");
  });
  it("verifies the exact intended category field delta after an approved write", async () => {
    const p = plan(), patch = p.transactions[0].mutations[0]; if (!("patch" in patch)) throw new Error("fixture");
    const read = vi.fn().mockResolvedValueOnce([category]).mockResolvedValueOnce([{ ...category, ...patch.patch.set, _rev: "new" }]);
    expect((await runLocalePublication(p, { apply: true, approvedDigest: p.digest }, { read, mutate: vi.fn(), persist: vi.fn() })).applied).toBe(true);
  });
  it("refuses post-write content drift rather than claiming completion", async () => {
    const p = plan(), persist = vi.fn(), read = vi.fn().mockResolvedValueOnce([category]).mockResolvedValueOnce([{ ...category, categoryId: "other" }]);
    await expect(runLocalePublication(p, { apply: true, approvedDigest: p.digest }, { read, mutate: vi.fn(), persist })).rejects.toThrow("PUBLICATION_READBACK_FAILED");
    expect(persist).toHaveBeenCalledWith(0, { state: "write-submitted-readback-failed", applied: true, retryAuthorized: false });
  });
});

it("bounds a streamed upstream read and cancels its reader", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(stream)));
  try { await expect(boundedPublicationFetch("https://fixture.api.sanity.io/read")).rejects.toThrow("LIVE_RESPONSE_LIMIT"); expect(cancelled).toBe(true); }
  finally { vi.unstubAllGlobals(); }
});

it("reads back the approved source pricing append and refuses an unrelated source edit", async () => {
  const source = { _id: "service-fi", _rev: "r", _type: "service", serviceId: "sessions", language: "fi", name: "Source", shortDescription: "Source", slug: "source", order: 1, description: ["Source"], pricing: [{ _key: "base", _type: "object", name: "Source", price: "100" }] };
  const addition = { _key: "extra", _type: "object", name: "Extra", price: "250" };
  const copy = { ...packet, services: [{ sourceDocument: source, sourcePricingAdditions: [addition], targetEditingFields: { ...source, _id: undefined, _rev: undefined, language: "en", slug: "reviewed", pricing: [...source.pricing, addition] } }] };
  delete copy.services[0].targetEditingFields._id; delete copy.services[0].targetEditingFields._rev;
  const p = planLocaleAdditions(Buffer.from([category, source].map(d => JSON.stringify(d)).join("\n") + "\n"), copy, { projectId: "fixture", dataset: "production", apiVersion: "v2026-03-01" });
  const tx = p.transactions[0], firstPatch = tx.mutations[0]; if (!("patch" in firstPatch)) throw new Error("fixture");
  const after = [{ ...category, ...firstPatch.patch.set }, { ...source, pricing: [...source.pricing, addition], _rev: "new" }, ...tx.created];
  const run = (result: Record<string, unknown>[]) => runLocalePublication(p, { apply: true, approvedDigest: p.digest }, { read: vi.fn().mockResolvedValueOnce([category, source]).mockResolvedValueOnce(result), mutate: vi.fn(), persist: vi.fn() });
  expect((await run(after)).applied).toBe(true);
  await expect(run(after.map(d => d._id === source._id ? { ...d, description: ["Unapproved"] } : d))).rejects.toThrow("PUBLICATION_READBACK_FAILED");
});
