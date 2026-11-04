/**
 * Keyword publication (ADR-0039 decisions 3 and 4, AB#56). Pure planning behind a
 * reader port; `keyword-publish-action.tsx` performs the IO.
 *
 * One transaction writes the keyword and advances `keywordTaxonomyState` under the
 * revision read in the same query as the keyword graph. A second publication that
 * read the same graph therefore conflicts, instead of both passing validation and
 * together forming a cycle or a name collision. A structural change raises
 * `taxonomyVersion` in that transaction, so its re-sync request cannot be lost.
 */
import {
  KEYWORD_GRAPH_PROJECTION,
  KEYWORD_TAXONOMY_STATE_ID,
  KEYWORD_TAXONOMY_STATE_TYPE_NAME,
  KEYWORD_TYPE_NAME,
  keywordPublicationEffects,
  validateProspectiveKeywordGraph,
  type KeywordPublicationEffects,
} from "../sanity/schemas/keyword-rules";
import { transactionSyncLocked } from "./editor-lock";
import { readProofDocuments, type ProofDeletionReader } from "./proof-delete";

export type KeywordMutation = Readonly<Record<string, unknown>>;

/** State and graph come from one query, so the revision describes the graph it was read with. */
export const KEYWORD_PUBLISH_QUERY = `{
  "state": *[_id == $stateId][0]{_rev},
  "keywords": *[_type == $type]${KEYWORD_GRAPH_PROJECTION}
}`;
export const KEYWORD_PUBLISH_PARAMS = { stateId: KEYWORD_TAXONOMY_STATE_ID, type: KEYWORD_TYPE_NAME } as const;
/** Created once, before the first publication; creating it twice changes nothing. */
export const INITIAL_KEYWORD_TAXONOMY_STATE = {
  _id: KEYWORD_TAXONOMY_STATE_ID,
  _type: KEYWORD_TAXONOMY_STATE_TYPE_NAME,
  taxonomyVersion: 0,
  resyncedVersion: 0,
  publicationSequence: 0,
} as const;

export type KeywordPublishReader = Pick<ProofDeletionReader, "docs"> & Readonly<{
  ensureState(): Promise<unknown>;
  graph(): Promise<unknown>;
}>;

export type KeywordPublishPlan = Readonly<{
  effects: KeywordPublicationEffects;
  mutations: readonly KeywordMutation[];
}>;
export type KeywordPublishReview =
  | Readonly<{ ready: KeywordPublishPlan }>
  | Readonly<{ reason: "unreadable" | "stale" }>
  | Readonly<{ reason: "invalid"; message: string }>;
export type KeywordPublishOutcome = "published" | "conflict" | "refused" | "uncertain";

type Revisioned = { readonly _rev?: string } | null | undefined;
export type KeywordActionState = Readonly<{
  type: string; ready: boolean; draft: Revisioned; version?: unknown; release?: unknown; transactionSyncLock?: unknown;
}>;
export type KeywordValidationState = Readonly<{
  isValidating: boolean; revision?: string; validation: readonly { readonly level: string }[];
}>;

/** A draft whose validation finished for exactly its current revision with no errors. */
export function keywordPublishReady(state: KeywordActionState, validation: KeywordValidationState, syncing: boolean): boolean {
  const revision = state.draft?._rev;
  return state.type === KEYWORD_TYPE_NAME && state.version == null && state.release === undefined && state.ready &&
    !transactionSyncLocked(state.transactionSyncLock) && !syncing && !validation.isValidating &&
    typeof revision === "string" && validation.revision === revision &&
    !validation.validation.some((marker) => marker.level === "error");
}

function authored(document: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(document).filter(([key]) => !["_rev", "_createdAt", "_updatedAt", "_system"].includes(key)));
}

/**
 * What native publication does to a reference chosen while its target was unpublished.
 * Left as it is, a published keyword could lose its required category.
 */
function strengthened<T>(value: T): T {
  if (Array.isArray(value)) return value.map(strengthened) as T;
  if (typeof value !== "object" || value === null) return value;
  const { _strengthenOnPublish: pending, _weak: weak, ...rest } = value as Record<string, unknown>;
  const stayWeak = (pending as { weak?: unknown } | undefined)?.weak === true;
  const entries = Object.entries(pending === undefined && weak !== undefined ? { ...rest, _weak: weak } : stayWeak ? { ...rest, _weak: true } : rest);
  return Object.fromEntries(entries.map(([key, entry]) => [key, strengthened(entry)])) as T;
}

const revisionGuard = (document: Readonly<Record<string, unknown>>): KeywordMutation => ({
  patch: { id: document._id, ifRevisionID: document._rev, set: { keywordId: document.keywordId } },
});

/**
 * Reviews exactly the document a commit would write: the retained aliases are
 * added first and validated with it, because a former title can collide in a
 * category the same edit moved the keyword into.
 */
