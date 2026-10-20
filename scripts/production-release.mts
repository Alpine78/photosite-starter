/**
 * Decisions for `npm run release:production` (AB#379): the staged sequence in
 * docs/deployment.md "Promotion and rollback", as pure functions over provider
 * readbacks. The IO, and every provider call, is in `release-production.mts`.
 */
import { verifyReleaseSource } from "./release-source-verification.mts";
import { classifyProtection, hasNoindexDirective } from "./preview-verification.mts";

export const RECEIPT_VERSION = 1;
export type Alias = { alias: string; deploymentId: string | null; redirect: string | null };
export type Deployment = { id: string; url: string };

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const deploymentIdPattern = /^dpl_[A-Za-z0-9]{1,80}$/;
const shaPattern = /^[a-f0-9]{40}$/;
const hostPattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** A clean `main` checkout exactly at the fetched `origin/main`. */
export function releaseSourceProblems(input: { branch: string; porcelain: string; head: string; originMain: string }): string[] {
  const problems: string[] = [];
  if (input.branch !== "main") problems.push(`checkout is on ${input.branch || "(detached)"}, not main`);
  if (input.porcelain.trim() !== "") problems.push("working tree has tracked or untracked changes");
  if (!shaPattern.test(input.head)) problems.push("HEAD is not a full commit id");
  else if (input.head !== input.originMain) problems.push(`HEAD ${input.head.slice(0, 12)} is not origin/main ${input.originMain.slice(0, 12)}`);
  return problems;
}

/**
 * The exact revision passed the quality gates on main: a completed, succeeded
 * main run for it. A scheduled run skips the Verify stage entirely (it is the
 * dependency audit), so its success is not quality-gate evidence.
 */
export function ciPassedFor(runs: unknown, sha: string): boolean {
  return Array.isArray(runs) && runs.some(run => {
    const r = object(run);
    return r?.sourceVersion === sha && r.sourceBranch === "refs/heads/main" && r.status === "completed" &&
      r.result === "succeeded" && typeof r.reason === "string" && r.reason !== "schedule";
  });
}

/** `GET /v4/aliases?projectId=…` pages, reduced to the fields a release depends on. */
export function parseAliases(pages: readonly unknown[]): { aliases: Alias[]; complete: boolean } {
  const aliases: Alias[] = [];
  let complete = pages.length > 0;
  pages.forEach((page, index) => {
    const body = object(page), list = body?.aliases;
    if (!Array.isArray(list)) { complete = false; return; }
    for (const item of list) {
      const a = object(item);
      if (typeof a?.alias !== "string") { complete = false; continue; }
      aliases.push({ alias: a.alias, deploymentId: typeof a.deploymentId === "string" ? a.deploymentId : null, redirect: typeof a.redirect === "string" ? a.redirect : null });
    }
    if (index === pages.length - 1 && object(body?.pagination)?.next != null) complete = false;
  });
  return { aliases, complete };
}

/**
 * Production domains from `GET /v9/projects/…/domains`: a domain bound to a Git
 * branch or a custom environment serves something else and is left to the
 * unrelated-alias comparison. Decided from the fields, not from a query filter.
 */
export function productionDomainNames(body: unknown): { names: string[]; complete: boolean } {
  const b = object(body), list = b?.domains;
  if (!Array.isArray(list)) return { names: [], complete: false };
  const names = list.map(object).filter(d => typeof d?.name === "string" && d.gitBranch == null && d.customEnvironmentId == null).map(d => d!.name as string);
  return { names, complete: object(b?.pagination)?.next == null };
}

/**
 * The Vercel CLI prefers VERCEL_ORG_ID/VERCEL_PROJECT_ID over the project link.
 * A shell carrying another project's ids would deploy there, so a conflicting
 * override is refused instead of trusted.
 */
export function vercelEnvironmentProblems(env: Readonly<Record<string, string | undefined>>, linked: { projectId: string; teamId: string }): string[] {
  const problems: string[] = [];
  if (env.VERCEL_PROJECT_ID && env.VERCEL_PROJECT_ID !== linked.projectId) problems.push("VERCEL_PROJECT_ID names a different project than .vercel/project.json");
  if (env.VERCEL_ORG_ID && env.VERCEL_ORG_ID !== linked.teamId) problems.push("VERCEL_ORG_ID names a different team than .vercel/project.json");
  return problems;
}

