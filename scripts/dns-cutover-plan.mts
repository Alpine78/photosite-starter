/** AB#200: offline comparison only; output contains counts, never DNS values. */
import { createHash } from "node:crypto";
import { isIP } from "node:net";

type RecordValue = { name: string; type: string; value: string; ttl: number; priority?: number };
const invalid = () => { throw new Error("invalid-dns-input"); };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  if (required.some((key) => !Object.hasOwn(value, key)) || Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))) invalid();
}
function absolute(value: unknown): string {
  if (typeof value !== "string") return invalid();
  const result = value.replace(/\.$/, "").toLowerCase();
  if (result.length > 253 || !result || !result.split(".").every((label) => label === "*" || /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/.test(label))) return invalid();
  return result;
}
function owner(value: unknown, zone: string): string {
  if (typeof value !== "string") return invalid();
  const name = value === "@" ? zone : value.endsWith(".") ? absolute(value) : absolute(`${value}.${zone}`);
  if (name !== zone && !name.endsWith(`.${zone}`)) return invalid();
  return name;
}
function snapshot(value: unknown) {
  const input = object(value); exactKeys(input, ["zone", "records"]);
  const zone = absolute(input.zone);
  if (zone.includes("*") || zone.includes("_") || !zone.includes(".")) return invalid();
  if (!Array.isArray(input.records) || input.records.length > 20_000) return invalid();
  const records: RecordValue[] = input.records.map((raw: unknown) => {
    const record = object(raw); exactKeys(record, ["name", "type", "value", "ttl"], ["priority"]);
    if (typeof record.type !== "string" || !/^[A-Z][A-Z0-9]{0,15}$/.test(record.type) || typeof record.value !== "string" || record.value.length > 65_535 || !Number.isInteger(record.ttl) || (record.ttl as number) < 0 || (record.ttl as number) > 2_147_483_647) return invalid();
    if (Object.hasOwn(record, "priority") && (!Number.isInteger(record.priority) || (record.priority as number) < 0 || (record.priority as number) > 65_535)) return invalid();
    const type = record.type;
    if ((type === "A" && isIP(record.value) !== 4) || (type === "AAAA" && isIP(record.value) !== 6)) return invalid();
    return { name: owner(record.name, zone), type, value: type === "CNAME" ? absolute(record.value) : record.value, ttl: record.ttl as number, ...(Object.hasOwn(record, "priority") ? { priority: record.priority as number } : {}) };
  });
  return { zone, records };
}
function cnameConflicts(records: RecordValue[], zone: string): boolean {
  const groups = new Map<string, RecordValue[]>();
  for (const record of records) { const group = groups.get(record.name) ?? []; group.push(record); groups.set(record.name, group); }
  // RFC4035 §2.5 / RFC2181 §10.1: DNSSEC records may coexist with CNAME.
  return [...groups].some(([name, group]) => {
    const aliases = group.filter((record) => record.type === "CNAME");
    return aliases.length > 0 && (name === zone || new Set(aliases.map((record) => record.value)).size > 1 || group.some((record) => !["CNAME", "RRSIG", "NSEC", "KEY"].includes(record.type)));
  });
}
export function compareDnsCutover(beforeValue: unknown, afterValue: unknown, hostsValue: unknown) {
  const before = snapshot(beforeValue), after = snapshot(afterValue);
  if (before.zone !== after.zone || !Array.isArray(hostsValue) || hostsValue.length === 0 || hostsValue.length > 100) return invalid();
  const hosts = hostsValue.map((value: unknown) => owner(value, before.zone));
  if (hosts.some((value) => value.includes("*") || value.includes("_")) || new Set(hosts).size !== hosts.length) return invalid();
  const allowed = new Set(hosts);
  const mutable = (record: RecordValue) => allowed.has(record.name) && ["A", "AAAA", "CNAME"].includes(record.type);
  const keys = (records: RecordValue[], protectedOnly: boolean) => records.filter((record) => !protectedOnly || !mutable(record)).map((record) => JSON.stringify(record)).sort();
  const oldProtected = keys(before.records, true), newProtected = keys(after.records, true);
  const differences = new Map<string, number>();
  for (const key of oldProtected) differences.set(key, (differences.get(key) ?? 0) + 1);
  for (const key of newProtected) differences.set(key, (differences.get(key) ?? 0) - 1);
  const protectedChanges = [...differences.values()].reduce((sum, count) => sum + Math.abs(count), 0);
  const conflict = cnameConflicts(after.records, after.zone);
  const digest = (records: RecordValue[]) => createHash("sha256").update(JSON.stringify(keys(records, false))).digest("hex");
  return { schemaVersion: 1, status: protectedChanges || conflict ? "failed" : "passed", beforeRecords: before.records.length, afterRecords: after.records.length, protectedChanges, cnameConflict: conflict, beforeDigest: digest(before.records), afterDigest: digest(after.records) };
}
