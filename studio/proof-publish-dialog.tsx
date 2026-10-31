import { Button, Checkbox, Flex, Select, Stack, TextInput } from "@sanity/ui";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { ClientGallerySite } from "./client-gallery-share";
import { copyClientGalleryUrl } from "./client-gallery-share";
import { PROOF_CURRENCIES } from "../sanity/schemas/proof-terms";
import {
  defaultProofTermsForm, proofPublicationEndpoint, proofPublishCopy, proofSelectionUrl, readProofPublicationAnswer,
  readProofTermsForm, sendProofPublication, type ProofPublicationBody, type ProofPublicationResult,
  type ProofTermsField, type ProofTermsForm,
} from "./proof-publish";

type Copy = ReturnType<typeof proofPublishCopy>;
export type ProofDialogRequest =
  | { operation: "publish"; galleryId: string; expectedDraftRevision: string; handle: string; firstPublication: boolean }
  | { operation: "rotate-key"; galleryId: string; handle: string };

/** The selection link, shown once, with the same copy-or-select fallback as the client gallery link. */
function SelectionLink({ site, handle, selectionKey, copy, initialLanguage = "" }: { site: ClientGallerySite; handle: string; selectionKey: string; copy: Copy; initialLanguage?: string }) {
  const id = useId(), input = useRef<HTMLInputElement>(null);
  // Starts in the customer's language chosen at publication; the site default needs no query.
  const [language, setLanguage] = useState(initialLanguage === site.defaultLocale ? "" : initialLanguage);
  const [outcome, setOutcome] = useState<{ url: string; result: "copied" | "manual" }>();
  const url = proofSelectionUrl(site, handle, selectionKey, language) ?? "";
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  async function runCopy() {
    const result = await copyClientGalleryUrl(url, (value) => navigator.clipboard?.writeText
      ? navigator.clipboard.writeText(value) : Promise.reject(new Error("Clipboard unavailable")));
    setOutcome({ url, result });
    if (result === "manual") { input.current?.focus(); input.current?.select(); }
  }
  const shown = outcome?.url === url ? outcome.result : undefined;
  return <>
    <p><strong>{copy.once}</strong></p>
    <Stack gap={2}><label htmlFor={`${id}-language`}>{copy.language}</label>{" "}
      <Select id={`${id}-language`} value={language} onChange={(event) => setLanguage(event.currentTarget.value)}>
        <option value="">{copy.defaultLanguage}</option>
        {site.locales.filter((tag) => tag.length <= 128).map((tag) => <option key={tag} value={tag}>{copy.languages[new Intl.Locale(tag).language] ?? tag} ({tag})</option>)}
      </Select>
    </Stack>
    <Stack gap={2}><label htmlFor={`${id}-url`}>{copy.url}</label>{" "}
      <TextInput id={`${id}-url`} ref={input} readOnly value={url} autoComplete="off" spellCheck={false} />
    </Stack>
    <p role="status">{shown === "copied" ? copy.copied : shown === "manual" ? copy.manual : ""}</p>
    <Button type="button" disabled={!url} onClick={() => void runCopy()} text={copy.copy} />{" "}
  </>;
}

function TermsFields({ form, invalid, onChange, copy, disabled, locales }: {
  form: ProofTermsForm; invalid: readonly ProofTermsField[]; onChange(next: ProofTermsForm): void; copy: Copy; disabled: boolean; locales: readonly string[];
}) {
  const id = useId();
  const field = (name: ProofTermsField, control: ReactNode) => <Stack gap={2}>
    <label htmlFor={`${id}-${name}`}>{copy.fields[name]}</label>{" "}{control}
    {invalid.includes(name) ? <> <span id={`${id}-${name}-error`}>{copy.fieldError}</span></> : null}
  </Stack>;
  const describe = (name: ProofTermsField) => invalid.includes(name)
    ? { "aria-invalid": true, "aria-describedby": `${id}-${name}-error` } : {};
  const text = (name: "includedCount" | "extraUnitPrice" | "jobReference" | "reminderDays" | "customerEmail", inputMode?: "numeric" | "decimal" | "email") =>
    field(name, <TextInput id={`${id}-${name}`} value={form[name]} disabled={disabled} inputMode={inputMode} autoComplete="off"
      onChange={(event) => onChange({ ...form, [name]: event.currentTarget.value })} {...describe(name)} />);
  return <>
    {text("includedCount", "numeric")}
    {field("currency", <Select id={`${id}-currency`} value={form.currency} disabled={disabled}
      onChange={(event) => onChange({ ...form, currency: event.currentTarget.value })} {...describe("currency")}>
      {Object.keys(PROOF_CURRENCIES).map((code) => <option key={code} value={code}>{code}</option>)}
    </Select>)}
    {text("extraUnitPrice", "decimal")}
    {text("jobReference")}
    {field("reminderLocale", <Select id={`${id}-reminderLocale`} value={form.reminderLocale} disabled={disabled}
      onChange={(event) => onChange({ ...form, reminderLocale: event.currentTarget.value })} {...describe("reminderLocale")}>
      {locales.map((tag) => <option key={tag} value={tag}>{copy.languages[new Intl.Locale(tag).language] ?? tag} ({tag})</option>)}
    </Select>)}
    <Flex align="flex-start" gap={2}><Checkbox id={`${id}-reminder`} checked={form.reminder} disabled={disabled}
      onChange={(event) => onChange({ ...form, reminder: event.currentTarget.checked })} /><label htmlFor={`${id}-reminder`}>{copy.fields.reminder}</label></Flex>
    {form.reminder ? <>{text("reminderDays", "numeric")}{text("customerEmail", "email")}</> : null}
    <p>{copy.reminderNote}</p>
  </>;
}

