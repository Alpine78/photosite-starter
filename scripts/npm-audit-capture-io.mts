/** Bounded POSIX subprocess and filesystem adapter; no child output is streamed. */
import { spawn } from "node:child_process";
import { constants, type Stats } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, open, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { AUDIT_TRIAGE_LIMITS } from "./npm-audit-triage.mts";
import {
  AUDIT_CAPTURE_LIMITS, AUDIT_TARGETS, AuditCaptureError, captureManifest,
  classifyAuditCapture, digestBytes, type AuditChildResult, type AuditTarget, type CaptureTargetSummary,
} from "./npm-audit-capture.mts";

const checkAbort = (signal: AbortSignal) => { if (signal.aborted) throw new AuditCaptureError("canceled"); };
const within = (parent: string, child: string) => { const relative = path.relative(parent, child); return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); };
async function verifyDirectory(directory: string, expected: Stats) {
  const actual = await lstat(directory);
  if (!actual.isDirectory() || actual.dev !== expected.dev || actual.ino !== expected.ino ||
    actual.uid !== expected.uid || actual.mode !== expected.mode || await realpath(directory) !== directory) throw new AuditCaptureError("configuration");
}

/** Native test controls may lower bounds; the production CLI uses these defaults. */
export function runAuditChild(options: {
  npmCli: string; cwd: string; target: AuditTarget; signal: AbortSignal;
  deadlineMs?: number; stdoutBytes?: number; stderrBytes?: number;
}): Promise<AuditChildResult> {
  return new Promise((resolve, reject) => {
    if (process.platform === "win32") return reject(new AuditCaptureError("configuration"));
    if (options.signal.aborted) return reject(new AuditCaptureError("canceled"));
    const deadlineMs = options.deadlineMs ?? AUDIT_CAPTURE_LIMITS.deadlineMs;
    const stdoutLimit = options.stdoutBytes ?? AUDIT_CAPTURE_LIMITS.stdoutBytes;
    const stderrLimit = options.stderrBytes ?? AUDIT_CAPTURE_LIMITS.stderrBytes;
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > AUDIT_CAPTURE_LIMITS.deadlineMs ||
      !Number.isSafeInteger(stdoutLimit) || stdoutLimit < 0 || stdoutLimit > AUDIT_CAPTURE_LIMITS.stdoutBytes ||
      !Number.isSafeInteger(stderrLimit) || stderrLimit < 0 || stderrLimit > AUDIT_CAPTURE_LIMITS.stderrBytes) return reject(new AuditCaptureError("configuration"));
    // Explicit prefixes prevent an inherited npm_config_prefix from auditing a
    // different tree than the fixed lockfile we hash. Registry settings survive.
    const args = [options.npmCli, "audit", "--prefix", options.target === "studio" ? "studio" : ".", "--include=prod", "--include=dev", "--audit-level=low", "--json"];
    const child = spawn(process.execPath, args, { cwd: options.cwd, env: process.env, shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = []; let stdoutBytes = 0, stderrBytes = 0, finished = false;
    let failure: AuditCaptureError | undefined, cleanup: ReturnType<typeof setTimeout> | undefined;
    function killGroup() { if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* Already exited, or OS refused; bounded settlement still applies. */ } } }
    function finish() {
      if (finished) return; finished = true;
      clearTimeout(deadline); if (cleanup) clearTimeout(cleanup);
      options.signal.removeEventListener("abort", cancel);
      child.stdout.destroy(); child.stderr.destroy();
      if (failure) reject(failure);
      else resolve({ stdout: Buffer.concat(chunks, stdoutBytes), stderrBytes, exitCode: child.exitCode, signal: child.signalCode });
    }
    function stop(code: AuditCaptureError["code"]) {
      if (finished || failure) return;
      failure = new AuditCaptureError(code); killGroup();
      if (cleanup) clearTimeout(cleanup);
      cleanup = setTimeout(finish, AUDIT_CAPTURE_LIMITS.cleanupMs);
    }
    const cancel = () => stop("canceled");
    const deadline = setTimeout(() => stop("deadline"), deadlineMs);
    options.signal.addEventListener("abort", cancel, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      if (finished || failure) return;
      if (chunk.length > stdoutLimit - stdoutBytes) { stop("output-overflow"); return; }
      stdoutBytes += chunk.length; chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (finished || failure) return;
      if (chunk.length > stderrLimit - stderrBytes) { stop("output-overflow"); return; }
      stderrBytes += chunk.length;
    });
    child.once("error", () => { stop("spawn-failed"); finish(); });
    // A leader can exit while descendants retain pipes. Kill its group and bound
    // waiting for close rather than accepting a truncated/never-ending capture.
    child.once("exit", () => { killGroup(); if (!cleanup) cleanup = setTimeout(() => { stop("deadline"); finish(); }, AUDIT_CAPTURE_LIMITS.cleanupMs); });
    child.once("close", finish);
    if (options.signal.aborted) cancel();
  });
}

