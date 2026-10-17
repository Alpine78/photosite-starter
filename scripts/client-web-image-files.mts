/** POSIX owner-private local IO for the offline web-image command. */
import { execFile } from "node:child_process";
import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { CLIENT_WEB_IMAGE_LIMITS, imageDigest, imageFailure, type prepareClientWebImage } from "./client-web-image-preparation.mts";

const git = promisify(execFile);
function uid(): bigint {
  if (process.platform === "win32" || !process.getuid) return imageFailure("PRIVATE_PERMISSIONS_UNSUPPORTED");
  return BigInt(process.getuid());
}
function privateMode(info: BigIntStats, directory: boolean): void {
  if ((directory ? !info.isDirectory() : !info.isFile()) || info.uid !== uid() ||
      (info.mode & BigInt(0o777)) !== (directory ? BigInt(0o700) : BigInt(0o600)) || (!directory && info.nlink !== BigInt(1))) imageFailure("PRIVATE_PATH_REQUIRED");
}
async function safeAncestors(file: string): Promise<void> {
  for (let current = path.resolve(file);;) {
    const info = await lstat(current, { bigint: true });
    if (info.isSymbolicLink() || ((info.mode & BigInt(0o022)) !== BigInt(0) && (info.mode & BigInt(0o1000)) === BigInt(0))) imageFailure("UNSAFE_PATH");
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
}
function same(a: BigIntStats, b: BigIntStats): boolean {
  return (["dev", "ino", "size", "mode", "uid", "gid", "nlink", "mtimeNs", "ctimeNs"] as const).every(key => a[key] === b[key]);
}
async function ignoredOrOutside(file: string, directory: string): Promise<void> {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
  Object.assign(env, { LC_ALL: "C", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" });
  const options = { env, timeout: 10_000, maxBuffer: 4096 };
  let root: string;
  try { root = (await git("git", ["-C", directory, "rev-parse", "--show-toplevel"], options)).stdout.trim(); }
  catch (error) {
    const failure = error as { code?: unknown; stderr?: string };
    if (failure.code === 128 && /^fatal: not a git repository(?: |$)/u.test(failure.stderr ?? "")) return;
    return imageFailure("GIT_CHECK_FAILED");
  }
  const relative = path.relative(root, file);
  try { await git("git", ["-C", root, "ls-files", "--error-unmatch", "--", relative], options); }
  catch (error) {
    if ((error as { code?: unknown }).code !== 1) return imageFailure("GIT_CHECK_FAILED");
    try { await git("git", ["-C", root, "check-ignore", "--quiet", "--", relative], options); return; }
    catch { return imageFailure("GIT_VISIBLE_PATH"); }
  }
  imageFailure("GIT_VISIBLE_PATH");
}
export async function openPrivateClientImage(filename: string) {
  const file = path.resolve(filename), parent = path.dirname(file);
  uid(); await safeAncestors(file);
  privateMode(await lstat(parent, { bigint: true }), true);
  await ignoredOrOutside(file, parent);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true }); privateMode(before, false);
    if (before.size < BigInt(1) || before.size > BigInt(CLIENT_WEB_IMAGE_LIMITS.bytes)) imageFailure("INPUT_BYTE_LIMIT");
    async function unchanged() {
      await safeAncestors(file);
      privateMode(await lstat(parent, { bigint: true }), true);
      if (!same(before, await handle.stat({ bigint: true })) || !same(before, await lstat(file, { bigint: true }))) imageFailure("SOURCE_CHANGED");
    }
    const bytes = Buffer.alloc(Number(before.size) + 1); let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, length);
      length += result.bytesRead; if (!result.bytesRead) break;
    }
    await unchanged();
    if (length !== Number(before.size)) imageFailure("SOURCE_CHANGED");
    return { bytes: bytes.subarray(0, length), unchanged, close: () => handle.close() };
  } catch (error) { await handle.close(); throw error; }
}

type Prepared = Awaited<ReturnType<typeof prepareClientWebImage>>;
export async function writePrivateClientImage(folder: string, source: string, prepared: Prepared, signal?: AbortSignal, verifySource?: () => Promise<void>): Promise<void> {
  const target = path.resolve(folder), parent = path.dirname(target), names = [prepared.filename, "receipt.json"];
  uid(); await safeAncestors(parent); privateMode(await lstat(parent, { bigint: true }), true);
  if (path.dirname(path.resolve(source)) === target || !/^web-image\.(jpg|png|webp|avif)$/u.test(prepared.filename)) imageFailure("OUTPUT_ALIAS");
  // Every future output is checked before creating the directory or either file.
  for (const name of names) await ignoredOrOutside(path.join(target, name), parent);
  if (signal?.aborted) imageFailure("INTERRUPTED");
  await mkdir(target, { mode: 0o700 }); // Exclusive; an existing directory is never reused.
  const directory = await lstat(target, { bigint: true });
  const created: { file: string; identity: BigIntStats; complete?: BigIntStats }[] = [];
  async function directoryUnchanged() {
    await safeAncestors(target);
    const current = await lstat(target, { bigint: true }); privateMode(current, true);
    if (await realpath(target) !== target || current.dev !== directory.dev || current.ino !== directory.ino) imageFailure("OUTPUT_CHANGED");
    if (signal?.aborted) imageFailure("INTERRUPTED");
  }
  try {
    privateMode(directory, true);
    for (const name of names) {
      await directoryUnchanged(); await verifySource?.();
      const file = path.join(target, name), handle = await open(file, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        const identity = await handle.stat({ bigint: true });
        const artifact: typeof created[number] = { file, identity }; created.push(artifact); privateMode(identity, false);
        const body = name === "receipt.json" ? Buffer.from(JSON.stringify(prepared.receipt, null, 2) + "\n") : prepared.bytes;
        await handle.writeFile(body); await handle.sync();
        const info = await handle.stat({ bigint: true }); privateMode(info, false);
        const current = await lstat(file, { bigint: true });
        if (!same(info, current) || info.dev !== identity.dev || info.ino !== identity.ino || info.size !== BigInt(body.length)) imageFailure("OUTPUT_CHANGED");
        const readback = Buffer.alloc(body.length + 1); let length = 0;
        while (length < readback.length) {
          const result = await handle.read(readback, length, readback.length - length, length);
          length += result.bytesRead; if (!result.bytesRead) break;
        }
        if (length !== body.length || imageDigest(readback.subarray(0, length)) !== imageDigest(body) || !same(info, await handle.stat({ bigint: true }))) imageFailure("OUTPUT_CHANGED");
        artifact.complete = info;
        await ignoredOrOutside(file, target); await directoryUnchanged();
      } finally { await handle.close(); }
    }
    await verifySource?.(); await directoryUnchanged();
    for (const artifact of created) {
      if (!artifact.complete || !same(artifact.complete, await lstat(artifact.file, { bigint: true }))) imageFailure("OUTPUT_CHANGED");
    }
    if ((await readdir(target)).sort().join("\n") !== names.sort().join("\n")) imageFailure("OUTPUT_CHANGED");
    // A complete receipt exists only after the image has been written and rehashed.
  } catch (error) {
    for (const item of created.reverse()) {
      const current = await lstat(item.file, { bigint: true }).catch(() => undefined);
      if (current?.dev === item.identity.dev && current?.ino === item.identity.ino) await unlink(item.file).catch(() => {});
    }
    const current = await lstat(target, { bigint: true }).catch(() => undefined);
    if (current?.dev === directory.dev && current?.ino === directory.ino) await rmdir(target).catch(() => {});
    throw error;
  }
}
