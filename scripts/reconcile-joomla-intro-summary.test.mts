import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main, parseArguments } from "./reconcile-joomla-intro-summary.mts";
import { main as writerMain } from "./write-joomla-intro-summary.mts";
import * as recovery from "./intro-summary-recovery.mts";
import { planIntroSummaries, type IntroSummaryPlan } from "./joomla-intro-summary.mts";

const source = (id: string) => ({ _id: id, _rev: "before", _type: "article", contentId: id, language: "fi",
  body: [{ _key: "intro", _type: "contentParagraphBlock", text: "Existing excerpt" }, { _key: "body", _type: "contentParagraphBlock", text: "Remaining body" }] });
const rows = [source("first-fi"), source("second-fi")];
const plan = planIntroSummaries(rows, { projectId: "abc123", dataset: "preview" });
const applied = (row: typeof rows[number]) => ({ ...row, _rev: "after", summary: "Existing excerpt", summaryListingOnly: true, body: row.body.slice(1) });
const env = { SANITY_PROJECT_ID: "abc123", SANITY_DATASET: "preview", SANITY_API_VERSION: "v2025-02-19", SANITY_AUDIT_TOKEN: "fixture-viewer" };
const dirs: string[] = [];
let output: ReturnType<typeof vi.spyOn>, errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => { output = vi.spyOn(console, "log").mockImplementation(() => {}); errors = vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function fixture(record: IntroSummaryPlan = plan) {
  const dir = await mkdtemp(path.join(tmpdir(), "intro-readonly-")); dirs.push(dir);
  await writeFile(path.join(dir, `intro-summary-approved-${record.digest}.json`), JSON.stringify(record));
  return { dir, args: ["--out", dir, "--approved-digest", record.digest] };
}
function provider(result: unknown, status = 200) {
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    expect(init?.method).toBe("GET");
    return new Response(JSON.stringify({ result }), { status });
  });
  vi.stubGlobal("fetch", fetch); return fetch;
}
async function report(dir: string) {
  const names = (await readdir(dir)).filter(name => name.startsWith("intro-summary-readonly-"));
  expect(names).toHaveLength(1); return JSON.parse(await readFile(path.join(dir, names[0]), "utf8"));
}

