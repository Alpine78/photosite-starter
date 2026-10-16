"use client";

import { usePrivateGalleryDraftList } from "@/components/use-private-gallery-draft-list";
import { PrivateGalleryDraftReferencesEditor, type PrivateGalleryDraftReferenceLabels } from "@/components/private-gallery-draft-references-editor";
import { useId, useRef, useState } from "react";

type PrivateGalleryProofDraftAdminItem = {
  readonly handle: string;
  readonly createdAt: string;
  readonly revision: number;
  readonly state: "draft" | "preparing" | "ready";
  readonly upload?: { readonly objectCount: number; readonly openedAt: string; readonly deadline: string; readonly expired: boolean };
  readonly pricing: { readonly includedCount: number; readonly extraUnitPriceMinor: number; readonly currency: string };
  readonly customerReference?: string;
  readonly jobReference?: string;
};

export type PrivateGalleryProofDraftCreatorLabels = PrivateGalleryDraftReferenceLabels & {
  readonly savedReferences: string;
  readonly heading: string;
  readonly description: string;
  readonly includedCount: string;
  readonly extraUnitPriceMinor: string;
  readonly currency: string;
  readonly customerReference: string;
  readonly jobReference: string;
  readonly create: string;
  readonly creating: string;
  readonly created: string;
  readonly listHeading: string;
  readonly empty: string;
  readonly hasMore: string;
  readonly loadMore: string; readonly loadingMore: string; readonly allLoaded: string; readonly loadedCount: string; readonly refresh: string;
  readonly unavailable: string;
  readonly handle: string;
  readonly editPricing: string;
  readonly savePricing: string;
  readonly savingPricing: string;
  readonly savedPricing: string;
  readonly conflictPricing: string;
  readonly invalidPricing: string;
  readonly draftState: string; readonly preparingState: string; readonly readyState: string;
  readonly statusSnapshot: string; readonly objects: string; readonly deadline: string; readonly windowExpired: string;
};

function ProofDraftPricingEditor({
  draft, apiPath, labels, onSaved, onConflict, blocked, mutationLockRef, onPending,
}: {
  readonly draft: PrivateGalleryProofDraftAdminItem;
  readonly apiPath: string;
  readonly labels: PrivateGalleryProofDraftCreatorLabels;
  readonly onSaved: (updated: PrivateGalleryProofDraftAdminItem) => void;
  readonly onConflict: () => void;
  readonly blocked: boolean; readonly mutationLockRef: { current: boolean }; readonly onPending: (pending: boolean) => void;
}) {
  const id = useId();
  const [included, setIncluded] = useState(String(draft.pricing.includedCount));
  const [extra, setExtra] = useState(String(draft.pricing.extraUnitPriceMinor));
  const [currency, setCurrency] = useState(draft.pricing.currency);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<"invalid" | "unavailable" | "conflict" | undefined>();

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blocked || mutationLockRef.current || error === "conflict") return;
    mutationLockRef.current = true; onPending(true);
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(apiPath, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handle: draft.handle,
          expectedRevision: draft.revision,
          pricing: {
            includedCount: Number(included),
            extraUnitPriceMinor: Number(extra),
            currency,
          },
        }),
      });
      if (response.status === 409) {
        setError("conflict");
        onConflict();
        return;
      }
      if (response.status === 400) {
        setError("invalid");
        return;
      }
      if (!response.ok) throw new Error("unavailable");
      const data = await response.json() as { ok?: boolean; draft?: PrivateGalleryProofDraftAdminItem };
      if (data.ok !== true || data.draft === undefined) throw new Error("unavailable");
      onSaved(data.draft);
    } catch {
      setError("unavailable");
    } finally {
      mutationLockRef.current = false; onPending(false);
      setPending(false);
    }
  }

  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-strong">{labels.editPricing}</summary>
      <form onSubmit={save} className="mt-2 grid gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-included`}>{labels.includedCount}</label>
          <input id={`${id}-included`} type="number" min="0" step="1" required value={included}
            onChange={(event) => setIncluded(event.target.value)}
            className="rounded-md border border-border-strong bg-surface px-3 py-1.5 text-strong" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-extra`}>{labels.extraUnitPriceMinor}</label>
          <input id={`${id}-extra`} type="number" min="0" step="1" required value={extra}
            onChange={(event) => setExtra(event.target.value)}
            className="rounded-md border border-border-strong bg-surface px-3 py-1.5 text-strong" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-currency`}>{labels.currency}</label>
          <input id={`${id}-currency`} type="text" maxLength={3} required value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            className="rounded-md border border-border-strong bg-surface px-3 py-1.5 text-strong" />
        </div>
        <button type="submit" aria-disabled={pending || blocked || error === "conflict"}
          className="rounded-md border border-border-strong px-3 py-1.5 text-strong aria-disabled:opacity-50 sm:self-end">
          {pending ? labels.savingPricing : labels.savePricing}
        </button>
      </form>
      {error && error !== "conflict" && <p role="alert" className="mt-2 text-danger">
        {error === "invalid" ? labels.invalidPricing : labels.unavailable}
      </p>}
    </details>
  );
}

