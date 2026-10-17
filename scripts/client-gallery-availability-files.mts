/** Private local artifacts, never CMS/network operations. */
import { constants, type Stats } from "node:fs";
import { lstat, mkdir, open, realpath, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { AvailabilityPlanError } from "./client-gallery-availability-plan.mts";
import { assertPrivateOutput } from "./identity-artifact-files.mts";

export async function writeAvailabilityArtifact(folder: string, inputs: readonly string[], filename: "plan.json" | "verification.json", body: string) {
  const target = path.resolve(folder), parent = path.dirname(target);
  const info = await lstat(parent);
  if (await realpath(parent) !== parent || !info.isDirectory() || (info.mode & 0o777) !== 0o700 || info.uid !== process.getuid?.()) throw new AvailabilityPlanError("OUTPUT_PARENT_NOT_PRIVATE");
  await mkdir(target, { mode: 0o700 }); // Exclusive new directory; never overwrite evidence.
  let directory: Stats | undefined;
  try {
    directory = await lstat(target);
    if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o777) !== 0o700 || directory.uid !== process.getuid?.()) throw new AvailabilityPlanError("OUTPUT_NOT_PRIVATE");
    let file: string;
    try { file = await assertPrivateOutput(target, inputs, filename); }
    catch { throw new AvailabilityPlanError("OUTPUT_LOCATION_REFUSED"); }
    const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    let identity: { dev: number; ino: number } | undefined;
    try {
      const created = await handle.stat();
      identity = { dev: created.dev, ino: created.ino };
      if (!created.isFile() || created.nlink !== 1 || (created.mode & 0o777) !== 0o600 || created.uid !== process.getuid?.()) throw new AvailabilityPlanError("OUTPUT_NOT_PRIVATE");
      await handle.writeFile(body); await handle.sync();
      const current = await lstat(target);
      if (current.dev !== directory.dev || current.ino !== directory.ino) throw new AvailabilityPlanError("OUTPUT_CHANGED");
    } catch (error) {
      const current = await lstat(file).catch(() => undefined);
      if (identity && current?.dev === identity.dev && current?.ino === identity.ino) await unlink(file).catch(() => {});
      throw error;
    } finally { await handle.close(); }
  } catch (error) {
    const current = await lstat(target).catch(() => undefined);
    // Remove only our own still-empty directory; never recurse or remove evidence.
    if (directory && current?.dev === directory.dev && current?.ino === directory.ino && current.isDirectory() && !current.isSymbolicLink()) await rmdir(target).catch(() => {});
    throw error;
  }
}
