/** Unconnected, Node-only published alias loading (ADR-0031, AB#263). */
import "server-only";

import { isProxy } from "node:util/types";

import {
  createIdentityAliasResolver,
  validateIdentityAliasPins,
  type IdentityAliasPins,
  type IdentityAliasResolver,
} from "@/lib/identity-aliases";
import { createSanityClient } from "@/lib/sanity-client";
import { loadSanityConfig, type SanityConfig } from "@/lib/sanity-config";

export const IDENTITY_ALIAS_DOCUMENT_TYPE = "identityAliasSet";
export const IDENTITY_ALIAS_QUERY_TAG = "identity.aliases";
export const MAX_IDENTITY_ALIAS_RESPONSE_BYTES = 1024 * 1024;
const QUERY = "*[_id == $documentId][0...2]";
const ROOT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const ROW_KEY = /^[A-Za-z0-9_-]{1,64}$/;

export type SanityIdentityAliasConfiguration =
  | { readonly mode: "legacy" }
  | {
      readonly mode: "renamed" | "restored";
      readonly pins: IdentityAliasPins;
      readonly documentId: string;
      readonly sanityConfig: SanityConfig;
      readonly fetchImplementation?: typeof fetch;
    };
export type SanityIdentityAliasLoader = {
  /** No caller signal: concurrent consumers share a transport-owned timeout. */
  load(): Promise<IdentityAliasResolver>;
};
type Rejection = "configuration" | "transport" | "record-shape" | "record-metadata" | "alias-payload";
export class SanityIdentityAliasError extends Error {
  constructor(readonly rejection: Rejection) {
    super(`[sanity-identity-aliases] Failed ${rejection}`);
    this.name = "SanityIdentityAliasError";
  }
}
function fail(rejection: Rejection): never { throw new SanityIdentityAliasError(rejection); }

/** Shared deployment/loader check; only bounded published root IDs are accepted. */
export function validateIdentityAliasDocumentId(value: unknown): string {
  if (typeof value !== "string" || !ROOT_ID.test(value)) fail("configuration");
  return value;
}

function record(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  rejection: Rejection,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || isProxy(value)) fail(rejection);
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(rejection);
  const allowed = new Set([...required, ...optional]);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || !allowed.has(key)) ||
      required.some((key) => !Object.hasOwn(value, key))) fail(rejection);
  const result: Record<string, unknown> = {};
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) fail(rejection);
    result[key] = descriptor.value;
  }
  return result;
}

function printable(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length <= maximum &&
    value.trim().length > 0 && /^[\x20-\x7e]+$/.test(value);
}
function timestamp(value: unknown): boolean {
  if (typeof value !== "string" || value.length > 64) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, y, m, d, h, minute, second, zone] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] &&
    Number(h) <= 23 && Number(minute) <= 59 && Number(second) <= 59 &&
    (zone === "Z" || (Number(zone.slice(1, 3)) <= 23 && Number(zone.slice(4)) <= 59));
}

function projectPayload(raw: unknown, documentId: string, count: number): unknown {
  if (!Array.isArray(raw) || raw.length !== 1) fail("record-shape");
  const document = record(raw[0],
    ["_id", "_type", "_rev", "_createdAt", "_updatedAt", "aliases", "formatVersion", "sourceMapSha256"],
    ["_originalId"], "record-shape");
  if (document._id !== documentId || document._type !== IDENTITY_ALIAS_DOCUMENT_TYPE ||
      !printable(document._rev, 128) || !timestamp(document._createdAt) || !timestamp(document._updatedAt) ||
      (Object.hasOwn(document, "_originalId") && document._originalId !== documentId)) fail("record-metadata");
  if (!Array.isArray(document.aliases) || document.aliases.length !== count) fail("record-shape");
  const keys = new Set<string>();
  const aliases = document.aliases.map((value) => {
    const row = record(value, ["field", "newId", "oldId"], ["_key", "_type"], "record-shape");
    if (Object.hasOwn(row, "_type") && row._type !== "identityAlias") fail("record-metadata");
    if (Object.hasOwn(row, "_key")) {
      if (typeof row._key !== "string" || !ROW_KEY.test(row._key) || keys.has(row._key)) fail("record-metadata");
      keys.add(row._key);
    }
    return { field: row.field, newId: row.newId, oldId: row.oldId };
  });
  return { aliases, formatVersion: document.formatVersion, sourceMapSha256: document.sourceMapSha256 };
}

function buildLoader(configuration: SanityIdentityAliasConfiguration): SanityIdentityAliasLoader {
  const config = record(configuration, ["mode"], ["pins", "documentId", "sanityConfig", "fetchImplementation"], "configuration");
  const mode = config.mode;
  if (mode === "legacy") {
    const resolver = createIdentityAliasResolver(configuration as { mode: "legacy" });
    const promise = Promise.resolve(resolver);
    return Object.freeze({ load: () => promise });
  }
  if (mode !== "renamed" && mode !== "restored") fail("configuration");
  if (!Object.hasOwn(config, "pins") || !Object.hasOwn(config, "documentId") || !Object.hasOwn(config, "sanityConfig")) fail("configuration");
  const pins = validateIdentityAliasPins(config.pins);
  const documentId = validateIdentityAliasDocumentId(config.documentId);
  const source = record(config.sanityConfig, ["projectId", "dataset", "datasetVisibility", "apiVersion"], ["readToken"], "configuration");
  if (Object.values(source).some((v) => v !== undefined && typeof v !== "string")) fail("configuration");
  const sanityConfig = Object.freeze(loadSanityConfig({
    SANITY_PROJECT_ID: source.projectId as string,
    SANITY_DATASET: source.dataset as string,
    SANITY_DATASET_VISIBILITY: source.datasetVisibility as string,
    SANITY_API_VERSION: source.apiVersion as string,
    SANITY_READ_TOKEN: source.readToken as string | undefined,
  }));
  const fetchImplementation = config.fetchImplementation;
  if (fetchImplementation !== undefined && typeof fetchImplementation !== "function") fail("configuration");
  const client = createSanityClient({
    config: sanityConfig,
    fetchImplementation: fetchImplementation as typeof fetch | undefined,
    maxResponseBytes: MAX_IDENTITY_ALIAS_RESPONSE_BYTES,
    rejectDuplicateJsonKeys: true,
  });
  const read = async (): Promise<IdentityAliasResolver> => {
    let raw: unknown;
    try { raw = await client.query({ query: QUERY, params: { documentId }, tag: IDENTITY_ALIAS_QUERY_TAG }); }
    catch { return fail("transport"); }
    try {
      const payload = projectPayload(raw, documentId, pins.expectedRowCount);
      return createIdentityAliasResolver({ mode, pins, payload });
    } catch (error) {
      if (error instanceof SanityIdentityAliasError) throw error;
      return fail("alias-payload");
    }
  };
  let promise: Promise<IdentityAliasResolver> | undefined;
  return Object.freeze({
    load() {
      if (!promise) {
        promise = read();
        // Handle even a discarded consumer promise, preserving rejection for
        // later callers. Failure stays sticky until the owner recreates a loader.
        void promise.catch(() => {});
      }
      return promise;
    },
  });
}

/** IO is lazy; configuration validation is synchronous. No runtime caller yet. */
export function createSanityIdentityAliasLoader(
  configuration: SanityIdentityAliasConfiguration = { mode: "legacy" },
): SanityIdentityAliasLoader {
  try { return buildLoader(configuration); }
  catch { return fail("configuration"); }
}
