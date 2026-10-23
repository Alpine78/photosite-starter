/**
 * Proof gallery publication from the Studio (ADR-0038 amendment 2026-10-22, AB#130):
 * readiness, the terms form, the request to the site's publication route and the
 * reading of its answer. Pure apart from the injected `fetch`; no CMS client,
 * mutations or browser globals.
 */
import { transactionSyncLocked } from "./editor-lock";
import { clientGallerySiteOrigin, type ClientGallerySite } from "./client-gallery-share";
import {
  isProofCustomerEmail, parseProofPrice, parseProofTerms, PROOF_CURRENCIES, PROOF_JOB_REFERENCE_MAX,
  PROOF_MAX_INCLUDED, PROOF_MAX_REMINDER_DAYS, type ProofTerms,
} from "../sanity/schemas/proof-terms";

export const PROOF_GALLERY_TYPE = "clientProofGallery";
export const PROOF_PUBLICATION_PATH = "/api/proof-gallery/publish";
const GALLERY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/u;
const REVISION = /^[A-Za-z0-9_-]{1,128}$/u;
const HANDLE = /^[a-f0-9]{32}$/u;
const SELECTION_KEY = /^[A-Za-z0-9_-]{43}$/u;
/** A publication that has not answered in this time has an unknown outcome. */
export const PROOF_PUBLICATION_TIMEOUT_MS = 30_000;

type Revisioned = { _id?: unknown; _rev?: unknown; handle?: unknown } | null | undefined;
export type ProofActionState = {
  id: string; type: string; ready: boolean; draft: Revisioned; published: Revisioned;
  version?: unknown; release?: unknown; transactionSyncLock?: unknown;
};
export type ProofValidationState = {
  isValidating: boolean; revision?: string; validation: readonly { level: string }[];
};
export type ProofPublishReadiness =
  | "ready" | "off" | "configure" | "unsupported" | "nothing-to-publish" | "checking" | "invalid";

function baseReadiness(state: ProofActionState, site: ClientGallerySite | undefined, enabled: boolean): ProofPublishReadiness | undefined {
  if (!enabled) return "off";
  if (!site) return "configure";
  if (state.type !== PROOF_GALLERY_TYPE || !GALLERY_ID.test(state.id) || state.version != null || state.release !== undefined) return "unsupported";
  if (!state.ready || transactionSyncLocked(state.transactionSyncLock)) return "checking";
  return undefined;
}

/**
 * Publish only a draft whose validation finished for exactly its current
 * revision with no errors, as the native publish action does; that revision is
 * what the route is asked to publish.
 */
export function proofPublishReadiness(
  state: ProofActionState, validation: ProofValidationState, syncing: boolean,
  site: ClientGallerySite | undefined, enabled: boolean,
): ProofPublishReadiness {
  const base = baseReadiness(state, site, enabled);
  if (base) return base;
  const revision = state.draft?._rev;
  if (!state.draft || typeof revision !== "string" || !REVISION.test(revision)) return "nothing-to-publish";
  if (syncing || validation.isValidating || validation.revision !== revision) return "checking";
  if (validation.validation.some((marker) => marker.level === "error")) return "invalid";
  return HANDLE.test(String(state.draft.handle)) ? "ready" : "invalid";
}

/** A new selection link needs a published gallery; the draft does not matter. */
export function proofRotateReadiness(state: ProofActionState, site: ClientGallerySite | undefined, enabled: boolean): ProofPublishReadiness {
  const base = baseReadiness(state, site, enabled);
  if (base) return base;
  return state.published && HANDLE.test(String(state.published.handle)) ? "ready" : "nothing-to-publish";
}

export type ProofTermsForm = {
  includedCount: string; extraUnitPrice: string; currency: string; jobReference: string;
  reminder: boolean; reminderDays: string; customerEmail: string;
};
export type ProofTermsField = "includedCount" | "extraUnitPrice" | "currency" | "jobReference" | "reminderDays" | "customerEmail";

/** The owner's defaults: euros, a reminder after a week (ADR-0038 decision 9). */
export function defaultProofTermsForm(): ProofTermsForm {
  return { includedCount: "", extraUnitPrice: "", currency: "EUR", jobReference: "", reminder: true, reminderDays: "7", customerEmail: "" };
}

