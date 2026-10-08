import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readArtifacts } from "./plan-rally-conversion.mts";
let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "rally-artifacts-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const error = "could not read valid UTF-8 JSON from --artifacts; check every .json file in that directory";
const asset = { mediaId: "synthetic-media", contentHash: "A".repeat(64), sourceLocator: "archive/\u00e4-\ufffd.jpg" };
describe("strict conversion artifact reads", () => {
  it.each([Buffer.from("{"), Buffer.alloc(0), Buffer.concat([Buffer.from('{"source":"'), Buffer.from([0xff]), Buffer.from('"}')]), Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d])])
    ("refuses corrupt JSON without exposing its contents or path", async (bytes) => {
      const file = path.join(root, "corrupt.json"); await writeFile(file, bytes);
      await expect(readArtifacts(root)).rejects.toThrow(error);
      expect(await readFile(file)).toEqual(bytes);
    });
  it("refuses unreadable .json entries and directory listing failures", async () => {
    await mkdir(path.join(root, "unreadable.json"));
    await expect(readArtifacts(root)).rejects.toThrow(error);
    await expect(readArtifacts(path.join(root, "absent"))).rejects.toThrow(error);
  });
  it("retains sorted valid requirements and ignores valid unrelated JSON and non-JSON files", async () => {
    await writeFile(path.join(root, "b.json"), JSON.stringify({ assetRequirements: [asset] }));
    await writeFile(path.join(root, "a.json"), JSON.stringify({ assetRequirements: [{ ...asset, mediaId: "first" }] }));
    for (const [index, value] of [null, 42, "report", { counts: 2 }].entries())
      await writeFile(path.join(root, `report-${index}.json`), JSON.stringify(value));
    await writeFile(path.join(root, "ignored.txt"), "{");
    expect(await readArtifacts(root)).toEqual([{ ...asset, mediaId: "first", contentHash: asset.contentHash.toLowerCase() }, { ...asset, contentHash: asset.contentHash.toLowerCase() }]);
  });
});
