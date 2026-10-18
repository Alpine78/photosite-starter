/**
 * Node-only, in-memory identity compatibility (ADR-0031, AB#261).
 *
 * Accepts an already decoded ID-only payload, not a raw CMS document or JSON
 * transport. The bounded adapter validates those boundaries separately.
 * Construct once per pinned generation; the curated enquiry facade owns its instance.
 * Resolution grants no authorization and must never receive media IDs or cursors.
 */
import "server-only";

import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";

import { isPublicIdentity } from "@/lib/public-identity";

export const IDENTITY_ALIAS_FORMAT_VERSION = "identity-aliases-v1";
export const MAX_IDENTITY_ALIAS_PAYLOAD_BYTES = 256 * 1024;

const FIELDS = ["contentId", "categoryId", "endGalleryId", "placementId"] as const;
export type IdentityAliasField = (typeof FIELDS)[number];
export type IdentityAliasMode = "legacy" | "renamed" | "restored";

export type IdentityAliasPins = {
  readonly sourceMapSha256: string;
  readonly payloadSha256: string;
  readonly expectedRowCount: number;
};
export type IdentityAliasConfiguration =
  | { readonly mode: "legacy" }
  | {
      readonly mode: "renamed" | "restored";
      readonly pins: IdentityAliasPins;
      readonly payload: unknown;
    };

export type IdentityAliasResolver = (
  field: IdentityAliasField,
  identity: string,
) => string;

type Rejection = "configuration" | "payload" | "payload-too-large" | "input";
export class IdentityAliasError extends Error {
  constructor(readonly rejection: Rejection) {
    super(`[identity-aliases] Invalid ${rejection}`);
    this.name = "IdentityAliasError";
  }
}

function fail(rejection: Rejection): never {
  throw new IdentityAliasError(rejection);
}

function dataProperty(value: object, key: string, rejection: Rejection): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) fail(rejection);
  return descriptor.value;
}

function plainRecord(value: unknown, rejection: Rejection): object {
  if (!value || typeof value !== "object" || isProxy(value)) fail(rejection);
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(rejection);
  return value;
}

function closedRecord(
  value: unknown,
  keys: readonly string[],
  rejection: Rejection,
): Record<string, unknown> {
  const record = plainRecord(value, rejection);
  if (Reflect.ownKeys(record).length !== keys.length) fail(rejection);
  // Read descriptors, never authored accessors or toJSON. Copy only known data.
  return Object.fromEntries(
    keys.map((key) => [key, dataProperty(record, key, rejection)]),
  );
}

function field(value: unknown, rejection: Rejection): IdentityAliasField {
  if (typeof value !== "string" || !FIELDS.includes(value as IdentityAliasField)) {
    fail(rejection);
  }
  return value as IdentityAliasField;
}

function identity(value: unknown, rejection: Rejection): string {
  if (typeof value !== "string" || !isPublicIdentity(value)) fail(rejection);
  return value;
}

function sha256(value: unknown, rejection: Rejection): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail(rejection);
  return value;
}

/** Validated scalar copy for a loader to reject bad pins before performing IO. */
export function validateIdentityAliasPins(value: unknown): IdentityAliasPins {
  const pins = closedRecord(
    value,
    ["sourceMapSha256", "payloadSha256", "expectedRowCount"],
    "configuration",
  );
  const sourceMapSha256 = sha256(pins.sourceMapSha256, "configuration");
  const payloadSha256 = sha256(pins.payloadSha256, "configuration");
  const count = pins.expectedRowCount;
  // A shortest valid row takes 45 bytes; reject impossible counts before IO.
  const minimumRowBytes = '{"field":"contentId","newId":"b","oldId":"a"}'.length;
  if (
    typeof count !== "number" || !Number.isSafeInteger(count) || count < 1 ||
    count > Math.floor(MAX_IDENTITY_ALIAS_PAYLOAD_BYTES / minimumRowBytes)
  ) fail("configuration");
  return Object.freeze({ sourceMapSha256, payloadSha256, expectedRowCount: count });
}

