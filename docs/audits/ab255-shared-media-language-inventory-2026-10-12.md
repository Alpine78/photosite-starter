# AB#255 — Shared public media text, initial inventory, 2026-10-12

After PR #347 and #348 merged, the owner requested all independently feasible
continuation worktrees. This first shared-media slice inventories published
records passing the existing public-media eligibility predicate; consumer
reachability and occurrence overrides are later subslices. AB#255 stays Active.

## Observed fields

Two matching, complete, count-bound reads found **5,272 media documents**, all
passing `publiclyRenderable == true` and the absent/null/false `privateOnly`
condition. No document was excluded by that predicate. This is a record
universe, not a count of photographs currently used on Finnish/English pages.

| Shared text field | Both FI/EN | FI only | EN only | Absent in both |
| --- | ---: | ---: | ---: | ---: |
| Alternative text | 4,585 | 687 | 0 | 0 |
| Optional caption | 800 | 678 | 1 | 3,793 |

Within both-present pairs, 280 alt strings and 195 captions are identical.
Proper names, identifiers or intentionally neutral copy can be identical; this
is an editorial review signal, not an automatic translation failure. Every
observed entry uses the declared localized-text shape with nonempty value,
unique keys/languages, and a valid language subtag. Media identities are unique.
Presence does not establish semantic correctness or what an image depicts.

The source projector's alternative text may fall back to the default language
for accessibility; a caption does not fall back. Those are verified code
behaviors, not acceptance of Finnish alt as an English translation. The audit
does not establish how many EN page consumers currently use that fallback.

## Remaining ownership

Resolve actual public-page consumers before prioritizing the 687 source-only
alt records and 679 one-language captions. Body media captions belong to the
article/gallery version; occurrence text uses the plain `captionOverride`
field on `galleryPlacement` and `articleEndGalleryPlacement`, not a shared
localized `caption` array. Those overrides and their consumers are not read in
this first slice. Capture-sequence membership, optional/dynamic discovery,
category descriptions, retained unlisted delivery and private-gallery text
also require their own scoped checks.

No image, rendition URL/dimension, binary, archive locator or private record was
requested. Consequently this is neither derivative-safety validation nor image
meaning review. No copy proposal is invented from unseen photographs. Owner
review and current draft/release reconciliation remain necessary before editing.

## Source receipt

Window: **2026-10-12T12:09:00.841Z → 12:09:08.296Z UTC**. Anonymous non-CDN
`published` GETs use API `v2025-02-19` and the previously verified production
target. Stable `_id` keyset pages contain at most 200 rows. Counts before/after
each pass, complete identity/revision sets and both payloads match. The scoped
source fingerprint is
`97bb2d73a57cfee908c2926bb49a90180cff98b9e1faa2e5127a37f87f29dfc6`.
The 20,000-row and 16 MiB serialized-data caps were not exceeded; cap/drift
failure stops the run rather than yielding a truncated inventory.

Queries, both graphs, revision bindings, count receipts and the per-record field
matrix stay ignored in this worktree's `temp/bilingual-continuation/`, restricted
to the owner. Real copy, provider/domain identities and individual revisions do
not enter Git. Preserve the complete local evidence before worktree retirement.

Later authoring must refresh sources/variants and coordinate
[ADR-0030](../adr/0030-legacy-identity-retirement.md)'s accepted map and operational
freeze/compatibility gates. The other agent's AB#260 proposal is not a freeze or
write approval. Changed revisions invalidate these bindings, including changes
to fields outside this projection. No CMS write, publication, package/schema
change or production activation occurred. Source/shape/count, privacy, local
link and whitespace checks apply; application tests/build were not rerun for
this documentation-only subinventory. Main CI #824 at `811acc8` verifies the
merged starting commit, not this new audit. Broader all-pages coverage remains
unfinished.
