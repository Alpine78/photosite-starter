# AB#255 — English category and service copy preparation, 2026-10-12

The owner chose English category and service translation drafts after the
[public-language census](ab255-public-language-inventory-2026-10-12.md).
[PR #340](https://github.com/Alpine78/photosite-starter/pull/340) merged as
`e91e185` after #339, preserving both conflicting status sections. Its integration
commit `747fbb8` passed required Azure Pipeline #804; the tested and merged trees
matched the reviewed tree. AB#255 remains **Active**.

## Prepared editing suggestions

One shared category now has proposed English label, first English slug and
description entries. Five service counterparts have proposed names, slugs, short
descriptions, all **14 body paragraphs**, starting-price wording and pricing-row
names/wording. The category adds one description paragraph. Every item is marked
**proposed**, with source identity/revision and owner terminology/business notes.
These are local editing suggestions, not saved Sanity drafts or accepted copy.

The service/category field coverage is derived from their current schemas.
Stable identities, parents, order and existing source-locale fields are retained;
all five cover-media references and pricing-row keys are preserved. The current
schemas have no SEO fields; no extra SEO properties were invented. Shared cover
alternative text/captions remain an explicit owner-review item.

The category is **one document with language-keyed fields**, while a service is
**one document per language**, linked by `serviceId`. No target service document
ID or executable CMS mutation/write plan is assigned here. The current reviewed
migration writers are unsuitable for these full localization suggestions: the
service writer's field allow-list omits `coverMedia`/`hideFromListing`, and the
category writer cannot update this already-published category by creating it.
The preparation introduces no new authoring tool or translation engine.

## Verified source and limits

Two identical scoped, tokenless `published` GET reads from the same locally
verified Production target covered **11 service versions and 12 categories**;
independent provider counts matched. Source window:
**2026-10-12T06:02:01.455Z → 2026-10-12T06:02:02.203Z UTC**,
API `v2025-02-19`, dataset `production`. The source fingerprint is
`9301b55c722a5832643ba7ef68463f1c28b1fa4a0f7d6b661dea474d08609a61`.

Published coverage remains **8 FI / 3 EN services**, with five missing English
counterparts. The selected category still lacks its published English label/slug.
A separate published dependency count at **2026-10-12T06:11:14.535Z** found
**18 canonical article references**, no canonical galleries, no secondary
article/gallery references and no child categories. The 18 English article
counterparts remain later work after category placement is accepted/published.

Published reads cannot establish whether newer FI drafts or existing EN drafts
are present. Before later authoring, inspect both and reconcile owner edits.
A changed source revision invalidates its suggestion. Every slug is a proposal;
recheck published and draft sibling uniqueness and localized parent placement
when authoring. This preparation proves no live route, deployment or translation
acceptance. No CMS document, media, credential or production deployment changed.

## Validation and owner handoff

Structural checks bind every suggestion to its exact selected source revision,
preserve paragraph/pricing structure and references, compare numeric amounts and
currencies, retain starting-price qualifiers, and preserve extra-cost/conditional
offers. No tax statement was added to sources that state none. The existing pure
`buildServiceRoutes` accepts the candidate English graph of three published plus
five proposed service versions; the published count remains three. Category
parent placement and published sibling-slug checks also pass. These checks do
not accept wording or replace owner review of business details and media text.

The versioned private `suggestions.json` is the single copy source; a disposable
renderer produces the complete FI/EN `review-workbook.md`. Both, the two source
snapshots, exact queries, dependency counts and validation receipts are ignored
under the selected worktree's `temp/english-drafts/`. Owner-specific names, text,
slugs, document IDs and revisions stay outside committed prose. Preserve these
files before retiring the worktree under AGENTS.md's ignored-file gate.

Review the workbook, accept/edit the proposed wording and slugs, reconcile live
drafts/revisions, then author the category/service versions in a separate CMS
editing slice with media text review. Publication is a later accepted action.
This tracked patch contains documentation only, so runtime gates were not rerun
for the copy preparation; local evidence, links, privacy and whitespace checks
cover its changed surface.
