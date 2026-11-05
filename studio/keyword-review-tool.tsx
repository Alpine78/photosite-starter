import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Button, Card, Checkbox, Flex, Heading, Select, Spinner, Stack, Text, TextInput } from "@sanity/ui";
import { useClient, useCurrentLocale, type Mutation } from "sanity";
import { useRouter } from "sanity/router";

import { STUDIO_VALIDATION_API_VERSION } from "../sanity/schemas/validation";
import { studioValidationMessage } from "./interface-locales";
import { INITIAL_KEYWORD_TAXONOMY_STATE, KEYWORD_PUBLISH_PARAMS, KEYWORD_PUBLISH_QUERY } from "./keyword-publish";
import {
  aggregateKeywordReview,
  KEYWORD_ALIAS_TARGET_QUERY,
  KEYWORD_ID_RESERVATION_QUERY,
  KEYWORD_TERM_DECISIONS_QUERY,
  KEYWORD_REVIEW_RECORDS_QUERY,
  keywordAliasTargetParams,
  keywordReviewAction,
  keywordReviewCopy,
  keywordReviewOutcome,
  planAddAlias,
  planChooseKeyword,
  planRemoveDecision,
  planCreateKeywordDraft,
  proposedCategoryId,
  proposedKeywordId,
  proposedParentId,
  recordedDecisions,
  proposedTitle,
  type AliasTarget,
  type KeywordReviewGraph,
  type KeywordReviewGroup,
  type KeywordReviewPlan,
  type TermDecision,
} from "./keyword-review";
import { studioSettings } from "./environment";

const KEYWORD_OPTIONS_QUERY = `*[_type == "keyword" && status == "active"] | order(keywordId asc){_id, keywordId, "name": title[0].value}`;
const CATEGORY_OPTIONS_QUERY = `*[_type == "keywordCategory"] | order(order asc){_id, "name": title[0].value}`;

type Option = Readonly<{ _id: string; name?: string; keywordId?: string }>;
type Status = Readonly<{ tone: "positive" | "critical"; text: string }>;
type Copy = ReturnType<typeof keywordReviewCopy>;