export type Baseline = {
  previous: string;
  /** The project's own domains: what visitors reach. */
  domains: Alias[];
  /** Other aliases on the production deployment, such as the generated team alias. */
  generated: string[];
  /** Everything else, e.g. the stable Preview alias: recorded and expected unchanged. */
  unrelated: Alias[];
};

/**
 * The production routing before anything is deployed. Every project domain has
 * to be an alias of the one current production deployment: a missing or split
 * domain is refused rather than silently left out of the comparison.
 */
export function productionBaseline(aliases: readonly Alias[], projectDomains: readonly string[], previous: string): { baseline: Baseline; problems: string[] } {
  const problems: string[] = [];
  const byName = new Map(aliases.map(a => [a.alias, a]));
  if (!deploymentIdPattern.test(previous)) problems.push("current production deployment id is malformed");
  if (projectDomains.length === 0) problems.push("the project has no domains to release to");
  const domains: Alias[] = [];
  for (const name of projectDomains) {
    const alias = byName.get(name);
    if (!alias) problems.push(`project domain ${name} has no alias`);
    else if (alias.deploymentId !== previous) problems.push(`project domain ${name} points at ${alias.deploymentId ?? "nothing"}, not the production deployment ${previous}`);
    else domains.push(alias);
  }
  const domainSet = new Set(projectDomains);
  const generated = aliases.filter(a => !domainSet.has(a.alias) && a.deploymentId === previous).map(a => a.alias);
  const unrelated = aliases.filter(a => !domainSet.has(a.alias) && a.deploymentId !== previous);
  return { baseline: { previous, domains, generated, unrelated }, problems };
}

/**
 * Routing after staging (or just before promotion). Project domains must still
 * serve the previous deployment with the same redirect; generated aliases may
 * have followed the candidate (observed with `--skip-domain`, 2026-10-04) and
 * are reported; nothing else may change.
 */
export function compareRouting(baseline: Baseline, aliases: readonly Alias[], candidate: string, acceptedMoves?: readonly string[]): { problems: string[]; movedToCandidate: string[] } {
  const problems: string[] = [], movedToCandidate: string[] = [];
  const byName = new Map(aliases.map(a => [a.alias, a]));
  for (const domain of baseline.domains) {
    const now = byName.get(domain.alias);
    if (!now) problems.push(`project domain ${domain.alias} disappeared`);
    else if (now.deploymentId !== baseline.previous) problems.push(`project domain ${domain.alias} now points at ${now.deploymentId ?? "nothing"}`);
    else if (now.redirect !== domain.redirect) problems.push(`project domain ${domain.alias} redirect changed`);
  }
  for (const name of baseline.generated) {
    const now = byName.get(name);
    if (!now) problems.push(`alias ${name} disappeared`);
    else if (now.deploymentId === candidate) {
      movedToCandidate.push(name);
      if (acceptedMoves && !acceptedMoves.includes(name)) problems.push(`alias ${name} moved to the candidate after staging was accepted`);
    } else if (now.deploymentId !== baseline.previous) problems.push(`alias ${name} now points at ${now.deploymentId ?? "nothing"}`);
  }
  for (const before of baseline.unrelated) {
    const now = byName.get(before.alias);
    if (!now || now.deploymentId !== before.deploymentId || now.redirect !== before.redirect) problems.push(`unrelated alias ${before.alias} changed`);
  }
  const known = new Set([...baseline.domains.map(a => a.alias), ...baseline.generated, ...baseline.unrelated.map(a => a.alias)]);
  for (const a of aliases) if (!known.has(a.alias)) problems.push(`new alias ${a.alias} appeared`);
  return { problems, movedToCandidate };
}

