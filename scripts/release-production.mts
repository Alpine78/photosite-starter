/**
 * `npm run release:production -- stage` and
 * `npm run release:production -- promote --receipt <03-staged.json> --confirm <dpl_id>`
 * (AB#379, owner-run): the staged Production release in docs/deployment.md
 * "Promotion and rollback". The owner's own `vercel` and `az` logins are used;
 * this script reads no token and prints no environment value.
 *
 * Evidence is append-only, one exclusive file per lifecycle step, in a new
 * private directory under the primary checkout's ignored `temp/releases/`:
 * the rollback target is on disk before anything is deployed, and the
 * candidate is on disk as soon as the deploy command returns.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { newPrivateDirectory, readPrivateBytes, writePrivateBytes } from "./private-operation-files.mts";
import {
  RECEIPT_VERSION, aliasRestoreCommand, candidateProblems, ciPassedFor, deployedUrl, redirectsTo, productionDomainNames, protectionProblems, readiness, vercelEnvironmentProblems, compareRouting, parseAliases, productionBaseline,
  promotedRoutingProblems, releaseSourceProblems, rollbackCommand, smokePaths, smokeProblems, stageReceiptProblems,
  type Alias, type Baseline, type Deployment, type StageReceipt,
} from "./production-release.mts";

export type Run = (command: string, args: string[], options?: { timeoutMs?: number; inherit?: boolean }) => { status: number; stdout: string };
export type Io = {
  root: string;
  run: Run;
  /** Public HTTPS check without following redirects. */
  publicStatus: (url: string) => Promise<{ status: number; location: string | null }>;
  evidence: (name: string, value: unknown) => Promise<void>;
  readText: (file: string) => string | null;
  /** Removes the previous build output; injected so tests never touch a real tree. */
  removeBuildOutput: () => void;
  env: Readonly<Record<string, string | undefined>>;
  log: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
};
export class ReleaseStop extends Error {}
const stop = (message: string): never => { throw new ReleaseStop(message); };

