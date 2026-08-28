# ADR-0009: Seeded random gallery ordering contract

**Status:** Accepted
**Date:** 2026-08-18
**Deciders:** Project owner (Ilkka Rytkönen)
**Work item:** AB#66 (ordering-rule clauses only — see "What this ADR did not establish")

## Context

`sanity/schemas/gallery.ts` (AB#113) already carries `orderingRule` (`manual` |
`seeded-random`), `orderingSeed`, and a per-placement `pinned` flag, with its own comment
admitting "nothing here computes or consumes an order from them — manual (array position)
is the only rule actually applied anywhere yet." AB#129's acceptance criteria describe what
a seeded shuffle must do: deterministic per seed, one order agreed by the grid, every
continuation page, and the lightbox; a prerendered or CDN-cached page never serves two
orders under one cache entry; pinned leads keep their exact manual positions; the active
rule and seed are part of the cursor scope; and full pagination over a shuffled gallery
returns every item exactly once.

AB#66's own acceptance criteria pose the open design questions directly: the rule's
identity/version scheme, whether the seed lives inside the ordering-version string or a
separate cursor scope field, whether a rotation invalidates a cursor as `wrong-scope` or
`stale`, the seed's lifetime/rotation trigger/owner, and how a random rule composes with
pinned leads (replacing manual order, or only its tie-breaker). AB#114 needs an answer
before its Sanity adapter can apply *any* ordering rule server-side, because
`GalleryCursorScope.ordering` (`gallery-pagination.ts`) is already a required, HMAC-bound
scope field — the adapter cannot leave it undefined for a seeded gallery.

The forcing constraint is technical, not stylistic: **GROQ has no hash or PRNG function.**
A bounded keyset query (`gallery-pagination.ts`'s `GalleryWindowRequest` — a boundary id
lookup plus `WHERE (order, id) > (?, ?) ORDER BY order, id LIMIT ?`) needs the sort key to
be a stored, indexable field the store itself can range over. A shuffle computed from
`hash(seed, placementId)` at read time cannot be expressed as a GROQ predicate or
`order()` clause, so the *only* way to keyset-paginate a shuffled order without loading a
gallery's full placement list — the bound AB#114 and AB#129 both require — is to
precompute the shuffle and store it as an ordinary sortable field. That single constraint
resolves most of AB#66's open questions by elimination rather than by preference, which is
why this is decided once, here, rather than re-derived per story.

## Decision

**A seeded-random order is precomputed and materialized as a stored, per-placement sort
key (`shuffledOrder`), recomputed only when the gallery's seed changes — never on read.**
A store-backed adapter keyset-paginates a seeded gallery exactly the way it already
paginates a manual one: an id lookup for the boundary, a range query for the rest, both
ordered by the field the active rule names.

### 1. One sort key per rule, chosen by `orderingRule`

| `orderingRule` | Sort key | Comparator |
| --- | --- | --- |
| `manual` | `order` (existing, authored as array position) | `(order, placementId)` — unchanged, AB#67/AB#134 |
| `seeded-random` | `shuffledOrder` (materialized, keyed by `orderingSeed`) | `(pinnedTier, shuffledOrder, placementId)` — §3 |

Nothing about the `manual` row changes. `gallery-pagination.ts`'s existing
`compareGalleryOrderKey` stays the reference comparator for manual galleries; §3 below
generalizes it for the seeded case rather than replacing it.

### 2. The shuffle itself: deterministic, keyed by the seed, not by this ADR's algorithm choice

`shuffledOrder` for a non-pinned placement is a value derived from a keyed function of
`(orderingSeed, placementId)` — for example an HMAC-SHA256 of `placementId` keyed by
`orderingSeed`, interpreted as a sort key. Same seed and same placement set always produce
the same key, so the order is stable across every server, request, and page (AB#129's own
requirement), and two different galleries sharing a seed value produce unrelated orders
because `placementId` is already site-wide unique (ADR-0002 §1). The exact function is
AB#129's implementation detail, not this ADR's: what this ADR fixes is that the function
runs once, at write/rotation time, against one placement at a time — never as a per-request
read-time computation, and never over the gallery's full placement list at once (a
materialization job processes placements independently; it does not need them loaded
together to keep the property "changing one placement's `pinned` flag or adding a new
placement does not require recomputing every other placement's key").

