/** AB#329: offline, operator-paired dependency evidence; no runtime verdict. */
import { createHash } from "node:crypto";
import { summarizeNpmAudit } from "./npm-audit-summary.mts";

export const AUDIT_TRIAGE_LIMITS = { envelopeBytes: 4 * 1024 * 1024, lockfileBytes: 8 * 1024 * 1024, nodes: 25_000, outputBytes: 16 * 1024 * 1024 } as const;
const invalid = (): never => { throw new Error("invalid-audit-triage-input"); };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function packageName(value: unknown): string {
  if (typeof value !== "string" || value.length > 214 || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9_][a-z0-9._-]*$/.test(value)) return invalid();
  return value;
}
function version(value: unknown): string {
  if (typeof value !== "string" || value.length > 128 || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value)) return invalid();
  const prerelease = value.split("+")[0].split("-").slice(1).join("-");
  if (prerelease.split(".").some(part => /^0\d+$/.test(part))) return invalid();
  return value;
}
function nodePath(value: unknown, expectedName: string): string {
  if (typeof value !== "string" || value.length > 4096) return invalid();
  const parts = value.split("/"); let last = "", depth = 0;
  for (let index = 0; index < parts.length;) {
    if (++depth > 32 || parts[index++] !== "node_modules" || index >= parts.length) return invalid();
    const first = parts[index++];
    last = first.startsWith("@") ? `${first}/${parts[index++] ?? ""}` : first;
    packageName(last);
  }
  if (last !== expectedName) return invalid();
  return value;
}
function fixProposal(value: unknown) {
  if (value === undefined) return { kind: "not-reported" } as const;
  if (typeof value === "boolean") return { kind: "registry-boolean", available: value } as const;
  const proposal = object(value);
  if (Object.keys(proposal).sort().join(",") !== "isSemVerMajor,name,version" || typeof proposal.isSemVerMajor !== "boolean") return invalid();
  return { kind: "registry-suggestion", name: packageName(proposal.name), version: version(proposal.version), isSemVerMajor: proposal.isSemVerMajor } as const;
}

export function triageSavedAudit(envelopeValue: unknown, lockfileBytes: Uint8Array) {
  try { return triage(envelopeValue, lockfileBytes); } catch { return invalid(); }
}
function triage(envelopeValue: unknown, lockfileBytes: Uint8Array) {
  const envelope = object(envelopeValue);
  if (Buffer.byteLength(JSON.stringify(envelope)) > AUDIT_TRIAGE_LIMITS.envelopeBytes) return invalid();
  if (Object.keys(envelope).sort().join(",") !== "audit,lockfileSha256,schemaVersion" || envelope.schemaVersion !== 1 ||
      typeof envelope.lockfileSha256 !== "string" || !/^[a-f0-9]{64}$/.test(envelope.lockfileSha256) ||
      lockfileBytes.byteLength > AUDIT_TRIAGE_LIMITS.lockfileBytes ||
      createHash("sha256").update(lockfileBytes).digest("hex") !== envelope.lockfileSha256) return invalid();
  const lock = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(lockfileBytes)));
  if (lock.lockfileVersion !== 3) return invalid();
  const packages = object(lock.packages);
  if (Object.keys(packages).length > 50_000 || !Object.hasOwn(packages, "")) return invalid();
  object(packages[""]);
  const audit = object(envelope.audit), vulnerabilities = object(audit.vulnerabilities);
  const auditEntries = Object.values(vulnerabilities);
  if (auditEntries.length > 20_000) return invalid();
  let edges = 0;
  for (const raw of auditEntries) {
    const via = object(raw).via;
    if (!Array.isArray(via) || via.length > 20_000 || (edges += via.length) > 200_000) return invalid();
  }
  const summary = summarizeNpmAudit(audit);
  let nodeCount = 0, outputBytes = 1024 + Buffer.byteLength(JSON.stringify(summary));
  const entries = Object.keys(vulnerabilities).sort().map(key => {
    const name = packageName(key), entry = object(vulnerabilities[key]);
    if (!Array.isArray(entry.nodes) || !entry.nodes.length || entry.nodes.length > AUDIT_TRIAGE_LIMITS.nodes ||
        new Set(entry.nodes).size !== entry.nodes.length) return invalid();
    const nodes = entry.nodes.map(raw => {
      if (++nodeCount > AUDIT_TRIAGE_LIMITS.nodes) return invalid();
      const path = nodePath(raw, name);
      if (!Object.hasOwn(packages, path)) return invalid();
      const locked = object(packages[path]);
      if ((Object.hasOwn(locked, "link") && locked.link !== false) || (Object.hasOwn(locked, "name") && locked.name !== name)) return invalid();
      const flags = { dev: false, optional: false, devOptional: false };
      for (const flag of Object.keys(flags) as (keyof typeof flags)[]) {
        if (Object.hasOwn(locked, flag)) {
          if (typeof locked[flag] !== "boolean") return invalid();
          flags[flag] = locked[flag];
        }
      }
      const node = { path, version: version(locked.version), declaredInstallFlags: flags };
      // Charge projected nodes before retaining them, independent of input size.
      outputBytes += Buffer.byteLength(JSON.stringify(node)) + 1;
      if (outputBytes > AUDIT_TRIAGE_LIMITS.outputBytes) return invalid();
      return node;
    }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const via = entry.via as unknown[]; // summarizeNpmAudit validated the graph.
    const details = { name, severity: entry.severity as string, isDirect: entry.isDirect as boolean,
      directAdvisoryIds: [...new Set(via.filter(value => typeof value !== "string").map(value => object(value).source as number))].sort((a, b) => a - b),
      // AB#380: each direct advisory's GHSA identity, or null when npm did not
      // name a GitHub advisory URL. Validated, never a raw provider string.
      directAdvisories: [...new Map(via.filter(value => typeof value !== "string").map(value => {
        const advisory = object(value), source = advisory.source as number;
        const match = typeof advisory.url === "string" &&
          /^https:\/\/github\.com\/advisories\/(GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4})$/.exec(advisory.url);
        return [source, { source, ghsa: match ? match[1] : null }] as const;
      })).values()].sort((a, b) => a.source - b.source),
      inheritedVia: [...new Set(via.filter((value): value is string => typeof value === "string").map(packageName))].sort(),
      fixProposal: fixProposal(entry.fixAvailable) };
    outputBytes += Buffer.byteLength(JSON.stringify(details)) + 16;
    if (outputBytes > AUDIT_TRIAGE_LIMITS.outputBytes) return invalid();
    return { ...details, nodes };
  });
  return { schemaVersion: 1, status: summary.status, lockfileSha256: envelope.lockfileSha256, summary, entries,
    evidence: { pairing: "operator-supplied", captureProvenanceVerified: false, reportFreshnessVerified: false,
      bundleInclusionVerified: false, exploitabilityVerified: false, fixProposalsVerified: false } };
}
