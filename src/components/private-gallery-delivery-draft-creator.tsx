"use client";
import { usePrivateGalleryDraftList } from "@/components/use-private-gallery-draft-list";
import { PrivateGalleryDraftReferencesEditor } from "@/components/private-gallery-draft-references-editor";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

export type DeliveryDraftCreatorLabels = {
  readonly draftState: string; readonly preparingState: string; readonly readyState: string;
  readonly statusSnapshot: string; readonly plannedPreviews: string; readonly plannedZips: string; readonly deadline: string; readonly windowExpired: string;
  readonly heading: string; readonly description: string; readonly customerReference: string;
  readonly jobReference: string; readonly referenceHelp: string; readonly create: string;
  readonly refresh: string; readonly creating: string; readonly created: string; readonly listHeading: string;
  readonly loadMore: string; readonly loadingMore: string; readonly allLoaded: string; readonly loadedCount: string;
  readonly empty: string; readonly hasMore: string; readonly unavailable: string;
  readonly invalid: string; readonly handle: string; readonly javascriptRequired: string;
  readonly editReferences: string; readonly saveReferences: string; readonly savingReferences: string;
  readonly savedReferences: string; readonly conflictReferences: string;
};
export type DeliveryDraftListItem = { readonly handle: string; readonly createdAt: string; readonly revision: number;
  readonly customerReference?: string; readonly jobReference?: string;
  readonly state: "draft" | "preparing" | "ready";
  readonly upload?: { readonly plannedPreviewCount: number; readonly plannedZipCount: 1; readonly openedAt: string; readonly deadline: string; readonly expired: boolean };
};
type Item = DeliveryDraftListItem;
const subscribe = () => () => {};

export function PrivateGalleryDeliveryDraftCreator({ apiPath, locale, labels }: {
  readonly apiPath: string; readonly locale: string; readonly labels: DeliveryDraftCreatorLabels;
}) {
  const id = useId();
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const { list, firstPageReady, loading, listError, refresh, loadMore, acknowledge, cancel } = usePrivateGalleryDraftList<Item>(apiPath);
  const [customer, setCustomer] = useState("");
  const [job, setJob] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<"created" | "invalid" | "unavailable" | "savedReferences">();
  const [savedHandle, setSavedHandle] = useState<string>();
  const active = useRef(false);
  const busy = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || !hydrated) return;
    busy.current = true;
    setPending(true);
    setNotice(undefined);
    setSavedHandle(undefined);
    // A preceding list request may contain the state before this create.
    cancel();
    try {
      const response = await fetch(apiPath, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(customer === "" ? {} : { customerReference: customer }), ...(job === "" ? {} : { jobReference: job }) }) });
      if (response.status === 400) { if (active.current) setNotice("invalid"); return; }
      if (!response.ok) throw new Error("unavailable");
      const data = await response.json() as { ok?: boolean; draft?: Item };
      if (data.ok !== true || !data.draft || typeof data.draft.handle !== "string") throw new Error("unavailable");
      if (active.current) {
        acknowledge(data.draft, true);
        setCustomer(""); setJob(""); setNotice("created");
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
        <p className="mt-2 text-strong" role={["draft", "preparing", "ready"].includes(item.state) ? undefined : "alert"}>
          {item.state === "draft" ? labels.draftState : item.state === "preparing" ? labels.preparingState : item.state === "ready" ? labels.readyState : labels.unavailable}
        </p>
        {item.upload && (item.state === "preparing" || item.state === "ready") && <div className="mt-1 text-muted">
          <p>{labels.plannedPreviews}: {item.upload.plannedPreviewCount}{" · "}{labels.plannedZips}: {item.upload.plannedZipCount}</p>
          <p>{labels.deadline}: <time dateTime={item.upload.deadline}>{item.upload.deadline}</time>{" (UTC)"}</p>
          <p>{labels.statusSnapshot}</p>
          {item.upload.expired && <p>{labels.windowExpired}</p>}
        </div>}
        {item.state === "draft" && <PrivateGalleryDraftReferencesEditor key={`${item.handle}-${item.revision}`} item={item} apiPath={apiPath} labels={labels}
          restoreFocus={savedHandle === item.handle}
          onSaved={(updated) => {
            acknowledge(updated);
            setSavedHandle(updated.handle);
            setNotice("savedReferences");
          }} />}
      </li>)}
    </ul>
    {listError && <p role="alert" className="text-danger">{labels.unavailable}</p>}
    {list && <>
      <p id={`${id}-count`} aria-live="polite" aria-atomic="true" className="text-muted">{labels.loadedCount}: {list.items.length}</p>
      <button type="button" aria-disabled={pending || loading || !list.hasMore} aria-describedby={`${id}-count`}
        onClick={() => { if (!pending && !loading && list.hasMore) void loadMore(); }}
        className="rounded-md border border-border-strong px-3 py-1.5 text-strong aria-disabled:opacity-50">
        {loading ? labels.loadingMore : !firstPageReady ? labels.unavailable : list.hasMore ? labels.loadMore : labels.allLoaded}
      </button>
    </>}
  </section>;
}
