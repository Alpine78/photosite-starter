/** Operator-only read evidence. Never authorizes or performs a mutation. */
import "server-only";
import { createHash } from "node:crypto";
import {
  cleanupTransportLimits, createClientGalleryCleanupTransport, CleanupTransportError,
  type CleanupTransport, type CleanupTransportLimits,
} from "./client-gallery-cleanup-transport";
import { cleanupDocumentId, cleanupDocumentType } from "./client-gallery-cleanup-snapshot";
import { CLEANUP_CONTROL_PREFIX, CLEANUP_CONTROL_TYPE } from "./client-gallery-cleanup-contract";
import { loadSanityConfig } from "./sanity-config";
import { parseSanityJsonWithoutDuplicates } from "./sanity-json";

export const CLEANUP_READINESS_MANIFEST_BYTES = 32 * 1024;
const kinds = ["published", "private", "draft", "release"] as const;
type Kind = typeof kinds[number];
type Target = { readonly projectId: string; readonly dataset: string; readonly apiVersion: string };
type Canary = { readonly id: string; readonly type: string };
type ReadinessErrorCode = "configuration_invalid" | "manifest_invalid" | "manifest_unreadable" |
  "request_refused" | "canary_changed" | "missing_not_absent" | "clock_invalid" | "verification_failed" |
  `canary_${Kind}_not_observed` | CleanupTransportError["code"];
export class CleanupReadinessError extends Error {
  constructor(readonly code: ReadinessErrorCode) { super(code); this.name = "CleanupReadinessError"; }
}
function fail(code: ReadinessErrorCode): never { throw new CleanupReadinessError(code); }
/** Do not retain provider exceptions, causes, paths or authored values in diagnostics. */
export function cleanupReadinessError(error: unknown): CleanupReadinessError {
  if (error instanceof CleanupReadinessError) return error;
  return new CleanupReadinessError(error instanceof CleanupTransportError ? error.code : "verification_failed");
}
function closed(value: unknown, required: readonly string[], optional: readonly string[] = []): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    required.some(key => !Object.hasOwn(value, key)) ||
    Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail("manifest_invalid");
}
const digest = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");

