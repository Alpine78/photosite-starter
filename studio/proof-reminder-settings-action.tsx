import { useId, useRef, useState, type ReactNode } from "react";
import { useClient, useCurrentLocale, type DocumentActionComponent } from "sanity";
import { STUDIO_VALIDATION_API_VERSION } from "../sanity/schemas/validation";
import { studioSettings } from "./environment";
import {
  parseReminderSettings, proofReminderSettingsCopy, proofTermsRecordId, readReminderSettingsForm, reminderSettingsForm, saveReminderSettings,
  type LoadedReminderSettings, type ReminderSaveOutcome, type ReminderSettingsField, type ReminderSettingsForm,
} from "./proof-reminder-settings";

const GALLERY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/u;

/**
 * Reminder settings of a published proof gallery (owner decisions 2026-10-23):
 * reads the private terms fresh with the editor's own session and saves one
 * patch guarded by the revision it loaded. Prices and keys are not touched.
 */
export const ProofReminderSettingsAction: DocumentActionComponent = (props) => {
  const { id: locale } = useCurrentLocale(), copy = proofReminderSettingsCopy(locale), formId = useId();
  const client = useClient({ apiVersion: STUDIO_VALIDATION_API_VERSION });
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<LoadedReminderSettings | "loading" | "unreadable">("loading");
  const [form, setForm] = useState<ReminderSettingsForm>();
  const [invalid, setInvalid] = useState<ReminderSettingsField[]>([]);
  const [outcome, setOutcome] = useState<ReminderSaveOutcome>();
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  if (props.type !== "clientProofGallery") return null;
  const site = studioSettings.clientGallerySite, locales = site?.locales ?? [];
  const ready = studioSettings.proofGalleries && props.published != null && GALLERY_ID.test(props.id);
  const reader = client.withConfig({ perspective: "raw", useCdn: false });

  async function load() {
    setLoaded("loading"); setOutcome(undefined); setInvalid([]);
    try {
      const parsed = parseReminderSettings(await reader.getDocument(proofTermsRecordId(props.id)), props.id, locales);
      if (!parsed) { setLoaded("unreadable"); return; }
      setLoaded(parsed); setForm(reminderSettingsForm(parsed.settings, site?.defaultLocale ?? locales[0] ?? ""));
    } catch {
      setLoaded("unreadable");
    }
  }
  async function save(current: LoadedReminderSettings, values: ReminderSettingsForm) {
    if (inFlight.current) return;
    const read = readReminderSettingsForm(values, locales);
    if ("invalid" in read) { setInvalid(read.invalid); return; }
    inFlight.current = true; setPending(true); setInvalid([]);
    const result = await saveReminderSettings(current, read.settings, new Date().toISOString(), (id, revision, patch) =>
      reader.patch(id).ifRevisionId(revision).set(patch.set).unset(patch.unset).commit().then(() => undefined));
    inFlight.current = false; setPending(false); setOutcome(result);
  }
  const close = () => { if (!inFlight.current) { setOpen(false); setOutcome(undefined); } };
  const field = (name: ReminderSettingsField, control: ReactNode) => <p>
    <label htmlFor={`${formId}-${name}`}>{copy[name]}</label>{" "}{control}
    {invalid.includes(name) ? <> <span id={`${formId}-${name}-error`}>{copy.fieldError}</span></> : null}
  </p>;
  const describe = (name: ReminderSettingsField) => invalid.includes(name) ? { "aria-invalid": true, "aria-describedby": `${formId}-${name}-error` } : {};

  return {
    label: copy.action,
    disabled: !open && !ready,
    title: ready ? undefined : studioSettings.proofGalleries ? copy.unavailable : copy.off,
    onHandle: () => { if (ready) { setOpen(true); void load(); } },
    dialog: open ? {
      type: "dialog", header: copy.action, onClose: close,
      content: loaded === "loading" ? <p>{copy.loading}</p> : loaded === "unreadable" || !form ? <><p role="alert">{copy.unreadable}</p><button type="button" onClick={close}>{copy.close}</button></>
        : outcome ? <><p role="status">{copy[outcome]}</p><button type="button" onClick={close}>{copy.close}</button></>
        : <div>
          <p>{copy.explain}</p>
          <p><label><input type="checkbox" checked={form.on} disabled={pending} onChange={(event) => setForm({ ...form, on: event.target.checked })} />{" "}{copy.on}</label></p>
          {form.on ? <>
            {field("delayDays", <input id={`${formId}-delayDays`} value={form.delayDays} inputMode="numeric" disabled={pending} autoComplete="off"
              onChange={(event) => setForm({ ...form, delayDays: event.target.value })} {...describe("delayDays")} />)}
            {field("customerEmail", <input id={`${formId}-customerEmail`} value={form.customerEmail} inputMode="email" disabled={pending} autoComplete="off"
              onChange={(event) => setForm({ ...form, customerEmail: event.target.value })} {...describe("customerEmail")} />)}
            {field("locale", <select id={`${formId}-locale`} value={form.locale} disabled={pending} onChange={(event) => setForm({ ...form, locale: event.target.value })} {...describe("locale")}>
              {form.locale === "" ? <option value="">—</option> : null}
              {locales.map((tag) => <option key={tag} value={tag}>{copy.languages[new Intl.Locale(tag).language] ?? tag} ({tag})</option>)}
            </select>)}
          </> : null}
          <button type="button" disabled={pending} onClick={() => void save(loaded, form)}>{pending ? copy.saving : copy.save}</button>{" "}
          <button type="button" disabled={pending} onClick={close}>{copy.cancel}</button>
        </div>,
    } : undefined,
  };
};
