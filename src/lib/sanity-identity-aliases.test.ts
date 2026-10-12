import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IDENTITY_ALIAS_FORMAT_VERSION, type IdentityAliasField, type IdentityAliasPins } from "@/lib/identity-aliases";
import { getSanityPublicCachePolicy } from "@/lib/sanity-cache";
import {
  createSanityIdentityAliasLoader,
  IDENTITY_ALIAS_DOCUMENT_TYPE,
  IDENTITY_ALIAS_QUERY_TAG,
  MAX_IDENTITY_ALIAS_RESPONSE_BYTES,
  SanityIdentityAliasError,
  type SanityIdentityAliasConfiguration,
} from "@/lib/sanity-identity-aliases";

const ROWS = [
  { field: "contentId", newId: "story", oldId: "old-story" },
  { field: "categoryId", newId: "category", oldId: "old-category" },
  { field: "endGalleryId", newId: "story-gallery", oldId: "old-gallery" },
  { field: "placementId", newId: "story-image", oldId: "old-image" },
];
const SOURCE_SHA = "a".repeat(64);
const PINS: IdentityAliasPins = {
  sourceMapSha256: SOURCE_SHA,
  payloadSha256: createHash("sha256").update(JSON.stringify({ aliases: ROWS, formatVersion: IDENTITY_ALIAS_FORMAT_VERSION, sourceMapSha256: SOURCE_SHA })).digest("hex"),
  expectedRowCount: ROWS.length,
};
function document() {
  return {
    _id: "fixture-aliases", _type: IDENTITY_ALIAS_DOCUMENT_TYPE,
    _rev: "fixture-revision", _createdAt: "2020-01-01T00:00:00Z",
    _updatedAt: "2020-01-02T02:30:00.123+02:30", _originalId: "fixture-aliases",
    formatVersion: IDENTITY_ALIAS_FORMAT_VERSION, sourceMapSha256: SOURCE_SHA,
    aliases: ROWS.map((row, i) => ({ ...row, _key: `key-${i}`, _type: "identityAlias" })),
  };
}
function fixture(mode: "renamed" | "restored" = "renamed", respond: () => Response | Promise<Response> = () => new Response(JSON.stringify({ result: [document()], ms: 1 }))) {
  const fetchImplementation = vi.fn(async () => respond()) as unknown as typeof fetch;
  return {
    mode, documentId: "fixture-aliases", pins: { ...PINS },
    sanityConfig: { projectId: "fixture-project", dataset: "content", datasetVisibility: "public" as const, apiVersion: "v2020-01-01", readToken: "fixture-only-token" },
    fetchImplementation,
  };
}
function unknownConfig(value: unknown) {
  return createSanityIdentityAliasLoader(value as SanityIdentityAliasConfiguration);
}
function response(raw: unknown) { return new Response(JSON.stringify({ result: raw })); }
async function rejectLoad(respond: () => Response | Promise<Response>, rejection: SanityIdentityAliasError["rejection"]) {
  const config = fixture("renamed", respond);
  const loader = createSanityIdentityAliasLoader(config);
  await expect(loader.load()).rejects.toMatchObject({ rejection, message: `[sanity-identity-aliases] Failed ${rejection}` });
  await expect(loader.load()).rejects.toBeInstanceOf(SanityIdentityAliasError);
  expect(config.fetchImplementation).toHaveBeenCalledTimes(1);
}
afterEach(() => { vi.restoreAllMocks(); });

