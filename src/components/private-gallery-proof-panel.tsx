"use client";

import { useId, useState, useSyncExternalStore } from "react";

import { formatPrivateGalleryProofMoney } from "@/lib/private-gallery-proof-money";
import { PRIVATE_GALLERY_DEFAULT_MAX_PAGE_SIZE } from "@/lib/private-gallery-limits";
import { PrivateGalleryPreviewMintQueue } from "@/lib/private-gallery-preview-mint-queue";
import { PrivateGalleryProofImage } from "@/components/private-gallery-proof-image";

const subscribeToNothing = () => () => {};

/**
 * The wire shape the proof API answers with (`GET`/`POST`/`PUT
 * <prefix>/<handle>/proof`). Declared locally rather than imported from
 * `private-gallery-proof-view.ts`, which is `server-only` — a client bundle
 * must never pull that module in, even as a type-only import a bundler could
 * still resolve. Every field here is what `projectPrivateGalleryProofView`
 * already stripped down to a browser-safe payload.
 */
export type PrivateGalleryProofPanelItem = {
  readonly itemId: string;
  readonly width: number;
  readonly height: number;
  readonly alt?: string;
  readonly reference: string;
  readonly filename: string;
  readonly selected: boolean;
};

export type PrivateGalleryProofPanelSummary = {
  readonly includedCount: number;
  readonly extraUnitPriceMinor: number;
  readonly currency: string;
  readonly selectedCount: number;
  readonly extraCount: number;
  readonly extraTotalMinor: number;
};

export type PrivateGalleryProofPanelView = {
  readonly revision: number;
  readonly confirmed: boolean;
  readonly confirmationVersion?: number;
  readonly confirmedAt?: string;
  readonly items: readonly PrivateGalleryProofPanelItem[];
  readonly selectedImages: readonly { reference: string; filename: string }[];
  readonly summary: PrivateGalleryProofPanelSummary;
  readonly pageIndex: number;
  readonly totalCount: number;
  readonly hasNextPage: boolean;
};

export type PrivateGalleryProofPanelLabels = {
  readonly heading: string;
  readonly includedLabel: string;
  readonly extraPriceLabel: string;
  readonly selectedCount: string;
  readonly pageStatus: string;
  readonly previousPage: string;
  readonly nextPage: string;
  readonly saving: string;
  readonly saveFailed: string;
  readonly reviewHeading: string;
  readonly confirmSelection: string;
  readonly confirming: string;
  readonly confirmDescription: string;
  readonly confirmedHeading: string;
  readonly confirmedAt: string;
  readonly confirmedNotice: string;
  readonly conflictNotice: string;
  readonly refusedNotice: string;
  readonly reload: string;
  readonly noProofs: string;
  readonly javascriptRequired: string;
  readonly selectedImagesHeading: string;
  readonly extraCountLabel: string;
  readonly extraTotalLabel: string;
  readonly noneSelected: string;
  readonly loadingImage: string;
  readonly unavailableImage: string;
  readonly retryImage: string;
};

type Status =
  | { readonly kind: "idle" }
  | { readonly kind: "saving" }
  | { readonly kind: "confirming" }
  | { readonly kind: "conflict" }
  /** A save (edit or confirm) was refused; the view shown is still current. */
  | { readonly kind: "save-failed" }
  /** A read failed; the view shown may now be stale. Offers a reload. */
  | { readonly kind: "unavailable" };

