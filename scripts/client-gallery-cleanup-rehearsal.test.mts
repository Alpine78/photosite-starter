import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { memorySanityLake } from "../test-support/sanity-lake.ts";
import { rehearsalBaseline, rehearsalFixtures, runCleanupRehearsal } from "./client-gallery-cleanup-rehearsal.mts";
import { createRehearsalIO } from "./client-gallery-rehearsal-io.mts";
import { assertMutations, assertSnapshot, buildManifest, CASES, FIXED_CURSOR_ID, manifestDigest, ownedIds, parseManifest, strictJson, targetOf, type Manifest } from "./client-gallery-rehearsal-scope.mts";

const NONCE = "0123456789abcdef0123456789abcdef", TOKEN = "synthetic_token";
const target = { projectId: "example123", dataset: "preview" as const, apiVersion: "v2026-10-01" };
const filesPromise = rehearsalFixtures(NONCE);
async function setup() {
  const files = await filesPromise, store = memorySanityLake([]), events: Record<string, unknown>[] = [];
  const manifest = buildManifest({ target, sourceSha: "a".repeat(40), nonce: NONCE, createdAt: new Date().toISOString(), baseline: [] }, files);
  let transaction = 0;
  const fetcher = vi.fn<typeof fetch>(async (input, init): Promise<Response> => {
    const url = new URL(String(input)), headers = { date: new Date().toUTCString() };
    if (url.pathname.includes("/export/")) return new Response([...store.docs.values()].map(doc => JSON.stringify(doc) + "\n").join(""), { headers });
    if (url.pathname.includes("/doc/")) return Response.json(await store.read(decodeURIComponent(url.pathname.split("/").at(-1)!).split(","), url.searchParams.get("includeAllVersions") === "true"), { headers });
    if (url.pathname.includes("/assets/")) {
      const image = url.pathname.includes("/images/"), bytes = init!.body as Uint8Array;
      const evidence = manifest.cases.flatMap(entry => [entry.image, entry.zip]).find(asset => manifestDigest(bytes) === asset.sha256)!;
      store.put({ _id: evidence.id, _type: image ? "sanity.imageAsset" : "sanity.fileAsset", sha1hash: evidence.sha1, size: evidence.bytes,
        extension: image ? "webp" : "zip", mimeType: image ? "image/webp" : "application/zip", originalFilename: url.searchParams.get("filename"),
        ...(image ? { metadata: { dimensions: { width: 256, height: 192 } } } : {}) });
      return Response.json({ document: store.docs.get(evidence.id) }, { headers });
    }
    const { mutations } = JSON.parse(init!.body as string) as { mutations: Record<string, Record<string, unknown>>[] };
    try {
      store.commit(mutations);
      const ids = [...new Set(mutations.map(row => { const value = Object.values(row)[0]; return value.id ?? value._id; }))];
      return Response.json({ transactionId: `tx-${++transaction}`, results: ids.map(id => ({ id, operation: store.docs.has(id as string) ? "update" : "delete" })) }, { headers });
    } catch { return new Response(null, { status: 409, headers }); }
  });
  const journal = vi.fn(async (event: Record<string, unknown>) => { events.push(event); });
  const io = createRehearsalIO(manifest, TOKEN, journal, fetcher);
  return { manifest, files, store, fetcher, journal, events, io };
}
function reparse(value: unknown, now = Date.now()) { const bytes = Buffer.from(JSON.stringify(value)); return parseManifest(bytes, manifestDigest(bytes), now); }

