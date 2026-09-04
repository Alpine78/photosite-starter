# ADR-0017: Authored event date as the public ordering key, with an optional scheduled end date

**Status:** Accepted
**Date:** 2026-09-04
**Deciders:** Ilkka Rytkönen
**Work item:** AB#150

## Context

Every chronological order the public site presents is keyed on `publishedAt`, the one
date `ContentPageBase` carries:

- category branch listing order (`content-listing.ts`, ADR-0003 decision 8);
- the story root's bounded recent-content overview;
- article previous/next sibling navigation and the "global article publication order" it
  reads;
- `/sitemap.xml` generation order;
- the ADR-0013 category-listing continuation cursor, whose keyset sort field is
  `(publishedAt, contentId)`.

`publishedAt` conflates two different facts: when a page went live *on this site*, and
when the real-world event or session it documents *actually happened*. A photographer who
finishes and publishes an earlier season's rally gallery after a later season's is already
live needs the site to present the two in real-world order, not publish order. The
previous Joomla site carried a separate event/created date, distinct from the CMS publish
timestamp; this codebase has no equivalent. The gap surfaced while building AB#149's
content-page hero: the owner asked for the page's date on the hero, then asked which date
that should be.

`publishedAt` is authored and frozen nowhere. ADR-0013 decision 1 already requires it to
be stored in a form whose lexical order is its chronological order (ISO 8601, one offset),
compared **verbatim as a string** everywhere — the in-memory reference ordering, the
store's `order()`, and the keyset `after` filter must be byte-for-byte identical, or a
continuation URL skips or repeats an item. The Sanity `article`/`gallery` schemas store
`publishedAt` as a `datetime`. `SANITY_PUBLIC_CACHE_TTL_SECONDS` is one hour: a public
read is served from Next's tag-revalidated Data Cache and refetched at most an hour after
the last invalidation (AB#83, `docs/cache-revalidation.md`). No cron or worker runs for
public content — ADR-0014's private-gallery retention worker is a separate system, gated
behind `PRIVATE_GALLERY_STORE`, and not a precedent to reuse.

## Decision

### 1. `eventDate` is the ordering key; `publishedAt` stays but orders nothing

An optional authored `eventDate` (ISO 8601) is added to `ContentPageBase`, so both
`ArticleContentPage` and `GalleryContentPage` carry it. The **effective event date** is
`eventDate ?? publishedAt`, and it replaces `publishedAt` as the ordering and display key
everywhere the site currently orders content chronologically.

`publishedAt` keeps its exact current meaning — the technical "went live on this site"
timestamp — and stays on the model. It is still what an Open Graph `article:published_time`
reports and what a future debug or audit view would read. It simply no longer feeds any
comparison or renders anywhere a visitor sees.

### 2. One shared seam computes the effective date

`effectiveEventDate({ eventDate, publishedAt })` in `content-page.ts` is the single place
the `eventDate ?? publishedAt` fallback is expressed. Every consumer — the mock adapter,
the Sanity adapters, the listing projection, the detail-page projection, the hero, the
listing card — reads that function's result, never the raw fields. Re-deriving the
fallback per call site is what lets the mock and Sanity paths, or the listing and detail
projections, silently disagree (AC1).

`ContentListingRecord` carries the resolved value as `eventDate: string` (always present —
it is the fallback's output, not the raw optional field) and drops `publishedAt`, which no
listing consumer needs any more. `ContentListingBoundary` / `ContentListingCursorBoundary`
rename `publishedAt` → `eventDate` for the same reason. Keeping a `publishedAt`-named field
on the record that actually holds the effective date would reintroduce exactly the
ambiguity this ADR removes.

### 3. Same verbatim-string discipline as ADR-0013

The effective date is compared as a string, never a parsed timestamp — ADR-0013 decision
1's rule is unchanged, it now applies to `coalesce(eventDate, publishedAt)` instead of
`publishedAt` alone. Both `eventDate` and `publishedAt` are stored as Sanity `datetime`
values (matching the existing `publishedAt` field type), so `coalesce(eventDate,
publishedAt)` is a single lexically-ordered string and the store's
`order(coalesce(eventDate, publishedAt) desc, contentId asc)`, the keyset filter, and
`content-listing.ts`'s in-memory `orderContentListingRecords` stay byte-identical. The
mock fixture keeps its established date-only convention (`2024-06-18`) for both fields, so
its own comparison is internally consistent too. `Date.parse` / `Date.UTC` validation is
kept only to reject an unorderable authored value as an adapter defect.

### 4. Cursor migration: bump the ordering rule, no new scope field

`CONTENT_LISTING_ORDERING` changes from `"published-desc-v1"` to `"event-date-desc-v1"`.
That constant is already bound into the ADR-0013 cursor's signed query-scope digest via
`KeysetCursorScope.ordering`, so a continuation cursor issued before this ships — open in
a tab, or indexed — decodes as **`wrong-scope`**, not as a silently valid position under
the new order. The render layer already answers `ContentListingCursorError` with a 404
carrying a link back to the branch's parameter-free page; nothing else changes.

This is exactly the mechanism ADR-0009 §4 chose for a gallery reseed (fold the ordering
discriminator into `GalleryCursorScope.ordering`; a mismatch is `wrong-scope`, which
already means "the order this cursor was cut from is not the order now"). A separate
`orderingVersion` scope field was considered and rejected there for the same reason it is
rejected here: `ordering` is already a required, HMAC-bound scope field, and a value
change to it *is* the migration.

### 5. `endDate` is a read-time gate folded into effective publication

An optional authored `endDate` (ISO 8601) is added to `ContentPageBase`. Once the current
time is at or past it, the page is treated as unpublished by **every** public read —
category listings, the story root overview, the sitemap, sibling navigation, and its own
detail route (404) — the identical posture the existing `published` boolean already
produces.

It is enforced **at the adapter boundary, once**, not at each route (AC4). The adapter
that produces content-tree placements (`readPublicArticlePlacements` /
`readPublicGalleryPlacements` for Sanity; `buildMockPublicContent`'s tree assembly for the
mock) folds `now < endDate` into the placement's effective `published` value. The content
tree then excludes the page from routing, listing membership, sibling-nav candidacy, and
`listPublicRoutePaths` with no downstream code aware of `endDate` at all. The
detail-page source (`readPublicArticlePage` / `readPublicGalleryPage`; the mock page map)
applies the same `now < endDate` gate and returns `undefined` — the same value it already
returns for a locale that never published the page.

`endDate` is deliberately **not** added to `ContentPlacementInput` / the content-tree
input. A first-class tree field would give the tree two independent representations of
"not public" to keep consistent; folding it into the effective `published` boolean keeps
one.

No scheduled job is introduced. A read-time `now() >= endDate ⇒ unpublished` check mirrors
the `published` boolean exactly and needs no infrastructure that does not already exist.

### 6. `endDate` cache staleness: a bounded window, not a scheduled trigger

A page served from Next's tag-revalidated Data Cache can outlive its own `endDate` until
something invalidates that tag or the time-based `revalidate` fires. Nothing invalidates a
tag purely because a clock passed a stored date.

**Decision: accept a bounded staleness window no larger than `SANITY_PUBLIC_CACHE_TTL_SECONDS`
(one hour today).** After that TTL the tagged fetch is refetched, the adapter re-applies
the `endDate` gate against the current clock, and the page drops out. No new scheduled
revalidation trigger is added.

Rationale: `endDate` is an editorial "stop showing this after about here" control, not an
embargo with legal or security force. A sub-hour bound sits well inside that intent.
Adding a public-content scheduler purely to tighten it contradicts MVP-first and
re-introduces exactly the always-on public cron ADR-0014 deliberately kept scoped to the
private store. The mock path has no Data Cache and applies the gate on every read. A
future requirement for a hard cutoff (licensed imagery that legally must come down at a
precise time, say) is a separate decision with its own ADR. `docs/cache-revalidation.md`
records this window.

### 7. `GalleryOrdering` is a different axis and is untouched

`GalleryOrdering` (`{kind:"manual"}` | `{kind:"seeded-random", seed}`, ADR-0009) orders
the *photographs within one gallery*. This ADR orders *galleries and articles against each
other* in category listings and overviews. They share no field, no cursor scope, and no
code path. A gallery's `eventDate` places that gallery among its siblings in a branch
listing; it has no effect on the order of frames inside the gallery, and
`computeShuffledOrder` / the `(pinnedTier, key, placementId)` boundary are not read here.
Stated explicitly per AC8 so a later reader does not assume the two interact.

### 8. Display

The effective event date (never `publishedAt`) is what a visitor sees:

- on the content-page hero, via `HeroOverlay` — the in-flow `<time>` treatment the
  article and gallery headers currently render moves into the hero band, matching the
  shape AB#149 already gave the gallery's lead description. A page with no authored cover
  (no hero) keeps the `<time>` in its constrained header.
- everywhere else a page's date appears: listing cards (`category-branch.tsx`) and
  sibling-navigation labels.

AB#151 (per-article author byline) shares this hero meta region. This ADR adds only the
date slot and the `HeroOverlay` prop that carries it; the combined date + byline meta-line
layout is settled with AB#151 rather than pre-designed here.

## Options Considered

### A. Freeze `publishedAt` and reuse it as the event date

No new field: make `publishedAt` immutable (as `slug` already is) and redefine it as "when
the event happened." **Rejected.** It destroys the "when did this go live" bookkeeping
that Open Graph metadata, ADR-0013's redirect/debug reasoning, and any future audit view
depend on; it still cannot express an event date earlier than the earliest plausible
publish; and it reaches far beyond ordering into the authoring workflow (ADR-0013 option C
rejected the same freeze for the narrower cursor case).

### B. A dedicated `orderingVersion` field in the cursor scope

Add a scope field parallel to a hypothetical `seedVersion`. **Rejected** for the reason
ADR-0009 §4 gives: `KeysetCursorScope.ordering` is already a required, HMAC-bound scope
field whose whole job is to name the order a cursor was cut from. Changing its value is
the migration; a second field is redundant surface.

### C. A scheduled revalidation trigger for `endDate`

A cron that invalidates content tags on a fixed interval so an expired page drops within
minutes. **Rejected.** No public-content scheduler exists; MVP-first argues against adding
one; ADR-0014 deliberately kept its worker scoped to the private store. The bounded
one-hour window is within an editorial control's intent (decision 6).

### D. `endDate` as a first-class content-tree input field

Carry `endDate` on `ContentPlacementInput` and let `buildContentTree` filter on it.
**Rejected.** The tree would then hold two independent "is this public" signals
(`published` and `endDate`) that every tree consumer must combine correctly. Folding
`endDate` into the effective `published` boolean at the adapter keeps exactly one.

### E. Compute `eventDate ?? publishedAt` at each call site

No shared seam. **Rejected** by AC1: the mock and Sanity adapters, and the listing and
detail projections, drift the moment the fallback is expressed more than once.

## Trade-off Analysis

- **Bumping `CONTENT_LISTING_ORDERING` retires every issued and indexed category
  continuation URL.** Acceptable: it is the same one-time cost ADR-0009's reseed accepts;
  category continuation is new (AB#140, ADR-0013) and thinly indexed; and a retired cursor
  produces a 404 with a link back to the parameter-free first page — never a wrong slice.
- **`endDate` staleness is bounded, not zero** (decision 6). Sized against a cache TTL the
  deployment already owns and can lower.
- **Two new optional authored fields on two schemas.** Both default to today's exact
  behaviour when unset, so an author not using the feature carries no new burden and the
  fixtures that do not set them are unaffected.
- **`ContentListingRecord` loses `publishedAt` and gains `eventDate`.** A mechanical rename
  through the listing/cursor/adjacent code and the mock, chosen over a `publishedAt`-named
  field secretly holding the effective date, which would preserve the ambiguity this ADR
  exists to remove.

## Consequences

- ADR-0013 receives a dated amendment: its cursor's keyset sort field is now the effective
  event date, `CONTENT_LISTING_ORDERING` is `"event-date-desc-v1"`, and a cursor issued
  before 2026-09-04 decodes as `wrong-scope`.
- `docs/cache-revalidation.md` gains the `endDate` bounded-staleness-window note
  (decision 6).
- `publishedAt` remains on `ContentPageBase` with unchanged meaning but is read by no
  ordering or display code. A grep for `publishedAt` in `src/components` and the ordering
  modules should return nothing after this lands.
- A future hard-cutoff requirement (a precise legal takedown time) is a separate ADR, not
  a change to decision 6.
- The `article` and `gallery` Sanity schemas gain `eventDate` and `endDate` optional
  `datetime` fields with Studio help text describing the default-to-`publishedAt` and
  auto-hide behaviour.

## Action Items

Split across two PRs, following AB#129's own precedent: PR1 lands the shared contract, the
cursor migration, and the mock implementation with its own fixtures and journey coverage;
PR2 wires the Sanity schemas and adapters onto that same contract. AB#150 stays `Active`
until both are merged.

PR1 (this record's own implementation):

- [x] `eventDate?` / `endDate?` on `ContentPageBase`; `effectiveEventDate()` and
      `isContentEnded()` in `content-page.ts`.
- [x] `ContentListingRecord.publishedAt` → `eventDate` (resolved value);
      `ContentListingBoundary` / `ContentListingCursorBoundary` field rename; ordering,
      keyset, and adjacent comparisons read the effective date.
- [x] `CONTENT_LISTING_ORDERING` → `"event-date-desc-v1"`; a pre-migration cursor decodes
      as `wrong-scope` (`content-listing-cursor.test.ts`).
- [x] `endDate` read-time gate folded into effective `published` in the mock tree assembly
      (`content.ts#applyMockEndDateGate`) and the mock detail-page source; the Sanity
      placement/detail readers are PR2's.
- [x] Sitemap order + `listPublicRoutePaths` exclusion follow from the mock tree gate with
      no sitemap-specific code (`buildSitemapPaths` is unchanged; `e2e/sitemap-robots.spec.ts`
      applies the same gate when computing its own expected set).
- [x] Mock fixtures: `content-reading-coastal-light` (article) and
      `content-polar-night-sessions` (gallery) each carry an `eventDate` that reorders them
      relative to `publishedAt`; `content-ended-article` and `content-ended-gallery` each
      carry a permanently-past `endDate`.
- [x] `HeroOverlay` gains a `meta` date slot (title above it, description below — AB#151
      extends this same line rather than adding a second); listing cards
      (`category-branch.tsx`) read the effective date. Sibling-nav labels
      (`AdjacentPageLink`) carry no date today, so decision 8's "sibling-nav labels" clause
      has nothing to change yet.
- [x] ADR-0013 dated amendment; `docs/cache-revalidation.md`; `docs/adr/README.md` index
      row; AGENTS.md feature status; README MVP checklist.
- [x] Playwright (`e2e/content-event-date.spec.ts`): an out-of-publish-order page lands in
      the right listing position; a pre-migration-ordering cursor 404s; an `endDate`-passed
      page 404s at its own route, is absent from its category listing, and is absent from
      the sitemap.

PR2 (not started):

- [ ] `eventDate` / `endDate` `datetime` fields on the `article` and `gallery` Sanity
      schemas, with Studio help text.
- [ ] `sanity-article.ts` / `sanity-gallery.ts`: project both fields, compute the effective
      event date at the projection boundary (replacing PR1's "effective value is
      `publishedAt` until the schema carries `eventDate`" placeholder), change the GROQ
      ordering/keyset fields to `coalesce(eventDate, publishedAt)`, and enforce the
      `endDate` gate on the placement and detail readers.
- [ ] A live-verification / adapter test proving the Sanity path's effective-date ordering
      and `endDate` gate agree with the mock's.
