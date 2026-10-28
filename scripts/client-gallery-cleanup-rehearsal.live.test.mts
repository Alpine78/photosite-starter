/** Opt-in owner operation. No live execution belongs to this implementation PR. */
import { test } from "vitest";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { newPrivateDirectory, readPrivateBytes, writePrivateBytes } from "./private-operation-files.mts";
import { createClientGalleryCleanupTransport } from "../src/lib/client-gallery-cleanup-transport.ts";
import { rehearsalBaseline, rehearsalFixtures, runCleanupRehearsal } from "./client-gallery-cleanup-rehearsal.mts";
import { createRehearsalIO, type RehearsalIO } from "./client-gallery-rehearsal-io.mts";
import { buildManifest, manifestDigest, ownedIds, parseManifest, record, RehearsalError, requireRehearsal, strictJson, targetOf } from "./client-gallery-rehearsal-scope.mts";

test("explicitly authorized synthetic Content Lake cleanup rehearsal", async () => {
  let folder: string | undefined, io: RehearsalIO | undefined;
  try {
    const env = process.env, mode = env.CLIENT_GALLERY_REHEARSAL_MODE;
    requireRehearsal(env.CLIENT_GALLERY_REHEARSAL_OPT_IN === "synthetic-only" && (mode === "prepare" || mode === "run") && !env.CI, "explicit_local_opt_in_required");
    const input = env.CLIENT_GALLERY_REHEARSAL_INPUT, output = env.CLIENT_GALLERY_REHEARSAL_OUTPUT, credential = env.CLIENT_GALLERY_REHEARSAL_TOKEN_FILE;
    requireRehearsal(input && output && credential, "private_paths_required");
    const root = fileURLToPath(new URL("..", import.meta.url));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000, maxBuffer: 128 * 1024 }).trim();
    const sourceSha = git("rev-parse", "HEAD");
    requireRehearsal(!git("status", "--porcelain", "--untracked-files=all"), "clean_committed_source_required");
    const bytes = await readPrivateBytes(input, 128 * 1024);
    // Validate approval/target/source before reading any credential or contacting a provider.
    const manifest = mode === "run" ? parseManifest(bytes, env.CLIENT_GALLERY_REHEARSAL_APPROVED_DIGEST ?? "", Date.now()) : undefined;
    const preparedInput = manifest ? undefined : strictJson(bytes);
    if (!manifest) requireRehearsal(record(preparedInput) && Object.keys(preparedInput).length === 2 && preparedInput.version === 1 && "target" in preparedInput, "invalid_prepare_input");
    const target = manifest?.target ?? targetOf((preparedInput as Record<string, unknown>).target);
    requireRehearsal(!manifest || sourceSha === manifest.sourceSha, "source_changed");
    const token = (await readPrivateBytes(credential, 8192)).toString("utf8").trim();
    requireRehearsal(/^[A-Za-z0-9_-]{1,8192}$/u.test(token), "invalid_credential");
    folder = await newPrivateDirectory(output);
    const syncDirectory = async (directory: string) => {
      const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { await handle.sync(); } finally { await handle.close(); }
    };
    await syncDirectory(path.dirname(folder));
    let sequence = 0;
    const journal = async (event: Record<string, unknown>) => {
      await writePrivateBytes(folder!, `journal-${String(++sequence).padStart(4, "0")}.json`, JSON.stringify(event) + "\n");
      await syncDirectory(folder!);
    };
    await journal({ phase: "source", sourceSha, mode, ...(manifest ? { manifestSha256: manifestDigest(bytes) } : {}) });
    if (!manifest) {
      const url = `https://${target.projectId}.api.sanity.io/${target.apiVersion}/data/export/preview`;
      let requests = 0;
      const reader = createClientGalleryCleanupTransport({ ...target, token }, { fetch: async (input, init) => {
        requireRehearsal(input === url && init?.method === "GET" && init.body === undefined && init.redirect === "error" && ++requests === 1, "prepare_is_read_only");
        return fetch(input, init);
      }, limits: { maxSnapshotBytes: 1024 * 1024, maxDocuments: 1000, maxReferences: 2000 } });
      const baseline = await rehearsalBaseline(reader), nonce = randomBytes(16).toString("hex"), files = await rehearsalFixtures(nonce);
      const prepared = buildManifest({ target, baseline, nonce, sourceSha, createdAt: new Date().toISOString() }, files);
      const content = Buffer.from(JSON.stringify(prepared, null, 2) + "\n");
      parseManifest(content, manifestDigest(content), Date.now());
      for (const [name, fixture] of files) for (const [kind, extension] of [["image", "webp"], ["jpeg", "jpg"], ["zip", "zip"]] as const)
        await writePrivateBytes(folder, `${name}.${extension}`, fixture[kind]);
      await writePrivateBytes(folder, "manifest.json", content);
      console.log(JSON.stringify({ status: "prepared-no-provider-writes", cases: prepared.cases.length, manifestSha256: manifestDigest(content) }));
      return;
    }
    io = createRehearsalIO(manifest, token, journal);
    try {
      const result = await runCleanupRehearsal(manifest, io, journal);
      await writePrivateBytes(folder, "result.json", JSON.stringify(result, null, 2) + "\n");
      console.log(JSON.stringify({ status: result.status, cases: result.cases.length, ownedTargetsAbsent: result.ownedTargetsAbsent, requests: result.requests, writes: result.writes, hosted: false, activation: false }));
    } catch {
      io.stop();
      // An unexpected result never triggers destructive automatic recovery.
      let remaining: unknown = "readback-unavailable";
      try { remaining = [...(await io.transport.read([...ownedIds(manifest)], { includeAllVersions: true })).documents.values()].map(doc => ({ id: doc._id, type: doc._type, revision: doc._rev })); } catch { /* private manual reconciliation remains required */ }
      await writePrivateBytes(folder, "stopped.json", JSON.stringify({ status: "stopped-manual-reconciliation-required", remaining, ...io.stats() }, null, 2) + "\n");
      throw new RehearsalError("stopped_manual_reconciliation_required");
    }
  } catch (error) {
    io?.stop();
    // Never let Vitest print an SDK/provider/OS error, token, local path or raw record.
    throw new RehearsalError(error instanceof RehearsalError ? error.message.replace("[cleanup-rehearsal] ", "") : "operation_failed_see_private_evidence");
  }
});
