#!/usr/bin/env node
/** AB#250: local plan by default; --live performs anonymous reads only. */
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildLegacyDocumentPlan } from "./legacy-delivery-document-plan.mts";
import { MAX_INPUT_BYTES } from "./legacy-delivery-import-plan.mts";
import { verifyLegacyAssetBytes } from "./legacy-asset-verification.mts";

async function requireIgnoredOutput(file: string) {
  const exec = promisify(execFile);
  let root: string;
  try { root = (await exec("git", ["-C", path.dirname(file), "rev-parse", "--show-toplevel"])).stdout.trim(); }
  catch (error) {
    if (typeof error === "object" && error !== null && "stderr" in error && typeof error.stderr === "string" && error.stderr.includes("not a git repository")) return;
    throw new Error("GIT_GUARD");
  }
  const relative = path.relative(root, file);
  try {
    const tracked = await exec("git", ["-C", root, "ls-files", "--", relative]);
    if (tracked.stdout.trim()) throw new Error("OUTPUT_TRACKED");
    await exec("git", ["-C", root, "check-ignore", "--quiet", "--", relative]);
  } catch { throw new Error("OUTPUT_NOT_IGNORED"); }
}

async function privateJson(file: string): Promise<unknown> {
  const resolved = path.resolve(file);
  if (await realpath(resolved) !== resolved || process.getuid === undefined) throw new Error("PRIVATE_INPUT");
  const fd = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await fd.stat();
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600 || stat.size < 1 || stat.size > MAX_INPUT_BYTES) throw new Error("PRIVATE_INPUT");
    const data = Buffer.alloc(stat.size + 1);
    const { bytesRead } = await fd.read(data, 0, data.length, 0);
    const after = await fd.stat();
    if (bytesRead !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw new Error("INPUT_CHANGED");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data.subarray(0, bytesRead)));
  } finally { await fd.close(); }
}

async function main() {
  const args = process.argv.slice(2), values = new Map<string, string>();
  const live = args.at(-1) === "--live";
  if (live) args.pop();
  for (let i = 0; i < args.length; i += 2) {
    if (!["--plan", "--bindings", "--approved-digest", "--out"].includes(args[i]) || !args[i + 1] || values.has(args[i])) throw new Error("ARGUMENTS");
    values.set(args[i], args[i + 1]);
  }
  if (values.size !== 4) throw new Error("ARGUMENTS");
  const input = await privateJson(values.get("--plan")!);
  if (typeof input !== "object" || input === null || !("source" in input)) throw new Error("SOURCE");
  const bindings = await privateJson(values.get("--bindings")!);
  const now = Date.now(), digest = values.get("--approved-digest")!;
  const candidate = buildLegacyDocumentPlan(input.source, digest, bindings, now);
  const out = path.resolve(values.get("--out")!);
  const parent = await lstat(path.dirname(out)), owner = process.getuid?.();
  if (owner === undefined || !parent.isDirectory() || parent.uid !== owner || (parent.mode & 0o777) !== 0o700 || await realpath(path.dirname(out)) !== path.dirname(out)) throw new Error("PRIVATE_OUTPUT");
  await requireIgnoredOutput(out);
  // Reserve before network work. Never overwrite an earlier receipt.
  const fd = await open(out, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    const report = live ? await verifyLegacyAssetBytes(input.source, digest, bindings, now)
      : { version: 1, status: "plan-only", counts: candidate.counts, reviewDigest: candidate.reviewDigest, candidateDigest: candidate.candidateDigest,
        checkedAssets: 0, limitations: ["no-network-request", "not-provider-proof", "not-import-or-publication-approval"] };
    await fd.writeFile(JSON.stringify(report, null, 2) + "\n");
    await fd.sync();
    console.log(JSON.stringify({ status: report.status, counts: report.counts, checkedAssets: report.checkedAssets }));
    if (live && report.status !== "matched") process.exitCode = 1;
  } finally { await fd.close(); }
}
main().catch(() => { console.error("Legacy asset verification failed; input, target or output is unverified. Details withheld."); process.exitCode = 1; });
