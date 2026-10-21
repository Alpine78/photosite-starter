import { describe, expect, it } from "vitest";
import {
  candidateProblems, ciPassedFor, compareRouting, deployedUrl, redirectsTo, productionDomainNames, protectionProblems, readiness, vercelEnvironmentProblems, parseAliases, productionBaseline,
  promotedRoutingProblems, releaseSourceProblems, rollbackCommand, smokePaths, smokeProblems, stageReceiptProblems,
  type Alias,
} from "./production-release.mts";
import { check, promote, stage, ReleaseStop, type Io } from "./release-production.mts";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHA = "a".repeat(40), OTHER = "b".repeat(40);
const PREV = "dpl_previous1", CAND = "dpl_candidate1", PREVIEW = "dpl_preview1";
const PROJECT = "prj_project1", TEAM = "team_team1";
const domains = ["example.com", "www.example.com", "site.vercel.app"];
const inventory = (prod: string, generated = prod): Alias[] => [
  { alias: "example.com", deploymentId: prod, redirect: "www.example.com" },
  { alias: "www.example.com", deploymentId: prod, redirect: null },
  { alias: "site.vercel.app", deploymentId: prod, redirect: null },
  { alias: "site-team.vercel.app", deploymentId: generated, redirect: null },
  { alias: "site-preview.vercel.app", deploymentId: PREVIEW, redirect: null },
];
const baseline = productionBaseline(inventory(PREV), domains, PREV).baseline;

describe("release source", () => {
  it("accepts only a clean main exactly at origin/main", () => {
    expect(releaseSourceProblems({ branch: "main", porcelain: "", head: SHA, originMain: SHA })).toEqual([]);
    expect(releaseSourceProblems({ branch: "fix/1-x", porcelain: "", head: SHA, originMain: SHA })).toHaveLength(1);
    expect(releaseSourceProblems({ branch: "main", porcelain: "?? stray\n", head: SHA, originMain: SHA })).toHaveLength(1);
    expect(releaseSourceProblems({ branch: "main", porcelain: "", head: SHA, originMain: OTHER })).toHaveLength(1);
  });
  it("requires a completed, succeeded main run for the exact revision", () => {
    const run = { sourceVersion: SHA, sourceBranch: "refs/heads/main", status: "completed", result: "succeeded", reason: "individualCI" };
    expect(ciPassedFor([run], SHA)).toBe(true);
    expect(ciPassedFor([{ ...run, result: "failed" }], SHA)).toBe(false);
    expect(ciPassedFor([{ ...run, status: "inProgress" }], SHA)).toBe(false);
    expect(ciPassedFor([{ ...run, sourceBranch: "refs/pull/1/merge" }], SHA)).toBe(false);
    expect(ciPassedFor([run], OTHER)).toBe(false);
    expect(ciPassedFor([{ ...run, reason: "batchedCI" }], SHA)).toBe(true);
    expect(ciPassedFor([{ ...run, reason: "schedule" }], SHA)).toBe(false);
    expect(ciPassedFor([{ ...run, reason: undefined }], SHA)).toBe(false);
    expect(ciPassedFor("nope", SHA)).toBe(false);
  });
});

