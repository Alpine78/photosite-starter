import { describe, expect, it } from "vitest";
import {
  assignProofReferences,
  compareProofFilenames,
  formatProofReference,
  isProofReference,
  NEVER_PUBLISHED,
  proofReferenceProblem,
  type ProofReferenceItem,
  type PublishedProofState,
} from "./proof-references";

const item = (key: string, originalFilename: string, reference?: string, assetRef = `asset-${key}`): ProofReferenceItem =>
  ({ _key: key, originalFilename, assetRef, ...(reference ? { reference } : {}) });
const withAssigned = (items: ProofReferenceItem[], published: PublishedProofState) => {
  const { references, highWater } = assignProofReferences(items, published);
  return { items: items.map((entry) => ({ ...entry, reference: references[entry._key] })), highWater };
};
const publish = (items: ProofReferenceItem[], highWater: number): PublishedProofState =>
  ({ highWater, references: Object.fromEntries(items.map((entry) => [entry._key, { reference: entry.reference!, assetRef: entry.assetRef }])) });

describe("natural proof filename order (ADR-0038 decision 2)", () => {
  it("compares numeric runs by value", () => {
    const names = ["IMG_10.jpg", "IMG_9.jpg", "IMG_100.jpg", "IMG_2.jpg", "img_1.jpg", "DSC_0001.jpg"];
    expect([...names].sort(compareProofFilenames)).toEqual(["DSC_0001.jpg", "IMG_2.jpg", "IMG_9.jpg", "IMG_10.jpg", "IMG_100.jpg", "img_1.jpg"]);
  });
  it("orders equal values by fewer leading zeros, then code units", () => {
    expect(compareProofFilenames("IMG_7.jpg", "IMG_007.jpg")).toBeLessThan(0);
    expect(compareProofFilenames("IMG_007.jpg", "IMG_7.jpg")).toBeGreaterThan(0);
    expect(compareProofFilenames("a1b.jpg", "a1b.jpg")).toBe(0);
  });
  it("treats NFC-equivalent names as equal", () => {
    expect(compareProofFilenames("Mäki_1.jpg", "Mäki_1.jpg")).toBe(0);
  });
  it("is antisymmetric and transitive over a mixed sample", () => {
    const sample = ["a", "a0", "a00", "a1", "a01", "a10", "a2b", "a2", "b", "1", "01", "_1", "A1", "a1.jpg", "a1-1.jpg", "a1 1.jpg"];
    for (const x of sample) for (const y of sample) {
      expect(Math.sign(compareProofFilenames(x, y)) + Math.sign(compareProofFilenames(y, x))).toBe(0);
      for (const z of sample) {
        if (compareProofFilenames(x, y) < 0 && compareProofFilenames(y, z) < 0) expect(compareProofFilenames(x, z)).toBeLessThan(0);
      }
    }
  });
});

describe("permanent proof references", () => {
  it("numbers a first publication in natural order with the item key as the final tie-break", () => {
    const items = [item("k3", "IMG_10.jpg"), item("k1", "IMG_9.jpg"), item("k4", "IMG_9.jpg"), item("k2", "IMG_2.jpg")];
    expect(assignProofReferences(items, NEVER_PUBLISHED)).toEqual({ references: { k2: "001", k1: "002", k4: "003", k3: "004" }, highWater: 4 });
  });
  it("ignores draft numbers before the first publication succeeds", () => {
    const items = [item("a", "IMG_2.jpg", "001"), item("b", "IMG_1.jpg", "002")];
    expect(assignProofReferences(items, NEVER_PUBLISHED).references).toEqual({ a: "002", b: "001" });
  });
  it("keeps published numbers, appends additions and never reuses a removed number", () => {
    const first = withAssigned([item("a", "IMG_1.jpg"), item("b", "IMG_2.jpg"), item("c", "IMG_3.jpg")], NEVER_PUBLISHED);
    const published = publish(first.items, first.highWater);
    const next = [first.items[2], first.items[0], item("d", "IMG_0.jpg")];
    expect(assignProofReferences(next, published)).toEqual({ references: { c: "003", a: "001", d: "004" }, highWater: 4 });
  });
  it("formats and recognizes canonical numbers only", () => {
    expect(formatProofReference(1)).toBe("001");
    expect(formatProofReference(1000)).toBe("1000");
    for (const bad of ["000", "1", "01", "0001", "1a", "", 1]) expect(isProofReference(bad)).toBe(false);
    expect(() => formatProofReference(0)).toThrow(RangeError);
    expect(() => formatProofReference(1_000_000)).toThrow(RangeError);
  });
  it("refuses a missing, changed or reused number, a replaced image and a wrong high-water mark", () => {
    const first = withAssigned([item("a", "IMG_1.jpg"), item("b", "IMG_2.jpg")], NEVER_PUBLISHED);
    expect(proofReferenceProblem(first.items, first.highWater, NEVER_PUBLISHED)).toBeUndefined();
    expect(proofReferenceProblem([item("a", "IMG_1.jpg"), first.items[1]], 2, NEVER_PUBLISHED)).toBe("missing");
    const published = publish(first.items, first.highWater);
    expect(proofReferenceProblem([{ ...first.items[0], reference: "002" }, { ...first.items[1], reference: "001" }], 2, published)).toBe("changed");
    // Removing 001 and giving a new item that number reuses it.
    expect(proofReferenceProblem([first.items[1], item("c", "IMG_0.jpg", "001")], 3, published)).toBe("changed");
    expect(proofReferenceProblem([first.items[1], item("c", "IMG_0.jpg", "003")], 3, published)).toBeUndefined();
    expect(proofReferenceProblem([{ ...first.items[0], assetRef: "asset-other" }, first.items[1]], 2, published)).toBe("replaced");
    expect(proofReferenceProblem(first.items, 3, published)).toBe("high-water");
    expect(proofReferenceProblem(first.items, "2", published)).toBe("high-water");
  });
});
