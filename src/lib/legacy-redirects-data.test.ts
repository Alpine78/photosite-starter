import { describe, expect, it } from "vitest";

import { resolveLegacyRedirect } from "@/lib/legacy-redirects";
import {
  LEGACY_REDIRECTS,
  PUBLISHED_CONTENT_REDIRECT_ENTRIES,
  RETIRED_TAG_PATHS,
  STRUCTURAL_REDIRECT_ENTRIES,
} from "@/lib/legacy-redirects-data";
import inventory from "@/lib/legacy-redirects-inventory.json";
import {
  ALREADY_LIVE_LEGACY_PATHS,
  EXCLUDED_LEGACY_PATHS,
  PENDING_LEGACY_PATHS,
} from "@/lib/legacy-redirects-tracking";

/**
 * Every top-level route this deployment already serves, matched exactly.
 * Used two ways below: a legacy *source* landing on one of these would
 * shadow a route that already answers 200 today, and a `redirect` outcome's
 * *target* must land on one of these rather than a route that does not
 * exist. Deliberately narrow rather than a general check against every
 * dynamic category, content, or service slug. Published first-site content
 * targets have their separate reviewed allowlist below because the mock
 * fixture cannot enumerate Production content.
 */
const KNOWN_STRUCTURAL_TARGETS = new Set(["/", "/services", "/contact"]);

/**
 * These content routes exist only after first-site content is imported, so
 * the mock-only harness cannot prove them by enumerating its fixture. Each
 * is separately exercised on the protected Production candidate before its
 * legacy source is moved out of `PENDING_LEGACY_PATHS`.
 */
