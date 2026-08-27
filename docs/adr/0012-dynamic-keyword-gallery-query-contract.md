# ADR-0012: Dynamic keyword-gallery query contract

**Status:** Accepted
**Date:** 2026-08-27
**Deciders:** Project owner (Ilkka Rytkönen)
**Work item:** AB#66 (remainder, after ADR-0009 split off the ordering-rule clauses)

## Context

AB#66's acceptance criteria originally covered two unrelated forcing constraints at once:
how a per-gallery seeded shuffle is computed and paginated, and how a *virtual*,
keyword-driven gallery is queried, canonicalized, and paginated at all.
[ADR-0009](0009-seeded-random-gallery-ordering.md) resolved the first — a materialized
sort key, folded into the existing `GalleryCursorScope.ordering` field — and explicitly
left the second open: *"AB#66 stays open for a follow-up ADR covering the rest."* This
record is that follow-up.

Three prior ADRs already constrain this decision rather than leaving it open ground:

- **[ADR-0002](0002-media-identity-and-placement-boundary.md)** already defines the
  shared result-item contract both curated and dynamic galleries expose
  (`PublicMediaItem`, with `itemId = placementId` for a curated result and `itemId =
  mediaId` for a dynamic one, deduplicated), the two independent visibility flags a
  dynamic query must respect (`publiclyRenderable`, `dynamicallyDiscoverable`, both
  media-owned, both currently unimplemented — "named here and added by their own
  stories"), and that `privateOnly` hard-excludes regardless of the other two. This ADR
  does not redefine any of that; it only decides the query and pagination contract that
  sits on top of it.
- **[ADR-0003](0003-public-content-tree-and-url-structure.md)** already reserves the
  route namespace — `/en/search` and `/haku` — for "later virtual keyword queries," states
  they are not persisted category nodes, and imposes a durability requirement this ADR
  inherits directly: *"a token survives appends and non-boundary edits, and expires only
  when reordering, removal, or a visibility change moves the boundary it names."* It also
  fixes the general shape every paginated public route in this project already follows:
  an opaque, server-issued, case-sensitive cursor; unknown query parameters ignored, not
  redirected; a structurally invalid state answers a `noindex` 404 rather than a guess or
  a silent fallback; a normalizable-but-equivalent request redirects once to its one
  canonical form.
- **AB#55** ("ADR: image keyword taxonomy and ingest boundary") owns the keyword
  taxonomy's own schema, ingest, alias/merge/rename, and ancestor-materialization
  mechanics as a *separate* ADR, informed by AB#65's benchmarking spike. This ADR treats
  a conforming taxonomy as a black box that can resolve a token to a canonical keyword
  id, resolve an alias, name a keyword's parent, and answer whether one keyword is an
  ancestor of another (however that is computed or materialized) — it does not decide the
  taxonomy's internal representation.

The forcing constraint specific to this record: `gallery-pagination.ts`'s
`GalleryCursorScope` (`sourceId`, `normalizedFilter`, `ordering`, `visibilityVersion`,
`pageSize`) is the one cursor-scope shape every gallery-shaped paginated result in this
project already uses, HMAC-bound and validated the same way regardless of what a
`sourceId` or `normalizedFilter` actually mean for a given kind of gallery. A dynamic
query has no persisted `contentId` a `sourceId` could name and no CMS-authored `order` a
tie-breaker could read — this ADR has to decide what those existing fields mean for a
query that is computed, not stored. It also has to reckon honestly with two mechanical
facts the reference codec was not built for: `CursorPayload`'s boundary key is
`{afterOrder: number, afterPlacementId: string}` — a curated gallery's own authored
integer plus its placement identity — and `buildCuratedGalleryPage`'s own precise
staleness check (`windowResult.boundary` compared against `after`) already exists and
already generalizes cleanly, but the *coarse* `visibilityVersion` pre-filter a curated
adapter computes today ("the most recently updated placement referencing this gallery," a
disclosed, imprecise approximation the codebase accepts specifically because one
gallery's placement set is small and only an admin edits it) costs more, in the same way,
against an archive-wide dynamic match set — a difference of degree this record has to
size honestly rather than paper over, as it works out below.

## Decision

**A dynamic gallery is a computed, deduplicated view over the same public media pool a
curated gallery draws from — never a second persisted copy — expressed through the
existing `GalleryCursorScope` shape with dynamic-specific values and a generalized
boundary-key payload, and reachable only at the already-reserved `/en/search` / `/haku`
namespace via one query parameter.**

### 1. Curated and dynamic galleries share one result contract, diverge only in ownership

| | Curated | Dynamic |
| --- | --- | --- |
| Contains | Exactly the media and order an administrator chose | Every publicly matching medium for a canonical keyword selection |
| Persisted as | A `gallery` document and its `galleryPlacement`s | Nothing — computed per request from the selection |
| `itemId` (ADR-0002) | `placementId` | `mediaId`, deduplicated |
| Manual order | Authored `order` field | None — no curator, no placements |
| Repeats | Same photograph may appear twice, by curator intent | Impossible by construction (dedup by `mediaId`) |

Both read from `PublicMediaItem` (ADR-0002) and both are paginated through
`GalleryCursorScope`. Nothing about the curated contract, `gallery.ts`'s route-facing
seam, or `readSanityCuratedGalleryPage` changes here — a dynamic query is a second,
parallel producer of the same shared page shape (`GalleryPage<CuratedGalleryResultItem>`
generalizes to the same envelope for a dynamic item), not a fork of it.

### 2. Eligibility: the same AND already required, restated as the query predicate

A medium is eligible for a dynamic result iff `publiclyRenderable == true AND
dynamicallyDiscoverable == true AND privateOnly == false` (ADR-0002 §4's own composition
rule, restated here as what a dynamic query's filter predicate actually tests). A count
shown anywhere — a result total, a keyword's "N photos" annotation — is a count over this
same filtered set, never a raw tag-match count computed before it.

### 3. Selection canonicalization: one algorithm, in this order

Given the raw list of keyword tokens a request names:

1. **Resolve.** Each token resolves to a canonical keyword id, following an alias to its
   target where the taxonomy defines one. A token that resolves to nothing is an
   **unknown-keyword** state (§8) — checked before anything below, because an
   unresolvable token is a different failure than an empty or oversized selection.
2. **Deduplicate.** Exact repeats of one canonical id collapse to one.
3. **Collapse ancestors.** For any pair remaining where one is a configured ancestor of
   the other, drop the ancestor. This is not a URL-hygiene convenience: under AND-only v1
   semantics (§4), a descendant's match set is already a subset of its ancestor's, so
   intersecting both is equivalent to intersecting the descendant alone — the collapse
   preserves meaning, it does not approximate it. Applied repeatedly until no such pair
   remains, so a selected grandparent–parent–child chain collapses to the child alone.
4. **Sort.** The surviving canonical ids sort ascending (the same code-unit string
   comparison `comparePlacementIds` already uses elsewhere in this codebase), so every
   selection equivalent under steps 1–3 produces one ordered list regardless of the order
   a visitor picked them in, the URL a link encodes, or which alias led to which canonical
   id.
5. **Bound.** The sorted, deduplicated, collapsed list's length is checked against the
   1–5 range *after* steps 1–4, not against the raw input. **Five canonical ids with no
   ancestor/descendant relationship among them is exactly the boundary case and is
   valid** — the bound rejects only a list that is still *more* than five after
   collapsing. A raw six-token selection that collapses to four or five canonical ids is
   valid; a raw six-token selection with no ancestor/descendant relationship anywhere
   among them stays at six after collapsing and is over-limit. An empty result (step 1
   resolved nothing because no token was supplied at all) and an over-limit result are
   handled distinctly (§8), not both folded into one generic "invalid" case.

**Keyword-id syntax is constrained by what this list is serialized into.** The canonical
list is joined into `normalizedFilter` (§5) as a comma-separated string bounded by
`MAX_SCOPE_FIELD_LENGTH` (256 characters, `gallery-pagination.ts`) — the same field every
other gallery's filter scope already respects. A canonical keyword id must therefore
never itself contain a comma, and the taxonomy's id-length policy must keep five
worst-case ids, their separators, and the taxonomy-version prefix (§5) inside that bound.
AB#55's taxonomy ADR owns keyword-id syntax; if it cannot guarantee both properties, the
serialization here must change to a fixed-length digest of the canonical set rather than
the literal ids — named as an open item (Action Items, §8 below) rather than assumed away.

The canonical, ordered id list from this algorithm is what both the public URL and the
cursor's `normalizedFilter` (§5) are built from — one canonicalization, two consumers,
so they cannot silently disagree with each other.

### 4. Matching semantics: v1 is global AND, ancestor selection expands to descendants

A medium matches the canonical selection iff, for **every** canonical keyword id in the
selection, the medium carries that id or a descendant of it. Selecting a parent keyword
therefore matches everything tagged anywhere under it, exactly the "a selected parent
matches configured descendants" criterion, and intersecting several such per-keyword
match sets is what AND means here — worked through the example the acceptance criteria
name directly: selecting "Marcus Grönholm" and "Peugeot" returns media tagged with (or
descended from) both. A medium tagged **"Marcus Grönholm" and "Ford"** — Grönholm driving
for a different team than the one selected — is **excluded because it fails the Peugeot
branch of the AND**, not because "Ford" is unrelated to "Grönholm": the medium already
satisfies the Grönholm branch (it carries that exact tag), but "Ford" is neither
"Peugeot" nor a descendant of it, so the Peugeot branch's match set does not contain this
medium and the intersection of both branches excludes it. This is precisely what AND
across two independent facets (driver, team) is for: satisfying one selected keyword
is never sufficient on its own.

**How a parent-to-descendant match set is actually resolved by a query** — walking the
tree at read time, a precomputed closure per keyword, or a denormalized field on each
medium — is deliberately not decided here. AB#55's taxonomy ADR and AB#65's benchmarking
spike own that mechanism; this ADR fixes only the contract those mechanisms must satisfy:
selecting a keyword must be observably equivalent, from a visitor's result set, to
selecting every one of its configured descendants and OR-ing them together, and that
per-keyword OR-expansion composes with sibling selections by AND.

### 5. Cursor scope: dynamic-specific values in the existing shape

`GalleryCursorScope` is reused exactly as declared (`gallery-pagination.ts`), with these
dynamic-query values:

| Field | Curated gallery (unchanged) | Dynamic query |
| --- | --- | --- |
| `sourceId` | The gallery's own `contentId` | The fixed literal `"dynamic-keyword-query-v1"` — every dynamic query shares one source identity; §3's canonical selection is what actually distinguishes one query from another, the same way a section slug distinguishes queries within one curated `sourceId` today |
| `normalizedFilter` | Section filter (`gallery-sections.ts`) | The canonical, sorted, comma-joined keyword-id list from §3, plus the taxonomy's current structural version, e.g. `` `v${taxonomyVersion}:${canonicalIds.join(",")}` `` — bounded as §3 describes. `taxonomyVersion` is one global counter at v1 (§6 explains why, and its cost) |
| `ordering` | `"manual-v1"` or `"seeded-random-v1:{seed}"` (ADR-0009) | `"dynamic-default-v1"` (§9) — a dynamic query has no manual order or seed to embed, so its ordering identity is just its own rule version |
| `visibilityVersion` | Most recently updated placement *referencing this gallery* — not filtered by visibility or section (`sanity-gallery.ts`'s actual query; its own doc comment calls this "matching," which overstates what it filters) | Same *class* of coarse, disclosed approximation, scoped differently — see §6 |
| `pageSize` | Existing bound (`MAX_GALLERY_PAGE_SIZE`) | Same bound, same field, unchanged |

### 6. Cursor durability: the coarse-approximation trade-off, sized honestly for a dynamic query's larger pool

**Two independent coarse-versioning decisions live in this scope, and both trade precision
for a cheap pre-filter — the same trade every consumer of `GalleryCursorScope` already
makes, restated here for the dynamic case specifically.**

**`normalizedFilter`'s taxonomy version.** A structural taxonomy change (an ancestor
relationship changed, an alias was retargeted) is folded into `normalizedFilter` rather
than a new scope field, following ADR-0009 §4's own reasoning: it changes what the query
*means*, so a cursor minted before it becomes `wrong-scope`. **At v1 this is one global
counter, not a per-query fingerprint of only the branches a given selection actually
touches** — an edit to an entirely unrelated part of the taxonomy bumps it and
invalidates every outstanding dynamic cursor site-wide, not only the ones whose canonical
set the edit could plausibly affect. This is a known, disclosed over-invalidation, not a
precise one, accepted for v1 because computing a query-scoped fingerprint requires the
same kind of "which queries does this edit affect" analysis §7 already defers to AB#55 —
revisit if taxonomy edits prove frequent enough that this cost is felt in practice
(Consequences, "To revisit," below).

**`visibilityVersion`'s coarse pre-filter.** The curated adapter's own formula — the most
recently updated placement referencing one gallery, unfiltered by visibility or section —
is already an accepted over-approximation there: the codebase's own comment names the
cost directly ("a caption-only edit... also bumps it, invalidating outstanding cursors
that a perfectly precise version would have left alone"), tolerated because one gallery's
placement set is small and only its administrator edits it. **A dynamic query's eligible
pool is not small and is not edited by one administrator on one schedule** — it can span
every `dynamicallyDiscoverable` medium in the archive — so the *same class* of coarse
approximation costs more here in ordinary operation, computed **per query, scoped to that
query's own current matching pool** (never one site-wide value shared across every
dynamic query — Option E below is that rejected alternative): an unrelated caption fix or
a newly tagged photo becoming eligible elsewhere in the archive only bumps the version of
a query that photo actually matches, never an unrelated one, but it does bump *every*
outstanding cursor for *every query that photo matches*, however many that is. This is
not a new failure mode this ADR introduces — it is the existing, disclosed curated
trade-off, inherited at a scale where, for a broad or popular query, it fires more often.
**Decided here: dynamic v1 accepts this cost rather than pretending a free, precise
alternative exists.** A cursor issued against a large or actively-tagged dynamic query
should be expected to need re-issuing more often than one against a small,
administrator-curated gallery — a real, named limitation, not a silent one (Consequences,
"Harder," below), and a candidate for a future precise mechanism if it proves disruptive
(Consequences, "To revisit," below).

**What this coarse pre-filter is not solely responsible for.** `buildCuratedGalleryPage`'s
existing boundary check —

```ts
if (
  windowResult.boundary === undefined ||
  windowResult.boundary.order !== after.order ||
  windowResult.boundary.placementId !== after.placementId
) {
  throw new GalleryCursorError("stale");
}
```

— independently verifies, per request, that the *specific named boundary item* itself is
still eligible and unmoved, from the source's own current lookup, with no dependency on
`visibilityVersion` at all. A dynamic-query adapter inherits this exact check for free
once its boundary key fits the generalized shape §7 describes — it is not something this
ADR needs to re-derive, and it is *not* weakened by `visibilityVersion`'s coarseness: the
coarse pre-filter and this precise per-boundary check are complementary layers, not
alternatives, and neither one being imprecise licenses skipping the other.

### 7. Boundary-key generalization: two pending generalizations of one type, not one

`GalleryCursorCodec`'s reference implementation (`createHmacGalleryCursorCodec`,
`gallery-pagination.ts`) encodes and decodes a boundary as `{afterOrder: number,
afterPlacementId: string}` today — a curated gallery's authored integer `order` plus its
`placementId`. **This ADR is not the only one already pulling this shape toward a
generalization.** ADR-0009 §3 already commits (Accepted, unimplemented) to a tiered
`(pinnedTier, tier === 0 ? order : shuffledOrder, placementId)` sort key for a seeded
gallery, and its own Action Items name the exact same type as needing to widen from "the
manual-only `(order, placementId)` pair to the tiered `(pinnedTier, key, placementId)`
triple" — unimplemented as of this writing (AB#129). A dynamic query's boundary key
(`capturedAt`-or-empty-string, keyed to `mediaId`) is a *third* shape pulling on the same
type. **`GalleryCursorScope` itself needs no change for either; the boundary-key payload
inside `GalleryCursorCodec`/`CursorPayload` does, and it must be generalized once, to a
shape both pending needs fit, not twice by two stories independently.**

The module's own comment already anticipated this seam: *"AB#66 may replace the reference
encoding without changing the public `GalleryPage` contract or UI callers."* This ADR
names the shape the *combined* generalization must take, without performing the migration
itself (a change to `gallery-pagination.ts`'s shared types is real implementation work
touching the existing curated and pending seeded-random code paths too, not something a
design record enacts):

- A boundary key is `{tier?: number; key: string; itemId: string}` — `tier` optional and
  meaningful only for an ordering rule that has one (ADR-0009's pinned/non-pinned split);
  absent (or a single implicit tier) for `manual-v1` and `dynamic-default-v1`, neither of
  which has a pinning concept. `key` generalizes `order`/`shuffledOrder`/`capturedAt` to
  one string-typed slot; `itemId` generalizes `placementId` to the `itemId` this project
  already derives per gallery kind (ADR-0002 §1) — `placementId` for curated, `mediaId`
  for dynamic.
- **Each ordering rule owns its own comparator over this shape, selected by the cursor
  scope's `ordering` value** — never one hardcoded comparator assumed for every rule.
  `manual-v1` compares `key` numerically, ascending, then `itemId`. `dynamic-default-v1`
  compares `key` (a Z-normalized ISO-8601 `capturedAt` instant, or the empty-string
  fallback) **descending** — matching `PUBLIC_MEDIA_ORDER`'s own `desc` exactly, not a
  generic ascending "lexicographic" comparison — then `itemId` ascending. A keyset "next
  page" comparison must invert per field to match: strictly *less than* the boundary's
  `key` for a descending field, strictly *greater than* for an ascending one, exactly
  mirroring `PUBLIC_MEDIA_ORDER`'s own two directions rather than applying one direction
  uniformly. Getting this backwards would not merely mis-sort — it would break the keyset
  bound itself, silently skipping or repeating items at scale. `seeded-random-v1` compares
  `tier` first, then `key` per ADR-0009 §3.
- **This generalization is a shared dependency between AB#129 (ADR-0009's own pending
  action item) and AB#58 (this ADR's).** Whichever lands first must land the shape both
  need, not the narrower shape its own story alone would have needed — landing one
  independently and the other on top of it, rather than by design, is exactly the
  "twice, with a risk of drifting apart" failure this ADR avoids elsewhere by sharing
  `PUBLIC_MEDIA_ORDER` (§9).

This is a structural precondition for §6's boundary-vs-current-state check to generalize
to a dynamic query at all, named as an explicit action item rather than performed here.

### 8. Route contract: one reserved namespace, one query parameter, canonicalize → validate → redirect

The dynamic query is reached at ADR-0003's already-reserved `/en/search` / `/haku`
routes via `?keywords=<canonical-id-1>,<canonical-id-2>,...` — an English parameter name
carrying the machine contract, matching decision 8's rule that `?section=`/`all` stay
English in every locale for the same reason. Continuation reuses `?cursor=` exactly as a
curated gallery does. Unrecognized parameters are ignored, not redirected, matching
decision 8's existing rule. Canonical metadata and internal links emit only recognized
parameters in the stable order `keywords` then `cursor`, mirroring decision 8's own
`section` then `cursor` order for a curated gallery.

**Raw parsing, before any resolution.** `?keywords=` is read once — a request naming the
parameter more than once uses only the first occurrence, the same as any other
unrecognized repetition this project already ignores rather than merges or rejects. The
raw value is split on `,`; a run of `URLSearchParams`' own standard percent-decoding
handles encoding, so nothing here invents a second decoding step. A leading, trailing, or
doubled separator (`,keyword`, `keyword,`, `keyword,,other`) produces empty elements,
which are dropped before resolution rather than treated as an unknown token — a
formatting accident, not a semantic one. Surrounding whitespace on a token is trimmed
before resolution for the same reason.

**A raw token-count ceiling is checked before resolution begins, separately from and
ahead of the canonical 1–5 bound.** §3's collapse can only *shrink* a selection, so a raw
count already far beyond anything a legitimate ancestor-collapse could bring under five
buys nothing by resolving it token by token first — each resolution and ancestor check
costs a taxonomy lookup, so an unbounded raw list is a cost amplifier a malformed or
adversarial link can trigger for free otherwise. A generous ceiling — enough to comfortably
exceed any real editorial selection, without inviting the amplification an effectively
unbounded one would (loosely: a low multiple of the 5-keyword canonical bound, exact
figure left to AB#71's implementation) — rejects a raw list beyond it immediately, before
any token is resolved, as **over-limit** (below): the visitor-facing failure is the same
one an oversized canonicalized selection produces, only detected earlier and cheaper.

**Order of operations, and why it must be this order:** the raw-count ceiling above runs
first, cheaply, on the parsed-but-unresolved token list. §3's canonicalization (resolve →
dedupe → collapse → sort) runs next, because nothing past it can be decided without it —
not even "is this selection over the limit" is knowable in its *canonical* form before
ancestors are collapsed. Only *after* canonicalization succeeds does further validation
run: the canonical bound check (§3 step 5) and, if `?cursor=` is present, cursor decoding
against the now-known `normalizedFilter`. **The redirect decision comes last, only for a
selection that has already passed every check above** — an invalid selection is never
redirected, the same rule this project's gallery cursor handling already follows (a
malformed or wrong-scope token 404s without creating a redirect first). Concretely:

1. Raw-count ceiling on the parsed token list. Over it exits immediately as **over-limit**
   below, before any token is resolved.
2. Canonicalize (§3, steps 1–4). An unresolvable token exits immediately as
   **unknown-keyword** below — canonicalization does not proceed past a token it cannot
   resolve.
3. Bound-check the canonicalized list (§3 step 5). Still over five after collapsing exits
   as **over-limit** below.
4. If `?cursor=` is present, decode and validate it against the scope built from the
   now-canonicalized selection (§5–§7). A cursor that fails exits with its own
   `GalleryCursorError` code (`malformed`/`tampered`/`wrong-scope`/`stale`), independent
   of whether the `?keywords=` spelling itself was canonical.
5. Only once 1–4 all succeed: if the request's `?keywords=` spelling differs from the
   canonical form §3 produces, redirect once to the canonical `?keywords=` form, preserving
   a validated `?cursor=` unchanged — **but not every non-canonical spelling redirects the
   same way.** A duplicate, a reordering, or a redundant-ancestor collapse is a
   *structural* fact about the canonical id set itself, stable for as long as that id set's
   ancestor relationships are (already covered by the `wrong-scope` taxonomy-version check
   in §5–§6 if they change) — this redirects permanently (`permanentRedirect()`, the same
   in-route-tree 308 mechanism casing and trailing-slash normalization already use, not the
   separate legacy-URL 301 registry for retired external paths). **An alias resolving to
   its canonical id is not the same kind of fact**, because this ADR explicitly notes (§5)
   that an alias can be *retargeted* — AB#55 has not yet decided whether a published alias
   is immutable. A permanent redirect survives in caches indefinitely; if an alias is later
   retargeted from id A to id B, a client holding a permanently cached "alias → A" redirect
   would never learn about B. **Until AB#55 declares published aliases immutable, an
   alias-only canonicalization (no reordering/duplicate/ancestor issue otherwise) redirects
   non-permanently** (a standard temporary redirect, not `permanentRedirect()`); once AB#55
   settles alias immutability, this ADR's default reverts to the same permanent redirect
   every other structural canonicalization already uses, via a dated amendment rather than
   silent drift. Otherwise, render the page directly.

Failure states:

- **Over-limit** (steps 1 or 3 above): an accessible, `noindex` 404 — both the raw-count
  ceiling and the canonical 1–5 bound are the same failure class from a visitor's
  perspective, an oversized selection, detected at different, increasingly expensive
  points rather than two different errors.
- **Unknown keyword id** (step 2 above): an accessible, `noindex` 404, matching the
  existing "unknown category path or content slug" and "unknown gallery section"
  precedent exactly — this project's established rule is that an invalid identity 404s
  rather than falling back to a nearest match or an ancestor, because guessing one would
  claim a relationship the data does not state.
- **Empty selection** (`?keywords=` absent, empty, or reduced to nothing after dropping
  empty elements): **not** a 404. A search route with nothing selected is a normal,
  expected state — an accessible, `noindex` landing state with no result grid, the same
  "valid, no items yet" posture the existing "valid section with no public items" rule
  already takes, rather than silently rendering the entire public archive (which would
  reopen the unbounded-OR/saved-gallery territory this ADR explicitly defers — see "What
  this ADR did not establish" below). A future browsable keyword index (AB#75) may render
  at or near this same landing state; building that index is not this ADR's scope.
- **Indexability of a real result page:** deliberately conservative. Unlike a curated
  gallery's parameter-free page, a dynamic query page is `noindex` and enters no sitemap
  at v1 — the combinatorial space of keyword selections has no natural "canonical" small
  set the way one curated gallery's own page does, and admitting arbitrary
  visitor-constructed combinations into the sitemap would hand crawl budget to a
  potentially unbounded set of low-value pages. A curated, hand-picked keyword landing
  experience is exactly what AB#75's separate browsable index exists to offer instead;
  revisit this if that story or SEO evidence (AB#76) argues a bounded subset (e.g.
  single-keyword pages) should be indexable after all.

### 9. Default ordering: reusing the existing public-media order, not inventing one

A curated gallery already has a default order and tie-breaker — the authored `order`
field, broken by `placementId` (`compareGalleryOrderKey`, `gallery-pagination.ts`) — and
ADR-0009 fixes what a seeded shuffle does to it. A dynamic query has no curator and no
authored `order` to fall back on, so it needs its own default, and this project already
has one: `PUBLIC_MEDIA_ORDER` (`sanity-media.ts`), `` order(coalesce(capturedAt, "") desc,
mediaId asc) ``, used everywhere a public medium is listed without a curator's own order
to defer to. **Dynamic v1's default order (`"dynamic-default-v1"`, §5) is this exact
clause, not a new one:**

- **Null/fallback.** GROQ sorts nulls first in a descending order, which would open every
  dynamic result with the photographs nobody dated. `coalesce(capturedAt, "")` turns an
  absent date into a value that sorts after every real one, so undated work sorts last —
  the same reasoning `PUBLIC_MEDIA_ORDER`'s own comment already states, inherited rather
  than re-derived.
- **Timezone.** `capturedAt` is a Studio `datetime`, an ISO-8601 instant already
  normalized to UTC (`Z`), so ordinary same-precision comparisons read as chronological
  without a separate timezone question. **This does not fully resolve string comparison
  for every pair, and this ADR does not claim it does:** `sanity-media.ts`'s own comment
  already names the residual case — "two instants that differ only in sub-second
  precision are the one case string comparison cannot separate reliably." For
  `PUBLIC_MEDIA_ORDER`'s existing bounded, non-paginated use (a `[0...limit]` slice), a
  misordered pair this close in time is harmless, exactly as that comment says. **This ADR
  is the first to keyset-paginate on this field**, where the store's own `ORDER BY` and
  the adapter's own comparator must agree exactly (the same requirement
  `compareGalleryOrderKey`'s own comment already states for the curated case) — a rare
  disagreement here would risk a duplicate or skipped item at that specific pair's
  boundary, not merely a cosmetically wrong position. AB#58 must verify empirically that
  GROQ's own string ordering and the adapter's comparator agree on
  `coalesce(capturedAt, "") desc` at whatever precision is actually stored, or normalize
  precision at write time if they do not — named as an explicit action item rather than
  assumed away.
- **Tie-breaker.** `mediaId` — not `placementId`, because a dynamic result's `itemId` is
  already `mediaId` (ADR-0002 §1) and a dynamic item has no placement to break a tie
  with. Two photographs captured in the same second, or both undated, still come back in
  one stable sequence on every request and every page, which is what keeps a keyset walk
  from duplicating or skipping an item at a tie.

Reusing `PUBLIC_MEDIA_ORDER` outright, rather than defining a parallel dynamic-query
ordering clause with the same values, means a future change to the public default order
(a different fallback, a different tie-breaker) changes once, for every consumer,
including this one — not twice, with a risk of the two drifting apart silently.
**That sharing cuts both ways: `PUBLIC_MEDIA_ORDER`'s comparator and `"dynamic-default-v1"`'s
cursor identity must change together.** `PUBLIC_MEDIA_ORDER` today has no cursor-paginated
consumer of its own — this ADR's dynamic query is the first — so nothing currently depends
on its stability across a request boundary. Once this ADR ships, that stops being true: a
future change to the comparator (a different fallback value, a different tie-breaker)
changes the meaning of the boundary `key` (§7) an outstanding cursor already encoded, so it
must bump `ordering` to `"dynamic-default-v2"` (or similar) in lockstep, the same discipline
ADR-0009 §4 already requires of a seed rotation — never edited as a same-version, in-place
comparator change.

## Options Considered

### Option A (chosen): dynamic queries reuse `GalleryCursorScope`, with a generalized boundary-key payload and a dedicated durability mechanism

Described above. **Note on scope:** the browser and UI layer are not actually a factor in
choosing between this option and Option B below — `GalleryCursor` (`gallery-result.ts`) is
already an opaque branded string the grid, lightbox, and continuation control only ever
transport, never decode, and `GalleryResultItem.placementId` is already optional with a
comment anticipating a dynamic adapter that omits it. Both options are equally invisible to
that code; the real trade-off is entirely server-side. **Pros:** one cursor-scope type, one
error taxonomy (`GalleryCursorErrorCode`), and one HMAC codec family serve both gallery
kinds — `buildCuratedGalleryPage`'s precise boundary check is inherited for free once the
boundary-key payload generalizes, rather than a second implementation of the same check.
**Cons:** `sourceId`'s dynamic meaning (a fixed literal rather than a per-instance
identity) is a mild overload of a field named for "stable project source identity" —
mitigated by `normalizedFilter` carrying the actual distinguishing information, exactly as
it already does for a curated gallery's sections. The boundary-key payload and the coarse
`visibilityVersion` pre-filter both need real, non-trivial generalization work (§6, §7)
this ADR fixes the contract for but does not perform, and that generalization is now a
shared dependency with ADR-0009's own pending one (§7).

### Option B: a second, dynamic-specific cursor type and codec

**Pros:** `sourceId` keeps one consistent meaning ("this gallery" for curated, absent for
dynamic), and the boundary-key shape could be dynamic-native from the start, with no
generalization of the curated type and no coordination with ADR-0009's own pending
generalization needed. **Cons:** duplicates the cursor-scope type, the error taxonomy, the
HMAC encode/decode/signature logic, and the boundary-vs-current-state staleness check
server-side — every one of which Option A already reuses as-is. This is a real
maintenance cost (two implementations of the same security-sensitive validation logic to
keep in sync), just not the UI-facing one an earlier draft of this ADR claimed: the grid,
lightbox, and continuation link do not decode a cursor either way, so they would not, in
fact, need to "learn a second shape." **Rejected** for the server-side duplication cost,
not the UI-coupling this ADR no longer claims.

### Option C: path-segment keyword routes (e.g. `/haku/marcus-gronholm/peugeot`)

**Pros:** keyword ids are visible in the path rather than a query string. **Cons:**
combinatorial — five selected keywords in arbitrary order would need either a fixed path
order (which the canonicalization in §3 already produces more simply as a query value) or
route-matching logic that accepts any permutation, and it collides with ADR-0003's
existing rule that path segments name persisted category ancestry, not an ad hoc visitor
selection. The reserved namespace itself (`/en/search`, `/haku`) was already fixed as one
route, not a route family, by ADR-0003 decision 6. **Rejected.**

### Option D: unbounded read-time hierarchy expansion (no materialization or benchmarking)

**Pros:** simplest possible query — walk the keyword tree live on every request.
**Cons:** exactly the class of problem ADR-0009 already resolved for ordering by
elimination: an unbounded per-request tree walk cannot be expressed as a bounded keyset
query the way AB#67/AB#134 already require, and this project has an open spike (AB#65)
specifically because the feasible mechanism is not yet known. Deciding one here would
either duplicate that spike's job or foreclose its answer before the evidence exists.
**Rejected** — deliberately left to AB#55/AB#65, per §4's own scope note.

### Option E: one site-wide `visibilityVersion` signal, shared by every dynamic query

Not the same as §6's decided formula, despite a superficial resemblance, and worth
distinguishing precisely: this option computes **one** "most recently updated
`dynamicallyDiscoverable` medium, anywhere in the archive" value and reuses it for every
dynamic query's `visibilityVersion` regardless of that query's own canonical selection —
the literal, unmodified extension of "one gallery has one coarse version" to "the whole
archive has one coarse version." **Pros:** genuinely zero per-query computation — one
value, computed once, reused everywhere. **Cons:** this invalidates *every* outstanding
dynamic cursor site-wide on *any* qualifying edit to *any* medium, regardless of whether
that medium has anything to do with a given cursor's own selection — categorically worse
than §6's decided formula (computed per query, scoped to that query's own current
matching pool, so an edit to a medium outside a given selection never touches that
selection's cursors at all). §6's own per-query scoping is what makes its cost merely
"more frequent for a large or popular query" rather than "every cursor for every query,
all the time." **Rejected** in favor of the per-query scoping §6 already decides.

## Trade-off Analysis

**Reusing `GalleryCursorScope` against a field's semantic purity.** Option A's `sourceId`
cost is entirely conceptual (a fixed literal meaning "no persisted source" for a dynamic
query) and its benefit is entirely mechanical (every existing scope-level cursor-consuming
code path needs zero new branches). Given this codebase already tolerates asymmetric field
meanings across gallery kinds — `normalizedFilter` is "no filter" for an unsectioned
curated gallery and "this section" for a sectioned one — a `sourceId` that is "this
specific gallery" or "no specific gallery, only this filter" is the same kind of
asymmetry, not a new one.

**Accepting a coarser durability trade-off against inventing an unproven precise one.**
§6 explicitly rejects reaching for a novel "precise" `visibilityVersion` mechanism this
ADR has not validated, in favor of the same *class* of coarse, disclosed approximation
curated galleries already ship with — accepting, honestly, that it costs more at dynamic
query scale rather than pretending a free precise alternative exists. The alternative —
inventing a precise mechanism inside this record — is exactly the mistake this ADR's own
first draft made (a "fixed value" that quietly failed to catch a real staleness case while
being described as durability-preserving). Naming the honest cost now, and the two
concrete triggers for revisiting it (§6, Consequences below), is safer than shipping an
unvalidated precise design under this ADR's authority.

**Deferring the hierarchy-expansion mechanism against deciding it now.** Fixing the
*contract* (parent selection ≡ OR of configured descendants) without fixing the
*mechanism* is exactly what let ADR-0009 leave "the exact keyed function" to AB#129 while
still unblocking AB#114. The same shape here unblocks AB#58 (paginated dynamic query) and
AB#71 (shareable multi-keyword URL) to build against a fixed contract while AB#55/AB#65
still own how the taxonomy answers "is X an ancestor of Y" efficiently.

**Coordinating the boundary-key generalization with ADR-0009 against generalizing it
twice.** §7's shared `{tier?, key, itemId}` shape costs a moment of cross-story
coordination (whichever of AB#58/AB#129 lands first must land the shape both need) against
the alternative of each story generalizing the same type independently and having to
reconcile two incompatible shapes later — the same "drifting apart silently" risk this ADR
avoids elsewhere by sharing `PUBLIC_MEDIA_ORDER` (§9).

**Where this could be wrong.** If AB#65's benchmarking finds that even a bounded,
materialized descendant-expansion cannot satisfy this project's existing keyset-pagination
bound at a realistic archive size, the *matching semantics* in §4 do not need to change,
but the *query mechanism* AB#55 designs against them would. If the coarse
`visibilityVersion` pre-filter's over-invalidation (§6) or the global taxonomy version's
over-invalidation (§6) prove disruptive in real use rather than a tolerable cost, both are
named migration triggers (Consequences below) with a real precise-mechanism design owed
at that point — this ADR's contract does not silently absorb that cost as acceptable
forever, only as an honest starting position.

## Consequences

**Easier**

- AB#58 (paginated dynamic gallery query) and AB#71 (shareable multi-keyword URL) inherit
  a fixed selection-canonicalization algorithm, cursor-scope mapping, durability contract,
  and route/error contract instead of each re-deriving one.
- AB#74 (multi-keyword typeahead) and AB#75 (browsable keyword index) both know the exact
  canonical URL shape a selection must produce, so a control that builds a link and a
  route that resolves one cannot silently disagree.
- The grid, lightbox, and continuation control need no new logic to handle a dynamic
  result — they already only depend on `GalleryPage`/`GalleryCursorScope`.
- `buildCuratedGalleryPage`'s existing boundary-vs-current-state check is inherited for
  free by a dynamic adapter once the boundary-key payload generalizes (§7) — the hardest
  part of "does this specific cursor still make sense" does not need reinventing.
- AB#55's taxonomy ADR can proceed knowing exactly what query-contract shape its ancestor
  strategy must support, without also having to invent the gallery-side consumer of it.

**Harder**

- `gallery-pagination.ts`'s boundary-key payload and comparator selection need real
  generalization work (§7) before any dynamic adapter can be built — this was not free,
  and this ADR does not perform it. It is now also a coordination point with AB#129's own
  pending generalization of the same type, not a change AB#58 can land in isolation.
- Dynamic queries inherit the curated gallery's own class of coarse, over-invalidating
  `visibilityVersion` approximation (§6), sized for a much larger, less predictably-edited
  pool — an outstanding cursor against a large or actively-tagged query should be expected
  to need re-issuing more often than one against a small, administrator-curated gallery.
  This is a disclosed, accepted v1 cost, not a hidden one, but it is a real cost.
- A global (not per-query) taxonomy version (§6) means an edit anywhere in the taxonomy
  invalidates every outstanding dynamic cursor site-wide, not only the ones whose selected
  keywords it could plausibly affect — the same over-invalidation trade-off as above,
  independently incurred.
- The raw-input token ceiling (§8) is a new validation layer AB#71 must implement ahead of
  §3's canonicalization, distinct from and cheaper than the canonical 1–5 bound it
  protects.
- Alias-based canonicalization redirects non-permanently until AB#55 settles alias
  immutability (§8) — an extra, conditional branch in the redirect logic AB#71 must
  implement, and a later dated amendment to this ADR once that dependency resolves.
- A visitor-facing error message for "unknown keyword" versus "over-limit selection"
  needs distinct, accessible copy — both are 404s at the transport layer, but a
  keyword-search UI (unlike a mistyped path) is expected to explain *why* to a visitor who
  just clicked a suggestion list, which is real, undesigned UI work.
- `sourceId`'s dynamic-query meaning is one more asymmetry a future maintainer reading
  `gallery-pagination.ts` has to learn, alongside `normalizedFilter`'s existing one.
- Keeping dynamic-query pages `noindex` at v1 means AB#76 (SEO/crawlability) inherits a
  gap it will eventually have to evaluate rather than a solved problem.
- `PUBLIC_MEDIA_ORDER`'s comparator gains a real stability obligation it did not have
  before this ADR (§9) — a future edit to it must now also consider cursor compatibility,
  not just the listings it already serves. AB#58 must also verify empirically that GROQ's
  own string ordering agrees with the adapter's comparator on `capturedAt` at whatever
  precision is actually stored (§9) — an unverified assumption otherwise.

**To revisit — migration triggers**

- **AB#65's benchmarking finds no bounded mechanism for descendant expansion at this
  project's realistic archive size** → §4's contract stands; AB#55/56/57 would need a
  narrower matching rule (e.g. exact-tag-only, no ancestor expansion) that this ADR would
  then need a dated amendment to reflect.
- **The coarse `visibilityVersion` pre-filter's over-invalidation proves disruptive in
  real use** (frequent, visible cursor expiry on popular or actively-tagged queries) →
  design the precise per-cursor mechanism §6 leaves open (for example, a per-cursor
  mint-time watermark), rather than continuing to accept the coarse cost indefinitely.
- **The global taxonomy version's over-invalidation proves disruptive** (frequent
  unrelated-edit-triggered expiry) → replace it with a query-scoped taxonomy fingerprint
  covering only the branches a given canonical selection actually touches — a harder
  problem this ADR defers rather than one it rules out.
- **AB#55 settles whether a published alias may be retargeted** → if aliases are declared
  immutable once published, revert §8's alias-canonicalization redirect from non-permanent
  to the same permanent form every other canonicalization already uses, via a dated
  amendment naming the affected clause.
- **A single-keyword dynamic page proves worth indexing** (AB#76 evidence, or an owner
  decision) → relax §8's blanket `noindex` for the one-keyword case specifically, leaving
  the multi-keyword combinatorial space `noindex` as decided here.
- **OR or NOT expressions are prioritized** → both need their own selection-canonicalization
  and cursor-scope treatment; §3–§7 here cover AND-only v1 and do not extend automatically.
- **Saved/named rule galleries are prioritized** → a saved selection would need its own
  persisted identity (closer to a curated gallery's `contentId` than to the shared
  `"dynamic-keyword-query-v1"` `sourceId` this ADR fixes for an ad hoc selection), which is
  a new decision, not an extension of this one.
- **More than five keywords are requested** → the five-keyword v1 bound in this ADR's own
  context is inherited from AB#66's acceptance criteria, not re-derived here; raising it
  is a capacity decision for whoever owns that criterion next, informed by real
  query-cost evidence once AB#58 exists to measure. The raw-input ceiling (§8) would need
  a matching adjustment, not just the canonical bound.
- **AB#55 cannot guarantee comma-free, sufficiently short keyword ids** → switch
  `normalizedFilter`'s keyword-set encoding to a fixed-length digest of the canonical list
  rather than the literal ids (§3); the query-parameter encoding would need the same
  reconsideration.

## Action Items

1. [ ] AB#55's taxonomy ADR is written and accepted, informed by AB#65, establishing how
       a canonical id, alias, parent link, and descendant-closure membership are actually
       represented and queried, and fixing keyword-id syntax/length — this ADR's §4
       contract is what the matching mechanism must satisfy, and §3's comma-free/bounded
       assumption is what the id syntax must satisfy.
2. [ ] AB#56/57 implement the controlled-vocabulary schema and import/sync AB#55 decides.
3. [ ] AB#58, coordinating with AB#129 (ADR-0009's own pending action item on the same
       type), generalizes `gallery-pagination.ts`'s boundary-key payload to the shared
       `{tier?, key, itemId}` shape and per-rule comparator selection per §7 — landed once,
       by whichever story reaches it first, in the shape both need. AB#58 also implements
       the coarse `visibilityVersion` pre-filter per §6's disclosed-cost default, verifies
       GROQ/adapter comparator agreement on `capturedAt` per §9, and implements the bounded,
       keyset-paginated dynamic query against §2–§5 and §9's contract: the eligibility
       predicate, selection canonicalization, matching semantics, the `GalleryCursorScope`
       field mapping, and the default order.
