import { useId, useRef, useState } from "react";
import { useClient, useCurrentLocale, type DocumentActionComponent } from "sanity";
import { STUDIO_VALIDATION_API_VERSION } from "../sanity/schemas/validation";
import { studioSettings } from "./environment";
import {
  parseReminderSettings, proofReminderSettingsCopy, proofTermsRecordId, readReminderSettingsForm, reminderSettingsForm, saveReminderSettings,
  type LoadedReminderSettings, type ReminderSaveOutcome, type ReminderSettingsField, type ReminderSettingsForm,
} from "./proof-reminder-settings";
import { ProofReminderSettingsDialog } from "./proof-reminder-settings-dialog";

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

  return {
    label: copy.action,
    disabled: !open && !ready,
    title: ready ? undefined : studioSettings.proofGalleries ? copy.unavailable : copy.off,
    onHandle: () => { if (ready) { setOpen(true); void load(); } },
    dialog: open ? {
      type: "dialog", header: copy.action, onClose: close,
      content: <ProofReminderSettingsDialog locale={locale} formId={formId} state={loaded === "loading" || loaded === "unreadable" ? loaded : "ready"} form={form}
        invalid={invalid} outcome={outcome} pending={pending} locales={locales} onForm={setForm}
        onSave={() => { if (loaded !== "loading" && loaded !== "unreadable" && form) void save(loaded, form); }} onClose={close} />,
    } : undefined,
  };
};
