"use client";

import { useId, useState, useSyncExternalStore } from "react";

import { formatPrivateGalleryProofMoney } from "@/lib/private-gallery-proof-money";

const subscribeToNothing = () => () => {};

export type PrivateGalleryProofAdminStatus = {
  readonly handle: string;
  readonly confirmed: boolean;
  readonly draftRevision: number;
  readonly latestConfirmationVersion: number;
  readonly pricing: {
    readonly includedCount: number;
    readonly extraUnitPriceMinor: number;
    readonly currency: string;
  };
  readonly currentSummary?: {
    readonly selectedCount: number;
    readonly extraCount: number;
    readonly extraTotalMinor: number;
    readonly currency: string;
  };
  readonly confirmedAt?: string;
  readonly notification?: {
    readonly state: "pending" | "sent" | "failed";
    readonly attempts: number;
    readonly lastError?: string;
    readonly sentAt?: string;
    readonly nextAttemptAt?: string;
  };
};

export type PrivateGalleryProofAdminLabels = {
  readonly heading: string;
  readonly handleLabel: string;
  readonly lookUp: string;
  readonly looking: string;
  readonly notFound: string;
  readonly unavailable: string;
  readonly confirmedLabel: string;
  readonly openLabel: string;
  readonly draftRevisionLabel: string;
  readonly latestConfirmationVersionLabel: string;
  readonly pricingLabel: string;
  readonly currentSummaryLabel: string;
  readonly confirmedAtLabel: string;
  readonly notificationHeading: string;
  readonly notificationNone: string;
  readonly notificationPending: string;
  readonly notificationSent: string;
  readonly notificationFailed: string;
  readonly notificationAttemptsLabel: string;
  readonly notificationLastErrorLabel: string;
  readonly notificationSentAtLabel: string;
  readonly notificationNextAttemptAtLabel: string;
  readonly reopenButton: string;
  readonly reopening: string;
  readonly reopenConflict: string;
  readonly reopenNotConfirmed: string;
  readonly resendButton: string;
  readonly resending: string;
  readonly resent: string;
};

type State =
  | { readonly kind: "idle" }
  | { readonly kind: "looking" }
  | { readonly kind: "found"; readonly status: PrivateGalleryProofAdminStatus }
  | { readonly kind: "not-found" }
  | { readonly kind: "unavailable" };

type ActionState =
  | { readonly kind: "idle" }
  | { readonly kind: "reopening" }
  | { readonly kind: "resending" }
  | { readonly kind: "reopen-conflict" }
  | { readonly kind: "reopen-not-confirmed" }
  | { readonly kind: "resent" };

async function fetchStatus(
  apiPathPrefix: string,
  handle: string,
): Promise<{ readonly kind: "found"; readonly status: PrivateGalleryProofAdminStatus } | { readonly kind: "not-found" } | { readonly kind: "unavailable" }> {
  let response: Response;
  try {
    response = await fetch(`${apiPathPrefix}/${encodeURIComponent(handle)}`, {
      headers: { accept: "application/json" },
    });
  } catch {
    return { kind: "unavailable" };
  }
  if (response.status === 404) return { kind: "not-found" };
  if (!response.ok) return { kind: "unavailable" };
  const body = (await response.json().catch(() => undefined)) as
    | { ok?: boolean; status?: PrivateGalleryProofAdminStatus }
    | undefined;
  if (body?.ok !== true || body.status === undefined) return { kind: "unavailable" };
  return { kind: "found", status: body.status };
}

/**
 * The administrator's own proof-gallery status panel (AB#130): look up a
 * gallery by its handle, see its draft/confirmation state and notification
 * delivery status, and reopen or resend. Every action re-fetches the status
 * afterwards rather than trusting an optimistic local update — the point of
 * showing this at all is that the operator sees what the server actually
 * did, including a conflict from something else changing the same gallery.
 */
