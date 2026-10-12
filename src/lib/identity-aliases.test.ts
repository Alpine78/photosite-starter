import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  createIdentityAliasResolver,
  IDENTITY_ALIAS_FORMAT_VERSION,
  IdentityAliasError,
  MAX_IDENTITY_ALIAS_PAYLOAD_BYTES,
  validateIdentityAliasPins,
  type IdentityAliasConfiguration,
  type IdentityAliasField,
} from "@/lib/identity-aliases";
import { MAX_PUBLIC_IDENTITY_LENGTH } from "@/lib/public-identity";

type Row = { field: IdentityAliasField; oldId: string; newId: string };
type Payload = { aliases: Row[]; formatVersion: string; sourceMapSha256: string };
const SOURCE_SHA = "a".repeat(64);
const ROWS: Row[] = [
  { field: "contentId", oldId: "old-story", newId: "story" },
  { field: "categoryId", oldId: "old-group", newId: "group" },
  { field: "endGalleryId", oldId: "old-story-gallery", newId: "story-gallery" },
  { field: "placementId", oldId: "old-story-image-1", newId: "story-image-1" },
];

function fixture(aliases = ROWS): Payload {
  return {
    aliases: structuredClone(aliases),
    formatVersion: IDENTITY_ALIAS_FORMAT_VERSION,
    sourceMapSha256: SOURCE_SHA,
  };
}

// Test fixtures are trusted JSON. Independent lexical-key canonicalization;
// a fixed vector below pins the wire bytes without using production helpers.
function canonical(value: unknown): string {
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort)
    : v !== null && typeof v === "object"
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, sort(v)]))
      : v;
  return JSON.stringify(sort(value));
}

function configured(payload = fixture(), mode: "renamed" | "restored" = "renamed") {
  return {
    mode,
    pins: {
      sourceMapSha256: SOURCE_SHA,
      payloadSha256: createHash("sha256").update(canonical(payload)).digest("hex"),
      expectedRowCount: payload.aliases.length,
    },
    payload,
  };
}

