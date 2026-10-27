/** Exclusive private evidence retained on failure; no network or credential access. */
import { constants, type BigIntStats } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { openZipBuildInput, privateZipDirectory, sameZipFile, zipArtifactIgnored } from "./delivery-zip-build-files.mts";
import { canonicalJson } from "./identity-retirement-reconciliation.mts";
import { refuseAttachment } from "./client-gallery-zip-attachment.mts";
export async function createAttachmentEvidence(folder: string) {
  const parent = await privateZipDirectory(path.dirname(folder));
  await zipArtifactIgnored(folder, path.dirname(folder));
  await mkdir(folder, { mode: 0o700 });
  const identity = await privateZipDirectory(folder), files: Awaited<ReturnType<typeof openZipBuildInput>>[] = [];
  async function check(checkpoint: () => void = () => {}) {
    checkpoint();
    const now = await privateZipDirectory(folder), nowParent = await privateZipDirectory(path.dirname(folder));
    if (now.dev !== identity.dev || now.ino !== identity.ino || nowParent.dev !== parent.dev || nowParent.ino !== parent.ino) refuseAttachment("EVIDENCE_CHANGED");
    checkpoint();
    for (const file of files) { checkpoint(); await file.unchanged(); checkpoint(); }
  }
  async function save(name: string, value: unknown, checkpoint: () => void = () => {}) {
    if (!/^[a-z-]+\.(?:json|tsv)$/u.test(name)) refuseAttachment("INVALID_EVIDENCE_NAME");
    const bytes = Buffer.from(name.endsWith(".tsv") ? String(value) : canonicalJson(value) + "\n");
    if (!bytes.length || bytes.length > 512 * 1024) refuseAttachment("EVIDENCE_LIMIT");
    await check(checkpoint); const file = path.join(folder, name); await zipArtifactIgnored(file, folder); checkpoint();
    const fd = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    let sealed: BigIntStats;
    try { await fd.writeFile(bytes); await fd.sync(); sealed = await fd.stat({ bigint: true }); } finally { await fd.close(); }
    const guarded = await openZipBuildInput(file, 512 * 1024);
    if (!sameZipFile(sealed, guarded.before)) { await guarded.handle.close(); refuseAttachment("EVIDENCE_CHANGED"); }
    files.push(guarded);
    const directory = await open(folder, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const stat = await directory.stat({ bigint: true });
      if (stat.dev !== identity.dev || stat.ino !== identity.ino) refuseAttachment("EVIDENCE_CHANGED");
      await directory.sync();
    } finally { await directory.close(); }
    await check(checkpoint);
  }
  return { save, check, async close() { await Promise.allSettled(files.map(file => file.handle.close())); } };
}
