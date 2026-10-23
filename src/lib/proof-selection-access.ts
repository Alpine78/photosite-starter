/**
 * Proof selection facade (ADR-0038 decision 5, action item 3, AB#130): the only
 * module the route reaches, owning the order it must not reassemble.
 *
 * 1. Handle discovery, then the published gallery read fresh by its ID.
 * 2. A closed (paused, expired) or replaced gallery is refused before any
 *    private read, exactly like an unknown handle.
 * 3. Terms and working selection read fresh; the key is compared in constant
 *    time against the terms' hash. A wrong key is the same refusal.
 *    Re-read the gallery revision to bind the terms guard to the validated snapshot.
 * 4. Only then the per-gallery allowance, the plan and one guarded transaction.
 *    The clock is checked again right before the transaction.
 */
import "server-only";
import { isClientGalleryHandle } from "@/lib/client-gallery-model";
import { isReplacementDeliveryAvailable } from "@/lib/client-gallery-access";
import { getDeploymentConfig } from "@/lib/deployment-config";
import { getSanityConfig } from "@/lib/sanity-config";
import {
  customerSelection, parseConfirmedVersion, parseSelectionGallery, parseSelectionTerms, parseWorkingSelection,
  planConfirm, planSelect, proofSelectionId, proofTermsDocumentId, proofVersionId, ProofSelectionDataError,
  selectionGalleryOpen, type CustomerSelection, type SelectionGallery, type SelectionRejection,
} from "@/lib/proof-selection";
import { PROOF_GALLERY_ID_MAX_LENGTH } from "@/lib/proof-publication-request";
import type { ProofSelectionRequest } from "@/lib/proof-selection-request";
import {
  commitProofSelection, discoverProofGallery, readProofSelectionDocument, ProofSelectionStoreError, type ProofSelectionStoreOptions,
} from "@/lib/proof-selection-sanity";
import { selectionKeyMatches } from "@/lib/proof-selection-key";
import { fixtureProofSelectionStore } from "@/lib/proof-selection-memory";

export type ProofSelectionResult =
  | Readonly<{ outcome: "ok"; selection: CustomerSelection; written?: "selected" | "confirmed" }>
  /** Unknown handle, wrong key, closed or replaced gallery: indistinguishable. */
  | Readonly<{ outcome: "unavailable" }>
  | Readonly<{ outcome: "rejected"; reason: SelectionRejection; selection: CustomerSelection }>
  | Readonly<{ outcome: "rate-limited" }>
  /** A transaction was sent and may have committed: read before acting again. */
  | Readonly<{ outcome: "unknown" }>
  /** The transaction committed, but reading the result failed: read before acting again. */
  | Readonly<{ outcome: "committed"; written: "selected" | "confirmed" }>
  | Readonly<{ outcome: "failed"; reason: "malformed-record" | "store-unavailable" }>;

export type ProofSelectionDependencies = Readonly<{
  /** Overrides the deployment's Sanity settings; only the fixture store uses this. */
  sanityConfig?: ProofSelectionStoreOptions["config"];
  store?: Partial<Readonly<{
    discover: typeof discoverProofGallery; read: typeof readProofSelectionDocument; commit: typeof commitProofSelection;
  }>>;
  replacementAvailable?: typeof isReplacementDeliveryAvailable;
  now?: () => number;
  galleryAllowed: (galleryId: string) => boolean;
}>;

type Authorized = Readonly<{
  gallery: SelectionGallery;
  terms: ReturnType<typeof parseSelectionTerms>;
  selection: ReturnType<typeof parseWorkingSelection>;
}>;

class Refusal extends Error {}

