# ADR-0033: Unified site search

**Status:** Proposed
**Date:** 2026-10-15
**Deciders:** Project owner (Ilkka Rytkönen) — acceptance pending
**Work item:** AB#299

## Context

The owner asked for a site search, and Claude Design sketched it (screens 09 desktop and 10
mobile of the hi-fi proposal): a header "Hae" control opens a panel with a search field
and results grouped as stories, images and services, with a "show all results" link.

Four constraints already exist and shape the decision:

- **[ADR-0003](0003-public-content-tree-and-url-structure.md)** reserves `/haku` and
  `/en/search` for "later virtual keyword queries" and
  **[ADR-0012](0012-dynamic-keyword-gallery-query-contract.md) §8** gives that namespace
  one machine contract, `?keywords=`, with a `noindex` landing state for an empty
  selection. Free-text search is a different feature that wants the same visitor-facing
  address, so two modes must share one route without weakening ADR-0012.
- **Image search is not available yet.** Media has no keywords
  (`sanity/schemas/media.ts`), ADR-0002's `dynamicallyDiscoverable` is unimplemented, and
  the taxonomy ADR (AB#55) and its implementation chain (AB#56/57/68/59/58/71) are not
  built. AB#65 measured a 5,925-row `count()` at about 68 ms on a synthetic 8,000-medium
  corpus (`docs/keyword-query-benchmark.md`); that is evidence for the later keyword mode,
  not a production measurement.
- **Sanity's `match` is a poor fit for multi-word, multi-field search.** Its documented
  known issue is that a literal array on the left (`[title, summary] match [a, b]`)
  requires *all* patterns to match a *single* string, and an array attribute never matches.
  It folds case but not diacritics, and does no stemming. Using it per keystroke would also
  spend Sanity quota and send visitors' search terms to the CMS.
- **Privacy and rendering rules apply.** No tracking, no third-party search service
  (AB#62's own description), images are never cropped, public media are public derivatives
  only, and eligibility for anything public must equal the public route's eligibility.

## Decision

**One reserved route, two modes decided by a fixed rule. Free-text search matches on the
server against a cached, webhook-invalidated, per-language index of published stories and
services, filtered through the same content tree and end-date gate that govern the public
routes. The dialog talks to it with POST so terms never enter a URL; the no-JavaScript
results page uses GET and documents that exposure.**

### 1. Route and mode boundary

The route is the locale's search namespace — `haku` for the default Finnish locale,
`search` beneath `/en` — a deployment-owned `searchNamespace` in `locale-routes.ts`, with
the same collision checking as `storyNamespace` and `serviceNamespace`. It is resolved in
the **shared locale catch-all route**, like services, never by a separate generic
`[localePrefix]/[namespace]` route, which would capture story paths
(`resolveServiceRoute`'s own warning).

Mode is decided in this order, once:

1. Parse `keywords` exactly as ADR-0012 §8 does (first occurrence, split on `,`, trim, drop
   empty elements). If **at least one element** remains, the request is in **keyword mode**:
   ADR-0012 §8 applies unchanged, `q` is ignored and appears in no redirect or canonical
   link. Until AB#58/AB#71 ship, no token resolves to a keyword, so every such request is
   the existing **unknown-keyword** state (accessible `noindex` 404). No special case is
   added, and the namespace is not promised to anything else.
2. Otherwise read the **first** `q`, normalize it (§3). If it yields **at least one
   token**, the request is in **text mode** and shows results.
3. Otherwise the request shows ADR-0012's empty-selection landing state (HTTP 200,
   `noindex`), which now contains the search form.

In text mode only `q` is recognized. `cursor`, `section`, `keywords` (empty) and anything
else are ignored, not redirected, and `q` itself is never redirected to a normalized
spelling. A text-mode page is `noindex`, carries no `rel=canonical` and no `hreflang`
alternates, and is absent from the sitemap. It is **not** disallowed in `robots.txt`: a
disallow would stop crawlers from reading its `noindex`. Switching language from the search
page goes to the other locale's search page **without** the query, because no translation
of results is implied.

### 2. v1 corpus

Searchable: `article` and `gallery` documents (the story namespace's two content
variants) and `service` documents, in the request's language only. A record is searchable
**iff** its locale's content tree resolves a canonical public path for its `contentId`
(services: `getServiceRoutes` resolves one), it has not passed its `endDate`, and for a
service `hideFromListing` is not set. Results link to exactly that path, so eligibility and
href are the public route's by construction.

Not searchable in v1: article bodies, categories, images, polls, private client galleries
(ADR-0014), retained legacy delivery galleries (ADR-0028), and anything unpublished or
drafted (the Sanity client reads the published perspective only). Searched fields: story
`title`, `tags[]`, `summary`; service `name`, `shortDescription`.

### 3. Normalization and matching

The query is Unicode-normalized (NFC), then folded for matching only: lowercased and
stripped of combining marks. Tokens are maximal runs of `[\p{L}\p{N}]`, each at least two
characters. Input beyond **100 characters** is truncated and tokens beyond the first
**8** are ignored — deterministic, never an error. Visitor input is **never** interpreted
as query syntax (`*`, quotes and `-` are separators), and a query with no tokens never
matches "everything" (the `text::query("")` hazard).

A record matches iff **every query token is a prefix of at least one word in at least one
searched field** (AND between tokens, OR between fields — which is exactly the semantics
`match` could not guarantee). Order: weighted score (title 3, tag 2, summary/short
description 1 per matching token), then the existing listing order (`eventDate` descending,
`contentId` ascending). Folding is deliberately by base letter, so `ä`/`ö` also match `a`/`o`:
recall over precision for a small catalogue, and it makes `Gronholm` find `Grönholm`.
There is no stemming and no fuzzy matching in v1.

### 4. Data path: cached index, request-time eligibility, exact counts

One tagged Sanity read per language returns the compact record set described in §2 (ids,
searched fields, effective event date, `endDate`, public cover derivative with its true
dimensions). It joins the existing tagged Data Cache (`QUERY_CACHE_TAGS`, tags articles,
galleries, categories, services, media) so the signed webhook (AB#83) invalidates it
with no deployment. The mock source runs the **same** matcher over its fixtures.

At request time the matcher runs in memory over that set, then the `endDate` and
content-tree/service-route filters apply. Because the whole eligible set is in memory,
group counts are exact. A keystroke therefore makes **no** Sanity request on a warm cache,
and no search term ever reaches Sanity. The dialog shows at most **5** results per group
and the results page **50** per group with a "narrow your search" hint; there is no
pagination in v1.

**Budget.** The read must stay well inside the client's 1 MiB response limit
(`sanity-client.ts`); the target is at most 512 KiB per language and crossing 75 % of the
limit is the revisit trigger below. Byte size, record count and p50/p95 search time are
measured on Preview and recorded before acceptance of the story.

### 5. Transport and privacy

- The dialog uses `POST /api/search` with a JSON body (`q`, `lang`) of at most 1 KiB: JSON
  content type required, same-origin `Origin` required, `Cache-Control: no-store`, generic
  error shape, other methods refused — the contact endpoint's discipline (ADR-0004 §5).
- The application does not log, store or analyse search terms and sends them to no third
  party, including Sanity.
- **No link inside the dialog is prefetched.** A framework prefetch is a request the
  visitor did not make: the "show all" link's URL carries the term, and result links would
  tell the host which pages a half-typed query matches. Every such link sets
  `prefetch={false}`, and a journey asserts that no request to any URL contains the term.
- The no-JavaScript fallback and "show all results" use `GET …?q=`. That puts the term in
  the browser history and in hosting request logs; it does not reach other origins in a
  referrer (`strict-origin-when-cross-origin`). This is stated in a new data-flow
  document, `docs/search-data-flow.md`, rather than implied.
- Abuse: input is bounded identically on both entry points by one shared function. Search
  causes no upstream request on a warm index, so v1 adds no application rate limit and
  relies on the platform firewall (ADR-0004 §5); one is added if measurement shows CPU
  cost.

### 6. Presentation contract (rules the UI must meet, not pixel choices)

A native `<dialog>` opened with `showModal()`; the header trigger is a real link to the
search route that JavaScript upgrades; focus returns to the trigger on close; Esc is
coordinated with the existing mobile-menu Escape handling; the result count is announced in
a polite live region; results are ordinary links under headings; highlighting is made of
text nodes, never injected HTML; thumbnails keep their native aspect ratio and full frame
(`object-contain`, no cover crop), come from public derivatives and carry bounded `sizes`.
No "popular searches" list exists (owner decision, 2026-10-15). Brand-sensitive colour uses
semantic tokens; the dim backdrop is a documented photographic-surface exception only if no
token fits.

## Options Considered

### Option A (chosen): cached index + in-memory matcher
**Pros:** correct multi-field AND semantics; diacritic control; no per-keystroke CMS cost
or term disclosure; one matcher for mock and production; exact counts. **Cons:** the whole
record set per language is read and held; needs a size budget and a revisit trigger.

### Option B: GROQ `match`/`score` per request
**Pros:** server-side ranking, scales past memory. **Cons:** the documented
single-string/array behaviour breaks multi-word cross-field queries; no diacritic folding;
every distinct query is a quota-spending uncached request carrying the visitor's term to
the CMS. **Rejected for v1**, kept as the scale-up path.

### Option C: third-party search service (Algolia, Typesense Cloud, …)
**Cons:** a processor for visitor queries and a dependency for a corpus of this size;
contradicts AB#62 and the privacy rule. **Rejected.**

### Option D: client-side index shipped to the browser
**Cons:** unbounded payload for the archive, and it would ship unpublished-eligibility
decisions to the client. **Rejected** (AB#62: never load the archive into the browser).

### Option E: separate `/search` route beside `/haku`
**Cons:** two public search entries and a second namespace to reserve and localize, while
ADR-0012's namespace is otherwise idle until AB#71. **Rejected** in favour of one route
with a fixed mode rule.

## Trade-off Analysis

**Reading the whole set versus querying per request.** Option A trades memory and a size
ceiling for correctness, privacy and zero keystroke cost. For a photographer's catalogue
(dozens to low hundreds of stories) this is clearly cheaper; the ceiling and trigger make
the assumption explicit rather than silent.

**Folding diacritics versus Finnish precision.** `ä`/`a` are different Finnish letters, but
visitors on an English keyboard type the base letter and the catalogue is small enough that
a false positive costs one extra result. The fold is a documented v1 choice, easy to tighten.

**One route versus two.** The mode rule is more to specify than two routes, but it keeps the
visitor-facing address single and leaves ADR-0012 untouched in keyword mode.

## Consequences

**Easier**
- Search works in both locales on mock and Sanity with identical behaviour and tests.
- The later keyword mode and image group slot into a defined route with a defined
  precedence rule; AB#59's index can feed the same dialog.
- Hakusanat never reach the CMS or a third party.

**Harder**
- A per-language record set is held in memory and must stay within its budget.
- `locale-routes.ts` gains a fourth namespace, with its collision and language-switch rules.
- Body text, categories and images are not findable by text until a later decision.
- The no-JavaScript path puts the term in a URL, which must stay documented.

**To revisit — migration triggers**
- The measured index exceeds 75 % of the response limit, or search p95 is visibly slow →
  move to Option B (GROQ `match`/`score` with the multi-field semantics re-verified) or a
  per-token pre-filter, via a dated amendment.
- The owner wants body-text search → measure `pt::text(body)` cost and relevance first.
- AB#55 decides that article tags and photo keywords are one vocabulary → surface related
  stories for a keyword selection, and re-evaluate searching tags against that vocabulary.
- Keyword mode ships (AB#58/AB#71) → add the "Images" group from the AB#59 index, with
  per-keyword counts, in the same release as the destination gallery.
- Measurement shows search CPU cost → add the application rate limit §5 defers.

## Action Items

1. [ ] Owner accepts this ADR (status → Accepted).
2. [ ] Amend ADR-0012 §8 and ADR-0003 (dated entries, below) — done with this record.
3. [ ] AB#299 implements the text mode, dialog, results page, API and `docs/search-data-flow.md`.
4. [ ] AB#299 measures index bytes, record count and p50/p95 on Preview and records them.
5. [ ] AB#59/58/71 later add the keyword group and gallery in one release.

## What this ADR did not establish

- The keyword taxonomy, keyword ids, aliases or image search (AB#55 and its chain).
- Whether tags and photo keywords share a vocabulary (AB#55's decision).
- Body-text, category or image search, fuzzy matching, stemming, or sorting by anything but
  the §3 order.
- Pagination of text results beyond the 50 per group cap.
- Visual design details beyond §6's rules (spacing, motion, the exact backdrop token).
- Anything about measured production performance: the figures cited are AB#65's synthetic
  benchmark, and this record's own budget is a target pending the AB#299 measurement.
