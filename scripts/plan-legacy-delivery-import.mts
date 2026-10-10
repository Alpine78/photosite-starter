/** AB#250: offline byte verification. Never transforms media or writes to a provider. */
import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  buildLegacyImportPlan, LegacyPlanError, MAX_INPUT_BYTES, MAX_JPEG_BYTES, MAX_ZIP_BYTES,
  type LegacyFile, type LegacyImage,
} from "./legacy-delivery-import-plan.mts";

export type Options = Readonly<{ input: string; imageRoot: string; backup: string; out: string }>;
const exec = promisify(execFile);
function refuse(code: string): never { throw new LegacyPlanError(code); }
const isWithin = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

export function parseArguments(argv: readonly string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index], value = argv[index + 1];
    if (!["--input", "--image-root", "--backup", "--out"].includes(name) ||
      values.has(name) || !value || value.startsWith("--")) refuse("ARGUMENTS_INVALID");
    values.set(name, path.resolve(value));
  }
  if (values.size !== 4) refuse("ARGUMENTS_REQUIRED");
  return { input: values.get("--input")!, imageRoot: values.get("--image-root")!,
    backup: values.get("--backup")!, out: values.get("--out")! };
}

/** POSIX owner-private artifacts; native Windows requires a separate ACL policy. */
async function privatePath(file: string, directory: boolean): Promise<void> {
  if (process.platform === "win32" || process.getuid === undefined) refuse("PRIVATE_PERMISSIONS_UNSUPPORTED");
  const stat = await lstat(file);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()) ||
    stat.uid !== process.getuid() || (stat.mode & 0o777) !== (directory ? 0o700 : 0o600)) refuse("PRIVATE_PERMISSIONS");
}

async function ignoredIfRepositoryPath(file: string): Promise<void> {
  let root: string;
  try { root = (await exec("git", ["-C", path.dirname(file), "rev-parse", "--show-toplevel"], { maxBuffer: 4096 })).stdout.trim(); }
  catch (error) {
    // Only a definite non-repository result permits an external private artifact.
    if (typeof error === "object" && error !== null && "stderr" in error &&
      typeof error.stderr === "string" && error.stderr.includes("not a git repository")) return;
    refuse("GIT_GUARD_FAILED");
  }
  const relative = path.relative(root, file);
  try { await exec("git", ["-C", root, "ls-files", "--error-unmatch", "--", relative], { maxBuffer: 4096 }); }
  catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 1) {
      try { await exec("git", ["-C", root, "check-ignore", "--quiet", "--", relative], { maxBuffer: 4096 }); return; }
      catch { refuse("ARTIFACT_NOT_IGNORED"); }
    }
    refuse("GIT_GUARD_FAILED");
  }
  refuse("ARTIFACT_TRACKED");
}

async function noSymlinkComponents(file: string): Promise<void> {
  let current = path.resolve(file);
  for (;;) {
    if ((await lstat(current)).isSymbolicLink()) refuse("PATH_SYMLINK");
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

async function checkedFile(file: string, maxBytes: number) {
  await noSymlinkComponents(file);
  const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let before;
  try { before = await fd.stat(); }
  catch (error) { await fd.close(); throw error; }
  if (!before.isFile() || !Number.isSafeInteger(before.size) || before.size < 1 || before.size > maxBytes) {
    await fd.close(); refuse("FILE_SIZE_OR_TYPE");
  }
  return { fd, before };
}
async function unchanged(fd: Awaited<ReturnType<typeof open>>, before: Awaited<ReturnType<typeof fd.stat>>) {
  const after = await fd.stat();
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs ||
    after.ino !== before.ino || after.dev !== before.dev) refuse("SOURCE_CHANGED_DURING_READ");
}

async function boundedRead(file: string, maxBytes: number): Promise<Buffer> {
  const { fd, before } = await checkedFile(file, maxBytes);
  try {
    const buffer = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await fd.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) refuse("FILE_LENGTH_CHANGED");
      offset += bytesRead;
    }
    const tail = Buffer.alloc(1);
    if ((await fd.read(tail, 0, 1, offset)).bytesRead !== 0) refuse("FILE_LENGTH_CHANGED");
    await unchanged(fd, before);
    return buffer;
  } finally { await fd.close(); }
}