function boundedInteger(text: string, min: number, max: number): number | undefined {
  const trimmed = text.trim();
  if (!/^\d{1,3}$/u.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value >= min && value <= max ? value : undefined;
}

/** The terms the route accepts, or the fields that need correcting. */
export function readProofTermsForm(form: ProofTermsForm): { terms: ProofTerms } | { invalid: ProofTermsField[] } {
  const invalid: ProofTermsField[] = [];
  const includedCount = boundedInteger(form.includedCount, 0, PROOF_MAX_INCLUDED);
  if (includedCount === undefined) invalid.push("includedCount");
  const currency = Object.hasOwn(PROOF_CURRENCIES, form.currency) ? form.currency : undefined;
  if (currency === undefined) invalid.push("currency");
  const extraUnitPriceMinor = currency === undefined ? undefined : parseProofPrice(form.extraUnitPrice, currency);
  if (extraUnitPriceMinor === undefined) invalid.push("extraUnitPrice");
  const jobReference = form.jobReference.trim();
  if (jobReference.length < 1 || jobReference.length > PROOF_JOB_REFERENCE_MAX || /[\u0000-\u001f\u007f]/u.test(jobReference)) invalid.push("jobReference");
  const delayDays = form.reminder ? boundedInteger(form.reminderDays, 1, PROOF_MAX_REMINDER_DAYS) : undefined;
  if (form.reminder && delayDays === undefined) invalid.push("reminderDays");
  const customerEmail = form.customerEmail.trim();
  if (form.reminder && !isProofCustomerEmail(customerEmail)) invalid.push("customerEmail");
  if (invalid.length > 0) return { invalid };
  const terms = parseProofTerms({
    includedCount, extraUnitPriceMinor, currency, jobReference,
    reminder: form.reminder ? { delayDays, customerEmail } : null,
  });
  return terms ? { terms } : { invalid: ["jobReference"] };
}

export type ProofPublicationBody =
  | { galleryId: string; operation: "publish"; expectedDraftRevision: string; terms?: ProofTerms }
  | { galleryId: string; operation: "rotate-key" };

export function proofPublicationEndpoint(site: ClientGallerySite): string {
  const origin = clientGallerySiteOrigin(site.origin);
  if (!origin) throw new Error("Missing site origin");
  return new URL(PROOF_PUBLICATION_PATH, origin).toString();
}

export type ProofPublicationAnswer = { status: number | "network"; body: unknown };

/**
 * One POST with the editor's own token: no cookies, no cache, no retry. A
 * timeout or a lost connection is reported as `network`, an unknown outcome.
 */
export async function sendProofPublication(
  endpoint: string, token: string, body: ProofPublicationBody,
  fetcher: typeof fetch, timeoutMs = PROOF_PUBLICATION_TIMEOUT_MS,
): Promise<ProofPublicationAnswer> {
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: "POST", credentials: "omit", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { status: "network", body: undefined };
  }
  let parsed: unknown;
  try { parsed = await response.json(); } catch { parsed = undefined; }
  return { status: response.status, body: parsed };
}

export type ProofPublicationResult =
  | { kind: "published"; firstPublication: boolean; selectionKey?: string }
  | { kind: "key-rotated"; selectionKey: string }
  /** Known not to have been committed; the editor may correct and try again. */
  | { kind: "rejected"; reason: ProofRejection }
  /** The change may or may not have been committed. Never retried automatically. */
  | { kind: "unknown" };
export type ProofRejection =
  | "signin" | "forbidden" | "not-found" | "stale-draft" | "conflict" | "invalid" | "inconsistent"
  | "unsupported" | "rate-limited" | "terms" | "request";

const REJECTIONS: Record<string, ProofRejection> = {
  unauthenticated: "signin", forbidden: "forbidden", "not-found": "not-found", "stale-draft": "stale-draft",
  conflict: "conflict", "invalid-gallery": "invalid", "invalid-references": "invalid", inconsistent: "inconsistent",
  "unsupported-release": "unsupported", "rate-limited": "rate-limited", "terms-required": "terms", "terms-not-allowed": "terms",
  "malformed-request": "request",
};

/**
 * Only the route's own rejections, which it returns before or instead of a
 * commit, count as "not published". Everything else — a lost connection, a
 * timeout, a store failure that may have followed the commit, an answer without
 * the route's CORS headers, or a malformed success — is an unknown outcome.
 */
export function readProofPublicationAnswer(operation: ProofPublicationBody["operation"], answer: ProofPublicationAnswer): ProofPublicationResult {
  const body = typeof answer.body === "object" && answer.body !== null && !Array.isArray(answer.body)
    ? answer.body as Record<string, unknown> : {};
  const key = typeof body.selectionKey === "string" && SELECTION_KEY.test(body.selectionKey) ? body.selectionKey : undefined;
  if (answer.status === 200) {
    if (operation === "rotate-key") return body.status === "key-rotated" && key ? { kind: "key-rotated", selectionKey: key } : { kind: "unknown" };
    if (body.status !== "published" || typeof body.firstPublication !== "boolean") return { kind: "unknown" };
    if (body.firstPublication && !key) return { kind: "unknown" };
    if (!body.firstPublication && body.selectionKey !== undefined) return { kind: "unknown" };
    return { kind: "published", firstPublication: body.firstPublication, ...(key ? { selectionKey: key } : {}) };
  }
  if (typeof answer.status === "number" && answer.status >= 400 && answer.status < 500 && body.status === "rejected" &&
    typeof body.reason === "string" && Object.hasOwn(REJECTIONS, body.reason)) {
    return { kind: "rejected", reason: REJECTIONS[body.reason] };
  }
  return { kind: "unknown" };
}