/** After `vercel promote`: every production alias serves the candidate, redirects intact. */
export function promotedRoutingProblems(baseline: Baseline, aliases: readonly Alias[], candidate: string): string[] {
  const byName = new Map(aliases.map(a => [a.alias, a]));
  const problems: string[] = [];
  for (const domain of baseline.domains) {
    const now = byName.get(domain.alias);
    if (now?.deploymentId !== candidate) problems.push(`project domain ${domain.alias} points at ${now?.deploymentId ?? "nothing"}`);
    else if (now.redirect !== domain.redirect) problems.push(`project domain ${domain.alias} redirect changed`);
  }
  for (const name of baseline.generated) {
    if (byName.get(name)?.deploymentId !== candidate) problems.push(`alias ${name} does not point at the candidate`);
  }
  // Promotion must not move anything else, e.g. the stable Preview alias.
  for (const before of baseline.unrelated) {
    const now = byName.get(before.alias);
    if (!now || now.deploymentId !== before.deploymentId || now.redirect !== before.redirect) problems.push(`unrelated alias ${before.alias} changed`);
  }
  const known = new Set([...baseline.domains.map(a => a.alias), ...baseline.generated, ...baseline.unrelated.map(a => a.alias)]);
  for (const a of aliases) if (!known.has(a.alias)) problems.push(`new alias ${a.alias} appeared`);
  return problems;
}

/**
 * Smoke paths from the candidate's own sitemap: generic, so no route of any
 * particular site is hardcoded. Only the sitemap's canonical origin counts,
 * and a sitemap index is refused rather than followed.
 */
export function smokePaths(sitemapXml: string, limit: number): { paths: string[]; problems: string[] } {
  if (/<sitemapindex[\s>]/.test(sitemapXml)) return { paths: [], problems: ["sitemap is an index; release smoke does not follow indexes"] };
  if (!/<urlset[\s>]/.test(sitemapXml)) return { paths: [], problems: ["sitemap is not a urlset"] };
  const locs = [...sitemapXml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1].replaceAll("&amp;", "&"));
  let origin: string | null = null;
  const pages: string[] = [];
  for (const loc of locs) {
    let url: URL;
    try { url = new URL(loc); } catch { continue; }
    if (url.protocol !== "https:" || url.search || url.hash) continue;
    origin ??= url.origin;
    if (url.origin === origin && !pages.includes(url.pathname)) pages.push(url.pathname);
  }
  // Evenly spaced across the whole sitemap, so every page family is sampled,
  // not only whichever happens to be listed first.
  const step = Math.max(1, pages.length / Math.max(1, limit));
  const sample = Array.from({ length: Math.min(limit, pages.length) }, (_, i) => pages[Math.floor(i * step)]);
  const paths = [...new Set(["/", "/robots.txt", "/sitemap.xml", ...sample])];
  return { paths, problems: pages.length ? [] : ["sitemap lists no usable same-origin page"] };
}

/** Healthy statuses only: matching a failing production is not a pass. */
export function smokeProblems(results: readonly { path: string; status: number }[]): string[] {
  return results.filter(r => r.status !== 200).map(r => `${r.path} answered ${r.status || "no response"}`);
}

/** The deployment readback for a candidate: identity, source, and a strict production target. */
export function candidateProblems(record: unknown, expected: { sourceSha: string; deploymentId: string; projectId: string; teamId: string }): string[] {
  const result = verifyReleaseSource(record, expected);
  const problems = [...result.reasons];
  // verifyReleaseSource tolerates a null target for Preview; Production may not.
  if (object(record)?.target !== "production") problems.push("TARGET_NOT_PRODUCTION");
  return problems;
}

export type StageReceipt = {
  version: number;
  state: "staged";
  sourceSha: string;
  projectId: string;
  teamId: string;
  previous: Deployment;
  candidate: Deployment;
  baseline: Baseline;
  movedToCandidate: string[];
  smoke: { path: string; status: number }[];
  verdict: "pass" | "fail";
  problems: string[];
};

