/** Shared bounded local inspection for offline private-gallery owner tooling. */
import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { refuse, MAX_IMAGE_BYTES, MAX_ZIP, MAX_EDGE, type LocalAsset } from "./private-gallery-source-plan.mts";
const exec = promisify(execFile);

export async function noSymlinks(file: string): Promise<void> {
  let current = path.resolve(file);
  for (;;) {
    if ((await lstat(current)).isSymbolicLink()) refuse("PATH_SYMLINK");
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}
export async function privatePath(file: string, directory: boolean): Promise<void> {
  if (process.platform === "win32" || !process.getuid) refuse("PRIVATE_PERMISSIONS_UNSUPPORTED");
  const stat = await lstat(file);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()) || stat.uid !== process.getuid() ||
      (stat.mode & 0o777) !== (directory ? 0o700 : 0o600)) refuse("PRIVATE_PERMISSIONS");
}
/** Same fail-closed Git guard as the existing private legacy import planner. */
export async function ignoredArtifact(file: string): Promise<void> {
  let root: string;
  try { root = (await exec("git", ["-C", path.dirname(file), "rev-parse", "--show-toplevel"], { maxBuffer: 4096 })).stdout.trim(); }
  catch (error) {
    if (typeof error === "object" && error !== null && "stderr" in error && typeof error.stderr === "string" &&
        error.stderr.includes("not a git repository")) return;
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
async function checkedFile(file: string, maximum: number) {
  await noSymlinks(file);
  const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await fd.stat();
    if (!before.isFile() || !Number.isSafeInteger(before.size) || before.size < 1 || before.size > maximum) refuse("INVALID_SIZE");
    return { fd, before };
  } catch (error) { await fd.close(); throw error; }
}
async function unchanged(fd: Awaited<ReturnType<typeof open>>, before: Stats) {
  const after = await fd.stat();
  if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) refuse("SOURCE_CHANGED");
}
export async function boundedRead(file: string, maximum: number): Promise<Buffer> {
  const { fd, before } = await checkedFile(file, maximum);
  try {
    const data = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < data.length) {
      const { bytesRead } = await fd.read(data, offset, data.length - offset, offset);
      if (!bytesRead) refuse("SOURCE_CHANGED");
      offset += bytesRead;
    }
    if ((await fd.read(Buffer.alloc(1), 0, 1, offset)).bytesRead) refuse("SOURCE_CHANGED");
    await unchanged(fd, before);
    return data;
  } finally { await fd.close(); }
}
export async function inspectAsset(root: string, relativePath: string, zip: boolean): Promise<LocalAsset> {
  const file = path.resolve(root, relativePath);
  const actual = await realpath(file);
  const relative = path.relative(root, actual);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) refuse("SOURCE_ROOT_ESCAPE");
  const { fd, before } = await checkedFile(file, zip ? MAX_ZIP : MAX_IMAGE_BYTES);
  try {
    const identity = `${before.dev}:${before.ino}`;
    if (zip) {
      const magic = Buffer.alloc(4);
      if ((await fd.read(magic, 0, 4, 0)).bytesRead !== 4 || magic.toString("hex") !== "504b0304") refuse("INVALID_MEDIA");
      const hash = createHash("sha256"); let bytes = 0;
      for await (const chunk of fd.createReadStream({ start: 0, autoClose: false })) {
        bytes += chunk.length;
        if (bytes > MAX_ZIP || bytes > before.size) refuse("SOURCE_CHANGED");
        hash.update(chunk);
      }
      await unchanged(fd, before);
      if (bytes !== before.size) refuse("SOURCE_CHANGED");
      return { relativePath, bytes, identity, sha256: hash.digest("hex") };
    }
    const data = Buffer.alloc(before.size); let offset = 0;
    while (offset < data.length) {
      const { bytesRead } = await fd.read(data, offset, data.length - offset, offset);
      if (!bytesRead) refuse("SOURCE_CHANGED"); offset += bytesRead;
    }
    if ((await fd.read(Buffer.alloc(1), 0, 1, offset)).bytesRead) refuse("SOURCE_CHANGED");
    await unchanged(fd, before);
    let metadata;
    try {
      const decoder = sharp(data, { failOn: "warning", limitInputPixels: MAX_EDGE * MAX_EDGE });
      metadata = await decoder.metadata();
      // Header metadata alone accepts a truncated JPEG with intact dimensions, and
      // failOn "error" still tolerates warning-grade scan corruption.
      // Decode the bounded complete image without transforming or writing it.
      await decoder.stats();
    }
    catch { refuse("INVALID_MEDIA"); }
    return { relativePath, bytes: data.length, identity, sha256: createHash("sha256").update(data).digest("hex"),
      format: metadata.format, width: metadata.width, height: metadata.height, orientation: metadata.orientation,
      pages: metadata.pages, hasExif: metadata.exif !== undefined, hasIcc: metadata.icc !== undefined };
  } finally { await fd.close(); }
}
