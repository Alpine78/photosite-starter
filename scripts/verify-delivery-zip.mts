/** Owner-run, read-only package audit. No extracted files or report files are written. */
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DELIVERY_ZIP_LIMITS, DeliveryZipError, inspectDeliveryZip, parseDeliveryZipManifest } from "./delivery-zip-integrity.mts";
const git = promisify(execFile);

/** Read only private real files, outside Git or explicitly ignored, without loading app code. */
async function readInput(file: string, maximum: number): Promise<Buffer> {
  if (process.platform === "win32" || !process.getuid) throw new DeliveryZipError("PRIVATE_PERMISSIONS_UNSUPPORTED");
  for (let current = path.resolve(file);;) {
    if ((await lstat(current)).isSymbolicLink()) throw new DeliveryZipError("PRIVATE_INPUT_REQUIRED");
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
  const directory = path.dirname(file), parent = await lstat(directory);
  if (!parent.isDirectory() || parent.uid !== process.getuid() || (parent.mode & 0o777) !== 0o700) throw new DeliveryZipError("PRIVATE_INPUT_REQUIRED");
  const gitOptions = { timeout: 10_000, maxBuffer: 4096, env: { ...process.env, LC_ALL: "C" } };
  let insideGit = true;
  try { await git("git", ["-C", directory, "rev-parse", "--show-toplevel"], gitOptions); }
  catch (error) {
    const failure = error as { code?: unknown; stderr?: string };
    if (failure.code === 128 && /^fatal: not a git repository(?: |$)/u.test(failure.stderr ?? "")) insideGit = false;
    else throw new DeliveryZipError("LOCAL_INPUT_FAILED");
  }
  if (insideGit) await git("git", ["-C", directory, "check-ignore", "--quiet", "--", file], gitOptions);
  const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await fd.stat();
    if (!before.isFile() || before.uid !== process.getuid() || (before.mode & 0o777) !== 0o600 || before.nlink !== 1 ||
        !Number.isSafeInteger(before.size) || before.size < 1 || before.size > maximum) throw new DeliveryZipError("PRIVATE_INPUT_REQUIRED");
    const buffer = Buffer.alloc(before.size + 1); let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await fd.read(buffer, length, buffer.length - length, length); length += bytesRead;
      if (!bytesRead) break;
    }
    const after = await fd.stat();
    if (length !== before.size || after.size !== before.size || after.dev !== before.dev || after.ino !== before.ino ||
        after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.mode !== before.mode || after.nlink !== 1) throw new DeliveryZipError("INPUT_CHANGED");
    return buffer.subarray(0, length);
  } finally { await fd.close(); }
}

export function parseDeliveryZipArguments(argv: readonly string[]) {
  const fields = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index], value = argv[index + 1];
    if (!["--zip", "--manifest"].includes(flag) || fields.has(flag) || !value || value.startsWith("--")) throw new DeliveryZipError("INVALID_ARGUMENTS");
    fields.set(flag, path.resolve(value));
  }
  if (fields.size !== 2 || fields.get("--zip") === fields.get("--manifest")) throw new DeliveryZipError("INVALID_ARGUMENTS");
  return { zip: fields.get("--zip")!, manifest: fields.get("--manifest")! };
}
export async function runDeliveryZipAudit(options: ReturnType<typeof parseDeliveryZipArguments>) {
  try {
    const manifest = await readInput(options.manifest, DELIVERY_ZIP_LIMITS.manifest);
    // Validate the small manifest before reading or inflating a potentially large package.
    parseDeliveryZipManifest(manifest);
    return inspectDeliveryZip(await readInput(options.zip, DELIVERY_ZIP_LIMITS.archive), manifest);
  } catch (error) {
    if (error instanceof DeliveryZipError) throw error;
    throw new DeliveryZipError("LOCAL_INPUT_FAILED");
  }
}
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await runDeliveryZipAudit(parseDeliveryZipArguments(process.argv.slice(2))))); }
  catch (error) { console.error(error instanceof DeliveryZipError ? error.message : "[delivery-zip] LOCAL_INPUT_FAILED"); process.exitCode = 1; }
}
