"use client";

/**
 * Proof selection on `/client-proof/<handle>` (ADR-0038 decisions 4, 5 and 8,
 * action item 3). Progressive enhancement over the server-rendered proofs:
 * without a `#select=` key in the fragment, or without JavaScript, nothing
 * renders and the page stays read-only.
 *
 * The server's state is the only truth: nothing is shown optimistically, and
 * writes are serialized. A write whose outcome is uncertain (no usable answer,
 * an unknown or committed-but-unread result) is never replayed: one read
 * recovers the state, and while that read fails every change stays blocked.
 * Answers for an earlier key are discarded when the fragment changes.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { BuiltInLabels } from "@/lib/deployment-config";
import { formatUtcDateTime } from "@/lib/date-format";
import { PROOF_CURRENCIES } from "@/lib/proof-terms";
import { selectionKeyFromHash } from "@/lib/proof-selection-link";

type Labels = BuiltInLabels["proofSelection"];
type Selection = {
  state: "open" | "confirmed"; revision: string | null; references: string[]; stale: boolean;
  includedCount: number; extraUnitPriceMinor: number; currency: string;
  selectedCount: number; extraCount: number; extraTotalMinor: number; version?: number; confirmedAt?: string;
};
type Phase = "loading" | "ready" | "unavailable" | "load-failed";
type Message = "saved" | "conflict" | "stale" | "rate-limited" | "empty" | "failed" | undefined;
type Answer = { status: number; body: Record<string, unknown> } | "uncertain";

const subscribeToHash = (listener: () => void) => {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
};

function isSelection(value: unknown): value is Selection {
  const row = value as Selection | null;
  return typeof row === "object" && row !== null && (row.state === "open" || row.state === "confirmed") &&
    Array.isArray(row.references) && typeof row.stale === "boolean" && typeof row.currency === "string" &&
    [row.includedCount, row.extraUnitPriceMinor, row.selectedCount, row.extraCount, row.extraTotalMinor].every(Number.isSafeInteger);
}

async function send(body: Record<string, unknown>): Promise<Answer> {
  try {
    const response = await fetch("/api/proof-selection", {
      method: "POST", cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const parsed: unknown = await response.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "uncertain";
    return { status: response.status, body: parsed as Record<string, unknown> };
  } catch {
    return "uncertain";
  }
}

function money(minor: number, currency: string, locale: string): string {
  const digits = Object.hasOwn(PROOF_CURRENCIES, currency) ? PROOF_CURRENCIES[currency] : 2;
  return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(minor / 10 ** digits);
}
const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/gu, (match, name: string) => name in values ? String(values[name]) : match);

type Context = {
  active: boolean; selection?: Selection; busy: boolean; blocked: boolean;
  toggle(reference: string): void; labels: Labels; referenceLabel(reference: string): string;
};
const SelectionContext = createContext<Context | undefined>(undefined);

type ProviderProps = { handle: string; locale: string; labels: Labels; referenceLabel: string; children: ReactNode };

/** Reads the key from the fragment; a new key starts a fresh session, discarding every earlier answer. */
export function ProofSelectionProvider(props: ProviderProps) {
  const key = useSyncExternalStore(subscribeToHash, () => selectionKeyFromHash(window.location.hash) ?? "", () => "");
  return <SelectionSession key={key} selectionKey={key} {...props} />;
}

