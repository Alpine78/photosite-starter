"use client";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
const subscribe = () => () => {};
export type PrivateGalleryDraftReferenceLabels = {
  readonly customerReference: string; readonly jobReference: string; readonly referenceHelp: string;
  readonly editReferences: string; readonly saveReferences: string; readonly savingReferences: string;
  readonly invalid: string; readonly unavailable: string; readonly conflictReferences: string;
};
type ReferenceItem = { readonly handle: string; readonly revision: number; readonly customerReference?: string; readonly jobReference?: string };
export function PrivateGalleryDraftReferencesEditor<T extends ReferenceItem>({ item, apiPath, labels, onSaved, restoreFocus, method = "PATCH", blocked = false, mutationLockRef, onPending }: {
  readonly item: T; readonly apiPath: string; readonly labels: PrivateGalleryDraftReferenceLabels;
  readonly method?: "PUT" | "PATCH"; readonly blocked?: boolean;
  readonly mutationLockRef?: { current: boolean }; readonly onPending?: (pending: boolean) => void;
  readonly onSaved: (item: T) => void; readonly restoreFocus: boolean;
}) {
  const id = useId();
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const [customer, setCustomer] = useState(item.customerReference ?? "");
  const [job, setJob] = useState(item.jobReference ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<"invalid" | "unavailable" | "conflict">();
  const [open, setOpen] = useState(restoreFocus);
  const summary = useRef<HTMLElement>(null);
  const busy = useRef(false);
  useEffect(() => { if (restoreFocus) summary.current?.focus(); }, [restoreFocus]);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hydrated || busy.current || blocked || mutationLockRef?.current || error === "conflict") return;
    busy.current = true;
    if (mutationLockRef) mutationLockRef.current = true;
    onPending?.(true);
    setPending(true); setError(undefined);
    try {
      const response = await fetch(apiPath, { method, headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: item.handle, expectedRevision: item.revision,
          references: { ...(customer === "" ? {} : { customerReference: customer }), ...(job === "" ? {} : { jobReference: job }) } }) });
      if (response.status === 409) { setError("conflict"); return; }
      if (response.status === 400) { setError("invalid"); return; }
      if (!response.ok) throw new Error("unavailable");
      const data = await response.json() as { ok?: boolean; draft?: T };
      if (data.ok !== true || !data.draft || data.draft.handle !== item.handle ||
          data.draft.revision !== item.revision + 1) throw new Error("unavailable");
      onSaved(data.draft);
    } catch { setError("unavailable"); }
    finally { busy.current = false; if (mutationLockRef) mutationLockRef.current = false; onPending?.(false); setPending(false); }
  }
  return <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="mt-2">
    <summary ref={summary} className="cursor-pointer text-strong">{labels.editReferences}</summary>
    <form method="post" action={apiPath} onSubmit={save} className="mt-2">
      <fieldset disabled={!hydrated} className="grid gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-customer`}>{labels.customerReference}</label>
          <input id={`${id}-customer`} value={customer} readOnly={pending || blocked} maxLength={128} autoComplete="off" spellCheck={false}
            onChange={(event) => setCustomer(event.target.value)} aria-describedby={`${id}-help ${id}-error`}
            aria-invalid={error === "invalid"} className="rounded-md border border-border-strong bg-surface px-3 py-1.5 text-strong" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-job`}>{labels.jobReference}</label>
          <input id={`${id}-job`} value={job} readOnly={pending || blocked} maxLength={128} autoComplete="off" spellCheck={false}
            onChange={(event) => setJob(event.target.value)} aria-describedby={`${id}-help ${id}-error`}
            aria-invalid={error === "invalid"} className="rounded-md border border-border-strong bg-surface px-3 py-1.5 text-strong" />
        </div>
        <p id={`${id}-help`} className="text-muted sm:col-span-2">{labels.referenceHelp}</p>
        <button type="submit" aria-disabled={pending || blocked || error === "conflict"}
          className="rounded-md border border-border-strong px-3 py-1.5 text-strong aria-disabled:opacity-50">
          {pending ? labels.savingReferences : labels.saveReferences}
        </button>
      </fieldset>
    </form>
    <p id={`${id}-error`} role="alert" className="text-danger">{error === "conflict" ? labels.conflictReferences : error ? labels[error] : ""}</p>
  </details>;
}

