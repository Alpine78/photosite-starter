/**
 * The pure decision half of `npm run recompute:shuffled-order` (AB#129 PR2,
 * ADR-0009 2026-08-28 amendment). Given a gallery's ordering rule/seed and its
 * placements' current state, it computes the minimal set of patches that make
 * every placement's materialized `shuffledOrder` key agree with the rule:
 *
 * - `manual` (or any non-`seeded-random`) gallery: every placement carries
 *   neither `shuffledOrder` nor `shuffledOrderSeed` (switching a gallery back
 *   to manual must clear them).
 * - `seeded-random`, pinned lead: neither field — it sorts by manual `order`.
 * - `seeded-random`, not pinned: `shuffledOrder = HMAC-SHA256(placementId)`
 *   keyed by the gallery's `orderingSeed`, and `shuffledOrderSeed` = that seed.
 *
 * Each patch carries the `_rev` it was planned against (`ifRevisionID`), so the
 * IO half can apply it under optimistic concurrency and retry a conflict.
 *
 * Self-contained (`scripts/*.mts` runtime files import nothing from `src/lib` —
 * see `sanity-seed-fixtures.mts`'s module comment): `computeShuffledOrderKey`
 * restates `src/lib/gallery-shuffle.ts`'s function, pinned equal by
 * `recompute-shuffled-order-plan.test.mts`.
 */

import { createHmac } from "node:crypto";

/** Restates `src/lib/gallery-shuffle.ts`'s `SHUFFLED_ORDER_PATTERN`. */
export const SHUFFLED_ORDER_HEX = /^[0-9a-f]{64}$/;

/** Restates `src/lib/gallery-shuffle.ts`'s `computeShuffledOrder`. */
export function computeShuffledOrderKey(seed: string, placementId: string): string {
  if (typeof seed !== "string" || seed.length === 0) {
    throw new Error("computeShuffledOrderKey requires a non-empty seed");
  }
  if (typeof placementId !== "string" || placementId.length === 0) {
    throw new Error("computeShuffledOrderKey requires a non-empty placementId");
  }
  return createHmac("sha256", seed).update(placementId, "utf8").digest("hex");
}

export type RecomputePlacement = {
  readonly _id: string;
  readonly _rev: string;
  readonly placementId: string;
  readonly pinned: boolean;
  readonly shuffledOrder: string | null;
  readonly shuffledOrderSeed: string | null;
};

export type RecomputePatch = {
  readonly id: string;
  readonly ifRevisionID: string;
  readonly placementId: string;
  readonly set?: Readonly<Record<string, string>>;
  readonly unset?: readonly string[];
  /**
   * The `pinned` state the plan was built against — set only for a
   * `seeded-random` recompute, where the key computed for a placement depends
   * on it. The IO half aborts on a revision conflict if the live `pinned`
   * differs from this. Absent for a `clear` (manual) plan, where `pinned` does
   * not affect the patch.
   */
  readonly plannedPinned?: boolean;
};

export type RecomputePlan = {
  readonly rule: "clear" | "seeded-random";
  readonly seed: string | undefined;
  readonly patches: readonly RecomputePatch[];
  /** Placements already in the desired state. */
  readonly unchanged: number;
};

export class RecomputePlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecomputePlanError";
  }
}

function clearPatch(p: RecomputePlacement): RecomputePatch | undefined {
  if (p.shuffledOrder === null && p.shuffledOrderSeed === null) return undefined;
  return {
    id: p._id,
    ifRevisionID: p._rev,
    placementId: p.placementId,
    unset: ["shuffledOrder", "shuffledOrderSeed"],
  };
}

/**
 * The patches that make `placements` a single consistent generation for the
 * gallery's `orderingRule`/`orderingSeed`. An empty `patches` array means the
 * gallery is already consistent — which is exactly the check the read path's
 * bounded `staleShuffledOrderCount` aggregate performs, and the check the IO
 * half runs one last time before reporting success.
 */
export function planShuffledOrderRecompute(input: {
  readonly orderingRule: string;
  readonly orderingSeed: string | null | undefined;
  readonly placements: readonly RecomputePlacement[];
}): RecomputePlan {
  if (input.orderingRule !== "seeded-random") {
    const patches = input.placements
      .map(clearPatch)
      .filter((patch): patch is RecomputePatch => patch !== undefined);
    return {
      rule: "clear",
      seed: undefined,
      patches,
      unchanged: input.placements.length - patches.length,
    };
  }

  const seed = input.orderingSeed ?? "";
  if (seed.length === 0) {
    throw new RecomputePlanError(
      "this gallery's orderingRule is seeded-random but it declares no orderingSeed",
    );
  }
  // Not trimmed: the seed is used verbatim everywhere (stored on the gallery,
  // written as `shuffledOrderSeed`, compared for equality by the adapter). A
  // seed with surrounding whitespace is rejected by the Studio schema; one
  // that reached the store anyway is a defect this must not paper over by
  // trimming inconsistently.
  if (seed !== seed.trim()) {
    throw new RecomputePlanError(
      `this gallery's orderingSeed has surrounding whitespace (${JSON.stringify(seed)}) — fix it in Studio and re-run`,
    );
  }

  const patches: RecomputePatch[] = [];
  let unchanged = 0;
  for (const p of input.placements) {
    if (p.pinned) {
      const patch = clearPatch(p);
      if (patch === undefined) unchanged += 1;
      else patches.push({ ...patch, plannedPinned: true });
      continue;
    }
    const key = computeShuffledOrderKey(seed, p.placementId);
    if (p.shuffledOrder === key && p.shuffledOrderSeed === seed) {
      unchanged += 1;
      continue;
    }
    patches.push({
      id: p._id,
      ifRevisionID: p._rev,
      placementId: p.placementId,
      plannedPinned: false,
      set: { shuffledOrder: key, shuffledOrderSeed: seed },
    });
  }
  return { rule: "seeded-random", seed, patches, unchanged };
}
