import { useEffect, useId, useRef, useState } from "react";
import { useClient, useCurrentLocale, useSyncState, useValidationStatus, type DocumentActionComponent, type Mutation } from "sanity";
import { STUDIO_VALIDATION_API_VERSION } from "../sanity/schemas/validation";
import { studioSettings } from "./environment";
import { cleanupPolicyFromGallery, type CleanupControl } from "../src/lib/client-gallery-cleanup-contract";
import { PROOF_DELETE_SWEEP_QUERY, readProofDocuments } from "./proof-delete";
import { DeliveryPublishDialog } from "./client-gallery-publish-dialog";
import { deliveryPublishCopy } from "./client-gallery-publish-copy";
import {
  deliveryPublishReady, publishDelivery, reconcileDeliveryPublication, reviewDeliveryPublication, readDeliveryCleanup, deliveryCleanupDefault, DELIVERY_LINKS_QUERY,
  type DeliveryPublishReader, type DeliveryPublishReview, type DeliveryPublishOutcome,
} from "./client-gallery-publish";

/** Replaces native publish. The reviewed plan survives closing an uncertain dialog. */
export const PublishClientGalleryAction: DocumentActionComponent = (props) => {
  const { id: locale } = useCurrentLocale(), copy = deliveryPublishCopy(locale);
  const client = useClient({ apiVersion: STUDIO_VALIDATION_API_VERSION });
  const validation = useValidationStatus(props.draft?._id ?? props.id, props.type, true), sync = useSyncState(props.id, props.type);
  const [open, setOpen] = useState(false), [mode, setMode] = useState<"ordinary" | "replacement">();
  const [proofId, setProofId] = useState(""), [typed, setTyped] = useState("");
  const [review, setReview] = useState<DeliveryPublishReview>();
  const [outcome, setOutcome] = useState<DeliveryPublishOutcome | "not-observed">();
  const [pending, setPending] = useState(false);
  const [cleanupEnroll, setCleanupEnroll] = useState(false), [cleanupControl, setCleanupControl] = useState<CleanupControl>();
  const [cleanupUnreadable, setCleanupUnreadable] = useState(false);
  const [cleanupPreviouslyPublished, setCleanupPreviouslyPublished] = useState<boolean>();
  const busy = useRef(false), prefix = useId(), heading = useRef<HTMLHeadingElement>(null);
  const phase = `${pending ? "pending" : "idle"}:${outcome ?? (review && "ready" in review ? "review" : "choice")}`;
  // Each transition replaces controls; keep keyboard focus inside the dialog.
  useEffect(() => { if (open) heading.current?.focus(); }, [open, phase]);
  if (props.type !== "clientDeliveryGallery") return null;
  const ready = deliveryPublishReady(props, validation, sync.isSyncing);
  const cleanupEligible = !!cleanupPolicyFromGallery((props.draft ?? props.published ?? {}) as Record<string, unknown>);
  const raw = client.withConfig({ perspective: "raw", useCdn: false });
  const reader: DeliveryPublishReader = {
    docs: (ids, allVersions) => raw.request({ url: raw.getDataUrl("doc", ids.join(",")), json: true,
      tag: "delivery-publish", ...(allVersions ? { query: { includeAllVersions: "true" } } : {}) }),
    sweep: (galleryId, ids, assetIds) => raw.fetch(PROOF_DELETE_SWEEP_QUERY, { galleryId, ids, assetIds }, { tag: "delivery-publish" }),
    time: () => raw.fetch("now()", {}, { tag: "delivery-publish" }),
    links: (id) => raw.fetch(DELIVERY_LINKS_QUERY, { id }, { tag: "delivery-publish" }),
    validation: { getClient: () => { const validator = { fetch: raw.fetch.bind(raw), withConfig: () => validator }; return validator; } },
  };
  function reset() { setReview(undefined); setTyped(""); setOutcome(undefined); }
  async function prepareCleanup() {
    if (!studioSettings.clientGalleryCleanup) return;
    busy.current = true; setPending(true); setCleanupUnreadable(false); setCleanupControl(undefined); setCleanupEnroll(false); setCleanupPreviouslyPublished(undefined);
    try {
      const [control, docs] = await Promise.all([readDeliveryCleanup(props.id, reader), readProofDocuments(reader, [props.id])]);
      setCleanupControl(control);
      setCleanupPreviouslyPublished(!!docs.get(props.id));
      setCleanupEnroll(deliveryCleanupDefault((props.draft ?? props.published ?? {}) as Record<string, unknown>, control));
    } catch { setCleanupUnreadable(true); }
    finally { busy.current = false; setPending(false); }
  }
  function close() {
    if (busy.current) return;
    setOpen(false);
    if (outcome === "published") props.onComplete();
  }
  async function load() {
    if (busy.current || !ready || cleanupUnreadable || studioSettings.clientGalleryCleanup && cleanupPreviouslyPublished === undefined || !mode || mode === "replacement" && !proofId.trim()) return;
    busy.current = true; setPending(true); reset();
    try {
      const result = await reviewDeliveryPublication({ id: props.id,
        expectedRevision: String((props.draft ?? props.published)?._rev), proofsEnabled: studioSettings.proofGalleries,
        ...(mode === "replacement" ? { proofId: proofId.trim() } : {}),
        ...(studioSettings.clientGalleryCleanup ? { cleanup: { enroll: cleanupEligible && cleanupEnroll, publicationId: globalThis.crypto.randomUUID(), expectedPublished: cleanupPreviouslyPublished!, expectedControlRevision: cleanupControl?._rev } } : {}),
      }, reader);
      setReview(result);
      if ("reason" in result && result.reason === "stale") await prepareCleanup();
    } catch { setReview({ reason: "unreadable" }); }
    finally { busy.current = false; setPending(false); }
  }
  async function submit() {
    if (busy.current || !review || !("ready" in review) || review.ready.proof && typed.trim() !== review.ready.proof.galleryId) return;
    busy.current = true; setPending(true);
    try {
      setOutcome(await publishDelivery(review.ready, reader, (mutations) => raw.withConfig({ maxRetries: 0 })
        .mutate([...mutations] as unknown as Mutation[], { visibility: "sync", tag: "delivery-publish" }).then(() => undefined)));
    } finally { busy.current = false; setPending(false); }
  }
  async function check() {
    if (busy.current || !review || !("ready" in review)) return;
    busy.current = true; setPending(true);
    try { setOutcome(await reconcileDeliveryPublication(review.ready, reader)); }
    finally { busy.current = false; setPending(false); }
  }
  return {
    // Enabled cleanup status must remain readable even when the gallery needs repairs.
    label: copy.action, disabled: !open && !ready && outcome !== "uncertain" && !studioSettings.clientGalleryCleanup, title: ready ? undefined : copy.unavailable,
    onHandle: () => { if (busy.current || open) return; if (ready || outcome === "uncertain" || studioSettings.clientGalleryCleanup) { if (outcome !== "uncertain") { reset(); setMode(undefined); setProofId(""); void prepareCleanup(); } setOpen(true); } },
    dialog: open ? { type: "dialog", header: copy.action, onClose: close, content: <DeliveryPublishDialog
      locale={locale} prefix={prefix} headingRef={heading} mode={mode} proofId={proofId} typed={typed} review={review} outcome={outcome}
      pending={pending} ready={ready} proofsEnabled={studioSettings.proofGalleries}
      cleanup={studioSettings.clientGalleryCleanup ? { enroll: cleanupEligible && cleanupEnroll, eligible: cleanupEligible, control: cleanupControl, unreadable: cleanupUnreadable,
        loading: cleanupPreviouslyPublished === undefined && !cleanupUnreadable } : undefined}
      onCleanup={(value) => { setCleanupEnroll(value); reset(); }}
      onMode={(value) => { setMode(value); reset(); }} onProofId={(value) => { setProofId(value); reset(); }}
      onTyped={setTyped} onReview={() => void load()} onSubmit={() => void submit()} onCheck={() => void check()}
      onReset={() => { reset(); void prepareCleanup(); }} onClose={close} /> } : undefined,
  };
};
