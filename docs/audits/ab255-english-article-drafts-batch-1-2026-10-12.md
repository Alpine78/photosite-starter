# AB#255 — English article copy, batch 1, 2026-10-12

The owner selected article English drafts alongside a separate public-gallery
text inventory after [PR #345](https://github.com/Alpine78/photosite-starter/pull/345).
That PR merged as `883f87b` after required Azure Pipeline #816 and a clean
integration review; its merged tree matches the reviewed/tested candidate.
AB#255 remains **Active**. This batch prepares local editing suggestions;
it does not create Sanity drafts or a translation feature.

## Selection and prepared copy

Two matching published reads still find **28 FI / 10 EN article versions**:
28 identities, of which 18 lack a published English counterpart. All 18 have
blocks outside the initial paragraph/heading/media-only preference; 15 also
declare end galleries. The first batch therefore contains **one complete
article-owned text proposal**, retaining its additional poll block and making
its dependencies explicit, rather than dropping source content.

Selection sorts FI-only articles by Unicode character count of owned
title/summary/body text, then stable `contentId`. The shortest has 6,795 source
characters. A narrowly scoped Viewer read of raw article identity/revision/
language metadata finds one published FI version and no associated draft,
release edit or EN version for this selection. Both metadata passes match;
all 18 observed published FI revisions still match the earlier body reads.
This establishes only the queried article variants within that window.

| Prepared article-owned field | Proposal |
| --- | ---: |
| English title and first English slug | 1 each |
| Paragraphs | 15 |
| Headings, preserving levels | 5 |
| Per-version media-block captions | 7 |
| Total body blocks retained, including the unchanged poll reference | 28 |

All 27 blocks owning prose have an English proposal. No summary is invented:
the source has none. Keys, block types/order, references, stable content identity,
cover, canonical category, optional end-gallery identity, dates and other
non-text fields remain unchanged. Numeric tokens and price/unit expressions are
retained, including the original decimal formatting for owner review. The
selected body has no linked spans or fragment links to remap. The proposed slug
passes syntax and the observed English canonical-sibling collision check;
this is not a complete route or rendered-page validation.

Seventeen other missing-English articles remain outside this small batch and
have a ranked local follow-up list. Published coverage remains **28 FI / 10 EN**.
The draft copy is neither owner-accepted wording nor a saved CMS document.

## Publication prerequisites

The shared canonical category still lacks EN label/slug. Its earlier English
label, first slug and description proposal matches the current source document
and revision exactly. That retained proposal is copied read-only into this
worktree and bound by SHA-256; it remains proposed, not authored or accepted.
No target article document ID or new reference is assigned.

The selected body/cover references seven shared media records. All have FI alt
and lack EN alt; optional shared captions are absent. Per-version caption
translation does not complete those shared records or establish image meaning.
The preserved poll is FI-owned and closed. An English page must not silently
reuse its Finnish prose/tally; an independent English poll/reference or approved
removal requires an editorial decision. No such change is made here.

The source's optional end gallery contains **41 FI-owned occurrences**. They
are not an English occurrence set; their shared-media text needs a separate
review. The local packet preserves occurrence/reference bindings, with no
asset URLs, image downloads or new occurrences. These end-gallery dependencies
are distinct from the parallel public `gallery` document inventory.

The source describes historical rating, filtering, heart and review controls.
Their faithful translation does not prove current UI support. The owner must
edit outdated instructions and review the source's humor/health assertion and
historical product/availability claims before publication. No new technical,
medical or product recommendation is inferred from the historical prose.

## Evidence and owner handoff

Published body/category/gallery-metadata window:
**2026-10-12T10:35:34.573Z → 10:35:35.967Z UTC**. Associated raw metadata and
selected published dependencies: **10:44:08.600Z → 10:44:09.733Z UTC** on the
same date. Bounded GETs use API `v2025-02-19`, dataset `production`, and the
previously verified target. The Viewer credential is used only for associated
article metadata, never stored, logged or used to fetch draft bodies. Body,
category and dependency reads are tokenless, non-CDN, published-only.
Scoped published source fingerprint:
`8777b6f85110c84d71a6a5ab5bbeb6c3b52023109818a91cf2128b173caba3f0`.

Both passes, queries, revision bindings, ranking, full FI/EN workbook,
non-executable/non-writable `suggestions.json`, previous category proposal and
structural/numeric validation are ignored under this worktree's
`temp/article-english-batch/`. Actual copy and provider identities/revisions
stay outside Git. A separate session retired the earlier copy worktree while
preserving its evidence; the retained suggestions matched their recorded hash
before being copied here. Preserve these owner-only files before retirement.

Review the local workbook and resolve every named dependency before later CMS
authoring. Refresh FI/EN drafts/releases and sources again at that point;
changed revisions invalidate copy bindings. Coordinate with
[ADR-0030](../adr/0030-legacy-identity-retirement.md)'s writer freeze and approved
map, refreshing identities/revisions after cutover. AB#258/259's offline tools
do not freeze or write the dataset. AB#125's linked authoring workflow is
separate from local proposed text; no automatic translation/publication is added.

Local checks cover matching reads, variant/category/source bindings, all block
keys/types/order/non-text fields, numeric tokens, candidate slug metadata,
private-value exclusion, links and whitespace. This documentation-only slice
changes no schema/runtime behavior and performs no CMS write, publication or
production activation; application tests/build were not rerun. Pipeline #816
verifies the merged base, not these uncommitted receipts. The other 17 article
proposals, this article's publication dependencies and other page families
remain open, so broad AB#255 cannot close on this batch.