describe("mutation-free intro diagnosis", () => {
  it.each([
    { label: "all pending", current: rows, exit: 2, counts: [0, 2, 0] },
    { label: "all applied", current: rows.map(applied), exit: 0, counts: [2, 0, 0] },
    { label: "partial", current: [applied(rows[0]), rows[1]], exit: 2, counts: [1, 1, 0] },
    { label: "unexpected", current: [{ ...rows[0], _rev: "other", body: [] }], exit: 2, counts: [0, 0, 2] },
  ])("$label never sends a transaction", async ({ current, exit, counts }) => {
    const { dir, args } = await fixture(); const fetch = provider(current);
    const reads: string[] = [];
    const guarded = new Proxy(env, { get(target, key) { reads.push(String(key)); if (key === "NEXT_PUBLIC_SANITY_AUDIT_TOKEN") return undefined;
      if (typeof key !== "string" || !(key in target)) throw Error("Forbidden environment key"); return target[key as keyof typeof env]; }, ownKeys() { throw Error("Must not enumerate environment"); } });
    expect(await main(args, guarded)).toBe(exit);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]; expect(new URL(String(url)).searchParams.get("perspective")).toBe("raw");
    expect(init?.headers).toEqual({ Accept: "application/json", Authorization: "Bearer fixture-viewer" });
    expect(reads).not.toContain("SANITY_MIGRATION_TOKEN"); expect(reads).not.toContain("SANITY_SEED_TOKEN");
    const r = await report(dir); expect([r.applied.length, r.pending.length, r.unexpected.length]).toEqual(counts);
    expect(r.providerWritesAttemptedByThisTool).toBe(false); expect(r.readOnly).toBe(true); expect(r.perspective).toBe("raw");
    expect(Date.parse(r.readCompletedAt)).toBeGreaterThanOrEqual(Date.parse(r.readStartedAt));
    expect(JSON.stringify(r)).not.toContain(env.SANITY_AUDIT_TOKEN);
  });

  it.each(["drafts.first-fi", "versions.release-a.first-fi"])("reports %s without claiming completion", async versionId => {
    const { dir, args } = await fixture(); const fetch = provider([...rows.map(applied), { ...rows[0], _id: versionId }]);
    expect(await main(args, env)).toBe(2); expect(fetch).toHaveBeenCalledTimes(1);
    expect((await report(dir)).versions).toEqual([versionId]);
  });

  it.each([{}, [rows[0], rows[0]], [{ _id: "bad" }], [{ ...rows[0], _type: "private" }]])("refuses malformed raw rows %#", async value => {
    const { dir, args } = await fixture(); const fetch = provider(value);
    expect(await main(args, env)).toBe(1); expect(fetch).toHaveBeenCalledTimes(1);
    expect((await readdir(dir)).filter(n => n.startsWith("intro-summary-readonly-"))).toEqual([]);
  });

  it.each(["http401", "invalid-json", "transport"])("redacts %s provider failures", async failure => {
    const { dir, args } = await fixture(); const canary = "sensitive-provider-canary\nprivate message";
    const fetch = vi.fn(async () => { if (failure === "transport") throw Error(canary);
      return new Response(canary, { status: failure === "http401" ? 401 : 200 }); });
    vi.stubGlobal("fetch", fetch); expect(await main(args, env)).toBe(1); expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([...output.mock.calls, ...errors.mock.calls])).not.toContain(canary);
    expect((await readdir(dir)).filter(n => n.startsWith("intro-summary-readonly-"))).toEqual([]);
  });

  it.each(["--yes", "--token=secret-canary", "--category-refs", "--out"])("rejects %s before record/environment/provider access", async bad => {
    const read = vi.spyOn(recovery, "readRecoveryRecord"); const fetch = provider(rows);
    const getters = vi.fn(() => { throw Error("environment access"); });
    const args = ["--out", "missing", "--approved-digest", plan.digest, bad];
    expect(await main(args, new Proxy({}, { get: getters }))).toBe(1);
    expect(read).not.toHaveBeenCalled(); expect(getters).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(errors.mock.calls)).not.toContain("secret-canary");
  });

  it("refuses missing, tampered and unsupported/empty records before GET", async () => {
    const { dir, args } = await fixture(); const file = path.join(dir, `intro-summary-approved-${plan.digest}.json`); const fetch = provider(rows);
    await rm(file); expect(await main(args, env)).toBe(1);
    await writeFile(file, JSON.stringify({ ...plan, version: "future-version" })); expect(await main(args, env)).toBe(1);
    await writeFile(file, JSON.stringify({ ...plan, changes: [] })); expect(await main(args, env)).toBe(1);
    await writeFile(file, new Uint8Array([0xff])); expect(await main(args, env)).toBe(1);
    const empty = planIntroSummaries([], plan.target); const emptyFixture = await fixture(empty); expect(await main(emptyFixture.args, env)).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("checks the target before audit-token access and refuses public credentials", async () => {
    const { args } = await fixture(); const fetch = provider(rows); const token = vi.fn(() => { throw Error("must not read token"); });
    const wrong = { ...env, SANITY_PROJECT_ID: "different" }; Object.defineProperty(wrong, "SANITY_AUDIT_TOKEN", { get: token });
    expect(await main(args, wrong)).toBe(1); expect(token).not.toHaveBeenCalled();
    expect(await main(args, { ...env, NEXT_PUBLIC_SANITY_AUDIT_TOKEN: "private-canary" })).toBe(1);
    expect(fetch).not.toHaveBeenCalled(); expect(JSON.stringify(errors.mock.calls)).not.toContain("private-canary");
  });

  it("accepts an intact recovery symlink and keeps distinct reports without replacing a symlink", async () => {
    const { dir, args } = await fixture(); const file = path.join(dir, `intro-summary-approved-${plan.digest}.json`);
    const target = path.join(dir, "intact.json"); await writeFile(target, await readFile(file)); await rm(file); await symlink(target, file);
    const sentinel = path.join(dir, "operator-notes.txt"); await writeFile(sentinel, "preserve");
    await symlink(sentinel, path.join(dir, "intro-summary-readonly-reconciliation.json")); provider(rows.map(applied));
    expect(await main(args, env)).toBe(0); expect(await main(args, env)).toBe(0);
    expect(await readFile(sentinel, "utf8")).toBe("preserve");
    expect((await readdir(dir)).filter(n => /^intro-summary-readonly-[0-9a-f]{12}-/.test(n))).toHaveLength(2);
  });

  it("the existing writer directs an uncertain pending result to read-only diagnosis without changing retry behavior", async () => {
    const { args } = await fixture();
    vi.stubEnv("SANITY_MIGRATION_TOKEN", "fixture-writer");
    vi.stubEnv("NEXT_PUBLIC_SANITY_MIGRATION_TOKEN", "");
    const methods: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      methods.push(init.method ?? "");
      if (init.method === "POST") return new Response("provider-sensitive-canary", { status: 503 });
      expect(init.method).toBe("GET");
      const query = new URL(url).searchParams.get("query") ?? "";
      return new Response(JSON.stringify({ result: query.endsWith("]._id") ? rows.map(row => row._id) : rows }));
    }));
    const previousExit = process.exitCode;
    try {
      await writerMain([...args, "--yes", "--project", env.SANITY_PROJECT_ID, "--dataset", env.SANITY_DATASET, "--api-version", env.SANITY_API_VERSION]);
      expect(process.exitCode).toBe(1);
    } finally { process.exitCode = previousExit; }
    expect(methods.filter(method => method === "POST")).toHaveLength(1);
    const guidance = JSON.stringify(errors.mock.calls);
    expect(guidance).toContain("npm run reconcile:joomla-intro");
    expect(guidance).toContain("Do not automatically retry");
    expect(guidance).not.toContain("re-run the same command");
    expect(guidance).not.toContain("provider-sensitive-canary");
  });

  it("rejects duplicate options and missing values", () => {
    expect(() => parseArguments(["--out", "a", "--out", "b"])).toThrow("Duplicate");
    expect(() => parseArguments(["--out", "--yes"])).toThrow("missing");
  });

  it("native entry preserves pending exit2 and complete output; import alone has no IO", async () => {
    const { dir, args } = await fixture();
    const cli = path.resolve("scripts/reconcile-joomla-intro-summary.mts");
    const preload = path.join(dir, "read-fixture.mjs");
    await writeFile(preload, `globalThis.fetch=async (_url,init)=>{if(init.method!=="GET")throw Error("mutation attempted");return new Response(${JSON.stringify(JSON.stringify({ result: rows }))});};`);
    const child = spawnSync(process.execPath, ["--import", preload, cli, ...args], { encoding: "utf8", env: { NODE_ENV: "test", PATH: process.env.PATH, ...env } });
    expect(child.error).toBeUndefined(); expect(child.status).toBe(2);
    expect(child.stdout).toContain("pending 2"); expect(child.stdout).toContain("may still commit later."); expect(child.stderr).toBe("");
    const imported = spawnSync(process.execPath, ["--input-type=module", "-e", `globalThis.fetch=()=>{throw Error("unexpected IO")};await import(${JSON.stringify(pathToFileURL(cli).href)});console.log("import-safe")`], { encoding: "utf8", env: { NODE_ENV: "test", PATH: process.env.PATH } });
    expect(imported.status).toBe(0); expect(imported.stdout).toBe("import-safe\n"); expect(imported.stderr).toBe("");
  });
});
