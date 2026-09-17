/**
 * Document-set checks that are genuinely generic — true of any Sanity document
 * set this repository writes, fixture or migration alike.
 *
 * Extracted from `sanity-seed-fixtures.mts` when AB#137's migration tooling
 * needed them. The rest of `validateSeedFixtures` stayed where it is on
 * purpose: it also asserts *demo-fixture coverage* ("at least one gallery with
 * both sections and a body"), which is a statement about the sample content and
 * would fire spuriously on a migration set that contains no galleries at all.
 * Sharing the primitives and leaving the fixture-coverage assertions
 * fixture-only is the split; adding switches to one validator for every caller's
 * assumptions is what it avoids.
 */

/** A Sanity reference's target id, or `undefined` when the value is not a reference. */
export function referencedId(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const ref = (value as { readonly _ref?: unknown })._ref;
  return typeof ref === "string" ? ref : undefined;
}

function isKeyedArray(value: unknown): value is readonly Readonly<Record<string, unknown>>[] {
  return Array.isArray(value) && value.every((item) => typeof item === "object" && item !== null);
}

/**
 * Every `_key` in every array-of-objects field, anywhere in one document's field
 * tree, is present, non-empty, and unique among its own array siblings. A
 * duplicate or missing key breaks the render-time React identity the key exists
 * to provide, and makes a later hand-edit in Studio unsafe.
 */
export function collectKeyViolations(path: string, value: unknown, violations: string[]): void {
  if (isKeyedArray(value)) {
    const seen = new Set<string>();
    for (const item of value) {
      const key = item._key;
      if (typeof key !== "string" || key.length === 0) {
        violations.push(`${path}: array item is missing a non-empty _key`);
      } else if (seen.has(key)) {
        violations.push(`${path}: duplicate _key "${key}"`);
      } else {
        seen.add(key);
      }
      for (const [field, fieldValue] of Object.entries(item)) {
        if (field === "_key") continue;
        collectKeyViolations(`${path}.${String(key)}.${field}`, fieldValue, violations);
      }
    }
    return;
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    for (const [field, fieldValue] of Object.entries(value)) {
      collectKeyViolations(`${path}.${field}`, fieldValue, violations);
    }
  }
}

/**
 * An ISO-8601 extended-format instant, structurally and calendrically real.
 *
 * `Date.parse` alone is too lenient — it silently normalizes `2026-02-31`
 * into March 3 rather than rejecting it — which the original version of this
 * function guarded against by requiring the input to round-trip byte-for-byte
 * through `Date.prototype.toISOString()`. That over-corrected: `toISOString()`
 * always emits exactly three fractional-second digits and a bare `Z`, so an
 * ordinary, entirely valid instant such as `2015-06-01T00:00:00Z` (no
 * fractional seconds) or one carrying a real numeric offset
 * (`2015-06-01T00:00:00+02:00`) failed the round trip and was rejected —
 * found in Codex review round 9, after this project's own seed and migration
 * tooling had only ever fed it its own canonical `.000Z` shape and never
 * noticed. This version parses the written fields directly and checks each
 * one for realness (no day/month roll-over) independently of which of the
 * format's several valid spellings was used.
 */
const ISO_DATETIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/u;

export function isRealCalendarDateTime(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match = ISO_DATETIME_PATTERN.exec(value);
  if (match === null) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);

  // Hour/minute/second/offset are fixed-range fields (each already exactly
  // two digits from the regex), so their validity is a plain bounds check,
  // never a calendar computation. Deliberately independent of the fractional
  // second: an earlier version folded the fraction into a `Date.UTC(...,
  // milliseconds)` call to reuse a single round trip for everything, but
  // `Math.round`ing a fraction like `.9999` up to a full 1000ms carries into
  // the *next* second, so `Date.UTC` correctly returned the moment one second
  // later — and the comparison then wrongly rejected the written second as
  // not matching (found in Codex review round 12). The fraction plays no
  // part in calendar or range validity at all, so it is not extracted here.
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (offsetText !== "Z") {
    const offsetHour = Number(offsetText!.slice(1, 3));
    const offsetMinute = Number(offsetText!.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }

  // Only the calendar date (year/month/day) needs `Date.UTC`'s own round
  // trip — that is where a *real* invalid date (`2026-02-31`) actually lives.
  // Time-of-day fields are deliberately excluded from this construction so a
  // fractional-second rollover can never perturb it.
  const utcMillis = Date.UTC(year, month - 1, day);
  if (Number.isNaN(utcMillis)) return false;
  const recomputed = new Date(utcMillis);
  return (
    recomputed.getUTCFullYear() === year &&
    recomputed.getUTCMonth() === month - 1 &&
    recomputed.getUTCDate() === day
  );
}

/** A calendar *date* (`YYYY-MM-DD`), checked the same non-lenient way. */
export function isRealCalendarDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  return isRealCalendarDateTime(`${value}T00:00:00.000Z`);
}

/**
 * Canonicalizes any ISO-8601 instant `isRealCalendarDateTime` accepts into
 * the exact shape `src/lib/sanity-article.ts#isValidIsoDate` — the real,
 * already-shipped adapter that reads a Sanity document's own datetime
 * fields — requires: UTC `Z`, exactly three fractional digits. Returns
 * `undefined` for anything `isRealCalendarDateTime` itself would reject.
 *
 * `isRealCalendarDateTime` deliberately accepts a *wider* range of equally
 * real ISO spellings than that reader does — a numeric offset, no fractional
 * seconds, six-digit precision — because its own job is "is this a real
 * calendar instant," not "is this exactly the one spelling a particular
 * downstream reader expects." But a value copied verbatim into a *planned
 * Sanity document* (`joomla-import-manifest.mts`'s `ApprovedArticle.
 * publishedAt`/`eventDate`) has to be something that reader will actually
 * accept, not merely something this tool is willing to read — found in
 * Codex review round 11: an accepted-but-non-canonical value (an offset, or
 * `.5` fractional seconds) validated cleanly through this module and would
 * then have been rejected by the production adapter after the write,
 * throwing on every future render of the migrated page.
 *
 * The offset arithmetic itself is not hand-rolled: once a value is already
 * known to be a real calendar instant, `new Date(value).toISOString()`
 * resolves a numeric offset to its correct absolute UTC moment on its own —
 * confirmed directly (`2015-06-01T02:00:00+02:00` → `2015-06-01T00:00:00.000Z`)
 * — and always emits exactly three fractional digits and a bare `Z`.
 */
export function canonicalCalendarDateTime(value: unknown): string | undefined {
  if (!isRealCalendarDateTime(value)) return undefined;
  return new Date(value as string).toISOString();
}

/** Reports every `_id` claimed by more than one document in the set. */
export function collectDuplicateIds(
  documents: readonly { readonly _id: string }[],
): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const document of documents) {
    if (seen.has(document._id)) duplicates.add(document._id);
    seen.add(document._id);
  }
  return [...duplicates].sort();
}