function vercelBin(io: Io) { return path.join(io.root, "node_modules", ".bin", "vercel"); }
let linkedTeam = "";
/** `vercel api` does not read the project link, so every read names the linked team. */
function api(io: Io, endpoint: string): unknown {
  const scoped = linkedTeam ? `${endpoint}${endpoint.includes("?") ? "&" : "?"}teamId=${encodeURIComponent(linkedTeam)}` : endpoint;
  const result = io.run(vercelBin(io), ["api", scoped, "--raw"], { timeoutMs: 60_000 });
  if (result.status !== 0) stop(`Vercel API read failed for ${endpoint.split("?")[0]} (exit ${result.status}).`);
  try { return JSON.parse(result.stdout); } catch { return stop(`Vercel API answered non-JSON for ${endpoint.split("?")[0]}.`); }
}
function readProject(io: Io): { projectId: string; teamId: string } {
  let parsed: { projectId?: unknown; orgId?: unknown } = {};
  try { parsed = JSON.parse(io.readText(path.join(io.root, ".vercel", "project.json")) ?? ""); } catch { /* refused below */ }
  if (typeof parsed.projectId !== "string" || typeof parsed.orgId !== "string") stop("The primary checkout is not linked to a Vercel project (.vercel/project.json).");
  linkedTeam = parsed.orgId as string;
  const linked = { projectId: parsed.projectId as string, teamId: parsed.orgId as string };
  const overrides = vercelEnvironmentProblems(io.env, linked);
  if (overrides.length) stop(`Refused: ${overrides.join("; ")}.`);
  return linked;
}
function aliases(io: Io, projectId: string): Alias[] {
  const pages: unknown[] = [];
  let until: number | null = null;
  for (let i = 0; i < 20; i++) {
    const page = api(io, `/v4/aliases?projectId=${projectId}&limit=100${until ? `&until=${until}` : ""}`) as { pagination?: { next?: number | null } };
    pages.push(page);
    until = page?.pagination?.next ?? null;
    if (!until) break;
  }
  const parsed = parseAliases(pages);
  if (!parsed.complete) stop("The alias inventory could not be read completely; refused.");
  return parsed.aliases;
}
function projectDomains(io: Io, projectId: string): string[] {
  const { names, complete } = productionDomainNames(api(io, `/v9/projects/${projectId}/domains?limit=100`));
  // An omitted domain would be misread as a generated alias, so a partial list is refused.
  if (!complete) stop("The project domain inventory is incomplete or unreadable; refused.");
  return names;
}
function deployment(io: Io, idOrUrl: string): Record<string, unknown> {
  const body = api(io, `/v13/deployments/${encodeURIComponent(idOrUrl)}`) as Record<string, unknown>;
  if (typeof body?.id !== "string" || typeof body.url !== "string") stop(`Deployment ${idOrUrl} could not be read.`);
  return body;
}
function ciPassed(io: Io, sha: string): boolean {
  const result = io.run("az", ["pipelines", "runs", "list", "--branch", "main", "--top", "30", "-o", "json"], { timeoutMs: 60_000 });
  if (result.status !== 0) stop("Azure Pipelines runs could not be read (az login and `az devops configure` defaults are required).");
  try { return ciPassedFor(JSON.parse(result.stdout), sha); } catch { return stop("Azure Pipelines answered non-JSON."); }
}
function git(io: Io, args: string[]): string {
  const result = io.run("git", ["-C", io.root, ...args]);
  if (result.status !== 0) stop(`git ${args[0]} failed.`);
  return result.stdout.trim();
}
function smoke(io: Io, url: string, paths: readonly string[]) {
  return paths.map(p => {
    const result = io.run(vercelBin(io), ["curl", p, "--deployment", `https://${url}`, "--scope", linkedTeam, "--", "-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "20"], { timeoutMs: 60_000 });
    const code = Number(result.stdout.trim().slice(-3));
    return { path: p, status: result.status === 0 && Number.isInteger(code) ? code : 0 };
  });
}

/**
 * Every read-only gate `stage` applies before it changes anything: the project
 * link, a clean exact origin/main, a passed main CI run, and a complete,
 * consistent Production routing baseline. `git fetch` is its only local write.
 */
export async function preflight(io: Io) {
  const { projectId, teamId } = readProject(io);
  git(io, ["fetch", "origin"]);
  const head = git(io, ["rev-parse", "HEAD"]);
  const source = releaseSourceProblems({
    branch: git(io, ["rev-parse", "--abbrev-ref", "HEAD"]), porcelain: git(io, ["status", "--porcelain", "--untracked-files=all"]),
    head, originMain: git(io, ["rev-parse", "origin/main"]),
  });
  if (source.length) stop(`Release source refused:\n  - ${source.join("\n  - ")}`);
  if (!ciPassed(io, head)) stop(`No completed, succeeded main CI run for ${head}; release only a revision that passed the quality gates.`);

  const domains = projectDomains(io, projectId);
  const before = aliases(io, projectId);
  const firstDomain = before.find(a => a.alias === domains.find(d => before.some(b => b.alias === d && !b.redirect)));
  const previousId = firstDomain?.deploymentId ?? stop("No project domain serves a deployment; nothing to release over.");
  const { baseline, problems: baselineProblems } = productionBaseline(before, domains, previousId);
  if (baselineProblems.length) stop(`Production routing is not a single consistent baseline:\n  - ${baselineProblems.join("\n  - ")}`);
  const previousRecord = deployment(io, previousId);
  const previous: Deployment = { id: previousId, url: previousRecord.url as string };
  return { projectId, teamId, head, baseline, previous };
}

/**
 * `npm run release:production -- check`: the preflight alone, as a snapshot.
 * No evidence, lock, install, build, deploy, curl or promote; `stage` repeats
 * every check, and build, deployment and candidate verification stay untested.
 */
export async function check(io: Io): Promise<void> {
  const { head, baseline, previous, teamId } = await preflight(io);
  io.log([
    `Preflight passed at the time checked for ${head} (clean exact origin/main, main CI passed).`,
    `Production deployment: ${previous.id} (https://${previous.url})`,
    ...baseline.domains.map(d => `  domain ${d.alias} → ${d.deploymentId}${d.redirect ? ` (redirects to ${d.redirect})` : ""}`),
    ...baseline.generated.map(a => `  generated alias ${a} → ${previous.id}`),
    ...baseline.unrelated.map(a => `  unrelated alias ${a.alias} → ${a.deploymentId ?? "nothing"} (must stay unchanged)`),
    `Rollback target if a release goes wrong: ${rollbackCommand(previous, teamId)}`,
    "Stage repeats all of this; build, deployment and candidate checks are not covered by check.",
  ].join("\n"));
}

export async function stage(io: Io): Promise<StageReceipt> {
  const { projectId, teamId, head, baseline, previous } = await preflight(io);
  await io.evidence("01-prepared.json", { version: RECEIPT_VERSION, state: "prepared", sourceSha: head, projectId, teamId, previous, baseline, rollback: rollbackCommand(previous, teamId) });
  io.log(`Source ${head.slice(0, 12)} (CI passed). Rollback target recorded: ${previous.id}.`);

  // Inputs: the lockfile tree and a fresh build output, never a stale one.
  if (io.run("npm", ["ci", "--include=dev"], { inherit: true, timeoutMs: 900_000 }).status !== 0) stop("npm ci failed; nothing deployed.");
  io.removeBuildOutput();
  if (io.run(vercelBin(io), ["pull", "--yes", "--environment=production"], { inherit: true, timeoutMs: 300_000 }).status !== 0) stop("vercel pull failed; nothing deployed.");
  if (io.run(vercelBin(io), ["build", "--prod"], { inherit: true, timeoutMs: 1_200_000 }).status !== 0) stop("vercel build failed; nothing deployed.");
  if (git(io, ["rev-parse", "HEAD"]) !== head || git(io, ["status", "--porcelain", "--untracked-files=all"]) !== "") stop("The checkout changed during the build; nothing deployed.");

  const deploy = io.run(vercelBin(io), ["deploy", "--prebuilt", "--prod", "--skip-domain", "--archive=tgz", "--meta", `gitCommitSha=${head}`, "--meta", "gitDirty=0"], { timeoutMs: 1_200_000 });
  const candidateUrl = deployedUrl(deploy.stdout);
  await io.evidence("02-deployed.json", { version: RECEIPT_VERSION, state: "deployed", deployExit: deploy.status, candidateUrl: candidateUrl ?? null, rollback: rollbackCommand(previous, teamId) });
  if (deploy.status !== 0 || !candidateUrl) stop(`vercel deploy did not return a deployment URL (exit ${deploy.status}). Check aliases before retrying; rollback target: ${previous.id}.`);

  // A prebuilt deploy returns before the deployment is READY: wait, bounded.
  let record = deployment(io, candidateUrl!);
  for (let attempt = 0; attempt < 60 && readiness(record) === "wait"; attempt++) {
    await io.sleep(5_000);
    record = deployment(io, candidateUrl!);
  }
  const candidate: Deployment = { id: record.id as string, url: record.url as string };
  const problems = candidateProblems(record, { sourceSha: head, deploymentId: candidate.id, projectId, teamId });
  const routing = compareRouting(baseline, aliases(io, projectId), candidate.id);
  problems.push(...routing.problems);
  const sitemap = io.run(vercelBin(io), ["curl", "/sitemap.xml", "--deployment", `https://${candidate.url}`, "--scope", linkedTeam, "--", "-s", "--max-time", "20"], { timeoutMs: 60_000 });
  const paths = smokePaths(sitemap.status === 0 ? sitemap.stdout : "", 12);
  problems.push(...paths.problems);
  const results = paths.paths.length ? smoke(io, candidate.url, paths.paths) : [];
  problems.push(...smokeProblems(results));
  const anonymous = await io.publicStatus(`https://${candidate.url}/`);
  const headers = io.run(vercelBin(io), ["curl", "/", "--deployment", `https://${candidate.url}`, "--scope", linkedTeam, "--", "-s", "-o", "/dev/null", "-D", "-", "--max-time", "20"], { timeoutMs: 60_000 });
  problems.push(...protectionProblems({ anonymousStatus: anonymous.status, anonymousLocation: anonymous.location, authorizedHeaders: headers.status === 0 ? headers.stdout : "" }));

  const receipt: StageReceipt = {
    version: RECEIPT_VERSION, state: "staged", sourceSha: head, projectId, teamId, previous, candidate, baseline,
    movedToCandidate: routing.movedToCandidate, smoke: results, verdict: problems.length ? "fail" : "pass", problems,
  };
  await io.evidence("03-staged.json", receipt);
  for (const name of routing.movedToCandidate) io.log(`Note: generated alias ${name} followed the candidate. Restore without promoting: ${aliasRestoreCommand(previous, name, teamId)}`);
  if (problems.length) stop(`Staging failed; production was not changed:\n  - ${problems.join("\n  - ")}`);
  return receipt;
}

export async function promote(io: Io, receiptValue: unknown, confirm: string): Promise<void> {
  const receiptProblems = stageReceiptProblems(receiptValue, confirm);
  if (receiptProblems.length) stop(`Promotion refused:\n  - ${receiptProblems.join("\n  - ")}`);
  const receipt = receiptValue as StageReceipt;
  const { projectId, teamId } = readProject(io);
  if (projectId !== receipt.projectId || teamId !== receipt.teamId) stop("The receipt belongs to a different Vercel project.");
  if (!ciPassed(io, receipt.sourceSha)) stop(`No completed, succeeded main CI run for ${receipt.sourceSha}.`);
  const baseline: Baseline = receipt.baseline;
  const now = compareRouting(baseline, aliases(io, projectId), receipt.candidate.id, receipt.movedToCandidate);
  if (now.problems.length) stop(`Production routing changed since staging; promotion refused:\n  - ${now.problems.join("\n  - ")}`);
  const readback = deployment(io, receipt.candidate.id);
  const problems = candidateProblems(readback, { sourceSha: receipt.sourceSha, deploymentId: receipt.candidate.id, projectId, teamId });
  // The URL promoted is the provider's own for the confirmed id, never the receipt's text.
  if (readback.url !== receipt.candidate.url) problems.push("RECEIPT_URL_MISMATCH");
  if (problems.length) stop(`Candidate readback refused: ${problems.join(", ")}`);

  await io.evidence("04-promote-attempted.json", { version: RECEIPT_VERSION, state: "promote-attempted", candidate: receipt.candidate, rollback: rollbackCommand(receipt.previous, teamId) });
  io.log(`Promoting ${receipt.candidate.id}. Rollback if needed: ${rollbackCommand(receipt.previous, teamId)}`);
  // A failed or timed-out promote is an uncertain outcome: read back either way.
  const promoted = io.run(vercelBin(io), ["promote", `https://${readback.url as string}`, "--scope", linkedTeam, "--yes"], { inherit: true, timeoutMs: 300_000 });

  // Production may already have moved, so a failed readback is retried and,
  // if it never succeeds, recorded as failed evidence rather than thrown.
  let routing: string[] = ["alias inventory not read"];
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      routing = promotedRoutingProblems(baseline, aliases(io, projectId), receipt.candidate.id);
    } catch (error) {
      routing = [`alias readback failed: ${(error as Error).message}`];
    }
    if (!routing.length) break;
    await io.sleep(5_000);
  }
  const publicChecks: { domain: string; status: number; location: string | null }[] = [];
  const publicProblems: string[] = [];
  for (const domain of baseline.domains) {
    const answer = await io.publicStatus(`https://${domain.alias}/`);
    publicChecks.push({ domain: domain.alias, ...answer });
    if (domain.redirect) {
      if (answer.status < 300 || answer.status > 399 || !redirectsTo(answer.location, domain.redirect)) publicProblems.push(`${domain.alias} does not redirect to ${domain.redirect}`);
    } else if (answer.status !== 200) publicProblems.push(`${domain.alias} answered ${answer.status}`);
  }
  const all = [...(promoted.status === 0 ? [] : [`vercel promote exited ${promoted.status}`]), ...routing, ...publicProblems];
  await io.evidence(all.length ? "05-failed.json" : "05-verified.json", { version: RECEIPT_VERSION, state: all.length ? "failed" : "verified", candidate: receipt.candidate, publicChecks, problems: all, rollback: rollbackCommand(receipt.previous, teamId) });
  if (all.length) stop(`Promotion is not verified:\n  - ${all.join("\n  - ")}\nRead back before acting. Rollback: ${rollbackCommand(receipt.previous, teamId)}`);
  io.log(`Verified: every production alias serves ${receipt.candidate.id}.\nRollback if needed: ${rollbackCommand(receipt.previous, teamId)}`);
}

