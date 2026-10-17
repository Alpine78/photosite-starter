import { spawn, spawnSync } from "node:child_process";
import { getEventListeners } from "node:events";
import { readFileSync, readdirSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AUDIT_CAPTURE_LIMITS, classifyAuditCapture, digestBytes, type AuditChildResult } from "./npm-audit-capture.mts";
import { captureAudits, readCaptureLock, runAuditChild, type AuditCaptureOptions } from "./npm-audit-capture-io.mts";

const marker = "SYNTHETIC_PRIVATE_PROVIDER_VALUE";
function fixture(severity?: "info" | "low" | "high", inherited = false) {
  const lock = Buffer.from(JSON.stringify({ lockfileVersion: 3, packages: {
    "": { name: "fixture" }, "node_modules/dep": { version: "1.0.0", resolved: `https://token:${marker}@example.test` },
    "node_modules/top": { version: "2.0.0", dev: true },
  } }));
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  const vulnerabilities: Record<string, unknown> = {};
  if (severity) {
    counts[severity] = inherited ? 2 : 1; counts.total = counts[severity];
    vulnerabilities.dep = { name: "dep", severity, isDirect: true, via: [{ source: 100, name: "dep", dependency: "dep", severity, title: marker, url: `https://example.test/${marker}`, range: "<2" }],
      nodes: ["node_modules/dep"], fixAvailable: { name: "dep", version: "0.9.0", isSemVerMajor: true } };
    if (inherited) vulnerabilities.top = { name: "top", severity, isDirect: false, via: ["dep"], nodes: ["node_modules/top"], fixAvailable: false };
  }
  const audit = { auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: counts } };
  return { lock, child: { stdout: Buffer.from(JSON.stringify(audit)), stderrBytes: 0, exitCode: severity && severity !== "info" ? 1 : 0, signal: null } satisfies AuditChildResult };
}
async function environment() {
  const base = await mkdtemp(path.join(tmpdir(), "audit-capture-fixture-"));
  const root = path.join(base, "repository"), temporaryRoot = path.join(base, "private"), artifactRoot = path.join(base, "artifacts");
  await Promise.all([mkdir(path.join(root, "studio"), { recursive: true }), mkdir(temporaryRoot), mkdir(artifactRoot)]);
  const npmCli = path.join(base, "npm-fixture.mjs"); await writeFile(npmCli, "process.stdout.write('{}');");
  const value = fixture();
  await Promise.all([writeFile(path.join(root, "package-lock.json"), value.lock), writeFile(path.join(root, "studio/package-lock.json"), value.lock)]);
  const controller = new AbortController(), statuses: string[] = []; let ready = false;
  const options: AuditCaptureOptions = { root, temporaryRoot, artifactRoot, npmCli, buildId: "123", jobAttempt: "1", signal: controller.signal,
    ready() { ready = true; }, status(target, status, code) { statuses.push(`${target}:${status}:${code}`); } };
  return { base, options, controller, statuses, isReady: () => ready, close: () => rm(base, { recursive: true, force: true }) };
}

describe("same-operation policy and redaction", () => {
  it.each([undefined, "info", "low", "high"] as const)("preserves low-threshold semantics for %s", severity => {
    const { lock, child } = fixture(severity, Boolean(severity));
    const result = classifyAuditCapture(lock, lock, child);
    expect(result.gateExit).toBe(severity && severity !== "info" ? 1 : 0);
    expect(result.triage.status).toBe(severity ? "findings" : "clean");
    expect(result.triage.evidence).toMatchObject({ captureProvenanceVerified: false, reportFreshnessVerified: false, bundleInclusionVerified: false, exploitabilityVerified: false });
    expect(JSON.stringify(result.triage)).not.toContain(marker);
    if (severity) expect(result.triage.summary).toMatchObject({ affectedEntries: 2, uniqueNumericAdvisories: 1, inheritedEntries: 1 });
  });
  it.each(["digest", "json", "utf8", "error-object", "triage", "exit", "signal", "stdout", "stderr"])("refuses %s with a fixed error only", kind => {
    const { lock, child } = fixture("high"); let after = lock;
    if (kind === "digest") after = Buffer.concat([lock, Buffer.from("\n")]);
    if (kind === "json") child.stdout = Buffer.from(marker);
    if (kind === "utf8") child.stdout = Buffer.from([255]);
    if (kind === "error-object") child.stdout = Buffer.from(JSON.stringify({ error: { message: marker } }));
    if (kind === "triage") child.stdout = Buffer.from('{"auditReportVersion":1}');
    if (kind === "exit") child.exitCode = 0;
    if (kind === "signal") Object.assign(child, { exitCode: null, signal: "SIGTERM" });
    if (kind === "stdout") child.stdout = Buffer.alloc(AUDIT_CAPTURE_LIMITS.stdoutBytes + 1);
    if (kind === "stderr") child.stderrBytes = AUDIT_CAPTURE_LIMITS.stderrBytes + 1;
    expect(() => classifyAuditCapture(lock, after, child)).toThrow();
    try { classifyAuditCapture(lock, after, child); } catch (error) { expect(String(error)).not.toContain(marker); }
  });
  it("accepts exactly the raw stdout cap and refuses cap+1, independently of compact JSON size", () => {
    const { lock, child } = fixture(); child.stdout = Buffer.from(child.stdout.toString().padEnd(AUDIT_CAPTURE_LIMITS.stdoutBytes, " "));
    expect(classifyAuditCapture(lock, lock, child).gateExit).toBe(0);
    child.stdout = Buffer.concat([child.stdout, Buffer.from(" ")]); expect(() => classifyAuditCapture(lock, lock, child)).toThrow("output-overflow");
  });
});