### 3. Pinned leads: a tier ahead of the shuffle, not inside it

A pinned placement keeps its authored manual `order` and always sorts before every
non-pinned placement. A non-pinned placement sorts by `shuffledOrder`. This is expressed
as a two-tier key: pinned placements are tier 0 (ordered by manual `order` among
themselves), non-pinned are tier 1 (ordered by `shuffledOrder` among themselves):

```
sortKey = (tier, tier === 0 ? order : shuffledOrder, placementId)
```

**The shuffle replaces manual order for non-pinned placements; it does not merely resolve
ties.** Ties do not need resolving under manual order — every placement already has a
unique integer `order` — so "shuffle only affects the tie-breaker" is vacuous: there is
nothing for it to break. Reshuffling the whole non-pinned set is also the only reading that
satisfies AB#129's stated purpose ("a portfolio does not open with the same image on every
visit"); tie-breaking only a rank-1 collision would not.

`placementId` remains the final tie-breaker in both tiers, matching every other ordering
this codebase already defines, so a `shuffledOrder` collision (extremely unlikely, but not
excluded by construction) still resolves deterministically.

### 4. Cursor scope: the rule *is* the version, no new scope field

`GalleryCursorScope.ordering` becomes:

- `"manual-v1"` — unchanged.
- `"seeded-random-v1:{orderingSeed}"` for a seeded gallery.

No new field is added to `GalleryCursorScope`. `ordering` already flows into
`queryScopeDigest` (`gallery-pagination.ts`), so embedding the seed there means **a
rotation is a `wrong-scope` cursor**, not `stale`: `stale` already means "the named
boundary item itself moved, was hidden, or was removed" (AB#134's definition, tied to
`visibilityVersion`), which describes a *positional* drift within one order. A reseed is a
different order entirely — every non-pinned item's key changed — so it is the same kind of
failure as replaying a cursor against the wrong section or the wrong gallery, which
`wrong-scope` already exists to name. This reuses the existing digest machinery exactly
the way AB#105/AB#134 folded section filtering into `normalizedFilter`: no new cursor
logic, only a new value composed into a field that already existed.

The raw seed value only ever reaches an HMAC digest (`queryScopeDigest`), never a
plaintext cursor field, so this discloses nothing a visitor's browser did not already
learn by the gallery rendering in some order at all.

### 5. Rotation: an authoring action, not a schedule this ADR fixes

The seed's owner is the site's author/administrator, exercised as an ordinary Studio edit
to `orderingSeed` — there is no separate infrastructure-owned rotation clock. Changing
`orderingSeed` is what "rotates" the order: it changes every non-pinned placement's sort
key at once (§2) and, by §4, invalidates every cursor minted under the previous value. A
prerendered or CDN-cached page never serves two orders under one cache entry because both
the render and its cache key are already scoped to the same `GalleryCursorScope.ordering`
value the route resolves from the document's current `orderingSeed` — no request ever
computes an order live, so there is nothing for concurrent requests to disagree about.
Recomputing every placement's `shuffledOrder` after a rotation, and wiring the gallery
route's own cache key/revalidation to `orderingSeed` end to end, is AB#129's
implementation, following this rule.

## Options Considered

### Option A (chosen): materialized `shuffledOrder`, recomputed on rotation

| Dimension | Assessment |
| --- | --- |
| Bounded reads | Keyset query, identical shape to manual order |
| Determinism | Exact — same stored value every read |
| Write cost | One recomputation pass per placement, only on rotation |
| New adapter logic | A comparator/sort-key choice by `orderingRule`, nothing else |

