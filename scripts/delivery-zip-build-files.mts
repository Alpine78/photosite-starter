/** Owner-private filesystem ports; no HTTP, credentials or CMS adapter. */
import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdir, open, rmdir, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { refuseBuild, ZIP_BUILD_LIMITS } from "./delivery-zip-build-plan.mts";
const git = promisify(execFile), permission = BigInt(0o777), one = BigInt(1);
export function sameZipFile(a: BigIntStats, b: BigIntStats) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.uid === b.uid && a.gid === b.gid && a.mode === b.mode && a.nlink === b.nlink && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
async function noLinks(file: string) {
  for (let at = file;;) {
    if ((await lstat(at)).isSymbolicLink()) refuseBuild("PRIVATE_PATH_REQUIRED");
    const parent = path.dirname(at); if (parent === at) return; at = parent;
  }
}
export async function privateZipDirectory(folder: string) {
  if (!["linux", "darwin"].includes(process.platform) || !process.getuid) refuseBuild("PRIVATE_PERMISSIONS_UNSUPPORTED");
  const resolved = path.resolve(folder); await noLinks(resolved);
  const info = await lstat(resolved, { bigint: true });
  if (!info.isDirectory() || info.uid !== BigInt(process.getuid()) || (info.mode & permission) !== BigInt(0o700)) refuseBuild("PRIVATE_DIRECTORY_REQUIRED");
  return info;
}
export async function zipArtifactIgnored(file: string, existingDirectory: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: "C" }; for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
  const options = { env, maxBuffer: 4096, timeout: 10_000 }, base = ["-C", existingDirectory];
  try { await git("git", [...base, "rev-parse", "--show-toplevel"], options); }
  catch (error) {
    const e = error as { code?: number; stderr?: string };
    if (e.code === 128 && /^fatal: not a git repository(?: |$)/u.test(e.stderr ?? "")) return;
    refuseBuild("GIT_GUARD_FAILED");
  }
  // ls-files accepts literal pathspecs; check-ignore explicitly rejects that
  // global magic and already treats its absolute pathname arguments literally.
  try { await git("git", ["--literal-pathspecs", ...base, "ls-files", "--error-unmatch", "--", file], options); }
  catch (error) {
    if ((error as { code?: number }).code !== 1) refuseBuild("GIT_GUARD_FAILED");
    try { await git("git", [...base, "check-ignore", "--quiet", "--", file], options); return; }
    catch { refuseBuild("ARTIFACT_NOT_IGNORED"); }
  }
  refuseBuild("ARTIFACT_TRACKED");
}
export async function openZipBuildInput(filename: string, maximum: number) {
  const file = path.resolve(filename), parent = await privateZipDirectory(path.dirname(file)); await noLinks(file); await zipArtifactIgnored(file, path.dirname(file));
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.uid !== BigInt(process.getuid!()) || (before.mode & permission) !== BigInt(0o600) || before.nlink !== one || before.size < one || before.size > BigInt(maximum)) refuseBuild("PRIVATE_INPUT_REQUIRED");
    async function unchanged() {
      const after = await handle.stat({ bigint: true }), current = await lstat(file, { bigint: true }), nowParent = await privateZipDirectory(path.dirname(file));
      if (!sameZipFile(before, after) || !sameZipFile(before, current) || parent.dev !== nowParent.dev || parent.ino !== nowParent.ino) refuseBuild("SOURCE_CHANGED");
      await zipArtifactIgnored(file, path.dirname(file));
    }
    await unchanged();
    return { handle, before, size: Number(before.size), unchanged, async read(at: number, length: number) {
      if (!Number.isSafeInteger(at) || !Number.isSafeInteger(length) || at < 0 || length < 1 || length > ZIP_BUILD_LIMITS.chunk || at > Number(before.size) || (at === Number(before.size) && length !== 1)) refuseBuild("READ_LIMIT");
      const data = Buffer.allocUnsafe(length); let offset = 0;
      while (offset < length) { const result = await handle.read(data, offset, length - offset, at + offset); if (!result.bytesRead) break; offset += result.bytesRead; }
      return data.subarray(0, offset);
    } };
  } catch (error) { await handle.close(); throw error; }
}

