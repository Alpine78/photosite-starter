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
  KEYWORD_REVIEW_RECORDS_QUERY,
  keywordAliasTargetParams,
  keywordReviewAction,
  keywordReviewCopy,
  keywordReviewOutcome,
  planAddAlias,
  planCreateKeywordDraft,
  proposedCategoryId,
  proposedKeywordId,
  proposedTitle,
  type AliasTarget,
  type KeywordReviewGraph,
  type KeywordReviewGroup,
  type KeywordReviewPlan,
} from "./keyword-review";
import { studioSettings } from "./environment";

const KEYWORD_OPTIONS_QUERY = `*[_type == "keyword" && status == "active"] | order(keywordId asc){_id, keywordId, "name": title[0].value}`;
const CATEGORY_OPTIONS_QUERY = `*[_type == "keywordCategory"] | order(order asc){_id, "name": title[0].value}`;

type Option = Readonly<{ _id: string; name?: string; keywordId?: string }>;
type Status = Readonly<{ tone: "positive" | "critical"; text: string }>;
type Copy = ReturnType<typeof keywordReviewCopy>;

function GroupCard({ group, keywords, categories, copy, locale, onSaved }: {
  readonly group: KeywordReviewGroup;
  readonly keywords: readonly Option[];
  readonly categories: readonly Option[];
  readonly copy: Copy;
  readonly locale: string;
  readonly onSaved: () => void;
}) {
  const client = useClient({ apiVersion: STUDIO_VALIDATION_API_VERSION });
  const raw = client.withConfig({ perspective: "raw", useCdn: false });
  const router = useRouter();
  const [aliasTarget, setAliasTarget] = useState("");
  const [title, setTitle] = useState(() => proposedTitle(group));
  const [keywordId, setKeywordId] = useState(() => proposedKeywordId(proposedTitle(group)));
  const [categoryRef, setCategoryRef] = useState(() => proposedCategoryId(group, categories));
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>();
  const [draftId, setDraftId] = useState<string>();

  const readGraph = async (): Promise<KeywordReviewGraph | undefined> => {
    await raw.createIfNotExists({ ...INITIAL_KEYWORD_TAXONOMY_STATE }, { visibility: "sync", tag: "keyword-review" });
    const result = await client.withConfig({ perspective: "published", useCdn: false }).fetch<{ state?: { _rev?: string } | null; keywords?: unknown[] }>(KEYWORD_PUBLISH_QUERY, { ...KEYWORD_PUBLISH_PARAMS }, { tag: "keyword-review" });
    return typeof result.state?._rev === "string" && Array.isArray(result.keywords) ? { stateRevision: result.state._rev, keywords: result.keywords } : undefined;
  };

  const run = async (makePlan: (graph: KeywordReviewGraph) => Promise<KeywordReviewPlan>) => {
    setBusy(true);
    setStatus(undefined);
    try {
      const graph = await readGraph();
      if (graph === undefined) { setStatus({ tone: "critical", text: copy.unavailable }); return; }
      const plan = await makePlan(graph);
      if ("refused" in plan) {
        const known = copy.refused[plan.refused];
        setStatus({ tone: "critical", text: known ?? studioValidationMessage(plan.refused)[locale] ?? plan.refused });
        return;
      }
      await raw.mutate([...plan.mutations] as unknown as Mutation[], { visibility: "sync", tag: "keyword-review" });
      setStatus({ tone: "positive", text: copy.done });
      if (plan.draftId !== undefined) setDraftId(plan.draftId);
      onSaved();
    } catch (error) {
      setStatus({ tone: "critical", text: copy[keywordReviewOutcome(error)] });
    } finally {
      setBusy(false);
    }
  };

  const addAlias = () => run(async (graph) => {
    const { target, hasDraft } = await raw.fetch<{ target: Omit<AliasTarget, "hasDraft"> | null; hasDraft: boolean }>(KEYWORD_ALIAS_TARGET_QUERY, keywordAliasTargetParams(aliasTarget), { tag: "keyword-review" });
    if (target === null) return { refused: copy.unavailable };
    return planAddAlias(graph, group, { ...target, hasDraft });
  });

  const createDraft = () => run(async (graph) => planCreateKeywordDraft(graph, group, {
    title, keywordId, categoryRef, internal,
    language: studioSettings.defaultContentLanguage ?? locale.split("-")[0],
    uuid: crypto.randomUUID(),
  }));

  const action = keywordReviewAction(group);
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
        {action === "fix-keywords" && <Text size={1}>{copy.fixKeywords}</Text>}
        {action === "decide" && <Stack gap={2}>
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

        {action === "decide" && <Stack gap={2}>
          <Text weight="semibold" size={1}>{copy.createHeading}</Text>
          <TextInput aria-label={copy.createTitle} placeholder={copy.createTitle} value={title} onChange={(event) => { setTitle(event.currentTarget.value); setKeywordId(proposedKeywordId(event.currentTarget.value)); }} />
          <TextInput aria-label={copy.createId} placeholder={copy.createId} value={keywordId} onChange={(event) => setKeywordId(event.currentTarget.value)} />
          <Select aria-label={copy.createCategory} value={categoryRef} onChange={(event) => setCategoryRef(event.currentTarget.value)}>
            <option value="">{copy.createChoose}</option>
            {categories.map((option) => <option key={option._id} value={option._id}>{option.name ?? option._id}</option>)}
          </Select>
          <Flex align="center" gap={2}>
            <Checkbox id={`internal-${group.key}`} checked={internal} onChange={(event) => setInternal(event.currentTarget.checked)} />
            <Text size={1}><label htmlFor={`internal-${group.key}`}>{copy.createInternal}</label></Text>
          </Flex>
          <Flex gap={2}>
            <Button text={copy.createAction} disabled={busy || categoryRef === "" || draftId !== undefined} onClick={() => void createDraft()} />
            {draftId !== undefined && <Button mode="ghost" text={copy.openDraft} onClick={() => router.navigateIntent("edit", { id: draftId.replace(/^drafts\./u, ""), type: "keyword" })} />}
          </Flex>
        </Stack>}

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
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const published = client.withConfig({ perspective: "published", useCdn: false });
      const [records, keywordRows, categoryRows] = await Promise.all([
        published.fetch<readonly Record<string, unknown>[]>(KEYWORD_REVIEW_RECORDS_QUERY, {}, { tag: "keyword-review" }),
        published.fetch<readonly Option[]>(KEYWORD_OPTIONS_QUERY, {}, { tag: "keyword-review" }),
        published.fetch<readonly Option[]>(CATEGORY_OPTIONS_QUERY, {}, { tag: "keyword-review" }),
      ]);
      setGroups(aggregateKeywordReview(records));
      setKeywords(keywordRows);
      setCategories(categoryRows);
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
      </Stack>
    </Box>
  );
}
