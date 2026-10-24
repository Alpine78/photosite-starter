/** A bounded, transient reference inventory; never retain exported content fields. */
import "server-only";
import { parseSanityJsonWithoutDuplicates } from "./sanity-json";

export type CleanupSnapshotErrorCode = "snapshot_invalid" | "snapshot_limit_exceeded";
export class CleanupSnapshotError extends Error {
  constructor(readonly code: CleanupSnapshotErrorCode) {
    super(code);
    this.name = "CleanupSnapshotError";
  }
}
export type CleanupSnapshotLimits = {
  readonly maxSnapshotBytes: number;
  readonly maxLineBytes: number;
  readonly maxDocuments: number;
  readonly maxReferences: number;
};
export type CleanupSnapshotDocument = {
  readonly id: string;
  readonly revision: string;
  readonly type: string;
  readonly references: readonly { readonly target: string; readonly weak: boolean }[];
};
export type CleanupSnapshot = {
  readonly documents: ReadonlyMap<string, CleanupSnapshotDocument>;
  readonly controlIds: readonly string[];
  readonly bytes: number;
  readonly documentCount: number;
  readonly maxLineBytes: number;
  readonly providerTime: number;
  readonly referrers: (target: string) => readonly CleanupSnapshotDocument[];
};

export function cleanupDocumentId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/u.exec(value)?.[0] === value;
}
export function cleanupRevision(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/u.exec(value)?.[0] === value;
}
export function cleanupDocumentType(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u.exec(value)?.[0] === value;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function invalid(): never { throw new CleanupSnapshotError("snapshot_invalid"); }
function limit(): never { throw new CleanupSnapshotError("snapshot_limit_exceeded"); }

/** Feed chunks only from one ordinary, non-cursor Export API response. */
export class CleanupSnapshotBuilder {
  private readonly line: Uint8Array;
  private lineLength = 0;
  private bytes = 0;
  private largestLine = 0;
  private referenceCount = 0;
  private finished = false;
  private readonly documents = new Map<string, CleanupSnapshotDocument>();
  private readonly activeControlIds = new Set<string>();
  private readonly incoming = new Map<string, CleanupSnapshotDocument[]>();
  constructor(private readonly limits: CleanupSnapshotLimits) {
    if (Object.values(limits).some((n) => !Number.isSafeInteger(n) || n < 1) || limits.maxLineBytes > 1024 * 1024) limit();
    this.line = new Uint8Array(limits.maxLineBytes);
  }
  append(chunk: Uint8Array): void {
    if (this.finished || !(chunk instanceof Uint8Array)) invalid();
    if (chunk.byteLength > this.limits.maxSnapshotBytes - this.bytes) limit();
    this.bytes += chunk.byteLength;
    let start = 0;
    for (let i = 0; i <= chunk.length; i++) {
      if (i !== chunk.length && chunk[i] !== 10) continue;
      const part = chunk.subarray(start, i);
      if (part.length > this.line.length - this.lineLength) limit();
      this.line.set(part, this.lineLength);
      this.lineLength += part.length;
      if (i !== chunk.length) this.consumeLine();
      start = i + 1;
    }
  }
  private consumeLine(): void {
    this.largestLine = Math.max(this.largestLine, this.lineLength);
    if (!this.lineLength) invalid();
    let value: unknown;
    try {
      // A BOM is not JSON; do not let TextDecoder strip one on every line.
      if (this.line[0] === 0xef && this.line[1] === 0xbb && this.line[2] === 0xbf) invalid();
      value = parseSanityJsonWithoutDuplicates(new TextDecoder("utf-8", { fatal: true }).decode(this.line.subarray(0, this.lineLength)));
    } catch { invalid(); }
    this.lineLength = 0;
    if (!record(value) || "error" in value || "nextCursor" in value ||
      !cleanupDocumentId(value._id) || !cleanupRevision(value._rev) ||
      !cleanupDocumentType(value._type)) invalid();
    if (this.documents.has(value._id)) invalid();
    if (this.documents.size >= this.limits.maxDocuments) limit();
    const references: { target: string; weak: boolean }[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) { for (const child of node) walk(child); return; }
      if (!record(node)) return;
      if ("_ref" in node || node._type === "reference") {
        if (!cleanupDocumentId(node._ref) || ("_weak" in node && typeof node._weak !== "boolean")) invalid();
        if (++this.referenceCount > this.limits.maxReferences) limit();
        references.push({ target: node._ref, weak: node._weak === true });
      }
      for (const child of Object.values(node)) walk(child);
    };
    walk(value);
    const document: CleanupSnapshotDocument = Object.freeze({
      id: value._id, revision: value._rev, type: value._type,
      references: Object.freeze(references.map((reference) => Object.freeze(reference))),
    });
    this.documents.set(document.id, document);
    if ((document.type === "clientGalleryCleanup" || document.id.startsWith("clientGalleryCleanup.")) && value.state !== "complete" && value.state !== "disabled") {
      this.activeControlIds.add(document.id);
    }
    for (const target of new Set(references.map((reference) => reference.target))) {
      const existing = this.incoming.get(target) ?? [];
      existing.push(document);
      this.incoming.set(target, existing);
    }
  }
  finish(providerTime: number): CleanupSnapshot {
    if (this.finished || !Number.isFinite(providerTime)) invalid();
    this.finished = true;
    if (this.lineLength) this.consumeLine();
    for (const values of this.incoming.values()) Object.freeze(values);
    const documents = this.documents;
    const incoming = this.incoming;
    return Object.freeze({
      documents,
      // Terminal controls still participate in reference evidence, but cannot consume the daily work budget.
      controlIds: Object.freeze([...this.activeControlIds].sort()),
      bytes: this.bytes, documentCount: documents.size, maxLineBytes: this.largestLine, providerTime,
      referrers: (target: string) => incoming.get(target) ?? [],
    });
  }
}