function ProofDraftEditors({ draft, apiPath, labels, onSaved, onConflict, onReferencesSaved, reset, restoreFocus }: {
  readonly draft: PrivateGalleryProofDraftAdminItem; readonly apiPath: string; readonly labels: PrivateGalleryProofDraftCreatorLabels;
  readonly onSaved: (row: PrivateGalleryProofDraftAdminItem) => void; readonly onConflict: () => void;
  readonly onReferencesSaved: (row: PrivateGalleryProofDraftAdminItem) => void;
  readonly reset: number; readonly restoreFocus: boolean;
}) {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  return <>
    <ProofDraftPricingEditor key={JSON.stringify([draft.pricing, reset])} draft={draft} apiPath={apiPath} labels={labels}
      onSaved={onSaved} onConflict={onConflict} blocked={busy} mutationLockRef={lock} onPending={setBusy} />
    <PrivateGalleryDraftReferencesEditor key={JSON.stringify([draft.customerReference, draft.jobReference, reset])}
      item={draft} apiPath={apiPath} labels={labels} method="PUT" onSaved={onReferencesSaved}
      restoreFocus={restoreFocus} blocked={busy} mutationLockRef={lock} onPending={setBusy} />
  </>;
}

export function PrivateGalleryProofDraftCreator({
  apiPath, locale, labels,
}: {
  readonly apiPath: string;
  readonly locale: string;
  readonly labels: PrivateGalleryProofDraftCreatorLabels;
}) {
  const id = useId();
  const { list, firstPageReady, loading, listError, refresh, loadMore, acknowledge, cancel } = usePrivateGalleryDraftList<PrivateGalleryProofDraftAdminItem>(apiPath);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<string | undefined>();
  const [includedCount, setIncludedCount] = useState("0");
  const [extraUnitPriceMinor, setExtraUnitPriceMinor] = useState("0");
  const [currency, setCurrency] = useState("");
  const [customerReference, setCustomerReference] = useState("");
  const [jobReference, setJobReference] = useState("");

  const busy = useRef(false);
  const [referenceReset, setReferenceReset] = useState(0);
  const [savedReferenceHandle, setSavedReferenceHandle] = useState<string>();
  const [editNotice, setEditNotice] = useState<"saved" | "references" | "conflict" | undefined>();

  function savedPricing(updated: PrivateGalleryProofDraftAdminItem) {
    acknowledge(updated);
    setEditNotice("saved");
  }

  function conflictedPricing() {
    setEditNotice("conflict");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    cancel();
    setPending(true);
    setError(false);
    setCreated(undefined);
    try {
      const response = await fetch(apiPath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pricing: {
            includedCount: Number(includedCount),
            extraUnitPriceMinor: Number(extraUnitPriceMinor),
            currency,
          },
          ...(customerReference === "" ? {} : { customerReference }),
          ...(jobReference === "" ? {} : { jobReference }),
        }),
      });
      if (!response.ok) throw new Error("unavailable");
      const data = await response.json() as { ok?: boolean; draft?: PrivateGalleryProofDraftAdminItem };
      if (data.ok !== true || data.draft === undefined) throw new Error("unavailable");
      const draft = data.draft;
      setCreated(draft.handle);
      acknowledge(draft, true);
      setCustomerReference("");
      setJobReference("");
    } catch {
      setError(true);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const fields = [
    { name: "included", label: labels.includedCount, value: includedCount, set: setIncludedCount, type: "number", min: "0", maxLength: undefined },
    { name: "extra", label: labels.extraUnitPriceMinor, value: extraUnitPriceMinor, set: setExtraUnitPriceMinor, type: "number", min: "0", maxLength: undefined },
    { name: "currency", label: labels.currency, value: currency, set: setCurrency, type: "text", min: undefined, maxLength: 3 },
    { name: "customer", label: labels.customerReference, value: customerReference, set: setCustomerReference, type: "text", min: undefined, maxLength: 128 },
    { name: "job", label: labels.jobReference, value: jobReference, set: setJobReference, type: "text", min: undefined, maxLength: 128 },
  ] as const;

  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-4">
      <h2 id={`${id}-heading`} className="text-lg font-medium text-strong">{labels.heading}</h2>
      <p className="text-sm text-muted">{labels.description}</p>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <div key={field.name} className="flex flex-col gap-1">
            <label htmlFor={`${id}-${field.name}`} className="text-sm text-muted">{field.label}</label>
            <input
              id={`${id}-${field.name}`}
              type={field.type}
              min={field.min}
              step={field.type === "number" ? "1" : undefined}
              maxLength={field.maxLength}
              required={field.name !== "customer" && field.name !== "job"}
              value={field.value}
              onChange={(event) => field.set(event.target.value)}
              className="rounded-md border border-border-strong bg-surface px-3 py-1.5 text-strong"
            />
          </div>
        ))}
        <button type="submit" disabled={pending}
          className="rounded-md border border-border-strong px-3 py-1.5 text-strong disabled:opacity-50 sm:self-end">
          {pending ? labels.creating : labels.create}
        </button>
      </form>
      {error && <p role="alert" className="text-danger">{labels.unavailable}</p>}
      {editNotice && <p role={editNotice === "conflict" ? "alert" : "status"}>
        {editNotice === "conflict" ? labels.conflictPricing : editNotice === "references" ? labels.savedReferences : labels.savedPricing}
      </p>}
      {created && <p role="status">{labels.created} {labels.handle}: <span className="font-mono">{created}</span></p>}
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium text-strong">{labels.listHeading}</h3>
        <button type="button" disabled={pending || loading} onClick={() => { setReferenceReset((value) => value + 1); setSavedReferenceHandle(undefined); setEditNotice(undefined); void refresh(); }}
          className="rounded-md border border-border-strong px-3 py-1.5 text-strong disabled:opacity-50">{labels.refresh}</button>
      </div>
      {list && list.items.length === 0 && <p className="text-sm text-muted">{labels.empty}</p>}
      {list && list.items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {list.items.map((draft) => (
            <li key={draft.handle} className="rounded-md border border-border-strong p-3 text-sm">
              <span className="font-mono text-strong">{draft.handle}</span>{" · "}
              <time dateTime={draft.createdAt}>{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(draft.createdAt))}</time>
              <p>{draft.state === "ready" ? labels.readyState : draft.state === "preparing" ? labels.preparingState : labels.draftState}</p>
              {draft.upload && <div className="text-muted">
                <p>{labels.statusSnapshot}</p>
                <p>{labels.objects}: {draft.upload.objectCount}</p>
                <p>{labels.deadline}: <time dateTime={draft.upload.deadline}>{draft.upload.deadline} (UTC)</time></p>
                {draft.upload.expired && <p className="text-danger">{labels.windowExpired}</p>}
              </div>}
              <div>{labels.includedCount}: {draft.pricing.includedCount} · {labels.extraUnitPriceMinor}: {draft.pricing.extraUnitPriceMinor} {draft.pricing.currency}</div>
              {draft.customerReference && <div>{labels.customerReference}: {draft.customerReference}</div>}
              {draft.jobReference && <div>{labels.jobReference}: {draft.jobReference}</div>}
              {draft.state !== "ready" && <ProofDraftEditors key={draft.handle}
                draft={draft} apiPath={apiPath} labels={labels} reset={referenceReset}
                restoreFocus={savedReferenceHandle === draft.handle}
                onSaved={savedPricing} onConflict={conflictedPricing}
                onReferencesSaved={(updated) => { savedPricing(updated); setSavedReferenceHandle(updated.handle); setEditNotice("references"); }} /> }
            </li>
          ))}
        </ul>
      )}
      {listError && <p role="alert" className="text-danger">{labels.unavailable}</p>}
      {list && <>
        <p id={`${id}-count`} aria-live="polite" aria-atomic="true" className="text-muted">{labels.loadedCount}: {list.items.length}</p>
        <button type="button" aria-disabled={pending || loading || !list.hasMore} aria-describedby={`${id}-count`}
          onClick={() => { if (!pending && !loading && list.hasMore) void loadMore(); }}
          className="rounded-md border border-border-strong px-3 py-1.5 text-strong aria-disabled:opacity-50">
          {loading ? labels.loadingMore : !firstPageReady ? labels.unavailable : list.hasMore ? labels.loadMore : labels.allLoaded}
        </button>
      </>}
    </section>
  );
}
