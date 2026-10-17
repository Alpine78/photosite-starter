/** Two exact private audit artifacts; no generic remote writer or archive extraction. */
import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdir, open, readdir, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { privateZipDirectory, sameZipFile, zipArtifactIgnored } from "./delivery-zip-build-files.mts";
import { failJpeg, jpegAbortCode } from "./jpeg-export-audit.mts";
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export async function writeJpegAuditArtifacts(folder: string, report: { manifest: string; receipt: unknown }, verifyInputs: () => Promise<void>, signal?: AbortSignal) {
  const target = path.resolve(folder), parent = path.dirname(target), parentIdentity = await privateZipDirectory(parent);
  const bodies = [["entries.tsv", Buffer.from(report.manifest)], ["receipt.json", Buffer.from(JSON.stringify(report.receipt, null, 2) + "\n")]] as const;
  for (const [name, bytes] of bodies) { if (!bytes.length || bytes.length > 256_000) failJpeg("REPORT_LIMIT"); await zipArtifactIgnored(path.join(target, name), parent); }
  await mkdir(target, { mode: 0o700 });
  let directory: BigIntStats | undefined;
  const own: { file: string; identity: BigIntStats; sealed?: BigIntStats; body: Buffer }[] = [];
  async function unchanged() {
    const now = await privateZipDirectory(target), currentParent = await privateZipDirectory(parent);
    if (!directory || now.dev !== directory.dev || now.ino !== directory.ino || currentParent.dev !== parentIdentity.dev || currentParent.ino !== parentIdentity.ino) failJpeg("OUTPUT_CHANGED");
    if (signal?.aborted) failJpeg(jpegAbortCode(signal));
  }
  async function verifyOutputs() {
    await unchanged();
    if ((await readdir(target)).sort().join("\n") !== own.map(item => path.basename(item.file)).sort().join("\n")) failJpeg("OUTPUT_CHANGED");
    for (const item of own) {
      const fd = await open(item.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const stat = await fd.stat({ bigint: true });
        if (!item.sealed || !sameZipFile(item.sealed, stat) || !sameZipFile(stat, await lstat(item.file, { bigint: true }))) failJpeg("OUTPUT_CHANGED");
        const buffer = Buffer.alloc(item.body.length + 1); let length = 0;
        while (length < buffer.length) { const part = await fd.read(buffer, length, Math.min(65_536, buffer.length - length), length); length += part.bytesRead; if (!part.bytesRead) break; }
        if (length !== item.body.length || digest(buffer.subarray(0, length)) !== digest(item.body) || !sameZipFile(stat, await fd.stat({ bigint: true }))) failJpeg("OUTPUT_CHANGED");
        await zipArtifactIgnored(item.file, target);
      } finally { await fd.close(); }
    }
  }
  try {
    directory = await lstat(target, { bigint: true }); await unchanged(); await verifyInputs();
    for (const [name, body] of bodies) {
      await unchanged(); await verifyInputs(); const file = path.join(target, name);
      const fd = await open(file, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        const identity = await fd.stat({ bigint: true }), item = { file, identity, body, sealed: undefined as BigIntStats | undefined }; own.push(item);
        if (!identity.isFile() || identity.uid !== BigInt(process.getuid!()) || identity.nlink !== BigInt(1) || (identity.mode & BigInt(0o777)) !== BigInt(0o600)) failJpeg("OUTPUT_CHANGED");
        for (let at = 0; at < body.length;) { await unchanged(); const { bytesWritten } = await fd.write(body, at, Math.min(65_536, body.length - at), at); if (!bytesWritten) failJpeg("OUTPUT_WRITE_FAILED"); at += bytesWritten; }
        await fd.sync(); item.sealed = await fd.stat({ bigint: true });
        if (item.sealed.dev !== identity.dev || item.sealed.ino !== identity.ino || item.sealed.uid !== identity.uid || item.sealed.mode !== identity.mode || item.sealed.nlink !== BigInt(1) || item.sealed.size !== BigInt(body.length)) failJpeg("OUTPUT_CHANGED");
      } finally { await fd.close(); }
      await verifyOutputs(); await verifyInputs();
    }
    const dir = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW); try { await dir.sync(); } finally { await dir.close(); }
    await verifyOutputs(); await verifyInputs(); await unchanged();
  } catch (error) {
    const now = await lstat(target, { bigint: true }).catch(() => undefined);
    if (directory && now?.isDirectory() && !now.isSymbolicLink() && now.dev === directory.dev && now.ino === directory.ino) {
      for (const item of own.reverse()) { const info = await lstat(item.file, { bigint: true }).catch(() => undefined); if (info?.isFile() && info.dev === item.identity.dev && info.ino === item.identity.ino) await unlink(item.file).catch(() => {}); }
      await rmdir(target).catch(() => {});
    }
    throw error;
  }
}
