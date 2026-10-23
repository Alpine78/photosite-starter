import { useRef, useState } from "react";
import { useClient, useCurrentLocale, type DocumentActionComponent } from "sanity";
import { STUDIO_VALIDATION_API_VERSION } from "../sanity/schemas/validation";
import { studioSettings } from "./environment";
import { createReopenGuard, proofReopenCopy, reopenReadiness, type ReopenOutcome, type ReopenRequest } from "./proof-reopen";

/**
 * Reopens a confirmed proof selection with the editor's own session (ADR-0038
 * decision 5). The revision is captured when the dialog opens and the patch is
 * guarded by it, so a newer confirmation the editor never saw is never reopened.
 */
export const ReopenProofSelectionAction: DocumentActionComponent = (props) => {
  const { id: locale } = useCurrentLocale(), copy = proofReopenCopy(locale);
  const client = useClient({ apiVersion: STUDIO_VALIDATION_API_VERSION });
  const [request, setRequest] = useState<ReopenRequest>();
  const [outcome, setOutcome] = useState<ReopenOutcome>();
  const [pending, setPending] = useState(false);
  const guard = useRef(createReopenGuard()), inFlight = useRef(false);
  if (props.type !== "clientProofSelection") return null;
  const readiness = reopenReadiness(props, studioSettings.proofGalleries);
  const close = () => { if (!inFlight.current) { setRequest(undefined); setOutcome(undefined); } };
  async function confirm(captured: ReopenRequest) {
    inFlight.current = true; setPending(true);
    const result = await guard.current(captured, (id, revision) => client.patch(id).ifRevisionId(revision).set({ state: "open" }).commit().then(() => undefined));
    if (result === "busy") return;
    inFlight.current = false; setPending(false); setOutcome(result);
  }
  return {
    label: copy.action,
    disabled: !request && !("ready" in readiness),
    title: "ready" in readiness ? undefined : copy[readiness.reason],
    onHandle: () => { if ("ready" in readiness) { setOutcome(undefined); setRequest(readiness.ready); } },
    dialog: request ? {
      type: "dialog", header: copy.action, onClose: close,
      content: <div>
        {outcome ? <p role="status">{copy[outcome]}</p>
          : <p>{copy.explain.replace("{next}", String(request.latestVersion + 1)).replace("{current}", String(request.latestVersion))}</p>}
        {outcome ? <button type="button" onClick={close}>{copy.close}</button> : <>
          <button type="button" disabled={pending} onClick={() => void confirm(request)}>{pending ? copy.working : copy.confirm}</button>{" "}
          <button type="button" disabled={pending} onClick={close}>{copy.cancel}</button>
        </>}
      </div>,
    } : undefined,
  };
};
