import { describe, expect, it } from "vitest";
import {
  computeShuffledOrder,
  SHUFFLED_ORDER_PATTERN,
} from "@/lib/gallery-shuffle";

describe("computeShuffledOrder", () => {
  it("is a known HMAC-SHA256 vector, pinning key direction, encoding, and representation", () => {
    // A frozen expected value, not only a property test: this locks in that the
    // seed is the HMAC key and the placementId the message (not the reverse),
    // UTF-8 text encoding, and lowercase-hex output. Recomputed independently:
    //   printf '%s' 'placement-a' | openssl dgst -sha256 -hmac 'seed-one' -hex
    expect(computeShuffledOrder("seed-one", "placement-a")).toBe(
      "de67956ec321d6ede352b6d14e9817d1b2cff4c5bf5af7d9911cae4671cc410e",
    );
  });

  it("returns a 64-character lowercase hex string", () => {
    const key = computeShuffledOrder("any-seed", "any-placement");
    expect(key).toMatch(SHUFFLED_ORDER_PATTERN);
    expect(key).toHaveLength(64);
  });

  it("is deterministic for one (seed, placementId) pair", () => {
    const a = computeShuffledOrder("seed-x", "placement-42");
    const b = computeShuffledOrder("seed-x", "placement-42");
    expect(a).toBe(b);
  });

  it("differs for a different seed with the same placement id", () => {
    expect(computeShuffledOrder("seed-a", "p1")).not.toBe(
      computeShuffledOrder("seed-b", "p1"),
    );
  });

  it("differs for a different placement id with the same seed", () => {
    expect(computeShuffledOrder("seed", "p1")).not.toBe(
      computeShuffledOrder("seed", "p2"),
    );
  });

  it("is independent per placement id — one input never influences another", () => {
    // The property ADR-0009 §2 relies on so a materialization pass can process
    // placements one at a time: two runs over disjoint id sets that share a
    // seed produce the same key for any id present in both.
    const seed = "shared-seed";
    const first = ["a", "b", "c"].map((id) => computeShuffledOrder(seed, id));
    const second = ["c", "a", "z", "b"].map((id) => computeShuffledOrder(seed, id));
    expect(second[1]).toBe(first[0]); // "a"
    expect(second[3]).toBe(first[1]); // "b"
    expect(second[0]).toBe(first[2]); // "c"
  });

  it("rejects an empty seed or placement id", () => {
    expect(() => computeShuffledOrder("", "p1")).toThrow(TypeError);
    expect(() => computeShuffledOrder("seed", "")).toThrow(TypeError);
  });
});
