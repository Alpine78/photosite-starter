# AB#19: imported-content redirect preparation, 2026-10-09

AB#19 remains **Active**. This branch adds 138 direct same-language redirects for
113 content-source paths and 25 category-source paths. Source identities come from
published Joomla menu IDs, original article/category IDs and category ancestry,
not title similarity. The fresh Joomla archive SHA-256 is
`de1c60e148a38dffbe19b6b9e48af5c4097d47518958731455eb6a0080a7c600`.
Approved CMS imports and the independent post-import audit supply the target identities.
Private source records and complete response evidence remain outside Git.

## Target evidence

At 2026-10-09T15:13:16.168Z, all 98 distinct new targets returned anonymous direct 200 HTML
on the stable Vercel Production alias. Canonicals matched the configured custom
origin; each main heading matched the corresponding imported title/category label,
HTML language matched Finnish or the configured English `en-GB`, and no robots/googlebot
noindex appeared. Provider ownership and the serving deployment
`dpl_44SDGwpPtrcZDTFDAHLTBLvHBneU` matched before and after this run.
The prebuilt deployment API supplied no source revision; none was inferred.

The probes use Node 24.20.0 and the repository's bounded `legacy-redirect-probe.mts`
(20-second total request deadline, 4 MiB HTML cap, manual redirect policy) and semantic
HTML parser. Inputs/helper dependencies were fingerprinted and unchanged during the
run. The first probe incorrectly required literal `en` instead of configured `en-GB`;
its failed receipt is preserved, and a separately recorded corrected full run passed.

This is point-in-time **target** evidence. New source 301s are not deployed and no
production source-response pass is claimed. The mock production-build journeys test
the proxy's 301/Location behavior for every row, but contain no first-site CMS targets.
The CI target allowlist is a static evidence snapshot, not an ongoing live liveness
check. Re-run the owner checker against the final deployment before launch.

## Mapping behavior and completeness

Each row is an exact article, gallery or category replacement, not an ancestry/home
fallback. The old real Joomla `/portfolio` now has an imported portfolio target;
the template's historical removal of an unpublished scaffold is unchanged. The
owner-confirmed slow Monza 2008 content has a verified new direct target; its old
crawl timeout remains a historical observation, not a retirement decision.

The existing explicit `reservedQueryParams: "strip"` policy discards the new site's
`cursor` and `section` names when entering a replacement from a Joomla source.
These states have no verified Joomla-to-new-cursor identity. Unrelated parameters,
including bare numeric lightbox flags, remain byte-for-byte; no fragment translation
is introduced. Existing case and slash normalization remains unchanged.
No engine, route, CMS, dependency or private-gallery implementation changes.

| Classification | Original isolated content branch | With the service branch integrated |
| --- | ---: | ---: |
| Direct redirects | 177 | 189 |
| Justified tag-page 410s | 174 | 174 |
| Pending | 60 | 48 |
| Excluded Joomla error pages | 3 | 3 |
| Already-live root | 1 | 1 |
| Total distinct inventory paths | 415 | 415 |

PR #318 is now merged into main, and this branch integrates its twelve service rows.
The current classification is the right-hand column above; the left-hand column
preserves the original isolated content checkpoint.

The 138 content/category sources and twelve service sources are explicitly
disjoint. A separate local integration snapshot includes both redirect branches and
the pricing-tool branch; pending-list conflicts retain only the exact intersection
of the undecided source sets. No worktree was committed or rewritten for this trial. Residual static/service/source-identity decisions remain pending; no phased
manifest, blanket fallback or complete inventory pass is approved by this slice.

## Validation

Original isolated validation: lint, 4,959 browser-free tests across 210 files, the production build and 44
Chromium/WebKit legacy/fallback journeys passed. The initial shared dependency
symlink was rejected by Turbopack; the worktree now has its own dependency copy.
The sandboxed CLI tests produced empty child-process outputs; the full suite
passed when run with the required process permissions. No application fix was
needed for either execution-environment failure. The combined snapshot passed 4,982 tests across 210 files and its independent
mapping report confirms 189 redirects / 174 gone / 48 pending / 3 excluded / 1 live.
After integrating main and resolving the tracking-list conflicts for PR #319,
all 4,982 browser-free tests, lint, the production build and 46 Chromium/WebKit
legacy/fallback journeys passed again. The current mapping report exactly matches
the prior combined snapshot; only the test snapshot's already-reviewed empty-clone
guard differs from that earlier integration copy.
No public deployment,
DNS change, contact POST, CMS write, physical-device check, dataset-region proof or
backup restore is performed by this work.
