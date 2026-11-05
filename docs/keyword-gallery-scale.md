# Keyword gallery at archive scale

**Audience:** whoever changes keyword gallery queries, paging or rendering. **Work item:** AB#73.
**Decisions:** [ADR-0012](adr/0012-dynamic-keyword-gallery-query-contract.md), [ADR-0039](adr/0039-keyword-taxonomy-and-ingest-boundary.md).

The budgets below are **proposed from local measurements** and need the owner's agreement. AB#73 stays open until then and until [what remains](#what-remains) is done.

## What runs in CI

`studio/keyword-gallery-archive-contract.test.ts` sends a raw `?keywords=` value through the real route, queries and projection, evaluated by GROQ over `studio/keyword-archive-fixture.ts`:
8000 synthetic media and 473 keywords on three levels, with popularity skewed: the broadest root matches 4,533 photographs, and a leaf 27 to 1,352 with a median of 54. The stored closure comes from the application's own `expandKeywordIds`, while expected results come separately from the assignments and the hierarchy.

| Correctness | How it is checked |
| --- | --- |
| Intersections of one to five keywords, and hierarchy | Every page walked and compared with the expected list, with cursors carrying selections of two to five keywords |
| No repeat or gap | The same walk, for a parent over 12 pages, and for a cohort with page boundaries inside a tie and among undated photographs |
| One address and cache identity | Ancestor collapse, order, repeats, spaces and a merged id all reach one canonical value and one cursor |
| Cursor scope | A cursor fails for another selection, language, taxonomy version, changed photograph or signing key |
| Isolation | Opted-out, private, non-renderable and video media hold every keyword, the newest capture date and the newest edit, yet never appear and never move a cursor's scope, even under a correctly signed cursor. Every photograph holds private fields, and a page may carry only named ones. Internal and retired keywords answer nothing, and the path and visibility rules are each tested alone |

**This test was checked by breaking the code.** Removing the keyset's tie-break, the visibility rule or the path rule, widening the cursor's scope past eligible media, and adding a field to a page each make it fail. Before that check, three of them passed.

The fixture models query semantics, not Sanity's perspective, access control or speed. Draft exclusion therefore stays covered by the client's published perspective, not by this test.

`e2e/keyword-gallery-continuation.spec.ts` holds the browser side: the next page, the viewer's continuation, restoring position, refusals and elements per photograph.

## Budgets

The first group is checked on every run, because it does not depend on the machine.

| Measure | Budget | Measured | Held by |
| --- | --- | --- | --- |
| CMS queries for a first page | 3 | 3 | Test |
| CMS queries for a continuation, however deep | 4 | 4 | Test |
| Rows returned for a page, which says nothing about the work the store does to find them | page size + 1 (25) | 25 | Test |
| A page of 24 photographs from the adapter, each with a caption in two languages and a credit | 16 KB of JSON | 11.3 KB | Test |
| Elements in the grid per photograph, without page chrome | 6 | 4 | Playwright |

Time and browser figures vary by machine, so they were measured once rather than asserted. The budgets are the limit at which a change should be questioned:

| Measure | Budget | Measured |
| --- | --- | --- |
| First page's HTML, compressed | 30 KB | 20.1 KB (153 KB decoded) |
| JavaScript on first load, compressed | 250 KB | 193 KB |
| Largest contentful paint | 2.5 s | 2.37 s |
| Continuation response, uncompressed | 40 KB | 31 KB |
| Show more: control to appended page | 1 s | median 592 ms, worst 730 ms at 984 photographs |
| Viewer continuing past the last loaded photograph | 1 s | 737 ms |
| Typeahead: first key to first option, two keys | 1.5 s | 1.04 s |
| DOM nodes per photograph, text included | 30 | 23 |
| JavaScript heap after 984 photographs and a collection | 40 MB | 16.6 MB |
| Live CMS query, cold and warm | Proposed: 1 s and 200 ms | **Not measured** |

**Proposed mobile profile:** a 412 × 839 viewport at 2.625× with touch, 150 ms latency, 1.6 Mbps down, 750 kbps up and a 4× CPU slowdown. This is the usual "slow 4G" emulation. The owner should agree it or name another.

## How it was measured

Locally on 2026-11-05 in Chromium with that profile, against a production build with the harness's mock content. The mock archive was temporarily raised to 2400 photographs, and the page was continued 40 times. These figures are limited in three ways:

- The mock archive reuses one photograph, so the image weight and LCP above **do not represent real image delivery**.
- The server was local, so there was no network distance to a CDN or Sanity beyond the emulation.
- A desktop CPU under a 4× slowdown is not a phone.

Server-side steps over the fixture, median of seven runs: parsing the vocabulary (106 KB) 0.2 ms, building the index with counts over 8000 closures 4 ms, one suggestion 0.2 ms and 955 bytes. Walking the broadest root once, 4,533 photographs over 189 pages, gave no repeat or gap and took 49 s of GROQ evaluation. CI walks a parent of 283 photographs over 12 pages to save that minute.

## A known limit

The grid does not virtualize, so the DOM grows linearly: 23,405 nodes at 984 photographs. Append time grew from about 430 ms to 730 ms over that range. All 8000 photographs would mean over 300 presses of Show more and about 190,000 nodes, which would be slow. **Recommendation:** leave it, because a visitor narrows a search long before that, and revisit if real use shows otherwise. No virtualized grid has been built or evaluated.

## What remains

These need something this repository cannot provide alone:

- **Live CMS latency:** a dataset holding the fixture. The `preview` dataset would need 8000 synthetic documents written with the owner's authorization, and the document limit checked first. Production's media have no keyword fields until `sync:keywords` runs, which AB#69 adds.
- **Real image weight and cache behaviour:** real media through the optimizer and CDN, on a deployed Preview.
- **Physical device and screen reader:** a phone on a real network, with VoiceOver or TalkBack, through typeahead, first page, Show more and the viewer.
- **The owner's agreement** on the budgets and the profile above.
