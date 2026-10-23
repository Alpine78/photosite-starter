import { describe, expect, it } from "vitest";
import { evaluate, parse } from "groq-js/1";
import { PROOF_NOTICES_NEEDING_ACTION_FILTER } from "./editorial-policy";

// The Studio list's real filter, evaluated with groq-js at fixed instants.
const notice = (id: string, state: string, createdAt: string) => ({ _id: `proofNotice.g1.v${id}`, _type: "clientProofNotice", galleryId: "g1", state, createdAt });
async function listed(at: string) {
  const dataset = [
    notice("1", "pending", "2026-10-23T10:00:00Z"),
    notice("2", "failed", "2026-10-23T10:04:00Z"),
    notice("3", "sent", "2026-10-23T09:00:00Z"),
    notice("4", "pending", "2026-10-23T10:04:59Z"),
    { _id: "other", _type: "clientProofSelectionVersion", state: "failed", createdAt: "2026-10-23T09:00:00Z" },
  ];
  const result = await evaluate(parse(`*[${PROOF_NOTICES_NEEDING_ACTION_FILTER}] | order(_id asc)._id`), { dataset, timestamp: new Date(at) });
  return result.get();
}

describe("proof notices needing action", () => {
  it("lists failed notices at once and pending ones only after five minutes, never sent ones", async () => {
    expect(await listed("2026-10-23T10:05:00Z")).toEqual(["proofNotice.g1.v2"]);
    expect(await listed("2026-10-23T10:05:01Z")).toEqual(["proofNotice.g1.v1", "proofNotice.g1.v2"]);
    expect(await listed("2026-10-23T10:10:00Z")).toEqual(["proofNotice.g1.v1", "proofNotice.g1.v2", "proofNotice.g1.v4"]);
  });
});
