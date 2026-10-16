import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

const inspection = vi.hoisted(() => ({ enabled: false, mutate: false, chunks: [] as number[] }));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, open: async (...args: Parameters<typeof actual.open>) => {
    const fd = await actual.open(...args);
    const file = String(args[0]);
    if (!file.endsWith("delivery.zip")) return fd;
    return new Proxy(fd, { get(target, key) {
      if (key === "stat") return async () => {
        const before = await target.stat();
        if (inspection.mutate) { inspection.mutate = false; await actual.appendFile(file, "changed-during-read"); }
        return before;
      };
      if (key === "createReadStream") return (options: Parameters<typeof target.createReadStream>[0]) => {
        const stream = target.createReadStream(options);
        return { async *[Symbol.asyncIterator]() {
          for await (const chunk of stream) {
            if (inspection.enabled) inspection.chunks.push(chunk.length);
            yield chunk;
          }
        } };
      };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
  } };
});
import { runPrivateUploadSourcePlanner } from "./plan-private-gallery-upload.mts";
import { runPrivateSourceVerification } from "./verify-private-gallery-sources.mts";

let root: string, sourceRoot: string, plan: string, expectedDigest: string;
beforeEach(async () => {
  inspection.enabled = false; inspection.mutate = false; inspection.chunks = [];
  root = await mkdtemp(path.join(tmpdir(), "photosite-source-streaming-")); await chmod(root, 0o700);
  sourceRoot = path.join(root, "sources"); await mkdir(sourceRoot, { mode: 0o700 });
  await writeFile(path.join(sourceRoot, "preview.JPG"), await sharp({ create: { width: 12, height: 8, channels: 3, background: "#777777" } }).jpeg().toBuffer());
  const bytes = Buffer.alloc(2 * 1024 * 1024 + 7); bytes.writeUInt32BE(0x504b0304);
  await writeFile(path.join(sourceRoot, "delivery.zip"), bytes);
  const input = path.join(root, "input.json");
  await writeFile(input, JSON.stringify({ mode: "delivery", images: [{ relativePath: "preview.JPG" }], zipPath: "delivery.zip" }), { mode: 0o600 });
  const report = await runPrivateUploadSourcePlanner({ input, sourceRoot, out: path.join(root, "plans") });
  plan = path.join(root, "plans/upload-source-plan.json"); expectedDigest = report.digest;
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
describe("real bounded source stream", () => {
  it("hashes a ZIP in bounded chunks rather than buffering the complete object", async () => {
    inspection.enabled = true;
    expect(await runPrivateSourceVerification({ plan, sourceRoot, expectedDigest })).toMatchObject({ objects: 2 });
    expect(inspection.chunks.length).toBeGreaterThan(1);
    expect(Math.max(...inspection.chunks)).toBeLessThanOrEqual(1024 * 1024);
    expect(inspection.chunks.reduce((a, b) => a + b, 0)).toBe(2 * 1024 * 1024 + 7);
  });
  it("refuses bytes changed between the open-file stat and the actual read", async () => {
    inspection.mutate = true;
    await expect(runPrivateSourceVerification({ plan, sourceRoot, expectedDigest })).rejects.toMatchObject({ code: "SOURCE_CHANGED", ordinal: 2 });
    expect(inspection.mutate).toBe(false);
  });
});