function rejected(run: () => unknown, rejection: IdentityAliasError["rejection"]) {
  let caught: unknown;
  try { run(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(IdentityAliasError);
  expect(caught).toMatchObject({ rejection, message: `[identity-aliases] Invalid ${rejection}` });
  expect(Object.hasOwn(caught as object, "cause")).toBe(false);
}

function createUnknown(config: unknown) {
  return createIdentityAliasResolver(config as IdentityAliasConfiguration);
}

describe("pinned identity aliases", () => {
  it("validates a frozen scalar pin copy for pre-IO checks", () => {
    const original = configured().pins;
    const checked = validateIdentityAliasPins(original);
    expect(checked).toEqual(original);
    expect(checked).not.toBe(original);
    expect(Object.isFrozen(checked)).toBe(true);
    original.expectedRowCount = 1;
    expect(checked.expectedRowCount).toBe(4);
    rejected(() => validateIdentityAliasPins({ ...original, extra: true }), "configuration");
  });

  it("defaults to legacy with no table or pins", () => {
    const resolve = createIdentityAliasResolver();
    for (const row of ROWS) {
      expect(resolve(row.field, row.oldId)).toBe(row.oldId);
      expect(resolve(row.field, row.newId)).toBe(row.newId);
    }
  });

  it.each(["renamed", "restored"] as const)("resolves all four families in %s mode", (mode) => {
    const resolve = createIdentityAliasResolver(configured(fixture(), mode));
    for (const row of ROWS) {
      const canonicalId = mode === "renamed" ? row.newId : row.oldId;
      expect(resolve(row.field, row.oldId)).toBe(canonicalId);
      expect(resolve(row.field, row.newId)).toBe(canonicalId);
      expect(resolve(row.field, "unknown-id")).toBe("unknown-id");
    }
    // A value in another family is not a grant to resolve that family's ID.
    expect(resolve("categoryId", ROWS[0].oldId)).toBe(ROWS[0].oldId);
    expect(resolve("contentId", ROWS[1].newId)).toBe(ROWS[1].newId);
  });

  it("uses a fixed independent canonical SHA-256 vector", () => {
    const payload = fixture([ROWS[0], ROWS[3]]);
    const config = configured(payload);
    // Derived independently with Python hashlib from the literal canonical JSON.
    expect(config.pins.payloadSha256).toBe("1ea93c964d35079f83792a4361097f52585255b89940692c91684f16824bfc50");
    expect(createIdentityAliasResolver(config)("contentId", "old-story")).toBe("story");
  });

  it("ignores object key insertion order and accepts null-prototype records", () => {
    const config = configured();
    const p = config.payload;
    config.payload = Object.assign(Object.create(null), {
      sourceMapSha256: p.sourceMapSha256,
      formatVersion: p.formatVersion,
      aliases: p.aliases.map(({ oldId, field, newId }) => Object.assign(Object.create(null), { oldId, newId, field })),
    });
    expect(createIdentityAliasResolver(config)("contentId", "old-story")).toBe("story");
  });

  it("pins row order instead of silently sorting mappings", () => {
    const config = configured();
    config.payload.aliases.reverse();
    rejected(() => createIdentityAliasResolver(config), "payload");
  });

  it("captures its generation without exposing a table or mutable maps", () => {
    const config = configured();
    const resolve = createIdentityAliasResolver(config);
    config.mode = "restored";
    config.pins.payloadSha256 = "b".repeat(64);
    config.payload.aliases[0].newId = "changed-story";
    config.payload.aliases.length = 0;
    expect(resolve("contentId", "old-story")).toBe("story");
    expect(Reflect.ownKeys(resolve).sort()).toEqual(["length", "name"]);
  });

  it.each([
    null, {}, { mode: "Renamed" }, { mode: "unknown", payload: {} },
    { mode: "legacy", pins: {} }, { mode: "legacy", payload: {} },
    { mode: "renamed" }, { mode: "restored", pins: {} },
    { mode: "legacy", extra: "untrusted-detail" },
  ])("rejects invalid explicit configuration %#", (config) => {
    rejected(() => createUnknown(config), "configuration");
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "4", 10_000])("rejects invalid or impossible row count %j", (count) => {
    const config = configured();
    const readPayload = vi.fn(() => { throw new Error("untrusted-detail"); });
    rejected(() => createUnknown({ ...config, pins: { ...config.pins, expectedRowCount: count }, payload: { get aliases() { return readPayload(); } } }), "configuration");
    expect(readPayload).not.toHaveBeenCalled();
  });

  it.each(["payloadSha256", "sourceMapSha256"] as const)("rejects malformed %s pin", (pin) => {
    for (const value of ["", "A".repeat(64), "g".repeat(64), "a".repeat(63), 42]) {
      const config = configured();
      rejected(() => createUnknown({ ...config, pins: { ...config.pins, [pin]: value } }), "configuration");
    }
  });

  it.each(["payloadSha256", "sourceMapSha256"] as const)("rejects mismatched %s pin", (pin) => {
    const config = configured();
    config.pins[pin] = "b".repeat(64);
    rejected(() => createIdentityAliasResolver(config), "payload");
  });

  it("rejects unexpected configuration/pin fields", () => {
    const config = configured();
    rejected(() => createUnknown({ ...config, extra: true }), "configuration");
    rejected(() => createUnknown({ ...config, pins: { ...config.pins, extra: true } }), "configuration");
  });

  it.each([
    null, [], {},
    { ...fixture(), formatVersion: "identity-aliases-v2" },
    { ...fixture(), sourceMapSha256: "A".repeat(64) },
    { ...fixture(), sourceMapSha256: "b".repeat(64) },
    { ...fixture(), title: "untrusted-detail" },
    { ...fixture(), _id: "provider-record" },
    { ...fixture(), aliases: null },
    { ...fixture(), aliases: [] },
    { ...fixture(), aliases: fixture().aliases.slice(1) },
  ])("rejects malformed or unpinned payload %#", (payload) => {
    rejected(() => createUnknown({ ...configured(), payload }), "payload");
  });

  it.each([
    null, {},
    { ...ROWS[0], extra: true },
    { ...ROWS[0], field: "mediaId" },
    { ...ROWS[0], oldId: "Invalid" },
    { ...ROWS[0], oldId: "double--hyphen" },
    { ...ROWS[0], oldId: "" },
    { ...ROWS[0], newId: "é" },
    { ...ROWS[0], newId: "a".repeat(MAX_PUBLIC_IDENTITY_LENGTH + 1) },
    { ...ROWS[0], newId: 42 },
    { ...ROWS[0], newId: new String("story") },
  ])("rejects malformed row %#", (row) => {
    const config = configured();
    config.payload.aliases[0] = row as Row;
    rejected(() => createIdentityAliasResolver(config), "payload");
  });

  it.each([
    [ROWS[0], { ...ROWS[1], oldId: ROWS[0].oldId }],
    [ROWS[0], { ...ROWS[1], newId: ROWS[0].newId }],
    [{ ...ROWS[0], newId: ROWS[0].oldId }],
    [ROWS[0], { ...ROWS[1], oldId: ROWS[0].newId }],
    [ROWS[0], { ...ROWS[1], oldId: ROWS[0].newId, newId: ROWS[0].oldId }],
    [ROWS[0], ROWS[0]],
  ])("rejects duplicates, self maps, cross-family chains and cycles %#", (...aliases) => {
    rejected(() => createIdentityAliasResolver(configured(fixture(aliases))), "payload");
  });

  it.each([0, 3])("rejects an array hole at index %i", (index) => {
    const config = configured();
    delete config.payload.aliases[index];
    rejected(() => createIdentityAliasResolver(config), "payload");
  });

  it("rejects custom/symbol properties and custom prototypes", () => {
    for (const alter of [
      (p: Payload) => Object.defineProperty(p, "secret", { value: "untrusted-detail" }),
      (p: Payload) => Object.assign(p, { [Symbol("extra")]: true }),
      (p: Payload) => Object.assign(p.aliases, { extra: true }),
      (p: Payload) => Object.assign(p.aliases, { [Symbol("extra")]: true }),
      (p: Payload) => Object.setPrototypeOf(p, { extra: true }),
      (p: Payload) => Object.setPrototypeOf(p.aliases, {}),
      (p: Payload) => Object.setPrototypeOf(p.aliases[0], { extra: true }),
      (p: Payload) => Object.defineProperty(p.aliases[0], "__proto__", {
        value: JSON.parse('{"__proto__":"untrusted-detail"}')["__proto__"],
        enumerable: true,
      }),
    ]) {
      const config = configured();
      alter(config.payload);
      rejected(() => createIdentityAliasResolver(config), "payload");
    }
  });

  it("rejects getters and toJSON without invoking them", () => {
    for (const location of ["config", "pins", "payload", "array", "row", "toJSON"] as const) {
      const config = configured();
      const spy = vi.fn(() => { throw new Error("untrusted-detail"); });
      if (location === "config") Object.defineProperty(config, "mode", { get: spy, enumerable: true });
      if (location === "pins") Object.defineProperty(config.pins, "payloadSha256", { get: spy, enumerable: true });
      if (location === "payload") Object.defineProperty(config.payload, "aliases", { get: spy, enumerable: true });
      if (location === "array") Object.defineProperty(config.payload.aliases, "0", { get: spy, enumerable: true });
      if (location === "row") Object.defineProperty(config.payload.aliases[0], "newId", { get: spy, enumerable: true });
      if (location === "toJSON") Object.assign(config.payload, { toJSON: spy });
      rejected(() => createIdentityAliasResolver(config), location === "config" || location === "pins" ? "configuration" : "payload");
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it("rejects proxies without executing their traps", () => {
    const trap = vi.fn(() => { throw new TypeError("untrusted-detail"); });
    const config = configured();
    rejected(() => createUnknown(new Proxy(config, { getPrototypeOf: trap })), "configuration");
    rejected(() => createUnknown({ ...config, payload: new Proxy(config.payload, { getPrototypeOf: trap }) }), "payload");
    rejected(() => createUnknown({ ...config, payload: { ...config.payload, aliases: new Proxy(config.payload.aliases, { get: trap }) } }), "payload");
    expect(trap).not.toHaveBeenCalled();
  });

  it("rejects an enormous mismatched sparse array before inspecting its indices", () => {
    const config = configured();
    config.payload.aliases = new Array(1_000_000_000);
    rejected(() => createIdentityAliasResolver(config), "payload");
  });

  it.each(["legacy", "renamed", "restored"] as const)("rejects invalid resolver inputs in %s mode", (mode) => {
    const resolve = createIdentityAliasResolver(mode === "legacy" ? { mode } : configured(fixture(), mode));
    for (const id of ["", "Invalid", "a".repeat(MAX_PUBLIC_IDENTITY_LENGTH + 1), 42, null]) {
      rejected(() => resolve("contentId", id as string), "input");
    }
    for (const family of ["mediaId", "cursor", "unknown", null]) {
      rejected(() => resolve(family as IdentityAliasField, "unknown-id"), "input");
    }
    expect(resolve("placementId", "a".repeat(MAX_PUBLIC_IDENTITY_LENGTH))).toBe("a".repeat(MAX_PUBLIC_IDENTITY_LENGTH));
  });

  function payloadOfSize(bytes: number): Payload {
    const payload = fixture(Array.from({ length: 480 }, (_, i) => ({ field: "contentId", oldId: `old-${i}`, newId: `new-${i}` })));
    let remaining = bytes - Buffer.byteLength(canonical(payload));
    for (const row of payload.aliases) {
      for (const key of ["oldId", "newId"] as const) {
        const padding = Math.min(remaining, MAX_PUBLIC_IDENTITY_LENGTH - row[key].length);
        row[key] += "x".repeat(padding);
        remaining -= padding;
      }
    }
    expect(remaining).toBe(0);
    expect(Buffer.byteLength(canonical(payload))).toBe(bytes);
    return payload;
  }

  it("accepts exactly 256KiB including the envelope and separators", () => {
    const config = configured(payloadOfSize(MAX_IDENTITY_ALIAS_PAYLOAD_BYTES));
    expect(createIdentityAliasResolver(config)("contentId", config.payload.aliases[0].oldId)).toBe(config.payload.aliases[0].newId);
  });

  it("rejects 256KiB plus one before checking the digest", () => {
    const config = configured(payloadOfSize(MAX_IDENTITY_ALIAS_PAYLOAD_BYTES + 1));
    config.pins.payloadSha256 = "b".repeat(64);
    rejected(() => createIdentityAliasResolver(config), "payload-too-large");
  });
});
