import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmod, lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { buildWholeDeliveryZip } from "./delivery-zip-build.mts";
import { runZipAttachment } from "./attach-client-gallery-zip.mts";
import { zipField } from "./client-gallery-zip-attachment.mts";
import * as privateFiles from "./delivery-zip-build-files.mts";
const folders: string[] = [];
const unexpectedNetwork = vi.fn(() => { throw new Error("external-network-forbidden"); });
beforeEach(() => { unexpectedNetwork.mockClear(); vi.stubGlobal("fetch", unexpectedNetwork); });
afterEach(async () => { expect(unexpectedNetwork).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.restoreAllMocks(); await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))); });
async function fixture() {
  const folder = await mkdtemp(path.join(tmpdir(), "gallery-zip-operator-")); folders.push(folder); await chmod(folder, 0o700);
  const jpeg = await sharp({ create: { width: 8, height: 6, channels: 3, background: "#617583" } }).jpeg().toBuffer();
  const chunks: Buffer[] = [];
  await buildWholeDeliveryZip([{ size: jpeg.length, read: async (at, length) => jpeg.subarray(at, at + length), unchanged: async () => {} }], { write: async bytes => { chunks.push(Buffer.from(bytes)); } });
  const archive = Buffer.concat(chunks), sha1 = createHash("sha1").update(archive).digest("hex"), assetId = `file-${sha1}-zip`;
  const input = { target: { projectId: "fixture1", dataset: "production", apiVersion: "v2026-01-01" }, galleryId: "synthetic", expectedDraftRevision: "before", expectedExistingZip: null as string | null, assetId: assetId as string | null, classification: "processed-jpeg-exports", exportsDirectory: folder, selectionFile: path.join(folder, "selection.tsv"), archiveFile: path.join(folder, "delivery.zip") };
  await writeFile(path.join(folder, "selected.jpg"), jpeg, { mode: 0o600 });
  await writeFile(input.selectionFile, "processed-jpeg-selection-v1\nselected.jpg\n", { mode: 0o600 });
  await writeFile(input.archiveFile, archive, { mode: 0o600 });
  const inputFile = path.join(folder, "input.json"); await writeFile(inputFile, JSON.stringify(input), { mode: 0o600 });
  const asset: Record<string, unknown> = { _id: assetId, _type: "sanity.fileAsset", _rev: "asset-before", sha1hash: sha1, extension: "zip", mimeType: "application/zip", originalFilename: "delivery.zip", size: archive.length };
  let document: Record<string, unknown> = { _id: "drafts.synthetic", _type: "clientDeliveryGallery", _rev: "before", title: [{ language: "en", value: "Synthetic" }], items: [], available: false };
  const calls: { url: string; init?: RequestInit }[] = [];
  let mutate: ((init: RequestInit) => Promise<Response>) | undefined;
  let beforeRead: (() => Promise<void>) | undefined;
  const fetcher: typeof fetch = async (url, init) => {
    const value = String(url); calls.push({ url: value, init });
    if (value.startsWith("https://cdn.sanity.io/")) {
      expect(new Headers(init?.headers).has("authorization")).toBe(false); expect(init?.credentials).toBe("omit"); expect(init?.redirect).toBe("manual");
      expect(value).toBe(`https://cdn.sanity.io/files/fixture1/production/${sha1}.zip?dl=photographs.zip`);
      return new Response(archive, { headers: { "content-type": "application/zip", "content-length": String(archive.length), "content-disposition": 'attachment; filename="photographs.zip"' } });
    }
    expect(value.startsWith("https://fixture1.api.sanity.io/v2026-01-01/data/")).toBe(true);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer synthetic-token"); expect(init?.credentials).toBe("omit");
    if (init?.method === "POST") {
      expect(value).toBe("https://fixture1.api.sanity.io/v2026-01-01/data/mutate/production?returnIds=true&visibility=sync");
      if (mutate) return mutate(init);
      apply(init); return Response.json({ transactionId: "synthetic-transaction", results: [{ documentId: "drafts.synthetic", operation: "update" }] });
    }
    expect(init?.method).toBe("GET"); await beforeRead?.();
    return Response.json({ documents: [value.includes(encodeURIComponent(assetId)) ? asset : document] });
  };
  function apply(init: RequestInit) {
    const body = JSON.parse(String(init.body)); expect(Object.keys(body)).toEqual(["mutations"]); expect(body.mutations).toHaveLength(1);
    const patch = body.mutations[0].patch; expect(patch.id).toBe("drafts.synthetic"); expect(patch.ifRevisionID).toBe("before");
    if (patch.set) document = { ...document, ...patch.set, _rev: "after" };
    else { expect(patch.unset).toEqual(["deliveryZip"]); document = { ...document, _rev: "after" }; delete document.deliveryZip; }
  }
  // Output must be outside the source tree. A sibling private temporary parent keeps it private.
  const evidence = await mkdtemp(path.join(tmpdir(), "gallery-zip-evidence-")); folders.push(evidence); await chmod(evidence, 0o700);
  let out = 0;
  const options = (approvedDigest?: string) => ({ input: inputFile, output: path.join(evidence, `run-${++out}`), apply: approvedDigest !== undefined, approvedDigest });
  const dependencies = { environment: { SANITY_MIGRATION_TOKEN: "synthetic-token" }, fetchImplementation: fetcher };
  return { folder, input, inputFile, asset, calls, options, dependencies, apply,
    setDocument(value: Record<string, unknown>) { document = value; }, document: () => document,
    setMutate(fn: typeof mutate) { mutate = fn; }, setBeforeRead(fn: typeof beforeRead) { beforeRead = fn; },
    async saveInput(value: unknown = input) { await writeFile(inputFile, JSON.stringify(value), { mode: 0o600 }); } };
}
// These tests perform real Sharp JPEG decode, ZIP integrity and guarded filesystem IO.
const timeout = 30_000;
describe("guarded ZIP attach operator with local files and fake provider", () => {
  it("dry-runs real JPEG/metadata/ZIP/full anonymous CDN audits and private deterministic evidence without POST", async () => {
    const f = await fixture(), options = f.options(); const result = await runZipAttachment(options, f.dependencies);
    expect(result).toMatchObject({ state: "dry-run", counts: { images: 1, zip: 1 }, mutations: 0 });
    expect(f.calls.every(call => call.init?.method !== "POST")).toBe(true);
    expect((await lstat(options.output)).mode & 0o777).toBe(0o700);
    for (const name of await readdir(options.output)) expect((await lstat(path.join(options.output, name))).mode & 0o777).toBe(0o600);
    const decoded = JSON.parse(await readFile(path.join(options.output, "decoded.json"), "utf8")); expect(decoded.status).toBe("decoded-selected-jpegs-offline");
    expect(JSON.parse(await readFile(path.join(options.output, "metadata.json"), "utf8")).checks.metadataSuitability).toBe("unproven-even-with-zero-counts");
    expect(await readFile(path.join(options.output, "plan.json"), "utf8")).not.toContain("synthetic-token");
    expect((await runZipAttachment(f.options(), f.dependencies)).digest).toBe(result.digest);
  }, timeout);
  it("applies one CAS draft patch after persisted intent and fresh reads; never uploads or publishes", async () => {
    const f = await fixture(), plan = await runZipAttachment(f.options(), f.dependencies), options = f.options(plan.digest);
    f.setMutate(async init => {
      expect(JSON.parse(await readFile(path.join(options.output, "intent.json"), "utf8")).digest).toBe(plan.digest);
      f.apply(init); return Response.json({ transactionId: "synthetic" });
    });
    expect(await runZipAttachment(options, f.dependencies)).toMatchObject({ state: "observed", writeStatus: "accepted", mutations: 1 });
    expect(f.document().deliveryZip).toEqual(zipField(f.input.assetId!));
    expect(f.calls.filter(call => call.init?.method === "POST")).toHaveLength(1);
    expect(f.calls.every(call => !/\/assets\/|\/actions\/|\/data\/query\//u.test(call.url))).toBe(true);
  }, timeout);
  it.each([403, 409])("does not retry after HTTP %s and retains independent readback/intent", async status => {
    const f = await fixture(), plan = await runZipAttachment(f.options(), f.dependencies);
    f.setMutate(async () => new Response("raw-provider-secret-and-token", { status }));
    const result = await runZipAttachment(f.options(plan.digest), f.dependencies);
    expect(result).toMatchObject({ state: "not-observed", writeStatus: status === 409 ? "conflict" : "rejected", lateCommitPossible: true });
    expect(JSON.stringify(result)).not.toContain("raw-provider"); expect(f.calls.filter(call => call.init?.method === "POST")).toHaveLength(1);
  }, timeout);
  it.each(["applied", "unchanged", "ambiguous"])("reconciles lost write response %s without replay", async outcome => {
    const f = await fixture(), plan = await runZipAttachment(f.options(), f.dependencies);
    f.setMutate(async init => { if (outcome !== "unchanged") f.apply(init); if (outcome === "ambiguous") f.setDocument({ ...f.document(), title: ["concurrent-change"] }); throw new Error("provider-private-body"); });
    const result = await runZipAttachment(f.options(plan.digest), f.dependencies);
    expect(result.state).toBe(outcome === "applied" ? "observed" : outcome === "unchanged" ? "not-observed" : "uncertain");
    expect(f.calls.filter(call => call.init?.method === "POST")).toHaveLength(1);
  }, timeout);
  it("gives readback a fresh signal after cancellation during a committed write", async () => {
    const f = await fixture(), plan = await runZipAttachment(f.options(), f.dependencies), controller = new AbortController();
    f.setMutate(async init => { f.apply(init); controller.abort(); throw new DOMException("cancelled", "AbortError"); });
    const dependencies = { ...f.dependencies, signal: controller.signal };
    expect(await runZipAttachment(f.options(plan.digest), dependencies)).toMatchObject({ state: "observed" });
    expect(f.calls.at(-1)?.init?.signal?.aborted).toBe(false);
  }, timeout);
  it("supports exact replacement then explicit source-free detach", async () => {
    const f = await fixture(), old = `file-${"b".repeat(40)}-zip`;
    f.input.expectedExistingZip = old; f.setDocument({ ...f.document(), deliveryZip: zipField(old) }); await f.saveInput();
    const replace = await runZipAttachment(f.options(), f.dependencies);
    expect(await runZipAttachment(f.options(replace.digest), f.dependencies)).toMatchObject({ state: "observed" });
    const detach = { target: f.input.target, galleryId: f.input.galleryId, expectedDraftRevision: "after", expectedExistingZip: f.input.assetId, assetId: null };
    await f.saveInput(detach); f.setDocument({ ...f.document(), _rev: "after" });
    const plan = await runZipAttachment(f.options(), f.dependencies); f.calls.splice(0);
    f.setMutate(async init => { const patch = JSON.parse(String(init.body)).mutations[0].patch; expect(patch).toEqual({ id: "drafts.synthetic", ifRevisionID: "after", unset: ["deliveryZip"] }); const doc: Record<string, unknown> = { ...f.document(), _rev: "detached" }; delete doc.deliveryZip; f.setDocument(doc); return Response.json({ transactionId: "detach" }); });
    expect(await runZipAttachment(f.options(plan.digest), f.dependencies)).toMatchObject({ state: "observed", counts: { images: 0, zip: 0 } });
    expect(f.calls.some(call => call.url.includes("cdn.sanity.io"))).toBe(false);
  }, timeout);
  it.each(["digest", "source", "asset", "revision", "old-ref"])("refuses %s drift before mutation", async kind => {
    const f = await fixture(), plan = await runZipAttachment(f.options(), f.dependencies);
    if (kind === "source") await writeFile(path.join(f.folder, "selected.jpg"), Buffer.from("changed"));
    if (kind === "asset") f.asset._rev = "changed";
    if (kind === "revision") f.setDocument({ ...f.document(), _rev: "changed" });
    if (kind === "old-ref") f.setDocument({ ...f.document(), deliveryZip: zipField(`file-${"b".repeat(40)}-zip`) });
    await expect(runZipAttachment(f.options(kind === "digest" ? "0".repeat(64) : plan.digest), f.dependencies)).rejects.toThrow();
    expect(f.calls.filter(call => call.init?.method === "POST")).toHaveLength(0);
  }, timeout);
  it("stops remaining sequential file guards when cancellation arrives inside one guard", async () => {
    const f = await fixture(), controller = new AbortController(), checked: string[] = [];
    const original = privateFiles.openZipBuildInput;
    vi.spyOn(privateFiles, "openZipBuildInput").mockImplementation(async (filename, maximum) => {
      const input = await original(filename, maximum);
      return { ...input, async unchanged() {
        checked.push(filename); if (filename === f.inputFile) controller.abort(); await input.unchanged();
      } };
    });
    await expect(runZipAttachment(f.options(), { ...f.dependencies, signal: controller.signal })).rejects.toThrow("CANCELLED_OR_DEADLINE");
    expect(checked).toEqual([f.inputFile]); expect(f.calls).toHaveLength(0);
  }, timeout);
  it("refuses file changes during the last fresh-read window", async () => {
    const f = await fixture(), plan = await runZipAttachment(f.options(), f.dependencies); let reads = 0;
    f.setBeforeRead(async () => { if (++reads === 3) await writeFile(path.join(f.folder, "selected.jpg"), Buffer.from("changed")); });
    await expect(runZipAttachment(f.options(plan.digest), f.dependencies)).rejects.toThrow();
    expect(f.calls.some(call => call.init?.method === "POST")).toBe(false);
  }, timeout);
  it("refuses private review-bundle tampering before any mutation", async () => {
    const f = await fixture(), plan = await runZipAttachment(f.options(), f.dependencies), options = f.options(plan.digest); let reads = 0;
    f.setBeforeRead(async () => { if (++reads === 3) await writeFile(path.join(options.output, "plan.json"), "tampered-review-evidence"); });
    await expect(runZipAttachment(options, f.dependencies)).rejects.toThrow();
    expect(f.calls.some(call => call.init?.method === "POST")).toBe(false);
  }, timeout);
  it.each(["mode", "symlink", "duplicate-json", "public-token"])("rejects unsafe %s without provider write", async kind => {
    const f = await fixture();
    if (kind === "mode") await chmod(f.inputFile, 0o644);
    if (kind === "symlink") { await rm(f.inputFile); await symlink(f.input.selectionFile, f.inputFile); }
    if (kind === "duplicate-json") await writeFile(f.inputFile, '{"assetId":null,"assetId":null}');
    const environment = kind === "public-token" ? { ...f.dependencies.environment, NEXT_PUBLIC_SANITY_MIGRATION_TOKEN: "never-print" } : f.dependencies.environment;
    await expect(runZipAttachment(f.options(), { ...f.dependencies, environment })).rejects.toThrow(/\[client-gallery-zip\]/u);
    expect(f.calls).toHaveLength(0);
  }, timeout);
  it.each(["absent", "permission", "duplicate", "foreign"])("refuses incomplete/mismatched Doc envelope %s", async kind => {
    const f = await fixture();
    const fetcher: typeof fetch = async (url, init) => {
      if (String(url).includes("/data/doc/")) return Response.json(kind === "absent" ? { documents: [] } : kind === "permission" ? { documents: [], omitted: [{ id: "drafts.synthetic", reason: "permission" }] } : { documents: kind === "duplicate" ? [f.document(), f.document()] : [{ ...f.document(), _id: "drafts.foreign" }] });
      return f.dependencies.fetchImplementation(url, init);
    };
    await expect(runZipAttachment(f.options(), { ...f.dependencies, fetchImplementation: fetcher })).rejects.toThrow("DOCUMENT_UNAVAILABLE");
    expect(f.calls.some(call => call.init?.method === "POST")).toBe(false);
  }, timeout);
  it("refuses changed or non-neutral asset metadata at the final fresh-read boundary", async () => {
    const f = await fixture(), plan = await runZipAttachment(f.options(), f.dependencies); let reads = 0;
    f.setBeforeRead(async () => { if (++reads === 4) f.asset.originalFilename = "private-job-name.zip"; });
    await expect(runZipAttachment(f.options(plan.digest), f.dependencies)).rejects.toThrow("INVALID_ASSET");
    expect(f.calls.some(call => call.init?.method === "POST")).toBe(false);
  }, timeout);
  it("refuses remote bytes that differ from the audited whole archive", async () => {
    const f = await fixture();
    const fetcher: typeof fetch = async (url, init) => {
      if (String(url).startsWith("https://cdn.sanity.io/")) return new Response(Buffer.alloc(Number(f.asset.size)), { headers: { "content-type": "application/zip", "content-disposition": "attachment" } });
      return f.dependencies.fetchImplementation(url, init);
    };
    await expect(runZipAttachment(f.options(), { ...f.dependencies, fetchImplementation: fetcher })).rejects.toThrow("REMOTE_BYTES_UNVERIFIED");
    expect(f.calls.some(call => call.init?.method === "POST")).toBe(false);
  }, timeout);
  it("runs the native Node24 CLI with deterministic private fixtures and an offline fetch shim", async () => {
    const f = await fixture(), options = f.options(), loader = path.join(f.folder, "offline-loader.mjs");
    const script = `import {readFile} from "node:fs/promises";
const draft=${JSON.stringify(f.document())};
const asset=${JSON.stringify(f.asset)};
const archive=await readFile(${JSON.stringify(f.input.archiveFile)});
globalThis.fetch=async(url,init)=>{
if(init?.method!=="GET")throw Error("OFFLINE_WRITE_FORBIDDEN");
if(String(url).startsWith("https://cdn.sanity.io/")){if(new Headers(init?.headers).has("authorization")||init?.credentials!=="omit")throw Error("CDN_AUTH_FORBIDDEN");return new Response(archive,{headers:{"content-type":"application/zip","content-disposition":"attachment"}});}
if(!String(url).startsWith("https://fixture1.api.sanity.io/v2026-01-01/data/doc/production/"))throw Error("OFFLINE_ORIGIN_FORBIDDEN");
return Response.json({documents:[String(url).includes(asset._id)?asset:draft]});
};
`;
    await writeFile(loader, script, { mode: 0o600 });
    const { spawnSync } = await import("node:child_process");
    const child = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", loader, "scripts/attach-client-gallery-zip.mts", "--input", options.input, "--output", options.output], { encoding: "utf8", timeout: 20_000, env: { PATH: process.env.PATH, NODE_ENV: "test", SANITY_MIGRATION_TOKEN: "synthetic-token" } });
    expect(child.error).toBeUndefined(); expect(child.status).toBe(0); expect(child.stderr).toBe("");
    expect(JSON.parse(child.stdout)).toMatchObject({ state: "dry-run", counts: { images: 1, zip: 1 }, mutations: 0 });
    expect(child.stdout).not.toMatch(/synthetic-token|fixture1|drafts\.|\/private\//u);
  }, timeout);
  it("native CLI refuses invalid arguments before credential/file/network access", () => {
    try { execFileSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/attach-client-gallery-zip.mts", "--apply"], { encoding: "utf8", env: { PATH: process.env.PATH, NODE_ENV: "test" }, stdio: "pipe" }); throw new Error("expected refusal"); }
    catch (error) { expect((error as { stderr: string }).stderr).toContain("[client-gallery-zip] INVALID_ARGUMENTS"); }
  }, timeout);
});