export async function reviewKeywordPublication(id: string, expectedRevision: string, reader: KeywordPublishReader): Promise<KeywordPublishReview> {
  let state: unknown, keywords: unknown, documents: Map<string, Record<string, unknown> | undefined>;
  let category: Record<string, unknown> | undefined;
  const draftId = `drafts.${id}`;
  try {
    await reader.ensureState();
    const graph = await reader.graph() as { state?: { _rev?: unknown } | null; keywords?: unknown } | null;
    state = graph?.state?._rev;
    keywords = graph?.keywords;
    documents = await readProofDocuments(reader, [draftId, id]);
    const categoryRef = (documents.get(draftId)?.category as { _ref?: unknown } | undefined)?._ref;
    if (typeof categoryRef === "string") category = (await readProofDocuments(reader, [categoryRef])).get(categoryRef);
  } catch {
    return { reason: "unreadable" };
  }
  const draft = documents.get(draftId), published = documents.get(id);
  if (typeof state !== "string") return { reason: "stale" };
  if (!draft || draft._rev !== expectedRevision) return { reason: "stale" };
  if (!category) return { reason: "invalid", message: "The keyword's category must be published first." };

  const effects = keywordPublicationEffects(published, draft);
  const existing = Array.isArray(draft.aliases) ? draft.aliases : [];
  const target = {
    ...strengthened(authored(draft)),
    _id: id,
    ...(effects.retainedAliases.length > 0 ? { aliases: [...existing, ...effects.retainedAliases] } : {}),
  };
  const valid = validateProspectiveKeywordGraph(keywords, target);
  if (valid !== true) return { reason: "invalid", message: valid };

  const mutations: KeywordMutation[] = [
    {
      patch: {
        id: KEYWORD_TAXONOMY_STATE_ID,
        ifRevisionID: state,
        inc: { publicationSequence: 1, ...(effects.structural ? { taxonomyVersion: 1 } : {}) },
      },
    },
    revisionGuard(draft),
    { delete: { id: draftId } },
    ...(published ? [revisionGuard(published), { createOrReplace: target }] : [{ create: target }]),
  ];
  return { ready: { effects, mutations } };
}

export async function commitKeywordPublication(
  plan: KeywordPublishPlan,
  commit: (mutations: readonly KeywordMutation[]) => Promise<void>,
): Promise<KeywordPublishOutcome> {
  try {
    await commit(plan.mutations);
    return "published";
  } catch (error) {
    const status = (error as { statusCode?: unknown } | null)?.statusCode;
    return status === 409 ? "conflict" : typeof status === "number" && status >= 400 && status < 500 ? "refused" : "uncertain";
  }
}

export function keywordPublishCopy(locale: string) {
  return /^fi(?:-|$)/u.test(locale) ? {
    action: "Julkaise", working: "Julkaistaan…", close: "Sulje", publish: "Julkaise", cancel: "Peruuta",
    unavailable: "Odota tietojen synkronointia ja korjaa validointivirheet ennen julkaisua.",
    structural: "Tämä muuttaa avainsanojen rakennetta. Julkaisu kirjaa kuvien uudelleensynkronoinnin tarpeen, ja hakutulokset voivat olla vanhentuneita, kunnes se on tehty.",
    retained: "Korvattu nimi jää vaihtoehtoiseksi nimeksi, jotta seuraava tuonti löytää tämän avainsanan:",
    outcomes: {
      unreadable: "Tietoja ei voitu lukea. Mitään ei julkaistu.",
      stale: "Tiedot muuttuivat tarkistuksen aikana. Mitään ei julkaistu. Yritä uudelleen.",
      conflict: "Avainsanoja julkaistiin samaan aikaan. Mitään ei julkaistu. Yritä uudelleen, niin tarkistus tehdään uusilla tiedoilla.",
      refused: "Julkaisua ei tehty: tarkista oikeutesi ja avainsanan tiedot.",
      uncertain: "Lopputulos ei selvinnyt. Tarkista dokumentin tila ennen uutta yritystä; samaa julkaisua ei voi soveltaa kahdesti.",
    },
  } : {
    action: "Publish", working: "Publishing…", close: "Close", publish: "Publish", cancel: "Cancel",
    unavailable: "Wait for syncing to finish and fix validation errors before publishing.",
    structural: "This changes the keyword structure. Publishing records that photographs need a re-sync, and search results can lag until it has run.",
    retained: "The replaced name stays as an alias, so the next import still finds this keyword:",
    outcomes: {
      unreadable: "The data could not be read. Nothing was published.",
      stale: "The data changed during the check. Nothing was published. Try again.",
      conflict: "Keywords were published at the same time. Nothing was published. Try again to check against the new data.",
      refused: "Not published: check your permissions and the keyword's fields.",
      uncertain: "The result is unknown. Check the document before trying again; the same publication cannot apply twice.",
    },
  };
}
