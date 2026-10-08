import { mkdtemp, mkdir, readFile, rm, symlink, lstat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { planIntroSummaries } from "./joomla-intro-summary.mts";
import { persistRecoveryRecord, readRecoveryRecord } from "./write-joomla-intro-summary.mts";

const dirs: string[] = [];
async function folder() { const dir = await mkdtemp(path.join(tmpdir(), "intro-recovery-")); dirs.push(dir); return dir; }
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
const plan = planIntroSummaries([{ _id: "gallery-fi", _rev: "rev-a", _type: "gallery", contentId: "fixture", language: "fi",
  body: [{ _key: "intro", _type: "contentParagraphBlock", text: "Ää 📷 �" }, { _key: "body", _type: "contentParagraphBlock", text: "Full text" }] }],
{ projectId: "abc123", dataset: "preview" });
const file = (dir: string) => path.join(dir, `intro-summary-approved-${plan.digest}.json`);
describe("intro recovery file integrity", () => {
  it("returns missing only for a genuinely absent entry", async () => {
    expect(await readRecoveryRecord(await folder(), plan.digest)).toBeUndefined();
  });
  it("preserves valid Unicode, a literal U+FFFD and approved digest through an exact rerun", async () => {
    const dir = await folder(); await persistRecoveryRecord(dir, plan);
    const bytes = await readFile(file(dir));
    expect(await readRecoveryRecord(dir, plan.digest)).toEqual(plan);
    await persistRecoveryRecord(dir, plan);
    expect(await readFile(file(dir))).toEqual(bytes);
  });
  it.each([[0xff], [0xc3], [0xc0, 0xaf], [0xed, 0xa0, 0x80]].map(bytes => ({ bytes })))("refuses corrupt bytes that could replace an approved character %#", async ({ bytes }) => {
    const dir = await folder(); const json = JSON.stringify(plan); const index = json.indexOf("�");
    const damaged = Buffer.concat([Buffer.from(json.slice(0, index)), Buffer.from(bytes), Buffer.from(json.slice(index + 1))]);
    await writeFile(file(dir), damaged);
    await expect(readRecoveryRecord(dir, plan.digest)).rejects.toThrow("record is invalid");
    await expect(persistRecoveryRecord(dir, plan)).rejects.toThrow("record is invalid");
    expect(await readFile(file(dir))).toEqual(damaged);
  });
  it("refuses BOM, malformed JSON and a changed approval digest", async () => {
    const dir = await folder();
    for (const text of [`\uFEFF${JSON.stringify(plan)}`, '{"private":', JSON.stringify({ ...plan, digest: "0".repeat(64) })]) {
      await writeFile(file(dir), text);
      await expect(readRecoveryRecord(dir, plan.digest)).rejects.toThrow("record is invalid");
    }
  });
  it("refuses dangling links without replacing them or creating their target", async () => {
    const dir = await folder(); const target = path.join(dir, "missing-target"); await symlink(target, file(dir));
    await expect(readRecoveryRecord(dir, plan.digest)).rejects.toThrow("entry cannot be read");
    await expect(persistRecoveryRecord(dir, plan)).rejects.toThrow("entry cannot be read");
    expect((await lstat(file(dir))).isSymbolicLink()).toBe(true);
    await expect(lstat(target)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("accepts an existing link to an intact regular record but refuses a directory", async () => {
    const dir = await folder(); const target = path.join(dir, "intact.json"); await writeFile(target, JSON.stringify(plan)); await symlink(target, file(dir));
    expect(await readRecoveryRecord(dir, plan.digest)).toEqual(plan);
    await rm(file(dir)); await mkdir(file(dir));
    await expect(readRecoveryRecord(dir, plan.digest)).rejects.toThrow("entry cannot be read");
  });
});
