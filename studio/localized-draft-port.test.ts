import { describe, expect, it, vi } from "vitest";
import { createLocalizedDraftPort, type StudioDraftClient } from "./localized-draft-port";
import { documentSnapshot } from "./localized-draft-action-model";

const source = { _id: "source", _rev: "r1", _type: "article", title: "Original" };
function fixture() {
  const state = { available: true, source: structuredClone(source) };
  const transaction = { create: vi.fn(), commit: vi.fn(async () => undefined) };
  const raw = { fetch: vi.fn(async () => []), transaction: vi.fn(() => transaction) };
  const client: StudioDraftClient = { withConfig: vi.fn(() => raw) };
  const port = createLocalizedDraftPort(client, () => state, documentSnapshot(source));
  return { state, transaction, raw, client, port };
}

describe("authenticated Studio client adapter", () => {
  it("retains the supplied authenticated client with raw direct reads and retries disabled", async () => {
    const f = fixture(); const signal = new AbortController().signal;
    await f.port.fetch('*[_id == $id]', { id: "source" }, signal);
    expect(f.client.withConfig).toHaveBeenCalledExactlyOnceWith({ perspective: "raw", useCdn: false, maxRetries: 0 });
    expect(f.raw.fetch).toHaveBeenCalledExactlyOnceWith('*[_id == $id]', { id: "source" }, { signal });
  });
  it("strict-creates all draft documents in one transaction without generated array keys", async () => {
    const f = fixture(); const drafts = [{ _id: "drafts.parent", _type: "article" }, { _id: "drafts.item", _type: "articleEndGalleryPlacement" }];
    await f.port.create(drafts);
    expect(f.raw.transaction).toHaveBeenCalledTimes(1);
    expect(f.transaction.create.mock.calls).toEqual(drafts.map((document) => [document]));
    expect(f.transaction.commit).toHaveBeenCalledExactlyOnceWith({ autoGenerateArrayKeys: false, visibility: "sync" });
  });
  it.each(["source", "revision", "context"])("refuses a changed %s immediately before transaction creation", async (kind) => {
    const f = fixture();
    if (kind === "source") f.state.source.title = "Changed";
    if (kind === "revision") f.state.source._rev = "r2";
    if (kind === "context") f.state.available = false;
    await expect(f.port.create([{ _id: "drafts.target", _type: "article" }])).rejects.toMatchObject({ code: "changed" });
    expect(f.raw.transaction).not.toHaveBeenCalled();
  });
  it("does not swallow or retry a failed transaction acknowledgement", async () => {
    const f = fixture(); f.transaction.commit.mockRejectedValueOnce(new Error("provider refused"));
    await expect(f.port.create([{ _id: "drafts.target", _type: "article" }])).rejects.toThrow("provider refused");
    expect(f.transaction.commit).toHaveBeenCalledTimes(1);
  });
});