describe("published pinned identity aliases", () => {
  it("defaults to an async legacy loader with no CMS settings", async () => {
    const loader = createSanityIdentityAliasLoader();
    expect(Object.isFrozen(loader)).toBe(true);
    const resolve = await loader.load();
    expect(resolve("contentId", "old-story")).toBe("old-story");
    expect(await loader.load()).toBe(resolve);
  });

  it.each(["renamed", "restored"] as const)("loads once and resolves all families in %s", async (mode) => {
    const config = fixture(mode);
    const loader = createSanityIdentityAliasLoader(config);
    expect(config.fetchImplementation).not.toHaveBeenCalled();
    const pending = loader.load();
    expect(loader.load()).toBe(pending);
    const [resolve, same] = await Promise.all([pending, loader.load()]);
    expect(same).toBe(resolve);
    for (const row of ROWS) {
      expect(resolve(row.field as IdentityAliasField, row.oldId)).toBe(mode === "renamed" ? row.newId : row.oldId);
      expect(resolve(row.field as IdentityAliasField, row.newId)).toBe(mode === "renamed" ? row.newId : row.oldId);
    }
    expect(resolve("placementId", "unknown-id")).toBe("unknown-id");
    expect(config.fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("pins no-store, published, non-CDN and parameterized full-document query", async () => {
    const config = fixture(); await createSanityIdentityAliasLoader(config).load();
    expect(getSanityPublicCachePolicy(IDENTITY_ALIAS_QUERY_TAG)).toBeUndefined();
    const [input, init] = vi.mocked(config.fetchImplementation).mock.calls[0];
    const url = new URL(String(input));
    expect(url.origin).toBe("https://fixture-project.api.sanity.io");
    expect(url.searchParams.get("perspective")).toBe("published");
    expect(url.searchParams.get("$documentId")).toBe('"fixture-aliases"');
    expect(url.searchParams.get("query")).toBe("*[_id == $documentId][0...2]");
    expect(url.searchParams.get("tag")).toBe(IDENTITY_ALIAS_QUERY_TAG);
    expect(init?.cache).toBe("no-store");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fixture-only-token");
  });

  it("allows public reads without token and rejects private source missing a token", async () => {
    const config = fixture(); delete (config.sanityConfig as { readToken?: string }).readToken;
    await createSanityIdentityAliasLoader(config).load();
    expect(new Headers(vi.mocked(config.fetchImplementation).mock.calls[0][1]?.headers).has("Authorization")).toBe(false);
    expect(() => unknownConfig({ ...config, sanityConfig: { ...config.sanityConfig, datasetVisibility: "private" } })).toThrow(new SanityIdentityAliasError("configuration"));
  });

  it("captures configuration before caller mutation", async () => {
    const config = fixture(); const loader = createSanityIdentityAliasLoader(config);
    config.mode = "restored"; config.documentId = "changed"; config.pins.payloadSha256 = "b".repeat(64);
    config.sanityConfig.projectId = "changed"; config.sanityConfig.readToken = "changed";
    expect((await loader.load())("contentId", "old-story")).toBe("story");
    const [input, init] = vi.mocked(config.fetchImplementation).mock.calls[0];
    expect(new URL(String(input)).origin).toBe("https://fixture-project.api.sanity.io");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fixture-only-token");
  });

  it.each([
    null, {}, { mode: "Renamed" }, { mode: "renamed" },
    { mode: "legacy", pins: PINS }, { mode: "legacy", sanityConfig: {} },
    { ...fixture(), documentId: "drafts.fixture" }, { ...fixture(), documentId: "versions.r.fixture" },
    { ...fixture(), documentId: "../fixture" }, { ...fixture(), documentId: "x".repeat(129) },
    { ...fixture(), pins: { ...PINS, expectedRowCount: 0 } },
    { ...fixture(), pins: { ...PINS, payloadSha256: "A".repeat(64) } },
    { ...fixture(), sanityConfig: { ...fixture().sanityConfig, projectId: "invalid/host" } },
    { ...fixture(), signal: new AbortController().signal },
  ])("rejects invalid config synchronously before IO %#", (config) => {
    expect(() => unknownConfig(config)).toThrow(new SanityIdentityAliasError("configuration"));
    if (config && "fetchImplementation" in config) expect(config.fetchImplementation).not.toHaveBeenCalled();
  });

  it("rejects caller getters without invoking them", () => {
    const config = fixture(); const getter = vi.fn(() => { throw Error("private-detail"); });
    Object.defineProperty(config.pins, "payloadSha256", { get: getter, enumerable: true });
    expect(() => createSanityIdentityAliasLoader(config)).toThrow(new SanityIdentityAliasError("configuration"));
    expect(getter).not.toHaveBeenCalled(); expect(config.fetchImplementation).not.toHaveBeenCalled();
  });

  it("isolates caller abort from the shared transport-owned signal", async () => {
    let complete!: (response: Response) => void;
    const config = fixture("renamed", () => new Promise((resolve) => { complete = resolve; }));
    const loader = createSanityIdentityAliasLoader(config); const caller = new AbortController();
    const first = loader.load(); const second = loader.load(); caller.abort();
    const signal = vi.mocked(config.fetchImplementation).mock.calls[0][1]?.signal;
    expect(signal).not.toBe(caller.signal); expect(signal?.aborted).toBe(false);
    complete(response([document()]));
    expect(await first).toBe(await second);
  });

  it.each([null, [], [document(), document()]])("rejects missing/multiple records %#", async (raw) => {
    await rejectLoad(() => response(raw), "record-shape");
  });

  it.each([
    { ...document(), _id: "different" }, { ...document(), _type: "article" },
    { ...document(), _originalId: "drafts.fixture-aliases" }, { ...document(), _rev: "\nprivate" },
    { ...document(), _createdAt: "2020-02-30T00:00:00Z" }, { ...document(), _updatedAt: 42 },
    { ...document(), aliases: document().aliases.map((row) => ({ ...row, _key: "duplicate" })) },
    { ...document(), aliases: document().aliases.map((row) => ({ ...row, _type: "arbitrary" })) },
  ])("rejects malformed provider metadata %#", async (doc) => {
    await rejectLoad(() => response([doc]), "record-metadata");
  });

  it("allows absent row metadata and mixed unique keys", async () => {
    const doc = document();
    const rows: unknown[] = [ROWS[0], ...doc.aliases.slice(1)];
    const config = fixture("renamed", () => response([{ ...doc, aliases: rows }]));
    expect((await createSanityIdentityAliasLoader(config).load())("contentId", "old-story")).toBe("story");
  });

  it.each([
    { ...document(), extra: "private-locator" }, { ...document(), _system: {} },
    { ...document(), aliases: [] }, { ...document(), aliases: document().aliases.slice(1) },
    { ...document(), aliases: document().aliases.map((row) => ({ ...row, title: "private" })) },
  ])("rejects unknown fields/count before projecting %#", async (doc) => {
    await rejectLoad(() => response([doc]), "record-shape");
  });

  it.each([
    { ...document(), sourceMapSha256: "b".repeat(64) },
    { ...document(), formatVersion: "future-version" },
    { ...document(), aliases: document().aliases.map((row, i) => i === 0 ? { ...row, newId: "changed" } : row) },
    { ...document(), aliases: [...document().aliases].reverse() },
  ])("rejects changed canonical payload/pins %#", async (doc) => {
    await rejectLoad(() => response([doc]), "alias-payload");
  });

  it.each([
    '{"result":[],"result":[]}', '{"result":[],"\\u0072esult":[]}',
    '{"result":[{"_id":"one","_id":"two"}]}', "invalid private response",
  ])("rejects damaged/duplicate JSON at the transport boundary %#", async (raw) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await rejectLoad(() => new Response(raw), "transport");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(raw);
  });

  it("enforces declared and streaming wire bounds and fatal UTF-8", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const cancel = vi.fn();
    await rejectLoad(() => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(MAX_IDENTITY_ALIAS_RESPONSE_BYTES + 1)); }, cancel }), { headers: { "content-length": String(MAX_IDENTITY_ALIAS_RESPONSE_BYTES + 1) } }), "transport");
    expect(cancel).toHaveBeenCalled();
    await rejectLoad(() => new Response(new Uint8Array(MAX_IDENTITY_ALIAS_RESPONSE_BYTES + 1)), "transport");
    await rejectLoad(() => new Response(new Uint8Array([0xc3, 0x28])), "transport");
  });

  it.each([401, 403, 404, 429, 503])("classifies HTTP %i without body leakage and memoizes failure", async (status) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await rejectLoad(() => new Response("private-body", { status }), "transport");
    const events = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(events).not.toContain("private-body"); expect(events).not.toContain("fixture-only-token");
  });

  it.each([new Error("private-cause"), new DOMException("private-cause", "TimeoutError")])("redacts rejected transport and handles a discarded consumer promise %#", async (cause) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const unhandled = vi.fn(); process.on("unhandledRejection", unhandled);
    try {
      const config = fixture("renamed", () => Promise.reject(cause));
      const loader = createSanityIdentityAliasLoader(config);
      void loader.load(); await new Promise((resolve) => setTimeout(resolve, 0));
      const pending = loader.load(); await expect(pending).rejects.toMatchObject({ rejection: "transport" });
      await expect(pending).rejects.not.toHaveProperty("cause");
      expect(unhandled).not.toHaveBeenCalled(); expect(config.fetchImplementation).toHaveBeenCalledTimes(1);
    } finally { process.off("unhandledRejection", unhandled); }
  });

  it("requires explicit recreation to recover from a sticky failed generation", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let ready = false;
    const config = fixture("renamed", () => ready ? response([document()]) : new Response("unavailable", { status: 503 }));
    const loader = createSanityIdentityAliasLoader(config);
    await expect(loader.load()).rejects.toMatchObject({ rejection: "transport" });
    ready = true;
    await expect(loader.load()).rejects.toMatchObject({ rejection: "transport" });
    expect(config.fetchImplementation).toHaveBeenCalledTimes(1);
    const fresh = createSanityIdentityAliasLoader(config);
    expect((await fresh.load())("contentId", "old-story")).toBe("story");
    expect(config.fetchImplementation).toHaveBeenCalledTimes(2);
  });
});
