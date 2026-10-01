"use client";

import { useEffect, useId, useState } from "react";

type PrivateGalleryProofDraftAdminItem = {
  readonly handle: string;
  readonly createdAt: string;
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
};

type DraftList = { readonly items: readonly PrivateGalleryProofDraftAdminItem[]; readonly hasMore: boolean };

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

  useEffect(() => {
    let active = true;
    fetch(apiPath, { headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        const data = await response.json() as { ok?: boolean } & DraftList;
        if (data.ok !== true || !Array.isArray(data.items) || typeof data.hasMore !== "boolean") {
          throw new Error("unavailable");
        }
        if (active) setList({ items: data.items, hasMore: data.hasMore });
      })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [apiPath]);

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
      setCreated(data.draft.handle);
      setList((previous) => previous === undefined
        ? { items: [data.draft!], hasMore: false }
        : { items: [data.draft!, ...previous.items].slice(0, 100),
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
            </li>
          ))}
        </ul>
      )}
      {list?.hasMore && <p className="text-sm text-muted">{labels.hasMore}</p>}
    </section>
  );
}
