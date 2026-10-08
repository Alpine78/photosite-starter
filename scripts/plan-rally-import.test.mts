import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readIdentities, readJsonFile } from "./plan-rally-import.mts";
let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "rally-reader-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const empty = { version: 1, byContentHash: {} };
const invalidBytes = Buffer.concat([Buffer.from('{"label":"'), Buffer.from([0xff]), Buffer.from('"}')]);
describe("strict offline rally inputs", () => {
  it("allows a genuinely absent identity map", async () => {
    expect(await readIdentities(root)).toEqual(empty);
    expect(await readdir(root)).toEqual([]);
  });
  it("refuses unreadable maps rather than treating them as absent", async () => {
    await mkdir(path.join(root, "rally-identities.json"));
    await expect(readIdentities(root)).rejects.toThrow("restore it from a backup");
  });
  it("refuses a dangling identity-map symlink", async () => {
    await symlink(path.join(root, "missing-target"), path.join(root, "rally-identities.json"));
    await expect(readIdentities(root)).rejects.toThrow("restore it from a backup");
    expect(await readdir(root)).toEqual(["rally-identities.json"]);
  });
  it.each([invalidBytes, Buffer.concat([Buffer.from('{"label":"'), Buffer.from([0xe2, 0x82])]), Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d])])
    ("refuses invalid bytes or a BOM in manifest JSON", async (bytes) => {
      const file = path.join(root, "rally.json"); await writeFile(file, bytes);
      await expect(readJsonFile(file, "manifest")).rejects.toThrow(/not valid (UTF-8|JSON)/);
      expect(await readFile(file)).toEqual(bytes);
    });
  it("reports absent and unreadable manifest inputs separately", async () => {
    await expect(readJsonFile(path.join(root, "missing"), "manifest")).rejects.toThrow("was not found");
    await expect(readJsonFile(root, "manifest")).rejects.toThrow("could not be read");
  });
  it.each([Buffer.from('{'), invalidBytes])("preserves corrupt identity-map bytes without creating outputs", async (bytes) => {
    const file = path.join(root, "rally-identities.json"); await writeFile(file, bytes);
    await expect(readIdentities(root)).rejects.toThrow("restore it from a backup");
    expect(await readFile(file)).toEqual(bytes);
    expect(await readdir(root)).toEqual(["rally-identities.json"]);
  });
  it("checks an existing corrupt map before writing even a manifest-error report", async () => {
    const folder = path.join(root, "input"), out = path.join(root, "out");
    await mkdir(folder); await mkdir(out);
    await writeFile(path.join(folder, "rally.json"), "{}");
    const map = path.join(out, "rally-identities.json"); await writeFile(map, "{");
    await expect(promisify(execFile)(process.execPath, [fileURLToPath(new URL("./plan-rally-import.mts", import.meta.url)), "--folder", folder, "--out", out]))
      .rejects.toMatchObject({ stderr: expect.stringContaining("restore it from a backup") });
    expect(await readFile(map, "utf8")).toBe("{");
    expect(await readdir(out)).toEqual(["rally-identities.json"]);
  });
  it("accepts valid Unicode and a literal replacement character without altering identities", async () => {
    const file = path.join(root, "rally.json"); const raw = { label: "Ralli \u00e4 \ufffd" };
    await writeFile(file, JSON.stringify(raw)); expect(await readJsonFile(file, "manifest")).toEqual(raw);
    const identities = { version: 1, byContentHash: { ["a".repeat(64)]: "rally-synthetic-1" } };
    await writeFile(path.join(root, "rally-identities.json"), JSON.stringify(identities));
    expect(await readIdentities(root)).toEqual(identities);
  });
});
