/**
 * The one entry point a route uses for proof publication and key rotation
 * (ADR-0038 amendment 2026-10-22, AB#130). It owns the order a route must not
 * reassemble: prove the editor's session, then spend the gallery allowance,
 * read with the editor's token, plan, and commit one atomic transaction.
 * A selection key is returned only after that transaction committed.
 */
import "server-only";
import { createContactRateLimiter } from "@/lib/contact-rate-limit";
import { getSanityConfig, type SanityConfig } from "@/lib/sanity-config";
import { planProofPublication, relatedQueryInput, type PublicationRejection } from "@/lib/proof-publication";
import type { ProofPublicationRequest } from "@/lib/proof-publication-request";
import {
  commitPublication,
  ProofPublicationStoreError,
  readPublicationRelated,
  readPublicationState,
  verifyEditorSession,
} from "@/lib/proof-publication-sanity";

const galleryLimiter = createContactRateLimiter({ maxAttempts: 10 });

export type ProofPublicationOutcome =
  | Readonly<{ outcome: "committed"; firstPublication: boolean; selectionKey?: string }>
  | Readonly<{ outcome: "rejected"; reason: PublicationRejection | "rate-limited" }>
  | Readonly<{ outcome: "failed"; reason: "unauthenticated" | "forbidden" | "conflict" | "store-unavailable" | "misconfigured" }>;

export type ProofPublicationDependencies = Readonly<{
  config?: SanityConfig;
  fetchImplementation?: typeof fetch;
  now?: () => Date;
}>;

export async function runProofPublication(
  request: ProofPublicationRequest,
  token: string,
  secret: Buffer,
  dependencies: ProofPublicationDependencies = {},
): Promise<ProofPublicationOutcome> {
  let config: SanityConfig;
  try {
    config = dependencies.config ?? getSanityConfig();
  } catch {
    return { outcome: "failed", reason: "misconfigured" };
  }
  const options = { config, token, fetchImplementation: dependencies.fetchImplementation };
  try {
    await verifyEditorSession(options);
    if (!galleryLimiter.tryConsume(request.galleryId, Date.now()).allowed) return { outcome: "rejected", reason: "rate-limited" };
    const read = await readPublicationState(request.galleryId, options);
    const relatedInput = request.operation === "publish" ? relatedQueryInput(request.galleryId, read) : undefined;
    const related = relatedInput === undefined ? undefined
      : await readPublicationRelated(request.galleryId, relatedInput.handle, relatedInput.assetIds, options);
    const plan = planProofPublication({
      galleryId: request.galleryId, operation: request.operation, read, related,
      now: (dependencies.now?.() ?? new Date()).toISOString(), secret,
      ...(request.operation === "publish" ? { expectedDraftRevision: request.expectedDraftRevision, terms: request.terms } : {}),
    });
    if (plan.kind === "rejected") return { outcome: "rejected", reason: plan.reason };
    await commitPublication(plan.mutations, options);
    return { outcome: "committed", firstPublication: plan.firstPublication,
      ...(plan.selectionKey === undefined ? {} : { selectionKey: plan.selectionKey }) };
  } catch (error) {
    if (!(error instanceof ProofPublicationStoreError)) throw error;
    return { outcome: "failed", reason: error.kind === "unavailable" ? "store-unavailable" : error.kind };
  }
}
