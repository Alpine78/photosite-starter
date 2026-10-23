import { describe, expect, it } from "vitest";
import { evaluate, parse } from "groq-js/1";
import { PROOF_SELECTION_DISCOVERY_QUERY } from "../src/lib/proof-selection-sanity";

// In-memory published fixtures model query semantics, not provider perspective/ACLs.
const handle = "a".repeat(32);
async function query(dataset: Record<string, unknown>[]) {
  return (await evaluate(parse(PROOF_SELECTION_DISCOVERY_QUERY), { dataset, params: { handle } })).get();
}

describe("actual GROQ proof selection discovery", () => {
  it("finds only proof galleries owning the handle and projects only their ID", async () => {
    expect(await query([
      { _id: "proof-one", _type: "clientProofGallery", handle, items: [{ originalFilename: "secret.jpg" }] },
      { _id: "delivery-one", _type: "clientDeliveryGallery", handle },
      { _id: "proof-two", _type: "clientProofGallery", handle: "b".repeat(32) },
    ])).toEqual([{ _id: "proof-one" }]);
  });

  it("returns a duplicate for the facade to refuse, bounded to two", async () => {
    const dataset = ["x", "y", "z"].map((id) => ({ _id: id, _type: "clientProofGallery", handle }));
    expect(await query(dataset)).toHaveLength(2);
  });
});