4. [ ] AB#68 exposes `dynamicallyDiscoverable` (and confirms `publiclyRenderable`) through
       the shared public media domain model, per ADR-0002 §4 and this ADR's §2.
5. [ ] AB#71 builds the `/en/search` / `/haku` route itself, the `?keywords=`/`?cursor=`
       parameter contract including the raw-input ceiling and canonical parameter order
       in §8, the canonicalize → validate → redirect order there (including the
       alias-redirect permanence conditional on AB#55's alias-immutability decision), and
       the empty/unknown/over-limit states.
6. [ ] AB#74 builds the multi-keyword typeahead selector against the canonical-id
       selection contract in §3.
7. [ ] AB#75 builds the browsable keyword hierarchy index, which may share the empty-state
       landing this ADR reserves at `/en/search` / `/haku` but is its own story.
8. [x] Update `docs/adr/README.md`'s index and "Expected further entries" table to mark
       AB#66's remainder fulfilled by this record.

## What this ADR did not establish

- **The keyword taxonomy's own schema, ingest, alias/merge/rename mechanics, ancestor
  representation, and keyword-id syntax.** AB#55's own ADR, informed by AB#65 — see §3's
  comma-free/bounded assumption and §4's deferred matching mechanism, both dependent on it.
- **The exact query or storage mechanism that resolves "is X an ancestor of Y" or expands
  a keyword to its descendant closure.** §4 fixes the observable contract; AB#55/AB#65 own
  the mechanism.
- **A precise (non-over-invalidating) `visibilityVersion` mechanism for a dynamic query.**
  §6 decides that v1 accepts the same disclosed coarse-approximation trade-off class
  curated galleries already carry, sized honestly for a larger pool; a genuinely precise
  mechanism is a named migration trigger, not designed here.
- **A precise, query-scoped taxonomy-version fingerprint.** §6 decides v1 uses one global
  counter, accepting site-wide cursor invalidation on any taxonomy edit as a disclosed
  cost; narrowing it to only the branches a given selection touches is a named migration
  trigger, not designed here.
- **Whether a published keyword alias may be retargeted.** AB#55's own decision; §8's
  alias-canonicalization redirect is explicitly conditional on it and reverts to a
  permanent redirect once AB#55 settles the question, via a dated amendment.
- **The actual code migration generalizing `gallery-pagination.ts`'s boundary-key payload
  and comparator selection.** §7 fixes the shared shape both this ADR and ADR-0009's own
  pending generalization must land in; AB#58 and AB#129 perform it, coordinated, and it
  also touches the existing curated code path's types.
- **Empirical verification that GROQ's own string ordering agrees with the adapter's
  comparator on stored `capturedAt` precision.** §9 names the risk (differing sub-second
  precision is not chronologically ordered by plain string comparison); AB#58 verifies or
  normalizes it, not this record.
- **The exact raw-input token-count ceiling.** §8 fixes that one must exist and be checked
  before resolution; the precise figure is AB#71's implementation choice.
- **OR expressions, NOT expressions, saved/named rule galleries, and selections of more
  than five keywords.** All explicitly out of v1 scope; see "To revisit" above for each
  one's own trigger.
- **Visitor-facing error copy, typeahead UI, or the browsable index's presentation.**
  AB#71/74/75's implementation work; this ADR fixes only the underlying states (empty,
  unknown, over-limit, canonical redirect) those UIs must render.
- **Whether a single-keyword page should be indexable.** §8 decides the conservative v1
  default (no); revisiting it is named as a migration trigger, not decided here.
- **Nothing here was measured.** Like ADR-0002, ADR-0003, and ADR-0009 before
  implementation, this is a design decision recorded ahead of AB#58/65's own evidence.
