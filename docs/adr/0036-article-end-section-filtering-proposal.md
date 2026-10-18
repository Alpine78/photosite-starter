# ADR-0036: Optional article-end section filtering

**Status:** Accepted
**Date:** 2026-10-18
**Deciders:** Project owner
**Work item:** AB#360 under AB#27; bounded use case AB#321

## Context

AB#321 requests exact author-assigned star filters for one retained article,
including its pictures, review text, viewer sequence and pagination. This is
separate from AB#26 reader voting. AB#195 completed requirements refinement;
it did not approve a new content variant or the decisions in
[the review-catalog register](../review-catalog.md).

Original-source verification is already complete for this collection (AB#321,
discussion 66008). There are 41 unique items in five disjoint groups: 1 star = 2,
2 = 6, 3 = 7, 4 = 16, 5 = 10. The original interaction selects one exact group or
All. There are no fractional, unrated, overlapping or hidden-from-All items.
These are source facts, not an inferred rating scale for every future collection.
The retained backup SHA-256 is
`de1c60e148a38dffbe19b6b9e48af5c4097d47518958731455eb6a0080a7c600`.
The private normalized mapping records the source body SHA-256
`fc871a6d3b90ed95fda60199d13fb32055440918eb0021e6b2cd7314766fbcdf`.
Item-level source material stays outside Git.

At the proposal checkpoint, a bounded published Viewer read established that the current content is an
article with 41 visible end-gallery placements and no classifications. That
metadata read does **not** prove an exact source-item-to-current-placement/media
binding or parity of product titles and review texts. The source has both titles
and descriptions; the current placement model offers plain caption overrides.
A subsequent read-only preflight on October 18 bound all 41 original source
JPEGs by SHA-256 through retained import-verification evidence to the current
placements/media. Current asset references also match the retained post-import
snapshot. All original titles, short descriptions and full review texts occur
on the correctly bound current media after HTML decoding and NFC/whitespace
normalization preserving punctuation. The source files are separately retained
local images; they are not claimed to be inside the database/code backup ZIP.
The private preflight is recorded in AB#321 discussion `66410`, and the owner
acceptance in discussion `66425` (original membership evidence: `66008`). This proves the
bounded identity/text preflight, not rendered-layout acceptance or a current
CDN-byte audit. Item-level proof remains outside Git.

