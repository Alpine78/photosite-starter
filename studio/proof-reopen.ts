/**
 * Reopening a confirmed proof selection (ADR-0038 decision 5, AB#130): pure
 * readiness, the guarded patch and its outcome. No CMS client or browser
 * globals; the action supplies the commit.
 */
import { transactionSyncLocked } from "./editor-lock";

/** The highest version the site's confirmation planner writes (`PROOF_MAX_VERSION`). */
export const PROOF_REOPEN_MAX_VERSION = 999;
const GALLERY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/u;
const REVISION = /^[A-Za-z0-9_-]{1,128}$/u;

export type ReopenRequest = Readonly<{ id: string; revision: string; latestVersion: number }>;
export type ReopenReadiness = Readonly<{ ready: ReopenRequest }> | Readonly<{ reason: "off" | "not-confirmed" | "limit" | "unavailable" }>;

/** Ready only for exactly a confirmed working selection, captured as reviewed. */
export function reopenReadiness(state: {
  id: string; type: string; ready: boolean; draft: unknown; published: unknown; version?: unknown; transactionSyncLock?: unknown;
}, enabled: boolean): ReopenReadiness {
  if (!enabled) return { reason: "off" };
  if (state.type !== "clientProofSelection" || !state.ready || state.draft != null || state.version != null || transactionSyncLocked(state.transactionSyncLock)) return { reason: "unavailable" };
  const doc = state.published as Record<string, unknown> | null | undefined;
  if (!doc || typeof doc !== "object" || doc._type !== "clientProofSelection" || typeof doc.galleryId !== "string" || !GALLERY_ID.test(doc.galleryId) ||
    doc._id !== state.id || state.id !== `proofSelection.${doc.galleryId}` || typeof doc._rev !== "string" || !REVISION.test(doc._rev) ||
    !Number.isSafeInteger(doc.latestVersion)) return { reason: "unavailable" };
  if (doc.state !== "confirmed" || (doc.latestVersion as number) < 1) return { reason: "not-confirmed" };
  // A reopened selection at the limit could never be confirmed again.
  if ((doc.latestVersion as number) >= PROOF_REOPEN_MAX_VERSION) return { reason: "limit" };
  return { ready: { id: state.id, revision: doc._rev, latestVersion: doc.latestVersion as number } };
}

export type ReopenCommit = (id: string, revision: string) => Promise<void>;
export type ReopenOutcome = "reopened" | "conflict" | "uncertain";

/** At most one reopen in flight per dialog; a second press while it runs is ignored. */
export function createReopenGuard() {
  let running = false;
  return async (request: ReopenRequest, commit: ReopenCommit): Promise<ReopenOutcome | "busy"> => {
    if (running) return "busy";
    running = true;
    try { return await runReopen(request, commit); } finally { running = false; }
  };
}

/** One guarded attempt against the captured revision; never retried with a newer one. */
export async function runReopen(request: ReopenRequest, commit: ReopenCommit): Promise<ReopenOutcome> {
  try {
    await commit(request.id, request.revision);
    return "reopened";
  } catch (error) {
    const status = (error as { statusCode?: unknown } | null)?.statusCode;
    return status === 409 ? "conflict" : "uncertain";
  }
}

export function proofReopenCopy(locale: string) {
  return /^fi(?:-|$)/u.test(locale) ? {
    action: "Avaa valinta uudelleen", confirm: "Avaa valinta", cancel: "Peruuta", close: "Sulje", working: "Avataan…",
    explain: "Asiakas voi muuttaa valintaa ja vahvistaa uuden version {next}. Vahvistettu versio {current} ja sen ilmoitus säilyvät. Asiakkaan jo avoin sivu päivittyy, kun hän lataa sen uudelleen.",
    reopened: "Valinta avattiin. Asiakas voi nyt muuttaa sitä.",
    conflict: "Valinta muuttui tällä välin. Mitään ei muutettu; lataa näkymä ja tarkista tilanne ennen uutta yritystä.",
    uncertain: "Tulos ei selvinnyt. Lataa näkymä ja tarkista valinnan tila ennen uutta yritystä.",
    off: "Vedosgalleriat eivät ole käytössä tässä Studiossa.", "not-confirmed": "Vain vahvistetun valinnan voi avata uudelleen.",
    limit: "Valinnalla on jo enimmäismäärä versioita, joten sitä ei voi avata uudelleen.", unavailable: "Toiminto ei ole nyt käytettävissä.",
  } : {
    action: "Reopen selection", confirm: "Reopen", cancel: "Cancel", close: "Close", working: "Reopening…",
    explain: "The customer can change the selection and confirm a new version {next}. Confirmed version {current} and its notice stay. A page the customer already has open updates when they reload it.",
    reopened: "The selection was reopened. The customer can change it now.",
    conflict: "The selection changed meanwhile. Nothing was changed; reload and check before trying again.",
    uncertain: "The outcome is unknown. Reload and check the selection's state before trying again.",
    off: "Proof galleries are not enabled in this Studio.", "not-confirmed": "Only a confirmed selection can be reopened.",
    limit: "This selection already has the maximum number of versions, so it cannot be reopened.", unavailable: "This action is not available now.",
  };
}
