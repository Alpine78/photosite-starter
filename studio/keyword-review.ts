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

export const REPRESENTATIVE_MEDIA_LIMIT = 5;

/** Records with something to review, read with the signed-in editor's own access. */
export const KEYWORD_REVIEW_RECORDS_QUERY = `*[_type == "keywordRecord" && count(reviewItems) > 0]{mediaId, reviewItems}`;

/** The keyword as published, and whether anything unpublished would overwrite it. Reads with the raw perspective. */
export const KEYWORD_ALIAS_TARGET_QUERY = `{
  "target": *[_id == $id][0]{_id, _rev, keywordId, title, category, parent, aliases, status, mergedInto, visibility},
  "hasDraft": count(*[_id == $draftId || _id in path($versions)]) > 0
}`;
export const keywordAliasTargetParams = (id: string) => ({ id, draftId: `drafts.${id}`, versions: `versions.*.${id}` });

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
  const groups = new Map<string, { reason: string; key: string; terms: Set<string>; mediaIds: Set<string>; candidates: Set<string>; proposedCategoryTerm: string | null }>();
  for (const record of records) {
    if (typeof record.mediaId !== "string" || !Array.isArray(record.reviewItems)) continue;
    for (const item of record.reviewItems as readonly RawItem[]) {
      if (typeof item?.reason !== "string" || typeof item.key !== "string") continue;
      const id = `${item.reason}\u0000${item.key}`;
      const group = groups.get(id) ?? { reason: item.reason, key: item.key, terms: new Set<string>(), mediaIds: new Set<string>(), candidates: new Set<string>(), proposedCategoryTerm: null };
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
 * What a term's reason lets an editor decide here. A malformed path never reaches the vocabulary,
 * and a flat name shared by two categories stays ambiguous whatever is added: both are settled
 * where they live, in the source file or on the keywords themselves. An ambiguous path can
 * still be decided, because a whole-path alias takes precedence over the hierarchy.
 */
export function keywordReviewAction(group: Pick<KeywordReviewGroup, "reason" | "key">): "decide" | "fix-source" | "fix-keywords" {
  if (group.reason === "malformed-path") return "fix-source";
  return group.reason === "ambiguous" && !group.key.includes("|") ? "fix-keywords" : "decide";
}

/** The category the import's root term names, when one does. */
export function proposedCategoryId(group: KeywordReviewGroup, categories: readonly Readonly<{ _id: string; name?: string }>[]): string {
  if (group.proposedCategoryTerm === null) return "";
  const key = keywordMatchKey(group.proposedCategoryTerm);
  return categories.find((category) => category.name !== undefined && keywordMatchKey(category.name) === key)?._id ?? "";
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

const NOT_DECIDABLE = "This term cannot be decided here." as const;

export function planAddAlias(graph: KeywordReviewGraph, group: KeywordReviewGroup, target: AliasTarget): KeywordReviewPlan {
  if (keywordReviewAction(group) !== "decide") return { refused: NOT_DECIDABLE };
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

export type NewKeywordInput = Readonly<{
  title: string;
  keywordId: string;
  categoryRef: string;
  /** A person keyword starts internal (ADR-0039 decision 7), on a private path. */
  internal: boolean;
  language: string;
  /** Injected: Sanity's own id for a new document. */
  uuid: string;
}>;

/**
 * Creates a draft, never a published keyword: an editor checks it and publishes it through the
 * keyword action, which holds the guard. A term that differs from the title stays as an alias.
 */
export function planCreateKeywordDraft(graph: KeywordReviewGraph, group: KeywordReviewGroup, input: NewKeywordInput): KeywordReviewPlan {
  if (keywordReviewAction(group) !== "decide") return { refused: NOT_DECIDABLE };
  const title = input.title.trim();
  if (title === "") return { refused: "A keyword needs a title." };
  if (!KEYWORD_ID_PATTERN.test(input.keywordId)) return { refused: "Use 2–40 lowercase letters, digits and single hyphens." };
  const documentId = input.internal ? `keyword.${input.keywordId}` : input.uuid;
  const aliases = keywordMatchKey(title) === group.key ? [] : [group.key];
  const document = {
    _id: documentId,
    _type: KEYWORD_TYPE_NAME,
    keywordId: input.keywordId,
    title: [{ _key: input.language, language: input.language, value: title }],
    category: { _type: "reference", _ref: input.categoryRef },
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
    createInternal: "Sisäinen, esimerkiksi henkilö. Ei näy julkisesti.",
    createAction: "Luo luonnos",
    openDraft: "Avaa luonnos ja julkaise",
    done: "Tallennettu. Aja synkronointi, niin päätös koskee kuvia.",
    conflict: "Tiedot muuttuivat samaan aikaan. Mitään ei tallennettu. Yritä uudelleen.",
    failed: "Tallennus ei onnistunut. Tarkista oikeutesi.",
    uncertain: "Tallennuksen tilaa ei saatu selville. Tarkista tilanne ennen uutta yritystä.",
    fixSource: "Korjaa polku lähdetiedostossa ja tuo kuva uudelleen.",
    fixKeywords: "Tämä nimi kuuluu usealle avainsanalle. Muuta niitä niin, että nimi on vain yhdellä, ja aja synkronointi.",
    refused: { "This term cannot be decided here.": "Tätä termiä ei voi ratkaista täällä.", "This keyword is not active.": "Avainsana ei ole käytössä.", "This keyword has an unpublished draft. Publish or discard it first.": "Avainsanalla on julkaisematon luonnos. Julkaise tai hylkää se ensin.", "This keyword already has that alias.": "Avainsanalla on jo tämä vaihtoehtoinen nimi.", "A keyword needs a title.": "Avainsana tarvitsee nimen.", "Use 2–40 lowercase letters, digits and single hyphens.": "Käytä 2–40 pientä kirjainta, numeroa ja yksittäistä väliviivaa." } as Record<string, string>,
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
    createInternal: "Internal, for example a person. Not shown publicly.",
    createAction: "Create a draft",
    openDraft: "Open the draft and publish",
    done: "Saved. Run the sync so the decision reaches the photographs.",
    conflict: "The data changed at the same time. Nothing was saved. Try again.",
    failed: "Saving failed. Check your permissions.",
    uncertain: "Whether the save succeeded could not be determined. Check before trying again.",
    fixSource: "Correct the path in the source file and import the photograph again.",
    fixKeywords: "This name belongs to more than one keyword. Change them so that only one holds it, then run the sync.",
    refused: {} as Record<string, string>,
  };
}
