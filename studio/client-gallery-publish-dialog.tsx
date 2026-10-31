import { Button, Checkbox, Flex, Radio, Stack, TextInput } from "@sanity/ui";
import type { Ref } from "react";
import { proofDeleteCopy, proofDeletionCounts } from "./proof-delete";
import { deliveryCleanupCopy, deliveryPublishCopy } from "./client-gallery-publish-copy";
import type { CleanupControl } from "../src/lib/client-gallery-cleanup-contract";
import type { DeliveryPublishReview, DeliveryPublishOutcome } from "./client-gallery-publish";

export type DeliveryPublishDialogProps = {
  locale: string; prefix: string; headingRef?: Ref<HTMLHeadingElement>; mode?: "ordinary" | "replacement"; proofId: string; typed: string;
  review?: DeliveryPublishReview; outcome?: DeliveryPublishOutcome | "not-observed";
  pending: boolean; ready: boolean; proofsEnabled: boolean;
  cleanup?: Readonly<{ enroll: boolean; eligible: boolean; control?: CleanupControl; unreadable: boolean; loading: boolean }>;
  onCleanup?(enroll: boolean): void;
  onMode(mode: "ordinary" | "replacement"): void; onProofId(id: string): void; onTyped(id: string): void;
  onReview(): void; onSubmit(): void; onCheck(): void; onReset(): void; onClose(): void;
};