function buildResolver(
  configuration: IdentityAliasConfiguration,
): IdentityAliasResolver {
  const configRecord = plainRecord(configuration, "configuration");
  const mode = dataProperty(configRecord, "mode", "configuration");
  if (mode !== "legacy" && mode !== "renamed" && mode !== "restored") {
    fail("configuration");
  }
  if (mode === "legacy") {
    closedRecord(configRecord, ["mode"], "configuration");
    return (rawField, rawIdentity) => {
      field(rawField, "input");
      return identity(rawIdentity, "input");
    };
  }

  const config = closedRecord(configRecord, ["mode", "pins", "payload"], "configuration");
  const pins = validateIdentityAliasPins(config.pins);
  const { sourceMapSha256, payloadSha256, expectedRowCount: count } = pins;

  const payload = closedRecord(
    config.payload,
    ["aliases", "formatVersion", "sourceMapSha256"],
    "payload",
  );
  if (
    payload.formatVersion !== IDENTITY_ALIAS_FORMAT_VERSION ||
    sha256(payload.sourceMapSha256, "payload") !== sourceMapSha256
  ) fail("payload");
  const aliases = payload.aliases;
  if (
    isProxy(aliases) || !Array.isArray(aliases) || aliases.length !== count ||
    Object.getPrototypeOf(aliases) !== Array.prototype ||
    Reflect.ownKeys(aliases).length !== count + 1
  ) fail("payload");

  const prefix = '{"aliases":[';
  const suffix = `],"formatVersion":"${IDENTITY_ALIAS_FORMAT_VERSION}","sourceMapSha256":"${sourceMapSha256}"}`;
  let bytes = Buffer.byteLength(prefix + suffix, "utf8");
  const rows: string[] = [];
  const oldIds = new Set<string>();
  const newIds = new Set<string>();
  const lookups = new Map<IdentityAliasField, Map<string, string>>();
  for (let index = 0; index < count; index++) {
    const row = closedRecord(
      dataProperty(aliases, String(index), "payload"),
      ["field", "newId", "oldId"],
      "payload",
    );
    const family = field(row.field, "payload");
    const oldId = identity(row.oldId, "payload");
    const newId = identity(row.newId, "payload");
    if (oldIds.has(oldId) || newIds.has(newId)) fail("payload");
    oldIds.add(oldId);
    newIds.add(newId);

    // Rebuilt primitives only; canonical key order, preserved row order, no
    // whitespace/newline. Do not serialize any caller-owned object.
    const encoded = JSON.stringify({ field: family, newId, oldId });
    bytes += Buffer.byteLength(encoded, "utf8") + (index === 0 ? 0 : 1);
    if (bytes > MAX_IDENTITY_ALIAS_PAYLOAD_BYTES) fail("payload-too-large");
    rows.push(encoded);
    const lookup = lookups.get(family) ?? new Map<string, string>();
    lookup.set(
      mode === "renamed" ? oldId : newId,
      mode === "renamed" ? newId : oldId,
    );
    lookups.set(family, lookup);
  }
  // Disjoint sets exclude self mappings, cross-family chains and cycles.
  for (const oldId of oldIds) if (newIds.has(oldId)) fail("payload");
  const digest = createHash("sha256")
    .update(prefix + rows.join(",") + suffix, "utf8")
    .digest("hex");
  if (digest !== payloadSha256) fail("payload");

  return (rawField, rawIdentity) => {
    const family = field(rawField, "input");
    const id = identity(rawIdentity, "input");
    return lookups.get(family)?.get(id) ?? id;
  };
}

/** Omitted configuration selects legacy; explicit legacy rejects pins/payload. */
export function createIdentityAliasResolver(
  configuration: IdentityAliasConfiguration = { mode: "legacy" },
): IdentityAliasResolver {
  try {
    return buildResolver(configuration);
  } catch (error) {
    if (error instanceof IdentityAliasError) throw error;
    // No arbitrary exception message, cause or provider/caller payload escapes.
    throw new IdentityAliasError("payload");
  }
}