describe("private capture and committed safe artifacts", () => {
  it("runs both fixed targets, seals private raw separately and commits manifest before readiness", async () => {
    const e = await environment();
    try {
      const seen: string[] = [];
      e.options.ready = () => {
        const leaf = path.join(e.options.artifactRoot, "dependency-audit-123-1");
        expect(JSON.parse(readFileSync(path.join(leaf, "capture-summary.json"), "utf8")).targets).toHaveLength(2);
        expect(readdirSync(e.options.temporaryRoot)).toEqual([]);
        seen.push("ready");
      };
      const manifest = await captureAudits(e.options, async request => {
        seen.push(request.target);
        expect(request.cwd).toBe(e.options.root);
        if (request.target === "studio") {
          const dirs = await readdir(e.options.temporaryRoot); expect(dirs).toHaveLength(1);
          const raw = path.join(e.options.temporaryRoot, dirs[0], "root.paired.json");
          expect((await stat(path.dirname(raw))).mode & 0o777).toBe(0o700); expect((await stat(raw)).mode & 0o777).toBe(0o600);
          expect(await readFile(raw, "utf8")).toContain(marker);
          const leaf = path.join(e.options.artifactRoot, "dependency-audit-123-1");
          expect(await readdir(leaf)).toEqual([]); expect(seen).not.toContain("ready");
        }
        return fixture(request.target === "root" ? "high" : "info", true).child;
      });
      expect(seen).toEqual(["root", "studio", "ready"]); expect(manifest.gateExit).toBe(1);
      expect(manifest.targets.map(value => value.status)).toEqual(["findings", "findings"]);
      expect(await readdir(e.options.temporaryRoot)).toEqual([]);
      const leaf = path.join(e.options.artifactRoot, "dependency-audit-123-1");
      expect((await readdir(leaf)).sort()).toEqual(["capture-summary.json", "root.triage.json", "studio.triage.json"]);
      expect(JSON.parse(await readFile(path.join(leaf, "capture-summary.json"), "utf8"))).toEqual(manifest);
      for (const target of manifest.targets) {
        const bytes = await readFile(path.join(leaf, target.report!.file));
        expect(target.report).toMatchObject({ sha256: digestBytes(bytes), bytes: bytes.length });
        expect(bytes.toString()).not.toContain(marker); expect(bytes.toString()).not.toContain(e.base);
      }
      expect(JSON.stringify(manifest)).not.toMatch(/https:|SYNTHETIC_PRIVATE|repository/);
    } finally { await e.close(); }
  });
  it("continues after ordinary first-target tooling failure and records no invented report", async () => {
    const e = await environment();
    try {
      const seen: string[] = [];
      const manifest = await captureAudits(e.options, async request => { seen.push(request.target); return request.target === "root" ? { ...fixture().child, stdout: Buffer.from(marker) } : fixture().child; });
      expect(seen).toEqual(["root", "studio"]); expect(manifest.gateExit).toBe(2); expect(e.isReady()).toBe(true);
      expect(manifest.targets[0]).toMatchObject({ status: "tool-error", reason: "json-invalid", report: null });
      expect(manifest.targets[1].status).toBe("clean");
    } finally { await e.close(); }
  });
  it("refuses lockfile changes after the child, yet still checks Studio", async () => {
    const e = await environment();
    try {
      const manifest = await captureAudits(e.options, async request => {
        if (request.target === "root") await writeFile(path.join(e.options.root, "package-lock.json"), Buffer.concat([fixture().lock, Buffer.from("\n")]));
        return fixture().child;
      });
      expect(manifest.targets.map(t => t.reason)).toEqual(["digest-drift", null]); expect(manifest.gateExit).toBe(2);
    } finally { await e.close(); }
  });
  it("cancel stops before the second target, removes its own output and never becomes ready", async () => {
    const e = await environment();
    try {
      const seen: string[] = [];
      await expect(captureAudits(e.options, async request => { seen.push(request.target); e.controller.abort(); return fixture().child; })).rejects.toThrow("canceled");
      expect(seen).toEqual(["root"]); expect(e.isReady()).toBe(false);
      expect(await readdir(e.options.temporaryRoot)).toEqual([]); expect(await readdir(e.options.artifactRoot)).toEqual([]);
    } finally { await e.close(); }
  });
  it("refuses an old artifact leaf without deleting or republishing it", async () => {
    const e = await environment();
    try {
      const leaf = path.join(e.options.artifactRoot, "dependency-audit-123-1"); await mkdir(leaf); await writeFile(path.join(leaf, "owner-data"), marker);
      await expect(captureAudits(e.options, async () => fixture().child)).rejects.toThrow();
      expect(await readFile(path.join(leaf, "owner-data"), "utf8")).toBe(marker); expect(e.isReady()).toBe(false);
      expect(await readdir(e.options.temporaryRoot)).toEqual([]);
    } finally { await e.close(); }
  });
  it("never recursively removes a replacement for its own private directory", async () => {
    const e = await environment(); let replacement = "";
    try {
      await expect(captureAudits(e.options, async request => {
        if (request.target === "root") {
          replacement = path.join(e.options.temporaryRoot, (await readdir(e.options.temporaryRoot))[0]);
          await rename(replacement, `${replacement}-retained`); await mkdir(replacement, { mode: 0o700 });
          await writeFile(path.join(replacement, "owner-data"), marker);
        }
        return fixture().child;
      })).rejects.toThrow("configuration");
      expect(e.isReady()).toBe(false); expect(await readFile(path.join(replacement, "owner-data"), "utf8")).toBe(marker);
    } finally { await e.close(); }
  });
  it("runs both audits before artifact failure, leaving no publishable partial manifest", async () => {
    const e = await environment();
    try {
      const seen: string[] = [], leaf = path.join(e.options.artifactRoot, "dependency-audit-123-1");
      await expect(captureAudits(e.options, async request => {
        seen.push(request.target);
        if (request.target === "root") await writeFile(path.join(leaf, "root.triage.json"), marker);
        return fixture().child;
      })).rejects.toThrow("artifact-invalid");
      expect(seen).toEqual(["root", "studio"]); expect(e.isReady()).toBe(false);
      await expect(stat(path.join(leaf, "capture-summary.json"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(path.join(leaf, "root.triage.json"), "utf8")).toBe(marker);
      expect(await readdir(e.options.temporaryRoot)).toEqual([]);
    } finally { await e.close(); }
  });
  it("cancel after both target captures still prevents manifest commitment and readiness", async () => {
    const e = await environment();
    try {
      e.options.status = target => { if (target === "studio") e.controller.abort(); };
      await expect(captureAudits(e.options, async () => fixture().child)).rejects.toThrow("canceled");
      expect(e.isReady()).toBe(false); expect(await readdir(e.options.artifactRoot)).toEqual([]);
      expect(await readdir(e.options.temporaryRoot)).toEqual([]);
    } finally { await e.close(); }
  });
  it.each(["../bad", "0", "1\n", "1\u2028", "1\n##vso[task.setvariable variable=x]true"])("refuses unsafe build identity %s before output creation", async buildId => {
    const e = await environment(); try { await expect(captureAudits({ ...e.options, buildId })).rejects.toThrow("configuration"); expect(await readdir(e.options.artifactRoot)).toEqual([]); } finally { await e.close(); }
  });
  it("refuses private/public/repository containment in both directions", async () => {
    const e = await environment();
    try {
      for (const temporaryRoot of [e.options.root, e.base, e.options.artifactRoot]) await expect(captureAudits({ ...e.options, temporaryRoot })).rejects.toThrow("configuration");
      for (const artifactRoot of [e.options.root, e.base, e.options.temporaryRoot]) await expect(captureAudits({ ...e.options, artifactRoot })).rejects.toThrow("configuration");
    } finally { await e.close(); }
  });
  it("refuses lock symlinks/FIFOs and unsupported alternate-lock profiles without hanging", async () => {
    const e = await environment();
    try {
      const link = path.join(e.base, "link.json"); await symlink(path.join(e.options.root, "package-lock.json"), link);
      await expect(readCaptureLock(link)).rejects.toThrow("lockfile-invalid"); await expect(readCaptureLock(e.base)).rejects.toThrow("lockfile-invalid");
      if (process.platform !== "win32") { const fifo = path.join(e.base, "fifo"); spawnSync("mkfifo", [fifo]); await expect(readCaptureLock(fifo)).rejects.toThrow("lockfile-invalid"); }
      await writeFile(path.join(e.options.root, "npm-shrinkwrap.json"), "{}");
      const seen: string[] = [], result = await captureAudits(e.options, async request => { seen.push(request.target); return fixture().child; });
      expect(seen).toEqual(["studio"]); expect(result.targets[0].reason).toBe("configuration");
    } finally { await e.close(); }
  });
});

describe("native bounded subprocess controls (no npm/registry)", () => {
  it.each([false, true])("enforces the actual stdout cap, overflow=%s", async overflow => {
    const e = await environment(); try {
      await writeFile(e.options.npmCli, `process.stdout.write('x'.repeat(${AUDIT_CAPTURE_LIMITS.stdoutBytes + Number(overflow)}));`);
      const run = runAuditChild({ npmCli: e.options.npmCli, cwd: e.options.root, target: "root", signal: e.controller.signal });
      if (overflow) await expect(run).rejects.toThrow("output-overflow");
      else expect((await run).stdout.length).toBe(AUDIT_CAPTURE_LIMITS.stdoutBytes);
      expect(getEventListeners(e.controller.signal, "abort")).toHaveLength(0);
    } finally { await e.close(); }
  });
  it.each([false, true])("counts/discards bounded stderr, overflow=%s", async overflow => {
    const e = await environment(); try {
      await writeFile(e.options.npmCli, `process.stderr.write('x'.repeat(${AUDIT_CAPTURE_LIMITS.stderrBytes + Number(overflow)}));`);
      const run = runAuditChild({ npmCli: e.options.npmCli, cwd: e.options.root, target: "studio", signal: e.controller.signal });
      if (overflow) await expect(run).rejects.toThrow("output-overflow"); else expect((await run).stderrBytes).toBe(AUDIT_CAPTURE_LIMITS.stderrBytes);
    } finally { await e.close(); }
  });
  it("bounds a stubborn child, handles spawn failures and settles signal listeners", async () => {
    const e = await environment(); try {
      await writeFile(e.options.npmCli, "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);");
      await expect(runAuditChild({ npmCli: e.options.npmCli, cwd: e.options.root, target: "root", signal: e.controller.signal, deadlineMs: 100 })).rejects.toThrow("deadline");
      expect(getEventListeners(e.controller.signal, "abort")).toHaveLength(0);
      await expect(runAuditChild({ npmCli: e.options.npmCli, cwd: path.join(e.base, "missing"), target: "root", signal: e.controller.signal })).rejects.toThrow("spawn-failed");
    } finally { await e.close(); }
  });
  it("terminates pipe-holding descendants after the leader exits, preventing late output", async () => {
    const e = await environment(); const late = path.join(e.base, "late"), pidPath = path.join(e.base, "pid");
    try {
      const descendant = `require('fs').writeFileSync(${JSON.stringify(pidPath)},String(process.pid));process.send('ready');setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(late)},'BAD'),500);setInterval(()=>{},1000);`;
      await writeFile(e.options.npmCli, `import{spawn}from'node:child_process';const c=spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:['ignore',1,2,'ipc']});c.once('message',()=>process.exit(0));`);
      await runAuditChild({ npmCli: e.options.npmCli, cwd: e.options.root, target: "root", signal: e.controller.signal });
      await delay(650); await expect(stat(late)).rejects.toMatchObject({ code: "ENOENT" });
      const pid = Number(await readFile(pidPath, "utf8"));
      if (process.platform === "linux") {
        let state = "gone"; try { state = (await readFile(`/proc/${pid}/stat`, "utf8")).split(") ")[1][0]; } catch { /* Reaped. */ }
        expect(["gone", "Z"]).toContain(state);
      }
    } finally { await e.close(); }
  });
});

describe("actual redacted capture CLI", () => {
  const cli = fileURLToPath(new URL("./capture-npm-audit.mts", import.meta.url));
  const env = (e: Awaited<ReturnType<typeof environment>>): NodeJS.ProcessEnv => ({ PATH: process.env.PATH, NODE_ENV: "test", npm_execpath: e.options.npmCli,
    AGENT_TEMPDIRECTORY: e.options.temporaryRoot, BUILD_ARTIFACTSTAGINGDIRECTORY: e.options.artifactRoot, BUILD_BUILDID: "123", SYSTEM_JOBATTEMPT: "1" });
  it("uses exact flags/targets without streaming provider output and commits only safe files", async () => {
    const e = await environment(); try {
      await writeFile(e.options.npmCli, `import{writeFileSync}from'node:fs';const a=process.argv.slice(2);if(a.join('|')!==(['audit','--prefix',a[a.indexOf('--prefix')+1]==='studio'?'studio':'.','--include=prod','--include=dev','--audit-level=low','--json']).join('|'))process.exit(9);process.stderr.write(${JSON.stringify(marker)});process.stdout.write(${JSON.stringify(fixture("info", true).child.stdout.toString())});`);
      const result = spawnSync(process.execPath, [cli], { cwd: e.options.root, env: env(e), encoding: "utf8", timeout: 5000 });
      expect(result.status).toBe(0); expect(result.stderr).toBe(""); expect(result.stdout).not.toContain(marker); expect(result.stdout).not.toContain(e.base);
      expect(result.stdout.match(/dependencyAuditReady\]true/gu)).toHaveLength(1);
      expect(result.stdout).toContain("root: findings; gate=0"); expect(result.stdout).toContain("studio: findings; gate=0");
      expect(await readdir(e.options.temporaryRoot)).toEqual([]);
    } finally { await e.close(); }
  });
  it.each(["low", "error-object", "json", "exit"])("fails visibly and safely for %s without skipping Studio", async kind => {
    const e = await environment();
    try {
      const stdout = kind === "error-object" ? JSON.stringify({ error: { message: marker } }) : kind === "json" ? marker : fixture("low").child.stdout.toString();
      await writeFile(e.options.npmCli, `process.stderr.write(${JSON.stringify(marker)});process.stdout.write(${JSON.stringify(stdout)});process.exitCode=${kind === "exit" ? 9 : 1};`);
      const result = spawnSync(process.execPath, [cli], { cwd: e.options.root, env: env(e), encoding: "utf8", timeout: 5000 });
      expect(result.status).toBe(kind === "low" ? 1 : 2); expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain(marker); expect(result.stdout).not.toContain(e.base);
      expect(result.stdout).toContain("Dependency audit root:"); expect(result.stdout).toContain("Dependency audit studio:");
      expect(result.stdout).toContain("dependencyAuditReady]true");
    } finally { await e.close(); }
  });
  it("redacts top-level path errors and refuses unexpected CLI arguments", async () => {
    const e = await environment();
    try {
      for (const args of [[], [marker]]) {
        const result = spawnSync(process.execPath, [cli, ...args], { cwd: e.options.root, env: { ...env(e), AGENT_TEMPDIRECTORY: path.join(e.base, marker) }, encoding: "utf8", timeout: 5000 });
        expect(result.status).toBe(2); expect(result.stdout).not.toContain("dependencyAuditReady]true");
        expect(result.stderr).toMatch(/^Dependency audit failed: (?:internal|configuration)\n$/);
        expect(result.stderr).not.toContain(marker); expect(result.stderr).not.toContain(e.base);
      }
    } finally { await e.close(); }
  });
  it.each(["SIGINT", "SIGTERM"] as const)("forwards %s to the running audit and never starts Studio or publishes", async signal => {
    const e = await environment(), started = path.join(e.base, "started"), second = path.join(e.base, "second");
    try {
      await writeFile(e.options.npmCli, `import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(started)},'started');if(process.argv[process.argv.indexOf('--prefix')+1]==='studio')writeFileSync(${JSON.stringify(second)},'BAD');setInterval(()=>{},1000);`);
      const child = spawn(process.execPath, [cli], { cwd: e.options.root, env: env(e), stdio: ["ignore", "pipe", "pipe"] });
      let out = "", err = ""; child.stdout.on("data", b => { out += String(b); }); child.stderr.on("data", b => { err += String(b); });
      const ended = new Promise<number | null>(resolve => child.once("close", resolve));
      for (let i = 0; i < 200; i++) { try { await stat(started); break; } catch { await delay(10); } }
      await stat(started); child.kill(signal); expect(await ended).toBe(2);
      expect(out).not.toContain("dependencyAuditReady]true"); expect(err).toBe("Dependency audit failed: canceled\n");
      await expect(stat(second)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readdir(e.options.temporaryRoot)).toEqual([]); expect(await readdir(e.options.artifactRoot)).toEqual([]);
    } finally { await e.close(); }
  });
});