/** The customer's selection link; the key travels in the fragment, never in a request (ADR-0038). */
export function proofSelectionUrl(site: ClientGallerySite, handle: unknown, selectionKey: string, locale = ""): string | undefined {
  if (typeof handle !== "string" || !HANDLE.test(handle) || !SELECTION_KEY.test(selectionKey) ||
    locale.length > 128 || (locale !== "" && !site.locales.includes(locale))) return undefined;
  const origin = clientGallerySiteOrigin(site.origin);
  if (!origin) return undefined;
  const url = new URL(`/client-proof/${handle}`, origin);
  if (locale) url.searchParams.set("locale", locale);
  url.hash = `select=${selectionKey}`;
  return url.toString();
}

export function proofPublishCopy(locale: string) {
  return /^fi(?:-|$)/u.test(locale) ? {
    publish: "Julkaise vedosgalleria", rotate: "Luo uusi valintalinkki", close: "Sulje", cancel: "Peruuta",
    send: "Julkaise", sending: "Julkaistaan…", rotateConfirm: "Luo uusi linkki", rotating: "Luodaan…",
    copy: "Kopioi linkki", copied: "Linkki kopioitu.", manual: "Valitse ja kopioi URL käsin.",
    url: "Asiakkaan valintalinkki", language: "Asiakasnäkymän kieli", defaultLanguage: "Sivuston oletuskieli",
    languages: { fi: "Suomi", en: "Englanti" } as Record<string, string>,
    readiness: {
      off: "Vedosgalleriat eivät ole käytössä tässä Studiossa.", configure: "Studion julkinen sivusto-osoite puuttuu.",
      unsupported: "Julkaisua ei voi tehdä tästä näkymästä.", "nothing-to-publish": "Ei julkaistavia muutoksia.",
      checking: "Tarkistetaan luonnosta…", invalid: "Korjaa luonnoksen virheet ennen julkaisua.", ready: "",
      rotate: "Galleriaa ei ole vielä julkaistu.",
    } as Record<string, string>,
    signin: "Kirjaudu Studioon uudelleen: julkaisu tarvitsee voimassa olevan kirjautumisen.",
    first: "Ensimmäinen julkaisu numeroi vedokset pysyvästi ja luo asiakkaalle valintalinkin. Ehdot tallentuvat yksityisesti eivätkä näy asiakkaalle tässä muodossa.",
    later: "Julkaisu päivittää asiakkaan näkemän gallerian. Uudet kuvat saavat seuraavat numerot; olemassa olevat numerot eivät muutu. Valintalinkki pysyy ennallaan.",
    fields: {
      includedCount: "Hintaan sisältyvien kuvien määrä", extraUnitPrice: "Lisäkuvan hinta", currency: "Valuutta",
      jobReference: "Työn tunniste (näkyy sinulle ilmoituksissa)", reminder: "Muistuta asiakasta, jos valintaa ei ole tehty",
      reminderDays: "Muistutus päivän kuluttua", customerEmail: "Asiakkaan sähköpostiosoite muistutusta varten",
    } as Record<string, string>,
    fieldError: "Tarkista tämä kenttä.",
    reminderNote: "Muistutusten lähetys otetaan käyttöön myöhemmin; asetus tallentuu jo nyt. Osoitetta ei tallenneta, jos muistutus on pois päältä.",
    rotateWarning: "Uusi linkki korvaa nykyisen heti: vanha valintalinkki lakkaa toimimasta. Lähetä asiakkaalle uusi linkki.",
    once: "Linkki näytetään vain nyt. Jos suljet ikkunan kopioimatta sitä, luo uusi valintalinkki.",
    published: "Vedosgalleria julkaistiin.",
    unknown: {
      first: "Julkaisun lopputulos ei selvinnyt. Älä julkaise uudelleen heti: lataa sivu. Jos galleria näkyy julkaistuna, luo uusi valintalinkki, koska linkkiä ei näytetty.",
      later: "Julkaisun lopputulos ei selvinnyt. Lataa sivu ja tarkista, näkyvätkö muutokset julkaistuina, ennen kuin yrität uudelleen.",
      rotate: "Uuden linkin luonnin lopputulos ei selvinnyt. Vanha linkki on voinut lakata toimimasta: luo uusi linkki uudelleen.",
    },
    rejected: {
      signin: "Kirjautuminen on vanhentunut. Kirjaudu uudelleen ja yritä uudelleen.",
      forbidden: "Sinulla ei ole oikeutta julkaista tätä galleriaa.",
      "not-found": "Galleriaa ei löytynyt. Lataa sivu uudelleen.",
      "stale-draft": "Luonnos muuttui tarkistuksen jälkeen. Mitään ei julkaistu; tarkista muutokset ja yritä uudelleen.",
      conflict: "Galleriaa muutettiin samaan aikaan. Mitään ei julkaistu; yritä uudelleen.",
      invalid: "Gallerian kuvat tai tiedot eivät kelpaa julkaistaviksi. Mitään ei julkaistu.",
      inconsistent: "Gallerian julkaistut tiedot ovat ristiriidassa. Mitään ei julkaistu; selvitä asia ylläpidon kanssa.",
      unsupported: "Julkaisu julkaisuversiosta ei ole tuettu. Mitään ei julkaistu.",
      "rate-limited": "Liian monta yritystä. Odota hetki ja yritä uudelleen.",
      terms: "Ehdot puuttuvat tai eivät kuulu tähän julkaisuun. Lataa sivu ja yritä uudelleen.",
      request: "Sivusto ei hyväksynyt pyyntöä. Mitään ei julkaistu; Studio ja sivusto voivat olla eri versioita.",
    } as Record<ProofRejection, string>,
  } : {
    publish: "Publish proof gallery", rotate: "Create a new selection link", close: "Close", cancel: "Cancel",
    send: "Publish", sending: "Publishing…", rotateConfirm: "Create new link", rotating: "Creating…",
    copy: "Copy link", copied: "Link copied.", manual: "Select and copy the URL manually.",
    url: "Customer selection link", language: "Customer interface language", defaultLanguage: "Site default language",
    languages: { fi: "Finnish", en: "English" } as Record<string, string>,
    readiness: {
      off: "Proof galleries are not enabled in this Studio.", configure: "This Studio has no public site address configured.",
      unsupported: "Publication is not available from this view.", "nothing-to-publish": "No changes to publish.",
      checking: "Checking the draft…", invalid: "Fix the draft's errors before publishing.", ready: "",
      rotate: "The gallery has not been published yet.",
    } as Record<string, string>,
    signin: "Sign in to the Studio again: publication needs a current sign-in.",
    first: "The first publication numbers the proofs permanently and creates the customer's selection link. The terms are stored privately and are not shown to the customer in this form.",
    later: "Publishing updates the gallery the customer sees. New images get the next numbers; existing numbers do not change. The selection link stays the same.",
    fields: {
      includedCount: "Images included in the price", extraUnitPrice: "Price per additional image", currency: "Currency",
      jobReference: "Job reference (shown to you in notifications)", reminder: "Remind the customer if no selection has been made",
      reminderDays: "Reminder after days", customerEmail: "Customer email address for the reminder",
    } as Record<string, string>,
    fieldError: "Check this field.",
    reminderNote: "Reminder sending is enabled later; the setting is stored now. No address is stored when the reminder is off.",
    rotateWarning: "The new link replaces the current one immediately: the old selection link stops working. Send the customer the new link.",
    once: "The link is shown only now. If you close this window without copying it, create a new selection link.",
    published: "The proof gallery was published.",
    unknown: {
      first: "The outcome of the publication is unknown. Do not publish again straight away: reload the page. If the gallery shows as published, create a new selection link, because no link was shown.",
      later: "The outcome of the publication is unknown. Reload the page and check whether the changes show as published before trying again.",
      rotate: "The outcome of creating a new link is unknown. The old link may have stopped working: create a new link again.",
    },
    rejected: {
      signin: "Your sign-in has expired. Sign in again and retry.",
      forbidden: "You do not have permission to publish this gallery.",
      "not-found": "The gallery was not found. Reload the page.",
      "stale-draft": "The draft changed after it was checked. Nothing was published; review the changes and try again.",
      conflict: "The gallery was changed at the same time. Nothing was published; try again.",
      invalid: "The gallery's images or details cannot be published. Nothing was published.",
      inconsistent: "The gallery's published records disagree. Nothing was published; resolve it with the site maintainer.",
      unsupported: "Publishing from a release is not supported. Nothing was published.",
      "rate-limited": "Too many attempts. Wait a moment and try again.",
      terms: "The terms are missing or do not belong to this publication. Reload the page and try again.",
      request: "The site did not accept the request. Nothing was published; the Studio and the site may be different versions.",
    } as Record<ProofRejection, string>,
  };
}
