import { describe, expect, it, vi } from "vitest";
import { createReopenGuard, proofReopenCopy, PROOF_REOPEN_MAX_VERSION, reopenReadiness, runReopen } from "./proof-reopen";
import { PROOF_MAX_VERSION } from "../src/lib/proof-selection";

const published = (extra: Record<string, unknown> = {}) => ({ _id: "proofSelection.g1", _type: "clientProofSelection", _rev: "rev7", galleryId: "g1", state: "confirmed", latestVersion: 2, ...extra });
const state = (extra: Record<string, unknown> = {}) => ({ id: "proofSelection.g1", type: "clientProofSelection", ready: true, draft: null, published: published(), transactionSyncLock: { enabled: false }, ...extra });

describe("reopen readiness", () => {
  it("captures exactly the confirmed selection as reviewed", () => {
    expect(reopenReadiness(state(), true)).toEqual({ ready: { id: "proofSelection.g1", revision: "rev7", latestVersion: 2 } });
  });

  it.each([
    ["off", state(), false, "off"],
    ["an open selection", state({ published: published({ state: "open" }) }), true, "not-confirmed"],
    ["a confirmed selection without a version", state({ published: published({ latestVersion: 0 }) }), true, "not-confirmed"],
    ["the version limit", state({ published: published({ latestVersion: PROOF_REOPEN_MAX_VERSION }) }), true, "limit"],
    ["another document ID", state({ id: "proofSelection.g2" }), true, "unavailable"],
    ["an ID not derived from its gallery", state({ published: published({ galleryId: "g2" }) }), true, "unavailable"],
    ["a draft", state({ draft: { _id: "drafts.proofSelection.g1" } }), true, "unavailable"],
    ["a locked document", state({ transactionSyncLock: { enabled: true } }), true, "unavailable"],
    ["a fractional version", state({ published: published({ latestVersion: 1.5 }) }), true, "unavailable"],
    ["another type", state({ type: "clientProofNotice" }), true, "unavailable"],
  ] as const)("refuses %s", (_name, current, enabled, reason) => {
    expect(reopenReadiness(current, enabled)).toEqual({ reason });
  });

  it("keeps the version limit in step with the site's confirmation planner", () => {
    expect(PROOF_REOPEN_MAX_VERSION).toBe(PROOF_MAX_VERSION);
  });
});

describe("running a reopen", () => {
  const request = { id: "proofSelection.g1", revision: "rev7", latestVersion: 2 };

  it("commits against the captured revision only", async () => {
    const commit = vi.fn(async () => {});
    expect(await runReopen(request, commit)).toBe("reopened");
    expect(commit).toHaveBeenCalledWith("proofSelection.g1", "rev7");
  });

  it("reports a guard conflict, and an unknown failure as uncertain rather than unchanged", async () => {
    expect(await runReopen(request, async () => { throw Object.assign(new Error("mismatch"), { statusCode: 409 }); })).toBe("conflict");
    expect(await runReopen(request, async () => { throw new TypeError("network"); })).toBe("uncertain");
  });

  it("ignores a second press while the first runs", async () => {
    let release!: () => void;
    const commit = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const guard = createReopenGuard();
    const first = guard(request, commit);
    expect(await guard(request, commit)).toBe("busy");
    release();
    expect(await first).toBe("reopened");
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("explains in both languages that earlier versions stay and the customer reloads", () => {
    expect(proofReopenCopy("fi-FI").explain).toContain("säilyvät");
    expect(proofReopenCopy("en-US").explain).toContain("reload");
  });
});
