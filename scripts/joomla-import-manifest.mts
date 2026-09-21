/**
 * AB#137's approval gate: the owner's launch manifest, parsed and validated.
 *
 * Pure and offline — it is handed the manifest's text, never a path, so nothing
 * here can reach the owner's private migration directory and a test can cover
 * every approval state from a string literal.
 *
 * ## Why approval is a gate and not a flag
 *
 * A published flag in the old CMS is only a candidate signal. The source also
 * holds private galleries, abandoned drafts, and content the new site's body
 * blocks cannot represent. `docs/sanity-seeding.md` therefore requires an
 * owner-reviewed manifest of individual public items keyed by stable source
 * identity, and this module refuses to treat anything else as approved. A row
 * that is merely `INCLUDE`, or `INCLUDE` but not yet `eligible_for_import`, is
 * **deferred** — reported with its reason, never an error. A row that claims
 * approval while missing the approver, the date, or the digest is an **error**,
 * because a malformed approval record must not read as a deferral and quietly
 * disappear from the launch.
 *
 * ## Why an acknowledgement is bound to a digest
 *
 * A conversion can lose a link's destination while keeping its words (see
 * `joomla-html-conversion.mts`). An owner may accept that, but the acceptance
 * has to name *what* was accepted: the manifest carries the SHA-256 of the
 * source body the approval was given against and the conversion policy version
 * in force at the time. Re-editing the source article, or changing a conversion
 * rule, invalidates the acknowledgement instead of silently inheriting it.
 *
 * ## Phases
 *
 * The owner's 2026-09-15 "Lever B" decision allows the launch manifest to be a
 * first phase, with the rest migrating later under the same approval, baseline,
 * audit, and credential-revocation boundary. Every approved row therefore names
 * its phase explicitly; selecting a phase defers the others rather than
 * silently widening the write.
 */

import { createHash } from "node:crypto";

import { canonicalCalendarDateTime, isRealCalendarDate, isRealCalendarDateTime } from "./sanity-document-checks.mts";
import { CONVERSION_POLICY_VERSION, type ConversionFindingCode } from "./joomla-html-conversion.mts";

/** Column set of the approval manifest. Documented in `docs/sanity-seeding.md`. */
export const MANIFEST_COLUMNS = [
  "joomla_id",
  "language",
  "content_id",
  "slug",
  "canonical_category",
  "secondary_categories",
  "phase",
  "published_at",
  "event_date",
  "source_digest",
  "resolved_digest",
  "conversion_policy",
  "acknowledged_findings",
  "public_launch_decision",
  "eligible_for_import",
  "approved_by",
  "approved_at",
] as const;

export type ManifestColumn = (typeof MANIFEST_COLUMNS)[number];

/** The worksheet the owner maintains is semicolon-delimited; so is the manifest. */
const DELIMITER = ";";

/** Matches this project's own identity rule for a public, root-level, dot-free id segment. */
export const IDENTITY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Explicit manifest token for a canonical route directly beneath the story namespace. */
export const STORY_ROOT_CANONICAL_PLACEMENT = "@story-root";
const LANGUAGE_PATTERN = /^[a-z]{2,3}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export type ApprovedArticle = {
  readonly sourceId: string;
  /** Normalized subtag (`fi-FI` → `fi`), matching `article.language`. */
  readonly language: string;
  /** Shared across a page's languages; with `language` it is the article's whole identity. */
  readonly contentId: string;
  readonly slug: string;
  readonly canonicalAtStoryRoot: boolean;
  readonly canonicalCategory: string | null;
  readonly secondaryCategories: readonly string[];
  readonly phase: string;
  readonly publishedAt: string;
  readonly eventDate?: string;
  /**
   * SHA-256 over the *whole* imported source record — title, summary, author,
   * tags, and body — not only the body. Binding it to the body alone (an
   * earlier draft did) would let an edited title or author slip through
   * unreviewed while the HTML stayed byte-identical (found in Codex review
   * round 4).
   */
  readonly sourceDigest: string;
  /**
   * SHA-256 over the *resolved conversion output* (`resolvedConversionDigest`
   * in `joomla-html-conversion.mts`) — the actual photographs, gallery order,
   * alt text, and video titles the approval covers. `sourceDigest` alone
   * cannot see a change to the resolution file itself (found in Codex review
   * round 6).
   */
  readonly resolvedDigest: string;
  readonly conversionPolicy: string;
  readonly acknowledgedFindings: readonly ConversionFindingCode[];
  readonly approvedBy: string;
  readonly approvedAt: string;
};

export type DeferredArticle = {
  readonly sourceId: string;
  readonly language: string;
  readonly reason: string;
};