async function fetchView(proofPath: string, pageIndex: number): Promise<PrivateGalleryProofPanelView | undefined> {
  try {
    const response = await fetch(`${proofPath}?page=${pageIndex}`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { ok: boolean; view?: PrivateGalleryProofPanelView };
    return body.ok ? body.view : undefined;
  } catch {
    return undefined;
  }
}

type MutationOutcome =
  | { readonly ok: true; readonly revision: number }
  | { readonly ok: false; readonly reason: "conflict" | "refused" };

async function postMutation(
  proofPath: string,
  body: Record<string, unknown>,
): Promise<MutationOutcome> {
  let response: Response;
  try {
    response = await fetch(proofPath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, reason: "refused" };
  }
  if (response.status === 409) return { ok: false, reason: "conflict" };
  if (!response.ok) return { ok: false, reason: "refused" };
  const parsed = (await response.json().catch(() => undefined)) as
    | { ok?: boolean; revision?: number }
    | undefined;
  if (parsed?.ok !== true || typeof parsed.revision !== "number") {
    return { ok: false, reason: "refused" };
  }
  return { ok: true, revision: parsed.revision };
}

/**
 * The customer proof selection / review / confirm flow (AB#130).
 *
 * The server renders the first page so the current selection and price are
 * visible immediately; every interaction past that point — a page turn, a
 * checkbox toggle, confirmation — is a JSON `fetch`, so it needs JavaScript
 * (stated in words, the same trade the administrator sign-in form makes).
 *
 * A checkbox toggle saves immediately as one whole-selection `edit` rather
 * than accumulating local-only state: the store's `expectedRevision` CAS is
 * what keeps two tabs or a slow network from silently overwriting each
 * other, and there is nothing here to explain "unsaved changes" if it did.
 * Checkboxes are disabled while a save is in flight so two toggles cannot
 * race the same revision.
 *
 * Once `view.confirmed` is true, the draft is locked: no checkbox or confirm
 * control is rendered, only the frozen selection the confirmation snapshot
 * holds — a later change to the gallery's live placements cannot rewrite
 * what the customer already confirmed.
 */
export function PrivateGalleryProofPanel({
  proofPath,
  assetPath,
  initialView,
  locale,
  labels,
}: {
  readonly proofPath: string;
  readonly assetPath: string;
  readonly initialView: PrivateGalleryProofPanelView;
  readonly locale: string;
  readonly labels: PrivateGalleryProofPanelLabels;
}) {
  const hydrated = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
  const [view, setView] = useState(initialView);
  const [mintQueue] = useState(() => new PrivateGalleryPreviewMintQueue());
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const legendId = useId();

  const money = (amountMinor: number) =>
    formatPrivateGalleryProofMoney(amountMinor, view.summary.currency, locale);

  async function refresh(pageIndex: number) {
    const next = await fetchView(proofPath, pageIndex);
    if (next === undefined) {
      setStatus({ kind: "unavailable" });
      return;
    }
    setView(next);
  }

  async function toggle(reference: string, checked: boolean) {
    if (status.kind === "saving" || status.kind === "confirming" || status.kind === "unavailable" || view.confirmed) return;
    const references = checked
      ? [...view.selectedImages.map((image) => image.reference), reference]
      : view.selectedImages.map((image) => image.reference).filter((ref) => ref !== reference);
    setStatus({ kind: "saving" });
    const outcome = await postMutation(proofPath, {
      action: "edit",
      expectedRevision: view.revision,
      selectedReferences: references,
    });
    if (!outcome.ok) {
      setStatus({ kind: outcome.reason === "conflict" ? "conflict" : "save-failed" });
      if (outcome.reason === "conflict") await refresh(view.pageIndex);
      return;
    }
    setStatus({ kind: "idle" });
    await refresh(view.pageIndex);
  }

  async function confirm() {
    if (status.kind === "saving" || status.kind === "confirming" || status.kind === "unavailable") return;
    setStatus({ kind: "confirming" });
    const outcome = await postMutation(proofPath, {
      action: "confirm",
      expectedRevision: view.revision,
    });
    if (!outcome.ok) {
      setStatus({ kind: outcome.reason === "conflict" ? "conflict" : "save-failed" });
      if (outcome.reason === "conflict") await refresh(view.pageIndex);
      return;
    }
    setStatus({ kind: "idle" });
    await refresh(view.pageIndex);
  }

  const rangeStart =
    view.totalCount === 0 ? 0 : view.pageIndex * PRIVATE_GALLERY_DEFAULT_MAX_PAGE_SIZE + 1;

  return (
    <section className="flex flex-col gap-6" aria-labelledby={legendId}>
      <noscript>
        <p className="text-danger">{labels.javascriptRequired}</p>
      </noscript>

      {view.confirmed ? (
        <ConfirmedReview labels={labels} view={view} locale={locale} money={money} legendId={legendId} />
      ) : (
        <>
          <h2 id={legendId} className="text-xl font-semibold text-strong">
            {labels.heading}
          </h2>
          <p className="text-muted">
            {labels.includedLabel}: {view.summary.includedCount} · {labels.extraPriceLabel}:{" "}
            {money(view.summary.extraUnitPriceMinor)}
          </p>

          <p role="status" aria-live="polite" className="text-body">
            {labels.selectedCount.replace("{count}", String(view.summary.selectedCount))}
            {view.summary.extraCount > 0 && (
              <> — {labels.extraTotalLabel}: {money(view.summary.extraTotalMinor)}</>
            )}
            {status.kind === "saving" && <> · {labels.saving}</>}
            {status.kind === "save-failed" && (
              <span className="text-danger"> · {labels.saveFailed}</span>
            )}
            {status.kind === "conflict" && (
              <span className="text-danger"> · {labels.conflictNotice}</span>
            )}
          </p>

          {status.kind === "unavailable" && (
            <p role="alert" className="flex items-center gap-3 text-danger">
              {labels.refusedNotice}
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-md border border-border-strong px-3 py-1 text-strong"
              >
                {labels.reload}
              </button>
            </p>
          )}

          {view.items.length === 0 ? (
            <p className="text-muted">{labels.noProofs}</p>
          ) : (
            <ul className="grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
              {view.items.map((item) => (
                <li key={item.itemId} className="m-0">
                  <div className="flex flex-col gap-2">
                    <PrivateGalleryProofImage
                      item={item}
                      assetPath={assetPath}
                      queue={mintQueue}
                      labels={labels}
                    />
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-strong">
                      <input
                        type="checkbox"
                        disabled={!hydrated || status.kind === "saving" || status.kind === "confirming" || status.kind === "unavailable"}
                        checked={item.selected}
                        onChange={(event) => toggle(item.reference, event.target.checked)}
                      />
                      {item.reference} — {item.filename}
                    </label>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {view.totalCount > view.items.length && (
            <nav className="flex items-center justify-between gap-4">
              <button
                type="button"
                disabled={view.pageIndex === 0 || status.kind === "saving" || status.kind === "confirming" || status.kind === "unavailable"}
                onClick={() => refresh(view.pageIndex - 1)}
                className="rounded-md border border-border-strong px-3 py-1.5 text-strong disabled:opacity-50"
              >
                {labels.previousPage}
              </button>
              <span className="text-muted text-sm">
                {labels.pageStatus
                  .replace("{from}", String(rangeStart))
                  .replace("{to}", String(rangeStart + view.items.length - 1))
                  .replace("{total}", String(view.totalCount))}
              </span>
              <button
                type="button"
                disabled={!view.hasNextPage || status.kind === "saving" || status.kind === "confirming" || status.kind === "unavailable"}
                onClick={() => refresh(view.pageIndex + 1)}
                className="rounded-md border border-border-strong px-3 py-1.5 text-strong disabled:opacity-50"
              >
                {labels.nextPage}
              </button>
            </nav>
          )}

          <div className="flex flex-col gap-2 border-t border-border-strong pt-6">
            <h3 className="text-lg font-medium text-strong">{labels.reviewHeading}</h3>
            <p className="text-muted">{labels.confirmDescription}</p>
            <ProofReviewSummary labels={labels} view={view} money={money} />
            <button
              type="button"
              disabled={
                !hydrated ||
                status.kind === "saving" ||
                status.kind === "confirming" ||
                status.kind === "unavailable"
              }
              onClick={confirm}
              className="w-fit rounded-md border border-border-strong px-4 py-2 text-strong disabled:opacity-50"
            >
              {status.kind === "confirming" ? labels.confirming : labels.confirmSelection}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function ConfirmedReview({
  labels,
  view,
  locale,
  money,
  legendId,
}: {
  labels: PrivateGalleryProofPanelLabels;
  view: PrivateGalleryProofPanelView;
  locale: string;
  money: (amountMinor: number) => string;
  legendId: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h2 id={legendId} className="text-xl font-semibold text-strong">
        {labels.confirmedHeading}
      </h2>
      {view.confirmedAt !== undefined && (
        <p className="text-muted">
          <time dateTime={view.confirmedAt}>
            {labels.confirmedAt.replace(
              "{date}",
              new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" }).format(
                new Date(view.confirmedAt),
              ),
            )}
          </time>
        </p>
      )}
      <p role="status" className="text-body">{labels.confirmedNotice}</p>
      <ProofReviewSummary labels={labels} view={view} money={money} />
    </div>
  );
}

function ProofReviewSummary({
  labels,
  view,
  money,
}: {
  labels: PrivateGalleryProofPanelLabels;
  view: PrivateGalleryProofPanelView;
  money: (amountMinor: number) => string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body">
        <dt>{labels.selectedImagesHeading}</dt>
        <dd>{labels.selectedCount.replace("{count}", String(view.summary.selectedCount))}</dd>
        <dt>{labels.includedLabel}</dt>
        <dd>{view.summary.includedCount}</dd>
        <dt>{labels.extraCountLabel}</dt>
        <dd>{view.summary.extraCount}</dd>
        <dt>{labels.extraPriceLabel}</dt>
        <dd>{money(view.summary.extraUnitPriceMinor)}</dd>
        <dt>{labels.extraTotalLabel}</dt>
        <dd>{money(view.summary.extraTotalMinor)}</dd>
      </dl>
      <div>
        <h4 className="font-medium text-strong">{labels.selectedImagesHeading}</h4>
        {view.selectedImages.length === 0 ? (
          <p className="text-muted">{labels.noneSelected}</p>
        ) : (
          <ul className="list-none p-0">
            {view.selectedImages.map((image) => (
              <li key={image.reference} className="text-body">
                {image.reference} — {image.filename}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
