/**
 * The keyed, deterministic function that turns a seeded-random gallery's
 * `(orderingSeed, placementId)` pair into one placement's materialized sort key
 * (`shuffledOrder`). ADR-0009 §2 fixes this function's *properties* and leaves
 * the concrete choice to AB#129; this module is that choice.
 *
 * ## Properties (ADR-0009 §2)
 *
 * - **Deterministic and keyed.** The same seed and the same `placementId` always
 *   produce the same key, on every server, request, and page — so the shuffled
 *   order is stable everywhere the grid, a continuation page, and the lightbox
 *   read it (AB#129 AC2).
 * - **Computed independently per placement.** No cross-placement state: adding a
 *   placement, or toggling one placement's `pinned` flag, never changes any other
 *   placement's key. A materialization pass (AB#129 PR2, the Sanity side) can
 *   therefore process placements one at a time.
 * - **Unrelated between galleries that share a seed value.** `placementId` is
 *   already site-wide unique (ADR-0002 §1), so two galleries configured with the
 *   same `orderingSeed` string still shuffle to unrelated orders.
 * - **Lexicographically sortable at a fixed width.** The output is a 64-character
 *   lowercase hex string, so a plain string comparison (`<`/`>`) reproduces value
 *   order with no padding or length special-casing — which is exactly what a
 *   store's own `order()` clause and keyset range query need (ADR-0009 §2).
 *
 * ## Not read-time work
 *
 * ADR-0009 §2 requires this to run at write/rotation time, never per request. The
 * mock fixture (`mock-gallery.ts`) calls it once while building a gallery's
 * cached placements; a store-backed adapter (PR2) materializes it as a stored
 * field. Nothing on the bounded read path recomputes it — the pagination core
 * only ever *consumes* a placement's already-materialized `shuffledOrder`.
 *
 * No `server-only` marker: like `keyset-cursor.ts`, this is imported by
 * browser-free contract tests and by the mock layer, and it reads no secret of
 * its own — the seed is supplied by the caller.
 */

import { createHmac } from "node:crypto";

/** A `shuffledOrder` value is HMAC-SHA256 rendered as lowercase hex. */
export const SHUFFLED_ORDER_PATTERN = /^[0-9a-f]{64}$/;

/**
 * The seeded-random sort key for one placement.
 *
 * `seed` is the gallery's `orderingSeed`; `placementId` is the placement's
 * site-wide-unique occurrence identity. Both are required and non-empty — an
 * empty seed is a misconfigured seeded-random gallery, caught upstream by
 * `assertGalleryOrdering` (`gallery-pagination.ts`), and an empty `placementId`
 * is already rejected by `assertPlacements`; this function guards them anyway so
 * it is safe to call in isolation.
 */
export function computeShuffledOrder(seed: string, placementId: string): string {
  if (typeof seed !== "string" || seed.length === 0) {
    throw new TypeError("computeShuffledOrder requires a non-empty seed");
  }
  if (typeof placementId !== "string" || placementId.length === 0) {
    throw new TypeError("computeShuffledOrder requires a non-empty placementId");
  }
  return createHmac("sha256", seed).update(placementId, "utf8").digest("hex");
}