export async function readCaptureLock(filePath: string) {
  try {
    const file = await open(filePath, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat(); if (!stat.isFile() || stat.size > AUDIT_TRIAGE_LIMITS.lockfileBytes) throw new Error();
      const buffer = Buffer.alloc(AUDIT_TRIAGE_LIMITS.lockfileBytes + 1); let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
        if (!bytesRead) break; length += bytesRead;
      }
      if (length > AUDIT_TRIAGE_LIMITS.lockfileBytes) throw new Error();
      return buffer.subarray(0, length);
    } finally { await file.close(); }
  } catch { throw new AuditCaptureError("lockfile-invalid"); }
}

async function exclusiveFile(filePath: string, bytes: Buffer) {
  const file = await open(filePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1 || stat.uid !== process.getuid!()) throw new Error();
    await file.writeFile(bytes);
    const after = await file.stat(), named = await lstat(filePath);
    for (const actual of [after, named]) {
      if (!actual.isFile() || actual.dev !== stat.dev || actual.ino !== stat.ino || actual.uid !== stat.uid ||
        actual.mode !== stat.mode || actual.nlink !== stat.nlink || actual.size !== bytes.length) throw new Error();
    }
  } finally { await file.close(); }
}

export type AuditCaptureOptions = {
  root: string; temporaryRoot: string; artifactRoot: string; npmCli: string;
  buildId: string; jobAttempt: string; signal: AbortSignal;
  ready(): void; status(target: AuditTarget, status: CaptureTargetSummary["status"], gateExit: number): void;
};
export type AuditCaptureRunner = (options: Parameters<typeof runAuditChild>[0]) => Promise<AuditChildResult>;