describe("alias inventory and routing", () => {
  it("parses complete pages and flags an unfinished one", () => {
    expect(parseAliases([{ aliases: inventory(PREV), pagination: { next: null } }]).complete).toBe(true);
    expect(parseAliases([{ aliases: inventory(PREV), pagination: { next: 123 } }]).complete).toBe(false);
    expect(parseAliases([{ nope: 1 }]).complete).toBe(false);
    expect(parseAliases([]).complete).toBe(false);
  });
  it("builds the baseline and refuses a split or missing project domain", () => {
    const { baseline: b, problems } = productionBaseline(inventory(PREV), domains, PREV);
    expect(problems).toEqual([]);
    expect(b.domains.map(d => d.alias)).toEqual(domains);
    expect(b.generated).toEqual(["site-team.vercel.app"]);
    expect(b.unrelated.map(a => a.alias)).toEqual(["site-preview.vercel.app"]);
    const split = inventory(PREV).map(a => a.alias === "www.example.com" ? { ...a, deploymentId: "dpl_other1" } : a);
    expect(productionBaseline(split, domains, PREV).problems).toHaveLength(1);
    expect(productionBaseline(inventory(PREV).slice(1), domains, PREV).problems).toHaveLength(1);
  });
  it("allows only generated aliases to follow a staged candidate", () => {
    expect(compareRouting(baseline, inventory(PREV), CAND)).toEqual({ problems: [], movedToCandidate: [] });
    expect(compareRouting(baseline, inventory(PREV, CAND), CAND)).toEqual({ problems: [], movedToCandidate: ["site-team.vercel.app"] });
    const domainMoved = inventory(PREV).map(a => a.alias === "www.example.com" ? { ...a, deploymentId: CAND } : a);
    expect(compareRouting(baseline, domainMoved, CAND).problems).toEqual(["project domain www.example.com now points at dpl_candidate1"]);
    const redirectChanged = inventory(PREV).map(a => a.alias === "example.com" ? { ...a, redirect: null } : a);
    expect(compareRouting(baseline, redirectChanged, CAND).problems).toHaveLength(1);
    expect(compareRouting(baseline, [...inventory(PREV), { alias: "new.vercel.app", deploymentId: CAND, redirect: null }], CAND).problems).toEqual(["new alias new.vercel.app appeared"]);
    const previewMoved = inventory(PREV).map(a => a.alias === "site-preview.vercel.app" ? { ...a, deploymentId: CAND } : a);
    expect(compareRouting(baseline, previewMoved, CAND).problems).toHaveLength(1);
  });
  it("refuses a generated alias that moved only after staging was accepted", () => {
    expect(compareRouting(baseline, inventory(PREV, CAND), CAND, []).problems).toHaveLength(1);
    expect(compareRouting(baseline, inventory(PREV, CAND), CAND, ["site-team.vercel.app"]).problems).toEqual([]);
  });
  it("keeps branch and custom-environment domains out of the production set", () => {
    const body = { domains: [{ name: "a.example" }, { name: "b.example", gitBranch: "dev" }, { name: "c.example", customEnvironmentId: "env_1" }], pagination: { next: null } };
    expect(productionDomainNames(body)).toEqual({ names: ["a.example"], complete: true });
    expect(productionDomainNames({ ...body, pagination: { next: 5 } }).complete).toBe(false);
    expect(productionDomainNames({}).complete).toBe(false);
  });
  it("refuses a promotion that also moved an unrelated alias", () => {
    const previewMoved = inventory(CAND).map(a => a.alias === "site-preview.vercel.app" ? { ...a, deploymentId: CAND } : a);
    expect(promotedRoutingProblems(baseline, previewMoved, CAND)).toEqual(["unrelated alias site-preview.vercel.app changed"]);
  });
  it("refuses a promotion where a new alias appeared", () => {
    const aliases = [...inventory(CAND), { alias: "new.vercel.app", deploymentId: "dpl_other1", redirect: null }];
    expect(promotedRoutingProblems(baseline, aliases, CAND)).toEqual(["new alias new.vercel.app appeared"]);
  });
  it("verifies promotion only when every production alias serves the candidate", () => {
    expect(promotedRoutingProblems(baseline, inventory(CAND), CAND)).toEqual([]);
    expect(promotedRoutingProblems(baseline, inventory(CAND, PREV), CAND)).toHaveLength(1);
    expect(promotedRoutingProblems(baseline, inventory(PREV), CAND)).toHaveLength(4);
  });
});

describe("smoke", () => {
  const sitemap = (locs: string[]) => `<?xml version="1.0"?><urlset xmlns="x">${locs.map(l => `<url><loc>${l}</loc></url>`).join("")}</urlset>`;
  it("samples same-origin sitemap pages and refuses indexes or empty coverage", () => {
    const { paths, problems } = smokePaths(sitemap(["https://www.example.com/a", "https://www.example.com/b?x=1", "https://other.example/c", "https://www.example.com/en/d"]), 12);
    expect(problems).toEqual([]);
    expect(paths).toEqual(["/", "/robots.txt", "/sitemap.xml", "/a", "/en/d"]);
    expect(smokePaths(sitemap(["https://www.example.com/a", "https://www.example.com/b", "https://www.example.com/c"]), 2).paths).toHaveLength(5);
    expect(smokePaths("<sitemapindex><sitemap><loc>https://x/s.xml</loc></sitemap></sitemapindex>", 5).problems).toHaveLength(1);
    expect(smokePaths(sitemap([]), 5).problems).toHaveLength(1);
    expect(smokePaths("not xml", 5).problems).toHaveLength(1);
  });
  it("passes only healthy statuses", () => {
    expect(smokeProblems([{ path: "/", status: 200 }])).toEqual([]);
    expect(smokeProblems([{ path: "/", status: 500 }, { path: "/x", status: 0 }])).toEqual(["/ answered 500", "/x answered no response"]);
  });
});

