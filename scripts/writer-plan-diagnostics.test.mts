import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseServicePlanBytes } from "./write-sanity-services.mts";
import { parseCategoryPlanBytes } from "./write-sanity-categories.mts";
import { parseFoundationPlanBytes } from "./write-sanity-foundation.mts";
const roles = [{ role: "services", name: "service", parser: parseServicePlanBytes }, { role: "categories", name: "category", parser: parseCategoryPlanBytes }, { role: "foundation", name: "foundation", parser: parseFoundationPlanBytes }];
const bad = [Buffer.alloc(0), Buffer.from('{"SYNTHETIC_PRIVATE":"unterminated'), Buffer.from('{"SYNTHETIC_PRIVATE":1} extra'), Buffer.from('﻿{"SYNTHETIC_PRIVATE":1}'), Buffer.concat([Buffer.from('{"SYNTHETIC_PRIVATE":"'), Buffer.from([0xff]), Buffer.from('"}')])];
describe.each(roles)("fixed $name plan diagnostics (AB#244)", ({ role, name, parser }) => {
  it.each(bad.map((bytes, index) => ({ bytes, index })))("rejects malformed bytes $index without echo or native cause", ({ bytes }) => {
    const error = (() => { try { parser(bytes); } catch (cause) { return cause; } })();
    expect(error).toBeInstanceOf(Error); expect((error as Error).message).toBe(`${name} plan must be valid UTF-8 JSON without a BOM`);
    expect(String(error)).not.toContain("SYNTHETIC_PRIVATE"); expect(error).not.toHaveProperty("cause");
  });
  it("preserves valid Unicode and literal replacement characters", () => {
    const value = { text: "Å 😀 \uFFFD" }; expect(parser(Buffer.from(JSON.stringify(value)))).toEqual(value);
  });
  it("stops the --yes CLI before credential resolution or any network access", async () => {
    const dir = await mkdtemp(join(tmpdir(), "writer-diagnostics-"));
    try {
      const path = join(dir, "plan.json"); await writeFile(path, bad[2]);
      const guard = "data:text/javascript," + encodeURIComponent("globalThis.fetch = () => { console.error('UNEXPECTED_NETWORK'); process.exit(86); };");
      const result = await promisify(execFile)(process.execPath, ["--import", guard, join(import.meta.dirname, `write-sanity-${role}.mts`), "--plan", path, "--yes", "--approved-digest", "a".repeat(64)], { env: { NODE_ENV: "test", NODE_NO_WARNINGS: "1" } }).then(x => ({ code: 0, ...x }), (x: { code: number; stdout: string; stderr: string }) => x);
      expect(result.code).toBe(1); expect(result.stdout).toBe("");
      expect(result.stderr).toBe(`${name[0].toUpperCase()}${name.slice(1)} write failed: ${name} plan must be valid UTF-8 JSON without a BOM\n`);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
