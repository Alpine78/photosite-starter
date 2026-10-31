import { Button, Flex, Stack } from "@sanity/ui";
import { proofReopenCopy, type ReopenOutcome, type ReopenRequest } from "./proof-reopen";

export type ProofReopenDialogProps = {
  locale: string; request: ReopenRequest; outcome?: ReopenOutcome; pending: boolean; onConfirm(): void; onClose(): void;
};

/** Studio-themed reopen controls; the revision guard and patch live in the action. */
export function ProofReopenDialog({ locale, request, outcome, pending, onConfirm, onClose }: ProofReopenDialogProps) {
  const copy = proofReopenCopy(locale);
  return <Stack gap={3}>
    {outcome ? <p role="status">{copy[outcome]}</p>
      : <p>{copy.explain.replace("{next}", String(request.latestVersion + 1)).replace("{current}", String(request.latestVersion))}</p>}
    <Flex gap={2} wrap="wrap">
      {outcome ? <Button type="button" onClick={onClose} text={copy.close} /> : <>
        <Button type="button" tone="primary" disabled={pending} onClick={onConfirm} text={pending ? copy.working : copy.confirm} />
        <Button type="button" disabled={pending} onClick={onClose} text={copy.cancel} />
      </>}
    </Flex>
  </Stack>;
}
