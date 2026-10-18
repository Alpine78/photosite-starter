import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AUDIT_TRIAGE_LIMITS, triageSavedAudit } from "./npm-audit-triage.mts";

const advisory = { source: 100, name: "dep", dependency: "dep", title: "synthetic-secret", url: "https://registry.example.test/credential", range: "<2", severity: "high" };
function fixtures(packages: Record<string, unknown> = { "node_modules/dep": { version: "1.0.0" } }) {
  const lock = Buffer.from(JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "synthetic" }, ...packages } }));
  const entry = { name: "dep", via: [{ ...advisory }], severity: "high", isDirect: true, nodes: ["node_modules/dep"], fixAvailable: false };
  const audit = { auditReportVersion: 2, vulnerabilities: { dep: entry }, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 } } };
  return { lock, envelope: { schemaVersion: 1, lockfileSha256: createHash("sha256").update(lock).digest("hex"), audit } };
}

describe("operator-paired audit triage", () => {
  it("joins nested/scoped versions and declared flags while separating inherited entries", () => {
    const { lock, envelope } = fixtures({ "node_modules/dep": { version: "1.0.0", dev: true }, "node_modules/top/node_modules/@scope/child": { version: "2.0.1-beta.1+build", devOptional: true, optional: false } });
    Object.assign(envelope.audit.vulnerabilities, { "@scope/child": { name: "@scope/child", via: ["dep"], severity: "high", isDirect: false, nodes: ["node_modules/top/node_modules/@scope/child"], fixAvailable: { name: "parent", version: "0.9.0", isSemVerMajor: true } } });
    envelope.audit.metadata.vulnerabilities.high = 2; envelope.audit.metadata.vulnerabilities.total = 2;
    const result = triageSavedAudit(envelope, lock);
    expect(result.summary).toMatchObject({ affectedEntries: 2, uniqueNumericAdvisories: 1, inheritedEntries: 1 });
    expect(result.entries[0]).toMatchObject({ name: "@scope/child", inheritedVia: ["dep"], directAdvisoryIds: [], fixProposal: { name: "parent", version: "0.9.0", isSemVerMajor: true }, nodes: [{ version: "2.0.1-beta.1+build", declaredInstallFlags: { dev: false, optional: false, devOptional: true } }] });
    expect(result.entries[1].nodes[0].declaredInstallFlags.dev).toBe(true);
    expect(result.evidence).toEqual({ pairing: "operator-supplied", captureProvenanceVerified: false, reportFreshnessVerified: false, bundleInclusionVerified: false, exploitabilityVerified: false, fixProposalsVerified: false });
  });

  it("keeps ordinary, optional and mixed install declarations distinct from runtime evidence", () => {
    for (const declared of [{}, { optional: true }, { dev: true, optional: true }, { devOptional: true }]) {
      const { lock, envelope } = fixtures({ "node_modules/dep": { version: "1.0.0", ...declared } });
      const result = triageSavedAudit(envelope, lock);
      expect(result.entries[0].nodes[0].declaredInstallFlags).toEqual({ dev: false, optional: false, devOptional: false, ...declared });
      expect(result.evidence.bundleInclusionVerified).toBe(false);
      expect(result.evidence.exploitabilityVerified).toBe(false);
    }
  });

  it("projects no provider strings, resolved URLs, arbitrary metadata or credentials", () => {
    const { lock, envelope } = fixtures({ "node_modules/dep": { version: "1.0.0", resolved: "https://token:secret@example.test/archive", arbitrary: "SECRET" } });
    const text = JSON.stringify(triageSavedAudit(envelope, lock));
    for (const secret of ["synthetic-secret", "credential", "token", "SECRET", "https://"]) expect(text).not.toContain(secret);
    expect(text).toContain('"version":"1.0.0"');
  });

  it("validates a clean report without inventing runtime assurance", () => {
    const { lock, envelope } = fixtures();
    envelope.audit.vulnerabilities = {} as typeof envelope.audit.vulnerabilities;
    envelope.audit.metadata.vulnerabilities.high = 0; envelope.audit.metadata.vulnerabilities.total = 0;
    expect(triageSavedAudit(envelope, lock)).toMatchObject({ status: "clean", entries: [], evidence: { exploitabilityVerified: false } });
  });

  it.each([false, true, undefined])("preserves boolean/missing registry proposals: %s", proposal => {
    const { lock, envelope } = fixtures();
    Object.assign(envelope.audit.vulnerabilities.dep, { fixAvailable: proposal });
    expect(triageSavedAudit(envelope, lock).entries[0].fixProposal).toEqual(proposal === undefined ? { kind: "not-reported" } : { kind: "registry-boolean", available: proposal });
  });

  it.each(["node_modules/dep/../dep", "/node_modules/dep", "node_modules/dep/", "node_modules\\dep", "node_modules/other", "node_modules/@scope/dep", "file:/dep"])("refuses noncanonical or mismatched node %s", node => {
    const { lock, envelope } = fixtures(); envelope.audit.vulnerabilities.dep.nodes = [node];
    expect(() => triageSavedAudit(envelope, lock)).toThrow("invalid-audit-triage-input");
  });

  it.each([{ version: "file:secret" }, { version: "1.0.0-01" }, { version: "1.0.0", dev: "false" }, { version: "1.0.0", optional: 1 }, { version: "1.0.0", link: true }, { version: "1.0.0", name: "alias" }])("refuses unusable referenced lock entry %j", entry => {
    const { lock, envelope } = fixtures({ "node_modules/dep": entry });
    expect(() => triageSavedAudit(envelope, lock)).toThrow("invalid-audit-triage-input");
  });

  it("rejects changed exact bytes and handles a matched BOM explicitly", () => {
    const { lock, envelope } = fixtures();
    expect(() => triageSavedAudit(envelope, Buffer.concat([lock, Buffer.from("\n")]))).toThrow("invalid-audit-triage-input");
    const bom = Buffer.concat([Buffer.from([239, 187, 191]), lock]);
    expect(() => triageSavedAudit(envelope, bom)).toThrow();
    envelope.lockfileSha256 = createHash("sha256").update(bom).digest("hex");
    expect(triageSavedAudit(envelope, bom).status).toBe("findings");
  });

  it("bounds pure input and rejects damaged UTF-8 even with a matching digest", () => {
    const { lock, envelope } = fixtures();
    envelope.audit.vulnerabilities.dep.via[0].title = "x".repeat(AUDIT_TRIAGE_LIMITS.envelopeBytes);
    expect(() => triageSavedAudit(envelope, lock)).toThrow("invalid-audit-triage-input");
    const damaged = Buffer.concat([lock, Buffer.from([255])]);
    const clean = fixtures().envelope;
    clean.lockfileSha256 = createHash("sha256").update(damaged).digest("hex");
    expect(() => triageSavedAudit(clean, damaged)).toThrow("invalid-audit-triage-input");
  });

  it("handles prototype-like package names using own keys", () => {
    for (const name of ["__proto__", "constructor"]) {
      const { lock, envelope } = fixtures({ [`node_modules/${name}`]: { version: "1.0.0" } });
      envelope.audit.vulnerabilities = JSON.parse(JSON.stringify({ [name]: { ...envelope.audit.vulnerabilities.dep, name, nodes: [`node_modules/${name}`] } }));
      expect(triageSavedAudit(envelope, lock).entries[0].name).toBe(name);
    }
  });

  it("rejects missing and duplicate nodes, error reports, envelope extensions and unsupported lock versions", () => {
    for (const edit of [
      (value: ReturnType<typeof fixtures>) => { value.envelope.audit.vulnerabilities.dep.nodes = []; },
      (value: ReturnType<typeof fixtures>) => { value.envelope.audit.vulnerabilities.dep.nodes.push("node_modules/dep"); },
      (value: ReturnType<typeof fixtures>) => { Object.assign(value.envelope.audit, { error: { message: "secret" } }); },
      (value: ReturnType<typeof fixtures>) => { Object.assign(value.envelope, { unexpected: true }); },
      (value: ReturnType<typeof fixtures>) => { value.lock = Buffer.from('{"lockfileVersion":2,"packages":{"":{}}}'); value.envelope.lockfileSha256 = createHash("sha256").update(value.lock).digest("hex"); },
      (value: ReturnType<typeof fixtures>) => { Object.assign(value.envelope.audit.vulnerabilities.dep, { fixAvailable: { name: "dep", version: "http://secret", isSemVerMajor: false } }); },
    ]) {
      const value = fixtures(); edit(value);
      expect(() => triageSavedAudit(value.envelope, value.lock)).toThrow("invalid-audit-triage-input");
    }
    const value = fixtures({}); expect(() => triageSavedAudit(value.envelope, value.lock)).toThrow();
  });
});