describe("candidate, receipt and output", () => {
  const record = { id: CAND, url: "cand.vercel.app", projectId: PROJECT, ownerId: TEAM, team: { id: TEAM }, readyState: "READY", target: "production", meta: { gitCommitSha: SHA, gitDirty: "0" } };
  const expected = { sourceSha: SHA, deploymentId: CAND, projectId: PROJECT, teamId: TEAM };
  it("requires a strict production target on top of the source identity", () => {
    expect(candidateProblems(record, expected)).toEqual([]);
    expect(candidateProblems({ ...record, target: null }, expected)).toEqual(["TARGET_NOT_PRODUCTION"]);
    expect(candidateProblems({ ...record, meta: { gitCommitSha: OTHER, gitDirty: "0" } }, expected)).toContain("SOURCE_MISMATCH");
  });
  const receipt = {
    version: 1, state: "staged", sourceSha: SHA, projectId: PROJECT, teamId: TEAM,
    previous: { id: PREV, url: "prev.vercel.app" }, candidate: { id: CAND, url: "cand.vercel.app" },
    baseline, movedToCandidate: [], smoke: [{ path: "/", status: 200 }], verdict: "pass", problems: [],
  };
  it("promotes only a passed stage of exactly the confirmed candidate", () => {
    expect(stageReceiptProblems(receipt, CAND)).toEqual([]);
    expect(stageReceiptProblems(receipt, PREV)).toHaveLength(1);
    expect(stageReceiptProblems({ ...receipt, verdict: "fail", problems: ["x"] }, CAND)).toEqual(["staging did not pass"]);
    expect(stageReceiptProblems({ ...receipt, smoke: [{ path: "/", status: 500 }] }, CAND)).toHaveLength(1);
    expect(stageReceiptProblems({ ...receipt, version: 2 }, CAND)).toHaveLength(1);
  });
  it("reads the deployment URL from either CLI output form, never from a suggested command", () => {
    expect(deployedUrl("https://cand-abc.vercel.app\n")).toBe("cand-abc.vercel.app");
    expect(deployedUrl(JSON.stringify({ url: "https://cand-abc.vercel.app", next: [{ command: "vercel curl https://evil.vercel.app" }] }))).toBe("cand-abc.vercel.app");
    expect(deployedUrl(JSON.stringify({ status: "ok", deployment: { url: "https://cand-abc.vercel.app" } }))).toBe("cand-abc.vercel.app");
    expect(deployedUrl(JSON.stringify({ status: "ok", deployment: { url: "cand-abc.vercel.app" } }))).toBe("cand-abc.vercel.app");
    expect(deployedUrl("Run: vercel curl https://cand-abc.vercel.app\n")).toBeNull();
    expect(deployedUrl("https://cand.example.com\n")).toBeNull();
  });
  it("requires an anonymous challenge and noindex on the candidate", () => {
    const ok = { anonymousStatus: 302, anonymousLocation: "https://vercel.com/sso-api?url=x", authorizedHeaders: "HTTP/2 200\r\nx-robots-tag: noindex\r\n" };
    expect(protectionProblems(ok)).toEqual([]);
    expect(protectionProblems({ ...ok, anonymousStatus: 401, anonymousLocation: null })).toEqual([expect.stringContaining("unauthenticated request answered with 401")]);
    expect(protectionProblems({ ...ok, anonymousStatus: 403, anonymousLocation: null })).toEqual([expect.stringContaining("unauthenticated request was denied with 403")]);
    expect(protectionProblems({ ...ok, anonymousStatus: 200 })).toHaveLength(1);
    expect(protectionProblems({ ...ok, anonymousStatus: 302, anonymousLocation: "https://elsewhere.example/" })).toHaveLength(1);
    expect(protectionProblems({ ...ok, authorizedHeaders: "HTTP/2 200\r\nx-robots-tag: nofollow\r\n" })).toHaveLength(1);
    expect(protectionProblems({ ...ok, authorizedHeaders: "HTTP/2 200\r\nx-robots-tag: googlebot: noindex\r\n" })).toHaveLength(1);
    expect(protectionProblems({ ...ok, authorizedHeaders: "HTTP/2 200\r\nx-robots-tag: googlebot: nofollow, noindex\r\n" })).toHaveLength(1);
  });
  it("classifies readiness while polling", () => {
    expect(readiness({ readyState: "QUEUED" })).toBe("wait");
    expect(readiness({ readyState: "BUILDING" })).toBe("wait");
    expect(readiness({ readyState: "READY" })).toBe("ready");
    expect(readiness({ readyState: "ERROR" })).toBe("failed");
  });
  it("matches a redirect by exact HTTPS host", () => {
    expect(redirectsTo("https://www.example.com/", "www.example.com")).toBe(true);
    expect(redirectsTo("https://www.example.com.unexpected.invalid/", "www.example.com")).toBe(false);
    expect(redirectsTo("https://www.example.com@unexpected.invalid/", "www.example.com")).toBe(false);
    expect(redirectsTo("http://www.example.com/", "www.example.com")).toBe(false);
    expect(redirectsTo(null, "www.example.com")).toBe(false);
  });
  it("refuses to promote a receipt whose URL is not the confirmed deployment's", async () => {
    const receipt = await stage(fakeIo().io);
    const run = fakeIo();
    run.io.run("vercel", ["deploy"]);
    await expect(promote(run.io, { ...receipt, candidate: { id: CAND, url: "other.vercel.app" } }, CAND)).rejects.toThrow(/RECEIPT_URL_MISMATCH/);
    expect(run.calls.some(c => c.startsWith("vercel promote"))).toBe(false);
  });
  it("prints the documented rollback command", () => {
    expect(rollbackCommand({ id: PREV, url: "prev.vercel.app" }, TEAM)).toBe(`npx vercel rollback https://prev.vercel.app --scope ${TEAM}`);
  });
});