type Artifact = { file: string; handle: Awaited<ReturnType<typeof open>>; identity: BigIntStats; size: number; sealed?: BigIntStats };
export async function createZipBuildOutput(folder: string) {
  const resolved = path.resolve(folder), parent = await privateZipDirectory(path.dirname(resolved));
  const names = ["delivery.zip", "entries.tsv", "receipt.json"] as const;
  for (const name of names) await zipArtifactIgnored(path.join(resolved, name), path.dirname(resolved));
  await mkdir(resolved, { mode: 0o700 }); // Exclusive, never recursive and never reuse existing evidence.
  let directory: BigIntStats | undefined; const artifacts: Artifact[] = [];
  async function directoryUnchanged() {
    const current = await privateZipDirectory(resolved), currentParent = await privateZipDirectory(path.dirname(resolved));
    if (!directory || current.dev !== directory.dev || current.ino !== directory.ino || currentParent.dev !== parent.dev || currentParent.ino !== parent.ino) refuseBuild("OUTPUT_CHANGED");
  }
  async function check() {
    await directoryUnchanged();
    for (const artifact of artifacts) {
      const fd = await artifact.handle.stat({ bigint: true }), current = await lstat(artifact.file, { bigint: true });
      if (!current.isFile() || current.dev !== artifact.identity.dev || current.ino !== artifact.identity.ino || current.uid !== BigInt(process.getuid!()) ||
          current.nlink !== one || (current.mode & permission) !== BigInt(0o600) || current.size !== BigInt(artifact.size) || !sameZipFile(fd, current) ||
          (artifact.sealed && !sameZipFile(artifact.sealed, current))) refuseBuild("OUTPUT_CHANGED");
      await zipArtifactIgnored(artifact.file, resolved);
    }
  }
  async function reserve(name: typeof names[number]) {
    await directoryUnchanged(); const file = path.join(resolved, name); await zipArtifactIgnored(file, resolved);
    const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    let identity: BigIntStats;
    try { identity = await handle.stat({ bigint: true }); }
    catch (error) { await handle.close(); throw error; }
    const artifact = { file, handle, identity, size: 0 }; artifacts.push(artifact);
    await check(); return artifact;
  }
  async function append(artifact: Artifact, input: Uint8Array) {
    if (input.byteLength > ZIP_BUILD_LIMITS.chunk || artifact.size + input.byteLength > ZIP_BUILD_LIMITS.archive) refuseBuild("WRITE_LIMIT");
    let offset = 0;
    while (offset < input.byteLength) { const { bytesWritten } = await artifact.handle.write(input, offset, input.byteLength - offset, artifact.size + offset); if (!bytesWritten) refuseBuild("WRITE_FAILED"); offset += bytesWritten; }
    artifact.size += input.byteLength;
  }
  async function seal(artifact: Artifact) { await artifact.handle.sync(); artifact.sealed = await artifact.handle.stat({ bigint: true }); await check(); }
  async function close() { await Promise.allSettled(artifacts.map(artifact => artifact.handle.close())); }
  async function abort() {
    await close();
    const current = await lstat(resolved, { bigint: true }).catch(() => undefined);
    if (!directory || !current?.isDirectory() || current.isSymbolicLink() || current.dev !== directory.dev || current.ino !== directory.ino) return;
    for (const artifact of [...artifacts].reverse()) {
      const file = await lstat(artifact.file, { bigint: true }).catch(() => undefined);
      if (file?.isFile() && file.dev === artifact.identity.dev && file.ino === artifact.identity.ino) await unlink(artifact.file).catch(() => {});
    }
    await rmdir(resolved).catch(() => {}); // Never recursive; unrelated or replaced files are preserved.
  }
  try {
    directory = await lstat(resolved, { bigint: true }); await privateZipDirectory(resolved);
    const zip = await reserve("delivery.zip");
    return { async write(bytes: Uint8Array) { await append(zip, bytes); }, check, close, abort,
      async finish(manifest: string, receipt: unknown, sourcesUnchanged: () => Promise<void>) {
        await seal(zip); const entries = await reserve("entries.tsv"); await append(entries, Buffer.from(manifest)); await seal(entries);
        await sourcesUnchanged(); await check();
        const report = await reserve("receipt.json"); await append(report, Buffer.from(JSON.stringify(receipt) + "\n")); await seal(report);
        const fd = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
        try { await fd.sync(); } finally { await fd.close(); }
        await sourcesUnchanged(); await check();
      } };
  } catch (error) { await abort(); throw error; }
}
