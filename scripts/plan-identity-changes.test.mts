import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fixture, ndjson } from "./identity-change-plan-fixture.mts";
import { main, parseArguments } from "./plan-identity-changes.mts";

const folders: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))); });
async function inputs() {
  const f = fixture(), input = f.makeInput();
  const folder = await mkdtemp(path.join(os.tmpdir(), "identity-plan-test-")); folders.push(folder); await chmod(folder, 0o700);
  const args: string[] = [];
  for (const key of ["map", "approval", "baseline", "snapshot"] as const) {
    const name = path.join(folder, key); await writeFile(name, input[key], { mode: 0o600 }); args.push(`--${key}`, name);
  }
  const out = path.join(folder, "plans"); args.push("--approved-digest", input.approvedDigest, "--out", out);
  return { ...f, input, args, folder, out };
}
describe("offline identity change planner CLI", () => {
  it("defaults to 50, accepts 1..100 and refuses ambiguous decimal forms and flags", async () => {
    const f = await inputs(); expect(parseArguments(f.args).maxDocumentsPerBatch).toBe(50);
    for (const value of ["1", "50", "100"]) expect(parseArguments([...f.args, "--max-documents-per-batch", value]).maxDocumentsPerBatch).toBe(Number(value));
    for (const value of ["050", "+5", "1e1", " 5", "0x10", "0", "101", "1.5", "NaN"]) expect(() => parseArguments([...f.args, "--max-documents-per-batch", value])).toThrow("INVALID_BATCH_LIMIT");
    for (const args of [[], [...f.args, "--yes", "true"], [...f.args, "--map", "repeat"], [...f.args, "--max-documents-per-batch"], [...f.args, "--max-documents-per-batch", "5", "--max-documents-per-batch", "6"]]) expect(() => parseArguments(args)).toThrow(/ARGUMENTS/u);
  });
  it("writes private immutable output and logs counts/digest only", async () => {
    const f = await inputs(), log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await main(f.args)).toBe(0);
    const output = path.join(f.out, "identity-change-plan.json"), contents = await readFile(output);
    const plan = JSON.parse(contents.toString()); expect(plan.writable).toBe(false); expect(plan.cutoverReady).toBe(false);
    if (process.platform !== "win32") { expect((await stat(output)).mode & 0o777).toBe(0o600); expect((await stat(f.out)).mode & 0o777).toBe(0o700); }
    expect(log.mock.calls.flat().join(" ")).not.toMatch(/joomla|category-trips|article-fi|identity-plan-test/u);
    await expect(main(f.args)).rejects.toThrow("OUTPUT_EXISTS_OR_UNAVAILABLE"); expect(await readFile(output)).toEqual(contents);
    for (const key of ["map", "approval", "baseline", "snapshot"] as const) expect(await readFile(path.join(f.folder, key))).toEqual(f.input[key]);
  });
  it("produces no artifact when reconciliation or indivisible group validation fails", async () => {
    const f = await inputs();
    await expect(main([...f.args, "--max-documents-per-batch", "1"])).rejects.toThrow("IDENTITY_GROUP_LIMIT");
    await expect(stat(f.out)).rejects.toThrow();
    f.documents[1]._rev = "r2"; await writeFile(path.join(f.folder, "snapshot"), ndjson(f.documents));
    await expect(main(f.args)).rejects.toThrow("RECONCILIATION_BLOCKED"); await expect(stat(f.out)).rejects.toThrow();
  });
  it("uses the same Git-ignore boundary as reconciliation", async () => {
    const f = await inputs(); execFileSync("git", ["init", "-q", f.folder]);
    await expect(main(f.args)).rejects.toThrow("OUTPUT_NOT_IGNORED");
    await writeFile(path.join(f.folder, ".gitignore"), "plans/\n"); vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await main(f.args)).toBe(0);
  });
  it("prints static errors for group and IO failures without private values", async () => {
    const f = await inputs(), script = fileURLToPath(new URL("./plan-identity-changes.mts", import.meta.url));
    for (const [args, code] of [[ [...f.args, "--max-documents-per-batch", "1"], "IDENTITY_GROUP_LIMIT" ], [[...f.args.slice(0, 1), path.join(f.folder, "private-missing"), ...f.args.slice(2)], "IDENTITY_PLAN_IO_FAILED"]] as const) {
      try { execFileSync(process.execPath, [script, ...args], { env: { PATH: process.env.PATH, NODE_ENV: "test" }, encoding: "utf8", stdio: "pipe" }); expect.fail("expected static failure"); }
      catch (error) { const failure = error as { status: number; stderr: string; stdout: string }; expect(failure.status).toBe(1); expect(failure.stderr.trim()).toBe(code); expect(failure.stdout).toBe(""); }
    }
  });
});
