/**
 * Pure orchestration and coverage-accounting helpers for
 * `sanity-adapter-smoke-verification.test.ts` (AB#137). Kept in a separate,
 * non-test module for the same reason `sanity-live-verification-config.ts`
 * is: that file has top-level `describe`/`it` blocks that reach a real
 * network, so anything importing functions out of it would also register
 * (and, under `npm test`, attempt to run) live tests. A plain unit test can
 * safely import from here instead — see `sanity-adapter-smoke.test.ts`.
 *
 * This module owns no domain validation of its own. The real `src/lib/sanity-*.ts`
 * adapters already reject a malformed document, an unresolved reference, an
 * orphaned category, or an empty article body — re-checking those here would
 * duplicate a guarantee the adapters already give. What is uniquely missing
 * elsewhere is (1) walking a gallery's cursor chain to completion while
 * watching for a duplicate placement or a repeated cursor across pages, and
 * (2) refusing to let a private-dataset run silently borrow an unrelated
 * ambient `SANITY_READ_TOKEN` instead of the one the selected env file
 * itself names.
 *
 * No `server-only` marker: this module does no IO of its own — every value
 * it needs (including the page fetcher) is passed in, which is also what
 * makes it unit-testable without a network.
 */

/**
 * One page of a curated gallery, reduced to what pagination coverage needs.
 * `endCursor` mirrors `GalleryPage`'s own shape (`gallery-pagination.ts`):
 * `null`, never absent, whenever `hasNextPage` is `false`.
 */
export type GalleryPaginationPage = {
  readonly items: readonly { readonly placementId: string }[];
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
};

export type GalleryPaginationOutcome =
  | {
      readonly status: "completed";
      readonly pageCount: number;
      readonly itemCount: number;
      /** Whether this walk ever advanced past a first page — see `walkGalleryPagination`'s own doc comment. */
      readonly sawMultiPage: boolean;
    }
  | { readonly status: "vanished" }
  | { readonly status: "duplicate-placement"; readonly placementId: string; readonly pageCount: number }
  | { readonly status: "repeated-cursor"; readonly cursor: string; readonly pageCount: number }
  | { readonly status: "hard-cap-reached"; readonly pageCount: number };

/**
 * Walks a curated gallery's cursor chain to completion (or a bounded hard
 * cap), fetching each page through an injected async fetcher rather than a
 * live client directly — this is what makes the walk itself unit-testable
 * offline. Distinguishes three failure shapes a merely-large gallery does
 * not produce:
 *
 * - `duplicate-placement`: the same `placementId` surfaced on two different
 *   pages of the same walk — a pagination or dedup bug, not a large gallery.
 * - `repeated-cursor`: `endCursor` matched one already seen this walk —
 *   pagination is not making forward progress.
 * - `hard-cap-reached`: `maxPages` pages were fetched and the walk still had
 *   not completed. This is a caller-configured safety bound against an
 *   unbounded loop, not evidence of a real gallery this large; it is
 *   reported as a distinct failure rather than treated as "done."
 *
 * `sawMultiPage` on a `completed` outcome is the actual proof AC4's "bounded
 * gallery pagination" requirement asks for: a gallery that never issues a
 * second page never exercises cursor encode/decode, keyset advancement, or
 * continuation at all, and the caller must not report that as equivalent
 * evidence to a gallery that did.
 */
export async function walkGalleryPagination(
  fetchPage: (cursor: string | undefined) => Promise<GalleryPaginationPage | undefined>,
  options: { readonly maxPages: number },
): Promise<GalleryPaginationOutcome> {
  const seenPlacementIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let pageCount = 0;
  let itemCount = 0;

  for (;;) {
    if (pageCount >= options.maxPages) {
      return { status: "hard-cap-reached", pageCount };
    }

    const page = await fetchPage(cursor);
    if (page === undefined) {
      return { status: "vanished" };
    }
    pageCount += 1;

    for (const item of page.items) {
      if (seenPlacementIds.has(item.placementId)) {
        return { status: "duplicate-placement", placementId: item.placementId, pageCount };
      }
      seenPlacementIds.add(item.placementId);
      itemCount += 1;
    }

    if (!page.hasNextPage) {
      return { status: "completed", pageCount, itemCount, sawMultiPage: pageCount > 1 };
    }

    if (page.endCursor === null) {
      throw new Error(
        "walkGalleryPagination: page reported hasNextPage=true but endCursor is null — cannot continue",
      );
    }
    if (seenCursors.has(page.endCursor)) {
      return { status: "repeated-cursor", cursor: page.endCursor, pageCount };
    }
    seenCursors.add(page.endCursor);
    cursor = page.endCursor;
  }
}

/**
 * Picks one deterministic candidate from a list of published placements for
 * a representative detail read — lexicographically smallest `contentId`, so
 * a repeated run against an unchanged dataset always samples the same
 * document rather than an arbitrary one, which matters for a report an
 * operator is expected to read and reason about.
 */