[ADR-0003's original AB#161 amendment](0003-public-content-tree-and-url-structure.md)
excluded sections and filtering from article end galleries. Current code still
follows that earlier exclusion: `article.endGalleryId`, separate ordered placements, a 24-item
manual keyset, and authenticated cursors; no end-gallery catalog or section query.
Standalone galleries already have a bounded generic section catalog. Their
indexing policy differs: article continuations always canonicalize to the
parameter-free article and are not indexable.

## Decision

**Owner-accepted decision, 2026-10-18:** extend only the optional article-end
gallery with generic single-section membership. Keep the article variant and
its body, identity, media bindings and manual occurrence order. Do not introduce
an independent review item, item detail route, numeric-rating system or poll.
This is a scoped accepted amendment to ADR-0003's exclusion of end-gallery
sections/filtering, recorded there in the dated October 18 addendum. The owner
explicitly accepted PR#516's decision as the implementation basis. This
acceptance authorizes reviewed implementation slices, not a CMS content write,
publication, broader catalog decision or closure of AB#27/321.

### Storage and editorial ownership

- Add an optional `article.endGallerySections` catalog, available only with an
  `endGalleryId`. Reuse the existing generic section identity/slug/label/order
  validation and maximum of 20 entries. This bounded slice omits section intros
  from both the editor and public model; the article already owns its prose.
- Add an optional singular `articleEndGalleryPlacement.sectionId`. It refers
  only to an entry declared by the containing localized article. All includes
  every visible placement, including unassigned ones; a selected view includes
  only that exact section. Membership never implies numeric rating semantics.
- Keep content ID, end-gallery ID, placement ID and placement/media identity
  bindings under their existing publication rules. A declared section ID stays
  stable once published; referenced entries cannot be removed while placements
  depend on them. Adding a catalog and assigning previously unassigned placements
  is allowed through a revision-bound checked batch. Membership can be corrected
  or cleared without re-identifying the photograph or placement.
- Localize labels and slugs deliberately. Among translations of one end-gallery
  ID that declare catalogs, require the same stable section-ID set and matching
  membership of shared placements; conflicting classifications are validation
  errors. A locale without a catalog is excluded from that comparison: its
  absent placement `sectionId` is valid, not a conflict. It cannot contain a
  dangling section reference. No supplied/reviewed localized labels means no
  catalog rather than invented translations. The initial source-backed
  application is the verified source locale, not translated review content.
- Published section IDs and slugs are immutable in this bounded slice, consistent
  with current Studio/runtime enforcement. A different slug needs a new section,
  checked membership changes and removal only after references are cleared; old
  selected links then 404. ADR-0003 describes a warned-change policy, but that
  action is not implemented today and is not added by this bounded implementation decision. First
  adoption also makes formerly incidental `section` values meaningful on that
  article; undeclared selectors can then return 404. Include these compatibility
  effects in the concrete content-change approval.

### Public URLs, indexing and language

On an article declaring a catalog, `?section=<localized-slug>` selects one exact
section; All omits `section`. A selection clears `cursor` and preserves meaningful
unrelated query state and the existing article hash where valid. Unknown,
repeated or malformed section state returns the existing non-indexable 404;
use the established validated path-normalization behavior. Articles without a
catalog retain their current treatment of incidental section parameters.

The parameter-free article remains the sole indexable article URL and canonical
for every selected or continuation view. Selected first pages and all cursor
continuations are `noindex` and omit hreflang; unfiltered initial pages retain
actual published alternates. Language switching drops both `section` and
`cursor` and uses the existing translation/fallback policy. This does not adopt
standalone galleries' self-canonical unfiltered-continuation policy.

### Bounded queries and authenticated continuation

Apply article identity, locale, visibility and selected section predicates before
fetching the existing page-size-plus-one window and boundary witness. Preserve
manual `(order, placementId)` ordering. Filtering only already loaded items or
fetching the whole collection is insufficient.

Keep existing unfiltered cursor scope unchanged, including
`article-end-gallery:<endGalleryId>`, to preserve compatible issued tokens. For a
selected section, use `article-end-section:<digest>` where the digest is SHA-256
of the unambiguous canonical JSON tuple `[endGalleryId, sectionId]`; retain the
existing HMAC codec and the remaining context fields. A fixed-length digest
fits the current 256-character scope limit even for an allowed long section ID.
It is a context discriminator, not access control or a replacement signature.

Resolve the localized slug to the stable section ID before cursor validation.
Cross-section tokens and a boundary that no longer belongs to the selected
section use the existing stale/invalid-cursor 404 response. Appends and unrelated
non-boundary edits retain the existing durability guarantees; a catalog change
must not silently widen the result to All. No global cursor-version bump or
unrelated ordering change is proposed.

The existing `GET /api/article-gallery` keeps a canonical parameter-free article
`path` and mandatory opaque `cursor`, adding only optional single `section`
**slug**, aligned with the page URL. Keep strict allowed keys, value cardinality,
origin checks and `no-store` behavior. Initial filter selection uses the real
server-rendered article route; no new first-page API is needed.

### Interaction and accessible fallback

An article with a catalog also declares a bounded plain-text localized
`endGallerySectionHeading` (maximum 160 characters), used as both the visible
filter-group heading and its accessible name. This is content-owned, with no
product identity hardcoded in a component. For the source-backed star use case,
the approved heading must explicitly identify the **author's product rating**,
as AB#321 requires; generic “Gallery sections” is insufficient. Other categorical
uses supply their own meaningful heading. UI controls (All, loading, loaded
results, more available, empty state) use the existing Finnish/English UI copy
boundary; heading/section translations require reviewed content. Show the
selected section label, or the localized All label, with the result state.

Render real section links for no-JavaScript navigation. Hydrated selection keeps
the controls at the reading position, resets continuation and viewer state,
and preserves correct URL/Back/Forward behavior. Reuse the existing gallery
scroll/focus safeguards, including short-result document-height clamping and
rejection of late replies after rapid changes. Focus remains on the selected
control; expose selection and announce the newly loaded result politely.

No whole-collection or per-section total counts are promised by this slice:
announce only the number actually loaded and whether more results are available.
Show an explicit empty state. Verification of the retained 41-item source and its
five group counts is a separate acceptance check, not a per-control query shape.
The viewer contains only selected loaded placements; standalone article pictures
and body minigalleries keep their independent groups. Public derivatives, native
ratios, captions and existing presentation settings remain governed by the
current media contract.

## Options Considered

1. **Optional generic article-end sections (recommended).** Reuses the existing
   article and section concepts for the explicitly prioritized retained use case.
   Requires a scoped storage/URL/cursor amendment and source-bound content work.
2. **Dedicated author-rated catalog variant.** Fits the broader AB#27 concept of
   reusable rated items and optional detail views. It also requires decisions on
   identity, rating semantics, routing, editorial fields and migration beyond the
   bounded request; those decisions remain in K1–K10 rather than being implied.
3. **Defer until the full catalog is decided.** Preserves today's article contract
   but leaves the explicitly requested source-backed filter unavailable. It is
   the fallback if the owner rejects the extension or text-parity preflight shows
   this model cannot represent the review content faithfully.

## Trade-off Analysis

The recommended extension is generic categorical filtering, not a completed
review-catalog platform. It cannot offer numeric rating queries, reusable product
entities or product detail routes without another decision. It avoids converting
a published article or inventing new source classifications, while adding a
permanent query parameter and membership contract that must be maintained.

Keeping the article's indexing and cursor policies avoids a second article
canonical and preserves compatible All tokens. Localized slugs support readable
links but remain immutable after publication in this slice; stable IDs bind
tokens across label edits. Separate bounded predicates cost more implementation
work than client filtering but are required to cover the entire collection with and without JS.

## Consequences

No application, schema, Studio, CMS content, provider, dependency or deployment
changes result from this decision record. Existing D2 diagrams continue to describe the
running system; no external or layer boundary changes are proposed. The owner acceptance
authorizes subsequent small reviewed implementation slices, not a content
write, automatic publication, invented translation or parent-story closure.

If exact source/current identity binding or complete image/title/review-text
parity cannot be demonstrated using this contract, stop before dependent code
or content migration and return the text/model question to the owner. A plain
caption field must not silently flatten unsupported review structure or drop
text. Do not classify by filename, current order or caption guesses.

## Action Items

1. **Complete, 2026-10-18:** the owner accepted this scoped ADR-0003 amendment
   and the decision is recorded in both ADRs.
2. **Identity/text preflight complete, 2026-10-18:** all 41 source images have
   exact retained-hash/current-placement bindings and complete title/review-text
   parity as described above. Review concrete localized labels and rendered
   layout in the content-change plan; stop on ambiguity or loss.
3. After the decision and preflight, deliver storage/editor validation plus
   projection/query/cursor tests as one bounded slice. Include absent catalogs,
   unassigned items, malformed selectors, cross-section/stale cursors, locale
   conflicts, old All tokens and page boundaries spanning all 41 items.
4. Add server-rendered controls and progressive interaction in a separate slice.
   Verify no-JS, keyboard, screen-reader state, viewport stability, rapid changes,
   Back/Forward, independent viewers, empty/short results, Chromium/WebKit and
   mobile/desktop against production builds with project fixtures.
5. Prepare a revision-bound dry run, backup and exact membership/text change plan;
   obtain concrete owner approval before any CMS write. Use a checked batch for
   catalog/placement consistency. No item-level source data enters Git or traces.
6. Verify All = 41 and exact groups = 2/6/7/16/10 with complete text/image parity
   on the real content. Only accepted, merged and verified delivered slices move
   their tasks to Closed; AB#27 and AB#321 retain their wider remaining criteria.
