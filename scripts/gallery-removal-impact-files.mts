/** One private report; no CMS, filesystem deletion plan or remote writer. */
import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdir, open, readdir, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { digest } from "./identity-retirement-reconciliation.mts";
import { privateZipDirectory, sameZipFile, zipArtifactIgnored } from "./delivery-zip-build-files.mts";
import { refuseRemoval, REMOVAL_LIMITS } from "./gallery-removal-impact.mts";
export async function writeRemovalImpactArtifact(folder: string, report: unknown, verifyInputs: () => Promise<void>, signal?: AbortSignal) {
  const body = Buffer.from(JSON.stringify(report, null, 2) + "\n");
  if (body.length > REMOVAL_LIMITS.reportBytes) refuseRemoval("REPORT_LIMIT");
  const target = path.resolve(folder), parent = path.dirname(target), file = path.join(target, "impact.json"), parentIdentity = await privateZipDirectory(parent);
  await zipArtifactIgnored(file, parent); await mkdir(target, { mode: 0o700 });
  let directory: BigIntStats | undefined, identity: BigIntStats | undefined;
  async function unchanged() {
    const now = await privateZipDirectory(target), currentParent = await privateZipDirectory(parent);
    if (!directory || now.dev !== directory.dev || now.ino !== directory.ino || currentParent.dev !== parentIdentity.dev || currentParent.ino !== parentIdentity.ino) refuseRemoval("OUTPUT_CHANGED");
    if (signal?.aborted) refuseRemoval("INTERRUPTED");
  }
  try {
    directory = await lstat(target, { bigint: true }); await unchanged(); await verifyInputs();
    const fd = await open(file, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      identity = await fd.stat({ bigint: true });
      if (!identity.isFile() || identity.uid !== BigInt(process.getuid!()) || identity.nlink !== BigInt(1) || (identity.mode & BigInt(0o777)) !== BigInt(0o600)) refuseRemoval("OUTPUT_CHANGED");
      for (let at = 0; at < body.length;) { await unchanged(); const { bytesWritten } = await fd.write(body, at, Math.min(65_536, body.length - at), at); if (!bytesWritten) refuseRemoval("OUTPUT_WRITE_FAILED"); at += bytesWritten; }
      await fd.sync(); const sealed = await fd.stat({ bigint: true });
      if (sealed.dev !== identity.dev || sealed.ino !== identity.ino || sealed.size !== BigInt(body.length) || sealed.uid !== identity.uid || sealed.mode !== identity.mode || sealed.nlink !== BigInt(1)) refuseRemoval("OUTPUT_CHANGED");
      const bytes = Buffer.alloc(body.length + 1); let read = 0;
      while (read < bytes.length) { const part = await fd.read(bytes, read, Math.min(65_536, bytes.length - read), read); read += part.bytesRead; if (!part.bytesRead) break; }
      if (read !== body.length || digest(bytes.subarray(0, read)) !== digest(body) || !sameZipFile(sealed, await fd.stat({ bigint: true })) || !sameZipFile(sealed, await lstat(file, { bigint: true }))) refuseRemoval("OUTPUT_CHANGED");
      await verifyInputs(); await unchanged(); await zipArtifactIgnored(file, target);
      if ((await readdir(target)).join("\n") !== "impact.json") refuseRemoval("OUTPUT_CHANGED");
      const root = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW); try { await root.sync(); } finally { await root.close(); }
      await verifyInputs(); await unchanged();
      if (!sameZipFile(sealed, await fd.stat({ bigint: true })) || !sameZipFile(sealed, await lstat(file, { bigint: true }))) refuseRemoval("OUTPUT_CHANGED");
    } finally { await fd.close(); }
  } catch (error) {
    const now = await lstat(target, { bigint: true }).catch(() => undefined);
    if (directory && now?.isDirectory() && !now.isSymbolicLink() && now.dev === directory.dev && now.ino === directory.ino) {
      const current = await lstat(file, { bigint: true }).catch(() => undefined);
      if (identity && current?.isFile() && current.dev === identity.dev && current.ino === identity.ino) await unlink(file).catch(() => {});
      await rmdir(target).catch(() => {});
    }
    throw error;
  }
}