const KNOWN_PUBLISHED_CONTENT_TARGETS = new Set([
  "/tarinat/moottoriurheilu",
  "/en/stories/motorsport",
  "/tarinat/moottoriurheilu/wrc",
  "/en/stories/motorsport/wrc",
  "/tarinat/moottoriurheilu/wrc/tet-rally-latvia-2024",
  "/en/stories/motorsport/wrc/tet-rally-latvia-2024",
  "/tarinat/moottoriurheilu/wrc/secto-rally-finland-2023",
  "/en/stories/motorsport/wrc/secto-rally-finland-2023",
  "/tarinat/moottoriurheilu/wrc/neste-rally-finland-2016",
  "/en/stories/motorsport/wrc/rally-finland-2016",
  "/tarinat/moottoriurheilu/wrc/neste-rally-finland-2017",
  "/en/stories/motorsport/wrc/neste-rally-finland-2017",
  "/tarinat/moottoriurheilu/wrc/neste-rally-finland-2018",
  "/en/stories/motorsport/wrc/neste-rally-finland-2018",
  "/tarinat/moottoriurheilu/wrc/neste-rally-finland-2019",
  "/en/stories/motorsport/wrc/neste-rally-finland-2019",
  "/tarinat/moottoriurheilu/wrc/rally-finland-2001-2019",
  "/en/stories/motorsport/wrc/rally-finland-2001-2019",
  "/tarinat/moottoriurheilu/wrc/secto-rally-finland-2021",
  "/en/stories/motorsport/wrc/secto-rally-finland-2021",
  "/tarinat/moottoriurheilu/wrc/secto-rally-finland-2022",
  "/en/stories/motorsport/wrc/secto-rally-finland-2022",
  "/tarinat/moottoriurheilu/wrc/rally-estonia-2023",
  "/en/stories/motorsport/wrc/rally-estonia-2023",
  "/en/stories/common/ilkka-rytkonen-photographer",
  "/en/stories/motorsport/formula-1",
  "/en/stories/motorsport/formula-1/austrian-grand-prix-2021",
  "/en/stories/motorsport/other-motorsport",
  "/en/stories/motorsport/other-motorsport/racewknd-kuopio-2020",
  "/en/stories/portfolio",
  "/en/stories/travel-photos",
  "/en/stories/travel-photos/alpine-trips",
  "/en/stories/travel-photos/alpine-trips/chamonix-ski-2006",
  "/en/stories/travel-photos/f1-trips",
  "/en/stories/travel-photos/f1-trips/italian-grand-prix-2007",
  "/en/stories/travel-photos/f1-trips/italian-grand-prix-2008",
  "/en/stories/travel-photos/norway-and-lapland",
  "/en/stories/travel-photos/norway-and-lapland/lapland-roundtrip-2010",
  "/en/stories/vat-portfolio",
  "/en/stories/vat-portfolio/commercial-skills",
  "/en/stories/vat-portfolio/digital-workflow",
  "/en/stories/vat-portfolio/on-location-photography",
  "/en/stories/vat-portfolio/studio-photography",
  "/en/stories/wedding-photos",
  "/en/stories/wedding-photos/annika-and-johannes",
  "/en/stories/wedding-photos/elisa-joni",
  "/en/stories/wedding-photos/elsku-and-janne",
  "/en/stories/wedding-photos/emilia-and-jussi",
  "/en/stories/wedding-photos/hanna-and-heikki",
  "/en/stories/wedding-photos/jenni-tomi",
  "/en/stories/wedding-photos/johanna-and-jani",
  "/en/stories/wedding-photos/kristiina-and-sampo",
  "/en/stories/wedding-photos/laura-jukka",
  "/en/stories/wedding-photos/laurabrett",
  "/en/stories/wedding-photos/marianna-and-mikko",
  "/en/stories/wedding-photos/marittalassi",
  "/en/stories/wedding-photos/minnamikko",
  "/en/stories/wedding-photos/mirja-matti",
  "/en/stories/wedding-photos/olga-and-vesa",
  "/en/stories/wedding-photos/paula-and-ville",
  "/en/stories/wedding-photos/pirjo-and-ville",
  "/en/stories/wedding-photos/salla-and-vesa",
  "/en/stories/wedding-photos/tiia-maria-and-jouni",
  "/tarinat/blogi",
  "/tarinat/blogi/2016-suuri-makkaravertailu",
  "/tarinat/blogi/canon-eos-1d-x",
  "/tarinat/blogi/canon-powershot-sx610-hs",
  "/tarinat/blogi/fujifilm-fujinon-xf100-400mmf45-56-r-lm-ois-wr",
  "/tarinat/blogi/fujifilm-fujinon-xf18-135mmf3-5-5-6-r-lm-ois-wr",
  "/tarinat/blogi/fujifilm-fujinon-xf35mmf2-r-wr",
  "/tarinat/blogi/fujifilm-fujinon-xf50-140mm-f2-8-r-lm-ois-wr",
  "/tarinat/blogi/fujifilm-fujinon-xf56mm-f1-2-r",
  "/tarinat/blogi/fujifilm-x-pro2",
  "/tarinat/blogi/fujifilm-x-t1",
  "/tarinat/blogi/fujifilm-x-t10",
  "/tarinat/blogi/garmin-vivoactive",
  "/tarinat/blogi/nettisivujen-ulkoasu-uudistus-2017",
  "/tarinat/blogi/nikon-d4s",
  "/tarinat/blogi/nikon-df",
  "/tarinat/blogi/pentax-645z",
  "/tarinat/blogi/polar-m600-suunto-spartan-ultra",
  "/tarinat/blogi/uudet-sivut-avattu",
  "/tarinat/haakuvat",
  "/tarinat/haakuvat/annika-johannes",
  "/tarinat/haakuvat/elisa-joni",
  "/tarinat/haakuvat/elsku-janne",
  "/tarinat/haakuvat/emilia-jussi",
  "/tarinat/haakuvat/hanna-heikki",
  "/tarinat/haakuvat/jenni-tomi",
  "/tarinat/haakuvat/johanna-jani",
  "/tarinat/haakuvat/kristiina-sampo",
  "/tarinat/haakuvat/laura-brett",
  "/tarinat/haakuvat/laura-jukka",
  "/tarinat/haakuvat/marianna-mikko",
  "/tarinat/haakuvat/maritta-lassi",
  "/tarinat/haakuvat/minna-mikko",
  "/tarinat/haakuvat/mirja-matti",
  "/tarinat/haakuvat/olga-vesa",
  "/tarinat/haakuvat/paula-ville",
  "/tarinat/haakuvat/pirjo-ville",
  "/tarinat/haakuvat/salla-vesa",
  "/tarinat/haakuvat/tiia-maria-jouni",
  "/tarinat/haaportfolio",
  "/tarinat/matkailu",
  "/tarinat/matkailu/alppimatkat",
  "/tarinat/matkailu/alppimatkat/chamonix-2006",
  "/tarinat/matkailu/formulamatkat",
  "/tarinat/matkailu/formulamatkat/italian-grand-prix-2007",
  "/tarinat/matkailu/formulamatkat/italian-grand-prix-2008",
  "/tarinat/matkailu/norja-ja-lappi",
  "/tarinat/matkailu/norja-ja-lappi/lapin-kierros-2010",
  "/tarinat/moottoriurheilu/f1",
  "/tarinat/moottoriurheilu/f1/austrian-grand-prix-2021",
  "/tarinat/moottoriurheilu/muu-moottoriurheilu",
  "/tarinat/moottoriurheilu/muu-moottoriurheilu/racewknd-kuopio-2020",
  "/tarinat/portfolio",
  "/tarinat/vat-portfolio",
  "/tarinat/vat-portfolio/digitaalinen-tyonkulku",
  "/tarinat/vat-portfolio/kaupallinen",
  "/tarinat/vat-portfolio/miljoo",
  "/tarinat/vat-portfolio/studio",
  "/tarinat/yleinen/valokuvaaja-ilkka-rytkonen",
]);