describe("actual offline triage CLI", () => {
  it("prints only projected JSON and uses findings/clean/invalid exit statuses", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "audit-triage-"));
    try {
      const { lock, envelope } = fixtures();
      const input = path.join(directory, "paired.json"), lockPath = path.join(directory, "lock.json");
      await writeFile(input, JSON.stringify(envelope)); await writeFile(lockPath, lock);
      const run = (args: string[]) => spawnSync(process.execPath, ["scripts/triage-npm-audit.mts", ...args], { encoding: "utf8", env: { PATH: process.env.PATH, NODE_ENV: "test" }, timeout: 5000 });
      const findings = run([input, lockPath]); expect(findings.status).toBe(1); expect(findings.stderr).toBe(""); expect(JSON.parse(findings.stdout).status).toBe("findings");
      envelope.audit.vulnerabilities = {} as typeof envelope.audit.vulnerabilities;
      envelope.audit.metadata.vulnerabilities.high = 0; envelope.audit.metadata.vulnerabilities.total = 0;
      await writeFile(input, JSON.stringify(envelope));
      expect(run([input, lockPath]).status).toBe(0);
      const link = path.join(directory, "link.json"); await symlink(lockPath, link); expect(run([input, link]).status).toBe(0);
      for (const args of [[], [input], [input, path.join(directory, "PRIVATE_MARKER")], [input, directory]]) {
        const result = run(args); expect(result.status).toBe(2); expect(result.stdout).toBe(""); expect(result.stderr).not.toContain("PRIVATE_MARKER"); expect(result.stderr).not.toContain(directory);
      }
      await writeFile(input, Buffer.alloc(AUDIT_TRIAGE_LIMITS.envelopeBytes + 1, 32)); expect(run([input, lockPath]).status).toBe(2);
      await writeFile(input, JSON.stringify(envelope));
      await writeFile(lockPath, Buffer.alloc(AUDIT_TRIAGE_LIMITS.lockfileBytes + 1, 32)); expect(run([input, lockPath]).status).toBe(2);
      if (process.platform !== "win32") {
        const fifo = path.join(directory, "fifo"); execFileSync("mkfifo", [fifo]); expect(run([input, fifo]).status).toBe(2);
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
