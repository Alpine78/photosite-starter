/**
 * AB#172: decisions for moving an imported Joomla intro text out of a story's
 * body and into its listing-only `summary`. Pure — `write-joomla-intro-summary.mts`
 * performs the reads and the write.
 *
 * The legacy importer placed each Joomla article's intro text as the first
 * body paragraph. Joomla hid that intro on the article page and showed it only
 * in listings, and the full text that follows usually restates it, so the
 * migrated page opens with the same paragraph twice while its listing card
 * has no excerpt. The owner decided (2026-09-26) that the intro is a
 * listing-only excerpt: it becomes `summary` with `summaryListingOnly: true`,
 * and leaves the body.
 *
 * A page is changed only when that shape is unambiguous: a published article
 * or gallery with no summary and no flag, whose body is a plain paragraph
 * followed by at least one more block. Everything else is reported with a
 * reason and left alone — including a page whose single paragraph is the
 * whole text, and a page whose summary or flag holds a malformed value.
 */

import { createHash } from "node:crypto";

import type { SeedMutation } from "./sanity-seed-http.mts";

export const INTRO_SUMMARY_PLANNER_VERSION = "joomla-intro-summary-v1";
export const INTRO_SUMMARY_DOCUMENT_TYPES = ["article", "gallery"] as const;
export const PARAGRAPH_BLOCK_TYPE = "contentParagraphBlock";

/** The exact fields a movable intro paragraph may carry — nothing else to lose. */
const PARAGRAPH_FIELDS = new Set(["_key", "_type", "text"]);

export type IntroSummaryTarget = {
  readonly projectId: string;
  readonly dataset: string;
};

/** One document as the raw or published perspective returns it. */
export type IntroSummarySourceDocument = {
  readonly _id: string;
  readonly _rev: string;
  readonly _type: string;
  readonly contentId?: unknown;
  readonly language?: unknown;
  readonly summary?: unknown;
  readonly summaryListingOnly?: unknown;
  readonly body?: unknown;
};

export type IntroSummaryChange = {
  readonly documentId: string;
  /** The published revision the approval covers; the write is guarded by it. */
  readonly rev: string;
  readonly type: string;
  readonly contentId: string;
  readonly language: string;
  /** The new `summary`: the intro paragraph's text, trimmed. */
  readonly summary: string;
  /**
   * The complete body before the change, for rollback and read-back. The
   * intro paragraph is `originalBody[0]`; the expected body afterwards is
   * `originalBody.slice(1)`. Before the change `summary` and
   * `summaryListingOnly` were both absent — the only state a change is
   * planned from.
   */
  readonly originalBody: readonly unknown[];
};

export type IntroSummaryExclusion = {
  readonly documentId: string;
  readonly contentId: string;
  readonly language: string;
  readonly reason: string;
};