export async function runProofSelection(request: ProofSelectionRequest, token: string, dependencies: ProofSelectionDependencies): Promise<ProofSelectionResult> {
  const options: ProofSelectionStoreOptions = { config: dependencies.sanityConfig ?? getSanityConfig(), token };
  const discover = dependencies.store?.discover ?? discoverProofGallery;
  const read = dependencies.store?.read ?? readProofSelectionDocument;
  const commit = dependencies.store?.commit ?? commitProofSelection;
  const replacementAvailable = dependencies.replacementAvailable ?? isReplacementDeliveryAvailable;
  const now = dependencies.now ?? Date.now;

  /** Steps 1–3; throws Refusal for every uniform refusal. */
  async function authorize(): Promise<Authorized> {
    const rows = await discover(request.handle, options);
    if (!Array.isArray(rows) || rows.length > 1) throw new ProofSelectionDataError();
    if (rows.length === 0) throw new Refusal();
    const row = rows[0] as Record<string, unknown> | null;
    const id = row?._id;
    if (typeof id !== "string" || id.length > PROOF_GALLERY_ID_MAX_LENGTH || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(id)) throw new ProofSelectionDataError();
    const raw = await read(id, options);
    if (raw === null) throw new Refusal();
    const gallery = parseSelectionGallery(raw, id, request.handle);
    if (!selectionGalleryOpen(gallery, now())) throw new Refusal();
    if (gallery.replacedBy !== undefined) {
      // The replacing delivery gallery, read fresh by its ID; a deleted one no longer replaces.
      const replacement = await read(gallery.replacedBy, options) as Record<string, unknown> | null;
      if (replacement !== null) {
        if (replacement._type !== "clientDeliveryGallery" || !isClientGalleryHandle(replacement.handle)) throw new ProofSelectionDataError();
        if (await replacementAvailable(replacement.handle, gallery.replacedBy, getDeploymentConfig().locale)) throw new Refusal();
      }
    }
    const [termsRaw, selectionRaw] = await Promise.all([read(proofTermsDocumentId(id), options), read(proofSelectionId(id), options)]);
    const currentGallery = await read(id, options) as { _rev?: unknown } | null;
    if (currentGallery?._rev !== gallery.revision) throw new ProofSelectionStoreError("unavailable");
    if (termsRaw === null) throw new ProofSelectionDataError();
    const terms = parseSelectionTerms(termsRaw, id);
    if (!selectionKeyMatches(request.key, terms.keyHash)) throw new Refusal();
    return { gallery, terms, selection: parseWorkingSelection(selectionRaw, id) };
  }

  async function view(state: Authorized): Promise<CustomerSelection> {
    const { gallery, terms, selection } = state;
    const confirmed = selection?.state === "confirmed"
      ? parseConfirmedVersion(await read(proofVersionId(gallery.id, selection.latestVersion), options), gallery.id, selection.latestVersion)
      : undefined;
    return customerSelection(gallery, terms, selection, confirmed);
  }

  try {
    let state = await authorize();
    if (!dependencies.galleryAllowed(state.gallery.id)) return { outcome: "rate-limited" };
    if (request.operation === "read") return { outcome: "ok", selection: await view(state) };
    const at = new Date(now()).toISOString();
    const plan = request.operation === "select"
      ? planSelect(state.gallery, state.terms, state.selection, request.expectedRevision, request.references, at)
      : planConfirm(state.gallery, state.terms, state.selection, request.expectedRevision, at);
    if (plan.kind === "rejected") return { outcome: "rejected", reason: plan.reason, selection: await view(state) };
    if (!selectionGalleryOpen(state.gallery, now())) return { outcome: "unavailable" };
    try {
      await commit(plan.mutations, options);
    } catch (error) {
      if (!(error instanceof ProofSelectionStoreError) || error.kind !== "conflict") throw error;
      // Re-authorize: a rotation or closure meanwhile is the uniform refusal, not a state to show.
      state = await authorize();
      return { outcome: "rejected", reason: "conflict", selection: await view(state) };
    }
    // Committed: show the result even if the gallery closed a moment later.
    const written = request.operation === "select" ? "selected" : "confirmed";
    try {
      state = { ...state, selection: parseWorkingSelection(await read(proofSelectionId(state.gallery.id), options), state.gallery.id) };
      return { outcome: "ok", selection: await view(state), written };
    } catch {
      return { outcome: "committed", written };
    }
  } catch (error) {
    if (error instanceof Refusal) return { outcome: "unavailable" };
    if (error instanceof ProofSelectionDataError) return { outcome: "failed", reason: "malformed-record" };
    if (error instanceof ProofSelectionStoreError) return error.kind === "unknown" ? { outcome: "unknown" } : { outcome: "failed", reason: "store-unavailable" };
    throw error;
  }
}

const FIXTURE_SANITY_CONFIG = { projectId: "fixture", dataset: "fixture", apiVersion: "v2026-06-24", datasetVisibility: "public" } as ProofSelectionStoreOptions["config"];

/** The harness path (`PROOF_SELECTION=fixture`): the same facade over one key's synthetic partition. */
export function runFixtureProofSelection(request: ProofSelectionRequest): Promise<ProofSelectionResult> {
  return runProofSelection(request, "fixture", {
    store: fixtureProofSelectionStore(request.key), sanityConfig: FIXTURE_SANITY_CONFIG,
    replacementAvailable: async () => false, galleryAllowed: () => true,
  });
}
