import { describe, expect, it } from "vitest";
import * as schema from "./proof-references";
import * as server from "../../src/lib/proof-references";

/** The publication route restates the numbering rules; both must agree on every case. */
const names = ["IMG_10.jpg", "IMG_9.jpg", "IMG_009.jpg", "img_1.jpg", "DSC_0001.jpg", "a", "a0", "a1b", "Mäki_1.jpg", "Mäki_1.jpg", "1", "01", "_1", "A1"];
const item = (key: string, originalFilename: string, assetRef = `asset-${key}`) => ({ _key: key, originalFilename, assetRef });

describe("proof reference parity between the Studio validator and the publication route", () => {
  it("orders filenames identically", () => {
    for (const a of names) for (const b of names) {
      expect(Math.sign(server.compareProofFilenames(a, b))).toBe(Math.sign(schema.compareProofFilenames(a, b)));
    }
  });
  it("assigns and validates identically", () => {
    const items = names.map((name, index) => item(`k${index}`, name));
    const first = schema.assignProofReferences(items, schema.NEVER_PUBLISHED);
    expect(server.assignProofReferences(items, server.NEVER_PUBLISHED)).toEqual(first);
    const published = { highWater: first.highWater, references: Object.fromEntries(items.slice(0, 5).map((entry) => [entry._key, { reference: first.references[entry._key], assetRef: entry.assetRef }])) };
    const next = [...items.slice(2, 5), item("new1", "IMG_1.jpg"), item("new2", "IMG_0.jpg")];
    expect(server.assignProofReferences(next, published)).toEqual(schema.assignProofReferences(next, published));
    const withRefs = next.map((entry) => ({ ...entry, reference: schema.assignProofReferences(next, published).references[entry._key] }));
    for (const highWater of [first.highWater, first.highWater + 2, 3]) {
      expect(server.proofReferenceProblem(withRefs, highWater, published)).toBe(schema.proofReferenceProblem(withRefs, highWater, published));
    }
    const replaced = withRefs.map((entry, index) => index === 0 ? { ...entry, assetRef: "asset-other" } : entry);
    expect(server.proofReferenceProblem(replaced, first.highWater + 2, published)).toBe(schema.proofReferenceProblem(replaced, first.highWater + 2, published));
  });
});