export type ManifestReview = {
  /** Approved rows in the selected phase, ready for conversion and planning. */
  readonly approved: readonly ApprovedArticle[];
  /** Not in this write: another phase, not yet eligible, or deliberately excluded. */
  readonly deferred: readonly DeferredArticle[];
  /** A malformed or conflicting record. Any error means the manifest is not usable. */
  readonly errors: readonly string[];
  /** Non-secret digest of the manifest text, for recording the approval on the work item. */
  readonly digest: string;
  readonly phase: string;
  /** Every phase named anywhere in the manifest, so a typo in `--phase` is visible. */
  readonly knownPhases: readonly string[];
};

function splitRow(line: string): readonly string[] {
  return line.split(DELIMITER).map((cell) => cell.trim());
}

/** `fi-FI` → `fi`. The manifest may carry either form; `article.language` takes the subtag. */
export function normalizeLanguage(value: string): string {
  return value.trim().toLowerCase().split(/[-_]/u)[0] ?? "";
}

function parseAcknowledgedFindings(value: string): readonly ConversionFindingCode[] {
  return value
    .split(/[\s,]+/u)
    .map((code) => code.trim())
    .filter((code) => code.length > 0) as readonly ConversionFindingCode[];
}

/**
 * Parses and validates the manifest for one phase.
 *
 * Never throws on bad input: a malformed row becomes an error in the result, so
 * one bad line reports alongside every other problem rather than hiding them
 * behind the first exception.
 */
