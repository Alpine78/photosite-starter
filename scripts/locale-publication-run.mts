/** Guarded document-only IO. No uploads, retries, key management or DNS. */
import { canonicalJson } from "./joomla-intro-summary.mts";
import { publicationContent, publicationPlanDigest, type LocalePublicationPlan, type PublicationTransaction } from "./locale-publication-plan.mts";
import { runReadQuery, sendSanityHttpRequest, type ReadConnection } from "./sanity-read-http.mts";
export async function boundedPublicationFetch(url: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
  const response = await fetch(url, init), reader = response.body?.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  if (reader) try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 16 * 1024 * 1024) throw new Error("LIVE_RESPONSE_LIMIT");
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers });
}
export type PublicationIO = { read(ids: string[]): Promise<Record<string, unknown>[]>; mutate(tx: PublicationTransaction, dryRun: boolean): Promise<void>; persist(index: number, result: Record<string, unknown>): Promise<void> };
function expectedSources(tx: PublicationTransaction, current: Record<string, unknown>[]) {
  const byId = new Map(current.map(d => [d._id, d]));
  if (byId.size !== current.length || tx.sources.some(d => canonicalJson(byId.get(d._id)) !== canonicalJson(d)) || tx.created.some(d => byId.has(d._id))) throw new Error("LIVE_SOURCE_OR_TARGET_CHANGED");
}
export async function runLocalePublication(plan: LocalePublicationPlan, options: { approvedDigest?: string; apply: boolean }, io: PublicationIO) {
  if (plan.digest !== publicationPlanDigest(plan) || (options.apply && options.approvedDigest !== plan.digest)) throw new Error("PUBLICATION_DIGEST_NOT_APPROVED");
  const results: Record<string, unknown>[] = [];
  for (const [index, tx] of plan.transactions.entries()) {
    const ids = [...new Set([...tx.sources.map(d => d._id), ...tx.created.map(d => String(d._id))])];
    expectedSources(tx, await io.read(ids));
    // Never replay a timed-out/ambiguous write. Its result must be reconciled
    // against live revisions with a fresh plan, not inferred from this receipt.
    try { await io.mutate(tx, !options.apply); }
    catch {
      await io.persist(index, { state: "write-refused-or-ambiguous", applied: options.apply, retryAuthorized: false });
      throw new Error("PUBLICATION_WRITE_REFUSED_OR_AMBIGUOUS");
    }
    if (options.apply) try {
      const after = await io.read(ids), byId = new Map(after.map(d => [d._id, d]));
      if (tx.created.some(d => !byId.has(d._id) || canonicalJson(publicationContent(byId.get(d._id)!)) !== canonicalJson(d)) || tx.removedDraftIds.some(id => byId.has(id))) throw new Error("PUBLICATION_READBACK_FAILED");
      for (const source of tx.sources.filter(d => !tx.removedDraftIds.includes(d._id))) {
        const actual = byId.get(source._id);
        if (!actual) throw new Error("PUBLICATION_SOURCE_MISSING");
        if (tx.kind === "category-services" && source._type === "category") {
          const mutation = tx.mutations.find(m => "patch" in m && m.patch.id === source._id);
          if (!mutation || !("patch" in mutation)) throw new Error("CATEGORY_PATCH_MISSING");
          if (canonicalJson(publicationContent(actual)) !== canonicalJson({ ...publicationContent(source), ...mutation.patch.set })) throw new Error("CATEGORY_READBACK_FAILED");
        } else if (canonicalJson(publicationContent(actual)) !== canonicalJson(publicationContent(source))) throw new Error("UNEXPECTED_SOURCE_CONTENT_CHANGE");
      }
    }
    catch {
      await io.persist(index, { state: "write-submitted-readback-failed", applied: true, retryAuthorized: false });
      throw new Error("PUBLICATION_READBACK_FAILED");
    }
    const result = { state: options.apply ? "published-and-read-back" : "provider-dry-run-passed", createdDocuments: tx.created.length, removedEditingDrafts: tx.removedDraftIds.length, mutationCount: tx.mutations.length, applied: options.apply };
    await io.persist(index, result); results.push(result);
  }
  return { version: 1, digest: plan.digest, applied: options.apply, transactions: results.length, results, fullDatasetAuditPerformed: false, credentialRevocationVerified: false, launchApproved: false };
}
export function publicationHttp(connection: ReadConnection): Omit<PublicationIO, "persist"> {
  return {
    async read(ids) {
      const rows: Record<string, unknown>[] = [];
      for (let i = 0; i < ids.length; i += 75) {
        const value = await runReadQuery(connection, { query: "*[_id in $ids]", params: { ids: ids.slice(i, i + 75) }, perspective: "raw" }, { fetchImplementation: boundedPublicationFetch });
        if (!Array.isArray(value) || value.some(d => d === null || typeof d !== "object" || Array.isArray(d))) throw new Error("INVALID_LIVE_READ");
        rows.push(...value);
      }
      return rows;
    },
    async mutate(tx, dryRun) {
      const url = `https://${connection.projectId}.api.sanity.io/${connection.apiVersion}/data/mutate/${connection.dataset}?visibility=sync&returnIds=false${dryRun ? "&dryRun=true" : ""}`;
      const response = await sendSanityHttpRequest(url, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${connection.token}` }, body: JSON.stringify({ mutations: tx.mutations }) }, undefined);
      await response.body?.cancel();
      if (!response.ok) throw new Error("PROVIDER_MUTATION_REFUSED");
    },
  };
}