/**
 * Reserved namespace roots a legacy row must never fall inside, matched by
 * prefix. Unlike {@link KNOWN_STRUCTURAL_TARGETS}, this is not "already answers 200"
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
    KNOWN_STRUCTURAL_TARGETS.has(path) ||
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
      decided: [
        ...RETIRED_TAG_PATHS,
        ...STRUCTURAL_REDIRECT_ENTRIES.map((entry) => entry.source),
        ...PUBLISHED_CONTENT_REDIRECT_ENTRIES.map((entry) => entry.source),
      ],
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
    expect(LEGACY_REDIRECTS.size).toBe(
      RETIRED_TAG_PATHS.length +
        STRUCTURAL_REDIRECT_ENTRIES.length +
        PUBLISHED_CONTENT_REDIRECT_ENTRIES.length,
    );
  });

  it("resolves every structural redirect entry to its declared target", () => {
    for (const entry of STRUCTURAL_REDIRECT_ENTRIES) {
      const outcome = resolveLegacyRedirect(LEGACY_REDIRECTS, entry.source);
      expect(outcome, entry.source).toEqual(entry.outcome);
    }
  });

  it("resolves every published content redirect entry to its declared target", () => {
    for (const entry of PUBLISHED_CONTENT_REDIRECT_ENTRIES) {
      const outcome = resolveLegacyRedirect(LEGACY_REDIRECTS, entry.source);
      expect(outcome, entry.source).toEqual(entry.outcome);
    }
  });

  it("keeps the verified target snapshot equal to the targets actually used", () => {
    const used = PUBLISHED_CONTENT_REDIRECT_ENTRIES.flatMap((entry) =>
      entry.outcome.kind === "redirect" ? [entry.outcome.target] : [],
    );
    // A clone with no legacy configuration empties the registry; the
    // first-site verification snapshot has no runtime effect in that case.
    if (used.length === 0) return;
    expect(new Set(used)).toEqual(KNOWN_PUBLISHED_CONTENT_TARGETS);
  });

  it("preserves the first-site source language on every published-content redirect", () => {
    for (const entry of PUBLISHED_CONTENT_REDIRECT_ENTRIES) {
      if (entry.outcome.kind !== "redirect") continue;
      expect(entry.outcome.target.startsWith("/en/"), entry.source).toBe(
        entry.source.startsWith("/en/"),
      );
    }
  });

  it("keeps distinct imported identities and historical aliases on their exact targets", () => {
    // Independently transcribed identities: altered English slugs, portfolio
    // alias, category/article distinction and the slow original Monza page.
    const expected = [
      ["/en/photos/wedding/laurajukka", "/en/stories/wedding-photos/laura-jukka"],
      ["/fi/valokuvat/haakuvat/laura-jukka", "/tarinat/haakuvat/laura-jukka"],
      ["/blogi", "/tarinat/blogi"],
      ["/blogi/fujifilm-x-pro2", "/tarinat/blogi/fujifilm-x-pro2"],
      ["/sivustokartta/haaportfolio", "/tarinat/haaportfolio"],
      ["/en/portfolio-en", "/en/stories/portfolio"],
      ["/valokuvat/matkailu/f1/italia-monza-f1-2008", "/tarinat/matkailu/formulamatkat/italian-grand-prix-2008"],
    ];
    // A clone may empty the first-site registry completely.
    if (PUBLISHED_CONTENT_REDIRECT_ENTRIES.length === 0) return;
    for (const [source, target] of expected) {
      expect(resolveLegacyRedirect(LEGACY_REDIRECTS, source), source).toEqual({
        kind: "redirect",
        target,
        reservedQueryParams: "strip",
      });
    }
  });

  it("only ever targets a structural redirect at a route this deployment already serves", () => {
    // A cheap static check ahead of `e2e/legacy-redirects.spec.ts`'s real
    // production-build proof: a typo'd target would fail here in
    // milliseconds instead of only surfacing once the browser suite runs.
    for (const entry of STRUCTURAL_REDIRECT_ENTRIES) {
      if (entry.outcome.kind !== "redirect") continue;
      expect(
        KNOWN_STRUCTURAL_TARGETS.has(entry.outcome.target),
        `"${entry.source}" targets "${entry.outcome.target}", which is not in KNOWN_STRUCTURAL_TARGETS`,
      ).toBe(true);
    }
  });

  it("only targets a published content redirect at a verified content route", () => {
    for (const entry of PUBLISHED_CONTENT_REDIRECT_ENTRIES) {
      if (entry.outcome.kind !== "redirect") continue;
      expect(
        KNOWN_PUBLISHED_CONTENT_TARGETS.has(entry.outcome.target),
        `"${entry.source}" targets "${entry.outcome.target}", which is not in KNOWN_PUBLISHED_CONTENT_TARGETS`,
      ).toBe(true);
    }
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
    for (const path of [
      ...RETIRED_TAG_PATHS,
      ...STRUCTURAL_REDIRECT_ENTRIES.map((entry) => entry.source),
      ...PUBLISHED_CONTENT_REDIRECT_ENTRIES.map((entry) => entry.source),
      ...PENDING_LEGACY_PATHS,
    ]) {
      expect(
        collidesWithLiveOrReservedPath(path),
        `"${path}" collides with a live route or a reserved namespace`,
      ).toBe(false);
    }
  });
});
