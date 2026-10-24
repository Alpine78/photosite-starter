import type { Ref } from "react";
import { proofDeleteCopy, proofDeletionCounts } from "./proof-delete";
import { deliveryPublishCopy } from "./client-gallery-publish-copy";
import type { DeliveryPublishReview, DeliveryPublishOutcome } from "./client-gallery-publish";

export type DeliveryPublishDialogProps = {
  locale: string; prefix: string; headingRef?: Ref<HTMLHeadingElement>; mode?: "ordinary" | "replacement"; proofId: string; typed: string;
  review?: DeliveryPublishReview; outcome?: DeliveryPublishOutcome | "not-observed";
  pending: boolean; ready: boolean; proofsEnabled: boolean;
  onMode(mode: "ordinary" | "replacement"): void; onProofId(id: string): void; onTyped(id: string): void;
  onReview(): void; onSubmit(): void; onCheck(): void; onReset(): void; onClose(): void;
};

/** Native labelled controls; all IO and operation state live in the action. */
export function DeliveryPublishDialog({ locale, prefix, headingRef, mode, proofId, typed, review, outcome, pending, ready, proofsEnabled,
  onMode, onProofId, onTyped, onReview, onSubmit, onCheck, onReset, onClose,
}: DeliveryPublishDialogProps) {
  const copy = deliveryPublishCopy(locale), deletionCopy = proofDeleteCopy(locale);
  const status = outcome === "not-observed" ? copy.notObserved : outcome ? copy[outcome] : !ready ? copy.unavailable : "";
  function content() {
    if (outcome) return <>
      {outcome === "uncertain" ? <button type="button" disabled={pending} onClick={() => onCheck()}>{pending ? copy.working : copy.check}</button> : null}{" "}
      {outcome !== "published" && outcome !== "uncertain" ? <button type="button" disabled={pending} onClick={onReset}>{copy.again}</button> : null}{" "}
      <button type="button" disabled={pending} onClick={onClose}>{copy.close}</button>
    </>;
    if (review && "ready" in review) {
      const plan = review.ready, counts = plan.proof ? proofDeletionCounts(plan.proof) : undefined;
      return <>
        <p>{plan.proof ? copy.warning : copy.ordinaryNote}</p>
        <p>{copy.target}: <code>{plan.request.id}</code></p>
        <p>{copy.deadline}: {typeof plan.target.expiryInstant === "string" ? plan.target.expiryInstant : copy.indefinite}</p>
        {counts ? <>
          <p>{copy.proofId}: <code>{plan.proof!.galleryId}</code></p>
          <p>{copy.selection}: {copy.states[plan.selectionState ?? "unknown"] ?? copy.states.unknown}</p>
          <ul>{(Object.keys(counts) as (keyof typeof counts)[]).map((key) => <li key={key}>{deletionCopy.counts[key]}: {counts[key]}</li>)}</ul>
          <ul>{deletionCopy.limits.map((line) => <li key={line}>{line}</li>)}</ul>
          <p><label htmlFor={`${prefix}-confirm`}>{copy.confirm.replace("{id}", plan.proof!.galleryId)}</label>{" "}
            <input id={`${prefix}-confirm`} value={typed} disabled={pending} autoComplete="off" spellCheck={false} onChange={(event) => onTyped(event.target.value)} /></p>
        </> : null}
        <button type="button" disabled={pending || !!plan.proof && typed.trim() !== plan.proof.galleryId} onClick={() => onSubmit()}>{pending ? copy.working : plan.proof ? copy.replacing : copy.publish}</button>{" "}
        <button type="button" disabled={pending} onClick={onReset}>{copy.again}</button>{" "}
        <button type="button" disabled={pending} onClick={onClose}>{copy.cancel}</button>
      </>;
    }
    return <>
      {review ? <p role="alert">{copy.errors[review.reason]}</p> : null}
      <fieldset disabled={pending}>
        <legend>{copy.choose}</legend>
        <p><label><input type="radio" name={`${prefix}-mode`} checked={mode === "ordinary"} onChange={() => onMode("ordinary")} /> {copy.ordinary}</label></p>
        {proofsEnabled ? <>
          <p><label><input type="radio" name={`${prefix}-mode`} checked={mode === "replacement"} onChange={() => onMode("replacement")} /> {copy.replacement}</label></p>
          {mode === "replacement" ? <p><label htmlFor={`${prefix}-proof`}>{copy.proofId}</label>{" "}
            <input id={`${prefix}-proof`} value={proofId} autoComplete="off" spellCheck={false} onChange={(event) => onProofId(event.target.value)} /></p> : null}
        </> : null}
      </fieldset>
      <button type="button" disabled={pending || !ready || !mode || mode === "replacement" && !proofId.trim()} onClick={() => onReview()}>{pending ? copy.reviewing : copy.review}</button>{" "}
      <button type="button" disabled={pending} onClick={onClose}>{copy.cancel}</button>
    </>;
  }
  return <section>
    <h2 ref={headingRef} tabIndex={-1}>{review && "ready" in review ? copy.review : copy.action}</h2>
    {/* Mounted empty before asynchronous outcomes arrive, so updates are announced. */}
    <p role="status" aria-live="polite" aria-atomic="true">{status}</p>
    {content()}
  </section>;
}