export type IntroSummaryPlan = {
  readonly version: typeof INTRO_SUMMARY_PLANNER_VERSION;
  readonly target: IntroSummaryTarget;
  /** Sorted by `documentId`. */
  readonly changes: readonly IntroSummaryChange[];
  readonly mutations: readonly SeedMutation[];
  /** Sorted by `documentId`. Not part of the digest: nothing is written for them. */
  readonly excluded: readonly IntroSummaryExclusion[];
  /** SHA-256 over version, target, changes and mutations, in canonical JSON. */
  readonly digest: string;
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Published ids only: a draft (`drafts.`) or release version (`versions.`) contains a dot. */
export function isPublishedId(id: string): boolean {
  return !id.includes(".");
}

/**
 * The id of the published document a draft or release version belongs to,
 * or `undefined` for a published id.
 */
export function publishedIdOfVersion(id: string): string | undefined {
  if (id.startsWith("drafts.")) return id.slice("drafts.".length);
  if (id.startsWith("versions.")) {
    const rest = id.slice("versions.".length);
    const dot = rest.indexOf(".");
    return dot < 0 ? undefined : rest.slice(dot + 1);
  }
  return undefined;
}

/** JSON with object keys sorted at every depth, so a digest cannot depend on the order a response happened to use. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function exclusionReason(document: IntroSummarySourceDocument): string | undefined {
  if (!(INTRO_SUMMARY_DOCUMENT_TYPES as readonly string[]).includes(document._type)) {
    return `not an article or gallery (${document._type})`;
  }
  if (typeof document.contentId !== "string" || typeof document.language !== "string") {
    return "no usable contentId or language";
  }
  if (document.summary != null) {
    if (typeof document.summary !== "string") return "malformed summary (not a string)";
    return document.summary.trim().length === 0
      ? "malformed summary (blank string)"
      : "already has a summary";
  }
  if (document.summaryListingOnly != null) return "already carries the listing-only flag";
  if (!Array.isArray(document.body) || document.body.length === 0) return "no body";
  if (document.body.length === 1) {
    return "the body is a single block, so it is the whole text rather than an intro";
  }
  const first: unknown = document.body[0];
  if (!isRecord(first) || first._type !== PARAGRAPH_BLOCK_TYPE) {
    return "the body does not start with a paragraph";
  }
  if (Object.keys(first).some((key) => !PARAGRAPH_FIELDS.has(key))) {
    return "the first paragraph carries fields beyond _key, _type and text";
  }
  if (typeof first.text !== "string" || first.text.trim().length === 0) {
    return "the first paragraph has no text";
  }
  return undefined;
}

export function introSummaryMutation(change: IntroSummaryChange): SeedMutation {
  return {
    patch: {
      id: change.documentId,
      // A revision guard pins both the approved content and the paragraph's
      // position, so removing by index cannot hit a different block.
      ifRevisionID: change.rev,
      set: { summary: change.summary, summaryListingOnly: true },
      unset: ["body[0]"],
    },
  };
}

function digestOf(
  target: IntroSummaryTarget,
  changes: readonly IntroSummaryChange[],
  mutations: readonly SeedMutation[],
): string {
  return createHash("sha256")
    .update(canonicalJson({ version: INTRO_SUMMARY_PLANNER_VERSION, target, changes, mutations }))
    .digest("hex");
}

/**
 * Plans the correction from the published documents. Draft and release
 * versions in the input are ignored here; `findVersionConflicts` reports them.
 */
export function planIntroSummaries(
  documents: readonly IntroSummarySourceDocument[],
  target: IntroSummaryTarget,
): IntroSummaryPlan {
  const changes: IntroSummaryChange[] = [];
  const excluded: IntroSummaryExclusion[] = [];
  for (const document of documents) {
    if (!isPublishedId(document._id)) continue;
    const contentId = typeof document.contentId === "string" ? document.contentId : "";
    const language = typeof document.language === "string" ? document.language : "";
    const reason = exclusionReason(document);
    if (reason !== undefined) {
      excluded.push({ documentId: document._id, contentId, language, reason });
      continue;
    }
    const body = document.body as readonly unknown[];
    const first = body[0] as { readonly text: string };
    changes.push({
      documentId: document._id,
      rev: document._rev,
      type: document._type,
      contentId,
      language,
      summary: first.text.trim(),
      originalBody: body,
    });
  }
  const byId = (a: { documentId: string }, b: { documentId: string }) =>
    a.documentId < b.documentId ? -1 : a.documentId > b.documentId ? 1 : 0;
  changes.sort(byId);
  excluded.sort(byId);
  const mutations = changes.map(introSummaryMutation);
  return {
    version: INTRO_SUMMARY_PLANNER_VERSION,
    target: { projectId: target.projectId, dataset: target.dataset },
    changes,
    mutations,
    excluded,
    digest: digestOf(target, changes, mutations),
  };
}

/** Recomputes a stored plan's digest from its own content, never trusting its `digest` field. */
export function recomputeIntroSummaryDigest(plan: IntroSummaryPlan): string {
  return digestOf(plan.target, plan.changes, plan.mutations);
}

/**
 * Draft or release versions of a planned document. A write would leave them
 * holding the old body, and publishing one later would silently undo the
 * correction, so any of these refuses the run.
 */
export function findVersionConflicts(
  plan: IntroSummaryPlan,
  documentIds: readonly string[],
): readonly string[] {
  const planned = new Set(plan.changes.map((change) => change.documentId));
  return documentIds
    .filter((id) => {
      const published = publishedIdOfVersion(id);
      return published !== undefined && planned.has(published);
    })
    .sort();
}

export type IntroSummaryReconciliation = {
  /** Written exactly as planned. */
  readonly applied: readonly string[];
  /** Still at the approved revision, untouched. */
  readonly pending: readonly string[];
  /** Neither — changed by something else, or missing. */
  readonly unexpected: readonly { readonly documentId: string; readonly reason: string }[];
};

/**
 * Classifies each planned document against its current published state. Run
 * after every write attempt, successful or not: a timed-out transaction may or
 * may not have committed, and only the documents themselves can say which.
 */
export function reconcileIntroSummaries(
  plan: IntroSummaryPlan,
  current: readonly IntroSummarySourceDocument[],
): IntroSummaryReconciliation {
  const byId = new Map(current.filter((d) => isPublishedId(d._id)).map((d) => [d._id, d]));
  const applied: string[] = [];
  const pending: string[] = [];
  const unexpected: { documentId: string; reason: string }[] = [];
  for (const change of plan.changes) {
    const document = byId.get(change.documentId);
    if (document === undefined) {
      unexpected.push({ documentId: change.documentId, reason: "the document no longer exists" });
    } else if (document._rev === change.rev) {
      pending.push(change.documentId);
    } else if (
      document.summary === change.summary &&
      document.summaryListingOnly === true &&
      canonicalJson(document.body) === canonicalJson(change.originalBody.slice(1))
    ) {
      applied.push(change.documentId);
    } else {
      unexpected.push({
        documentId: change.documentId,
        reason: "the document changed since approval and does not match the planned result",
      });
    }
  }
  return { applied, pending, unexpected };
}
