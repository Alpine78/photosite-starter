import { useRef, useState } from "react";
import { Text } from "@sanity/ui";
import { useClient, useCurrentLocale, useSyncState, useValidationStatus, type DocumentActionComponent, type Mutation } from "sanity";
import { STUDIO_VALIDATION_API_VERSION } from "../sanity/schemas/validation";
import { studioValidationMessage } from "./interface-locales";
import {
  commitKeywordPublication, INITIAL_KEYWORD_TAXONOMY_STATE, KEYWORD_PUBLISH_PARAMS, KEYWORD_PUBLISH_QUERY, keywordPublishCopy, keywordPublishReady,
  reviewKeywordPublication, type KeywordPublishPlan, type KeywordPublishReader,
} from "./keyword-publish";

/** Replaces native publish for keywords; the transaction lives in `keyword-publish.ts`. */
export const PublishKeywordAction: DocumentActionComponent = (props) => {
  const { id: locale } = useCurrentLocale(), copy = keywordPublishCopy(locale);
  const client = useClient({ apiVersion: STUDIO_VALIDATION_API_VERSION });
  const validation = useValidationStatus(props.draft?._id ?? props.id, props.type, true), sync = useSyncState(props.id, props.type);
  const [pending, setPending] = useState(false), [message, setMessage] = useState<string>();
  const [plan, setPlan] = useState<KeywordPublishPlan>();
  const busy = useRef(false);
  const ready = keywordPublishReady(props, validation, sync.isSyncing);
  const raw = client.withConfig({ perspective: "raw", useCdn: false });
  const reader: KeywordPublishReader = {
    ensureState: () => raw.createIfNotExists({ ...INITIAL_KEYWORD_TAXONOMY_STATE }, { visibility: "sync", tag: "keyword-publish" }),
    graph: () => client.withConfig({ perspective: "published", useCdn: false }).fetch(KEYWORD_PUBLISH_QUERY, { ...KEYWORD_PUBLISH_PARAMS }, { tag: "keyword-publish" }),
    docs: (ids, allVersions) => raw.request({ url: raw.getDataUrl("doc", ids.join(",")), json: true, tag: "keyword-publish",
      ...(allVersions ? { query: { includeAllVersions: "true" } } : {}) }),
  };
  async function commit(next: KeywordPublishPlan) {
    const outcome = await commitKeywordPublication(next, (mutations) => raw
      .mutate([...mutations] as unknown as Mutation[], { visibility: "sync", tag: "keyword-publish" }).then(() => undefined));
    setPlan(undefined);
    if (outcome === "published") props.onComplete();
    else setMessage(copy.outcomes[outcome]);
  }
  async function start() {
    busy.current = true; setPending(true); setMessage(undefined);
    try {
      const review = await reviewKeywordPublication(props.id, props.draft!._rev!, reader);
      if ("reason" in review) {
        setMessage(review.reason === "invalid" ? studioValidationMessage(review.message)[locale] ?? review.message : copy.outcomes[review.reason]);
      } else if (review.ready.effects.structural || review.ready.effects.retainedAliases.length > 0) setPlan(review.ready);
      else await commit(review.ready);
    } finally { busy.current = false; setPending(false); }
  }
  const effects = plan?.effects;
  return {
    label: pending ? copy.working : copy.action, tone: "primary", disabled: pending || !ready, title: ready ? undefined : copy.unavailable,
    onHandle: () => { if (!busy.current && ready) void start(); },
    dialog: plan && effects ? {
      type: "confirm", confirmButtonText: copy.publish, cancelButtonText: copy.cancel,
      message: <>
        {effects.structural ? <Text>{copy.structural}</Text> : null}
        {effects.retainedAliases.length > 0 ? <Text>{copy.retained} {effects.retainedAliases.join(", ")}</Text> : null}
      </>,
      onCancel: () => setPlan(undefined),
      onConfirm: () => {
        if (busy.current) return;
        busy.current = true; setPending(true);
        void commit(plan).finally(() => { busy.current = false; setPending(false); });
      },
    } : message ? {
      type: "dialog", header: copy.action, onClose: () => setMessage(undefined), content: <Text>{message}</Text>,
    } : undefined,
  };
};

/**
 * Decision 4 allows deleting only a never-published keyword. The native action runs
 * either way, so its hooks keep their order when a publication appears.
 */
export function neverPublishedOnly(action: DocumentActionComponent): DocumentActionComponent {
  const guarded: DocumentActionComponent = (props) => {
    const description = action(props);
    return props.published ? null : description;
  };
  guarded.action = action.action;
  return guarded;
}
