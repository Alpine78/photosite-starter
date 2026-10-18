/** Exclusive owner-private artifacts. No recursive cleanup or external delivery. */
import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdir, open, readdir, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { privateZipDirectory, sameZipFile, zipArtifactIgnored } from "./delivery-zip-build-files.mts";
import { imageDigest, imageFailure } from "./client-web-image-preparation.mts";
import { WEB_BATCH_LIMITS } from "./client-web-image-batch.mts";

type Artifact = { file: string; identity: BigIntStats; sealed?: BigIntStats; digest?: string };
export async function createWebBatchOutput(folder: string, signal?: AbortSignal) {
  const target = path.resolve(folder), parent = path.dirname(target), parentIdentity = await privateZipDirectory(parent);
  await zipArtifactIgnored(path.join(target, "receipt.json"), parent);
  await mkdir(target, { mode: 0o700 }); // Exclusive: an existing or concurrent output is never reused.
  let directory: BigIntStats | undefined; const artifacts: Artifact[] = [];
  const interrupted = () => { if (signal?.aborted) imageFailure("INTERRUPTED"); };
  async function directoryUnchanged() {
    const info = await privateZipDirectory(target), currentParent = await privateZipDirectory(parent);
    if (!directory || info.dev !== directory.dev || info.ino !== directory.ino || currentParent.dev !== parentIdentity.dev || currentParent.ino !== parentIdentity.ino) imageFailure("OUTPUT_CHANGED");
    interrupted();
  }
  async function check() {
    await directoryUnchanged();
    if ((await readdir(target)).sort().join("\n") !== artifacts.map(a => path.basename(a.file)).sort().join("\n")) imageFailure("OUTPUT_CHANGED");
    for (const artifact of artifacts) {
      const handle = await open(artifact.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const before = await handle.stat({ bigint: true });
        if (!artifact.sealed || !sameZipFile(artifact.sealed, before) || !sameZipFile(before, await lstat(artifact.file, { bigint: true }))) imageFailure("OUTPUT_CHANGED");
        const bytes = Buffer.alloc(Number(before.size) + 1); let length = 0;
        while (length < bytes.length) {
          const result = await handle.read(bytes, length, Math.min(WEB_BATCH_LIMITS.chunk, bytes.length - length), length);
          length += result.bytesRead; if (!result.bytesRead) break;
        }
        if (length !== Number(before.size) || imageDigest(bytes.subarray(0, length)) !== artifact.digest || !sameZipFile(before, await handle.stat({ bigint: true }))) imageFailure("OUTPUT_CHANGED");
        await zipArtifactIgnored(artifact.file, target); await directoryUnchanged();
      } finally { await handle.close(); }
    }
  }
  async function write(name: string, bytes: Uint8Array) {
    if (!/^(?:image-\d{4}\.(?:jpg|png|webp|avif)|receipt\.json)$/u.test(name) || bytes.byteLength < 1 || bytes.byteLength > 25_000_000) imageFailure("OUTPUT_CONTRACT_FAILED");
    await directoryUnchanged(); const file = path.join(target, name); await zipArtifactIgnored(file, target);
    const handle = await open(file, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      const identity = await handle.stat({ bigint: true }), artifact: Artifact = { file, identity }; artifacts.push(artifact);
      if (!identity.isFile() || identity.uid !== BigInt(process.getuid!()) || identity.nlink !== BigInt(1) || (identity.mode & BigInt(0o777)) !== BigInt(0o600)) imageFailure("OUTPUT_CHANGED");
      for (let at = 0; at < bytes.byteLength;) {
        interrupted(); const count = Math.min(WEB_BATCH_LIMITS.chunk, bytes.byteLength - at);
        const { bytesWritten } = await handle.write(bytes, at, count, at); if (!bytesWritten) imageFailure("OUTPUT_WRITE_FAILED"); at += bytesWritten;
      }
      await handle.sync(); artifact.sealed = await handle.stat({ bigint: true }); artifact.digest = imageDigest(bytes);
      if (artifact.sealed.size !== BigInt(bytes.byteLength) || artifact.sealed.dev !== identity.dev || artifact.sealed.ino !== identity.ino || artifact.sealed.uid !== identity.uid || artifact.sealed.mode !== identity.mode || artifact.sealed.nlink !== BigInt(1)) imageFailure("OUTPUT_CHANGED");
      await directoryUnchanged();
    } finally { await handle.close(); }
  }
  async function abort() {
    const current = await lstat(target, { bigint: true }).catch(() => undefined);
    if (!directory || !current?.isDirectory() || current.isSymbolicLink() || current.dev !== directory.dev || current.ino !== directory.ino) return;
    for (const artifact of [...artifacts].reverse()) {
      const info = await lstat(artifact.file, { bigint: true }).catch(() => undefined);
      if (info?.isFile() && info.dev === artifact.identity.dev && info.ino === artifact.identity.ino) await unlink(artifact.file).catch(() => {});
    }
    await rmdir(target).catch(() => {}); // Unrelated or replaced data is retained.
  }
  try {
    directory = await lstat(target, { bigint: true }); await directoryUnchanged();
    return { write, check, abort, async finish(receipt: unknown, verifySources: () => Promise<void>) {
      await check(); await verifySources(); interrupted();
      await write("receipt.json", Buffer.from(JSON.stringify(receipt, null, 2) + "\n"));
      await check(); await verifySources(); interrupted();
      const fd = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { await fd.sync(); } finally { await fd.close(); }
      interrupted();
    } };
  } catch (error) { await abort(); throw error; }
}
