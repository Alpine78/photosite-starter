/** Synthetic orchestration around the unchanged application runner and provider transport. */
import { runClientGalleryCleanup, type CleanupRunDependencies } from "../src/lib/client-gallery-cleanup-runner.ts";
import { cleanupPolicyFromGallery, parseCleanupControl } from "../src/lib/client-gallery-cleanup-contract.ts";
import type { CleanupMutationResult, CleanupTransport } from "../src/lib/client-gallery-cleanup-transport.ts";
import { generateRehearsalFixtures } from "./client-gallery-rehearsal-fixtures.mts";
import type { Journal, RehearsalIO } from "./client-gallery-rehearsal-io.mts";
import { assetEvidence, assertSnapshot, CASES, FIXED_CURSOR_ID, manifestDigest, ownedIds, requireRehearsal, type Case, type Manifest } from "./client-gallery-rehearsal-scope.mts";

type Mutation = Readonly<Record<string, unknown>>;
export async function rehearsalFixtures(nonce: string) {
  return new Map(await Promise.all(CASES.map(async name => [name, await generateRehearsalFixtures(nonce, name)] as const)));
}
const ref = (_ref: string) => ({ _type: "reference", _ref });
export function rehearsalGallery(manifest: Manifest, entry: Case) {
  return { _id: entry.galleryId, _type: "clientDeliveryGallery", handle: manifestDigest(Buffer.from(entry.galleryId)).slice(0, 32), available: true,
    availabilityMode: "until", expiryInstant: new Date(Date.parse(manifest.createdAt) - 3_600_000).toISOString(),
    items: [{ _key: "synthetic", _type: "clientDeliveryItem", mediaType: "image", image: { _type: "image", asset: ref(entry.image.id) },
      alt: [{ _key: "en", _type: "localizedText", language: "en", value: "Synthetic full-frame test card" }] }],
    deliveryZip: { _type: "file", asset: ref(entry.zip.id) } };
}
function deletes(mutations: readonly Mutation[], id: string) { return mutations.some(row => (row.delete as { id?: string } | undefined)?.id === id); }
function pending(mutations: readonly Mutation[], id: string) { return mutations.some(row => {
  const patch = row.patch as { id?: string; set?: { state?: string } } | undefined;
  return patch?.id === id && patch.set?.state === "pending";
}); }
/** A real read barrier: both invocations must observe the same enrolled revision before either claim. */
function twoReaders() {
  let arrivals = 0, release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  return { count: () => arrivals, async enter() {
    if (++arrivals === 2) release();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([ready, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("barrier")), 10_000); })]); }
    finally { clearTimeout(timer); }
  } };
}
export async function runCleanupRehearsal(manifest: Manifest, io: RehearsalIO, journal: Journal) {
  // Regeneration cannot replace approved bytes, even after a local codec update.
  const files = await rehearsalFixtures(manifest.nonce);
  for (const entry of manifest.cases) for (const kind of ["image", "zip"] as const)
    requireRehearsal(JSON.stringify(assetEvidence(files.get(entry.name)![kind], kind)) === JSON.stringify(entry[kind]), "fixture_changed");
  const transport = io.transport, allIds = [...ownedIds(manifest)], results: Record<string, unknown>[] = [];
  async function note(event: Record<string, unknown>) {
    try { await journal(event); } catch { io.stop(); requireRehearsal(false, "journal_failed"); }
  }
  async function snapshot(initial = false) {
    const value = await transport.snapshot(); assertSnapshot(manifest, value.documents, initial); return value;
  }
  async function read(ids: readonly string[]) {
    const value = await transport.read(ids, { includeAllVersions: true });
    requireRehearsal([...value.documents.keys()].every(id => allIds.includes(id)), "foreign_variant");
    return value;
  }
  async function commit(mutations: readonly Mutation[]) {
    const value = await transport.mutate(mutations);
    requireRehearsal(value.kind === "committed" && !io.unsafe(), "write_unconfirmed");
  }
  async function patch(id: string, set: Record<string, unknown>) {
    const doc = (await read([id])).documents.get(id); requireRehearsal(doc, "missing_owned_document");
    await commit([{ patch: { id, ifRevisionID: doc._rev, set } }]);
  }
  async function teardown(ids: readonly string[]) {
    await snapshot(); // Foreign data or changed baseline stops even automatic teardown.
    const documents = [...(await read(ids)).documents.values()];
    if (documents.length) await commit(documents.flatMap(doc => [
      { patch: { id: doc._id, ifRevisionID: doc._rev, set: { rehearsalTeardown: manifest.nonce } } }, { delete: { id: doc._id } },
    ]));
    requireRehearsal((await read(ids)).documents.size === 0, "teardown_unconfirmed");
  }
  await snapshot(true);
  requireRehearsal((await read(allIds)).documents.size === 0, "owned_target_already_exists");
  for (const [index, entry] of manifest.cases.entries()) {
    await snapshot();
    const fixture = files.get(entry.name)!;
    await io.upload(entry, "image", fixture.image); await io.upload(entry, "zip", fixture.zip);
    const gallery = rehearsalGallery(manifest, entry), policy = cleanupPolicyFromGallery(gallery);
    requireRehearsal(policy, "invalid_synthetic_gallery");
    await commit([{ create: gallery }, { create: { _id: entry.controlId, _type: "clientGalleryCleanup", version: 1, galleryId: entry.galleryId,
      policy, sourceDocumentId: entry.galleryId, sourceRevision: "synthetic-reviewed-source", publicationId: `synthetic-${manifest.nonce}-${index}`,
      enrolledAt: manifest.createdAt, state: "enrolled" } }]);
    const current = await snapshot(), protectedIds = [entry.galleryId, entry.image.id, entry.zip.id];
    let sequence = 0, logicalDeletions = 0, wireDeletions = 0, injected = false;
    let held: readonly Mutation[] | undefined, heldHash: string | undefined;
    let rollbackRevisions: Map<string, unknown> | undefined;
    const operations = new Set<string>(), barrier = twoReaders(), observedRevisions: unknown[] = [];
    async function mutate(mutations: readonly Mutation[]): Promise<CleanupMutationResult> {
      const destructive = deletes(mutations, entry.galleryId);
      if (destructive) {
        logicalDeletions++;
        if (!injected) {
          injected = true;
          if (entry.name === "source-revision") await patch(entry.galleryId, { rehearsalMarker: "changed" });
          if (entry.name === "image-revision") await patch(entry.image.id, { rehearsalMarker: "changed" });
          if (entry.name === "zip-revision") await patch(entry.zip.id, { rehearsalMarker: "changed" });
          if (entry.name === "late-referrer") await commit([{ create: { _id: entry.referrerId, _type: "cleanupRehearsalReferrer", asset: ref(entry.zip.id) } }]);
          if (entry.name === "late-draft") await commit([{ create: { ...gallery, _id: entry.draftId } }]);
          if (["source-revision", "image-revision", "zip-revision", "late-referrer", "late-draft"].includes(entry.name)) {
            // This read proves the competing write finished before original deletion bytes go on wire.
            rollbackRevisions = new Map([...(await read(protectedIds)).documents].filter(([id]) => protectedIds.includes(id)).map(([id, doc]) => [id, doc._rev]));
            requireRehearsal(rollbackRevisions.size === protectedIds.length, "race_not_established");
          }
          if (entry.name === "late-delete") {
            held = structuredClone(mutations); heldHash = manifestDigest(Buffer.from(JSON.stringify({ mutations })));
            await note({ phase: "injection", case: entry.name, kind: "request-held-before-wire", bodySha256: heldHash });
            return { kind: "uncertain" };
          }
        }
        wireDeletions++;
      }
      const result = await transport.mutate(mutations);
      if ((entry.name === "claim-response-loss" && pending(mutations, entry.controlId) || entry.name === "delete-response-loss" && destructive) && !injectedResponse) {
        requireRehearsal(result.kind === "committed" && !io.unsafe(), "injection_requires_commit");
        injectedResponse = true;
        await note({ phase: "injection", case: entry.name, kind: "committed-result-hidden-locally", actual: result.kind });
        return { kind: "uncertain" };
      }
      return result;
    }
    let injectedResponse = false;
    const makeDependencies = (): CleanupRunDependencies => {
      let firstControlRead = true;
      return { snapshot: current, read: async (ids, options) => {
        const value = await transport.read(ids, options);
        if (entry.name === "duplicate-runners" && firstControlRead && ids.includes(entry.controlId)) {
          firstControlRead = false;
          const doc = value.documents.get(entry.controlId);
          requireRehearsal(doc?.state === "enrolled", "race_not_established");
          observedRevisions.push(doc._rev); await barrier.enter();
        }
        return value;
      }, mutate, now: Date.now, expiryNow: () => Math.min(Date.now(), current.providerTime), clock: () => performance.now(),
      remainingMs: () => 185_000 - (performance.now() - runStarted), operationId: () => {
        const id = `operation-${manifest.nonce}-${index}-${++sequence}`; operations.add(id); return id;
      } };
    };
    const runStarted = performance.now();
    const counts = entry.name === "duplicate-runners"
      ? await Promise.all([runClientGalleryCleanup(makeDependencies()), runClientGalleryCleanup(makeDependencies())])
      : [await runClientGalleryCleanup(makeDependencies())];
    requireRehearsal(!io.unsafe(), "provider_outcome_uncertain");
    if (entry.name === "late-delete") {
      requireRehearsal(held && heldHash && manifestDigest(Buffer.from(JSON.stringify({ mutations: held }))) === heldHash, "race_not_established");
      const control = (await read([entry.controlId])).documents.get(entry.controlId);
      requireRehearsal(control?.state === "enrolled" && !control.attempt, "fence_not_established");
      // The first call was never sent: release its exact original bytes once, after the newer fence.
      const result = await transport.mutate(held); wireDeletions++;
      requireRehearsal(result.kind === "conflict", "old_deletion_not_fenced");
      await note({ phase: "injection", case: entry.name, kind: "held-request-released-once", actual: result.kind, bodySha256: heldHash });
    }
    const final = await read([...protectedIds, entry.controlId, entry.draftId, entry.referrerId, FIXED_CURSOR_ID]);
    const control = parseCleanupControl(final.documents.get(entry.controlId), entry.controlId, entry.galleryId);
    const completed = counts.reduce((sum, row) => sum + row.completed, 0);
    if (rollbackRevisions) {
      requireRehearsal(completed === 0 && counts[0].conflict + counts[0].refused === 1 && !control.receipt && control.state === "enrolled" &&
        protectedIds.every(id => final.documents.get(id)?._rev === rollbackRevisions!.get(id)), "rollback_not_verified");
    } else if (entry.name === "late-delete") {
      requireRehearsal(completed === 0 && counts[0].uncertain === 1 && control.state === "enrolled" && !control.receipt && protectedIds.every(id => final.documents.has(id)), "fence_not_verified");
    } else {
      requireRehearsal(completed === 1 && control.state === "complete" && control.receipt && operations.has(control.receipt.operationId) &&
        control.receipt.deletedCount === 2 && control.receipt.sharedCount === 0 && protectedIds.every(id => final.omitted.has(id)) &&
        control.receipt.deletedAssets.map(asset => asset.id).sort().join(",") === [entry.image.id, entry.zip.id].sort().join(","), "completion_not_verified");
    }
    requireRehearsal(logicalDeletions === 1 && wireDeletions === 1 && counts.some(row => row.cursorWritten) && final.documents.get(FIXED_CURSOR_ID)?._type === "clientGalleryCleanupCursor", "operation_not_verified");
    if (entry.name.includes("response-loss")) requireRehearsal(injectedResponse, "injection_not_exercised");
    if (entry.name === "duplicate-runners") requireRehearsal(barrier.count() === 2 && observedRevisions.length === 2 && observedRevisions[0] === observedRevisions[1], "race_not_established");
    const result = { case: entry.name, state: "verified", counts, logicalDeletionCalls: logicalDeletions, wireDeletionRequests: wireDeletions,
      ...(entry.name === "duplicate-runners" ? { sameRevisionBarrier: true } : {}) };
    await note({ phase: "case-result", ...result }); results.push(result);
    await teardown([entry.referrerId, entry.draftId, entry.galleryId, entry.controlId, entry.image.id, entry.zip.id]);
  }
  await teardown([FIXED_CURSOR_ID]); await snapshot(true);
  requireRehearsal((await read(allIds)).documents.size === 0, "final_absence_unconfirmed");
  const result = { status: "synthetic-provider-matrix-verified", hosted: false, activation: false, cases: results, ownedTargetsAbsent: allIds.length, ...io.stats() };
  await note({ phase: "complete", ...result }); return result;
}

/** Freeze only metadata from an otherwise empty dataset; approval binds exact IDs/revisions later. */
export async function rehearsalBaseline(transport: CleanupTransport) {
  const snapshot = await transport.snapshot(), rows = [...snapshot.documents.values()];
  requireRehearsal(rows.length <= 32 && rows.every(row => ["system.group", "system.retention"].includes(row.type) && row.references.length === 0), "dataset_not_empty");
  return rows.map(({ id, type, revision }) => ({ id, type, revision })).sort((a, b) => a.id.localeCompare(b.id));
}
