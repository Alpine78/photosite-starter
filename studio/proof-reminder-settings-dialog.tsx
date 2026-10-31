import { Button, Checkbox, Flex, Select, Stack, TextInput } from "@sanity/ui";
import type { ReactNode } from "react";
import {
  proofReminderSettingsCopy, type ReminderSaveOutcome, type ReminderSettingsField, type ReminderSettingsForm,
} from "./proof-reminder-settings";

export type ProofReminderSettingsDialogProps = {
  locale: string; formId: string; state: "loading" | "unreadable" | "ready"; form?: ReminderSettingsForm;
  invalid: readonly ReminderSettingsField[]; outcome?: ReminderSaveOutcome; pending: boolean; locales: readonly string[];
  onForm(next: ReminderSettingsForm): void; onSave(): void; onClose(): void;
};

/** Studio-themed reminder controls; the fresh read and the guarded patch live in the action. */
export function ProofReminderSettingsDialog({ locale, formId, state, form, invalid, outcome, pending, locales, onForm, onSave, onClose }: ProofReminderSettingsDialogProps) {
  const copy = proofReminderSettingsCopy(locale);
  const field = (name: ReminderSettingsField, control: ReactNode) => <Stack gap={2}>
    <label htmlFor={`${formId}-${name}`}>{copy[name]}</label>{control}
    {invalid.includes(name) ? <span id={`${formId}-${name}-error`}>{copy.fieldError}</span> : null}
  </Stack>;
  const describe = (name: ReminderSettingsField) => invalid.includes(name) ? { "aria-invalid": true, "aria-describedby": `${formId}-${name}-error` } : {};
  const close = <Button type="button" onClick={onClose} text={copy.close} />;
  if (state === "loading") return <p>{copy.loading}</p>;
  if (state === "unreadable" || !form) return <Stack gap={3}><p role="alert">{copy.unreadable}</p><Flex>{close}</Flex></Stack>;
  if (outcome) return <Stack gap={3}><p role="status">{copy[outcome]}</p><Flex>{close}</Flex></Stack>;
  return <Stack gap={3}>
    <p>{copy.explain}</p>
    <Flex align="flex-start" gap={2}><Checkbox id={`${formId}-on`} checked={form.on} disabled={pending}
      onChange={(event) => onForm({ ...form, on: event.currentTarget.checked })} /><label htmlFor={`${formId}-on`}>{copy.on}</label></Flex>
    {form.on ? <>
      {field("delayDays", <TextInput id={`${formId}-delayDays`} value={form.delayDays} inputMode="numeric" disabled={pending} autoComplete="off"
        onChange={(event) => onForm({ ...form, delayDays: event.currentTarget.value })} {...describe("delayDays")} />)}
      {field("customerEmail", <TextInput id={`${formId}-customerEmail`} value={form.customerEmail} inputMode="email" disabled={pending} autoComplete="off"
        onChange={(event) => onForm({ ...form, customerEmail: event.currentTarget.value })} {...describe("customerEmail")} />)}
      {field("locale", <Select id={`${formId}-locale`} value={form.locale} disabled={pending} onChange={(event) => onForm({ ...form, locale: event.currentTarget.value })} {...describe("locale")}>
        {form.locale === "" ? <option value="">—</option> : null}
        {locales.map((tag) => <option key={tag} value={tag}>{copy.languages[new Intl.Locale(tag).language] ?? tag} ({tag})</option>)}
      </Select>)}
    </> : null}
    <Flex gap={2} wrap="wrap">
      <Button type="button" tone="primary" disabled={pending} onClick={onSave} text={pending ? copy.saving : copy.save} />
      <Button type="button" disabled={pending} onClick={onClose} text={copy.cancel} />
    </Flex>
  </Stack>;
}
