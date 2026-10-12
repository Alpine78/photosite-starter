import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fixture, ndjson } from "./identity-change-plan-fixture.mts";
import { canonicalJson } from "./identity-retirement-reconciliation.mts";
import { main, parseArguments } from "./plan-identity-aliases.mts";

const folders: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))); });
async function inputs() {
  const f = fixture(), input = f.makeInput();
  const folder = await mkdtemp(path.join(os.tmpdir(), "alias-plan-test-")); folders.push(folder); await chmod(folder, 0o700);
  const args: string[] = [];
  for (const key of ["map", "approval", "baseline", "snapshot"] as const) {
    const name = path.join(folder, key); await writeFile(name, input[key], { mode: 0o600 }); args.push(`--${key}`, name);
  }
  const out = path.join(folder, "plans"); args.push("--approved-digest", input.approvedDigest, "--out", out);
  return { ...f, input, args, folder, out };
}

describe("local identity alias planner CLI", () => {
  it("accepts exactly the six required flags; no write, target, record or budget options", async () => {
    const f = await inputs(); expect(Object.keys(parseArguments(f.args))).toHaveLength(6);
    for (const flag of ["yes", "write", "target", "record-id", "source", "payload-bytes", "plan-bytes", "max-documents-per-batch"]) {
      expect(() => parseArguments([...f.args, `--${flag}`, "value"])).toThrow("INVALID_ARGUMENTS");
    }
    for (const args of [[], f.args.slice(2), [...f.args, "--map", "repeat"], [...f.args, "--out"], ["map", "file"], ["--map", "--out"]]) expect(() => parseArguments(args)).toThrow(/ARGUMENTS/u);
    vi.stubEnv("SITE_IDENTITY_ALIAS_MODE", "renamed"); vi.stubEnv("SITE_IDENTITY_ALIAS_RECORD_ID", "private-record");
    expect(() => parseArguments([])).toThrow("MISSING_ARGUMENTS");
  });

  it("writes a canonical private non-executable wrapper once and logs pins/counts only", async () => {
    const f = await inputs(), log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await main(f.args)).toBe(0);
    const output = path.join(f.out, "identity-alias-plan.json"), contents = await readFile(output);
    const plan = JSON.parse(contents.toString());
    expect(contents.toString()).toBe(`${canonicalJson(plan)}\n`);
    expect(plan.version).toBe("identity-alias-plan-v1"); expect(plan.writable).toBe(false); expect(plan.cutoverReady).toBe(false);
    if (process.platform !== "win32") { expect((await stat(output)).mode & 0o777).toBe(0o600); expect((await stat(f.out)).mode & 0o777).toBe(0o700); }
    const stdout = log.mock.calls.flat().join(" ");
    expect(stdout).not.toMatch(/joomla|category-trips|article-fi|alias-plan-test|aliases|baseline|snapshot|payload"/u);
    expect(JSON.parse(stdout)).toMatchObject({ pins: plan.pins, canonicalByteCount: plan.canonicalByteCount, familyCounts: plan.familyCounts, writable: false, cutoverReady: false });
    await expect(main(f.args)).rejects.toThrow("OUTPUT_EXISTS_OR_UNAVAILABLE"); expect(await readFile(output)).toEqual(contents);
    for (const key of ["map", "approval", "baseline", "snapshot"] as const) expect(await readFile(path.join(f.folder, key))).toEqual(f.input[key]);
  });

  it("creates no output when reconciliation refuses drift", async () => {
    const f = await inputs(); f.documents[1]._rev = "r2"; await writeFile(path.join(f.folder, "snapshot"), ndjson(f.documents));
    await expect(main(f.args)).rejects.toThrow("RECONCILIATION_BLOCKED"); await expect(stat(f.out)).rejects.toThrow();
  });

  it("preserves existing private-output, input-alias and Git-ignore boundaries", async () => {
    const f = await inputs(); execFileSync("git", ["init", "-q", f.folder]);
    await expect(main(f.args)).rejects.toThrow("OUTPUT_NOT_IGNORED");
    await writeFile(path.join(f.folder, ".gitignore"), "plans/\n");
    await chmod(f.out, 0o755);
    if (process.platform !== "win32") await expect(main(f.args)).rejects.toThrow("OUTPUT_NOT_PRIVATE");
    await chmod(f.out, 0o700);
    await expect(main([...f.args.slice(0, -1), f.folder])).rejects.toThrow("OUTPUT_INPUT_ALIAS");
    vi.spyOn(console, "log").mockImplementation(() => {}); expect(await main(f.args)).toBe(0);
  });

  it("runs directly on pinned Node and prints only static errors, never private input", async () => {
    const f = await inputs(), script = fileURLToPath(new URL("./plan-identity-aliases.mts", import.meta.url));
    const stdout = execFileSync(process.execPath, [script, ...f.args], { env: { PATH: process.env.PATH, NODE_ENV: "test" }, encoding: "utf8", stdio: "pipe" });
    expect(JSON.parse(stdout).pins.expectedRowCount).toBe(5);
    expect(stdout).not.toMatch(/joomla|category-trips|article-fi|alias-plan-test|aliases/u);
    for (const [args, code] of [
      [f.args, "OUTPUT_EXISTS_OR_UNAVAILABLE"],
      [[...f.args, "--yes", "private-value"], "INVALID_ARGUMENTS"],
      [[...f.args.slice(0, 1), path.join(f.folder, "private-missing"), ...f.args.slice(2)], "IDENTITY_ALIAS_PLAN_IO_FAILED"],
    ] as const) {
      try { execFileSync(process.execPath, [script, ...args], { env: { PATH: process.env.PATH, NODE_ENV: "test" }, encoding: "utf8", stdio: "pipe" }); expect.fail("expected static failure"); }
      catch (error) { const failure = error as { status: number; stderr: string; stdout: string }; expect(failure.status).toBe(1); expect(failure.stderr.trim()).toBe(code); expect(failure.stdout).toBe(""); }
    }
  });
});
