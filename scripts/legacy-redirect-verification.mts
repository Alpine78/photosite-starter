/** Pure mapping/report and HTTP-response decisions for AB#19's owner-run check. */
import { parse, type DefaultTreeAdapterTypes } from "parse5";
import {
  buildLegacyRedirects,
  legacyRedirectDestinationSearch,
  type LegacyRedirectEntry,
  type LegacyRedirectOutcome,
} from "../src/lib/legacy-redirects.ts";

export type MappingRow = {
  readonly source: string;
  readonly crawlStatuses: readonly (number | string)[];
  readonly outcome: LegacyRedirectOutcome | { readonly kind: "pending" | "excluded" | "already-live" };
};

export function buildMappingReport(input: {
  readonly inventory: {
    readonly sourceHost: string;
    readonly crawledAt: string;
    readonly recordCount: number;
    readonly distinctPathCount: number;
    readonly records: readonly { readonly path: string; readonly status: number | string }[];
  };
  readonly entries: readonly LegacyRedirectEntry[];
  readonly pending: readonly string[];
  readonly excluded: readonly string[];
  readonly alreadyLive: readonly string[];
}) {
  const { inventory } = input;
  // Do not trust the request-time fail-open map to establish valid configuration.
  const redirects = buildLegacyRedirects(input.entries);
  const statuses = new Map<string, Set<number | string>>();
  for (const record of inventory.records) {
    const values = statuses.get(record.path) ?? new Set();
    values.add(record.status);
    statuses.set(record.path, values);
  }
  // recordCount belongs to the full Boards attachment. The committed inventory
  // projects its URL records to path/status observations only.
  if (!Number.isSafeInteger(inventory.recordCount) || inventory.recordCount < inventory.records.length ||
      inventory.distinctPathCount !== statuses.size) {
    throw new Error("Inventory counts disagree with its records.");
  }

  const outcomes = new Map<string, MappingRow["outcome"]>();
  function add(source: string, outcome: MappingRow["outcome"]) {
    if (!statuses.has(source)) throw new Error(`Mapping source absent from inventory: ${source}`);
    if (outcomes.has(source)) throw new Error(`Mapping source classified more than once: ${source}`);
    outcomes.set(source, outcome);
  }
  for (const [source, outcome] of redirects) add(source, outcome);
  for (const source of input.pending) add(source, { kind: "pending" });
  for (const source of input.excluded) add(source, { kind: "excluded" });
  for (const source of input.alreadyLive) add(source, { kind: "already-live" });

  const counts = { redirect: 0, gone: 0, pending: 0, excluded: 0, "already-live": 0 };
  const rows: MappingRow[] = [...statuses.keys()].sort().map((source) => {
    const outcome = outcomes.get(source);
    if (!outcome) throw new Error(`Inventory source has no classification: ${source}`);
    counts[outcome.kind]++;
    return { source, crawlStatuses: [...statuses.get(source)!].sort(), outcome };
  });
  return {
    schemaVersion: 1,
    sourceHost: inventory.sourceHost,
    crawledAt: inventory.crawledAt,
    sourceRecordCount: inventory.recordCount,
    inventoryRecordCount: inventory.records.length,
    distinctPathCount: rows.length,
    counts,
    rows,
  };
}

/** No credentials, path, query, or fragment; HTTP only for a local build. */
export function parseVerificationOrigin(value: string): string {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
      url.username || url.password || url.href !== `${url.origin}/`) {
    throw new Error("Expected an HTTPS origin or loopback HTTP origin, without credentials, path, query, or fragment.");
  }
  return url.origin;
}

export function redirectTargetUrl(outcome: Extract<LegacyRedirectOutcome, { kind: "redirect" }>, origin: string): string {
  const url = new URL(outcome.target, origin);
  url.search = legacyRedirectDestinationSearch("", outcome.reservedQueryParams, outcome.fallbackNotice);
  return url.href;
}

export function sourceResponseIssues(row: MappingRow, status: number, location: string | null, origin: string): string[] {
  if (row.outcome.kind === "pending") throw new Error("Pending sources have no approved response to verify.");
  const expectedStatus = row.outcome.kind === "redirect" ? 301 : row.outcome.kind === "gone" ? 410 : row.outcome.kind === "excluded" ? 404 : 200;
  const issues: string[] = [];
  if (status !== expectedStatus) issues.push(`expected-status-${expectedStatus}`);
  if (row.outcome.kind === "redirect") {
    try {
      if (!location || new URL(location, origin).href !== redirectTargetUrl(row.outcome, origin)) {
        issues.push("unexpected-location");
      }
    } catch { issues.push("unexpected-location"); }
  }
  return issues;
}

function elements(node: DefaultTreeAdapterTypes.Node): DefaultTreeAdapterTypes.Element[] {
  return [
    ...("tagName" in node ? [node] : []),
    ...("childNodes" in node ? node.childNodes.flatMap(elements) : []),
  ];
}

export function targetResponseIssues(
  outcome: Extract<LegacyRedirectOutcome, { kind: "redirect" }>,
  response: { readonly status: number; readonly contentType: string | null; readonly html: string },
  canonicalOrigin: string,
): string[] {
  if (response.status !== 200) return ["target-not-200"];
  if (!/^text\/html(?:\s*;|$)/i.test(response.contentType ?? "")) return ["target-not-html"];
  const nodes = elements(parse(response.html));
  const attr = (node: DefaultTreeAdapterTypes.Element, name: string) => node.attrs.find((attribute) => attribute.name === name)?.value;
  const canonicals = nodes.filter((node) => node.tagName === "link" && attr(node, "rel")?.toLowerCase().split(/\s+/).includes("canonical"));
  const issues: string[] = [];
  let canonicalMatches = false;
  if (canonicals.length === 1) {
    try {
      // A root canonical may omit its slash; URL parsing treats the two root
      // spellings identically while preserving non-root slashes/query/hash.
      canonicalMatches = new URL(attr(canonicals[0], "href") ?? "").href === new URL(outcome.target, canonicalOrigin).href;
    } catch { /* Missing, relative or malformed canonical is a mismatch. */ }
  }
  if (!canonicalMatches) {
    issues.push("target-canonical-mismatch");
  }
  if (outcome.fallbackNotice !== undefined) {
    const noindex = nodes.some((node) => node.tagName === "meta" && attr(node, "name")?.toLowerCase() === "robots" && attr(node, "content")?.toLowerCase().split(/[\s,]+/).includes("noindex"));
    if (!noindex) issues.push("fallback-missing-noindex");
    if (!nodes.some((node) => attr(node, "role") === "status" && "childNodes" in node && node.childNodes.length > 0)) {
      issues.push("fallback-missing-status");
    }
    if (nodes.some((node) => node.tagName === "link" && attr(node, "hreflang") !== undefined)) {
      issues.push("fallback-has-language-alternates");
    }
  }
  return issues;
}

export function verificationStatus(pendingCount: number, results: readonly { readonly issues: readonly string[] }[]): "failed" | "incomplete" | "passed" {
  if (results.some((result) => result.issues.length > 0)) return "failed";
  return pendingCount > 0 ? "incomplete" : "passed";
}
