import { useRef, useState } from "react";
import { useClient, useCurrentLocale, useSyncState, useValidationStatus, type DocumentActionComponent } from "sanity";
import { STUDIO_VALIDATION_API_VERSION } from "../sanity/schemas/validation";
import { studioSettings } from "./environment";
import { proofPublishCopy, proofPublishReadiness, proofRotateReadiness, PROOF_GALLERY_TYPE } from "./proof-publish";
import { ProofPublishDialog, type ProofDialogRequest } from "./proof-publish-dialog";

/**
 * The editor's own token, which the site route uses to act with the editor's
 * permissions. Present only when the Studio signs in with `loginMethod: "token"`.
 */
function useEditorToken(): () => string | undefined {
  const client = useClient({ apiVersion: STUDIO_VALIDATION_API_VERSION });
  return () => {
    const token = client.config().token;
    return typeof token === "string" && token !== "" ? token : undefined;
  };
}

/** Holds the dialog open while a request is in flight, so its answer is never lost. */
function useProofDialog() {
  const [request, setRequest] = useState<ProofDialogRequest>();
  const busy = useRef(false);
  return {
    request, open: setRequest,
    onBusy: (value: boolean) => { busy.current = value; },
    close: () => { if (!busy.current) setRequest(undefined); },
  };
}

/** Replaces native publish for proof galleries (ADR-0038 amendment 2026-10-22). */
export const PublishProofGalleryAction: DocumentActionComponent = (props) => {
  const { id: locale } = useCurrentLocale(), copy = proofPublishCopy(locale);
  const readToken = useEditorToken(), dialog = useProofDialog();
  const validation = useValidationStatus(props.draft?._id ?? props.id, props.type, true);
  const { isSyncing } = useSyncState(props.id, props.type);
  if (props.type !== PROOF_GALLERY_TYPE) return null;
  const site = studioSettings.clientGallerySite;
  const readiness = proofPublishReadiness(props, validation, isSyncing, site, studioSettings.proofGalleries);
  return {
    label: copy.publish,
    disabled: !dialog.request && readiness !== "ready",
    title: readiness === "ready" ? undefined : copy.readiness[readiness],
    onHandle: () => {
      if (readiness !== "ready" || !props.draft) return;
      dialog.open({
        operation: "publish", galleryId: props.id, expectedDraftRevision: String(props.draft._rev),
        handle: String(props.draft.handle), firstPublication: !props.published,
      });
    },
    dialog: dialog.request && site ? {
      type: "dialog", header: copy.publish, onClose: dialog.close,
      content: <ProofPublishDialog key={props.id} request={dialog.request} site={site} locale={locale}
        readToken={readToken} fetcher={(input, init) => fetch(input, init)} onBusy={dialog.onBusy} onClose={dialog.close} />,
    } : undefined,
  };
};

/** Issues a new selection key; the previous link stops working (ADR-0038 decision 3). */
export const RotateProofKeyAction: DocumentActionComponent = (props) => {
  const { id: locale } = useCurrentLocale(), copy = proofPublishCopy(locale);
  const readToken = useEditorToken(), dialog = useProofDialog();
  if (props.type !== PROOF_GALLERY_TYPE) return null;
  const site = studioSettings.clientGallerySite;
  const readiness = proofRotateReadiness(props, site, studioSettings.proofGalleries);
  return {
    label: copy.rotate,
    disabled: !dialog.request && readiness !== "ready",
    title: readiness === "ready" ? undefined : readiness === "nothing-to-publish" ? copy.readiness.rotate : copy.readiness[readiness],
    onHandle: () => {
      if (readiness !== "ready" || !props.published) return;
      dialog.open({ operation: "rotate-key", galleryId: props.id, handle: String(props.published.handle) });
    },
    dialog: dialog.request && site ? {
      type: "dialog", header: copy.rotate, onClose: dialog.close,
      content: <ProofPublishDialog key={props.id} request={dialog.request} site={site} locale={locale}
        readToken={readToken} fetcher={(input, init) => fetch(input, init)} onBusy={dialog.onBusy} onClose={dialog.close} />,
    } : undefined,
  };
};