// The order of consequential steps, against fake commands: no live provider.
function fakeIo(options: { ci?: boolean; deployOut?: string; smokeStatus?: number; afterStage?: Alias[]; promoteMoves?: boolean; queuedReads?: number; anonymousStatus?: number; domainsNext?: number; env?: Record<string, string> } = {}) {
  const calls: string[] = [], evidence = new Map<string, unknown>(), log: string[] = [];
  let queued = options.queuedReads ?? 0;
  let aliasesNow = inventory(PREV);
  const io: Io = {
    root: "/repo",
    readText: () => JSON.stringify({ projectId: PROJECT, orgId: TEAM }),
    removeBuildOutput: () => { calls.push("remove .vercel/output"); },
    env: options.env ?? {},
    run(command, args) {
      const line = `${command.split("/").pop()} ${args.join(" ")}`;
      calls.push(line);
      if (command === "git") {
        const sub = args.slice(2).join(" ");
        if (sub === "rev-parse --abbrev-ref HEAD") return { status: 0, stdout: "main\n" };
        if (sub === "status --porcelain --untracked-files=all") return { status: 0, stdout: "" };
        if (sub.startsWith("status")) return { status: 0, stdout: "?? would-be-hidden\n" };
        if (sub.startsWith("rev-parse")) return { status: 0, stdout: SHA + "\n" };
        return { status: 0, stdout: "" };
      }
      if (command === "az") return { status: 0, stdout: JSON.stringify(options.ci === false ? [] : [{ sourceVersion: SHA, sourceBranch: "refs/heads/main", status: "completed", result: "succeeded", reason: "individualCI" }]) };
      if (command === "npm") return { status: 0, stdout: "" };
      if (args[0] === "api") {
        const endpoint = args[1];
        if (endpoint.startsWith("/v4/aliases")) return { status: 0, stdout: JSON.stringify({ aliases: aliasesNow, pagination: { next: null } }) };
        if (endpoint.includes("/domains")) return { status: 0, stdout: JSON.stringify({ domains: domains.map(name => ({ name })), pagination: { next: options.domainsNext ?? null } }) };
        const id = decodeURIComponent(endpoint.split("?")[0].split("/").pop()!);
        const isPrev = id === PREV || id === "prev.vercel.app";
        const readyState = !isPrev && queued-- > 0 ? "QUEUED" : "READY";
        return { status: 0, stdout: JSON.stringify({ id: isPrev ? PREV : CAND, url: isPrev ? "prev.vercel.app" : "cand.vercel.app", projectId: PROJECT, ownerId: TEAM, team: { id: TEAM }, readyState, target: "production", meta: { gitCommitSha: SHA, gitDirty: "0" } }) };
      }
      if (args[0] === "deploy") { aliasesNow = options.afterStage ?? inventory(PREV, CAND); return { status: 0, stdout: options.deployOut ?? "https://cand.vercel.app\n" }; }
      if (args[0] === "curl" && args.includes("-D")) return { status: 0, stdout: "HTTP/2 200\r\nx-robots-tag: noindex\r\n" };
      if (args[0] === "curl") return args[1] === "/sitemap.xml" && !args.includes("/dev/null")
        ? { status: 0, stdout: '<urlset><url><loc>https://www.example.com/a</loc></url></urlset>' }
        : { status: 0, stdout: String(options.smokeStatus ?? 200) };
      if (args[0] === "promote") { if (options.promoteMoves !== false) aliasesNow = inventory(CAND); return { status: 0, stdout: "" }; }
      return { status: 0, stdout: "" };
    },
    async publicStatus(url) {
      if (url === "https://cand.vercel.app/") return { status: options.anonymousStatus ?? 302, location: "https://vercel.com/sso-api?url=x" };
      return url === "https://example.com/" ? { status: 308, location: "https://www.example.com/" } : { status: 200, location: null };
    },
    async evidence(name, value) { evidence.set(name, value); },
    log: line => { log.push(line); },
    sleep: async () => {},
  };
  return { io, calls, evidence, log };
}

