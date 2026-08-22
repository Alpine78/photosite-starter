import { describe, expect, it } from "vitest";

import { resolveLegacyRedirect } from "@/lib/legacy-redirects";
import {
  LEGACY_REDIRECTS,
  RETIRED_TAG_PATHS,
} from "@/lib/legacy-redirects-data";
import inventory from "@/lib/legacy-redirects-inventory.json";
import {
  ALREADY_LIVE_LEGACY_PATHS,
  EXCLUDED_LEGACY_PATHS,
  PENDING_LEGACY_PATHS,
} from "@/lib/legacy-redirects-tracking";

/**
 * Every top-level route this deployment already serves, matched exactly. A
 * legacy row landing on one of these would shadow a route that already
 * answers 200 today. Deliberately narrow rather than a general collision
 * check against every dynamic category, content, or service slug — none of
 * those exist as an inspectable target yet (see `PENDING_LEGACY_PATHS`'s own
 * comment) — so a deeper check is deferred to when a real `redirect` row
 * exists and can be checked against a running build.
 */
const KNOWN_LIVE_PATHS = new Set(["/", "/services", "/contact"]);

/**
 * Reserved namespace roots a legacy row must never fall inside, matched by
 * prefix. Unlike {@link KNOWN_LIVE_PATHS}, this is not "already answers 200"
 * — the English locale namespace (`/en`) legitimately contains many
 * `PENDING_LEGACY_PATHS` rows (`en/about`, `en/photos/...`) that do not yet
 * resolve to anything, so a blanket `/en` prefix check would misclassify
 * them. `/tarinat` and `/en/stories` are narrower and always wrong for a
 * legacy row regardless of migration state: they are the story namespace
 * `resolveLocalePrefixRequest`/`isPotentialStoryRequestPath` treat specially
 * (a trailing-slash request under either skips the ordinary 308 normalization
 * a legacy row otherwise relies on — see `proxy.ts`'s own trailing-slash
 * comment), so a legacy row landing there would silently stop resolving on
 * its slash variant rather than shadowing a currently-live page.
 */
const RESERVED_NAMESPACE_PREFIXES = ["/tarinat", "/en/stories"];

function collidesWithLiveOrReservedPath(path: string): boolean {
  return (
    KNOWN_LIVE_PATHS.has(path) ||
    RESERVED_NAMESPACE_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    )
  );
}

function inventoryPaths(): readonly string[] {
  return (inventory.records as readonly { path: string }[]).map(
    (record) => record.path,
  );
}

/**
 * Deliberately no test here asserts a literal count (442 records, 415
 * distinct paths, 174 decided, and so on) — those numbers describe this
 * deployment's own crawl and belong in a report to a human, not in a test a
 * clone would otherwise have to keep editing. Every check below is relational
 * instead: it holds exactly as well for a clone that has emptied every list
 * in `legacy-redirects-data.ts`, `legacy-redirects-tracking.ts`, and
 * `legacy-redirects-inventory.json` to nothing (see each file's own comment)
 * as it does for this deployment's real 415-path inventory.
 */
describe("AB#19 legacy redirect completeness", () => {
  it("places every distinct inventory path in exactly one bucket", () => {
    const buckets: Record<string, readonly string[]> = {
      decided: RETIRED_TAG_PATHS,
      "already-live": ALREADY_LIVE_LEGACY_PATHS,
      excluded: EXCLUDED_LEGACY_PATHS,
      pending: PENDING_LEGACY_PATHS,
    };

    const seenIn = new Map<string, string>();
    for (const [bucket, paths] of Object.entries(buckets)) {
      for (const path of paths) {
        const already = seenIn.get(path);
        expect(
          already,
          `"${path}" is in both "${already}" and "${bucket}"`,
        ).toBeUndefined();
        seenIn.set(path, bucket);
      }
    }

    const inventorySet = new Set(inventoryPaths());
    for (const path of seenIn.keys()) {
      expect(inventorySet.has(path), `"${path}" is not in the inventory`).toBe(
        true,
      );
    }
    for (const path of inventorySet) {
      expect(seenIn.has(path), `"${path}" is unaccounted for`).toBe(true);
    }
  });

  it("resolves every retired tag path to a gone outcome", () => {
    for (const path of RETIRED_TAG_PATHS) {
      const outcome = resolveLegacyRedirect(LEGACY_REDIRECTS, path);
      expect(outcome?.kind, `${path} should be gone`).toBe("gone");
    }
    expect(LEGACY_REDIRECTS.size).toBe(RETIRED_TAG_PATHS.length);
  });

  it("keeps the decided tag list pinned to exactly the tag-shaped inventory paths", () => {
    // Re-derives the pattern independently of `legacy-redirects-data.ts` so a
    // future inventory update that adds or removes a tag-shaped path fails
    // this test until the change is deliberately reviewed, rather than
    // silently reclassifying an unreviewed row — the same mistake this AB#19
    // pass caught for `component/komento/*` and `sivustokartta/*`, which look
    // like system routes by shape but are not.
    const tagShaped = inventoryPaths().filter(
      (path) =>
        /^\/component\/tags\/tag\/[^/]+$/.test(path) ||
        /^\/en\/component\/tags\/tag\/[^/]+$/.test(path),
    );

    expect(new Set(RETIRED_TAG_PATHS)).toEqual(new Set(tagShaped));
  });

  it("never records a legacy row (decided or pending) that shadows an already-live route or a reserved namespace", () => {
    for (const path of [...RETIRED_TAG_PATHS, ...PENDING_LEGACY_PATHS]) {
      expect(
        collidesWithLiveOrReservedPath(path),
        `"${path}" collides with a live route or a reserved namespace`,
      ).toBe(false);
    }
  });
});
