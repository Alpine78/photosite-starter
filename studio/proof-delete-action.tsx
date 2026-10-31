import { useId, useRef, useState } from "react";
import { useClient, useCurrentLocale, type DocumentActionComponent, type Mutation } from "sanity";
import { STUDIO_VALIDATION_API_VERSION } from "../sanity/schemas/validation";
import { studioSettings } from "./environment";
import {
  collectProofDeletion, createProofDeletionGuard, planProofDeletion, proofDeleteCopy, PROOF_DELETE_SWEEP_QUERY,
  type ProofDeletionOutcome, type ProofDeletionReader, type ProofDeletionReadiness,
} from "./proof-delete";
import { ProofDeleteDialog } from "./proof-delete-dialog";

const GALLERY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/u;

/**
 * Deletes a proof gallery and its private records with the editor's own
 * session (ADR-0038 decision 7). The inventory is read fresh when the dialog
 * opens, the typed confirmation is cleared whenever it is re-read, and the
 * one transaction is never retried.
 */
export const DeleteProofGalleryAction: DocumentActionComponent = (props) => {
  const { id: locale } = useCurrentLocale(), copy = proofDeleteCopy(locale), inputId = useId();
  const client = useClient({ apiVersion: STUDIO_VALIDATION_API_VERSION });
  const [open, setOpen] = useState(false);
  const [readiness, setReadiness] = useState<ProofDeletionReadiness | "loading">("loading");
  const [typed, setTyped] = useState("");
  const [outcome, setOutcome] = useState<ProofDeletionOutcome>();
  const [pending, setPending] = useState(false);
  const guard = useRef(createProofDeletionGuard()), inFlight = useRef(false);
  if (props.type !== "clientProofGallery") return null;
  const available = studioSettings.proofGalleries && GALLERY_ID.test(props.id) && props.version == null && (props.published != null || props.draft != null);
  const raw = client.withConfig({ perspective: "raw", useCdn: false });
  const reader: ProofDeletionReader = {
    docs: (ids, allVersions) => raw.request({
      url: raw.getDataUrl("doc", ids.join(",")), json: true, tag: "proof-delete", ...(allVersions ? { query: { includeAllVersions: "true" } } : {}),
    }),
    sweep: (galleryId, ids, assetIds) => raw.fetch(PROOF_DELETE_SWEEP_QUERY, { galleryId, ids, assetIds }, { tag: "proof-delete" }),
  };

  async function load() {
    setReadiness("loading"); setOutcome(undefined); setTyped("");
    setReadiness(await collectProofDeletion(props.id, reader, Date.now()));
  }
  async function remove(current: ProofDeletionReadiness) {
    if (!("ready" in current) || inFlight.current) return;
    inFlight.current = true; setPending(true);
    const mutations = planProofDeletion(current.ready, new Date().toISOString());
    const result = await guard.current(mutations, (list) =>
      raw.withConfig({ maxRetries: 0 }).mutate(list as Mutation[], { visibility: "sync", tag: "proof-delete" }).then(() => undefined));
    if (result === "busy") return;
    inFlight.current = false; setPending(false); setOutcome(result);
  }
  const close = () => {
    if (inFlight.current) return;
    setOpen(false);
    if (outcome === "deleted") props.onComplete();
  };
  return {
    label: copy.action,
    tone: "critical",
    disabled: !open && !available,
    title: available ? undefined : studioSettings.proofGalleries ? copy.unavailable : copy.off,
    onHandle: () => { if (available) { setOpen(true); void load(); } },
    dialog: open ? { type: "dialog", header: copy.action, onClose: close, content: <ProofDeleteDialog locale={locale} galleryId={props.id} inputId={inputId} readiness={readiness} typed={typed} outcome={outcome} pending={pending}
      onTyped={setTyped} onRemove={() => { if (readiness !== "loading") void remove(readiness); }} onReload={() => void load()} onClose={close} /> } : undefined,
  };
};