describe("rehearsal manifest and exact ownership", () => {
  it("round-trips a generated approval and includes the fixed cursor without prefix authority", async () => {
    const { manifest } = await setup();
    expect(reparse(manifest)).toEqual(manifest);
    expect(ownedIds(manifest).size).toBe(CASES.length * 6 + 1); expect(ownedIds(manifest).has(FIXED_CURSOR_ID)).toBe(true);
    expect(ownedIds(manifest).has(`cleanupRehearsal-${NONCE}-foreign`)).toBe(false);
  });
  it("rejects changed bytes, duplicate keys, BOM, invalid UTF-8 and stale approval before IO", async () => {
    const { manifest, fetcher } = await setup(), bytes = Buffer.from(JSON.stringify(manifest));
    expect(() => parseManifest(bytes, "0".repeat(64), Date.now())).toThrow("approval_mismatch");
    expect(() => reparse(manifest, Date.now() + 3 * 60 * 60_000 + 1000)).toThrow("invalid_manifest");
    for (const bytes of [Buffer.from('{"version":1,"version":2}'), Buffer.from([239, 187, 191, 123, 125]), Buffer.from([255])]) expect(() => strictJson(bytes)).toThrow("invalid_json");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["production", "../preview", "preview?query=x"])("refuses dataset %s", dataset => {
    expect(() => targetOf({ ...target, dataset })).toThrow("invalid_target");
  });
  it("rejects foreign case/control identities, shared fixture IDs, extra keys and unexpected baseline types", async () => {
    const { manifest } = await setup();
    for (const modify of [
      (m: Manifest) => { m.cases[0].controlId = manifest.cases[1].controlId; },
      (m: Manifest) => { m.cases[0].image = m.cases[1].image; },
      (m: Manifest) => { (m as unknown as Record<string, unknown>).extra = true; },
      (m: Manifest) => { m.baseline = [{ id: "customer", type: "article", revision: "r1" }]; },
    ]) { const copy = structuredClone(manifest); modify(copy); expect(() => reparse(copy)).toThrow(); }
  });
  it("refuses foreign records, variants, pre-existing owned cursor and changed/omitted frozen system records", async () => {
    const { manifest } = await setup();
    const baseline = { id: "system.retention", type: "system.retention", revision: "r1" }; manifest.baseline = [baseline];
    const rows = new Map([[baseline.id, baseline]]); expect(() => assertSnapshot(manifest, rows, true)).not.toThrow();
    for (const row of [{ id: "customer", type: "article", revision: "r2" }, { id: `versions.release.${manifest.cases[0].galleryId}`, type: "clientDeliveryGallery", revision: "r2" }, { id: FIXED_CURSOR_ID, type: "clientGalleryCleanupCursor", revision: "r2" }])
      expect(() => assertSnapshot(manifest, new Map([...rows, [row.id, row]]), true)).toThrow("foreign_content");
    expect(() => assertSnapshot(manifest, new Map())).toThrow("baseline_changed");
    expect(() => assertSnapshot(manifest, new Map([[baseline.id, { ...baseline, revision: "r2" }]]))).toThrow("baseline_changed");
  });
  it("requires guarded exact targets and refuses query operations, weak/foreign references, path patches and identity mutation", async () => {
    const { manifest } = await setup(), id = manifest.cases[0].galleryId;
    const valid = [{ patch: { id, ifRevisionID: "r1", set: { cleanupAttempt: "synthetic" } } }, { delete: { id } }];
    expect(() => assertMutations(manifest, valid)).not.toThrow();
    for (const mutations of [
      [{ delete: { id } }], [{ delete: { query: "*[]" } }], [{ createOrReplace: { _id: id, _type: "clientDeliveryGallery" } }],
      [{ patch: { id: "foreign", ifRevisionID: "r1", set: { x: 1 } } }],
      [{ patch: { id, set: { x: 1 } } }], [{ patch: { id, ifRevisionID: "r1", set: { "items[0].image.asset._ref": "foreign" } } }],
      [{ patch: { id, ifRevisionID: "r1", set: { _type: "article" } } }],
      [{ patch: { id, ifRevisionID: "r1", set: { asset: { _type: "reference", _ref: "foreign" } } } }],
      [{ patch: { id, ifRevisionID: "r1", set: { asset: { _type: "reference", _ref: manifest.cases[0].image.id, _weak: true } } } }],
      [{ create: { _id: manifest.cases[0].image.id, _type: "sanity.imageAsset" } }],
    ]) expect(() => assertMutations(manifest, mutations)).toThrow();
  });
});

describe("journaled provider boundary", () => {
  it("does not send a write when durable intent fails", async () => {
    const { manifest, fetcher } = await setup();
    const io = createRehearsalIO(manifest, TOKEN, async () => { throw new Error("private-path-canary"); }, fetcher);
    expect(await io.transport.mutate([{ create: { _id: manifest.cases[0].referrerId, _type: "cleanupRehearsalReferrer" } }])).toEqual({ kind: "uncertain" });
    expect(fetcher).not.toHaveBeenCalled(); expect(io.unsafe()).toBe(true);
  });
  it("refuses foreign IDs/references and query reads before the wire", async () => {
    const { manifest, io, fetcher } = await setup();
    await expect(io.transport.read(["foreign"])).rejects.toThrow(); await expect(io.transport.due(new Date().toISOString())).rejects.toThrow();
    await io.transport.mutate([{ create: { _id: manifest.cases[0].referrerId, _type: "cleanupRehearsalReferrer", asset: { _ref: "foreign" } } }]);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("awaits intent before forwarding identical mutation bytes and logs only bounded metadata", async () => {
    const { manifest, fetcher } = await setup(), order: string[] = [], intents: Record<string, unknown>[] = [];
    const wire: typeof fetch = async (input, init) => { order.push("wire"); return fetcher(input, init); };
    const io = createRehearsalIO(manifest, TOKEN, async event => { order.push("intent"); intents.push(event); }, wire);
    const mutations = [{ create: { _id: manifest.cases[0].referrerId, _type: "cleanupRehearsalReferrer" } }];
    expect((await io.transport.mutate(mutations)).kind).toBe("committed");
    expect(order).toEqual(["intent", "wire"]); expect(fetcher.mock.calls[0][1]?.body).toBe(JSON.stringify({ mutations }));
    expect(intents[0].bodySha256).toBe(manifestDigest(Buffer.from(JSON.stringify({ mutations }))));
    expect(JSON.stringify(intents)).not.toContain(TOKEN); expect(JSON.stringify(intents)).not.toContain('"mutations"');
  });
  it("uploads each exact approved asset only once and refuses existing or changed bytes", async () => {
    const { manifest, files, io, fetcher } = await setup(), entry = manifest.cases[0], image = files.get(entry.name)!.image;
    await io.upload(entry, "image", image);
    await expect(io.upload(entry, "image", image)).rejects.toThrow("asset_already_exists");
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes("/assets/"))).toHaveLength(1);
    expect(fetcher.mock.calls.find(([url]) => String(url).includes("/assets/"))![1]?.body).toBe(image);
    const fresh = await setup(); await expect(fresh.io.upload(fresh.manifest.cases[0], "image", Buffer.from("wrong"))).rejects.toThrow("upload_unconfirmed");
    expect(fresh.fetcher.mock.calls.filter(([url]) => String(url).includes("/assets/"))).toHaveLength(0);
  });
  it("never retries an ambiguous wire write and prevents later writes while allowing reconciliation reads", async () => {
    const { manifest } = await setup(), calls: string[] = [];
    const fetcher: typeof fetch = async (url, init) => { calls.push(init!.method!); if (init!.method === "POST") throw new Error("provider-secret-canary"); return Response.json({ documents: [], omitted: [{ id: manifest.cases[0].referrerId, reason: "existence" }] }, { headers: { date: new Date().toUTCString() } }); };
    const io = createRehearsalIO(manifest, TOKEN, async () => {}, fetcher), mutation = [{ create: { _id: manifest.cases[0].referrerId, _type: "cleanupRehearsalReferrer" } }];
    expect((await io.transport.mutate(mutation)).kind).toBe("uncertain"); await io.transport.mutate(mutation);
    await io.transport.read([manifest.cases[0].referrerId]); expect(calls).toEqual(["POST", "GET"]); expect(io.unsafe()).toBe(true);
  });
  it("bounds requests and wall time independently of the runner", async () => {
    const run = await setup(), id = run.manifest.cases[0].referrerId;
    for (let index = 0; index < 500; index++) await run.io.transport.read([id]);
    await expect(run.io.transport.read([id])).rejects.toThrow(); expect(run.fetcher).toHaveBeenCalledTimes(500);
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    try {
      const fresh = createRehearsalIO(run.manifest, TOKEN, run.journal, run.fetcher);
      now.mockReturnValue(600_001); await expect(fresh.transport.read([id])).rejects.toThrow();
      expect(run.fetcher).toHaveBeenCalledTimes(500);
    } finally { now.mockRestore(); }
  });
});

describe("new orchestration, with an offline atomic provider fixture", () => {
  // Runs nine generated-file/HTTP/orchestration paths; whole-suite parallel load can exceed 5 seconds.
  it("exercises all barriers/injections without replay, verifies actual adapter receipts and removes only owned targets", async () => {
    const { manifest, store, io, journal, events, fetcher } = await setup();
    const result = await runCleanupRehearsal(manifest, io, journal);
    expect(result.cases).toHaveLength(9); expect(result.hosted).toBe(false); expect(result.activation).toBe(false);
    expect(store.docs.size).toBe(0); expect(result.ownedTargetsAbsent).toBe(55);
    expect(result.cases.every(row => row.wireDeletionRequests === 1 && row.logicalDeletionCalls === 1)).toBe(true);
    expect(result.cases.at(-1)).toMatchObject({ sameRevisionBarrier: true });
    expect(events.filter(row => row.kind === "committed-result-hidden-locally")).toHaveLength(2);
    expect(events.filter(row => row.kind === "held-request-released-once")).toHaveLength(1);
    expect(fetcher.mock.calls.every(([url, init]) => new URL(String(url)).origin === "https://example123.api.sanity.io" && init?.redirect === "error")).toBe(true);
    expect(result.requests).toBeLessThanOrEqual(500); expect(result.writes).toBeLessThanOrEqual(150);
  }, 30_000);
  it("refuses any foreign content, existing cursor or regenerated-byte mismatch before the first write", async () => {
    for (const kind of ["foreign", "cursor", "changed-fixture"]) {
      const run = await setup();
      if (kind === "changed-fixture") run.manifest.cases[0].image.sha256 = "0".repeat(64);
      else run.store.put({ _id: kind === "cursor" ? FIXED_CURSOR_ID : "foreign", _type: kind === "cursor" ? "clientGalleryCleanupCursor" : "article" });
      await expect(runCleanupRehearsal(run.manifest, run.io, run.journal)).rejects.toThrow();
      expect(run.fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    }
  });
  it("stops destructive work and automatic teardown when a foreign writer appears mid-run", async () => {
    const run = await setup(), first = run.manifest.cases[0];
    const wrapped = { ...run.io, async upload(...args: Parameters<typeof run.io.upload>) { await run.io.upload(...args); if (args[1] === "zip") run.store.put({ _id: "foreign", _type: "article" }); } };
    await expect(runCleanupRehearsal(run.manifest, wrapped, run.journal)).rejects.toThrow("foreign_content");
    expect(run.store.docs.has("foreign")).toBe(true); expect(run.store.docs.has(first.image.id)).toBe(true);
    expect(run.fetcher.mock.calls.some(([, init]) => String(init?.body).includes('"delete"'))).toBe(false);
  });
  it("prepare admits only a complete provider-system inventory and never mutates it", async () => {
    const run = await setup(); run.store.put({ _id: "system.retention", _type: "system.retention" });
    expect(await rehearsalBaseline(run.io.transport)).toEqual([{ id: "system.retention", type: "system.retention", revision: "r1" }]);
    run.store.put({ _id: "customer", _type: "article" }); await expect(rehearsalBaseline(run.io.transport)).rejects.toThrow("dataset_not_empty");
    expect(run.fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
  it("keeps live discovery outside the deterministic default suite and disables ambient dotenv loading", () => {
    const config = readFileSync(new URL("../vitest.config.mts", import.meta.url), "utf8");
    expect(config).toContain('"scripts/client-gallery-cleanup-rehearsal.live.test.mts"');
    const live = readFileSync(new URL("../vitest.cleanup-rehearsal.config.mts", import.meta.url), "utf8");
    expect(live).toContain("envDir: false"); expect(live).toContain("retry: 0");
  });
  // A fresh child proves default/CI refusal before credentials, Git inspection or any provider IO.
  it("refuses the actual live entry point without local opt-in, with no inherited credentials", () => {
    const child = spawnSync(process.execPath, [fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url)), "run", "--config", "vitest.cleanup-rehearsal.config.mts"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)), env: { PATH: process.env.PATH, NODE_ENV: "test", CI: "1" }, encoding: "utf8", timeout: 15_000, maxBuffer: 128 * 1024,
    });
    expect(child.status).toBe(1); expect(child.stdout + child.stderr).toContain("explicit_local_opt_in_required");
    expect(child.stdout + child.stderr).not.toContain(TOKEN);
  }, 20_000);
});
