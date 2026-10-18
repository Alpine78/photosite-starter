# AB#19 — canonical Production verification, 2026-10-18

AB#19 remains **Active**. This records current serving-source identity and
public behavior, not final inventory acceptance or completion of AB#137,
AB#117 or AB#18. AB#137 is still an Active predecessor of AB#19; the dependency
and owner acceptance remain open. This evidence PR references AB#19 without an
automatic closing keyword.

## Identified release and bounded observation

The canonical host `https://www.ilkansivu.net` pointed to
`dpl_Hzr1PEYsXPMKMmVXtKJG5KrGo9wv` before and after the checks. Authenticated
provider metadata identified the expected project/team, READY Production target,
source `33cb41ac44b3a395263fe5710ee78a238fb3e9e9` and affirmative `gitDirty=0`.
The existing `verify-release-source` guard passed both times. Alias identity and
its provider `updatedAt` value remained unchanged.

The first-class MCP/CLI summaries omitted some identity fields, so the operator
used the installed CLI's documented authenticated GET fallback for the full
provider receipt. No token flags, environment pull, deployment, promotion,
configuration change or credential creation was used. Full provider receipts
stay private. This is **provider source identity, not remote artifact-byte
verification**; the guard does not establish protection or launch approval.

The mapping, inventory, tracking, engine and four CLI/probe modules match their
bytes at frozen source `33cb41a`, including in the operator checkout at `3fbd46d`.
The frozen source's [CI #1230](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=1230)
and the later unchanged-runtime [CI #1245](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=1245)
passed their full quality gates. These are existing CI results, not newly run
browser suites for writing this document.

Operator timing, in UTC:

| Observation | Time on 2026-10-18 |
| --- | --- |
| Before-source guard receipt written | 15:37:57 |
| Fresh 415-row HTTP report completed | 15:39:19 |
| Four successful browser cases completed | 15:44:52 |
| Final provider receipt captured | 15:44:57 |
| Final source guard/result aggregation completed | 15:46:40 |

Times come from operator JSON timestamps and file completion times; they are not
provider-signed timestamps. The earlier 14:11–14:13 check remains a behavioral
observation. The later run adds before/after serving-source binding and browser
notice evidence.

## Complete canonical-host check

```sh
node scripts/verify-legacy-redirects.mts check https://www.ilkansivu.net https://www.ilkansivu.net
```

The unchanged checker returned exit 0: **415 rows, zero issues**. The registry
classifies 232 direct redirects, 179 justified Gone responses, three excluded
error paths and one already-live root; zero paths remain undecided. The original
442 crawl records collapse to these 415 distinct inventoried paths.
AB#271 resolved the final 37 pending decisions after earlier slices had reduced
48 to 37; those historical counts are not today's missing work.

Every source was checked independently. The checker probes only each declared
redirect target, never follows a response-supplied Location, and shares each exact
target attempt. Requests have a 20-second total deadline and a 4 MiB HTML cap.
The assertions cover expected statuses/Locations, target 200 HTML and canonical
URL; fallback targets also require noindex, nonempty nonhidden status text and
no language alternates. This static parser does not prove computed CSS, exact
localized copy, fragment behavior or the language of every page body.

The full machine-readable report is attached to AB#19 as
`ab19-canonical-legacy-check-2026-10-18.json`, recorded in comment `66408`.
The fresh report has identical JSON content to that attachment, so a duplicate
was not uploaded. Its mapping also equals the current committed offline report.

- Original/fresh local report SHA-256:
  `33e15198ac5c63e7b1a2cab1a835e4f3fca1882b91d31ac27fbce7589a45f2c2`.
- Canonical JSON SHA-256 (sorted keys, compact separators, UTF-8):
  `852e77bf7e2c1dda61c44aab996438982b7287fe1bfad21bcdaa59ced803b088`.

Azure CLI normalized JSON formatting during attachment upload. Downloaded JSON
content was verified equivalent; byte identity with the original local file is
not claimed. No per-row source material or full provider response is added to Git.

## Hosted fallback notices in browsers

Four anonymous cases passed: Finnish and English in desktop Chromium and
phone-size WebKit, all with JavaScript disabled. Each expected source, target
and notice selector came from the committed mapping, not the observed Location.
The expected fixed copy came from source, and language tags from the pinned
public route configuration: `fi` and `en-GB`.

Each case verified one 301 followed by 200, the declared target/notice query,
correct document language, exact visible localized status copy with a real
layout box, noindex, the parameter-free canonical and absent hreflang.
The contexts refused any non-GET/HEAD request; none occurred. These are browser
simulations, not physical-device checks or a fresh visit to all 27 fallback views.

An initial operator-script attempt misclassified a target of exactly `/en` as
Finnish and expected `en` instead of the configured `en-GB`. Independent page
reads established the actual correct languages/notices. The script was corrected
from the existing configuration, and all four cases then passed. No site code or
routing setting changed to make the assertion pass. A metadata-file permission
refusal was also corrected locally before the unchanged source guard passed;
all evidence remained inside the private operator directory.

## Acceptance-criteria trace and limits

| AB#19 criterion | Evidence |
| --- | --- |
| Machine-checkable inventory | Committed 415-row registry/report; zero duplicate, pending or unaccounted classifications. |
| Exact same-language moves or justified ancestry/system outcomes | Previously reviewed source/menu/category decisions, including Closed AB#271; current declared destinations all passed. This does not re-infer source identity from slugs. |
| Localized accessible fallback notice, noindex and canonical | Static checks for all declared fallback targets; four fresh FI/EN visible-copy browser cases; existing production-build notice journeys. |
| Permanent status | All 232 declared redirect sources returned expected 301. |
| No chains, loops, missing/error targets | Engine/registry rejection and existing journeys; every current declared target returned 200; the four browser paths were one hop. |
| Case/trailing slash/query/fragment policy | ADR-0003 and existing engine/production E2E tests, including bare numeric query flags. Fragments do not reach the HTTP server; the fresh checker does not prove them. |
| Target canonical URL | Every declared redirect target passed the canonical assertion on the canonical host. |
| Isolated deployment configuration without secrets | Existing deployment registry/engine boundary retained; no mapping or credential changed. |
| Production-build tests | Existing passing frozen-source CI and unchanged-runtime CI; fresh hosted HTTP/browser observations complement them. |
| Unknown legacy URLs use normal not-found behavior | Existing production E2E coverage; not newly probed by the 415-row inventory check. AB#132's separate semantic-HTML limitation is not fixed or reaccepted here. |

The technical observations are now available for acceptance. **AB#137's
predecessor gate and owner acceptance remain open.** No CMS migration, customer
continuity, rollback exercise, physical-device test, security/privacy acceptance,
new go/no-go decision or Production promotion is implied. Preserve those stories
and AB#132's expired-review follow-up independently.