export async function captureAudits(options: AuditCaptureOptions, runner: AuditCaptureRunner = runAuditChild) {
  let privateDirectory: string | undefined, artifactDirectory: string | undefined;
  let privateIdentity: Stats | undefined, artifactIdentity: Stats | undefined;
  let createdArtifact = false;
  let manifest: ReturnType<typeof captureManifest> | undefined;
  try {
    checkAbort(options.signal);
    if (process.platform === "win32" || !/^[1-9]\d{0,15}$/.test(options.buildId) || !/^[1-9]\d{0,7}$/.test(options.jobAttempt) ||
      [options.root, options.temporaryRoot, options.artifactRoot, options.npmCli].some(value => !path.isAbsolute(value))) throw new AuditCaptureError("configuration");
    const root = await realpath(options.root), temp = await realpath(options.temporaryRoot), artifact = await realpath(options.artifactRoot);
    if (within(root, temp) || within(temp, root) || within(root, artifact) || within(artifact, root) || within(temp, artifact) || within(artifact, temp)) throw new AuditCaptureError("configuration");
    if (!(await lstat(options.npmCli)).isFile()) throw new AuditCaptureError("configuration");
    privateDirectory = await mkdtemp(path.join(temp, "dependency-audit-"));
    await chmod(privateDirectory, 0o700);
    privateIdentity = await lstat(privateDirectory);
    if (await realpath(privateDirectory) !== privateDirectory) throw new AuditCaptureError("configuration");
    artifactDirectory = path.join(artifact, `dependency-audit-${options.buildId}-${options.jobAttempt}`);
    await mkdir(artifactDirectory, { mode: 0o700 }); // Exclusive leaf, never recursive/reused.
    createdArtifact = true;
    artifactIdentity = await lstat(artifactDirectory);
    const targets: CaptureTargetSummary[] = [];
    const safeReports: { file: string; bytes: Buffer }[] = [];
    for (const target of AUDIT_TARGETS) {
      checkAbort(options.signal);
      let lockfileSha256: string | null = null;
      try {
        const targetDirectory = target === "root" ? root : path.join(root, "studio");
        if (await realpath(targetDirectory) !== targetDirectory) throw new AuditCaptureError("configuration");
        // Deliberately unsupported profiles, not a claim about npm12 precedence.
        for (const name of ["npm-shrinkwrap.json", "yarn.lock"]) {
          try { await lstat(path.join(targetDirectory, name)); throw new AuditCaptureError("configuration"); }
          catch (error) { if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error; }
        }
        const lock = path.join(targetDirectory, "package-lock.json"), before = await readCaptureLock(lock);
        lockfileSha256 = digestBytes(before);
        checkAbort(options.signal);
        const child = await runner({ npmCli: options.npmCli, cwd: root, target, signal: options.signal });
        checkAbort(options.signal);
        const after = await readCaptureLock(lock), decision = classifyAuditCapture(before, after, child);
        checkAbort(options.signal);
        await verifyDirectory(privateDirectory, privateIdentity);
        await exclusiveFile(path.join(privateDirectory, `${target}.paired.json`), Buffer.from(JSON.stringify(decision.envelope)));
        const bytes = Buffer.from(JSON.stringify(decision.triage)), file = `${target}.triage.json`;
        safeReports.push({ file, bytes });
        checkAbort(options.signal);
        targets.push({ target, status: decision.triage.status as "clean" | "findings", gateExit: decision.gateExit, reason: null, lockfileSha256,
          report: { file, sha256: digestBytes(bytes), bytes: bytes.length } });
      } catch (error) {
        checkAbort(options.signal);
        if (error instanceof AuditCaptureError && error.code === "canceled") throw error;
        targets.push({ target, status: "tool-error", gateExit: 2, reason: error instanceof AuditCaptureError ? error.code : "internal", lockfileSha256, report: null });
      }
      const result = targets.at(-1)!; options.status(target, result.status, result.gateExit);
    }
    checkAbort(options.signal);
    // Complete both audits before artifact IO, so an output failure cannot
    // prevent the other ordinary target check. At most two bounded reports.
    for (const report of safeReports) {
      checkAbort(options.signal);
      await verifyDirectory(artifactDirectory, artifactIdentity);
      try { await exclusiveFile(path.join(artifactDirectory, report.file), report.bytes); }
      catch { throw new AuditCaptureError("artifact-invalid"); }
    }
    manifest = captureManifest(options.buildId, options.jobAttempt, targets);
    await verifyDirectory(artifactDirectory, artifactIdentity);
    await exclusiveFile(path.join(artifactDirectory, "capture-summary.pending"), Buffer.from(JSON.stringify(manifest)));
    checkAbort(options.signal);
    await rename(path.join(artifactDirectory, "capture-summary.pending"), path.join(artifactDirectory, "capture-summary.json"));
  } finally {
    // Only our exact mkdtemp result can be recursively removed. Parents supplied
    // by CI are never removed. Same-owner filesystem races/SIGKILL are residuals.
    if (privateDirectory) {
      if (!privateIdentity) throw new AuditCaptureError("configuration");
      await verifyDirectory(privateDirectory, privateIdentity);
      await rm(privateDirectory, { recursive: true });
    }
    if (options.signal.aborted && artifactDirectory && createdArtifact) {
      if (!artifactIdentity) throw new AuditCaptureError("configuration");
      await verifyDirectory(artifactDirectory, artifactIdentity);
      await rm(artifactDirectory, { recursive: true });
    }
  }
  checkAbort(options.signal);
  if (!manifest) throw new AuditCaptureError("artifact-invalid");
  if (!artifactDirectory || !artifactIdentity) throw new AuditCaptureError("artifact-invalid");
  await verifyDirectory(artifactDirectory, artifactIdentity);
  checkAbort(options.signal);
  options.ready();
  return manifest;
}
