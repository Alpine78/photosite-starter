# AB#255 — Public gallery text language inventory, 2026-10-12

The owner selected public-gallery text coverage alongside a separate article
copy batch after [PR #345](https://github.com/Alpine78/photosite-starter/pull/345).
That PR merged as `883f87b` after required Azure Pipeline #816 and a clean
integration review; its merged tree matches the reviewed/tested candidate.
AB#255 remains **Active**. This inventory covers fields owned by published
`gallery` documents, with category metadata for their placements.

## Observed coverage

Two matching, bounded published reads found **64 versions / 32 identities**:
32 FI, 32 EN, no FI-only or EN-only identity, and no duplicate identity/locale.
Optional summaries and bodies have matching presence across every language pair.

| Document-owned field | Both present | Absent in both | Same text within the present pairs |
| --- | ---: | ---: | ---: |
| Title | 32 | 0 | 12 |
| Slug | 32 | 0 | 15 |
| Optional summary | 19 | 13 | 0 |
| Optional body | 30 | 2 | 0 |

Body extraction includes both plain text and linked paragraph spans. There are
165 body blocks: 90 FI and 75 EN, comprising 127 paragraphs and 38 headings.
Twenty pairs have equal block counts; ten have fewer EN blocks and two have
more. These differences require editorial comparison, not automatic copying:
independently authored versions need not have identical structures. Existing
body links number 13 FI and two EN; their destinations were not resolved or
probed in this text inventory. No tags are authored in either language.

The documents contain **208 section versions**. Matching by `sectionId` yields
103 pairs: 35 have distinct labels and 68 have identical labels. One gallery
pair has one FI-only and one EN-only section identity; the remaining section
identities match. The local workbook retains both structures for owner review.
No section has an introduction. A proper name, event name or identifier can
legitimately be identical in both languages; equality alone is not a translation
failure. No new translation suggestion was needed to fill a blank counterpart
in this observed field scope.

All document titles/slugs and section labels/slugs are nonempty. The narrow
metadata checks found no malformed slug, duplicate section ID, within-gallery
section-slug collision, canonical sibling document-slug collision, unresolved
canonical/secondary category or missing FI/EN label/slug on its ancestor chain.
No scheduled end date is present. These checks do not validate the complete
route tree, legacy redirects, rendered navigation or actual page availability.

## Remaining content owners

Owner acceptance of the existing title/summary/body/section wording remains
open, including the structural differences and identical-text review signals.
This scope does **not** inventory shared-media alt/caption/credit, curated
placement captions, image meaning, category descriptions, article end galleries,
retained unlisted deliveries, protected client galleries or administrator UI.
Those fields and surfaces remain part of the all-pages requirement. Gallery
document pairs and nonempty text are not proof of a fully bilingual page, SEO
output, filter/continuation journey or accepted translation quality.

## Evidence and authoring gate

Read window: **2026-10-12T10:35:33.130Z → 10:35:34.077Z UTC**. Tokenless,
non-CDN `published` GETs use API `v2025-02-19`, dataset `production`, and the
same locally verified target as the previous inventories. Separate count
queries bound each family; both complete passes match. Scoped source fingerprint:
`4f499a8b13fbccb145ddde2b51c5794fb157f1d17b217553005d63eeb29a0e18`.

Queries, both source graphs, revision bindings, the complete FI/EN field matrix,
comparison workbook and eight local synthetic assertions are ignored under
this worktree's `temp/gallery-text-language/`. Real copy, section identities,
provider identities and revisions remain outside Git. No credential, asset
URL/byte, archive locator, private document or curated placement was requested.
Preserve the owner-only evidence before retiring the worktree.

Published reads cannot see newer drafts or release edits. Before any later CMS
editing, refresh both language versions, draft/release state and all affected
text owners. Coordinate with [ADR-0030](../adr/0030-legacy-identity-retirement.md)'s
writer freeze and approved map; an ID/revision change invalidates the old
bindings. AB#258/259's offline tools do not perform a cutover or freeze writers.
This documentation-only slice performs no CMS write, publication, production
activation, schema change or runtime change. Local validation covers source
completeness, field classification, metadata checks, private-value exclusion,
links and whitespace; application tests/build were not rerun for these prose
edits. Pipeline #816 verifies the merged base, not this uncommitted audit.
