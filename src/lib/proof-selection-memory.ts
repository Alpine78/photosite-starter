/**
 * Development-only proof selection store for the Playwright harness
 * (`PROOF_SELECTION=fixture`, refused outside local development). It keeps
 * Sanity's transaction rules — `create` fails on an existing ID, a patch fails
 * on another revision, a failed transaction changes nothing — over in-process
 * documents seeded like the proof page fixture.
 *
 * Isolation: each syntactically valid selection key opens its own partition,
 * so parallel journeys never see each other's selections. A key beginning with
 * `AAAA` gets terms whose hash it never matches, exercising the real refusal.
 */
import "server-only";
import { PROOF_GALLERY_FIXTURE_HANDLE } from "@/lib/proof-gallery-access";
import { isSelectionKey, selectionKeyHash } from "@/lib/proof-selection-key";
import { ProofSelectionStoreError } from "@/lib/proof-selection-sanity";

export const PROOF_SELECTION_FIXTURE_GALLERY_ID = "proof-fixture";
export const PROOF_SELECTION_REFUSED_KEY_PREFIX = "AAAA";
const MAX_PARTITIONS = 512;

type Documents = Map<string, Record<string, unknown>>;
const partitions = new Map<string, Documents>();

function seed(key: string): Documents {
  const id = PROOF_SELECTION_FIXTURE_GALLERY_ID;
  const item = (_key: string, reference: string, ref: string, originalFilename: string) => ({
    _key, _type: "clientProofItem", mediaType: "image", originalFilename, reference,
    image: { _type: "image", asset: { _type: "reference", _ref: ref } },
  });
  const refused = key.startsWith(PROOF_SELECTION_REFUSED_KEY_PREFIX) || !isSelectionKey(key);
  return new Map<string, Record<string, unknown>>([
    [id, { _id: id, _type: "clientProofGallery", _rev: "fixture-gallery-1", handle: PROOF_GALLERY_FIXTURE_HANDLE, available: true,
      availabilityMode: "indefinite", referenceHighWater: 14, items: [
        item("proof-portrait", "014", `image-${"7".repeat(40)}-256x2048-webp`, "fixture-portrait.jpg"),
        item("proof-coast", "002", `image-${"8".repeat(40)}-1536x1024-webp`, "fixture-coast.jpg"),
      ] }],
    [`proofTerms.${id}`, { _id: `proofTerms.${id}`, _type: "clientProofTerms", _rev: "fixture-terms-1", galleryId: id,
      includedCount: 1, extraUnitPriceMinor: 1500, currency: "EUR", jobReference: "Fixture",
      reminderDelayDays: 7, customerEmail: "customer@example.invalid", customerLocale: "en-GB", firstPublishedAt: "2026-10-01T00:00:00.000Z",
      selectionKeyHash: refused ? "0".repeat(64) : selectionKeyHash(key) }],
  ]);
}

function partition(key: string): Documents {
  let documents = partitions.get(key);
  if (!documents) {
    if (partitions.size >= MAX_PARTITIONS) partitions.delete(partitions.keys().next().value!);
    documents = seed(key);
    partitions.set(key, documents);
  }
  return documents;
}

/** The store bound to one key's partition, for one request. */
export function fixtureProofSelectionStore(key: string) {
  const documents = partition(key);
  let counter = 0;
  const revision = () => `fixture-${Date.now().toString(36)}-${++counter}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    discover: async (handle: string) => [...documents.values()]
      .filter((doc) => doc._type === "clientProofGallery" && doc.handle === handle).map((doc) => ({ _id: doc._id })),
    read: async (id: string) => structuredClone(documents.get(id) ?? null),
    commit: async (mutations: readonly Record<string, unknown>[]) => {
      const next = new Map([...documents].map(([id, doc]) => [id, structuredClone(doc)]));
      for (const mutation of mutations) {
        if (mutation.create) {
          const doc = mutation.create as Record<string, unknown>;
          if (next.has(doc._id as string)) throw new ProofSelectionStoreError("conflict");
          next.set(doc._id as string, { ...structuredClone(doc), _rev: revision() });
        } else {
          const patch = mutation.patch as { id: string; ifRevisionID: string; set?: Record<string, unknown>; unset?: string[] };
          const current = next.get(patch.id);
          if (!current || current._rev !== patch.ifRevisionID) throw new ProofSelectionStoreError("conflict");
          const updated: Record<string, unknown> = { ...current, ...structuredClone(patch.set ?? {}), _rev: revision() };
          for (const field of patch.unset ?? []) delete updated[field];
          next.set(patch.id, updated);
        }
      }
      documents.clear();
      for (const [id, doc] of next) documents.set(id, doc);
    },
  };
}
