/** Local identity artifacts only; no HTTP, credentials or CMS transport. */
import { execFile } from "node:child_process";
import { mkdir, open, realpath, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { LIMITS, ReconciliationError } from "./identity-retirement-reconciliation.mts";

const runGit = promisify(execFile);
export const IDENTITY_INPUT_FLAGS = ["map", "approval", "baseline", "snapshot", "approved-digest", "out"] as const;
export function parseLocalArguments(args: readonly string[], required: readonly string[] = IDENTITY_INPUT_FLAGS, optional: readonly string[] = []): Record<string, string> {
  const allowed = new Set([...required, ...optional]);
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.slice(2), value = args[i + 1];
    if (!args[i]?.startsWith("--") || !key || !allowed.has(key) || Object.hasOwn(values, key) || !value || value.startsWith("--")) throw new ReconciliationError("INVALID_ARGUMENTS");
    values[key] = value;
  }
  if (required.some(key => !Object.hasOwn(values, key))) throw new ReconciliationError("MISSING_ARGUMENTS");
  return values;
}

async function readBounded(filename: string): Promise<Buffer> {
  const handle = await open(filename, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > LIMITS.bytes) throw new ReconciliationError("INPUT_LIMIT");
    const buffer = Buffer.alloc(before.size + 1);
    let length = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      length += bytesRead;
      if (!bytesRead || length === buffer.length) break;
    }
    const after = await handle.stat();
    if (length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new ReconciliationError("INPUT_CHANGED_DURING_READ");
    return buffer.subarray(0, length);
  } finally { await handle.close(); }
}
export async function assertPrivateOutput(folder: string, inputs: readonly string[], filename: string): Promise<string> {
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const resolved = await realpath(folder), info = await stat(resolved);
  if (!info.isDirectory() || (process.platform !== "win32" && (info.mode & 0o777) !== 0o700)) throw new ReconciliationError("OUTPUT_NOT_PRIVATE");
  const sources = await Promise.all(inputs.map(name => realpath(name)));
  if (sources.some(name => path.dirname(name) === resolved)) throw new ReconciliationError("OUTPUT_INPUT_ALIAS");
  const output = path.join(resolved, filename);
  const gitOptions = { timeout: 10_000, env: { ...process.env, LC_ALL: "C" } };
  try {
    // Reports inside any Git checkout must be ignored. Outside a checkout, the
    // explicit private output directory is sufficient. No shell is involved.
    await runGit("git", ["-C", resolved, "rev-parse", "--show-toplevel"], gitOptions);
  } catch (error) {
    const failure = error as { code?: unknown; stderr?: string };
    if (failure.code === 128 && /^fatal: not a git repository(?: |$)/u.test(failure.stderr ?? "")) return output;
    throw new ReconciliationError("OUTPUT_GIT_CHECK_FAILED");
  }
  try { await runGit("git", ["-C", resolved, "check-ignore", "--quiet", output], gitOptions); }
  catch { throw new ReconciliationError("OUTPUT_NOT_IGNORED"); }
  return output;
}
export async function readIdentityInputs(options: Record<string, string>) {
  const inputs = [options.map, options.approval, options.baseline, options.snapshot];
  const [map, approval, baseline, snapshot] = await Promise.all(inputs.map(readBounded));
  return { inputs, data: { map, approval, baseline, snapshot, approvedDigest: options["approved-digest"] } };
}
export async function writePrivateArtifact(folder: string, inputs: readonly string[], filename: string, contents: string): Promise<void> {
  const output = await assertPrivateOutput(folder, inputs, filename);
  let handle;
  try { handle = await open(output, "wx", 0o600); }
  catch { throw new ReconciliationError("OUTPUT_EXISTS_OR_UNAVAILABLE"); }
  try { await handle.writeFile(contents); }
  catch {
    await handle.close();
    await unlink(output).catch(() => {});
    throw new ReconciliationError("OUTPUT_WRITE_FAILED");
  }
  await handle.close();
}
