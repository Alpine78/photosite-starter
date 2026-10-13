/** Local owner-private evidence IO. No HTTP, credentials or provider writes. */
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

export class OperationError extends Error {}
export function argumentsOf(args: readonly string[], required: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1], key = flag?.slice(2);
    if (!flag?.startsWith("--") || !required.includes(key) || Object.hasOwn(values, key) || !value || value.startsWith("--")) throw new OperationError("INVALID_ARGUMENTS");
    values[key] = value;
  }
  if (required.some(key => !Object.hasOwn(values, key))) throw new OperationError("MISSING_ARGUMENTS");
  return values;
}
export async function privateInput(filename: string, maximum: number) {
  const resolved = path.resolve(filename);
  if (await realpath(resolved) !== resolved) throw new OperationError("INPUT_LINK");
  const handle = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > maximum || before.uid !== process.getuid?.() || (before.mode & 0o077) !== 0) throw new OperationError("INPUT_NOT_PRIVATE_OR_BOUNDED");
    return { handle, before, async unchanged() {
      const after = await handle.stat(), current = await lstat(resolved);
      if (before.dev !== current.dev || before.ino !== current.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new OperationError("INPUT_CHANGED");
    } };
  } catch (error) { await handle.close(); throw error; }
}
export async function readPrivateBytes(filename: string, maximum: number): Promise<Buffer> {
  const input = await privateInput(filename, maximum);
  try {
    const bytes = Buffer.alloc(input.before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await input.handle.read(bytes, length, bytes.length - length, null);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    await input.unchanged();
    if (length !== input.before.size) throw new OperationError("INPUT_CHANGED");
    return bytes.subarray(0, length);
  } finally { await input.handle.close(); }
}
export async function newPrivateDirectory(folder: string): Promise<string> {
  const resolved = path.resolve(folder), parent = path.dirname(resolved);
  const info = await lstat(parent);
  if (await realpath(parent) !== parent || !info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o022) !== 0) throw new OperationError("OUTPUT_PARENT_UNSAFE");
  const options = { stdio: "pipe" as const, timeout: 10_000, env: { ...process.env, LC_ALL: "C" } };
  let inGit = true;
  try { execFileSync("git", ["-C", parent, "rev-parse", "--show-toplevel"], options); }
  catch (error) {
    const failure = error as { status?: number; stderr?: Buffer };
    if (failure.status === 128 && /^fatal: not a git repository(?: |$)/u.test(failure.stderr?.toString() ?? "")) inGit = false;
    else throw new OperationError("OUTPUT_GIT_CHECK_FAILED");
  }
  if (inGit) {
    // Refuse tracked files even if an ignore rule happens to match them.
    try { execFileSync("git", ["-C", parent, "check-ignore", "--quiet", resolved + "/receipt.json"], options); }
    catch { throw new OperationError("OUTPUT_NOT_IGNORED"); }
  }
  await mkdir(resolved, { mode: 0o700 }); // exclusive: an existing directory is evidence
  return resolved;
}
export async function writePrivateBytes(folder: string, name: string, bytes: string | Buffer): Promise<void> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(name)) throw new OperationError("OUTPUT_NAME_INVALID");
  const handle = await open(path.join(folder, name), "wx", 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