export function reviewImportManifest(
  manifestText: string,
  options: { readonly phase: string },
): ManifestReview {
  const digest = createHash("sha256").update(manifestText, "utf8").digest("hex");
  const errors: string[] = [];
  const approved: ApprovedArticle[] = [];
  const deferred: DeferredArticle[] = [];
  const knownPhases = new Set<string>();

  const lines = manifestText
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0 && !line.trimStart().startsWith("#"));

  if (lines.length === 0) {
    return { approved, deferred, errors: ["The manifest is empty."], digest, phase: options.phase, knownPhases: [] };
  }

  const header = splitRow(lines[0] ?? "");
  const missing = MANIFEST_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    errors.push(`The manifest header is missing required columns: ${missing.join(", ")}.`);
    return { approved, deferred, errors, digest, phase: options.phase, knownPhases: [] };
  }
  const indexOf = (column: ManifestColumn): number => header.indexOf(column);

  // Identity collision tracking. A source id may legitimately appear once per
  // language; `contentId` + `language` is the article's own identity, and a
  // route is `(language, canonicalCategory, slug)`.
  const seenSourceRows = new Set<string>();
  const seenIdentities = new Map<string, string>();
  const seenRoutes = new Map<string, string>();
  const contentIdLanguages = new Map<string, Set<string>>();

  for (const [offset, line] of lines.slice(1).entries()) {
    const lineNumber = offset + 2;
    const cells = splitRow(line);
    const cell = (column: ManifestColumn): string => cells[indexOf(column)] ?? "";

    const sourceId = cell("joomla_id");
    const rawLanguage = cell("language");
    const language = normalizeLanguage(rawLanguage);
    const where = `row ${lineNumber} (source ${sourceId || "?"}, language ${rawLanguage || "?"})`;

    if (sourceId.length === 0 || language.length === 0) {
      errors.push(`${where}: joomla_id and language are both required.`);
      continue;
    }
    if (!LANGUAGE_PATTERN.test(language)) {
      errors.push(`${where}: "${rawLanguage}" is not a language subtag.`);
      continue;
    }
    const rowKey = `${sourceId}:${language}`;
    if (seenSourceRows.has(rowKey)) {
      errors.push(`${where}: this source article already has a row for this language.`);
      continue;
    }
    seenSourceRows.add(rowKey);

    const phase = cell("phase");
    if (phase.length > 0) knownPhases.add(phase);

    const decisionRaw = cell("public_launch_decision");
    const decision = decisionRaw.toUpperCase();
    const eligibleRaw = cell("eligible_for_import");
    const eligible = eligibleRaw.toUpperCase();

    const KNOWN_DECISIONS = new Set(["", "INCLUDE", "LATER", "EXCLUDE"]);
    const KNOWN_ELIGIBILITY = new Set(["", "YES", "NO"]);
    if (!KNOWN_DECISIONS.has(decision)) {
      errors.push(`${where}: public_launch_decision "${decisionRaw}" is none of INCLUDE, LATER, or EXCLUDE.`);
      continue;
    }
    if (!KNOWN_ELIGIBILITY.has(eligible)) {
      errors.push(`${where}: eligible_for_import "${eligibleRaw}" is neither YES nor NO.`);
      continue;
    }

    if (decision !== "INCLUDE") {
      deferred.push({
        sourceId,
        language,
        reason:
          decision.length === 0
            ? "no launch decision recorded yet"
            : `deliberately ${decision.toLowerCase()}d from the launch`,
      });
      continue;
    }
    if (eligible !== "YES") {
      // Selected for launch, but its editorial and media checks are not done.
      // This is the normal pre-approval state, not a defect.
      deferred.push({ sourceId, language, reason: "selected but not yet eligible for import" });
      continue;
    }

    // From here the row *claims* approval, so anything missing is an error.
    const approvedBy = cell("approved_by");
    const approvedAt = cell("approved_at");
    const sourceDigest = cell("source_digest").toLowerCase();
    const resolvedDigest = cell("resolved_digest").toLowerCase();
    const conversionPolicy = cell("conversion_policy");
    const contentId = cell("content_id");
    const slug = cell("slug");
    const canonicalCategoryCell = cell("canonical_category");
    const canonicalAtStoryRoot = canonicalCategoryCell === STORY_ROOT_CANONICAL_PLACEMENT;
    const canonicalCategory = canonicalAtStoryRoot ? null : canonicalCategoryCell;
    const publishedAt = cell("published_at");
    const eventDate = cell("event_date");

    const rowErrors: string[] = [];
    if (phase.length === 0) rowErrors.push("no phase named");
    if (approvedBy.length === 0) rowErrors.push("no approver recorded");
    if (!isRealCalendarDate(approvedAt)) rowErrors.push(`approved_at "${approvedAt}" is not a real YYYY-MM-DD date`);
    if (!DIGEST_PATTERN.test(sourceDigest)) rowErrors.push("source_digest is not a 64-character SHA-256 hex digest");
    if (!DIGEST_PATTERN.test(resolvedDigest)) rowErrors.push("resolved_digest is not a 64-character SHA-256 hex digest");
    if (conversionPolicy.length === 0) rowErrors.push("no conversion_policy recorded");
    if (!IDENTITY_PATTERN.test(contentId)) rowErrors.push(`content_id "${contentId}" is not a valid identity`);
    if (!IDENTITY_PATTERN.test(slug)) rowErrors.push(`slug "${slug}" is not a valid slug`);
    if (!canonicalAtStoryRoot && !IDENTITY_PATTERN.test(canonicalCategoryCell)) {
      rowErrors.push(
        `canonical_category "${canonicalCategoryCell}" is not a valid category identity or ${STORY_ROOT_CANONICAL_PLACEMENT}`,
      );
    }
    if (!isRealCalendarDateTime(publishedAt)) {
      rowErrors.push(`published_at "${publishedAt}" is not a real ISO instant`);
    }
    if (eventDate.length > 0 && !isRealCalendarDateTime(eventDate)) {
      rowErrors.push(`event_date "${eventDate}" is not a real ISO instant`);
    }

    const secondaryCategories = cell("secondary_categories")
      .split(/[\s,]+/u)
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    const seenSecondaryCategories = new Set<string>();
    for (const category of secondaryCategories) {
      if (!IDENTITY_PATTERN.test(category)) rowErrors.push(`secondary category "${category}" is not a valid identity`);
      if (canonicalCategory !== null && category === canonicalCategory) {
        rowErrors.push(`"${category}" is both the canonical and a secondary category`);
      }
      // `sanity/schemas/article.ts` rejects a repeated secondary category at
      // publish time; a plan built from a duplicate would fail there instead
      // of here (found in Codex review round 2).
      if (seenSecondaryCategories.has(category)) {
        rowErrors.push(`"${category}" is listed as a secondary category more than once`);
      }
      seenSecondaryCategories.add(category);
    }

    if (rowErrors.length > 0) {
      errors.push(`${where}: claims approval but ${rowErrors.join("; ")}.`);
      continue;
    }

    // Identity and route collisions are errors regardless of phase: a later
    // phase colliding with this one would only surface at write time.
    const identityKey = `${contentId}:${language}`;
    const identityOwner = seenIdentities.get(identityKey);
    if (identityOwner !== undefined) {
      errors.push(`${where}: content_id "${contentId}" in ${language} is already claimed by source ${identityOwner}.`);
      continue;
    }
    seenIdentities.set(identityKey, sourceId);

    const routeOwnerLabel = canonicalAtStoryRoot ? STORY_ROOT_CANONICAL_PLACEMENT : canonicalCategory;
    const routeKey = `${language}:${routeOwnerLabel}:${slug}`;
    const routeOwner = seenRoutes.get(routeKey);
    if (routeOwner !== undefined) {
      errors.push(
        `${where}: the route ${routeOwnerLabel}/${slug} in ${language} is already claimed by source ${routeOwner}.`,
      );
      continue;
    }
    seenRoutes.set(routeKey, sourceId);

    const languages = contentIdLanguages.get(contentId) ?? new Set<string>();
    languages.add(language);
    contentIdLanguages.set(contentId, languages);

    if (phase !== options.phase) {
      deferred.push({ sourceId, language, reason: `approved for a later phase ("${phase}")` });
      continue;
    }

    // Canonicalized to the exact shape `src/lib/sanity-article.ts#isValidIsoDate`
    // (the real, already-shipped adapter) requires — UTC `Z`, exactly three
    // fractional digits — rather than kept in whatever equally-valid ISO
    // spelling the manifest happened to use. `isRealCalendarDateTime` above
    // already accepted a wider range (an offset, no fractional seconds) for
    // the manifest's own "is this real" question; a value carried verbatim
    // into a planned Sanity document has to be something the production
    // reader will actually accept, not merely something this tool reads
    // (found in Codex review round 11 — an accepted-but-non-canonical value
    // would have validated cleanly here and been rejected by that adapter
    // after the write). Both calls are infallible at this point: `rowErrors`
    // above already required `isRealCalendarDateTime` to hold for each.
    const canonicalPublishedAt = canonicalCalendarDateTime(publishedAt)!;
    const canonicalEventDate = eventDate.length > 0 ? canonicalCalendarDateTime(eventDate)! : undefined;

    approved.push({
      sourceId,
      language,
      contentId,
      slug,
      canonicalAtStoryRoot,
      canonicalCategory,
      secondaryCategories,
      phase,
      publishedAt: canonicalPublishedAt,
      ...(canonicalEventDate === undefined ? {} : { eventDate: canonicalEventDate }),
      sourceDigest,
      resolvedDigest,
      conversionPolicy,
      acknowledgedFindings: parseAcknowledgedFindings(cell("acknowledged_findings")),
      approvedBy,
      approvedAt,
    });
  }

  if (errors.length === 0 && approved.length === 0) {
    // An empty phase is not "launch-ready with nothing to do": naming a phase
    // that matches no approved row is almost always a typo, and reporting it as
    // a clean run would produce an audit record of a write that never happened.
    errors.push(
      `No approved row names the phase "${options.phase}". Known phases: ${
        [...knownPhases].sort().join(", ") || "(none)"
      }.`,
    );
  }

  return {
    approved,
    deferred,
    errors,
    digest,
    phase: options.phase,
    knownPhases: [...knownPhases].sort(),
  };
}

