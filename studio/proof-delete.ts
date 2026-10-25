/**
 * Deleting a proof gallery with its private records (ADR-0038 decision 7,
 * action item 6, AB#130): pure inventory, the guarded transaction and its
 * outcome. No CMS client or browser globals; the action supplies the reads and
 * the commit.
 *
 * Completeness rests on deterministic IDs read fresh from the Doc API, not on
 * the eventually consistent query index: versions and notices 1..latestVersion,
 * reminder steps up to the latest one any clock could have reached. Every
 * customer write and reminder claim patches `proofTerms.<id>` under its
 * revision, and the deletion asserts the revision it read first, so a record
 * created after the inventory either makes the deletion conflict or fails
 * itself. Each listed document is deleted at the revision shown; an absent
 * fixed document is asserted absent with a `create` that fails if it appeared.
 * The gallery's image assets are revision-guarded and deleted with it (owner decision 2026-10-24)
 * unless the index shows another document using one; Content Lake refuses to
 * delete an asset that is still referenced, which fails the whole transaction.
 */

const GALLERY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/u;
const REVISION = /^[A-Za-z0-9_-]{1,128}$/u;
const DAY_MS = 86_400_000;
/** The site's step length, version limit and step limit (`proof-reminder.ts`, `proof-selection.ts`). */
export const PROOF_DELETE_REMINDER_STEP_MS = 30 * DAY_MS;
export const PROOF_DELETE_MAX_VERSION = 999;
export const PROOF_DELETE_MAX_REMINDER_STEP = 9_999;
/** Doc API IDs per request, keeping the URL far below the 15 KB header limit. */
export const PROOF_DELETE_READ_CHUNK = 40;
/** Mutation bodies are limited to 4 MB; the deletion is never split, so a larger one is refused. */
export const PROOF_DELETE_MAX_BODY_BYTES = 3_500_000;
const SWEEP_LIMIT = 5;
const IMAGE_ASSET_ID = /^image-[A-Za-z0-9_-]{1,128}-\d{1,6}x\d{1,6}-[a-z0-9]{1,8}$/u;

export const proofDeletionIds = (galleryId: string) => ({
  published: galleryId,
  draft: `drafts.${galleryId}`,
  terms: `proofTerms.${galleryId}`,
  selection: `proofSelection.${galleryId}`,
  version: (n: number) => `proofSelection.${galleryId}.v${n}`,
  notice: (n: number) => `proofNotice.${galleryId}.v${n}`,
  reminder: (n: number) => `proofReminder.${galleryId}.${n}`,
});

export type DeletionRecord = Readonly<{ id: string; revision: string }>;
export type ProofDeletionInventory = Readonly<{
  galleryId: string;
  published?: DeletionRecord; draft?: DeletionRecord; terms?: DeletionRecord; selection?: DeletionRecord;
  versions: readonly DeletionRecord[]; notices: readonly DeletionRecord[]; reminders: readonly DeletionRecord[];
  /** Fresh image revisions reviewed for deletion with the gallery. */
  assets: readonly DeletionRecord[];
  /** Image assets another document uses, kept. */
  sharedAssets: readonly string[];
}>;
export type ProofDeletionBlock = "unreadable" | "inconsistent" | "copies" | "unexpected" | "referenced" | "too-large" | "nothing";
export type ProofDeletionReadiness = Readonly<{ ready: ProofDeletionInventory }> | Readonly<{ reason: ProofDeletionBlock; ids?: readonly string[] }>;

/** One Doc API response (`documents`, `omitted`), unparsed. */
export type ProofDeletionReader = Readonly<{
  /** Fresh reads by ID; `allVersions` adds drafts and release versions of each ID. */
  docs(ids: readonly string[], allVersions: boolean): Promise<unknown>;
  /** The query index, a supplementary check: `PROOF_DELETE_SWEEP_QUERY` with `$galleryId`, `$ids` and `$assetIds`. */
  sweep(galleryId: string, ids: readonly string[], assetIds: readonly string[]): Promise<unknown>;
}>;