**Pros:** reuses AB#67/AB#134's entire bounded-query contract unchanged in shape — a
seeded gallery costs a store the same one-id-lookup-plus-one-range-query per page a manual
gallery already does. Cacheable by construction (§5). **Cons:** a rotation is a write
operation across a gallery's placements, not a free instant flip; a very large gallery's
rotation is a bounded batch job, not O(1) — acceptable because rotation is explicitly
infrequent (an authoring action, not a per-visit event).

### Option B: compute the shuffle live, in application code, per request

**Pros:** no materialized field, no recomputation step — a request just hashes and sorts.
**Cons:** requires loading every candidate placement into memory to sort before slicing,
because GROQ cannot evaluate a hash function to push the ordering into the store's own
query engine. This is exactly the unbounded "fetch everything matching this filter" cost
AB#134 already eliminated for manual and section-filtered reads; reintroducing it only for
the seeded case would leave `CuratedGallerySectionSource`'s "without loading the complete
gallery" contract violated for one ordering rule and not the other. **Rejected.**

### Option C: offset (page-number) pagination for a seeded gallery only

**Pros:** offsets don't need a store-side sortable key; the shuffle could be computed
once per request against an in-memory slice window. **Cons:** still requires ordering (or
at least ranking) the whole candidate set to know what offset *N* even is under a live
hash order — the same cost as Option B — and reopens the fragility keyset pagination was
chosen to avoid: an edit between two requests can shift items across an offset boundary,
duplicating or skipping items mid-walk, exactly what AB#67's own acceptance criteria
require a cursor to prevent. Using a different pagination *mechanism* for one ordering rule
than another also means the grid, lightbox, and continuation link would need to know which
kind of token they were holding. **Rejected.**

### Option D: true per-request random order, no seed

**Pros:** none particular to this project — the simplest possible code. **Cons:** directly
contradicts AB#129's own acceptance criteria ("the same seed and placement set produce the
same order on every server, request, and page") and the CDN-caching requirement: a
prerendered page would serve a different order per render, and two visitors sharing one
cached response would disagree with the order any dynamically-fetched continuation page
computes next. **Rejected outright**, included only because "no seed at all" is the
degenerate case the determinism requirement rules out.

## Trade-off Analysis

