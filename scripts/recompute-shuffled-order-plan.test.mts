import { describe, expect, it } from "vitest";

import { computeShuffledOrder } from "@/lib/gallery-shuffle";
import {
  computeShuffledOrderKey,
  planShuffledOrderRecompute,
  RecomputePlanError,
  SHUFFLED_ORDER_HEX,
  type RecomputePlacement,
} from "./recompute-shuffled-order-plan.mts";

const HEX_64 = "b".repeat(64);

function placement(overrides: Partial<RecomputePlacement> = {}): RecomputePlacement {
  return {
    _id: overrides._id ?? `pl-${overrides.placementId ?? "x"}`,
    _rev: overrides._rev ?? "rev-1",
    placementId: overrides.placementId ?? "x",
    pinned: overrides.pinned ?? false,
    shuffledOrder: overrides.shuffledOrder ?? null,
    shuffledOrderSeed: overrides.shuffledOrderSeed ?? null,
  };
}

describe("computeShuffledOrderKey (restated)", () => {
  it("matches src/lib/gallery-shuffle.ts's computeShuffledOrder", () => {
    for (const [seed, id] of [
      ["seed-one", "placement-a"],
      ["another-seed", "northern-coast-2026-01"],
    ]) {
      expect(computeShuffledOrderKey(seed, id)).toBe(computeShuffledOrder(seed, id));
    }
  });

  it("shares the 64-hex pattern", () => {
    expect(SHUFFLED_ORDER_HEX.source).toBe(/^[0-9a-f]{64}$/.source);
  });
});

describe("planShuffledOrderRecompute — manual / clear", () => {
  it("plans no patches when a manual gallery's placements already carry nothing", () => {
    const plan = planShuffledOrderRecompute({
      orderingRule: "manual",
      orderingSeed: null,
      placements: [placement({ placementId: "a" }), placement({ placementId: "b" })],
    });
    expect(plan.patches).toEqual([]);
    expect(plan.unchanged).toBe(2);
    expect(plan.rule).toBe("clear");
  });

  it("unsets both fields on a manual gallery's placement that still carries a key", () => {
    const plan = planShuffledOrderRecompute({
      orderingRule: "manual",
      orderingSeed: null,
      placements: [
        placement({ placementId: "a", shuffledOrder: HEX_64, shuffledOrderSeed: "old" }),
        placement({ placementId: "b" }),
      ],
    });
    expect(plan.patches).toHaveLength(1);
    expect(plan.patches[0]).toMatchObject({
      placementId: "a",
      ifRevisionID: "rev-1",
      unset: ["shuffledOrder", "shuffledOrderSeed"],
    });
    expect(plan.unchanged).toBe(1);
  });
});

describe("planShuffledOrderRecompute — seeded-random", () => {
  const SEED = "recompute-test-seed";

  it("sets the HMAC key + seed on every non-pinned placement that is missing or stale", () => {
    const stale = placement({
      placementId: "keep",
      shuffledOrder: computeShuffledOrderKey(SEED, "keep"),
      shuffledOrderSeed: SEED,
    });
    const plan = planShuffledOrderRecompute({
      orderingRule: "seeded-random",
      orderingSeed: SEED,
      placements: [
        placement({ placementId: "missing" }),
        placement({ placementId: "wrong-seed", shuffledOrder: HEX_64, shuffledOrderSeed: "old" }),
        stale,
      ],
    });
    expect(plan.seed).toBe(SEED);
    expect(plan.patches.map((p) => p.placementId).sort()).toEqual(["missing", "wrong-seed"]);
    for (const p of plan.patches) {
      expect(p.set?.shuffledOrder).toBe(computeShuffledOrderKey(SEED, p.placementId));
      expect(p.set?.shuffledOrderSeed).toBe(SEED);
    }
    expect(plan.unchanged).toBe(1);
  });

  it("clears the key on a pinned lead that wrongly carries one", () => {
    const plan = planShuffledOrderRecompute({
      orderingRule: "seeded-random",
      orderingSeed: SEED,
      placements: [
        placement({ placementId: "pin", pinned: true, shuffledOrder: HEX_64, shuffledOrderSeed: SEED }),
        placement({ placementId: "pin-clean", pinned: true }),
      ],
    });
    expect(plan.patches).toHaveLength(1);
    expect(plan.patches[0]).toMatchObject({ placementId: "pin", unset: ["shuffledOrder", "shuffledOrderSeed"] });
    expect(plan.unchanged).toBe(1);
  });

  it("plans nothing when every placement already matches the current seed", () => {
    const plan = planShuffledOrderRecompute({
      orderingRule: "seeded-random",
      orderingSeed: SEED,
      placements: [
        placement({ placementId: "pin", pinned: true }),
        placement({
          placementId: "a",
          shuffledOrder: computeShuffledOrderKey(SEED, "a"),
          shuffledOrderSeed: SEED,
        }),
      ],
    });
    expect(plan.patches).toEqual([]);
  });

  it("carries each placement's own _rev into its patch (ifRevisionID) and its planned pinned state", () => {
    const plan = planShuffledOrderRecompute({
      orderingRule: "seeded-random",
      orderingSeed: SEED,
      placements: [
        placement({ placementId: "a", _rev: "abc-123" }),
        placement({ placementId: "pin", _rev: "def-456", pinned: true, shuffledOrder: HEX_64 }),
      ],
    });
    const byId = new Map(plan.patches.map((p) => [p.placementId, p]));
    expect(byId.get("a")?.ifRevisionID).toBe("abc-123");
    expect(byId.get("a")?.plannedPinned).toBe(false);
    expect(byId.get("pin")?.ifRevisionID).toBe("def-456");
    expect(byId.get("pin")?.plannedPinned).toBe(true);
  });

  it("throws when a seeded-random gallery declares no seed", () => {
    expect(() =>
      planShuffledOrderRecompute({
        orderingRule: "seeded-random",
        orderingSeed: "  ",
        placements: [],
      }),
    ).toThrow(RecomputePlanError);
  });

  it("throws when the seed has surrounding whitespace rather than trimming it inconsistently", () => {
    expect(() =>
      planShuffledOrderRecompute({
        orderingRule: "seeded-random",
        orderingSeed: " summer ",
        placements: [],
      }),
    ).toThrow(/whitespace/);
  });
});