export function selectRepresentativePlacement<T extends { readonly contentId: string; readonly published: boolean }>(
  placements: readonly T[],
): T | undefined {
  return selectRepresentativePlacements(placements)[0];
}

/**
 * Every published placement, deterministically ordered by ascending
 * `contentId` — the ordered candidate pool `selectRepresentativePlacement`
 * takes its single pick from, and what a caller needing more than one
 * deterministic candidate (e.g. searching several galleries in order for a
 * multi-page pagination witness) iterates instead.
 */
export function selectRepresentativePlacements<T extends { readonly contentId: string; readonly published: boolean }>(
  placements: readonly T[],
): readonly T[] {
  return [...placements]
    .filter((placement) => placement.published)
    .sort((a, b) => a.contentId.localeCompare(b.contentId));
}

/**
 * The env-file keys this suite additionally depends on beyond
 * `REQUIRED_LIVE_VERIFICATION_TARGET_KEYS` — which locales and route are
 * queried is exactly the information `getDeploymentConfig()` reads from
 * these two, and `assertLiveVerificationTargetIsSelfContained` only ever
 * covers the Sanity project/dataset identity, not deployment routing.
 */
export const ROUTE_CONFIG_ENV_KEYS = ["SITE_LOCALE", "SITE_LOCALE_ROUTES"] as const;

export class SanityAdapterSmokeConfigError extends Error {
  constructor(message: string) {
    super(`[sanity-adapter-smoke] ${message}`);
    this.name = "SanityAdapterSmokeConfigError";
  }
}

/**
 * Refuses to let a private-dataset run silently combine the selected env
 * file's target (project/dataset/visibility) with an unrelated
 * `SANITY_READ_TOKEN` already sitting in the ambient shell environment.
 * `REQUIRED_LIVE_VERIFICATION_TARGET_KEYS` (sanity-live-verification-config.ts)
 * deliberately does not include the read token, because the sibling fixture
 * suite only ever runs against Preview's public dataset and needs none — but
 * this suite is meant to run against Production too, where the dataset may
 * be private, and a stale or wrong token exported for other work would
 * otherwise pass silently. Also rejects Vercel's `[SENSITIVE]` redacted
 * placeholder (see `next.config.ts`'s and `gallery-cursor.ts`'s own handling
 * of the same string) — a file carrying that value has not actually
 * delivered a usable token even though the key is present.
 */
export function assertPrivateDatasetHasUsableReadToken(
  parsedEnvFileContent: Readonly<Record<string, string>>,
  datasetVisibility: "public" | "private",
  envFilePath: string,
): void {
  if (datasetVisibility !== "private") return;

  const token = parsedEnvFileContent.SANITY_READ_TOKEN?.trim();
  if (token === undefined || token.length === 0) {
    throw new SanityAdapterSmokeConfigError(
      `${envFilePath} does not define SANITY_READ_TOKEN, but SANITY_DATASET_VISIBILITY is "private". ` +
        "The token must come from the selected env file itself, never an ambient environment " +
        "variable, so this run can never combine a Production target with an unrelated credential.",
    );
  }
  if (token === "[SENSITIVE]") {
    throw new SanityAdapterSmokeConfigError(
      `${envFilePath}'s SANITY_READ_TOKEN is Vercel's redacted "[SENSITIVE]" placeholder, not a real ` +
        "token — this env file was pulled without the setting's actual value. Pull it with access to " +
        "the real secret before running this suite against a private dataset.",
    );
  }
}

/**
 * Refuses to let a run silently combine the selected env file's Sanity
 * target with locale-route configuration left over in the ambient shell
 * environment. `getDeploymentConfig()` reads `SITE_LOCALE`/`SITE_LOCALE_ROUTES`
 * from `process.env` directly and is not told which file they should have
 * come from — without this check, an env file naming only the four Sanity
 * target keys would still resolve locales and a default locale from
 * whatever happened to already be exported, which could query Production
 * content through stale Preview routing, or skip a Production-only locale
 * entirely, while still reporting a clean pass.
 */
export function assertRouteConfigIsSelfContained(
  parsedEnvFileContent: Readonly<Record<string, string>>,
  envFilePath: string,
): void {
  const missing = ROUTE_CONFIG_ENV_KEYS.filter(
    (key) => (parsedEnvFileContent[key] ?? "").trim().length === 0,
  );
  if (missing.length > 0) {
    throw new SanityAdapterSmokeConfigError(
      `${envFilePath} does not define ${missing.join(", ")}. This suite reads locale route ` +
        "configuration to decide which locales and default locale to query — it must come from " +
        "the selected env file itself, never an ambient environment variable, so a run can never " +
        "silently query Production content through stale or unrelated route configuration left " +
        "over from other work in the same shell.",
    );
  }
}
