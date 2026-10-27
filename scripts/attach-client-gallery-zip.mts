/** Owner-run controlled writer: existing verified public ZIP -> existing draft only. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachmentMutation, attachmentPlan, parseAttachmentArguments, parseAttachmentInput, privateJson, record, reconcileAttachment, refuseAttachment, ZipAttachmentError, type AttachmentInput } from "./client-gallery-zip-attachment.mts";
import { createAttachmentEvidence } from "./client-gallery-zip-files.mts";
import { openZipBuildInput, privateZipDirectory } from "./delivery-zip-build-files.mts";
import { parseZipSelection, ZIP_BUILD_LIMITS } from "./delivery-zip-build-plan.mts";
import { auditJpegExports } from "./jpeg-export-audit.mts";
import { auditJpegMetadata } from "./jpeg-metadata-inventory.mts";
import { inspectLargeDeliveryZip } from "./delivery-zip-streaming.mts";
import { verifyRemoteDeliveryZip } from "./delivery-zip-remote-integrity.mts";
import { parseClientGalleryZipAsset } from "../src/lib/client-gallery-zip-contract.ts";
import { parseReadConnection, readSanityJsonResponse, sendSanityHttpRequest, SanityReadHttpError } from "./sanity-read-http.mts";
export const ZIP_ATTACHMENT_OPERATION_MS = 1_200_000;
export const ZIP_ATTACHMENT_READBACK_MS = 20_000;
type Options = ReturnType<typeof parseAttachmentArguments>;
type Dependencies = { fetchImplementation?: typeof fetch; environment?: Readonly<Record<string, string | undefined>>; signal?: AbortSignal };
function network(fetcher: typeof fetch, signal: AbortSignal): typeof fetch {
  return (url, init) => fetcher(url, { ...init, signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]) });
}
async function readDocument(input: AttachmentInput, token: string, id: string, fetcher: typeof fetch) {
  const target = input.target;
  const url = `https://${target.projectId}.api.sanity.io/${target.apiVersion}/data/doc/${target.dataset}/${encodeURIComponent(id)}?includeAllVersions=false`;
  const response = await sendSanityHttpRequest(url, { method: "GET", headers: { Authorization: `Bearer ${token}` }, cache: "no-store", credentials: "omit" }, { fetchImplementation: fetcher });
  const raw = record(await readSanityJsonResponse(response, "Document read"));
  if (!Array.isArray(raw.documents) || raw.documents.length !== 1 || raw.omitted != null && (!Array.isArray(raw.omitted) || raw.omitted.length !== 0)) return refuseAttachment("DOCUMENT_UNAVAILABLE");
  const document = record(raw.documents[0]); if (document._id !== id) return refuseAttachment("DOCUMENT_UNAVAILABLE"); return document;
}
export async function runZipAttachment(options: Options, dependencies: Dependencies = {}) {
  const allInputs: Awaited<ReturnType<typeof openZipBuildInput>>[] = [];
  let output: Awaited<ReturnType<typeof createAttachmentEvidence>> | undefined;
  const signal = AbortSignal.any([AbortSignal.timeout(ZIP_ATTACHMENT_OPERATION_MS), ...(dependencies.signal ? [dependencies.signal] : [])]);
  const expires = performance.now() + ZIP_ATTACHMENT_OPERATION_MS;
  const fetcher = dependencies.fetchImplementation ?? fetch, transport = network(fetcher, signal);
  function active() { if (signal.aborted || performance.now() >= expires) refuseAttachment("CANCELLED_OR_DEADLINE"); }
  try {
    active();
    const source = await openZipBuildInput(options.input, 65_536); allInputs.push(source);
    const bytes = await source.read(0, source.size); if (bytes.length !== source.size) refuseAttachment("SOURCE_CHANGED");
    const input = parseAttachmentInput(privateJson(bytes));
    const env = dependencies.environment ?? process.env;
    if (env.NEXT_PUBLIC_SANITY_MIGRATION_TOKEN !== undefined) refuseAttachment("PUBLIC_TOKEN_REFUSED");
    const token = env.SANITY_MIGRATION_TOKEN;
    if (typeof token !== "string") refuseAttachment("CREDENTIAL_REQUIRED");
    try { parseReadConnection({ ...input.target, token }); } catch { refuseAttachment("INVALID_CREDENTIAL_OR_TARGET"); }
    const identities = new Set([`${source.before.dev}:${source.before.ino}`]);
    async function openInput(filename: string, maximum: number) {
      active(); const file = await openZipBuildInput(filename, maximum); allInputs.push(file);
      const identity = `${file.before.dev}:${file.before.ino}`;
      if (identities.has(identity)) refuseAttachment("SOURCE_ALIAS"); identities.add(identity); return file;
    }
    let rootCheck: (() => Promise<void>) | undefined;
    async function unchanged() {
      active(); if (rootCheck) { await rootCheck(); active(); }
      for (const file of allInputs) { active(); await file.unchanged(); active(); }
      if (output) { await output.check(active); active(); }
    }
    const reports: Record<string, unknown> = {};
    let manifest: string | undefined;
    if (input.assetId) {
      const rootPath = input.exportsDirectory!, root = await privateZipDirectory(rootPath);
      const relative = path.relative(rootPath, options.output);
      if (!relative || relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) refuseAttachment("OUTPUT_SOURCE_ALIAS");
      rootCheck = async () => { const current = await privateZipDirectory(rootPath); if (current.dev !== root.dev || current.ino !== root.ino) refuseAttachment("SOURCE_CHANGED"); };
      const selection = await openInput(input.selectionFile!, ZIP_BUILD_LIMITS.selection), selectionBytes = await selection.read(0, selection.size);
      if (selectionBytes.length !== selection.size) refuseAttachment("SOURCE_CHANGED");
      const names = parseZipSelection(selectionBytes), sources: typeof allInputs = [];
      for (const name of names) sources.push(await openInput(path.join(rootPath, name), ZIP_BUILD_LIMITS.entry));
      const archive = await openInput(input.archiveFile!, ZIP_BUILD_LIMITS.archive);
      await unchanged();
      const decoded = await auditJpegExports(sources, selectionBytes, { signal }); active();
      const metadata = await auditJpegMetadata(sources, selectionBytes, { signal }); active();
      if (decoded.manifest !== metadata.manifest) refuseAttachment("AUDIT_SET_MISMATCH");
      manifest = decoded.manifest;
      const container = await inspectLargeDeliveryZip(archive, Buffer.from(manifest), { signal }); active();
      const remote = await verifyRemoteDeliveryZip({ projectId: input.target.projectId, dataset: input.target.dataset, assetId: input.assetId, bytes: container.archiveBytes, sha256: container.archiveSha256 }, { fetchImplementation: transport });
      // The verifier accepts a deliberately closed declaration, without API pin.
      if (remote.status !== "matched") refuseAttachment("REMOTE_BYTES_UNVERIFIED");
      Object.assign(reports, { decoded: decoded.receipt, metadata: metadata.receipt, container, remote });
      await unchanged();
    }
    const draft = await readDocument(input, token, `drafts.${input.galleryId}`, transport);
    const asset = input.assetId ? await readDocument(input, token, input.assetId, transport) : null;
    if (input.assetId) {
      let verified; try { verified = parseClientGalleryZipAsset(asset, input.assetId); } catch { return refuseAttachment("INVALID_ASSET"); }
      const container = record(reports.container); if (verified.bytes !== container.archiveBytes) refuseAttachment("ASSET_BYTES_MISMATCH");
    }
    const plan = attachmentPlan(input, draft, asset, reports);
    if (options.apply && options.approvedDigest !== plan.digest) refuseAttachment("APPROVAL_DIGEST_MISMATCH");
    await unchanged(); output = await createAttachmentEvidence(options.output);
    if (manifest) await output.save("entries.tsv", manifest, active);
    for (const [name, report] of Object.entries(reports)) await output.save(`${name}.json`, report, active);
    await output.save("plan.json", plan, active);
    const counts = { images: input.assetId ? Number(record(reports.decoded).count) : 0, zip: input.assetId ? 1 : 0 };
    if (!options.apply || plan.alreadyMatching) {
      await unchanged(); const result = { state: plan.alreadyMatching ? "already-matching" : "dry-run", digest: plan.digest, counts, mutations: 0 };
      await output.save("result.json", result, active); return result;
    }
    // Fresh reads immediately before the guarded patch, without reusing a cached response.
    const freshDraft = await readDocument(input, token, `drafts.${input.galleryId}`, transport);
    const freshAsset = input.assetId ? await readDocument(input, token, input.assetId, transport) : null;
    if (attachmentPlan(input, freshDraft, freshAsset, reports).digest !== plan.digest) refuseAttachment("FRESH_EVIDENCE_CHANGED");
    await unchanged();
    await output.save("intent.json", { version: 1, digest: plan.digest, mutation: attachmentMutation(plan), expectedPostHash: plan.expectedPostHash }, active);
    await unchanged();
    let writeStatus: "accepted" | "rejected" | "conflict" | "unknown" = "unknown";
    try {
      const url = `https://${input.target.projectId}.api.sanity.io/${input.target.apiVersion}/data/mutate/${input.target.dataset}?returnIds=true&visibility=sync`;
      const response = await sendSanityHttpRequest(url, { method: "POST", credentials: "omit", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ mutations: [attachmentMutation(plan)] }) }, { fetchImplementation: transport });
      await readSanityJsonResponse(response, "Draft patch"); writeStatus = "accepted";
    } catch (error) {
      if (error instanceof SanityReadHttpError && error.status === 409) writeStatus = "conflict";
      else if (error instanceof SanityReadHttpError && error.status !== undefined && error.status >= 400 && error.status < 500) writeStatus = "rejected";
    }
    // Independent readback budget deliberately survives cancellation/timeout of the write.
    let state: "observed" | "not-observed" | "uncertain" = "uncertain";
    try { state = reconcileAttachment(plan, await readDocument(input, token, `drafts.${input.galleryId}`, network(fetcher, AbortSignal.timeout(ZIP_ATTACHMENT_READBACK_MS)))); } catch { /* Preserve uncertain intent; never retry. */ }
    const result = { state, writeStatus, digest: plan.digest, counts, mutations: 1, lateCommitPossible: state !== "observed" };
    await output.save("result.json", result); return result;
  } catch (error) {
    if (error instanceof ZipAttachmentError) throw error;
    return refuseAttachment("OPERATION_FAILED");
  } finally {
    await output?.close(); await Promise.allSettled(allInputs.map(file => file.handle.close()));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController(), cancel = () => controller.abort();
  process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
  try {
    const result = await runZipAttachment(parseAttachmentArguments(process.argv.slice(2)), { signal: controller.signal });
    console.log(JSON.stringify(result)); if (["uncertain", "not-observed"].includes(result.state)) process.exitCode = 1;
  } catch (error) { console.error(error instanceof ZipAttachmentError ? error.message : "[client-gallery-zip] OPERATION_FAILED"); process.exitCode = 1; }
  finally { process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel); }
}