function realIo(root: string, folder: string): Io {
  return {
    root,
    run(command, args, options = {}) {
      const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout: options.timeoutMs ?? 120_000, stdio: options.inherit ? ["ignore", "inherit", "inherit"] : ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
      return { status: result.status ?? 1, stdout: result.stdout ?? "" };
    },
    async publicStatus(url) {
      try {
        const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
        await response.body?.cancel();
        return { status: response.status, location: response.headers.get("location") };
      } catch { return { status: 0, location: null }; }
    },
    evidence: (name, value) => writePrivateBytes(folder, name, JSON.stringify(value, null, 2) + "\n"),
    readText(file) { try { return readFileSync(file, "utf8"); } catch { return null; } },
    removeBuildOutput: () => rmSync(path.join(root, ".vercel", "output"), { recursive: true, force: true }),
    env: process.env,
    log: line => console.log(line),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  };
}

const USAGE = "Usage: npm run release:production -- check | stage | promote --receipt <03-staged.json> --confirm <dpl_id>";

async function main(argv: string[]) {
  const [mode, ...rest] = argv;
  // Usage is settled before anything is created on disk.
  const valid = ((mode === "check" || mode === "stage") && rest.length === 0) ||
    (mode === "promote" && rest.length === 4 && rest[0] === "--receipt" && rest[2] === "--confirm");
  if (!valid) stop(USAGE);
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  if (mode === "check") {
    // Read-only: no lock, no evidence directory, nothing left behind.
    const noWrite = (): never => { throw new ReleaseStop("check must not write evidence, remove build output or probe public URLs"); };
    await check({ ...realIo(root, ""), evidence: async () => noWrite(), removeBuildOutput: noWrite, publicStatus: async () => noWrite() });
    return;
  }
  const releases = path.join(root, "temp", "releases");
  mkdirSync(releases, { recursive: true, mode: 0o700 });
  const lock = path.join(releases, ".lock");
  try { mkdirSync(lock); } catch { stop(`Another release holds ${lock}; remove it only if no release is running.`); }
  try {
    const folder = await newPrivateDirectory(path.join(releases, new Date().toISOString().replace(/[:.]/g, "-")));
    if (mode === "stage" && rest.length === 0) {
      const receipt = await stage(realIo(root, folder));
      console.log(`\nStaged ${receipt.candidate.id} (https://${receipt.candidate.url}); production unchanged.\nPromote after review:\n  npm run release:production -- promote --receipt ${path.join(folder, "03-staged.json")} --confirm ${receipt.candidate.id}`);
    } else {
      const bytes = await readPrivateBytes(path.resolve(rest[1]), 4 * 1024 * 1024);
      await promote(realIo(root, folder), JSON.parse(bytes.toString("utf8")), rest[3]);
    }
  } finally { rmSync(lock, { recursive: true, force: true }); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error instanceof ReleaseStop ? error.message : `[release:production] ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