export type CleanupReadinessSettings = { readonly filename: string; readonly token: string };
/** Validate opt-in and credential before even opening the manifest. No ambient target. */
export function cleanupReadinessSettings(env: Record<string, string | undefined>): CleanupReadinessSettings {
  const filename = env.CLIENT_GALLERY_CLEANUP_READINESS_MANIFEST;
  const token = env.SANITY_CLIENT_GALLERY_CLEANUP_TOKEN;
  if (env.CLIENT_GALLERY_CLEANUP_READINESS !== "enabled" || !filename?.startsWith("/") ||
    filename.includes("\0") || !token || /\s/u.test(token) ||
    env.NEXT_PUBLIC_SANITY_CLIENT_GALLERY_CLEANUP_TOKEN?.trim()) fail("configuration_invalid");
  return { filename, token };
}
export type CleanupReadinessConfig = {
  readonly target: Target;
  readonly token: string;
  readonly canaries: Readonly<Record<Kind, Canary>>;
  readonly missingDocumentId: string;
  readonly limits: CleanupTransportLimits;
  readonly manifestFingerprint: string;
  readonly targetFingerprint: string;
};
export function parseCleanupReadinessManifest(bytes: Uint8Array, token: string, now = new Date()): CleanupReadinessConfig {
  try {
    if (!bytes.length || bytes.length > CLEANUP_READINESS_MANIFEST_BYTES ||
      bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf || !token || /\s/u.test(token)) fail("manifest_invalid");
    const input: unknown = parseSanityJsonWithoutDuplicates(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    closed(input, ["version", "target", "canaries", "missingDocumentId"], ["limits"]);
    if (input.version !== 1) fail("manifest_invalid");
    closed(input.target, ["projectId", "dataset", "apiVersion"]);
    if (Object.values(input.target).some(v => typeof v !== "string" || !v || v.trim() !== v)) fail("manifest_invalid");
    // Pass a constructed environment: site settings/read tokens cannot fill or override a target.
    const validated = loadSanityConfig({
      SANITY_PROJECT_ID: input.target.projectId as string,
      SANITY_DATASET: input.target.dataset as string,
      SANITY_API_VERSION: input.target.apiVersion as string,
      SANITY_DATASET_VISIBILITY: "public",
    }, { now });
    const target = { projectId: validated.projectId, dataset: validated.dataset, apiVersion: validated.apiVersion };
    if (target.apiVersion < "v2025-02-19" || Object.values(target).some(v => /\s/u.test(v))) fail("manifest_invalid");
    closed(input.canaries, kinds);
    const canaries = {} as Record<Kind, Canary>;
    for (const kind of kinds) {
      const canary = input.canaries[kind];
      closed(canary, ["id", "type"]);
      if (!cleanupDocumentId(canary.id) || !cleanupDocumentType(canary.type) ||
        canary.id.startsWith(CLEANUP_CONTROL_PREFIX) || canary.type === CLEANUP_CONTROL_TYPE) fail("manifest_invalid");
      canaries[kind] = { id: canary.id, type: canary.type };
    }
    const { published, private: privateCanary, draft, release } = canaries;
    if (published.id.includes(".") || !privateCanary.id.includes(".") ||
      privateCanary.id.startsWith("drafts.") || privateCanary.id.startsWith("versions.") ||
      draft.id !== `drafts.${published.id}` ||
      !release.id.startsWith("versions.") || release.id.slice(9).indexOf(".") < 1 ||
      release.id.slice(release.id.indexOf(".", 9) + 1) !== published.id ||
      draft.type !== published.type || release.type !== published.type ||
      !cleanupDocumentId(input.missingDocumentId) || input.missingDocumentId.includes(".") ||
      new Set([...kinds.map(k => canaries[k].id), input.missingDocumentId]).size !== 5) fail("manifest_invalid");
    if (input.limits !== undefined) closed(input.limits, [], ["maxSnapshotBytes", "maxDocuments", "exportTimeoutMs"]);
    const limits = cleanupTransportLimits(input.limits as Partial<CleanupTransportLimits> | undefined);
    return { target, token, canaries, missingDocumentId: input.missingDocumentId, limits,
      manifestFingerprint: digest(bytes), targetFingerprint: digest(JSON.stringify(target)) };
  } catch { return fail("manifest_invalid"); }
}

/** Only the two exact reads used by this probe can reach fetch. Never query/mutate. */
export function cleanupReadinessFetch(config: CleanupReadinessConfig, fetcher: typeof fetch): typeof fetch {
  const base = `https://${config.target.projectId}.api.sanity.io/${config.target.apiVersion}/data`;
  const ids = [config.canaries.published.id, config.canaries.private.id, config.missingDocumentId];
  const allowed = new Set([
    `${base}/export/${config.target.dataset}`,
    `${base}/doc/${config.target.dataset}/${ids.map(encodeURIComponent).join(",")}?includeAllVersions=true`,
  ]);
  return (input, init) => {
    if (!(typeof input === "string" || input instanceof URL) || !allowed.has(String(input)) ||
      init?.method !== "GET" || init.body != null || init.redirect !== "error" || init.cache !== "no-store") fail("request_refused");
    return fetcher(input, init);
  };
}
type ReadOnlyTransport = Pick<CleanupTransport, "snapshot" | "read">;
export function createCleanupReadinessReader(config: CleanupReadinessConfig, dependencies: {
  readonly fetch?: typeof fetch; readonly now?: () => number; readonly monotonicNow?: () => number;
} = {}): ReadOnlyTransport {
  const transport = createClientGalleryCleanupTransport({ ...config.target, token: config.token }, {
    ...dependencies, limits: config.limits, fetch: cleanupReadinessFetch(config, dependencies.fetch ?? fetch),
  });
  return Object.freeze({ snapshot: transport.snapshot, read: transport.read });
}
function baseId(id: string): string {
  if (id.startsWith("drafts.")) return id.slice(7);
  if (id.startsWith("versions.")) return id.slice(id.indexOf(".", 9) + 1);
  return id;
}

export async function verifyCleanupReadiness(config: CleanupReadinessConfig, reader: ReadOnlyTransport, options: {
  readonly signal?: AbortSignal; readonly now?: () => number; readonly monotonicNow?: () => number;
} = {}) {
  try {
    const monotonic = options.monotonicNow ?? (() => performance.now());
    const started = monotonic();
    const snapshot = await reader.snapshot(options.signal);
    const elapsedMs = monotonic() - started;
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) fail("clock_invalid");
    for (const kind of kinds) {
      const expected = config.canaries[kind];
      if (snapshot.documents.get(expected.id)?.type !== expected.type) fail(`canary_${kind}_not_observed`);
    }
    if (snapshot.documents.has(config.missingDocumentId)) fail("missing_not_absent");
    const bases = new Set([config.canaries.published.id, config.canaries.private.id]);
    const expected = new Map([...snapshot.documents].filter(([id]) => bases.has(baseId(id))));
    const fresh = await reader.read([...bases, config.missingDocumentId], { includeAllVersions: true, signal: options.signal });
    if (fresh.omitted.size !== 1 || !fresh.omitted.has(config.missingDocumentId)) fail("missing_not_absent");
    if (fresh.documents.size !== expected.size) fail("canary_changed");
    for (const [id, doc] of fresh.documents) {
      const prior = expected.get(id);
      if (!prior || doc._rev !== prior.revision || doc._type !== prior.type) fail("canary_changed");
    }
    const checkedAt = new Date((options.now ?? Date.now)()).toISOString();
    return {
      version: 1, status: "read-checks-passed", readOnly: true,
      readyToDelete: false, readyToActivate: false, fullReadGrantProven: false, writeGrantsVerified: false,
      manifestFingerprint: config.manifestFingerprint, targetFingerprint: config.targetFingerprint, checkedAt,
      knownCanaries: kinds.length, knownVersionDocuments: expected.size, existenceOmissions: 1,
      export: { bytes: snapshot.bytes, documents: snapshot.documentCount, maxLineBytes: snapshot.maxLineBytes,
        references: [...snapshot.documents.values()].reduce((sum, doc) => sum + doc.references.length, 0), elapsedMs },
      limits: config.limits,
      remainingChecks: ["token_role_identity", "global_read_grant", "restricted_write_grants", "atomic_deletion_and_races",
        "controlled_writers", "function_allowance", "privacy_and_hosted_studio"],
    } as const;
  } catch (error) { throw cleanupReadinessError(error); }
}
