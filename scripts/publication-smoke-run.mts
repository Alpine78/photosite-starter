/** AB#117: injected IO, one CAS request, never an automatic retry or restoration. */
import { reconcilePublication, singleCurrentDocument, smokeMutation, restoreRevision, type PublicationPlan } from "./publication-smoke-plan.mts";

export async function runPublicationSmoke(plan: PublicationPlan, phase: "apply" | "restore", priorReceipt: unknown,
  io: { read(): Promise<unknown>; mutate(patch: ReturnType<typeof smokeMutation>): Promise<void>; prepare(record: unknown): Promise<void>; now?: () => Date }) {
  const revision = phase === "apply" ? String(plan.source._rev) : restoreRevision(plan, priorReceipt);
  const base = { version: 1, phase, planDigest: plan.digest, expectedRevision: revision, startedAt: (io.now?.() ?? new Date()).toISOString(), automaticRetry: false,
    visibleUpdateVerified: false, genuineWebhookVerified: false, canonicalLaunchVerified: false } as const;
  const current = singleCurrentDocument(plan, await io.read());
  const mutation = smokeMutation(plan, current, phase, revision);
  // A failed durable prepare must not issue the mutation.
  await io.prepare({ ...base, status: "prepared" });
  let mutationAcknowledged = false;
  try { await io.mutate(mutation); mutationAcknowledged = true; } catch { /* Read back an uncertain outcome; never retry. */ }
  try {
    return { ...base, mutationAcknowledged, ...reconcilePublication(plan, await io.read(), phase, revision) };
  } catch { return { ...base, mutationAcknowledged, status: "ambiguous" as const }; }
}