async function archiveHashes(file: string, maxBytes = MAX_ZIP_BYTES): Promise<{ sha1: string; sha256: string; bytes: number }> {
  const { fd, before } = await checkedFile(file, maxBytes);
  try {
    const magic = Buffer.alloc(4);
    await fd.read(magic, 0, 4, 0);
    // PKWARE APPNOTE 8.5.4: PK00 can precede a one-segment archive.
    // This is only signature recognition, not a claim of ZIP/CRC validity.
    if (!["504b0304", "504b0506", "504b0708", "504b3030"].includes(magic.toString("hex"))) refuse("ARCHIVE_MAGIC");
    const sha1 = createHash("sha1"), sha256 = createHash("sha256");
    let bytes = 0;
    for await (const chunk of fd.createReadStream({ start: 0, autoClose: false })) {
      bytes += chunk.length;
      if (bytes > before.size) refuse("FILE_LENGTH_CHANGED");
      sha1.update(chunk); sha256.update(chunk);
    }
    await unchanged(fd, before);
    if (bytes !== before.size) refuse("FILE_LENGTH_CHANGED");
    return { sha1: sha1.digest("hex"), sha256: sha256.digest("hex"), bytes };
  } finally { await fd.close(); }
}
function equalBytes(actual: { sha1: string; sha256: string; bytes: number }, expected: LegacyFile): void {
  if (actual.sha1 !== expected.sha1 || actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes) refuse("SOURCE_BYTES_MISMATCH");
}
async function sourceFile(root: string, locator: string): Promise<string> {
  const candidate = path.resolve(root, locator);
  if (!isWithin(root, candidate) || !isWithin(root, await realpath(candidate))) refuse("SOURCE_ROOT_ESCAPE");
  return candidate;
}
async function verifyImage(file: string, image: LegacyImage): Promise<void> {
  const buffer = await boundedRead(file, MAX_JPEG_BYTES);
  equalBytes({ sha1: createHash("sha1").update(buffer).digest("hex"),
    sha256: createHash("sha256").update(buffer).digest("hex"), bytes: buffer.length }, image);
  const metadata = await sharp(buffer, { failOn: "error", limitInputPixels: 256_000_000 }).metadata();
  if (metadata.format !== "jpeg" || metadata.width !== image.width || metadata.height !== image.height ||
    (metadata.orientation ?? 1) !== 1 || (metadata.pages ?? 1) !== 1) refuse("SOURCE_METADATA_MISMATCH");
}

async function writeExclusive(out: string, name: string, value: unknown): Promise<void> {
  const destination = path.join(out, name), temporary = path.join(out, `.pending-${randomBytes(16).toString("hex")}`);
  const fd = await open(temporary, "wx", 0o600);
  try {
    await fd.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8"); await fd.sync();
    await fd.close();
    // Hard-link creation is atomic and refuses an existing review result.
    await link(temporary, destination);
  } finally { await fd.close(); await unlink(temporary); }
}

export async function runLegacyPlanner(options: Options, clock: () => number = Date.now) {
  try {
    await noSymlinkComponents(options.input);
    await privatePath(path.dirname(options.input), true); await privatePath(options.input, false);
    await ignoredIfRepositoryPath(options.input);
    const raw = await boundedRead(options.input, MAX_INPUT_BYTES);
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw)); }
    catch { refuse("INPUT_UTF8_OR_JSON"); }
    const initial = buildLegacyImportPlan(value, clock());
    await noSymlinkComponents(options.imageRoot);
    const root = await realpath(options.imageRoot);
    // Check the destination before expensive reads; no result is written until all checks succeed.
    await mkdir(options.out, { recursive: true, mode: 0o700 });
    await noSymlinkComponents(options.out); await privatePath(options.out, true);
    // The whole directory must be ignored, including crash-left temporary files.
    await ignoredIfRepositoryPath(options.out);
    const destination = path.join(options.out, `legacy-plan-${initial.reviewDigest}.json`);
    await ignoredIfRepositoryPath(destination);
    sharp.cache(false);
    for (let g = 0; g < initial.source.galleries.length; g += 1) {
      const gallery = initial.source.galleries[g];
      for (let i = 0; i < gallery.images.length; i += 1) {
        try { const image = gallery.images[i]; await verifyImage(await sourceFile(root, image.sourceLocator), image); }
        catch (error) { throw new LegacyPlanError(error instanceof LegacyPlanError ? error.message : "SOURCE_READ_FAILED", g, i); }
      }
      if (gallery.zip !== null) {
        try { equalBytes(await archiveHashes(await sourceFile(root, gallery.zip.sourceLocator), gallery.zip.bytes), gallery.zip); }
        catch (error) { throw new LegacyPlanError(error instanceof LegacyPlanError ? error.message : "ZIP_READ_FAILED", g); }
      }
    }
    const backup = await archiveHashes(options.backup);
    if (backup.sha256 !== initial.source.sourceEvidence.backupSha256) refuse("BACKUP_BYTES_MISMATCH");
    const checkedNow = clock();
    const final = buildLegacyImportPlan(initial.source, checkedNow);
    if (final.reviewDigest !== initial.reviewDigest) refuse("SOURCE_PLAN_CHANGED");
    const artifact = { ...final, verification: {
      inputSha256: createHash("sha256").update(raw).digest("hex"), checkedAt: new Date(checkedNow).toISOString(),
      sourceBytes: "verified-at-planning-time", jpegHeaders: "verified-same-buffer-as-hashes",
      backupBytes: { sha256: backup.sha256, bytes: backup.bytes },
      receiptDigests: "declared-not-independently-loaded", zipCrc: "not-checked", cms: "not-contacted",
    } };
    await writeExclusive(options.out, path.basename(destination), artifact);
    return artifact;
  } catch (error) {
    if (error instanceof LegacyPlanError) throw error;
    throw new LegacyPlanError("LOCAL_IO_FAILED");
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runLegacyPlanner(parseArguments(process.argv.slice(2)));
    console.log(JSON.stringify({ status: result.status, reviewDigest: result.reviewDigest, counts: result.counts }));
  } catch (error) {
    console.error(error instanceof LegacyPlanError ? error.message : "PLANNER_FAILED"); process.exitCode = 1;
  }
}
