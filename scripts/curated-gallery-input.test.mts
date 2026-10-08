import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main, readCuratedJsonFile } from "./joomla-curated-gallery-plan.mts";

const dirs: string[] = [];
async function folder() { const dir = await mkdtemp(path.join(tmpdir(), "curated-input-")); dirs.push(dir); return dir; }
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
describe("curated JSON byte integrity", () => {
  it.each(["input", "approval"] as const)("preserves valid Unicode and literal U+FFFD in %s", async role => {
    const dir = await folder(); const file = path.join(dir, "fixture.json"); const value = { note: "Ää 📷 �" }; await writeFile(file, JSON.stringify(value));
    expect(await readCuratedJsonFile(file, role)).toEqual(value);
  });
  it.each(["input", "approval"] as const)("refuses malformed bytes, BOM and JSON in %s without changing an output", async role => {
    const dir = await folder(); const input = path.join(dir, "input.json"); const approval = path.join(dir, "approval.json"); const out = path.join(dir, "output.json");
    await writeFile(out, "existing owner evidence");
    for (const bytes of [Buffer.from([0xff]), Buffer.from([0xc3]), Buffer.from([0xc0, 0xaf]), Buffer.from([0xed, 0xa0, 0x80])]) {
      await writeFile(input, '{}'); await writeFile(approval, '{}');
      await writeFile(role === "input" ? input : approval, Buffer.concat([Buffer.from('{"private":"'), bytes, Buffer.from('"}')]));
      await expect(main([input, out, approval])).rejects.toThrow(`Curated-gallery ${role} must be valid`);
      expect(await readFile(out, "utf8")).toBe("existing owner evidence");
    }
    for (const text of ['\uFEFF{}', '{"private-fixture":']) {
      await writeFile(role === "input" ? input : approval, text);
      await expect(readCuratedJsonFile(role === "input" ? input : approval, role)).rejects.toThrow(`Curated-gallery ${role} must be valid`);
    }
  });
});