describe("stage and promote sequence", () => {
  it("stages, records the rollback target before deploying, and never promotes", async () => {
    const { io, calls, evidence, log } = fakeIo();
    const receipt = await stage(io);
    expect(receipt.verdict).toBe("pass");
    expect(receipt.movedToCandidate).toEqual(["site-team.vercel.app"]);
    expect([...evidence.keys()]).toEqual(["01-prepared.json", "02-deployed.json", "03-staged.json"]);
    const deployAt = calls.findIndex(c => c.startsWith("vercel deploy"));
    expect(deployAt).toBeGreaterThan(calls.findIndex(c => c.startsWith("vercel build --prod")));
    expect(calls[deployAt]).toContain("--skip-domain");
    expect(calls[deployAt]).toContain(`gitCommitSha=${SHA}`);
    expect(calls.some(c => c.startsWith("vercel promote"))).toBe(false);
    expect(log.join("\n")).toContain(`vercel alias set https://prev.vercel.app site-team.vercel.app --scope ${TEAM}`);
    expect(calls).toContain("npm ci --include=dev");
  });
  it("scopes every API read, curl and promote to the linked team", async () => {
    const { io, calls } = fakeIo();
    const receipt = await stage(io);
    expect(calls.filter(c => c.startsWith("vercel api")).every(c => c.includes(`teamId=${TEAM}`))).toBe(true);
    expect(calls.filter(c => c.startsWith("vercel curl")).every(c => c.includes(`--scope ${TEAM}`))).toBe(true);
    expect(calls.indexOf("remove .vercel/output")).toBeLessThan(calls.findIndex(c => c.startsWith("vercel build")));
    const run = fakeIo();
    run.io.run("vercel", ["deploy"]);
    await promote(run.io, receipt, CAND);
    expect(run.calls.find(c => c.startsWith("vercel promote"))).toContain(`--scope ${TEAM}`);
  });
  it("refuses a shell that points the CLI at another project", async () => {
    expect(vercelEnvironmentProblems({ VERCEL_PROJECT_ID: PROJECT }, { projectId: PROJECT, teamId: TEAM })).toEqual([]);
    expect(vercelEnvironmentProblems({ VERCEL_PROJECT_ID: "prj_other1" }, { projectId: PROJECT, teamId: TEAM })).toHaveLength(1);
    const { io, calls } = fakeIo({ env: { VERCEL_ORG_ID: "team_other1" } });
    await expect(stage(io)).rejects.toThrow(/different team/);
    expect(calls.some(c => c.startsWith("npm") || c.startsWith("vercel"))).toBe(false);
  });
  it("waits for a queued candidate to become READY", async () => {
    const { io } = fakeIo({ queuedReads: 3 });
    expect((await stage(io)).verdict).toBe("pass");
  });
  it("fails staging when the candidate is anonymously reachable", async () => {
    const { io, evidence } = fakeIo({ anonymousStatus: 200 });
    await expect(stage(io)).rejects.toThrow(/deployment protection is not verified/);
    expect((evidence.get("03-staged.json") as { verdict: string }).verdict).toBe("fail");
  });
  it("refuses an incomplete project-domain inventory before deploying", async () => {
    const { io, calls } = fakeIo({ domainsNext: 42 });
    await expect(stage(io)).rejects.toThrow(/inventory is incomplete/);
    expect(calls.some(c => c.startsWith("vercel deploy"))).toBe(false);
  });
  it("refuses before building when the revision has no passed CI run", async () => {
    const { io, calls, evidence } = fakeIo({ ci: false });
    await expect(stage(io)).rejects.toThrow(ReleaseStop);
    expect(calls.some(c => c.startsWith("vercel build") || c.startsWith("npm"))).toBe(false);
    expect(evidence.size).toBe(0);
  });
  it("keeps deploy evidence when the URL cannot be read", async () => {
    const { io, evidence } = fakeIo({ deployOut: "something unexpected" });
    await expect(stage(io)).rejects.toThrow(/did not return a deployment URL/);
    expect([...evidence.keys()]).toEqual(["01-prepared.json", "02-deployed.json"]);
  });
  it("records a failed stage when smoke fails, and that receipt cannot be promoted", async () => {
    const { io, evidence } = fakeIo({ smokeStatus: 500 });
    await expect(stage(io)).rejects.toThrow(/Staging failed/);
    const failed = evidence.get("03-staged.json") as { verdict: string };
    expect(failed.verdict).toBe("fail");
    const second = fakeIo();
    await expect(promote(second.io, failed, CAND)).rejects.toThrow(/Promotion refused/);
    expect(second.calls.some(c => c.startsWith("vercel promote"))).toBe(false);
  });
  it("refuses staging when a project domain moved during deploy", async () => {
    const moved = inventory(PREV).map(a => a.alias === "www.example.com" ? { ...a, deploymentId: CAND } : a);
    const { io } = fakeIo({ afterStage: moved });
    await expect(stage(io)).rejects.toThrow(/www.example.com now points at/);
  });
  it("promotes a passed receipt and verifies routing and public domains", async () => {
    const staged = fakeIo();
    const receipt = await stage(staged.io);
    const run = fakeIo();
    // Production as staging left it: the generated alias already followed the candidate.
    run.io.run("vercel", ["deploy"]);
    await promote(run.io, receipt, CAND);
    expect([...run.evidence.keys()]).toEqual(["04-promote-attempted.json", "05-verified.json"]);
    expect(run.log.join("\n")).toContain(`npx vercel rollback https://prev.vercel.app --scope ${TEAM}`);
  });
  it("records failed evidence when routing cannot be read back after promotion", async () => {
    const receipt = await stage(fakeIo().io);
    const run = fakeIo();
    run.io.run("vercel", ["deploy"]);
    const inner = run.io.run;
    let promoted = false;
    run.io.run = (command, args, options) => {
      if (args[0] === "promote") promoted = true;
      if (promoted && args[0] === "api" && args[1].startsWith("/v4/aliases")) return { status: 1, stdout: "" };
      return inner(command, args, options);
    };
    await expect(promote(run.io, receipt, CAND)).rejects.toThrow(/alias readback failed[\s\S]*vercel rollback/);
    expect(run.evidence.has("05-failed.json")).toBe(true);
  });
  it("reports an unverified promotion with the rollback command", async () => {
    const receipt = await stage(fakeIo().io);
    const run = fakeIo({ promoteMoves: false });
    run.io.run("vercel", ["deploy"]);
    await expect(promote(run.io, receipt, CAND)).rejects.toThrow(/not verified[\s\S]*vercel rollback https:\/\/prev.vercel.app/);
    expect(run.evidence.has("05-failed.json")).toBe(true);
  });
});

