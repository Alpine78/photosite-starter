/**
 * The review of imported keyword terms (AB#70, ADR-0039 decisions 2 and 5). Pure, behind the
 * tool in `keyword-review-tool.tsx`. A decision is made once per term rather than once per
 * photograph: an alias or a new keyword covers every record holding that term, and the
 * next `npm run sync:keywords` re-maps them from their stored imports.
 *
 * Records live on a private path, so only a signed-in reader with access sees them. Every write
 * takes the same revision guard as keyword publication, under the state read with the graph.
 */
import {
  KEYWORD_ID_PATTERN,
  KEYWORD_TAXONOMY_STATE_ID,
  KEYWORD_TYPE_NAME,
  keywordMatchKey,
  proposeKeywordId,
  validateProspectiveKeywordGraph,
} from "../sanity/schemas/keyword-rules";
import { LOCALIZED_TEXT_TYPE_NAME } from "../sanity/schemas/localized-text";

export const REPRESENTATIVE_MEDIA_LIMIT = 5;

/** On a private path, because a term can name anyone. `npm run sync:keywords` reads it. */
export const KEYWORD_TERM_DECISIONS_ID = "keywordTermDecisions.current";
export const KEYWORD_TERM_DECISIONS_QUERY = `*[_id == "${KEYWORD_TERM_DECISIONS_ID}"][0].decisions`;

/** Records with something to review, read with the signed-in editor's own access. */
export const KEYWORD_REVIEW_RECORDS_QUERY = `*[_type == "keywordRecord" && count(reviewItems) > 0]{mediaId, reviewItems}`;

/** The keyword as published, and whether anything unpublished would overwrite it. Reads with the raw perspective. */
export const KEYWORD_ALIAS_TARGET_QUERY = `{
  "target": *[_id == $id][0]{_id, _rev, keywordId, title, category, parent, aliases, status, mergedInto, visibility},
  "hasDraft": count(*[_id == $draftId || _id in path($versions)]) > 0
}`;
export const keywordAliasTargetParams = (id: string) => ({ id, draftId: `drafts.${id}`, versions: `versions.*.${id}` });

/** Unpublished keywords holding this id. The published graph cannot see them, and two of them block each other's publication. Raw perspective. */
export const KEYWORD_ID_RESERVATION_QUERY = `count(*[_type == "${KEYWORD_TYPE_NAME}" && keywordId == $keywordId && (_id in path("drafts.**") || _id in path("versions.**"))]) > 0`;

export type KeywordReviewGroup = Readonly<{
  reason: string;
  key: string;
  terms: readonly string[];
  occurrences: number;
  /** A few, to look at; never the whole list. */
  mediaIds: readonly string[];
  candidates: readonly string[];
  proposedCategoryTerm: string | null;
}>;

type RawRecord = Readonly<{ mediaId?: unknown; reviewItems?: unknown }>;
type RawItem = Readonly<{ reason?: unknown; key?: unknown; terms?: unknown; candidates?: unknown; proposedCategoryTerm?: unknown }>;

const strings = (value: unknown): readonly string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);

