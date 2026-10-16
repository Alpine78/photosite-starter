import { useEffect, useRef, useState } from "react";
import { useClient, useCurrentLocale, type DocumentActionComponent, type DocumentActionProps } from "sanity";
import { createLocalizedDraftPort } from "./localized-draft-port";
import { studioSettings } from "./environment";
import { localizedDraftActionCopy, localizedDraftNotice } from "./localized-draft-action-copy";
import {
  actionFailure, createPreparedLocalizedDraft, documentSnapshot, loadLocalizedDraftSource, prepareLocalizedDraft,
  type DraftActionCode, type PreparedLocalizedDraft,
} from "./localized-draft-action-model";

function LanguageDraftDialog({ props, onClose }: { props: DocumentActionProps; onClose(): void }) {
  const { id: locale } = useCurrentLocale();
  const copy = localizedDraftActionCopy(locale);
  const client = useClient({ apiVersion: "2025-02-19" });
  const source = props.draft ?? props.published;
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const [targets, setTargets] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const [prepared, setPrepared] = useState<PreparedLocalizedDraft>();
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [created, setCreated] = useState(false);
  const [error, setError] = useState<DraftActionCode>();
  const controller = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const resultRef = useRef<HTMLParagraphElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const sourceSnapshot = documentSnapshot(source);
  const available = !!source && !props.version && !props.release && !props.transactionSyncLock && props.ready;
  const availableRef = useRef(available);
  availableRef.current = available;
  const port = createLocalizedDraftPort(client, () => ({ available: availableRef.current, source: sourceRef.current }), sourceSnapshot);
  const portRef = useRef(port);
  portRef.current = port;

  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    if (sourceRef.current && available) {
      loadLocalizedDraftSource(portRef.current, sourceRef.current, current.signal).then(({ source: saved, versions }) => {
        if (current.signal.aborted) return;
        setTargets(studioSettings.authoringLanguages.filter((language) => language !== saved.language && !versions.some((row) => row.language === language)));
        setLoaded(true);
      }).catch((failure: unknown) => { if (!current.signal.aborted) setError(actionFailure(failure).code); });
    }
    return () => current.abort();
  }, [sourceSnapshot, available]);

  async function run(create: boolean) {
    if (inFlight.current || !sourceRef.current || !available || !target || !targets.includes(target)) return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    const current = new AbortController();
    controller.current?.abort();
    controller.current = current;
    const editor = sourceRef.current;
    try {
      if (create && prepared) {
        if (documentSnapshot(editor) !== prepared.sourceSnapshot) throw new Error("source-changed");
        await createPreparedLocalizedDraft(portRef.current, prepared, editor, target, studioSettings.authoringLanguages, current.signal);
        if (!current.signal.aborted) setCreated(true);
      } else {
        const result = await prepareLocalizedDraft(portRef.current, editor, target, studioSettings.authoringLanguages, current.signal);
        if (!availableRef.current || documentSnapshot(sourceRef.current) !== result.sourceSnapshot) throw new Error("source-changed");
        if (!current.signal.aborted) setPrepared(result);
      }
    } catch (failure) {
      if (!current.signal.aborted) {
        setPrepared(undefined);
        setError(failure instanceof Error && failure.message === "source-changed" ? "changed" : actionFailure(failure).code);
      }
    } finally {
      inFlight.current = false;
      if (!current.signal.aborted) setBusy(false);
    }
  }
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (error) errorRef.current?.focus();
    else if (prepared || created) resultRef.current?.focus();
  }, [error, prepared, created]);
  const validPreview = available && prepared && prepared.sourceSnapshot === sourceSnapshot;
  return <div>
    <p>{copy.intro}</p>
    <p role="status">{!available ? copy.save : !loaded && !error ? copy.loading : loaded && targets.length === 0 ? copy.empty : ""}</p>
    {loaded && targets.length > 0 && <label>{copy.target}{" "}<select value={target} disabled={busy || created} onChange={(event) => { setTarget(event.target.value); setPrepared(undefined); setError(undefined); }}>
      <option value="">—</option>
      {targets.map((language) => <option key={language} value={language}>{language}</option>)}
    </select></label>}
    <p ref={errorRef} tabIndex={-1} role="alert">{error ? copy.errors[error] : ""}</p>
    <p ref={resultRef} tabIndex={-1} role="status">
      {created ? copy.created : busy ? copy.loading : !error && validPreview ? copy.ready : ""}
    </p>
    {validPreview && <div>
      <p>{copy.fields}: {prepared.plan.reviewPaths.length}; {copy.placements}: {prepared.plan.placementDrafts.length}</p>
      <details><summary>{copy.fields}</summary><ul>{prepared.plan.reviewPaths.map((path) => <li key={path}>{path}</li>)}</ul></details>
      {prepared.plan.notices.length > 0 && <div><p>{copy.notices}</p><ul>{prepared.plan.notices.map((notice, index) => <li key={`${index}:${notice}`}>{localizedDraftNotice(notice, locale)}</li>)}</ul></div>}
    </div>}
    {!created && <p>
      <button type="button" disabled={!available || !target || busy} onClick={() => void run(false)}>{copy.preview}</button>{" "}
      <button type="button" disabled={!available || !validPreview || busy} onClick={() => void run(true)}>{copy.create}</button>
    </p>}
    <button type="button" disabled={busy} onClick={onClose}>{copy.close}</button>
  </div>;
}

export const CreateLanguageVersionAction: DocumentActionComponent = (props) => {
  const { id } = useCurrentLocale();
  const [open, setOpen] = useState(false);
  const copy = localizedDraftActionCopy(id);
  if (!["article", "gallery"].includes(props.type)) return null;
  return {
    label: copy.action,
    disabled: !props.ready || !!props.version || !!props.release || !!props.transactionSyncLock || !(props.draft ?? props.published),
    onHandle: () => setOpen(true),
    dialog: open ? {
      type: "dialog", header: copy.action, onClose: () => setOpen(false),
      content: <LanguageDraftDialog key={props.id} props={props} onClose={() => setOpen(false)} />,
    } : undefined,
  };
};