/**
 * Decides whether one converted article may enter the import plan, given its
 * approval row.
 *
 * A refusal always blocks. A lossy finding blocks unless the row acknowledges
 * that exact code *and* the acknowledgement is still valid — same source
 * record, same resolved output, same conversion policy. This is the whole
 * point of binding all three: an approval given for one version of an article
 * is not an approval of a later edit of it. "The source record" deliberately
 * means every imported field (title, summary, author, tags, body), not only
 * the HTML body: an edited title or author with a byte-identical body must
 * not slip through as still-approved (found in Codex review round 4). "The
 * resolved output" catches the complementary gap: `resolution.json` can
 * change — a different photograph, a different alt text, a reordered
 * gallery, a changed video title — without the source article itself
 * changing at all, and the source digest alone cannot see that (found in
 * Codex review round 6).
 */
export function assessApprovedConversion(input: {
  readonly approval: ApprovedArticle;
  readonly sourceDigest: string;
  /** `resolvedConversionDigest` of the actual conversion result — see its own doc comment. */
  readonly resolvedDigest: string;
  readonly findings: readonly { readonly severity: "refusal" | "lossy"; readonly code: ConversionFindingCode }[];
}): readonly string[] {
  const blockers: string[] = [];

  if (input.approval.sourceDigest !== input.sourceDigest.toLowerCase()) {
    blockers.push(
      "the source article has changed since it was approved (source digest mismatch); re-review and re-approve it",
    );
  }
  if (input.approval.resolvedDigest !== input.resolvedDigest.toLowerCase()) {
    blockers.push(
      "the resolved photographs, gallery order, alt text, or video titles have changed since approval (resolved digest mismatch); re-review and re-approve it",
    );
  }
  if (input.approval.conversionPolicy !== CONVERSION_POLICY_VERSION) {
    blockers.push(
      `the approval was given under conversion policy "${input.approval.conversionPolicy}" but this run uses "${CONVERSION_POLICY_VERSION}"; re-review the conversion`,
    );
  }

  const refusals = [...new Set(input.findings.filter((f) => f.severity === "refusal").map((f) => f.code))].sort();
  for (const code of refusals) {
    blockers.push(`unresolved refusal "${code}"`);
  }

  const acknowledged = new Set(input.approval.acknowledgedFindings);
  const lossy = [...new Set(input.findings.filter((f) => f.severity === "lossy").map((f) => f.code))].sort();
  for (const code of lossy) {
    if (!acknowledged.has(code)) {
      blockers.push(`unacknowledged lossy conversion "${code}"`);
    }
  }

  return blockers;
}
