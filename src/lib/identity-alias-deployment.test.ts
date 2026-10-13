import { createHash } from "node:crypto";
import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IDENTITY_ALIAS_FORMAT_VERSION, type IdentityAliasField } from "@/lib/identity-aliases";
import {
  createDeploymentIdentityAliasLoader,
  IdentityAliasDeploymentError,
  readIdentityAliasDeployment,
} from "@/lib/identity-alias-deployment";

const PREFIX = "SITE_IDENTITY_ALIAS_";
const NAMES = ["MODE", "DOCUMENT_ID", "SOURCE_MAP_SHA256", "PAYLOAD_SHA256", "ROW_COUNT"];
const ROWS = [
  { field: "contentId", newId: "story", oldId: "old-story" },
  { field: "categoryId", newId: "category", oldId: "old-category" },
  { field: "endGalleryId", newId: "story-gallery", oldId: "old-gallery" },
  { field: "placementId", newId: "story-image", oldId: "old-image" },
];
const SOURCE_SHA = "a".repeat(64);
const PAYLOAD = { aliases: ROWS, formatVersion: IDENTITY_ALIAS_FORMAT_VERSION, sourceMapSha256: SOURCE_SHA };
const PAYLOAD_SHA = createHash("sha256").update(JSON.stringify(PAYLOAD)).digest("hex");
function environment(mode = "renamed"): Record<string, string | undefined> {
  return {
    SITE_IDENTITY_ALIAS_MODE: mode,
    SITE_IDENTITY_ALIAS_DOCUMENT_ID: "fixture-aliases",
    SITE_IDENTITY_ALIAS_SOURCE_MAP_SHA256: SOURCE_SHA,
    SITE_IDENTITY_ALIAS_PAYLOAD_SHA256: PAYLOAD_SHA,
    SITE_IDENTITY_ALIAS_ROW_COUNT: "4",
    SANITY_PROJECT_ID: "fixture-project", SANITY_DATASET: "content",
    SANITY_DATASET_VISIBILITY: "public", SANITY_API_VERSION: "v2020-01-01",
    SANITY_READ_TOKEN: "fixture-only-token",
  };
}
function respond() {
  return new Response(JSON.stringify({ result: [{
    ...PAYLOAD, _id: "fixture-aliases", _type: "identityAliasSet", _rev: "revision",
    _createdAt: "2020-01-01T00:00:00Z", _updatedAt: "2020-01-01T00:00:00Z",
  }] }));
}
function supplied(value: unknown) { return readIdentityAliasDeployment(value as Record<string, string | undefined>); }
function invalid(value: unknown) {
  try { supplied(value); throw Error("unexpected success"); }
  catch (error) {
    expect(error).toBeInstanceOf(IdentityAliasDeploymentError);
    expect(error).not.toHaveProperty("cause");
    expect(String(error)).toBe("IdentityAliasDeploymentError: [identity-alias-deployment] Invalid configuration");
    expect(JSON.stringify(error)).not.toContain("private-sentinel");
    expect(inspect(error)).not.toContain("private-sentinel");
  }
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("deployment-owned alias settings", () => {
  it.each([undefined, "", " \t\n", "legacy"])("defaults/chooses legacy without pins (%j)", (mode) => {
    const settings = readIdentityAliasDeployment({ SITE_IDENTITY_ALIAS_MODE: mode, UNRELATED: "anything" });
    expect(settings).toEqual({ mode: "legacy" }); expect(Object.isFrozen(settings)).toBe(true);
  });

  it("accepts cleared inactive settings and mirrors", () => {
    const env: Record<string, string> = {};
    for (const name of NAMES) { env[PREFIX + name] = " "; env["NEXT_PUBLIC_" + PREFIX + name] = " "; }
    expect(readIdentityAliasDeployment(env)).toEqual({ mode: "legacy" });
  });

  it.each(NAMES.slice(1))("rejects stale %s even with omitted mode", (name) => {
    invalid({ [PREFIX + name]: "private-sentinel" });
    invalid({ SITE_IDENTITY_ALIAS_MODE: "legacy", [PREFIX + name]: "private-sentinel" });
  });

  it.each(["renamed", "restored"])("captures frozen settings with native Unicode trimming in %s", (mode) => {
    const env = environment(mode);
    for (const name of NAMES) env[PREFIX + name] = "\u00a0\ufeff" + env[PREFIX + name] + "\t";
    const settings = readIdentityAliasDeployment(env);
    expect(settings.mode).toBe(mode);
    if (settings.mode === "legacy") throw Error("unexpected legacy");
    expect(settings.documentId).toBe("fixture-aliases");
    expect(settings.pins).toEqual({ sourceMapSha256: SOURCE_SHA, payloadSha256: PAYLOAD_SHA, expectedRowCount: 4 });
    expect(Object.isFrozen(settings)).toBe(true); expect(Object.isFrozen(settings.pins)).toBe(true);
    env.SITE_IDENTITY_ALIAS_DOCUMENT_ID = "changed"; env.SITE_IDENTITY_ALIAS_ROW_COUNT = "1";
    expect(settings.documentId).toBe("fixture-aliases"); expect(settings.pins.expectedRowCount).toBe(4);
    expect(Object.keys(settings).sort()).toEqual(["documentId", "mode", "pins"]);
  });

  it.each(["0", "04", "+4", "-4", "4.0", "4e0", "4 0", "", "5826", "9999", "9007199254740992", "1".repeat(17)])("rejects noncanonical or impossible count %j", (count) => {
    invalid({ ...environment(), SITE_IDENTITY_ALIAS_ROW_COUNT: count });
  });

  it("accepts the core's inclusive cheap count bound before payload validation", () => {
    const settings = readIdentityAliasDeployment({ ...environment(), SITE_IDENTITY_ALIAS_ROW_COUNT: "5825" });
    expect(settings.mode !== "legacy" && settings.pins.expectedRowCount).toBe(5825);
  });

  it.each(NAMES.slice(1))("requires %s in active modes", (name) => {
    const env = environment(); delete env[PREFIX + name]; invalid(env);
  });

  it.each(["Renamed", "unknown", "private-sentinel"])("rejects invalid mode %j", (mode) => { invalid(environment(mode)); });

  it.each(["drafts.fixture", "versions.release.fixture", "../fixture", "x".repeat(129), ""])("shares published root ID rejection %j", (id) => {
    invalid({ ...environment(), SITE_IDENTITY_ALIAS_DOCUMENT_ID: id });
  });

  it("accepts the shared inclusive root-ID length boundary", () => {
    const settings = readIdentityAliasDeployment({ ...environment(), SITE_IDENTITY_ALIAS_DOCUMENT_ID: "x".repeat(128) });
    expect(settings.mode !== "legacy" && settings.documentId.length).toBe(128);
  });

  it.each(["SOURCE_MAP_SHA256", "PAYLOAD_SHA256"])("rejects malformed %s", (name) => {
    for (const hash of ["A".repeat(64), "a".repeat(63), "private-sentinel", "g".repeat(64)]) invalid({ ...environment(), [PREFIX + name]: hash });
  });

  it("caps raw strings before trimming", () => {
    invalid({ SITE_IDENTITY_ALIAS_MODE: " ".repeat(513) });
    expect(readIdentityAliasDeployment({ SITE_IDENTITY_ALIAS_MODE: " ".repeat(512) })).toEqual({ mode: "legacy" });
  });

  it.each(["SITE_IDENTITY_ALIAS_TYPO", "NEXT_PUBLIC_SITE_IDENTITY_ALIAS_TYPO", "site_identity_alias_mode", "next_public_site_identity_alias_mode", "Site_Identity_Alias_MODE"])("rejects unknown/case-variant namespace %s even blank or non-enumerable", (name) => {
    invalid({ [name]: "" });
    invalid(Object.defineProperty({}, name, { value: "", enumerable: false }));
  });

  it.each(NAMES)("refuses nonblank NEXT_PUBLIC mirror for %s", (name) => { invalid({ ["NEXT_PUBLIC_" + PREFIX + name]: "private-sentinel" }); });

  it.each([null, [], 3, "private-sentinel", { [PREFIX + "MODE"]: 3 }, { [PREFIX + "MODE"]: { trim() { throw Error("private-sentinel"); } } }])("refuses bad environment/value types %#", (env) => { invalid(env); });

  it("rejects accessors, proxies, symbols and inherited known settings without invoking traps", () => {
    const trap = vi.fn(() => { throw Error("private-sentinel"); });
    invalid(Object.defineProperty({}, PREFIX + "MODE", { get: trap, enumerable: true }));
    invalid(Object.create({ [PREFIX + "MODE"]: "legacy" }));
    invalid(Object.create({ ["NEXT_PUBLIC_" + PREFIX + "MODE"]: "renamed" }));
    invalid(new Proxy({}, { ownKeys: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap, has: trap }));
    invalid(Object.create(new Proxy({}, { ownKeys: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap, has: trap })));
    invalid(Object.create({ SITE_IDENTITY_ALIAS_TYPO: "" }));
    invalid({ [Symbol("private-sentinel")]: "legacy" });
    expect(trap).not.toHaveBeenCalled();
  });

  it("supports real process.env with only synthetic alias settings", async () => {
    // Clear/stub only this namespace; no CMS source or token is read in legacy.
    for (const key of Object.keys(process.env)) {
      if (key.toUpperCase().startsWith(PREFIX) || key.toUpperCase().startsWith("NEXT_PUBLIC_" + PREFIX)) vi.stubEnv(key, undefined);
    }
    vi.stubEnv(PREFIX + "MODE", "legacy");
    expect(readIdentityAliasDeployment(process.env)).toEqual({ mode: "legacy" });
    expect((await createDeploymentIdentityAliasLoader(process.env).load())("contentId", "old-story")).toBe("old-story");
  });

  it("allows unrelated blank/odd keys and unread getters in every mode", () => {
    const trap = vi.fn(() => { throw Error("private-sentinel"); });
    for (const mode of ["legacy", "renamed", "restored"]) {
      const env = mode === "legacy" ? {} : environment(mode);
      Object.assign(env, { UNRELATED: "", "odd key": "value", "": "ignored" });
      Object.defineProperty(env, "UNRELATED_GETTER", { get: trap, enumerable: true });
      expect(readIdentityAliasDeployment(env).mode).toBe(mode);
    }
    expect(trap).not.toHaveBeenCalled();
  });
});

describe("deployment alias loader composition", () => {
  it("legacy leaves CMS and unrelated getters untouched, with zero IO", async () => {
    const trap = vi.fn(() => { throw Error("private-sentinel"); });
    const env = Object.defineProperties({}, {
      SANITY_READ_TOKEN: { get: trap, enumerable: true }, SANITY_PROJECT_ID: { get: trap, enumerable: true },
      UNRELATED: { get: trap, enumerable: true },
    });
    const fetchImplementation = vi.fn(); const loader = createDeploymentIdentityAliasLoader(env, fetchImplementation);
    expect((await loader.load())("placementId", "old-image")).toBe("old-image");
    expect(trap).not.toHaveBeenCalled(); expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it.each(["renamed", "restored"])("loads lazily once, captures source and resolves all families in %s", async (mode) => {
    const env = Object.defineProperty(environment(mode), "UNRELATED", { get() { throw Error("private-sentinel"); }, enumerable: true });
    const send = vi.fn(async () => respond()); const loader = createDeploymentIdentityAliasLoader(env, send);
    expect(send).not.toHaveBeenCalled(); expect(Object.isFrozen(loader)).toBe(true);
    env.SITE_IDENTITY_ALIAS_MODE = "legacy"; env.SITE_IDENTITY_ALIAS_DOCUMENT_ID = "changed";
    env.SITE_IDENTITY_ALIAS_PAYLOAD_SHA256 = "b".repeat(64); env.SANITY_PROJECT_ID = "changed"; env.SANITY_READ_TOKEN = "changed";
    const pending = loader.load(); expect(loader.load()).toBe(pending); const resolve = await pending;
    for (const row of ROWS) {
      expect(resolve(row.field as IdentityAliasField, row.oldId)).toBe(mode === "renamed" ? row.newId : row.oldId);
      expect(resolve(row.field as IdentityAliasField, row.newId)).toBe(mode === "restored" ? row.oldId : row.newId);
    }
    expect(await loader.load()).toBe(resolve); expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(send as typeof fetch).mock.calls[0];
    expect(new URL(String(url)).origin).toBe("https://fixture-project.api.sanity.io");
    expect(new URL(String(url)).searchParams.get("$documentId")).toBe('"fixture-aliases"');
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fixture-only-token");
  });

  it("each composition call owns an independent generation", async () => {
    const send = vi.fn(async () => respond()); const env = environment();
    const a = createDeploymentIdentityAliasLoader(env, send), b = createDeploymentIdentityAliasLoader(env, send);
    expect(a).not.toBe(b); expect(await a.load()).not.toBe(await b.load()); expect(send).toHaveBeenCalledTimes(2);
  });

  it("captures the default fetch at composition and delays IO", async () => {
    const send = vi.fn(async () => respond()), replacement = vi.fn();
    vi.stubGlobal("fetch", send);
    const loader = createDeploymentIdentityAliasLoader(environment(), undefined);
    expect(send).not.toHaveBeenCalled(); vi.stubGlobal("fetch", replacement);
    expect((await loader.load())("contentId", "old-story")).toBe("story");
    expect(send).toHaveBeenCalledTimes(1); expect(replacement).not.toHaveBeenCalled();
  });

  it("rejects bad pins before inspecting CMS source or performing IO", () => {
    const trap = vi.fn(() => { throw Error("private-sentinel"); }), send = vi.fn();
    const env = Object.defineProperty({ ...environment(), SITE_IDENTITY_ALIAS_PAYLOAD_SHA256: "private-sentinel" }, "SANITY_READ_TOKEN", { get: trap, enumerable: true });
    expect(() => createDeploymentIdentityAliasLoader(env, send)).toThrow(new IdentityAliasDeploymentError());
    expect(trap).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });

  it("reuses public/private source and public-secret-mirror checks before IO", async () => {
    const send = vi.fn(async () => respond()); const env = environment(); delete env.SANITY_READ_TOKEN;
    const publicLoader = createDeploymentIdentityAliasLoader(env, send); expect(send).not.toHaveBeenCalled();
    await publicLoader.load(); expect(new Headers(vi.mocked(send as typeof fetch).mock.calls[0][1]?.headers).has("Authorization")).toBe(false);
    for (const overrides of [{ SANITY_DATASET_VISIBILITY: "private" }, { NEXT_PUBLIC_SANITY_READ_TOKEN: "private-sentinel" }, { SANITY_PROJECT_ID: "invalid/host" }]) {
      expect(() => createDeploymentIdentityAliasLoader({ ...env, ...overrides }, send)).toThrow(new IdentityAliasDeploymentError());
    }
    const privateLoader = createDeploymentIdentityAliasLoader({ ...environment(), SANITY_DATASET_VISIBILITY: "private" }, send);
    await privateLoader.load(); expect(send).toHaveBeenCalledTimes(2);
  });

  it.each([
    "SANITY_PROJECT_ID", "SANITY_DATASET", "SANITY_DATASET_VISIBILITY",
    "SANITY_API_VERSION", "SANITY_READ_TOKEN", "NEXT_PUBLIC_SANITY_READ_TOKEN",
  ])("rejects own/inherited source getters for %s without invoking them or IO", (key) => {
    const trap = vi.fn(() => { throw Error("private-sentinel"); });
    const send = vi.fn();
    const own = Object.defineProperty(environment(), key, { get: trap, enumerable: true });
    expect(() => createDeploymentIdentityAliasLoader(own, send)).toThrow(new IdentityAliasDeploymentError());
    const inherited = environment(); delete inherited[key];
    Object.setPrototypeOf(inherited, Object.defineProperty({}, key, { get: trap, enumerable: true }));
    expect(() => createDeploymentIdentityAliasLoader(inherited, send)).toThrow(new IdentityAliasDeploymentError());
    expect(trap).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects bad fetch configuration even in legacy", () => {
    expect(() => createDeploymentIdentityAliasLoader({}, 3 as unknown as typeof fetch)).toThrow(new IdentityAliasDeploymentError());
    expect(() => createDeploymentIdentityAliasLoader(environment(), null as unknown as typeof fetch)).toThrow(new IdentityAliasDeploymentError());
  });
});
