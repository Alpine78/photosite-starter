/**
 * Permanent path history for the public content tree.
 *
 * ADR-0003 decision 7: every previously published path redirects permanently and
 * *directly* to the current same-language canonical URL, and stays reserved so
 * it cannot later be reassigned to unrelated content. The authoring integration
 * records the previous path against stable category or content identity; this
 * module validates that history against the current tree and hands the route
 * layer a flat lookup.
 *
 * Flat is the point. History is recorded per identity, so a path that changed
 * A → B → C produces two entries that both resolve to C, and a request never
 * traverses a chain. Chains and loops are impossible by construction rather than
 * by a separate check: a value is always a live canonical path, a key is never
 * one, so no value can also be a key.
 *
 * This is one redirect source. ADR-0003 combines it with locale-route migrations
 * and the deployment's legacy mapping (AB#19) into one registry; those sources
 * bring their own validation and are not modelled here.
 */

import {
  getCanonicalContentPath,
  getCategoryPath,
  type ContentTree,
} from "@/lib/content-tree";

/** Canonical path segments are lowercase with hyphens between words. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type ContentRedirectInput = {
  readonly kind: "category" | "content";
  /** `categoryId` or `contentId`: identity is what survives a move or rename. */
  readonly id: string;
  /** A previously published path, relative to the story namespace. */
  readonly previousPath: readonly string[];
};

export type ContentRedirectIssueCode =
  | "empty-previous-path"
  | "invalid-previous-path"
  | "live-path-reused"
  | "conflicting-previous-path";

export type ContentRedirectIssue = {
  readonly code: ContentRedirectIssueCode;
  /** The identity the issue is reported against. */
  readonly subject: string;
  readonly message: string;
};

export class ContentRedirectValidationError extends Error {
  readonly issues: readonly ContentRedirectIssue[];

  constructor(issues: readonly ContentRedirectIssue[]) {
    super(
      `invalid public content redirects: ${issues
        .map((issue) => `${issue.subject}: ${issue.message}`)
        .join("; ")}`,
    );
    this.name = "ContentRedirectValidationError";
    this.issues = issues;
  }
}

/** Previous path to current canonical path, both relative to the namespace. */
export type ContentRedirects = ReadonlyMap<string, readonly string[]>;

const toKey = (segments: readonly string[]) => segments.join("/");

/**
 * Where an identity lives now, or `null` when it no longer has a public home.
 *
 * A category that was hidden or content that left publication keeps no
 * redirect: ADR-0003 decision 7 answers those with a 404 rather than inventing
 * a successor the data does not name.
 */
function currentPath(
  tree: ContentTree,
  entry: ContentRedirectInput,
): readonly string[] | null {
  if (entry.kind === "content") {
    return getCanonicalContentPath(tree, entry.id);
  }
  if (!tree.publicCategoryIds.has(entry.id)) return null;
  const path = getCategoryPath(tree, entry.id);
  return path.length === 0 ? null : path;
}

/** Every path the current tree serves, which history may never claim. */
function livePaths(tree: ContentTree): ReadonlySet<string> {
  const paths = new Set<string>();

  for (const categoryId of tree.publicCategoryIds) {
    paths.add(toKey(getCategoryPath(tree, categoryId)));
  }
  for (const contentId of tree.placements.keys()) {
    const path = getCanonicalContentPath(tree, contentId);
    if (path !== null) paths.add(toKey(path));
  }

  return paths;
}

function compareIssues(a: ContentRedirectIssue, b: ContentRedirectIssue) {
  if (a.subject !== b.subject) return a.subject < b.subject ? -1 : 1;
  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
}

/**
 * Validates recorded history against one locale's current tree.
 *
 * Both snapshots are the same language throughout: a redirect never infers a
 * change of language, so Finnish history resolves to Finnish canonical paths and
 * nothing else.
 */
export function buildContentRedirects(
  tree: ContentTree,
  entries: readonly ContentRedirectInput[],
): ContentRedirects {
  const issues: ContentRedirectIssue[] = [];
  const live = livePaths(tree);
  const redirects = new Map<string, readonly string[]>();

  const fail = (
    code: ContentRedirectIssueCode,
    subject: string,
    message: string,
  ) => issues.push({ code, subject, message });

  for (const entry of entries) {
    if (entry.previousPath.length === 0) {
      fail(
        "empty-previous-path",
        entry.id,
        "a previous path must have at least one segment; the story root cannot move",
      );
      continue;
    }
    if (!entry.previousPath.every((segment) => SLUG_PATTERN.test(segment))) {
      fail(
        "invalid-previous-path",
        entry.id,
        `previous path "${toKey(entry.previousPath)}" must be lowercase segments with hyphens between words`,
      );
      continue;
    }

    const target = currentPath(tree, entry);
    if (target === null) continue;

    const key = toKey(entry.previousPath);
    if (key === toKey(target)) continue;

    if (live.has(key)) {
      fail(
        "live-path-reused",
        entry.id,
        `previous path "${key}" is served by the current tree and cannot redirect`,
      );
      continue;
    }

    const existing = redirects.get(key);
    if (existing !== undefined) {
      if (toKey(existing) !== toKey(target)) {
        fail(
          "conflicting-previous-path",
          entry.id,
          `previous path "${key}" is already recorded against "${toKey(existing)}"`,
        );
      }
      continue;
    }

    redirects.set(key, target);
  }

  if (issues.length > 0) {
    throw new ContentRedirectValidationError(issues.sort(compareIssues));
  }
  return redirects;
}

/**
 * The current canonical path for a previously published one, or `null` when the
 * path has no recorded history. Segments are relative to the story namespace and
 * already normalized to canonical casing by the route resolver.
 */
export function resolveContentRedirect(
  redirects: ContentRedirects | undefined,
  segments: readonly string[],
): readonly string[] | null {
  if (redirects === undefined || segments.length === 0) return null;
  return redirects.get(toKey(segments)) ?? null;
}
