import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Box, Button, Card, Flex, Heading, Radio, Spinner, Stack, Text } from "@sanity/ui";
import { useClient, useCurrentLocale, type DocumentActionComponent, type DocumentActionProps } from "sanity";
import { useRouter } from "sanity/router";
import { createLocalizedDraftPort } from "./localized-draft-port";
import { transactionSyncLocked } from "./editor-lock";
import { studioSettings } from "./environment";
import { languageName, localizedDraftActionCopy, localizedDraftNotice, summarizeReviewPaths } from "./localized-draft-action-copy";
import {
  actionFailure, createPreparedLocalizedDraft, documentSnapshot, loadLocalizedDraftSource, prepareLocalizedDraft,
  type DraftActionCode, type PreparedLocalizedDraft,
} from "./localized-draft-action-model";

function Step({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return <Stack as="section" gap={3} aria-labelledby={id}>
    <Heading as="h3" size={1} id={id}>{title}</Heading>
    {children}
  </Stack>;
}

function Waiting({ text }: { text: string }) {
  return <Flex align="center" gap={3}><Spinner muted /><Text size={1} muted>{text}</Text></Flex>;
}

function Bullets({ items }: { items: readonly string[] }) {
  return <Stack as="ul" gap={2} margin={0} padding={0} style={{ listStyle: "none" }}>
    {items.map((item, index) => <Flex as="li" key={`${index}:${item}`} gap={2}>
      <Text size={1} muted aria-hidden="true">•</Text><Text size={1}>{item}</Text>
    </Flex>)}
  </Stack>;
}

function LanguageDraftDialog({ props, onClose }: { props: DocumentActionProps; onClose(): void }) {
  const { id: locale } = useCurrentLocale();
  const copy = localizedDraftActionCopy(locale);
  const router = useRouter();
  const ids = useId();
  const client = useClient({ apiVersion: "2025-02-19" });
  const source = props.draft ?? props.published;
  const sourceRef = useRef(source);
  const [targets, setTargets] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const [prepared, setPrepared] = useState<PreparedLocalizedDraft>();
  const [busy, setBusy] = useState<"preview" | "create">();
  const [loaded, setLoaded] = useState(false);
  const [created, setCreated] = useState(false);
  const [error, setError] = useState<DraftActionCode>();
  const controller = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const sourceSnapshot = documentSnapshot(source);
  const available = !!source && !props.version && !props.release && !transactionSyncLocked(props.transactionSyncLock) && props.ready;
  const availableRef = useRef(available);
  const portRef = useRef<ReturnType<typeof createLocalizedDraftPort> | null>(null);
  // Imperative guards must observe committed editor props, never a render
  // that React may abandon. Update before passive loading or user interaction.
  useLayoutEffect(() => {
    sourceRef.current = source;
    availableRef.current = available;
    portRef.current = createLocalizedDraftPort(client, () => ({ available: availableRef.current, source: sourceRef.current }), sourceSnapshot);
  }, [client, source, sourceSnapshot, available]);

  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    const port = portRef.current;
    if (sourceRef.current && available && port) {
      loadLocalizedDraftSource(port, sourceRef.current, current.signal).then(({ source: saved, versions }) => {
        if (current.signal.aborted) return;
        const open = studioSettings.authoringLanguages.filter((language) => language !== saved.language && !versions.some((row) => row.language === language));
        setTargets(open);
        // One remaining language is the only sensible choice; selecting it saves a step.
        if (open.length === 1) setTarget(open[0]);
        setLoaded(true);
      }).catch((failure: unknown) => { if (!current.signal.aborted) setError(actionFailure(failure).code); });
    }
    return () => current.abort();
  }, [sourceSnapshot, available]);

  async function run(create: boolean) {
    const port = portRef.current;
    if (!port || inFlight.current || !sourceRef.current || !available || !target || !targets.includes(target)) return;
    inFlight.current = true;
    setBusy(create ? "create" : "preview");
    setError(undefined);
    const current = new AbortController();
    controller.current?.abort();
    controller.current = current;
    const editor = sourceRef.current;
    try {
      if (create && prepared) {
        if (documentSnapshot(editor) !== prepared.sourceSnapshot) throw new Error("source-changed");
        await createPreparedLocalizedDraft(port, prepared, editor, target, studioSettings.authoringLanguages, current.signal);
        if (!current.signal.aborted) setCreated(true);
      } else {
        const result = await prepareLocalizedDraft(port, editor, target, studioSettings.authoringLanguages, current.signal);
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
      if (!current.signal.aborted) setBusy(undefined);
    }
  }
  // The check only reads saved content, so it starts as soon as a language is chosen
  // and repeats when the saved source changes underneath an open dialog.
  const runRef = useRef(run);
  useLayoutEffect(() => { runRef.current = run; });
  useEffect(() => { if (loaded && target && available) void runRef.current(false); }, [loaded, target, available, sourceSnapshot]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (error) errorRef.current?.focus();
    else if (created) resultRef.current?.focus();
  }, [error, created]);

  function choose(language: string) {
    if (language === target) return;
    setPrepared(undefined);
    setError(undefined);
    setTarget(language);
  }
  function openDraft() {
    if (!prepared) return;
    const id = String(prepared.plan.draft._id).replace(/^drafts\./, "");
    onClose();
    router.navigateIntent("edit", { id, type: props.type });
  }

  const validPreview = available && prepared && prepared.sourceSnapshot === sourceSnapshot;
  const sourceLanguage = typeof source?.language === "string" ? source.language : undefined;
  const targetName = target ? languageName(target, locale) : "";
  const notices = validPreview ? prepared.plan.notices.map((notice) => localizedDraftNotice(notice, locale, prepared.names)) : [];
  const groups = validPreview ? summarizeReviewPaths(prepared.plan.reviewPaths).map(({ group, count }) => copy.group(group, count)) : [];

  return <Stack gap={5} paddingBottom={1}>
    <Card padding={4} radius={2} tone="primary" border>
      <Stack gap={3}>
        <Text size={1}>{copy.intro(props.type === "gallery")}</Text>
        {sourceLanguage && <Text size={1} muted>{copy.sourceLanguage}: {languageName(sourceLanguage, locale)} ({sourceLanguage.toUpperCase()})</Text>}
      </Stack>
    </Card>

    {!available && <Card padding={3} radius={2} tone="caution" border><Text size={1}>{copy.save}</Text></Card>}

    {!created && <Step title={copy.stepLanguage} id={`${ids}-language`}>
      {available && !loaded && !error && <Waiting text={copy.loadingSource} />}
      {loaded && targets.length === 0 && <Card padding={3} radius={2} tone="caution" border><Text size={1}>{copy.empty}</Text></Card>}
      {loaded && targets.length > 0 && <Stack gap={2} role="radiogroup" aria-labelledby={`${ids}-language`}>
        {targets.map((language) => {
          const selected = language === target;
          return <Card key={language} as="label" padding={3} radius={2} border tone={selected ? "primary" : "default"}
            style={{ cursor: busy ? "default" : "pointer" }}>
            <Flex align="center" gap={3}>
              {/* Sanity UI positions the hidden native input absolutely; contain it so it cannot cover the dialog. */}
              <Box style={{ position: "relative", flex: "none" }}>
                <Radio name={`${ids}-target`} value={language} checked={selected} disabled={!!busy} onChange={() => choose(language)} />
              </Box>
              <Text size={1} weight={selected ? "semibold" : "regular"}>{languageName(language, locale)} ({language.toUpperCase()})</Text>
            </Flex>
          </Card>;
        })}
      </Stack>}
    </Step>}

    {!created && <Step title={copy.stepReview} id={`${ids}-review`}>
      {!target && <Text size={1} muted>{copy.chooseFirst}</Text>}
      {target && busy === "preview" && <Waiting text={copy.loadingPreview} />}
      {validPreview && <Card padding={4} radius={2} border>
        <Stack gap={4}>
          <Text size={1}>{copy.reviewIntro}</Text>
          <Bullets items={groups} />
          <Text size={1} muted>{copy.unchanged}</Text>
        </Stack>
      </Card>}
      {notices.length > 0 && <Card padding={4} radius={2} tone="caution" border>
        <Stack gap={3}><Text size={1} weight="semibold">{copy.noticesTitle}</Text><Bullets items={notices} /></Stack>
      </Card>}
    </Step>}

    {error && <div ref={errorRef} tabIndex={-1} role="alert">
      <Card padding={4} radius={2} tone="critical" border>
        <Stack gap={3}>
          <Text size={1} weight="semibold">{copy.errorTitle}</Text>
          <Text size={1}>{copy.errors[error]}</Text>
          {target && !created && <Flex><Button mode="ghost" text={copy.retry} disabled={!!busy} onClick={() => void run(false)} /></Flex>}
        </Stack>
      </Card>
    </div>}

    {!created && <Step title={copy.stepCreate} id={`${ids}-create`}>
      <div role="status"><Text size={1} muted>{validPreview ? copy.createHint(target.toUpperCase()) : copy.createLocked}</Text></div>
    </Step>}

    {created && <div ref={resultRef} tabIndex={-1} role="status">
      <Card padding={4} radius={2} tone="positive" border>
        <Stack gap={3}>
          <Text size={2} weight="semibold">{copy.createdTitle(targetName)}</Text>
          <Text size={1}>{copy.createdNext}</Text>
        </Stack>
      </Card>
    </div>}

    <Flex gap={2} justify="flex-end" wrap="wrap">
      {created ? <>
        <Button mode="ghost" text={copy.close} onClick={onClose} />
        <Button tone="primary" text={copy.open} onClick={openDraft} />
      </> : <>
        <Button mode="ghost" text={copy.cancel} disabled={busy === "create"} onClick={onClose} />
        <Button tone="primary" text={target ? copy.create(targetName) : copy.create("…")} loading={busy === "create"}
          disabled={!validPreview || !!busy} onClick={() => void run(true)} />
      </>}
    </Flex>
  </Stack>;
}

export const CreateLanguageVersionAction: DocumentActionComponent = (props) => {
  const { id } = useCurrentLocale();
  const [open, setOpen] = useState(false);
  const copy = localizedDraftActionCopy(id);
  if (!["article", "gallery"].includes(props.type)) return null;
  return {
    label: copy.action,
    disabled: !props.ready || !!props.version || !!props.release || transactionSyncLocked(props.transactionSyncLock) || !(props.draft ?? props.published),
    onHandle: () => setOpen(true),
    dialog: open ? {
      type: "dialog", header: copy.action, onClose: () => setOpen(false),
      content: <LanguageDraftDialog key={props.id} props={props} onClose={() => setOpen(false)} />,
    } : undefined,
  };
};
