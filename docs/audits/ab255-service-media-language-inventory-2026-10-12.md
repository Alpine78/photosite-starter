# AB#255 — Service cover language inventory, 2026-10-12

The owner selected service-image FI/EN alternative text and caption coverage
after [PR #342](https://github.com/Alpine78/photosite-starter/pull/342) merged.
The ordered integration followed #341, resolved the shared status conflict,
and recorded the accepted identity plan's authoring constraints. Integration
commit `c7cfe6a` passed required Azure Pipeline #810; merge `26b906b` has the
same reviewed and tested tree. AB#255 remains **Active**.

## Published observations

Two matching scoped reads covered **11 published service versions**, their
**8 distinct shared cover media documents**, and each cover's direct published
document references. All 11 service versions have a cover; none is hidden from
service listings in this read. Service coverage remains **8 FI / 3 EN** across
eight identities; the five proposed English counterparts are still local copy.

| Cover text / reference observation | Count |
| --- | ---: |
| Shared covers with nonempty FI and EN alternative text | 8 / 8 |
| Covers missing FI or EN alternative text | 0 |
| Covers with identical FI/EN alternative strings | 0 |
| Covers with captions absent in both languages | 8 / 8 |
| Covers with a caption in only one language | 0 |
| Current published service versions needing alternative-text fallback | 0 / 11 |
| Unresolved, wrong-kind or non-public cover metadata | 0 |
| Observed localized-field/key or service-language defects | 0 |

Both-language alternative strings exist; this is **presence**, not accepted
translation quality or proof that either describes the photograph correctly.
Captions are optional: absence in both languages is not a missing translation.
No caption text was invented. The existing reader falls back to deployment-default
FI for unavailable requested-language alt, while captions never fall back.
The inventory checks exact language keys and the first matching entry, rather
than counting fallback as English. No duplicate language/key, malformed/variant
language, unusable text or repeated media identity was observed within this scope.

The consumer scan found **11 distinct published documents, all services**.
Five covers have one referring service version each; three have two. All three
currently paired FI/EN service identities reuse the same cover. A shared-media
text edit affects both versions; it does not belong only to a new English draft.
This scan observes direct document references, not transitive reachability,
rendered pages, draft/release consumers or authorization boundaries.

All five earlier [copy proposals](ab255-english-copy-drafts-2026-10-12.md) still
match their published service source revisions and cover references. Their five
distinct covers already have FI/EN alt. The shared category was not refreshed by
this cover scan; its identity/revision still needs the separate authoring check.

## Reproduction and limits

Source window: **2026-10-12T07:50:20.550Z → 2026-10-12T07:50:24.760Z UTC**.
The target is the same locally verified Production content target as the prior
census and copy preparation: tokenless, non-CDN GETs, `published` perspective,
API `v2025-02-19`, dataset `production`, deployment-default language `fi`.
Both complete passes have source fingerprint
`54b015c59d8c62b25b0d22a09fe6b490c1f87a65400fe2c368120b4d047172db`.

The bounded service query projects only identity/revision, language, cover
reference and listing visibility. Per-reference reads retain the raw localized
alt/caption arrays plus media identity/kind/visibility metadata. Each consumer
query uses **one cover ID**, `references($id)`, a provider count and `_id`-ordered
keyset pages of at most 200 rows. Counts, resolved references, revisions and
the complete scoped graphs match across both passes. The existing HTTP helper
enforces the GET URL limit and timeout; no credentials, asset URLs, image bytes,
archive locations, dimensions or private-gallery contents were requested.

Published reads cannot reveal pending draft/release edits. Media flags are not
complete derivative validation; this audit proves no image delivery, visual
semantics, HTTP journey, deployment or full-site translation acceptance.
Changed service/cover sources or references invalidate this scoped observation.

## Owner handoff

Exact queries, call times, both scans, revision bindings, the detailed FI/EN
workbook and recomputed inventory/validation are ignored under this worktree's
`temp/service-media-language-audit/`. Real image text, service/media identities
and provider document IDs/revisions stay outside committed prose. The owner-only
files must be preserved before any worktree retirement under AGENTS.md.

Review actual photographs alongside the workbook before accepting their wording.
Before later shared-media editing, reconcile live drafts/releases and refresh
the direct-consumer graph. Coordinate all CMS authoring with
[ADR-0030](../adr/0030-legacy-identity-retirement.md)'s writer freeze and approved
mapping/source refresh; service and media identities are outside its mapping.
No missing cover-text entry needs to be authored based on this observation.
Service/category copy acceptance and CMS authoring, the 18 article counterparts
and other page families remain open. No CMS write, publication or deployment occurred.

Applicable checks: two matching complete scans, independent counts, source/hash
binding, aggregate recomputation, six synthetic malformed/optional-field cases,
local links, private-value exclusion and whitespace checks. This is a documentation
slice; runtime gates were not rerun for it. Pipeline #810 covers the merged base,
not these new documentation edits.