**Bounded reads against instant rotation.** Every alternative to materialization (B, C)
trades away the bounded-query property this codebase has already built two stories (AB#67,
AB#134) specifically to establish, in exchange for a rotation that takes effect the instant
the seed changes rather than after a recomputation pass. Given AB#114's own acceptance
criteria require the ~400-placement fixture to paginate correctly under the seeded rule
*without loading the complete gallery*, that trade is not close: a materialized field is
the only option that satisfies the stated requirement at all.

**Reusing cursor machinery against inventing new scope fields.** Folding the seed into
`ordering` (§4) costs nothing new in `gallery-pagination.ts` and produces exactly the
failure class (`wrong-scope`) a reseed should produce, by the same reasoning `normalizedFilter`
already carries section identity. A separate `seedVersion` scope field was considered and
rejected only because it duplicates information `ordering` already carries once `orderingSeed`
is embedded in it — two fields that must always change together are one field with a
composed value.

**Where this could be wrong.** If a deployment needs a gallery large enough that a full
`shuffledOrder` recomputation pass becomes operationally expensive at rotation time, this
decision does not size that job — AB#129 would need to bound or chunk the recomputation
itself; nothing here prevents that, but nothing here schedules it either.

## Consequences

**Easier**

- AB#114's Sanity adapter can apply a per-gallery ordering rule as a choice of sort field,
  reusing its bounded-query shape unchanged between `manual` and `seeded-random`.
- A cursor issued under one seed cannot silently continue into another (§4), with no new
  cursor-decoding logic.
- AB#129 has a settled contract to implement against: what field to write, what triggers a
  write, and what a rotation is allowed to invalidate.

**Harder**

- A seeded gallery needs a materialization step (schema field plus a recomputation
  mechanism) that a manual gallery never needed — real, additional implementation work,
  deliberately left to AB#129 rather than folded into AB#114.
- Rotating a very large gallery's seed costs a batch recomputation, not an instant toggle.

**To revisit — migration triggers**

- **A deployment needs to preview a re-seeded order before committing it** (e.g., before
  publishing) → this ADR assumes rotation is immediate on publish; a staged/preview
  rotation would need its own scope field rather than reusing `orderingSeed` directly.
- **Recomputation cost becomes operationally significant at scale** → AB#129 would need to
  chunk or defer materialization; this ADR's field-per-placement shape does not by itself
  prevent that, but does not solve it either.

## Action Items

AB#129 ships in two PRs (like AB#140): PR1 is the pagination core, the keyed function,
and the mock fixture; PR2 is the Sanity side (`shuffledOrder` stored field, recompute
on rotation, GROQ keyset, and lifting the adapter/Studio guards).

1. [~] The keyed deterministic function is done (`src/lib/gallery-shuffle.ts`,
       `computeShuffledOrder` — HMAC-SHA256 of `placementId` keyed by `orderingSeed`,
       fixed-width lowercase hex), and the mock fixture materializes it once per
       gallery build (PR1). The **stored** `shuffledOrder` field on the
       `galleryPlacement` Sanity schema and the recompute-on-`orderingSeed`-change
       mechanism are PR2.
2. [x] `gallery-pagination.ts`'s boundary key is generalized to the tiered
       `(pinnedTier, key, placementId)` triple: `GalleryOrderingBoundary`,
       `GalleryWindowRequest.after`, and the `GalleryCursorCodec` all carry it, with
       the tier recoverable from `key`'s type so `keyset-cursor.ts`'s wire format (and
       the category-listing cursors sharing it) is unchanged and a pre-AB#129 `manual`
       cursor still decodes byte for byte (PR1, pinned by a frozen-cursor test).
3. [~] For the mock, the seed rides in `GalleryCursorScope.ordering`
       (`orderingScopeString` → `seeded-random-v1:<seed>`), so it is part of the cursor
       digest and a reseed fails an in-flight cursor as `wrong-scope` (PR1). Wiring the
       **Sanity fetch cache** key/tags to `orderingSeed` end to end is PR2, where that
       cache actually exists.
4. [x] AB#114 reads `orderingRule`/`orderingSeed` from the gallery document and composes
       `GalleryCursorScope.ordering` per §4 for both rules, but implements the bounded
       windowed query only for `manual` — a gallery whose `orderingRule` is
       `seeded-random` is out of scope for AB#114's adapter until action item 1 lands.

**PR2 also owns the rotation-consistency protocol** the "To revisit" note flags: a reader
must never see the new seed with stale keys, or a half-recomputed mix. PR1's
`shuffledOrder` shape is seed-agnostic and forward-compatible with a generation/version
marker if PR2 needs one; nothing in PR1 depends on rotation being atomic because the mock
fixture is static.

## What this ADR did not establish

- **The dynamic/virtual keyword-gallery query contract.** AB#66's acceptance criteria also
  cover canonical-keyword selection, allOf/AND semantics, alias/duplicate/ancestor
  collapsing, and the empty/unknown/over-limit error contract for a keyword-driven gallery.
  None of that is decided here — this record resolves only the ordering-rule clauses that
  were blocking AB#114. AB#66 stays open for a follow-up ADR covering the rest.
- **The exact keyed function that turns `(orderingSeed, placementId)` into `shuffledOrder`.**
  §2 fixes its properties (deterministic, keyed, computed independently per placement);
  choosing and testing the concrete function is AB#129's.
- **How large a recomputation batch is safe to run inline versus deferred.** Left to AB#129
  to size against whatever store operation actually performs it.