/**
 * Records of the gallery outside the inventory, documents outside it that
 * reference one inside, and the gallery's assets another document uses.
 */
export const PROOF_DELETE_SWEEP_QUERY = `{
  "extra": *[galleryId == $galleryId && !(_id in $ids)][0...${SWEEP_LIMIT}]._id,
  "referencing": *[references($ids) && !(_id in $ids)][0...${SWEEP_LIMIT}]._id,
  "sharedAssets": $assetIds[count(*[references(^) && !(_id in $ids)]) > 0]
}`;

class Blocked extends Error {
  constructor(readonly reason: ProofDeletionBlock, readonly ids?: readonly string[]) { super(reason); }
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

function canonicalInstant(value: unknown): number | undefined {
  if (typeof value !== "string" || value.length > 30) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : undefined;
}

/**
 * Exactly the requested IDs: a document, or `undefined` when the API reports it
 * does not exist. Anything else — a permission omission, an unreported ID, a
 * document not requested — is unreadable, never "no record".
 */
export async function readProofDocuments(reader: ProofDeletionReader, ids: readonly string[]): Promise<Map<string, Record<string, unknown> | undefined>> {
  const found = new Map<string, Record<string, unknown> | undefined>();
  for (let start = 0; start < ids.length; start += PROOF_DELETE_READ_CHUNK) {
    const chunk = ids.slice(start, start + PROOF_DELETE_READ_CHUNK);
    const body = record(await reader.docs(chunk, false));
    if (!body || !Array.isArray(body.documents) || (body.omitted !== undefined && !Array.isArray(body.omitted))) throw new Blocked("unreadable");
    for (const value of body.documents) {
      const doc = record(value);
      if (!doc || typeof doc._id !== "string" || !chunk.includes(doc._id) || found.has(doc._id)) throw new Blocked("unreadable");
      found.set(doc._id, doc);
    }
    for (const value of (body.omitted ?? []) as unknown[]) {
      const entry = record(value);
      if (!entry || typeof entry.id !== "string" || !chunk.includes(entry.id) || found.has(entry.id) || entry.reason !== "existence") throw new Blocked("unreadable");
      found.set(entry.id, undefined);
    }
    if (chunk.some((id) => !found.has(id))) throw new Blocked("unreadable");
  }
  return found;
}

/** Fail closed on unreadable variants or a revision changing during collection. */
export async function proofDocumentCopies(
  reader: ProofDeletionReader, bases: readonly string[],
  expected: ReadonlyMap<string, Record<string, unknown> | undefined>, allowedDraft?: string,
): Promise<string[]> {
  const copies: string[] = [];
  for (let start = 0; start < bases.length; start += PROOF_DELETE_READ_CHUNK) {
    const chunk = bases.slice(start, start + PROOF_DELETE_READ_CHUNK);
    const body = record(await reader.docs(chunk, true));
    if (!body || !Array.isArray(body.documents) || !Array.isArray(body.omitted)) throw new Blocked("unreadable");
    const seen = new Set<string>();
    for (const value of body.documents) {
      const doc = record(value), id = doc?._id;
      if (!doc || typeof id !== "string" || seen.has(id)) throw new Blocked("unreadable");
      seen.add(id);
      if (chunk.includes(id) || id === allowedDraft && chunk.includes(id.slice(7))) {
        if (doc._rev !== expected.get(id)?._rev) throw new Blocked("inconsistent");
      } else if (chunk.some((base) => id === `drafts.${base}` || id.startsWith("versions.") && id.endsWith(`.${base}`))) copies.push(id);
      else throw new Blocked("unreadable");
    }
    for (const value of body.omitted) {
      const entry = record(value);
      if (!entry || typeof entry.id !== "string" || !chunk.includes(entry.id) || seen.has(entry.id) || entry.reason !== "existence" || expected.get(entry.id)) throw new Blocked("unreadable");
      seen.add(entry.id);
    }
    if (chunk.some((id) => !seen.has(id))) throw new Blocked("unreadable");
    if (allowedDraft && chunk.includes(allowedDraft.slice(7)) && expected.get(allowedDraft) && !seen.has(allowedDraft)) throw new Blocked("unreadable");
  }
  return copies;
}

function revisionOf(doc: Record<string, unknown> | undefined, type: string, galleryId: string | undefined): DeletionRecord | undefined {
  if (!doc) return undefined;
  if (doc._type !== type || typeof doc._rev !== "string" || !REVISION.test(doc._rev) || (galleryId !== undefined && doc.galleryId !== galleryId)) throw new Blocked("inconsistent");
  return { id: doc._id as string, revision: doc._rev };
}

/** The image assets the gallery's items use, each once; a malformed reference blocks. */
function galleryAssets(...docs: (Record<string, unknown> | undefined)[]): string[] {
  const assets = new Set<string>();
  for (const doc of docs) {
    if (!doc || doc.items === undefined) continue;
    if (!Array.isArray(doc.items)) throw new Blocked("inconsistent");
    for (const item of doc.items) {
      const image = record(record(item)?.image);
      if (image?.asset === undefined) continue;
      const ref = record(image.asset)?._ref;
      if (typeof ref !== "string" || !IMAGE_ASSET_ID.test(ref)) throw new Blocked("inconsistent");
      assets.add(ref);
    }
  }
  return [...assets];
}

/** Reminder steps up to the latest any clock could have claimed: one step past the shortest delay, now. */
export function proofDeletionReminderSteps(firstPublishedAt: number, now: number): number {
  const steps = Math.floor((now - firstPublishedAt) / PROOF_DELETE_REMINDER_STEP_MS) + 2;
  return Math.min(PROOF_DELETE_MAX_REMINDER_STEP, Math.max(0, steps));
}

/**
 * Collects what a deletion removes, terms first. Blocks rather than guesses:
 * a document it cannot read, a malformed record, a draft or release copy of
 * any record, a record or reference the index shows outside the inventory.
 */
export async function collectProofDeletion(galleryId: string, reader: ProofDeletionReader, now: number): Promise<ProofDeletionReadiness> {
  if (!GALLERY_ID.test(galleryId)) return { reason: "inconsistent" };
  const ids = proofDeletionIds(galleryId);
  try {
    const fixed = await readProofDocuments(reader, [ids.terms, ids.published, ids.draft, ids.selection]);
    const termsDoc = fixed.get(ids.terms), selectionDoc = fixed.get(ids.selection);
    const terms = revisionOf(termsDoc, "clientProofTerms", galleryId);
    const published = revisionOf(fixed.get(ids.published), "clientProofGallery", undefined);
    const draft = revisionOf(fixed.get(ids.draft), "clientProofGallery", undefined);
    const selection = revisionOf(selectionDoc, "clientProofSelection", galleryId);
    const latestVersion = selectionDoc ? selectionDoc.latestVersion : 0;
    if (!Number.isSafeInteger(latestVersion) || (latestVersion as number) < 0 || (latestVersion as number) > PROOF_DELETE_MAX_VERSION) throw new Blocked("inconsistent");
    let steps = 0;
    if (termsDoc) {
      const first = canonicalInstant(termsDoc.firstPublishedAt);
      if (first === undefined) throw new Blocked("inconsistent");
      steps = proofDeletionReminderSteps(first, now);
    }
    const numbers = (count: number) => Array.from({ length: count }, (_, index) => index + 1);
    const versionIds = numbers(latestVersion as number).map(ids.version), noticeIds = numbers(latestVersion as number).map(ids.notice);
    const reminderIds = numbers(steps).map(ids.reminder);
    const assetIds = galleryAssets(fixed.get(ids.published), fixed.get(ids.draft));
    const variable = await readProofDocuments(reader, [...versionIds, ...noticeIds, ...reminderIds, ...assetIds]);
    const present = (list: string[], type: string) => list.flatMap((id) => {
      const found = revisionOf(variable.get(id), type, galleryId);
      return found ? [found] : [];
    });
    const inventory: ProofDeletionInventory = {
      galleryId, ...(published ? { published } : {}), ...(draft ? { draft } : {}), ...(terms ? { terms } : {}), ...(selection ? { selection } : {}),
      versions: present(versionIds, "clientProofSelectionVersion"), notices: present(noticeIds, "clientProofNotice"),
      reminders: present(reminderIds, "clientProofReminder"),
      assets: assetIds.map((id) => {
        const asset = revisionOf(variable.get(id), "sanity.imageAsset", undefined);
        if (!asset) throw new Blocked("inconsistent");
        return asset;
      }), sharedAssets: [],
    };
    const listed = inventoryIds(inventory);
    if (listed.length === 0) return { reason: "nothing" };

    // Check complete, fresh all-versions responses, including permission omissions.
    const bases = [ids.published, ids.terms, ids.selection, ...versionIds, ...noticeIds, ...reminderIds];
    const expected = new Map([...fixed, ...variable]);
    const copies = await proofDocumentCopies(reader, bases, expected, ids.draft);
    if (copies.length > 0) return { reason: "copies", ids: copies.slice(0, SWEEP_LIMIT) };

    const swept = record(await reader.sweep(galleryId, listed, inventory.assets.map((asset) => asset.id)));
    const list = (value: unknown) => Array.isArray(value) && value.every((id) => typeof id === "string") ? value as string[] : undefined;
    const extra = list(swept?.extra), referencing = list(swept?.referencing), shared = list(swept?.sharedAssets);
    if (!extra || !referencing || !shared || shared.some((id) => !inventory.assets.some((asset) => asset.id === id))) return { reason: "unreadable" };
    if (extra.length > 0) return { reason: "unexpected", ids: extra };
    if (referencing.length > 0) return { reason: "referenced", ids: referencing };
    const ready = { ...inventory, assets: inventory.assets.filter((asset) => !shared.includes(asset.id)), sharedAssets: shared };
    if (new TextEncoder().encode(JSON.stringify({ mutations: planProofDeletion(ready, new Date(now).toISOString()) })).byteLength > PROOF_DELETE_MAX_BODY_BYTES) return { reason: "too-large" };
    return { ready };
  } catch (error) {
    if (error instanceof Blocked) return { reason: error.reason, ...(error.ids ? { ids: error.ids } : {}) };
    return { reason: "unreadable" };
  }
}

/** The gallery and its records; the assets are listed separately. */
export function inventoryIds(inventory: ProofDeletionInventory): string[] {
  return [inventory.terms, inventory.published, inventory.draft, inventory.selection, ...inventory.versions, ...inventory.notices, ...inventory.reminders]
    .flatMap((entry) => entry ? [entry.id] : []);
}

export type ProofDeletionMutation =
  | Readonly<{ patch: { id: string; ifRevisionID: string; set: Record<string, string> } }>
  | Readonly<{ create: { _id: string; _type: string } }>
  | Readonly<{ delete: { id: string } }>;

/** Guard every reviewed asset before deletion; shared assets never enter this list. */
export function planProofAssetDeletion(assets: readonly DeletionRecord[], now: string): ProofDeletionMutation[] {
  if (new Set(assets.map((asset) => asset.id)).size !== assets.length) throw new Error("Duplicate proof image");
  return assets.flatMap((asset) => [
    { patch: { id: asset.id, ifRevisionID: asset.revision, set: { proofDeletionAt: now } } },
    { delete: { id: asset.id } },
  ]);
}

/**
 * One transaction. A listed document is patched under the revision shown, then
 * deleted; an absent gallery, draft, terms or selection is created and deleted
 * again, which fails if it appeared meanwhile. The terms guard comes first;
 * the assets go last, once nothing in the transaction references them.
 */
export function planProofDeletion(inventory: ProofDeletionInventory, now: string): ProofDeletionMutation[] {
  const ids = proofDeletionIds(inventory.galleryId);
  const guarded = (entry: DeletionRecord): ProofDeletionMutation[] =>
    [{ patch: { id: entry.id, ifRevisionID: entry.revision, set: { proofDeletionAt: now } } }, { delete: { id: entry.id } }];
  const fixed = (entry: DeletionRecord | undefined, id: string, type: string): ProofDeletionMutation[] =>
    entry ? guarded(entry) : [{ create: { _id: id, _type: type } }, { delete: { id } }];
  return [
    ...fixed(inventory.terms, ids.terms, "clientProofTerms"),
    ...fixed(inventory.published, ids.published, "clientProofGallery"),
    ...fixed(inventory.draft, ids.draft, "clientProofGallery"),
    ...fixed(inventory.selection, ids.selection, "clientProofSelection"),
    ...[...inventory.versions, ...inventory.notices, ...inventory.reminders].flatMap(guarded),
    ...planProofAssetDeletion(inventory.assets, now),
  ];
}

export type ProofDeletionCommit = (mutations: ProofDeletionMutation[]) => Promise<void>;
export type ProofDeletionOutcome = "deleted" | "conflict" | "refused" | "uncertain";

/**
 * One attempt, never retried: a conflict means something changed and needs a
 * fresh review; another client error means nothing was written; anything else
 * (a lost response, a server error) leaves the outcome unknown until re-read.
 */
export async function runProofDeletion(mutations: ProofDeletionMutation[], commit: ProofDeletionCommit): Promise<ProofDeletionOutcome> {
  try {
    await commit(mutations);
    return "deleted";
  } catch (error) {
    const status = (error as { statusCode?: unknown } | null)?.statusCode;
    if (status === 409) return "conflict";
    return typeof status === "number" && status >= 400 && status < 500 ? "refused" : "uncertain";
  }
}

/** At most one deletion in flight per dialog; a second press while it runs is ignored. */
export function createProofDeletionGuard() {
  let running = false;
  return async (mutations: ProofDeletionMutation[], commit: ProofDeletionCommit): Promise<ProofDeletionOutcome | "busy"> => {
    if (running) return "busy";
    running = true;
    try { return await runProofDeletion(mutations, commit); } finally { running = false; }
  };
}

export function proofDeletionCounts(inventory: ProofDeletionInventory) {
  return {
    gallery: (inventory.published ? 1 : 0) + (inventory.draft ? 1 : 0), terms: inventory.terms ? 1 : 0, selection: inventory.selection ? 1 : 0,
    versions: inventory.versions.length, notices: inventory.notices.length, reminders: inventory.reminders.length,
    images: inventory.assets.length, sharedImages: inventory.sharedAssets.length,
  };
}

export function proofDeleteCopy(locale: string) {
  return /^fi(?:-|$)/u.test(locale) ? {
    action: "Poista vedosgalleria ja sen tiedot", confirm: "Poista pysyvästi", cancel: "Peruuta", close: "Sulje", reload: "Lataa uudelleen",
    working: "Poistetaan…", loading: "Luetaan poistettavia tietoja…",
    explain: "Poistaa samassa transaktiossa gallerian ja kaikki sen yksityiset tiedot. Asiakkaan sivu ja valintalinkki lakkaavat toimimasta.",
    counts: { gallery: "Galleriadokumentit (julkaistu ja luonnos)", terms: "Yksityiset ehdot (hinnat, avain, muistutusten asetukset ja osoite)", selection: "Työn alla oleva valinta",
      versions: "Vahvistetut valintaversiot", notices: "Ilmoitukset valokuvaajalle", reminders: "Muistutukset",
      images: "Kuvatiedostot", sharedImages: "Kuvatiedostot, joita muu sisältö käyttää (säilytetään)" },
    limits: [
      "Gallerian kuvatiedostot poistetaan, paitsi kuva, jota muu sisältö käyttää. Ladatut ja kopioidut kuvat säilyvät, ja CDN voi tarjoilla poistettua kuvaa välimuistista vielä hetken.",
      "Sanity säilyttää dokumenttien aiemmat versiot historiassaan oman säilytysaikansa; tämä ei tyhjennä historiaa eikä varmuuskopioita.",
      "Jo lähetettyjä tai parhaillaan lähteviä sähköposteja ei voi perua.",
    ],
    typeId: "Vahvista kirjoittamalla gallerian tunniste {id}",
    deleted: "Vedosgalleria ja sen tiedot poistettiin.",
    conflict: "Tiedot muuttuivat tällä välin tai muu sisältö käyttää kuvaa, joten mitään ei poistettu. Lataa uudelleen ja tarkista luettelo ennen uutta yritystä.",
    refused: "Sanity hylkäsi poiston, eikä mitään poistettu. Tarkista oikeutesi ja viittaukset galleriaan.",
    uncertain: "Tulos ei selvinnyt. Älä yritä heti uudelleen: lataa uudelleen ja tarkista, onko galleria jo poistettu.",
    off: "Vedosgalleriat eivät ole käytössä tässä Studiossa.", unavailable: "Toiminto ei ole nyt käytettävissä.",
    unreadable: "Kaikkia gallerian tietoja ei voitu lukea, joten poistoa ei voi koota luotettavasti. Mitään ei poistettu.",
    inconsistent: "Gallerian tiedot ovat ristiriitaiset, joten poistoa ei koottu. Tarkista myös puuttuvat kuvat ja lataa luettelo uudelleen. Mitään ei poistettu.",
    copies: "Jollakin tiedolla on luonnos tai julkaisuversio (release). Poista ne ensin: {ids}",
    unexpected: "Galleriaan liittyy tietoja, joita poisto ei tunne: {ids}",
    referenced: "Muu sisältö viittaa poistettaviin tietoihin. Poista viittaukset ensin: {ids}",
    "too-large": "Poisto on liian suuri yhdeksi transaktioksi, eikä sitä jaeta osiin.",
    nothing: "Poistettavaa ei ole.",
  } : {
    action: "Delete proof gallery and its records", confirm: "Delete permanently", cancel: "Cancel", close: "Close", reload: "Reload",
    working: "Deleting…", loading: "Reading what will be deleted…",
    explain: "Deletes the gallery and all its private records in one transaction. The customer's page and selection link stop working.",
    counts: { gallery: "Gallery documents (published and draft)", terms: "Private terms (prices, key, reminder settings and address)", selection: "Working selection",
      versions: "Confirmed selection versions", notices: "Photographer notices", reminders: "Reminders",
      images: "Image files", sharedImages: "Image files other content uses (kept)" },
    limits: [
      "The gallery's image files are deleted, except an image other content uses. Downloaded or copied images remain, and the CDN may serve a deleted image from its cache for a while.",
      "Sanity keeps earlier document revisions in its history for its own retention period; this clears neither history nor backups.",
      "Emails already sent or being sent cannot be withdrawn.",
    ],
    typeId: "Confirm by typing the gallery ID {id}",
    deleted: "The proof gallery and its records were deleted.",
    conflict: "The records changed meanwhile or other content uses an image, so nothing was deleted. Reload and check the list before trying again.",
    refused: "Sanity refused the deletion and nothing was deleted. Check your permissions and references to the gallery.",
    uncertain: "The outcome is unknown. Do not retry straight away: reload and check whether the gallery is already gone.",
    off: "Proof galleries are not enabled in this Studio.", unavailable: "This action is not available now.",
    unreadable: "Not every record of the gallery could be read, so the deletion cannot be assembled reliably. Nothing was deleted.",
    inconsistent: "The gallery's records are inconsistent, so no deletion was assembled. Check for missing images and reload the list. Nothing was deleted.",
    copies: "A record has a draft or a release version. Remove those first: {ids}",
    unexpected: "Records belong to the gallery that the deletion does not know: {ids}",
    referenced: "Other content references records being deleted. Remove the references first: {ids}",
    "too-large": "The deletion is too large for one transaction, and it is never split.",
    nothing: "There is nothing to delete.",
  };
}
