/**
 * Reminder settings after publication (ADR-0038 decision 9, owner decisions
 * 2026-10-23, AB#130): pure parsing of the private terms record, form
 * validation and the guarded patch for each transition. Price and key fields
 * are never read into the form or written. No CMS client or browser globals.
 */
import { isProofCustomerEmail, PROOF_MAX_REMINDER_DAYS } from "../sanity/schemas/proof-terms";

const GALLERY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/u;
const REVISION = /^[A-Za-z0-9_-]{1,128}$/u;

export type ReminderSettings = Readonly<{ on: false } | { on: true; delayDays: number; customerEmail: string; locale: string }>;
export type LoadedReminderSettings = Readonly<{ termsId: string; revision: string; settings: ReminderSettings }>;

export const proofTermsRecordId = (galleryId: string) => `proofTerms.${galleryId}`;

/** The current settings, or `undefined` when the record is not this gallery's terms. */
export function parseReminderSettings(value: unknown, galleryId: string, locales: readonly string[]): LoadedReminderSettings | undefined {
  if (!GALLERY_ID.test(galleryId) || typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const doc = value as Record<string, unknown>, termsId = proofTermsRecordId(galleryId);
  if (doc._id !== termsId || doc._type !== "clientProofTerms" || doc.galleryId !== galleryId || typeof doc._rev !== "string" || !REVISION.test(doc._rev)) return undefined;
  if (doc.reminderDelayDays == null) return { termsId, revision: doc._rev, settings: { on: false } };
  const delayDays = doc.reminderDelayDays;
  if (!Number.isSafeInteger(delayDays) || (delayDays as number) < 1 || (delayDays as number) > PROOF_MAX_REMINDER_DAYS || !isProofCustomerEmail(doc.customerEmail)) return undefined;
  // An older record may lack a language; the form then asks for one explicitly.
  const locale = typeof doc.customerLocale === "string" && locales.includes(doc.customerLocale) ? doc.customerLocale : "";
  return { termsId, revision: doc._rev, settings: { on: true, delayDays: delayDays as number, customerEmail: doc.customerEmail, locale } };
}

export type ReminderSettingsForm = { on: boolean; delayDays: string; customerEmail: string; locale: string };
export type ReminderSettingsField = "delayDays" | "customerEmail" | "locale";

export function reminderSettingsForm(settings: ReminderSettings, defaultLocale: string): ReminderSettingsForm {
  return settings.on
    ? { on: true, delayDays: String(settings.delayDays), customerEmail: settings.customerEmail, locale: settings.locale }
    : { on: false, delayDays: "7", customerEmail: "", locale: defaultLocale };
}

/** The same rules as the first-publication dialog, including a configured locale. */
export function readReminderSettingsForm(form: ReminderSettingsForm, locales: readonly string[]): { settings: ReminderSettings } | { invalid: ReminderSettingsField[] } {
  if (!form.on) return { settings: { on: false } };
  const invalid: ReminderSettingsField[] = [];
  const days = form.delayDays.trim(), customerEmail = form.customerEmail.trim();
  const delayDays = /^\d{1,3}$/u.test(days) ? Number(days) : NaN;
  if (!(delayDays >= 1 && delayDays <= PROOF_MAX_REMINDER_DAYS)) invalid.push("delayDays");
  if (!isProofCustomerEmail(customerEmail)) invalid.push("customerEmail");
  if (!locales.includes(form.locale)) invalid.push("locale");
  return invalid.length > 0 ? { invalid } : { settings: { on: true, delayDays, customerEmail, locale: form.locale } };
}

export type ReminderPatch = Readonly<{ set: Record<string, unknown>; unset: string[] }>;

/**
 * The fields to write, or `undefined` when nothing changes. Switching on — or
 * moving the delay — sets `reminderResumeAfter`, so no step due before the
 * change is sent (the next one is); switching off removes the address and the
 * language and records who stopped it. A stop marker is cleared on re-enabling.
 */
export function reminderSettingsPatch(current: ReminderSettings, next: ReminderSettings, now: string): ReminderPatch | undefined {
  if (!next.on) {
    return current.on
      ? { set: { reminderDelayDays: null, reminderStoppedAt: now, reminderStoppedBy: "administrator" }, unset: ["customerEmail", "customerLocale"] }
      : undefined;
  }
  if (current.on && current.delayDays === next.delayDays && current.customerEmail === next.customerEmail && current.locale === next.locale) return undefined;
  const resume = !current.on || current.delayDays !== next.delayDays;
  return {
    set: { reminderDelayDays: next.delayDays, customerEmail: next.customerEmail, customerLocale: next.locale, ...(resume ? { reminderResumeAfter: now } : {}) },
    unset: current.on ? [] : ["reminderStoppedAt", "reminderStoppedBy"],
  };
}

export type ReminderCommit = (termsId: string, revision: string, patch: ReminderPatch) => Promise<void>;
export type ReminderSaveOutcome = "saved" | "unchanged" | "conflict" | "uncertain";

/** One guarded save against the revision loaded with the form; never retried. */
export async function saveReminderSettings(loaded: LoadedReminderSettings, next: ReminderSettings, now: string, commit: ReminderCommit): Promise<ReminderSaveOutcome> {
  const patch = reminderSettingsPatch(loaded.settings, next, now);
  if (!patch) return "unchanged";
  try {
    await commit(loaded.termsId, loaded.revision, patch);
    return "saved";
  } catch (error) {
    return (error as { statusCode?: unknown } | null)?.statusCode === 409 ? "conflict" : "uncertain";
  }
}

export function proofReminderSettingsCopy(locale: string) {
  return /^fi(?:-|$)/u.test(locale) ? {
    action: "Muistutusasetukset", save: "Tallenna", saving: "Tallennetaan…", cancel: "Peruuta", close: "Sulje", loading: "Ladataan…",
    on: "Muistuta asiakasta, jos valintaa ei ole tehty", delayDays: "Ensimmäinen muistutus päivän kuluttua julkaisusta",
    customerEmail: "Asiakkaan sähköpostiosoite", locale: "Asiakkaan kieli (muistutus ja linkki)", fieldError: "Tarkista tämä kenttä.",
    explain: "Muistutus lähtee, kun valintaa ei ole vahvistettu, ja sen jälkeen kerran 30 päivässä. Kun muistutukset kytketään takaisin päälle tai viivettä muutetaan, seuraava muistutus lähtee vasta seuraavassa vaiheessa. Pois kytkeminen poistaa osoitteen. Jokaisessa muistutuksessa on linkki, jolla asiakas voi itse perua muistutukset.",
    saved: "Asetukset tallennettu.", unchanged: "Ei muutoksia.",
    conflict: "Asetukset muuttuivat tällä välin. Mitään ei tallennettu; avaa asetukset uudelleen.",
    uncertain: "Tallennuksen tulos ei selvinnyt. Avaa asetukset uudelleen ja tarkista ne.",
    unreadable: "Muistutusasetuksia ei voitu lukea.", unavailable: "Galleriaa ei ole vielä julkaistu.", off: "Vedosgalleriat eivät ole käytössä tässä Studiossa.",
    languages: { fi: "Suomi", en: "Englanti" } as Record<string, string>,
  } : {
    action: "Reminder settings", save: "Save", saving: "Saving…", cancel: "Cancel", close: "Close", loading: "Loading…",
    on: "Remind the customer if no selection has been made", delayDays: "First reminder after days from publication",
    customerEmail: "Customer email address", locale: "Customer language (reminder and link)", fieldError: "Check this field.",
    explain: "A reminder goes out while no selection is confirmed, then once every 30 days. When reminders are switched back on or the delay changes, the next reminder waits for the next step. Switching off removes the address. Every reminder carries a link with which the customer can cancel reminders.",
    saved: "Settings saved.", unchanged: "Nothing changed.",
    conflict: "The settings changed meanwhile. Nothing was saved; open the settings again.",
    uncertain: "The outcome of saving is unknown. Open the settings again and check them.",
    unreadable: "The reminder settings could not be read.", unavailable: "The gallery has not been published yet.", off: "Proof galleries are not enabled in this Studio.",
    languages: { fi: "Finnish", en: "English" } as Record<string, string>,
  };
}
