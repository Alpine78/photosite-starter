/** Sequential bounded ports; all bytes stay local and no JPEG is decoded or transformed. */
import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
import { ZIP_BUILD_LIMITS, ZipBuildError, refuseBuild, planWholeZip, zipLocalHeader, zipDescriptor, zipCentralHeader, zipEnd } from "./delivery-zip-build-plan.mts";
export type ZipSource = Readonly<{ size: number; read(position: number, length: number): Promise<Uint8Array>; unchanged(): Promise<void> }>;
export type ZipSink = Readonly<{ write(bytes: Uint8Array): Promise<void> }>;
export async function buildWholeDeliveryZip(sources: readonly ZipSource[], sink: ZipSink, options: { signal?: AbortSignal; timeoutMs?: number } = {}) {
  const plan = planWholeZip(sources.map(source => source.size)), limits = ZIP_BUILD_LIMITS;
  const timeout = options.timeoutMs ?? limits.timeoutMs;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > limits.timeoutMs) refuseBuild("INVALID_DEADLINE");
  const controller = new AbortController(), cancel = () => controller.abort();
  options.signal?.addEventListener("abort", cancel, { once: true }); if (options.signal?.aborted) cancel();
  const timer = setTimeout(cancel, timeout);
  async function bounded<T>(call: () => Promise<T>): Promise<T> {
    if (controller.signal.aborted) refuseBuild("CANCELLED");
    let cancelOperation!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      cancelOperation = () => reject(new ZipBuildError("CANCELLED"));
      controller.signal.addEventListener("abort", cancelOperation, { once: true });
    });
    try { return await Promise.race([Promise.resolve().then(() => {
      if (controller.signal.aborted) refuseBuild("CANCELLED");
      return call();
    }), aborted]); }
    finally { controller.signal.removeEventListener("abort", cancelOperation); }
  }
  let written = 0;
  const archiveHash = createHash("sha256"), rows = ["delivery-zip-v1"], crcs: number[] = [];
  async function append(bytes: Uint8Array) {
    if (bytes.length > limits.chunk || written + bytes.length > plan.archiveBytes) refuseBuild("WRITE_BUDGET");
    await bounded(() => sink.write(bytes)); archiveHash.update(bytes); written += bytes.length;
  }
  try {
    for (const source of sources) {
      const start = await bounded(() => source.read(0, 2)), end = await bounded(() => source.read(source.size - 2, 2));
      if (start.length !== 2 || end.length !== 2 || start[0] !== 0xff || start[1] !== 0xd8 || end[0] !== 0xff || end[1] !== 0xd9) refuseBuild("JPEG_STRUCTURE_REQUIRED");
      await bounded(() => source.unchanged());
    }
    for (const [index, source] of sources.entries()) {
      const entry = plan.entries[index], digest = createHash("sha256"); let crc = 0, tail = -1;
      await append(zipLocalHeader(entry));
      for (let at = 0; at < entry.size;) {
        const wanted = Math.min(limits.chunk, entry.size - at), supplied = await bounded(() => source.read(at, wanted));
        if (!(supplied instanceof Uint8Array) || supplied.byteLength !== wanted) refuseBuild("SOURCE_CHANGED");
        const bytes = Buffer.from(supplied);
        if (at === 0 && (bytes[0] !== 0xff || bytes[1] !== 0xd8)) refuseBuild("SOURCE_CHANGED");
        // Keep only the final two bytes, including a one-byte last chunk.
        for (const value of bytes.subarray(Math.max(0, bytes.length - 2))) tail = ((tail << 8) | value) & 0xffff;
        await append(bytes); digest.update(bytes); crc = crc32(bytes, crc); at += bytes.length;
      }
      if (tail !== 0xffd9 || (await bounded(() => source.read(entry.size, 1))).length !== 0) refuseBuild("SOURCE_CHANGED");
      await bounded(() => source.unchanged());
      crcs.push(crc); rows.push(`${entry.name}\t${entry.size}\t${digest.digest("hex")}`); await append(zipDescriptor(entry, crc));
    }
    for (const [index, entry] of plan.entries.entries()) await append(zipCentralHeader(entry, crcs[index]));
    await append(zipEnd(plan));
    if (written !== plan.archiveBytes) refuseBuild("WRITE_BUDGET");
    for (const source of sources) await bounded(() => source.unchanged());
    const manifest = rows.join("\n") + "\n";
    return { manifest, receipt: Object.freeze({ status: "built-whole-zip-offline", readyToUpload: false,
      classification: "owner-asserted-processed-jpeg-exports", entries: sources.length, archiveBytes: written,
      expandedBytes: plan.expandedBytes, archiveSha256: archiveHash.digest("hex"),
      manifestSha256: createHash("sha256").update(manifest).digest("hex"),
      checks: { zip: "constructed-zip32-store", sourceBytes: "copied-unchanged", jpegScreen: "soi-eoi-only",
        jpegDecoding: "unproven", processedExportClassification: "owner-asserted-not-verified", metadataSuitability: "unproven", manifestAuthority: "not-established", provider: "not-contacted" } }) };
  } catch (error) {
    if (error instanceof ZipBuildError) throw error;
    refuseBuild("LOCAL_IO_FAILED");
  } finally { clearTimeout(timer); options.signal?.removeEventListener("abort", cancel); }
}
