import { Button, Flex, Stack, TextInput } from "@sanity/ui";
import { proofDeleteCopy, proofDeletionCounts, type ProofDeletionOutcome, type ProofDeletionReadiness } from "./proof-delete";

export type ProofDeleteDialogProps = {
  locale: string; galleryId: string; inputId: string; readiness: ProofDeletionReadiness | "loading";
  typed: string; outcome?: ProofDeletionOutcome; pending: boolean;
  onTyped(value: string): void; onRemove(): void; onReload(): void; onClose(): void;
};

/** Studio-themed deletion controls; reads, the guard and the transaction live in the action. */
export function ProofDeleteDialog({ locale, galleryId, inputId, readiness, typed, outcome, pending, onTyped, onRemove, onReload, onClose }: ProofDeleteDialogProps) {
  const copy = proofDeleteCopy(locale);
  const buttons = (reload: boolean) => <Flex gap={2} wrap="wrap">
    {reload ? <Button type="button" onClick={onReload} text={copy.reload} /> : null}
    <Button type="button" onClick={onClose} text={copy.close} />
  </Flex>;
  if (readiness === "loading") return <p>{copy.loading}</p>;
  if (outcome) return <Stack gap={3}><p role="status">{copy[outcome]}</p>{buttons(outcome !== "deleted")}</Stack>;
  if (!("ready" in readiness)) {
    return <Stack gap={3}><p role="alert">{copy[readiness.reason].replace("{ids}", (readiness.ids ?? []).join(", "))}</p>{buttons(true)}</Stack>;
  }
  const counts = proofDeletionCounts(readiness.ready);
  return <Stack gap={3}>
    <p>{copy.explain}</p>
    <ul>{(Object.keys(counts) as (keyof typeof counts)[]).map((key) => <li key={key}>{copy.counts[key]}: {counts[key]}</li>)}</ul>
    <ul>{copy.limits.map((line) => <li key={line}>{line}</li>)}</ul>
    <Stack gap={2}>
      <label htmlFor={inputId}>{copy.typeId.replace("{id}", galleryId)}</label>
      <TextInput id={inputId} value={typed} disabled={pending} autoComplete="off" spellCheck={false} onChange={(event) => onTyped(event.currentTarget.value)} />
    </Stack>
    <Flex gap={2} wrap="wrap">
      <Button type="button" tone="critical" disabled={pending || typed.trim() !== galleryId} onClick={onRemove} text={pending ? copy.working : copy.confirm} />
      <Button type="button" disabled={pending} onClick={onClose} text={copy.cancel} />
    </Flex>
  </Stack>;
}