/** One row per normalized term and reason, the most common first. A malformed item is left for the sync to report. */
export function aggregateKeywordReview(records: readonly RawRecord[]): readonly KeywordReviewGroup[] {
  // The same term beside Lightroom paths and without them needs one decision, so they share a row.
  const decisionKind = (reason: string) => (reason === "unmatched-beside-paths" ? "unmatched" : reason);
  const groups = new Map<string, { reason: string; key: string; terms: Set<string>; mediaIds: Set<string>; candidates: Set<string>; proposedCategoryTerm: string | null }>();
  for (const record of records) {
    if (typeof record.mediaId !== "string" || !Array.isArray(record.reviewItems)) continue;
    for (const item of record.reviewItems as readonly RawItem[]) {
      if (typeof item?.reason !== "string" || typeof item.key !== "string") continue;
      const id = `${decisionKind(item.reason)}\u0000${item.key}`;
      const group = groups.get(id) ?? { reason: decisionKind(item.reason), key: item.key, terms: new Set<string>(), mediaIds: new Set<string>(), candidates: new Set<string>(), proposedCategoryTerm: null };
      for (const term of strings(item.terms)) group.terms.add(term);
      for (const candidate of strings(item.candidates)) group.candidates.add(candidate);
      group.mediaIds.add(record.mediaId);
      if (typeof item.proposedCategoryTerm === "string") group.proposedCategoryTerm = item.proposedCategoryTerm;
      groups.set(id, group);
    }
  }
  return [...groups.values()]
    .map((group) => ({
      reason: group.reason,
      key: group.key,
      terms: [...group.terms].sort(),
      occurrences: group.mediaIds.size,
      mediaIds: [...group.mediaIds].sort().slice(0, REPRESENTATIVE_MEDIA_LIMIT),
      candidates: [...group.candidates].sort(),
      proposedCategoryTerm: group.proposedCategoryTerm,
    }))
    .sort((left, right) => right.occurrences - left.occurrences || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
}

/**
 * What a term's reason lets an editor decide here. A malformed path never reaches the vocabulary, so it
 * is fixed in the source file. A path can name a client or a person, so it never becomes a public alias:
 * the choice stays in the private decisions. A flat name shared by two categories stays ambiguous
 * whatever alias is added, so the editor chooses among its keywords. Anything else takes an alias.
 */
export function keywordReviewAction(group: Pick<KeywordReviewGroup, "reason" | "key">): "add-alias" | "fix-source" | "choose-for-path" | "choose-candidate" {
  if (group.reason === "malformed-path") return "fix-source";
  if (group.key.includes("|")) return "choose-for-path";
  return group.reason === "ambiguous" ? "choose-candidate" : "add-alias";
}

const canCreateKeyword = (group: Pick<KeywordReviewGroup, "reason" | "key">): boolean => ["add-alias", "choose-for-path"].includes(keywordReviewAction(group));

/** The category the import's root term names, when one does. */
export function proposedCategoryId(group: KeywordReviewGroup, categories: readonly Readonly<{ _id: string; name?: string }>[]): string {
  if (group.proposedCategoryTerm === null) return "";
  const key = keywordMatchKey(group.proposedCategoryTerm);
  return categories.find((category) => category.name !== undefined && keywordMatchKey(category.name) === key)?._id ?? "";
}

/** The keyword a path's next-to-last term names, when exactly one does: where a new leaf belongs. */
export function proposedParentId(group: KeywordReviewGroup, keywords: readonly Readonly<{ _id: string; name?: string }>[]): string {
  const parts = group.key.split("|");
  if (parts.length < 2) return "";
  const matches = keywords.filter((keyword) => keyword.name !== undefined && keywordMatchKey(keyword.name) === parts.at(-2));
  return matches.length === 1 ? matches[0]._id : "";
}

/** The title a new keyword starts from: the plainest raw form, the leaf of a path. */
export function proposedTitle(group: KeywordReviewGroup): string {
  const raw = group.terms[0] ?? group.key;
  return raw.split("|").at(-1)!.trim();
}

export type KeywordReviewGraph = Readonly<{ stateRevision: string; keywords: readonly unknown[] }>;
export type KeywordReviewMutation = Readonly<Record<string, unknown>>;
export type KeywordReviewPlan =
  | Readonly<{ mutations: readonly KeywordReviewMutation[]; draftId?: string }>
  | Readonly<{ refused: string }>;

const stateGuard = (graph: KeywordReviewGraph): KeywordReviewMutation => ({
  patch: { id: KEYWORD_TAXONOMY_STATE_ID, ifRevisionID: graph.stateRevision, inc: { publicationSequence: 1 } },
});

/** The published document, as much of it as the rules read, with the alias added. */
export type AliasTarget = Readonly<{
  _id: string;
  _rev: string;
  keywordId: string;
  title?: unknown;
  category?: unknown;
  parent?: unknown;
  aliases?: readonly string[] | null;
  status?: unknown;
  mergedInto?: unknown;
  visibility?: unknown;
  /** An unpublished draft would drop the alias when published, so it has to be settled first. */
  hasDraft: boolean;
}>;

const PUBLIC_NOT_CONFIRMED = "Confirm that this name may be public." as const;

const NOT_DECIDABLE = "This term cannot be decided here." as const;

export function planAddAlias(graph: KeywordReviewGraph, group: KeywordReviewGroup, target: AliasTarget, publicConfirmed: boolean): KeywordReviewPlan {
  if (keywordReviewAction(group) !== "add-alias") return { refused: NOT_DECIDABLE };
  // A public keyword's aliases are anonymously readable (ADR-0039 decision 7), and this term may be someone's name.
  if (target.visibility !== "internal" && !publicConfirmed) return { refused: PUBLIC_NOT_CONFIRMED };
  if (target.hasDraft) return { refused: "This keyword has an unpublished draft. Publish or discard it first." };
  // A retired or merged keyword would resolve to nothing, or to another keyword than the one chosen.
  if (target.status !== "active") return { refused: "This keyword is not active." };
  const existing = target.aliases ?? [];
  if (existing.some((alias) => keywordMatchKey(alias) === group.key)) return { refused: "This keyword already has that alias." };
  const { hasDraft: _unused, _rev, ...document } = target;
  void _unused;
  const valid = validateProspectiveKeywordGraph(graph.keywords, { ...document, aliases: [...existing, group.key] });
  if (valid !== true) return { refused: valid };
  return {
    mutations: [
      stateGuard(graph),
      { patch: { id: target._id, ifRevisionID: _rev, set: { aliases: [...existing, group.key] } } },
    ],
  };
}

export type TermDecision = Readonly<{ _key?: string; key?: unknown; keyword?: unknown }>;

/** A damaged entry stops every sync, and rewriting the list is how Studio repairs it. */
const validDecisions = (existing: readonly TermDecision[] | null | undefined): readonly TermDecision[] => (Array.isArray(existing) ? existing : [])
  .filter((decision: TermDecision | null) => typeof decision?.key === "string" && typeof (decision.keyword as { _ref?: unknown } | undefined)?._ref === "string");

const decisionsDocument = (decisions: readonly TermDecision[]): KeywordReviewMutation => ({
  createOrReplace: { _id: KEYWORD_TERM_DECISIONS_ID, _type: "keywordTermDecisions", decisions },
});

/**
 * Records which keyword a path or a shared flat term means, for every photograph holding it, now and in later
 * imports. Serialized by the same state guard as every other keyword write, so the whole list can be replaced safely.
 */
export function planChooseKeyword(
  graph: KeywordReviewGraph,
  group: KeywordReviewGroup,
  choice: Readonly<{ documentId: string; keywordId: string }>,
  existing: readonly TermDecision[] | null | undefined,
  uuid: string,
): KeywordReviewPlan {
  const action = keywordReviewAction(group);
  // A flat term's mapping only narrows to its own keywords, while a path can name any keyword.
  const allowed = action === "choose-for-path" || (action === "choose-candidate" && group.candidates.includes(choice.keywordId));
  if (!allowed) return { refused: NOT_DECIDABLE };
  const kept = validDecisions(existing).filter((decision) => decision.key !== group.key);
  return {
    mutations: [
      stateGuard(graph),
      decisionsDocument([...kept, { _key: uuid, key: group.key, keyword: { _type: "reference", _ref: choice.documentId, _weak: true } }]),
    ],
  };
}

/** Takes a choice back. Its term returns to review on the next sync. */
export function planRemoveDecision(graph: KeywordReviewGraph, existing: readonly TermDecision[] | null | undefined, key: string): KeywordReviewPlan {
  return { mutations: [stateGuard(graph), decisionsDocument(validDecisions(existing).filter((decision) => decision.key !== key))] };
}

export type RecordedDecision = Readonly<{ key: string; documentId: string }>;

export const recordedDecisions = (existing: readonly TermDecision[] | null | undefined): readonly RecordedDecision[] =>
  validDecisions(existing).map((decision) => ({ key: decision.key as string, documentId: (decision.keyword as { _ref: string })._ref }));

export type NewKeywordInput = Readonly<{
  title: string;
  keywordId: string;
  categoryRef: string;
  /**
   * Chosen each time, with no default: an imported term can be someone's name, and ADR-0039 decision 7
   * has a person start internal, on a private path. A term cannot show which it is.
   */
  internal: boolean;
  /** An unpublished keyword already holds this id. */
  idReserved: boolean;
  /** The term stays as an alias, which a public keyword shows to anyone. */
  publicConfirmed: boolean;
  /** Where a path says it belongs. Optional, because the schema does not require a parent. */
  parentRef?: string;
  language: string;
  /** Injected: Sanity's own id for a new document. */
  uuid: string;
}>;

/**
 * Creates a draft, never a published keyword: an editor checks it and publishes it through the
 * keyword action, which holds the guard. A term that differs from the title stays as an alias.
 */
export function planCreateKeywordDraft(graph: KeywordReviewGraph, group: KeywordReviewGroup, input: NewKeywordInput): KeywordReviewPlan {
  if (!canCreateKeyword(group)) return { refused: NOT_DECIDABLE };
  const title = input.title.trim();
  if (title === "") return { refused: "A keyword needs a title." };
  if (!KEYWORD_ID_PATTERN.test(input.keywordId)) return { refused: "Use 2–40 lowercase letters, digits and single hyphens." };
  if (input.idReserved) return { refused: "An unpublished keyword already uses this ID." };
  // Also a retired or merged one: an ID is never reused, and on an internal keyword's private path it would replace that document.
  if ((graph.keywords as readonly { keywordId?: unknown }[]).some((row) => row.keywordId === input.keywordId)) return { refused: "This keyword ID is already in use." };
  const documentId = input.internal ? `keyword.${input.keywordId}` : input.uuid;
  // A path is never an alias. Its decision is private, and recorded after this keyword is published.
  const aliases = group.key.includes("|") || keywordMatchKey(title) === group.key ? [] : [group.key];
  if (!input.internal && aliases.length > 0 && !input.publicConfirmed) return { refused: PUBLIC_NOT_CONFIRMED };
  const document = {
    _id: documentId,
    _type: KEYWORD_TYPE_NAME,
    keywordId: input.keywordId,
    title: [{ _key: input.language, _type: LOCALIZED_TEXT_TYPE_NAME, language: input.language, value: title }],
    category: { _type: "reference", _ref: input.categoryRef },
    ...(input.parentRef === undefined || input.parentRef === "" ? {} : { parent: { _type: "reference", _ref: input.parentRef } }),
    ...(aliases.length === 0 ? {} : { aliases }),
    status: "active",
    visibility: input.internal ? "internal" : "public",
  };
  const valid = validateProspectiveKeywordGraph(graph.keywords, document);
  if (valid !== true) return { refused: valid };
  const draftId = `drafts.${documentId}`;
  return { draftId, mutations: [{ create: { ...document, _id: draftId } }] };
}

export const proposedKeywordId = (title: string): string => proposeKeywordId(title) ?? "";

export function keywordReviewOutcome(error: unknown): "conflict" | "failed" | "uncertain" {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return status === 409 ? "conflict" : typeof status === "number" && status >= 400 && status < 500 ? "failed" : "uncertain";
}

export function keywordReviewCopy(locale: string) {
  return /^fi(?:-|$)/u.test(locale) ? {
    title: "Avainsanojen tarkistus",
    intro: "Nämä tuodut termit eivät vastaa yhtä avainsanaa. Päätös koskee kaikkia kuvia, joissa termi on. Muutokset näkyvät kuvissa seuraavan synkronoinnin jälkeen.",
    empty: "Tarkistettavia termejä ei ole.",
    unavailable: "Tietoja ei voitu lukea.",
    occurrences: "Kuvia",
    examples: "Esimerkkejä",
    candidates: "Ehdokkaat",
    proposedCategory: "Ehdotettu kategoria",
    reasons: {
      unmatched: "Ei vastaavaa avainsanaa",
      "unmatched-beside-paths": "Ei vastaavaa avainsanaa, usein Lightroomin synonyymi",
      ambiguous: "Vastaa useaa avainsanaa",
      "path-mismatch": "Polku ei vastaa avainsanan paikkaa",
      "malformed-path": "Virheellinen polku",
    } as Record<string, string>,
    aliasHeading: "Lisää vaihtoehtoiseksi nimeksi",
    aliasKeyword: "Avainsana",
    aliasChoose: "Valitse avainsana",
    aliasAction: "Lisää",
    createHeading: "Luo uusi avainsana",
    createTitle: "Nimi",
    createId: "Tunniste",
    createCategory: "Kategoria",
    createChoose: "Valitse kategoria",
    createVisibility: "Näkyvyys",
    createChooseVisibility: "Valitse näkyvyys",
    createPublic: "Julkinen",
    createInternal: "Sisäinen, esimerkiksi henkilö. Ei näy julkisesti.",
    createAction: "Luo luonnos",
    openDraft: "Avaa luonnos ja julkaise",
    done: "Tallennettu. Aja synkronointi, niin päätös koskee kuvia.",
    draftDone: "Luonnos luotu. Tarkista ja julkaise se, ja aja sitten synkronointi.",
    publicConfirm: "Tämä nimi on julkisesti luettavissa julkisella avainsanalla, ja se saa olla julkinen: {name}",
    choosePathHeading: "Valitse, mitä avainsanaa tämä polku tarkoittaa. Valinta pysyy yksityisenä.",
    createParent: "Yläkäsite",
    createNoParent: "Ei yläkäsitettä",
    decisionsHeading: "Tehdyt valinnat",
    decisionRemove: "Poista",
    conflict: "Tiedot muuttuivat samaan aikaan. Mitään ei tallennettu. Yritä uudelleen.",
    failed: "Tallennus ei onnistunut. Tarkista oikeutesi.",
    uncertain: "Tallennuksen tilaa ei saatu selville. Tarkista tilanne ennen uutta yritystä.",
    fixSource: "Korjaa polku lähdetiedostossa ja tuo kuva uudelleen.",
    chooseHeading: "Valitse, mitä avainsanaa tämä termi tarkoittaa",
    chooseAction: "Käytä tätä",
    refused: { "This term cannot be decided here.": "Tätä termiä ei voi ratkaista täällä.", "This keyword is not active.": "Avainsana ei ole käytössä.", "This keyword has an unpublished draft. Publish or discard it first.": "Avainsanalla on julkaisematon luonnos. Julkaise tai hylkää se ensin.", "This keyword already has that alias.": "Avainsanalla on jo tämä vaihtoehtoinen nimi.", "A keyword needs a title.": "Avainsana tarvitsee nimen.", "An unpublished keyword already uses this ID.": "Julkaisematon avainsana käyttää jo tätä tunnistetta.", "This keyword ID is already in use.": "Tämä tunniste on jo käytössä.", "Confirm that this name may be public.": "Vahvista, että tämä nimi saa olla julkinen.", "Use 2–40 lowercase letters, digits and single hyphens.": "Käytä 2–40 pientä kirjainta, numeroa ja yksittäistä väliviivaa." } as Record<string, string>,
  } : {
    title: "Keyword review",
    intro: "These imported terms do not match one keyword. A decision covers every photograph holding the term. Changes reach the photographs after the next sync.",
    empty: "No terms to review.",
    unavailable: "The data could not be read.",
    occurrences: "Photographs",
    examples: "Examples",
    candidates: "Candidates",
    proposedCategory: "Proposed category",
    reasons: {
      unmatched: "No matching keyword",
      "unmatched-beside-paths": "No matching keyword, often a Lightroom synonym",
      ambiguous: "Matches more than one keyword",
      "path-mismatch": "The path does not match the keyword's place",
      "malformed-path": "Malformed path",
    } as Record<string, string>,
    aliasHeading: "Add as an alias",
    aliasKeyword: "Keyword",
    aliasChoose: "Choose a keyword",
    aliasAction: "Add",
    createHeading: "Create a new keyword",
    createTitle: "Name",
    createId: "ID",
    createCategory: "Category",
    createChoose: "Choose a category",
    createVisibility: "Visibility",
    createChooseVisibility: "Choose visibility",
    createPublic: "Public",
    createInternal: "Internal, for example a person. Not shown publicly.",
    createAction: "Create a draft",
    openDraft: "Open the draft and publish",
    done: "Saved. Run the sync so the decision reaches the photographs.",
    draftDone: "Draft created. Check and publish it, then run the sync.",
    publicConfirm: "On a public keyword anyone can read this name, and it may be public: {name}",
    choosePathHeading: "Choose which keyword this path means. The choice stays private.",
    createParent: "Parent",
    createNoParent: "No parent",
    decisionsHeading: "Recorded choices",
    decisionRemove: "Remove",
    conflict: "The data changed at the same time. Nothing was saved. Try again.",
    failed: "Saving failed. Check your permissions.",
    uncertain: "Whether the save succeeded could not be determined. Check before trying again.",
    fixSource: "Correct the path in the source file and import the photograph again.",
    chooseHeading: "Choose which keyword this term means",
    chooseAction: "Use this one",
    refused: {} as Record<string, string>,
  };
}