export function PrivateGalleryProofAdminPanel({
  apiPathPrefix,
  locale,
  labels,
}: {
  readonly apiPathPrefix: string;
  readonly locale: string;
  readonly labels: PrivateGalleryProofAdminLabels;
}) {
  const handleFieldId = useId();
  const hydrated = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
  const [handle, setHandle] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [action, setAction] = useState<ActionState>({ kind: "idle" });

  async function lookUp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (handle.trim().length === 0) return;
    setState({ kind: "looking" });
    setAction({ kind: "idle" });
    setState(await fetchStatus(apiPathPrefix, handle.trim()));
  }

  async function act(body: Record<string, unknown>) {
    if (state.kind !== "found") return;
    setAction({ kind: body.action === "reopen" ? "reopening" : "resending" });
    let response: Response;
    try {
      response = await fetch(`${apiPathPrefix}/${encodeURIComponent(state.status.handle)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      setAction({ kind: "idle" });
      setState({ kind: "unavailable" });
      return;
    }
    if (response.status === 409) {
      setAction({ kind: "reopen-conflict" });
    } else if (response.status === 422) {
      setAction({ kind: "reopen-not-confirmed" });
    } else if (response.ok && body.action === "resend") {
      setAction({ kind: "resent" });
    } else {
      setAction({ kind: "idle" });
    }
    setState(await fetchStatus(apiPathPrefix, state.status.handle));
  }

  const money = (amountMinor: number, currency: string) =>
    formatPrivateGalleryProofMoney(amountMinor, currency, locale);

  const notificationStateLabel = (notificationState: "pending" | "sent" | "failed") =>
    notificationState === "pending"
      ? labels.notificationPending
      : notificationState === "sent"
        ? labels.notificationSent
        : labels.notificationFailed;

  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-lg font-medium text-strong">{labels.heading}</h2>
      <form onSubmit={lookUp} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={handleFieldId} className="text-sm text-muted">
            {labels.handleLabel}
          </label>
          <input
            id={handleFieldId}
            type="text"
            disabled={!hydrated}
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            className="rounded-md border border-border-strong bg-surface px-3 py-1.5 text-strong"
          />
        </div>
        <button
          type="submit"
          disabled={!hydrated || state.kind === "looking"}
          className="rounded-md border border-border-strong px-3 py-1.5 text-strong disabled:opacity-50"
        >
          {state.kind === "looking" ? labels.looking : labels.lookUp}
        </button>
      </form>

      {state.kind === "not-found" && <p role="alert" className="text-danger">{labels.notFound}</p>}
      {state.kind === "unavailable" && <p role="alert" className="text-danger">{labels.unavailable}</p>}

      {state.kind === "found" && (
        <div className="flex flex-col gap-4 border-t border-border-strong pt-4">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">{labels.confirmedLabel}</dt>
            <dd className="text-strong">
              {state.status.confirmed ? labels.confirmedLabel : labels.openLabel}
            </dd>
            <dt className="text-muted">{labels.draftRevisionLabel}</dt>
            <dd className="text-strong">{state.status.draftRevision}</dd>
            <dt className="text-muted">{labels.latestConfirmationVersionLabel}</dt>
            <dd className="text-strong">{state.status.latestConfirmationVersion}</dd>
            <dt className="text-muted">{labels.pricingLabel}</dt>
            <dd className="text-strong">
              {state.status.pricing.includedCount} ·{" "}
              {money(state.status.pricing.extraUnitPriceMinor, state.status.pricing.currency)}
            </dd>
            {state.status.currentSummary !== undefined && (
              <>
                <dt className="text-muted" />
                <dd className="text-strong">
                  {labels.currentSummaryLabel
                    .replace("{count}", String(state.status.currentSummary.selectedCount))
                    .replace(
                      "{total}",
                      money(state.status.currentSummary.extraTotalMinor, state.status.currentSummary.currency),
                    )}
                </dd>
              </>
            )}
            {state.status.confirmedAt !== undefined && (
              <>
                <dt className="text-muted" />
                <dd className="text-strong">
                  <time dateTime={state.status.confirmedAt}>
                    {labels.confirmedAtLabel.replace(
                      "{date}",
                      new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" }).format(
                        new Date(state.status.confirmedAt),
                      ),
                    )}
                  </time>
                </dd>
              </>
            )}
          </dl>

          <div className="flex flex-col gap-2 border-t border-border-strong pt-4">
            <h3 className="text-base font-medium text-strong">{labels.notificationHeading}</h3>
            {state.status.notification === undefined ? (
              <p className="text-muted">{labels.notificationNone}</p>
            ) : (
              <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted">{labels.notificationHeading}</dt>
                <dd className="text-strong">{notificationStateLabel(state.status.notification.state)}</dd>
                <dt className="text-muted">{labels.notificationAttemptsLabel}</dt>
                <dd className="text-strong">{state.status.notification.attempts}</dd>
                {state.status.notification.lastError !== undefined && (
                  <>
                    <dt className="text-muted">{labels.notificationLastErrorLabel}</dt>
                    <dd className="text-danger">{state.status.notification.lastError}</dd>
                  </>
                )}
                {state.status.notification.sentAt !== undefined && (
                  <>
                    <dt className="text-muted" />
                    <dd className="text-strong">
                      {labels.notificationSentAtLabel.replace(
                        "{date}",
                        new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" }).format(
                          new Date(state.status.notification.sentAt),
                        ),
                      )}
                    </dd>
                  </>
                )}
                {state.status.notification.nextAttemptAt !== undefined && (
                  <>
                    <dt className="text-muted" />
                    <dd className="text-strong">
                      {labels.notificationNextAttemptAtLabel.replace(
                        "{date}",
                        new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" }).format(
                          new Date(state.status.notification.nextAttemptAt),
                        ),
                      )}
                    </dd>
                  </>
                )}
              </dl>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={
                !state.status.confirmed ||
                action.kind === "reopening" ||
                action.kind === "resending"
              }
              onClick={() => act({ action: "reopen", expectedRevision: state.status.draftRevision })}
              className="rounded-md border border-border-strong px-3 py-1.5 text-strong disabled:opacity-50"
            >
              {action.kind === "reopening" ? labels.reopening : labels.reopenButton}
            </button>
            <button
              type="button"
              disabled={
                !state.status.confirmed ||
                action.kind === "reopening" ||
                action.kind === "resending"
              }
              onClick={() => act({ action: "resend" })}
              className="rounded-md border border-border-strong px-3 py-1.5 text-strong disabled:opacity-50"
            >
              {action.kind === "resending" ? labels.resending : labels.resendButton}
            </button>
            {action.kind === "reopen-conflict" && (
              <p role="alert" className="text-danger">{labels.reopenConflict}</p>
            )}
            {action.kind === "reopen-not-confirmed" && (
              <p role="alert" className="text-danger">{labels.reopenNotConfirmed}</p>
            )}
            {action.kind === "resent" && (
              <p role="status" className="text-body">{labels.resent}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