/** Reads the keyword graph under its revision, and writes one plan under it, as every keyword write does. */
function useKeywordWrite(copy: Copy, locale: string, onSaved: () => void) {
  const client = useClient({ apiVersion: STUDIO_VALIDATION_API_VERSION });
  const raw = client.withConfig({ perspective: "raw", useCdn: false });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>();
  const run = async (makePlan: (graph: KeywordReviewGraph) => Promise<KeywordReviewPlan>): Promise<KeywordReviewPlan | undefined> => {
    setBusy(true);
    setStatus(undefined);
    try {
      await raw.createIfNotExists({ ...INITIAL_KEYWORD_TAXONOMY_STATE }, { visibility: "sync", tag: "keyword-review" });
      const result = await client.withConfig({ perspective: "published", useCdn: false }).fetch<{ state?: { _rev?: string } | null; keywords?: unknown[] }>(KEYWORD_PUBLISH_QUERY, { ...KEYWORD_PUBLISH_PARAMS }, { tag: "keyword-review" });
      if (typeof result.state?._rev !== "string" || !Array.isArray(result.keywords)) { setStatus({ tone: "critical", text: copy.unavailable }); return undefined; }
      const plan = await makePlan({ stateRevision: result.state._rev, keywords: result.keywords });
      if ("refused" in plan) {
        const known = copy.refused[plan.refused];
        setStatus({ tone: "critical", text: known ?? studioValidationMessage(plan.refused)[locale] ?? plan.refused });
        return plan;
      }
      await raw.mutate([...plan.mutations] as unknown as Mutation[], { visibility: "sync", tag: "keyword-review" });
      setStatus({ tone: "positive", text: plan.draftId === undefined ? copy.done : copy.draftDone });
      onSaved();
      return plan;
    } catch (error) {
      setStatus({ tone: "critical", text: copy[keywordReviewOutcome(error)] });
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { raw, busy, status, run };
}

function GroupCard({ group, keywords, categories, copy, locale, onSaved }: {
  readonly group: KeywordReviewGroup;
  readonly keywords: readonly Option[];
  readonly categories: readonly Option[];
  readonly copy: Copy;
  readonly locale: string;
  readonly onSaved: () => void;
}) {
  const { raw, busy, status, run } = useKeywordWrite(copy, locale, onSaved);
  const router = useRouter();
  const [aliasTarget, setAliasTarget] = useState("");
  const [title, setTitle] = useState(() => proposedTitle(group));
  const [keywordId, setKeywordId] = useState(() => proposedKeywordId(proposedTitle(group)));
  const [categoryRef, setCategoryRef] = useState(() => proposedCategoryId(group, categories));
  const [visibility, setVisibility] = useState<"" | "public" | "internal">("");
  const [publicConfirmed, setPublicConfirmed] = useState(false);
  const [parentRef, setParentRef] = useState(() => proposedParentId(group, keywords));
  const [draftId, setDraftId] = useState<string>();

  const addAlias = () => run(async (graph) => {
    const { target, hasDraft } = await raw.fetch<{ target: Omit<AliasTarget, "hasDraft"> | null; hasDraft: boolean }>(KEYWORD_ALIAS_TARGET_QUERY, keywordAliasTargetParams(aliasTarget), { tag: "keyword-review" });
    if (target === null) return { refused: copy.unavailable };
    return planAddAlias(graph, group, { ...target, hasDraft }, publicConfirmed);
  });

  const chooseKeyword = () => run(async (graph) => {
    const chosen = keywords.find((option) => option._id === aliasTarget);
    if (chosen?.keywordId === undefined) return { refused: copy.unavailable };
    const existing = await raw.fetch<readonly TermDecision[] | null>(KEYWORD_TERM_DECISIONS_QUERY, {}, { tag: "keyword-review" });
    return planChooseKeyword(graph, group, { documentId: chosen._id, keywordId: chosen.keywordId }, existing, crypto.randomUUID());
  });

  const createDraft = async () => {
    const plan = await run(async (graph) => planCreateKeywordDraft(graph, group, {
    title, keywordId, categoryRef, internal: visibility === "internal", publicConfirmed, parentRef,
    idReserved: await raw.fetch<boolean>(KEYWORD_ID_RESERVATION_QUERY, { keywordId }, { tag: "keyword-review" }),
    language: studioSettings.defaultContentLanguage ?? locale.split("-")[0],
    uuid: crypto.randomUUID(),
    }));
    if (plan !== undefined && "draftId" in plan && plan.draftId !== undefined) setDraftId(plan.draftId);
  };

  const action = keywordReviewAction(group);
  // A path stays private, and an alias on an internal keyword is not public.
  const needsPublicConfirmation = action === "add-alias";
  const reason = copy.reasons[group.reason] ?? group.reason;
  const candidateIds = new Set(group.candidates);
  const sorted = [...keywords].sort((left, right) => Number(candidateIds.has(right.keywordId ?? "")) - Number(candidateIds.has(left.keywordId ?? "")));

  return (
    <Card padding={4} radius={2} shadow={1}>
      <Stack gap={4}>
        <Stack gap={2}>
          <Heading as="h2" size={1}>{group.terms.join(", ") || group.key}</Heading>
          <Text size={1} muted>{reason}. {copy.occurrences}: {group.occurrences}.</Text>
          <Text size={1} muted>{copy.examples}: {group.mediaIds.join(", ")}</Text>
          {group.candidates.length > 0 && <Text size={1} muted>{copy.candidates}: {group.candidates.join(", ")}</Text>}
          {group.proposedCategoryTerm !== null && <Text size={1} muted>{copy.proposedCategory}: {group.proposedCategoryTerm}</Text>}
        </Stack>

        {action === "fix-source" && <Text size={1}>{copy.fixSource}</Text>}
        {(action === "choose-candidate" || action === "choose-for-path") && <Stack gap={2}>
          <Text weight="semibold" size={1}>{action === "choose-for-path" ? copy.choosePathHeading : copy.chooseHeading}</Text>
          <Flex gap={2}>
            <Box flex={1}>
              <Select aria-label={copy.aliasKeyword} value={aliasTarget} onChange={(event) => setAliasTarget(event.currentTarget.value)}>
                <option value="">{copy.aliasChoose}</option>
                {sorted.filter((option) => action === "choose-for-path" || candidateIds.has(option.keywordId ?? "")).map((option) => <option key={option._id} value={option._id}>{option.name ?? option.keywordId} ({option.keywordId})</option>)}
              </Select>
            </Box>
            <Button text={copy.chooseAction} tone="primary" disabled={busy || aliasTarget === ""} onClick={() => void chooseKeyword()} />
          </Flex>
        </Stack>}
        {needsPublicConfirmation && <Flex align="center" gap={2}>
          <Checkbox id={`public-${group.reason}-${group.key}`} checked={publicConfirmed} onChange={(event) => setPublicConfirmed(event.currentTarget.checked)} />
          <Text size={1}><label htmlFor={`public-${group.reason}-${group.key}`}>{copy.publicConfirm.replace("{name}", group.key)}</label></Text>
        </Flex>}

        {action === "add-alias" && <Stack gap={2}>
          <Text weight="semibold" size={1}>{copy.aliasHeading}</Text>
          <Flex gap={2}>
            <Box flex={1}>
              <Select aria-label={copy.aliasKeyword} value={aliasTarget} onChange={(event) => setAliasTarget(event.currentTarget.value)}>
                <option value="">{copy.aliasChoose}</option>
                {sorted.map((option) => <option key={option._id} value={option._id}>{option.name ?? option.keywordId} ({option.keywordId})</option>)}
              </Select>
            </Box>
            <Button text={copy.aliasAction} tone="primary" disabled={busy || aliasTarget === ""} onClick={() => void addAlias()} />
          </Flex>
        </Stack>}

        {(action === "add-alias" || action === "choose-for-path") && <Stack gap={2}>
          <Text weight="semibold" size={1}>{copy.createHeading}</Text>
          <TextInput aria-label={copy.createTitle} placeholder={copy.createTitle} value={title} onChange={(event) => { setTitle(event.currentTarget.value); setKeywordId(proposedKeywordId(event.currentTarget.value)); }} />
          <TextInput aria-label={copy.createId} placeholder={copy.createId} value={keywordId} onChange={(event) => setKeywordId(event.currentTarget.value)} />
          <Select aria-label={copy.createCategory} value={categoryRef} onChange={(event) => setCategoryRef(event.currentTarget.value)}>
            <option value="">{copy.createChoose}</option>
            {categories.map((option) => <option key={option._id} value={option._id}>{option.name ?? option._id}</option>)}
          </Select>
          {action === "choose-for-path" && <Select aria-label={copy.createParent} value={parentRef} onChange={(event) => setParentRef(event.currentTarget.value)}>
            <option value="">{copy.createNoParent}</option>
            {keywords.map((option) => <option key={option._id} value={option._id}>{option.name ?? option.keywordId} ({option.keywordId})</option>)}
          </Select>}
          <Select aria-label={copy.createVisibility} value={visibility} onChange={(event) => setVisibility(event.currentTarget.value as typeof visibility)}>
            <option value="">{copy.createChooseVisibility}</option>
            <option value="public">{copy.createPublic}</option>
            <option value="internal">{copy.createInternal}</option>
          </Select>
          <Flex gap={2}>
            <Button text={copy.createAction} disabled={busy || categoryRef === "" || visibility === "" || draftId !== undefined} onClick={() => void createDraft()} />
            {draftId !== undefined && <Button mode="ghost" text={copy.openDraft} onClick={() => router.navigateIntent("edit", { id: draftId.replace(/^drafts\./u, ""), type: "keyword" })} />}
          </Flex>
        </Stack>}

        {status !== undefined && <Card padding={3} radius={2} tone={status.tone} role="status"><Text size={1}>{status.text}</Text></Card>}
      </Stack>
    </Card>
  );
}

function RecordedDecisions({ decisions, keywords, copy, locale, onSaved }: {
  readonly decisions: readonly TermDecision[] | null;
  readonly keywords: readonly Option[];
  readonly copy: Copy;
  readonly locale: string;
  readonly onSaved: () => void;
}) {
  const { busy, status, run } = useKeywordWrite(copy, locale, onSaved);
  const rows = recordedDecisions(decisions);
  if (rows.length === 0) return null;
  const nameOf = (documentId: string) => { const keyword = keywords.find((option) => option._id === documentId); return keyword?.name ?? keyword?.keywordId ?? documentId; };
  return (
    <Card padding={4} radius={2} shadow={1}>
      <Stack gap={3}>
        <Heading as="h2" size={1}>{copy.decisionsHeading}</Heading>
        {rows.map((row) => (
          <Flex key={row.key} align="center" gap={2}>
            <Box flex={1}><Text size={1}>{row.key} → {nameOf(row.documentId)}</Text></Box>
            <Button mode="ghost" text={copy.decisionRemove} disabled={busy} onClick={() => void run(async (graph) => planRemoveDecision(graph, decisions, row.key))} />
          </Flex>
        ))}
        {status !== undefined && <Card padding={3} radius={2} tone={status.tone} role="status"><Text size={1}>{status.text}</Text></Card>}
      </Stack>
    </Card>
  );
}

/** One aggregated row per imported term (AB#70). Reads private records with the editor's own access. */
export function KeywordReviewTool() {
  const { id: locale } = useCurrentLocale();
  const copy = useMemo(() => keywordReviewCopy(locale), [locale]);
  const client = useClient({ apiVersion: STUDIO_VALIDATION_API_VERSION });
  const [groups, setGroups] = useState<readonly KeywordReviewGroup[]>();
  const [keywords, setKeywords] = useState<readonly Option[]>([]);
  const [categories, setCategories] = useState<readonly Option[]>([]);
  const [decisions, setDecisions] = useState<readonly TermDecision[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const published = client.withConfig({ perspective: "published", useCdn: false });
      const [records, keywordRows, categoryRows, decisionRows] = await Promise.all([
        published.fetch<readonly Record<string, unknown>[]>(KEYWORD_REVIEW_RECORDS_QUERY, {}, { tag: "keyword-review" }),
        published.fetch<readonly Option[]>(KEYWORD_OPTIONS_QUERY, {}, { tag: "keyword-review" }),
        published.fetch<readonly Option[]>(CATEGORY_OPTIONS_QUERY, {}, { tag: "keyword-review" }),
        published.fetch<readonly TermDecision[] | null>(KEYWORD_TERM_DECISIONS_QUERY, {}, { tag: "keyword-review" }),
      ]);
      setGroups(aggregateKeywordReview(records));
      setKeywords(keywordRows);
      setCategories(categoryRows);
      setDecisions(decisionRows);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [client]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- A read on mount, settled by its own promise.
    void load();
  }, [load]);

  return (
    <Box padding={4} style={{ overflow: "auto", height: "100%" }}>
      <Stack gap={4} style={{ maxWidth: 760, margin: "0 auto" }}>
        <Heading as="h1" size={3}>{copy.title}</Heading>
        <Text muted>{copy.intro}</Text>
        {failed ? <Card padding={3} tone="critical" role="status"><Text>{copy.unavailable}</Text></Card>
          : groups === undefined ? <Spinner />
          : groups.length === 0 ? <Text>{copy.empty}</Text>
          : groups.map((group) => <GroupCard key={`${group.reason}:${group.key}`} group={group} keywords={keywords} categories={categories} copy={copy} locale={locale} onSaved={() => void load()} />)}
        <RecordedDecisions decisions={decisions} keywords={keywords} copy={copy} locale={locale} onSaved={() => void load()} />
      </Stack>
    </Box>
  );
}