describe("check (read-only preflight)", () => {
  const allowed = (call: string) => /^(git -C \/repo (fetch|rev-parse|status)|az pipelines runs list|vercel api )/.test(call);
  function sealed(io: Io): Io {
    const fail = (): never => { throw new Error("check performed a forbidden action"); };
    return { ...io, evidence: async () => fail(), removeBuildOutput: fail, publicStatus: async () => fail() };
  }
  it("reports the current routing and rollback target using only read commands", async () => {
    const { io, calls, log } = fakeIo();
    await check(sealed(io));
    expect(calls.every(allowed)).toBe(true);
    const out = log.join("\n");
    expect(out).toContain(`Preflight passed at the time checked for ${SHA}`);
    expect(out).toContain("domain example.com → dpl_previous1 (redirects to www.example.com)");
    expect(out).toContain("unrelated alias site-preview.vercel.app");
    expect(out).toContain(`npx vercel rollback https://prev.vercel.app --scope ${TEAM}`);
  });
  it("refuses exactly like stage before anything is changed", async () => {
    const dirty = fakeIo(); const inner = dirty.io.run;
    dirty.io.run = (command, args, options) => command === "git" && args[2] === "status" ? { status: 0, stdout: " M x\n" } : inner(command, args, options);
    await expect(check(sealed(dirty.io))).rejects.toThrow(/working tree has tracked or untracked changes/);
    await expect(check(sealed(fakeIo({ ci: false }).io))).rejects.toThrow(/No completed, succeeded main CI run/);
    await expect(check(sealed(fakeIo({ env: { VERCEL_PROJECT_ID: "prj_other1" } }).io))).rejects.toThrow(/different project/);
    await expect(check(sealed(fakeIo({ domainsNext: 3 }).io))).rejects.toThrow(/inventory is incomplete/);
    const split = fakeIo(); const splitRun = split.io.run;
    split.io.run = (command, args, options) => args[0] === "api" && args[1].startsWith("/v4/aliases")
      ? { status: 0, stdout: JSON.stringify({ aliases: inventory(PREV).map(a => a.alias === "site.vercel.app" ? { ...a, deploymentId: "dpl_other1" } : a), pagination: { next: null } }) }
      : splitRun(command, args, options);
    await expect(check(sealed(split.io))).rejects.toThrow(/not a single consistent baseline/);
  });
  it("still records the rollback target before stage's first change", async () => {
    const { io, calls } = fakeIo();
    const order: string[] = [];
    const tracked: Io = { ...io, evidence: async (name, value) => { order.push(`evidence ${name}`); await io.evidence(name, value); },
      run: (command, args, options) => { if (command === "npm") order.push("npm"); return io.run(command, args, options); } };
    await stage(tracked);
    expect(order.indexOf("evidence 01-prepared.json")).toBeLessThan(order.indexOf("npm"));
    expect(calls.some(c => c.startsWith("npm ci"))).toBe(true);
  });
  it("leaves nothing on disk from the command line, valid or not", () => {
    const script = fileURLToPath(new URL("./release-production.mts", import.meta.url));
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "release check ")));
    try {
      const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
      spawnSync("git", ["init", "--quiet", root], { env });
      for (const args of [["check"], ["check", "extra"], ["nonsense"]]) {
        const result = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8", env });
        expect(result.status).toBe(1);
        expect(existsSync(path.join(root, "temp"))).toBe(false);
      }
      expect(spawnSync(process.execPath, [script, "check", "extra"], { cwd: root, encoding: "utf8", env }).stderr).toContain("Usage:");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