/** A promotable receipt: a passed stage of exactly the candidate being confirmed. */
export function stageReceiptProblems(value: unknown, confirm: string): string[] {
  const r = object(value), problems: string[] = [];
  if (r?.version !== RECEIPT_VERSION || r.state !== "staged") return ["not a version 1 stage receipt"];
  const candidate = object(r.candidate), previous = object(r.previous);
  if (r.verdict !== "pass" || !Array.isArray(r.problems) || r.problems.length) problems.push("staging did not pass");
  if (typeof candidate?.id !== "string" || !deploymentIdPattern.test(candidate.id)) problems.push("receipt candidate id is malformed");
  else if (candidate.id !== confirm) problems.push(`--confirm ${confirm} is not the staged candidate ${candidate.id}`);
  if (typeof previous?.id !== "string" || !deploymentIdPattern.test(previous.id)) problems.push("receipt previous id is malformed");
  for (const d of [candidate, previous]) if (typeof d?.url !== "string" || !hostPattern.test(d.url)) problems.push("receipt deployment url is malformed");
  if (typeof r.sourceSha !== "string" || !shaPattern.test(r.sourceSha)) problems.push("receipt source sha is malformed");
  if (!Array.isArray(r.smoke) || r.smoke.length === 0 || smokeProblems(r.smoke as { path: string; status: number }[]).length) problems.push("receipt smoke results are missing or failing");
  return problems;
}

/**
 * The deployment `vercel deploy` reports: a bare URL line in a terminal, or a
 * JSON object with `url` when the CLI runs non-interactively. Lines that only
 * mention a URL (suggested follow-up commands) never count.
 */
export function deployedUrl(stdout: string): string | null {
  const host = /^https:\/\/([a-z0-9]([a-z0-9-]*[a-z0-9])?\.vercel\.app)\/?$/;
  const text = stdout.trim();
  if (text.startsWith("{")) {
    try {
      const body = object(JSON.parse(text));
      // Non-interactive (agent) mode wraps it: {status: "ok", deployment: {url}}.
      const url = object(body?.deployment)?.url ?? body?.url;
      const match = typeof url === "string" ? host.exec(url.startsWith("https://") ? url : `https://${url}`) : null;
      return match ? match[1] : null;
    } catch { return null; }
  }
  const lines = text.split("\n").map(l => host.exec(l.trim())).filter(Boolean);
  return lines.length ? lines[lines.length - 1]![1] : null;
}

/**
 * The candidate's own URL must stay private and unindexable: an anonymous
 * request is challenged with a redirect to Vercel's SSO endpoint, and the
 * authorized response carries `X-Robots-Tag: noindex`.
 */
export function protectionProblems(input: { anonymousStatus: number; anonymousLocation: string | null; authorizedHeaders: string }): string[] {
  const problems: string[] = [];
  const protection = classifyProtection(input.anonymousStatus, input.anonymousLocation);
  if (!protection.ok) problems.push(`candidate answered an anonymous request with ${input.anonymousStatus || "no response"}; deployment protection is not verified: ${protection.detail}`);
  const robots = input.authorizedHeaders.split(/\r?\n/).filter(l => /^x-robots-tag:/i.test(l)).map(l => l.slice(l.indexOf(":") + 1).trim().toLowerCase());
  if (!robots.some(hasNoindexDirective)) problems.push("candidate response has no X-Robots-Tag: noindex");
  return problems;
}

/** Readiness while polling: wait, proceed, or stop. */
export function readiness(record: unknown): "wait" | "ready" | "failed" {
  const state = object(record)?.readyState;
  if (state === "READY") return "ready";
  if (state === "ERROR" || state === "CANCELED" || state === "DELETED") return "failed";
  return "wait";
}

/** A redirect lands on exactly that host over HTTPS: parsed, never a prefix match. */
export function redirectsTo(location: string | null, host: string): boolean {
  if (!location) return false;
  try {
    const url = new URL(location);
    return url.protocol === "https:" && url.hostname === host && !url.username && !url.password && (url.port === "" || url.port === "443");
  } catch { return false; }
}

/** Recovery commands name the linked team: the CLI's active team may be another one. */
export function rollbackCommand(previous: Deployment, teamId: string): string {
  return `npx vercel rollback https://${previous.url} --scope ${teamId}`;
}

export function aliasRestoreCommand(previous: Deployment, alias: string, teamId: string): string {
  return `npx vercel alias set https://${previous.url} ${alias} --scope ${teamId}`;
}