/** Studio-themed native labelled controls; all IO and operation state live in the action. */
export function DeliveryPublishDialog({ locale, prefix, headingRef, mode, proofId, typed, review, outcome, pending, ready, proofsEnabled, cleanup,
  onMode, onProofId, onTyped, onReview, onSubmit, onCheck, onReset, onClose, onCleanup,
}: DeliveryPublishDialogProps) {
  const copy = deliveryPublishCopy(locale), deletionCopy = proofDeleteCopy(locale), cleanupCopy = deliveryCleanupCopy(locale);
  const status = outcome === "not-observed" ? copy.notObserved : outcome ? copy[outcome] : !ready ? copy.unavailable : "";
  function receipt(control: CleanupControl | undefined) {
    return control?.receipt ? <>
      <p>{cleanupCopy.deletedZips}: {control.receipt.deletedAssets.filter((asset) => asset.type === "sanity.fileAsset").length}</p>
      <p>{cleanupCopy.sharedZips}: {control.receipt.sharedAssets.filter((asset) => asset.type === "sanity.fileAsset").length}</p>
    </> : null;
  }
  function content() {
    if (outcome) return <>
      {outcome === "uncertain" ? <Button type="button" disabled={pending} onClick={() => onCheck()} text={pending ? copy.working : copy.check} /> : null}{" "}
      {outcome !== "published" && outcome !== "uncertain" ? <Button type="button" disabled={pending} onClick={onReset} text={copy.again} /> : null}{" "}
      <Button type="button" disabled={pending} onClick={onClose} text={copy.close} />
    </>;
    if (review && "ready" in review) {
      const plan = review.ready, counts = plan.proof ? proofDeletionCounts(plan.proof) : undefined;
      return <>
        <p>{plan.proof ? copy.warning : copy.ordinaryNote}</p>
        <p>{copy.target}: <code>{plan.request.id}</code></p>
        <p>{copy.deadline}: {typeof plan.target.expiryInstant === "string" ? plan.target.expiryInstant : copy.indefinite}</p>
        {plan.cleanup ? <section aria-label={cleanupCopy.title}>
          <p>{cleanupCopy.status}: {cleanupCopy.states[plan.cleanup.next?.state ?? "none"]}</p>
          {plan.cleanup.previous?.lastResult ? <p>{cleanupCopy.blocked}: {cleanupCopy.reasons[plan.cleanup.previous.lastResult.reason]}</p> : null}
          <p>{cleanupCopy.images}: {plan.cleanup.enroll ? plan.cleanup.policy?.assetIds.filter((id) => id.startsWith("image-")).length : 0}</p>
          <p>{cleanupCopy.zips}: {plan.cleanup.enroll ? plan.cleanup.policy?.assetIds.filter((id) => id.startsWith("file-")).length : 0}</p>
          {receipt(plan.cleanup.previous)}
          {plan.cleanup.policyChanged ? <p>{cleanupCopy.changed}</p> : null}
          {plan.cleanup.enroll && plan.cleanup.expired ? <p role="alert">{cleanupCopy.expired}</p> : null}
          {!plan.cleanup.enroll && plan.cleanup.previous && ["enrolled", "pending"].includes(plan.cleanup.previous.state) ? <p>{cleanupCopy.withdrawal}</p> : null}
          <p>{cleanupCopy.note}</p><p>{cleanupCopy.limits}</p>
        </section> : null}
        {counts ? <>
          <p>{copy.proofId}: <code>{plan.proof!.galleryId}</code></p>
          <p>{copy.selection}: {copy.states[plan.selectionState ?? "unknown"] ?? copy.states.unknown}</p>
          <ul>{(Object.keys(counts) as (keyof typeof counts)[]).map((key) => <li key={key}>{deletionCopy.counts[key]}: {counts[key]}</li>)}</ul>
          <ul>{deletionCopy.limits.map((line) => <li key={line}>{line}</li>)}</ul>
          <Stack gap={2}><label htmlFor={`${prefix}-confirm`}>{copy.confirm.replace("{id}", plan.proof!.galleryId)}</label>{" "}
            <TextInput id={`${prefix}-confirm`} value={typed} disabled={pending} autoComplete="off" spellCheck={false} onChange={(event) => onTyped(event.currentTarget.value)} /></Stack>
        </> : null}
        <Button type="button" tone={plan.proof ? "critical" : "primary"} disabled={pending || !!plan.proof && typed.trim() !== plan.proof.galleryId} onClick={() => onSubmit()} text={pending ? copy.working : plan.proof ? copy.replacing : copy.publish} />{" "}
        <Button type="button" disabled={pending} onClick={onReset} text={copy.again} />{" "}
        <Button type="button" disabled={pending} onClick={onClose} text={copy.cancel} />
      </>;
    }
    return <>
      {review ? <p role="alert">{copy.errors[review.reason]}</p> : null}
      <fieldset disabled={pending}>
        <legend>{copy.choose}</legend>
        <Flex align="center" gap={2} marginY={3}><Radio id={`${prefix}-ordinary`} name={`${prefix}-mode`} checked={mode === "ordinary"} onChange={() => onMode("ordinary")} /><label htmlFor={`${prefix}-ordinary`}>{copy.ordinary}</label></Flex>
        {proofsEnabled ? <>
          <Flex align="center" gap={2} marginY={3}><Radio id={`${prefix}-replacement`} name={`${prefix}-mode`} checked={mode === "replacement"} onChange={() => onMode("replacement")} /><label htmlFor={`${prefix}-replacement`}>{copy.replacement}</label></Flex>
          {mode === "replacement" ? <Stack gap={2}><label htmlFor={`${prefix}-proof`}>{copy.proofId}</label>{" "}
            <TextInput id={`${prefix}-proof`} value={proofId} autoComplete="off" spellCheck={false} onChange={(event) => onProofId(event.currentTarget.value)} /></Stack> : null}
        </> : null}
      </fieldset>
      {cleanup ? <fieldset disabled={pending || cleanup.unreadable || cleanup.loading}>
        <legend>{cleanupCopy.title}</legend>
        <p role="status" aria-live="polite" aria-atomic="true">{cleanup.loading ? cleanupCopy.loading : cleanup.unreadable ? "" : `${cleanupCopy.status}: ${cleanupCopy.states[cleanup.control?.state ?? "none"]}`}</p>
        {cleanup.control?.lastResult ? <p>{cleanupCopy.blocked}: {cleanupCopy.reasons[cleanup.control.lastResult.reason]}</p> : null}
        {receipt(cleanup.control)}
        {cleanup.unreadable ? <p role="alert">{cleanupCopy.unreadable}</p> : null}
        <Flex align="flex-start" gap={2} marginY={3}><Checkbox id={`${prefix}-cleanup`} checked={cleanup.enroll} disabled={!cleanup.eligible} onChange={(event) => onCleanup?.(event.currentTarget.checked)} /><label htmlFor={`${prefix}-cleanup`}>{cleanupCopy.choice}</label></Flex>
        {!cleanup.eligible ? <p>{cleanupCopy.ineligible}</p> : null}
        <p>{cleanupCopy.note}</p><p>{cleanupCopy.limits}</p>
      </fieldset> : null}
      <Button type="button" disabled={pending || !ready || cleanup?.unreadable || cleanup?.loading || !mode || mode === "replacement" && !proofId.trim()} onClick={() => onReview()} text={pending ? copy.reviewing : copy.review} />{" "}
      <Button type="button" disabled={pending} onClick={onClose} text={copy.cancel} />
    </>;
  }
  return <Stack as="section" gap={3}>
    <h2 ref={headingRef} tabIndex={-1}>{review && "ready" in review ? copy.review : copy.action}</h2>
    {/* Mounted empty before asynchronous outcomes arrive, so updates are announced. */}
    <p role="status" aria-live="polite" aria-atomic="true">{status}</p>
    {content()}
  </Stack>;
}
