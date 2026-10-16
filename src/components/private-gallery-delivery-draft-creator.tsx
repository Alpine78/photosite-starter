"use client";
import { PrivateGalleryDraftReferencesEditor } from "@/components/private-gallery-draft-references-editor";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

export type DeliveryDraftCreatorLabels = {
  readonly heading: string; readonly description: string; readonly customerReference: string;
  readonly jobReference: string; readonly referenceHelp: string; readonly create: string;
  readonly refresh: string; readonly creating: string; readonly created: string; readonly listHeading: string;
  readonly empty: string; readonly hasMore: string; readonly unavailable: string;
  readonly invalid: string; readonly handle: string; readonly javascriptRequired: string;
  readonly editReferences: string; readonly saveReferences: string; readonly savingReferences: string;
  readonly savedReferences: string; readonly conflictReferences: string;
};
export type DeliveryDraftListItem = { readonly handle: string; readonly createdAt: string; readonly revision: number;
  readonly customerReference?: string; readonly jobReference?: string };
type Item = DeliveryDraftListItem;
type List = { readonly items: readonly Item[]; readonly hasMore: boolean };
const subscribe = () => () => {};

async function fetchDeliveryDraftList(apiPath: string, signal: AbortSignal): Promise<List> {
  const response = await fetch(apiPath, { signal, cache: "no-store", headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("unavailable");
  const data = await response.json() as { ok?: boolean } & List;
  if (data.ok !== true || !Array.isArray(data.items) || data.items.length > 100 || typeof data.hasMore !== "boolean") throw new Error("unavailable");
  return { items: data.items, hasMore: data.hasMore };
}


export function PrivateGalleryDeliveryDraftCreator({ apiPath, locale, labels }: {
  readonly apiPath: string; readonly locale: string; readonly labels: DeliveryDraftCreatorLabels;
}) {
  const id = useId();
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const [list, setList] = useState<List>();
  const [customer, setCustomer] = useState("");
  const [job, setJob] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<"created" | "invalid" | "unavailable" | "savedReferences">();
  const [savedHandle, setSavedHandle] = useState<string>();
  const active = useRef(false);
  const busy = useRef(false);
  const epoch = useRef(0);
  const controller = useRef<AbortController | undefined>(undefined);
  const refresh = useCallback(() => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const version = ++epoch.current;
    // The effect subscribes; state changes only after the request settles.
    // The async helper also turns a synchronous fetch failure into a rejection.
    return fetchDeliveryDraftList(apiPath, abort.signal).then((data) => {
      if (active.current && epoch.current === version) setList(data);
    }, () => {
      if (!abort.signal.aborted && active.current && epoch.current === version) setNotice("unavailable");
    });
  }, [apiPath]);
  const stop = useCallback(() => { active.current = false; ++epoch.current; controller.current?.abort(); }, []);
  useEffect(() => {
    active.current = true;
    void refresh();
    return stop;
  }, [refresh, stop]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || !hydrated) return;
    busy.current = true;
    setPending(true);
    setNotice(undefined);
    setSavedHandle(undefined);
    // A preceding list request may contain the state before this create.
    ++epoch.current;
    controller.current?.abort();
    try {
      const response = await fetch(apiPath, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(customer === "" ? {} : { customerReference: customer }), ...(job === "" ? {} : { jobReference: job }) }) });
      if (response.status === 400) { if (active.current) setNotice("invalid"); return; }
      if (!response.ok) throw new Error("unavailable");
      const data = await response.json() as { ok?: boolean; draft?: Item };
      if (data.ok !== true || !data.draft || typeof data.draft.handle !== "string") throw new Error("unavailable");
      if (active.current) {
        // Keep the acknowledged creation visible even if a reference save
        // cancels the following refresh before it returns the new row.
        const draft = data.draft;
        setList((previous) => ({ items: [draft, ...(previous?.items ?? []).filter((row) => row.handle !== draft.handle)].slice(0, 100),
          hasMore: (previous?.hasMore ?? false) || (previous?.items.length ?? 0) >= 100 }));
        setCustomer(""); setJob(""); setNotice("created");
        await refresh();
      }
    } catch { if (active.current) setNotice("unavailable"); }
    finally { busy.current = false; if (active.current) setPending(false); }
  }
  return <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-4">
    <h2 id={`${id}-heading`} className="text-lg font-medium text-strong">{labels.heading}</h2>
    <p className="text-sm text-muted">{labels.description}</p>
    <form method="post" action={apiPath} onSubmit={submit} aria-label={labels.create}>
      <fieldset disabled={!hydrated} className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-customer`}>{labels.customerReference}</label>
          <input id={`${id}-customer`} readOnly={pending} value={customer} maxLength={128} onChange={(event) => setCustomer(event.target.value)}
            aria-invalid={notice === "invalid"} aria-describedby={notice === "invalid" ? `${id}-help ${id}-status` : `${id}-help`} className="rounded-md border border-border-strong bg-surface px-3 py-1.5 text-strong" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-job`}>{labels.jobReference}</label>
          <input id={`${id}-job`} readOnly={pending} value={job} maxLength={128} onChange={(event) => setJob(event.target.value)}
            aria-invalid={notice === "invalid"} aria-describedby={notice === "invalid" ? `${id}-help ${id}-status` : `${id}-help`} className="rounded-md border border-border-strong bg-surface px-3 py-1.5 text-strong" />
        </div>
        <p id={`${id}-help`} className="text-sm text-muted sm:col-span-2">{labels.referenceHelp}</p>
        <button type="submit" aria-disabled={pending} className="rounded-md border border-border-strong px-3 py-1.5 text-strong aria-disabled:opacity-50">
          {pending ? labels.creating : labels.create}
        </button>
      </fieldset>
    </form>
    <noscript><p className="text-muted">{labels.javascriptRequired}</p></noscript>
    <p id={`${id}-status`} role="status" aria-live="polite" aria-atomic="true" className={notice === "invalid" || notice === "unavailable" ? "text-danger" : "text-muted"}>
      {notice === undefined ? "" : labels[notice]}
    </p>
    <div className="flex items-center justify-between gap-3">
      <h3 className="font-medium text-strong">{labels.listHeading}</h3>
      <button type="button" disabled={!hydrated || pending} onClick={() => { setNotice(undefined); setSavedHandle(undefined); void refresh(); }}
        className="rounded-md border border-border-strong px-3 py-1.5 text-strong disabled:opacity-50">{labels.refresh}</button>
    </div>
    {list?.items.length === 0 && <p className="text-muted">{labels.empty}</p>}
    <ul className="flex flex-col gap-2">
      {list?.items.map((item) => <li key={item.handle} className="rounded-md border border-border-strong p-3 text-sm text-muted">
        <span className="block break-all">{labels.handle}: {item.handle}</span>
        <time dateTime={item.createdAt}>{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))}</time>
        {item.customerReference !== undefined && <span className="block break-words">{labels.customerReference}: {item.customerReference}</span>}
        {item.jobReference !== undefined && <span className="block break-words">{labels.jobReference}: {item.jobReference}</span>}
        <PrivateGalleryDraftReferencesEditor key={`${item.handle}-${item.revision}`} item={item} apiPath={apiPath} labels={labels}
          restoreFocus={savedHandle === item.handle}
          onSaved={(updated) => {
            ++epoch.current; controller.current?.abort();
            setList((previous) => previous && { ...previous, items: previous.items.map((row) => row.handle === updated.handle ? updated : row) });
            setSavedHandle(updated.handle);
            setNotice("savedReferences");
          }} />
      </li>)}
    </ul>
    {list?.hasMore && <p className="text-sm text-muted">{labels.hasMore}</p>}
  </section>;
}
