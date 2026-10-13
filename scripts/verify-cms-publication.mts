#!/usr/bin/env node
/** AB#117: offline plans by default; --yes authorizes one approved CAS request. */
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { compilePublicationPlan, object, reconcilePublication, requireRecoveryEvidence, restoreRevision, sha256, validatePublicationPlan } from "./publication-smoke-plan.mts";
import { runPublicationSmoke } from "./publication-smoke-run.mts";
import { parseReadConnection, runReadQuery } from "./sanity-read-http.mts";
import { runSeedMutationBatches } from "./sanity-seed-http.mts";

const ROOT_KEYS = ["--plan", "--baseline", "--out"];
async function privateJson(file: string) {
  const resolved = path.resolve(file), uid = process.getuid?.();
  if (uid === undefined || await realpath(resolved) !== resolved) throw new Error("SMOKE_PRIVATE_INPUT");
  const fd = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const s = await fd.stat();
    if (!s.isFile() || s.uid !== uid || (s.mode & 0o777) !== 0o600 || s.size < 1 || s.size > 512 * 1024) throw new Error("SMOKE_PRIVATE_INPUT");
    const bytes = Buffer.alloc(s.size + 1), { bytesRead } = await fd.read(bytes, 0, bytes.length, 0), after = await fd.stat();
    if (bytesRead !== s.size || after.size !== s.size || after.mtimeMs !== s.mtimeMs || after.ctimeMs !== s.ctimeMs) throw new Error("SMOKE_INPUT_CHANGED");
    const data = bytes.subarray(0, bytesRead);
    return { value: JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data)) as unknown, digest: sha256(data) };
  } finally { await fd.close(); }
}
async function reserveOutput(file: string) {
  const out = path.resolve(file), parent = await lstat(path.dirname(out));
  if (process.getuid === undefined || !parent.isDirectory() || parent.uid !== process.getuid() || (parent.mode & 0o777) !== 0o700 ||
    await realpath(path.dirname(out)) !== path.dirname(out)) throw new Error("SMOKE_PRIVATE_OUTPUT");
  const exec = promisify(execFile); let root: string | undefined;
  try { root = (await exec("git", ["-C", path.dirname(out), "rev-parse", "--show-toplevel"], { env: { ...process.env, LANG: "C", LC_ALL: "C" } })).stdout.trim(); }
  catch (error) {
    if (!error || typeof error !== "object" || !("stderr" in error) || typeof error.stderr !== "string" || !error.stderr.includes("not a git repository")) throw new Error("SMOKE_GIT_GUARD");
  }
  if (root) {
    const relative = path.relative(root, out);
    if ((await exec("git", ["-C", root, "ls-files", "--", relative])).stdout.trim()) throw new Error("SMOKE_TRACKED_OUTPUT");
    await exec("git", ["-C", root, "check-ignore", "--quiet", "--", relative]);
  }
  return open(out, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
}
async function save(fd: FileHandle, record: unknown) {
  const bytes = Buffer.from(JSON.stringify(record, null, 2) + "\n"), written = await fd.write(bytes, 0, bytes.length, 0);
  if (written.bytesWritten !== bytes.length) throw new Error("SMOKE_INCOMPLETE_RECEIPT");
  await fd.truncate(bytes.length); await fd.sync();
}
async function prepare(file: string, record: unknown) {
  // Preserve this record even if saving the eventual outcome fails.
  const fd = await reserveOutput(`${file}.prepared.json`);
  try { await save(fd, record); } finally { await fd.close(); }
  const directory = await open(path.dirname(path.resolve(file)), constants.O_RDONLY | constants.O_DIRECTORY);
  try { await directory.sync(); } finally { await directory.close(); }
}
async function main() {
  const args = process.argv.slice(2), phase = args.shift();
  if (!["plan", "apply", "restore", "reconcile"].includes(phase ?? "")) throw new Error("SMOKE_ARGUMENTS");
  const yes = args.at(-1) === "--yes"; if (yes) args.pop();
  if (yes && (phase === "plan" || phase === "reconcile")) throw new Error("SMOKE_ARGUMENTS");
  const required = phase === "plan" ? ["--source", "--baseline", "--project", "--dataset", "--api-version", "--language", "--out"] : ROOT_KEYS;
  const allowed = phase === "plan" ? [...required, "--nonce"] : [...required, ...(phase === "apply" ? [] : ["--receipt"]), ...(phase === "reconcile" ? [] : ["--approved-digest"])];
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--") || values.has(args[i])) throw new Error("SMOKE_ARGUMENTS");
    values.set(args[i], args[i + 1]);
  }
  if (required.some((key) => !values.has(key)) || ((phase === "restore" || phase === "reconcile") && !values.has("--receipt")) ||
    ((yes || values.has("--approved-digest")) && !/^[a-f0-9]{64}$/u.test(values.get("--approved-digest") ?? ""))) throw new Error("SMOKE_ARGUMENTS");
  const baseline = await privateJson(values.get("--baseline")!);
  const plan = phase === "plan"
    ? compilePublicationPlan((await privateJson(values.get("--source")!)).value, { projectId: values.get("--project")!, dataset: values.get("--dataset")!, apiVersion: values.get("--api-version")! }, values.get("--language")!, values.get("--nonce") ?? randomUUID(), baseline.digest)
    : validatePublicationPlan((await privateJson(values.get("--plan")!)).value, yes ? values.get("--approved-digest") : undefined);
  if (plan.baselineDigest !== baseline.digest) throw new Error("SMOKE_BASELINE_DIGEST");
  const receipt = values.has("--receipt") ? (await privateJson(values.get("--receipt")!)).value : undefined;
  if (phase === "restore") restoreRevision(plan, receipt);
  if (yes) requireRecoveryEvidence(plan, baseline.value);
  const fd = await reserveOutput(values.get("--out")!);
  try {
    if (phase === "plan") { await save(fd, plan); console.log(JSON.stringify({ status: "plan-only", digest: plan.digest, language: plan.language, field: "intro", documents: 1 })); return; }
    if (!yes && phase !== "reconcile") { await save(fd, { status: "plan-only", phase, planDigest: plan.digest, automaticRetry: false }); console.log(JSON.stringify({ status: "plan-only", phase, digest: plan.digest })); return; }
    // Resolve credentials only after local validation and reserving private output.
    if (process.env.SANITY_PROJECT_ID !== plan.target.projectId || process.env.SANITY_DATASET !== plan.target.dataset || process.env.SANITY_API_VERSION !== plan.target.apiVersion) throw new Error("SMOKE_ENV_TARGET");
    const tokenName = phase === "reconcile" ? "SANITY_AUDIT_TOKEN" : "SANITY_PUBLICATION_TOKEN";
    if (process.env[`NEXT_PUBLIC_${tokenName}`]) throw new Error("SMOKE_PUBLIC_TOKEN");
    const connection = parseReadConnection({ ...plan.target, token: process.env[tokenName] ?? "" });
    const read = () => runReadQuery(connection, { perspective: "raw", query: "*[_id in $ids || _id match $versions][0...2]", params: { ids: [plan.source._id, `drafts.${plan.source._id}`], versions: `versions.*.${plan.source._id}` } });
    let report: unknown;
    if (phase === "reconcile") {
      const r = object(receipt);
      if (r.version !== 1 || r.planDigest !== plan.digest || !["apply", "restore"].includes(String(r.phase)) ||
        typeof r.expectedRevision !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(r.expectedRevision) ||
        (r.phase === "apply" && r.expectedRevision !== plan.source._rev) || (r.phase === "restore" && r.expectedRevision === plan.source._rev)) throw new Error("SMOKE_RECEIPT");
      report = { version: 1, phase: r.phase, planDigest: plan.digest, expectedRevision: r.expectedRevision, readOnlyReconciliation: true,
        visibleUpdateVerified: false, genuineWebhookVerified: false, canonicalLaunchVerified: false, automaticRetry: false,
        ...reconcilePublication(plan, await read(), r.phase as "apply" | "restore", r.expectedRevision) };
    } else {
      report = await runPublicationSmoke(plan, phase as "apply" | "restore", receipt, { read,
        mutate: async (patch) => { await runSeedMutationBatches(connection, [patch], { visibility: "sync" }); },
        prepare: (record) => prepare(values.get("--out")!, record) });
    }
    await save(fd, report); const result = object(report);
    console.log(JSON.stringify({ status: result.status, phase: result.phase, digest: plan.digest, automaticRetry: false }));
    if (!["applied", "restored"].includes(String(result.status))) process.exitCode = 1;
  } finally { await fd.close(); }
}
main().catch(() => { console.error("CMS publication check failed; details withheld. Inspect private receipts before any new operation; an uncertain mutation must never be retried automatically."); process.exitCode = 1; });