/**
 * Publication or key rotation in one dialog. The request is sent at most once
 * per click and never retried automatically; an unknown outcome closes the
 * way forward instead of offering a second attempt.
 */
export function ProofPublishDialog({ request, site, locale, readToken, fetcher, onBusy, onClose }: {
  request: ProofDialogRequest; site: ClientGallerySite; locale: string;
  readToken(): string | undefined; fetcher: typeof fetch; onBusy(busy: boolean): void; onClose(): void;
}) {
  const copy = proofPublishCopy(locale);
  const [form, setForm] = useState(() => defaultProofTermsForm(site.defaultLocale ?? site.locales[0] ?? ""));
  const [invalid, setInvalid] = useState<ProofTermsField[]>([]);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [result, setResult] = useState<ProofPublicationResult>();
  const mounted = useRef(false), inFlight = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const first = request.operation === "publish" && request.firstPublication;

  async function submit() {
    if (inFlight.current || result) return;
    let body: ProofPublicationBody;
    if (request.operation === "rotate-key") body = { galleryId: request.galleryId, operation: "rotate-key" };
    else {
      body = { galleryId: request.galleryId, operation: "publish", expectedDraftRevision: request.expectedDraftRevision };
      if (first) {
        const read = readProofTermsForm(form, site.locales);
        if ("invalid" in read) { setInvalid(read.invalid); return; }
        body.terms = read.terms;
      }
    }
    setInvalid([]);
    const token = readToken();
    if (!token) { setProblem(copy.signin); return; }
    inFlight.current = true; setPending(true); setProblem(undefined); onBusy(true);
    const answer = await sendProofPublication(proofPublicationEndpoint(site), token, body, fetcher);
    const outcome = readProofPublicationAnswer(body.operation, answer);
    onBusy(false);
    if (!mounted.current) return;
    inFlight.current = false; setPending(false);
    if (outcome.kind === "rejected") setProblem(copy.rejected[outcome.reason]);
    else setResult(outcome);
  }

  if (result) {
    const unknown = request.operation === "rotate-key" ? copy.unknown.rotate : first ? copy.unknown.first : copy.unknown.later;
    return <Stack gap={3}>
      {result.kind === "unknown" ? <p role="alert">{unknown}</p> : null}
      {result.kind === "published" ? <p role="status">{copy.published}</p> : null}
      {(result.kind === "published" || result.kind === "key-rotated") && result.selectionKey
        ? <SelectionLink site={site} handle={request.handle} selectionKey={result.selectionKey} copy={copy} initialLanguage={first ? form.reminderLocale : ""} /> : null}
      <Button type="button" onClick={onClose} text={copy.close} />
    </Stack>;
  }
  const rotate = request.operation === "rotate-key";
  return <Stack gap={3}>
    <p>{rotate ? copy.rotateWarning : first ? copy.first : copy.later}</p>
    {first ? <TermsFields form={form} invalid={invalid} onChange={setForm} copy={copy} disabled={pending} locales={site.locales} /> : null}
    <p role="alert">{problem ?? ""}</p>
    <Button type="button" disabled={pending} onClick={() => void submit()}
      text={pending ? (rotate ? copy.rotating : copy.sending) : rotate ? copy.rotateConfirm : copy.send} />{" "}
    <Button type="button" disabled={pending} onClick={onClose} text={copy.cancel} />
  </Stack>;
}
