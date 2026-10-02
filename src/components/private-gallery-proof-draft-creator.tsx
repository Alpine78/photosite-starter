"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

type PrivateGalleryProofDraftAdminItem = {
  readonly handle: string;
  readonly createdAt: string;
  readonly revision: number;
  readonly pricing: { readonly includedCount: number; readonly extraUnitPriceMinor: number; readonly currency: string };
  readonly customerReference?: string;
  readonly jobReference?: string;
};

export type PrivateGalleryProofDraftCreatorLabels = {
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
  readonly unavailable: string;
  readonly handle: string;
  readonly editPricing: string;
  readonly savePricing: string;
  readonly savingPricing: string;
  readonly savedPricing: string;
  readonly conflictPricing: string;
  readonly invalidPricing: string;
};

type DraftList = { readonly items: readonly PrivateGalleryProofDraftAdminItem[]; readonly hasMore: boolean };

function ProofDraftPricingEditor({
  draft, apiPath, labels, onSaved, onConflict,
}: {
  readonly draft: PrivateGalleryProofDraftAdminItem;
  readonly apiPath: string;
  readonly labels: PrivateGalleryProofDraftCreatorLabels;
  readonly onSaved: (updated: PrivateGalleryProofDraftAdminItem) => void;
  readonly onConflict: () => void;
}) {
  const id = useId();
  const [included, setIncluded] = useState(String(draft.pricing.includedCount));
  const [extra, setExtra] = useState(String(draft.pricing.extraUnitPriceMinor));
  const [currency, setCurrency] = useState(draft.pricing.currency);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<"invalid" | "unavailable" | undefined>();

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
        <button type="submit" disabled={pending}
          className="rounded-md border border-border-strong px-3 py-1.5 text-strong disabled:opacity-50 sm:self-end">
          {pending ? labels.savingPricing : labels.savePricing}
        </button>
      </form>
      {error && <p role="alert" className="mt-2 text-danger">
        {error === "invalid" ? labels.invalidPricing : labels.unavailable}
      </p>}
    </details>
  );
}

export function PrivateGalleryProofDraftCreator({
  apiPath, locale, labels,
}: {
  readonly apiPath: string;
  readonly locale: string;
  readonly labels: PrivateGalleryProofDraftCreatorLabels;
}) {
  const id = useId();
  const [list, setList] = useState<DraftList | undefined>();
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<string | undefined>();
  const [includedCount, setIncludedCount] = useState("0");
  const [extraUnitPriceMinor, setExtraUnitPriceMinor] = useState("0");
  const [currency, setCurrency] = useState("");
  const [customerReference, setCustomerReference] = useState("");
  const [jobReference, setJobReference] = useState("");

  const listEpoch = useRef(0);
  const [editNotice, setEditNotice] = useState<"saved" | "conflict" | undefined>();

  const refresh = useCallback(async () => {
    const epoch = ++listEpoch.current;
    try {
      const response = await fetch(apiPath, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error("unavailable");
      const data = await response.json() as { ok?: boolean } & DraftList;
      if (data.ok !== true || !Array.isArray(data.items) || typeof data.hasMore !== "boolean") {
        throw new Error("unavailable");
      }
      if (epoch === listEpoch.current) {
        setList({ items: data.items, hasMore: data.hasMore });
        setError(false);
      }
    } catch {
      if (epoch === listEpoch.current) setError(true);
    }
  }, [apiPath]);

  useEffect(() => { void refresh(); }, [refresh]);

  function savedPricing(updated: PrivateGalleryProofDraftAdminItem) {
    ++listEpoch.current;
    setList((previous) => previous === undefined ? previous : {
      ...previous,
      items: previous.items.map((draft) => draft.handle === updated.handle ? updated : draft),
    });
    setEditNotice("saved");
  }

  function conflictedPricing() {
    setEditNotice("conflict");
    void refresh();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      ++listEpoch.current;
      setList((previous) => previous === undefined
        ? { items: [draft], hasMore: false }
        : { items: [draft, ...previous.items].slice(0, 100),
            hasMore: previous.hasMore || previous.items.length >= 100 });
      setCustomerReference("");
      setJobReference("");
    } catch {
      setError(true);
    } finally {
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
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-medium text-strong">{labels.heading}</h2>
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
        {editNotice === "conflict" ? labels.conflictPricing : labels.savedPricing}
      </p>}
      {created && <p role="status">{labels.created} {labels.handle}: <span className="font-mono">{created}</span></p>}
      <h3 className="font-medium text-strong">{labels.listHeading}</h3>
      {list && list.items.length === 0 && <p className="text-sm text-muted">{labels.empty}</p>}
      {list && list.items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {list.items.map((draft) => (
            <li key={draft.handle} className="rounded-md border border-border-strong p-3 text-sm">
              <span className="font-mono text-strong">{draft.handle}</span>{" · "}
              <time dateTime={draft.createdAt}>{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(draft.createdAt))}</time>
              <div>{labels.includedCount}: {draft.pricing.includedCount} · {labels.extraUnitPriceMinor}: {draft.pricing.extraUnitPriceMinor} {draft.pricing.currency}</div>
              {draft.customerReference && <div>{labels.customerReference}: {draft.customerReference}</div>}
              {draft.jobReference && <div>{labels.jobReference}: {draft.jobReference}</div>}
              <ProofDraftPricingEditor key={`${draft.handle}-${draft.revision}`}
                draft={draft} apiPath={apiPath} labels={labels}
                onSaved={savedPricing} onConflict={conflictedPricing} />
            </li>
          ))}
        </ul>
      )}
      {list?.hasMore && <p className="text-sm text-muted">{labels.hasMore}</p>}
    </section>
  );
}
