/** Owner-run read-only audit; every file remains local and no archive is extracted. */
import { constants, type BigIntStats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DeliveryZipError, parseLargeDeliveryZipManifest } from "./delivery-zip-integrity.mts";
import { inspectLargeDeliveryZip, LARGE_DELIVERY_ZIP_LIMITS } from "./delivery-zip-streaming.mts";
import { parseDeliveryZipArguments } from "./verify-delivery-zip.mts";

const git = promisify(execFile);
function refuse(code: string): never { throw new DeliveryZipError(code); }
function sameFile(before: BigIntStats, after: BigIntStats) {
  return before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mode === after.mode &&
    before.uid === after.uid && before.gid === after.gid && before.nlink === after.nlink &&
    before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs;
}
async function privatePath(file: string) {
  for (let current = file;;) {
    if ((await lstat(current)).isSymbolicLink()) refuse("PRIVATE_INPUT_REQUIRED");
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
  const parent = await lstat(path.dirname(file), { bigint: true });
  if (!parent.isDirectory() || parent.uid !== BigInt(process.getuid!()) || (parent.mode & BigInt(0o777)) !== BigInt(0o700)) refuse("PRIVATE_INPUT_REQUIRED");
  return parent;
}
async function ignoredInput(file: string) {
  const directory = path.dirname(file), options = { timeout: 10_000, maxBuffer: 4096, env: { ...process.env, LC_ALL: "C" } };
  try { await git("git", ["-C", directory, "rev-parse", "--show-toplevel"], options); }
  catch (error) {
    const failure = error as { code?: unknown; stderr?: string };
    if (failure.code === 128 && /^fatal: not a git repository(?: |$)/u.test(failure.stderr ?? "")) return;
    refuse("LOCAL_INPUT_FAILED");
  }
  // check-ignore without --no-index refuses tracked inputs, even when an ignore rule matches.
  await git("git", ["-C", directory, "check-ignore", "--quiet", "--", file], options);
}

/** Open-FD and current-path checks are independently testable without exposing source contents. */
export async function openPrivateZipInput(filename: string, maximum: number) {
  if (process.platform === "win32" || !process.getuid) refuse("PRIVATE_PERMISSIONS_UNSUPPORTED");
  const file = path.resolve(filename), parent = await privatePath(file);
  await ignoredInput(file);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.uid !== BigInt(process.getuid()) || (before.mode & BigInt(0o777)) !== BigInt(0o600) || before.nlink !== BigInt(1) ||
        before.size < BigInt(1) || before.size > BigInt(maximum)) refuse("PRIVATE_INPUT_REQUIRED");
    async function unchanged() {
      const after = await handle.stat({ bigint: true }), current = await lstat(file, { bigint: true }), currentParent = await privatePath(file);
      if (!sameFile(before, after) || !sameFile(before, current) || parent.dev !== currentParent.dev || parent.ino !== currentParent.ino) refuse("INPUT_CHANGED");
      await ignoredInput(file);
    }
    await unchanged();
    return { handle, size: Number(before.size), unchanged,
      async read(position: number, length: number) {
        if (!Number.isSafeInteger(position) || !Number.isSafeInteger(length) || position < 0 || length < 1 ||
            length > LARGE_DELIVERY_ZIP_LIMITS.read || position + length > Number(before.size)) refuse("TRUNCATED_ARCHIVE");
        const buffer = Buffer.allocUnsafe(length); let offset = 0;
        while (offset < length) {
          const result = await handle.read(buffer, offset, length - offset, position + offset);
          if (!result.bytesRead) refuse("INPUT_CHANGED");
          offset += result.bytesRead;
        }
        return buffer;
      } };
  } catch (error) { await handle.close(); throw error; }
}

export async function runLargeDeliveryZipAudit(options: ReturnType<typeof parseDeliveryZipArguments>) {
  let manifest: Awaited<ReturnType<typeof openPrivateZipInput>> | undefined;
  let archive: Awaited<ReturnType<typeof openPrivateZipInput>> | undefined;
  try {
    manifest = await openPrivateZipInput(options.manifest, LARGE_DELIVERY_ZIP_LIMITS.manifest);
    const bytes = await manifest.read(0, manifest.size);
    parseLargeDeliveryZipManifest(bytes); // Reject the small intended set before opening/scanning a large archive.
    archive = await openPrivateZipInput(options.zip, LARGE_DELIVERY_ZIP_LIMITS.archive);
    const result = await inspectLargeDeliveryZip(archive, bytes);
    // Keep both descriptors open: a changed manifest during a long ZIP audit also invalidates the result.
    await manifest.unchanged(); await archive.unchanged();
    return result;
  } catch (error) {
    if (error instanceof DeliveryZipError) throw error;
    refuse("LOCAL_INPUT_FAILED");
  } finally { await archive?.handle.close(); await manifest?.handle.close(); }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await runLargeDeliveryZipAudit(parseDeliveryZipArguments(process.argv.slice(2))))); }
  catch (error) { console.error(error instanceof DeliveryZipError ? error.message : "[delivery-zip] LOCAL_INPUT_FAILED"); process.exitCode = 1; }
}
