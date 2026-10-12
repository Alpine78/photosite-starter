/** AB#258: local files only; no credentials, HTTP or CMS mutation transport. */
import { execFile } from "node:child_process";
import { mkdir, open, realpath, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { canonicalJson, LIMITS, reconcileIdentities, ReconciliationError } from "./identity-retirement-reconciliation.mts";

const runGit = promisify(execFile);
const OUTPUT = "identity-reconciliation-report.json";
export function parseArguments(args: readonly string[]): Record<string, string> {
  const allowed = new Set(["map", "approval", "baseline", "snapshot", "approved-digest", "out"]);
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.slice(2), value = args[i + 1];
    if (!args[i]?.startsWith("--") || !key || !allowed.has(key) || Object.hasOwn(values, key) || !value || value.startsWith("--")) throw new ReconciliationError("INVALID_ARGUMENTS");
    values[key] = value;
  }
  if (Object.keys(values).length !== allowed.size) throw new ReconciliationError("MISSING_ARGUMENTS");
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
async function assertPrivateOutput(folder: string, inputs: readonly string[]): Promise<string> {
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const resolved = await realpath(folder), info = await stat(resolved);
  if (!info.isDirectory() || (process.platform !== "win32" && (info.mode & 0o777) !== 0o700)) throw new ReconciliationError("OUTPUT_NOT_PRIVATE");
  const sources = await Promise.all(inputs.map(name => realpath(name)));
  if (sources.some(name => path.dirname(name) === resolved)) throw new ReconciliationError("OUTPUT_INPUT_ALIAS");
  const output = path.join(resolved, OUTPUT);
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
export async function main(args: readonly string[]): Promise<number> {
  const options = parseArguments(args);
  const inputs = [options.map, options.approval, options.baseline, options.snapshot];
  const [map, approval, baseline, snapshot] = await Promise.all(inputs.map(readBounded));
  const report = reconcileIdentities({ map, approval, baseline, snapshot, approvedDigest: options["approved-digest"] });
  const output = await assertPrivateOutput(options.out, inputs);
  let handle;
  try { handle = await open(output, "wx", 0o600); }
  catch { throw new ReconciliationError("OUTPUT_EXISTS_OR_UNAVAILABLE"); }
  try { await handle.writeFile(`${canonicalJson(report)}\n`); }
  catch {
    await handle.close();
    // Only this exclusively created file can be removed after a failed write.
    await unlink(output).catch(() => {});
    throw new ReconciliationError("OUTPUT_WRITE_FAILED");
  }
  await handle.close();
  console.log(JSON.stringify({ status: report.status, counts: report.counts, reportSha256: report.reportSha256, writable: false, cutoverReady: false }));
  return report.issues.length ? 2 : 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.on("unhandledRejection", () => { console.error("RECONCILIATION_ASYNC_FAILED"); process.exitCode = 1; });
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
    console.error(error instanceof ReconciliationError ? error.code : "RECONCILIATION_IO_FAILED");
    process.exitCode = 1;
  });
}