function SelectionSession({ handle, locale, labels, referenceLabel, children, selectionKey: key }: ProviderProps & { selectionKey: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [selection, setSelection] = useState<Selection>();
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [message, setMessage] = useState<Message>();
  const [reviewing, setReviewing] = useState<string | null>(null);
  const generation = useRef(0);
  const reviewButton = useRef<HTMLButtonElement>(null), resultHeading = useRef<HTMLHeadingElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const focusResult = useRef(false);

  /** One authoritative read; `true` when it produced a state to show. */
  const read = useCallback(async (current: number): Promise<boolean> => {
    const answer = await send({ operation: "read", handle, key });
    if (current !== generation.current) return false;
    if (answer !== "uncertain" && answer.status === 200 && isSelection(answer.body.selection)) {
      setSelection(answer.body.selection); setPhase("ready"); return true;
    }
    if (answer !== "uncertain" && answer.status === 404) { setPhase("unavailable"); setSelection(undefined); return false; }
    if (answer !== "uncertain" && answer.status === 429) setMessage("rate-limited");
    return false;
  }, [handle, key]);

  useEffect(() => {
    if (!key) return;
    const current = ++generation.current;
    void read(current).then((shown) => {
      if (!shown && current === generation.current) setPhase((value) => value === "loading" ? "load-failed" : value);
    });
  }, [key, read]);
  useEffect(() => {
    if (focusResult.current && selection?.state === "confirmed") { focusResult.current = false; resultHeading.current?.focus(); }
  }, [selection?.state]);

  const write = useCallback(async (body: Record<string, unknown>) => {
    const current = generation.current;
    setBusy(true); setMessage(undefined);
    const answer = await send({ ...body, handle, key });
    if (current !== generation.current) return;
    const uncertain = answer === "uncertain" || answer.status === 202 || (answer.status === 503 && answer.body.status === "unknown") ||
      (answer.status === 200 && !isSelection(answer.body.selection));
    if (uncertain) {
      // Never replay the write: read what is actually saved.
      const shown = await read(current);
      if (current !== generation.current) return;
      setBlocked(!shown); setBusy(false);
      return;
    }
    if (answer.status === 200) { setSelection(answer.body.selection as Selection); setMessage("saved"); }
    else if (answer.status === 404) { setPhase("unavailable"); setSelection(undefined); }
    else if (answer.status === 429) setMessage("rate-limited");
    else if ((answer.status === 409 || answer.status === 422) && isSelection(answer.body.selection)) {
      setSelection(answer.body.selection);
      const reason = answer.body.reason;
      setMessage(reason === "empty" ? "empty" : reason === "stale-selection" ? "stale" : reason === "confirmed" ? undefined : "conflict");
    } else setMessage("failed");
    setBusy(false);
  }, [handle, key, read]);

  const recover = useCallback(async () => {
    const current = generation.current;
    setBusy(true);
    const shown = await read(current);
    if (current !== generation.current) return;
    setBlocked(!shown); setBusy(false);
  }, [read]);

  const toggle = useCallback((reference: string) => {
    if (!selection || selection.state !== "open" || busy || blocked) return;
    const references = selection.references.includes(reference)
      ? selection.references.filter((value) => value !== reference) : [...selection.references, reference];
    void write({ operation: "select", expectedRevision: selection.revision, references });
  }, [selection, busy, blocked, write]);

  const active = key !== "";
  const labelFor = (reference: string) => referenceLabel.replace("{reference}", reference);
  const context: Context = { active: active && phase === "ready", selection, busy, blocked, toggle, labels, referenceLabel: labelFor };
  // The confirmation step stays bound to the exact state the customer opened it on.
  const reviewOpen = reviewing !== null && reviewing === selection?.revision && selection.state === "open";
  const canConfirm = selection?.state === "open" && !selection.stale && selection.selectedCount > 0 && !busy && !blocked && selection.revision !== null;
  useEffect(() => {
    // The trigger unmounts on entry. Read the summary before tabbing to confirmation.
    if (reviewOpen) reviewHeading.current?.focus();
  }, [reviewOpen]);

  return <SelectionContext.Provider value={context}>
    {active ? <section aria-labelledby="proof-selection-heading" className="mb-8 space-y-3 rounded-sm border border-border p-4">
      {selection?.state === "confirmed" ? <>
        <h2 id="proof-selection-heading" ref={resultHeading} tabIndex={-1} className="text-lg font-semibold focus-visible:outline-2 focus-visible:outline-focus">{labels.confirmedHeading}</h2>
        <p>{fill(labels.confirmedMeta, { version: selection.version ?? "", date: selection.confirmedAt ? formatUtcDateTime(selection.confirmedAt, locale) : "" })}</p>
        <p>{fill(labels.counts, { count: selection.selectedCount, included: selection.includedCount })}</p>
        {selection.extraCount > 0 ? <p>{fill(labels.price, { count: selection.extraCount, price: money(selection.extraUnitPriceMinor, selection.currency, locale), total: money(selection.extraTotalMinor, selection.currency, locale) })}</p> : null}
        <h3 className="font-semibold">{labels.confirmedList}</h3>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 tabular-nums">{selection.references.map((reference) => <li key={reference}>{labelFor(reference)}</li>)}</ul>
        <p className="text-sm text-muted">{labels.reopenNote}</p>
        <p className="text-sm text-muted">{labels.summaryNote}</p>
      </> : <>
        <h2 id="proof-selection-heading" className="text-lg font-semibold">{labels.heading}</h2>
        <p className="text-sm text-muted">{labels.possession}</p>
        {phase === "loading" ? <p>{labels.loading}</p> : null}
        {phase === "unavailable" ? <p>{labels.unavailable}</p> : null}
        {phase === "load-failed" ? <p>{labels.loadFailed}{" "}
          <button type="button" disabled={busy} onClick={() => void recover()} className="underline focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-60">{labels.checkAgain}</button></p> : null}
        {selection ? <>
          <p>{fill(labels.counts, { count: selection.selectedCount, included: selection.includedCount })}</p>
          <p>{fill(labels.price, { count: selection.extraCount, price: money(selection.extraUnitPriceMinor, selection.currency, locale), total: money(selection.extraTotalMinor, selection.currency, locale) })}</p>
          <p className="text-sm text-muted">{labels.summaryNote}</p>
          {selection.stale ? <p>{labels.stale}{" "}
            <button type="button" disabled={busy || blocked} onClick={() => void write({ operation: "select", expectedRevision: selection.revision, references: selection.references })}
              className="underline focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-60">{labels.saveAgain}</button></p> : null}
          {reviewOpen ? <div className="space-y-2">
            <h3 ref={reviewHeading} tabIndex={-1} className="focus-visible:outline-2 focus-visible:outline-focus">{fill(labels.confirmReview, { count: selection.selectedCount })}</h3>
            <ul aria-label={labels.confirmedList} className="flex flex-wrap gap-x-4 gap-y-1 tabular-nums">{selection.references.map((reference) => <li key={reference}>{labelFor(reference)}</li>)}</ul>
            <button type="button" disabled={!canConfirm} onClick={() => { focusResult.current = true; void write({ operation: "confirm", expectedRevision: reviewing }); }}
              className="mr-3 rounded-sm border border-border-strong px-3 py-1 font-semibold focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-60">{labels.confirmFinal}</button>
            <button type="button" onClick={() => { setReviewing(null); requestAnimationFrame(() => reviewButton.current?.focus()); }}
              className="rounded-sm px-3 py-1 underline focus-visible:outline-2 focus-visible:outline-focus">{labels.cancel}</button>
          </div> : <button type="button" ref={reviewButton} disabled={!canConfirm} onClick={() => setReviewing(selection.revision)}
            className="rounded-sm border border-border-strong px-3 py-1 font-semibold focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-60">{labels.confirm}</button>}
        </> : null}
      </>}
      {blocked ? <p>{labels.uncertain}{" "}
        <button type="button" disabled={busy} onClick={() => void recover()} className="underline focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-60">{labels.checkAgain}</button></p> : null}
      <p role="status" className="text-sm">{busy ? labels.saving : message === "saved" ? labels.saved : message === "conflict" ? labels.conflict
        : message === "stale" ? labels.stale : message === "rate-limited" ? labels.rateLimited : message === "empty" ? labels.emptyRefused
        : message === "failed" ? labels.loadFailed : ""}</p>
    </section> : null}
    {children}
  </SelectionContext.Provider>;
}

/** The per-proof control: a toggle while the selection is open, a plain mark once confirmed. */
export function ProofSelectToggle({ reference }: { reference: string }) {
  const context = useContext(SelectionContext);
  if (!context?.active || !context.selection) return null;
  const { selection, labels } = context;
  const chosen = selection.references.includes(reference);
  if (selection.state === "confirmed") return chosen ? <p className="mt-1 text-sm font-semibold">{labels.selected}</p> : null;
  // aria-disabled rather than disabled: a disabled button would drop keyboard focus during every save.
  const unavailable = context.busy || context.blocked;
  return <button type="button" aria-pressed={chosen} aria-disabled={unavailable} onClick={() => context.toggle(reference)}
    className="mt-2 rounded-sm border border-border-strong px-3 py-1 text-sm aria-pressed:bg-accent aria-pressed:text-accent-foreground focus-visible:outline-2 focus-visible:outline-focus aria-disabled:opacity-60">
    {fill(labels.toggle, { reference: context.referenceLabel(reference) })}
  </button>;
}
