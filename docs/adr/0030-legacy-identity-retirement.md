# ADR-0030: One-time retirement of legacy-derived domain identities

**Status:** Accepted
**Date:** 2026-10-12
**Deciders:** Project owner (Ilkka Rytkönen)
**Work item:** AB#257

## Context

AB#256 makes Studio lists readable. AB#257 investigates descriptive names for
the remaining Joomla-derived identity fields. A legacy-named string does not
require a running Joomla installation. Renaming it is a data-contract migration.

ADR-0002 §1 separates permanent photograph and occurrence identities. ADR-0003
separates content/category identity from language, name and URL; ADR-0008 links
language siblings. ADR-0009 derives seeded ordering from `placementId`.
ADR-0013/0017 and gallery/article cursors bind identities into sort keys and
scope. Publication validators enforce these contracts. The owner accepted the
exact mapping and full domain scope on 2026-10-12. The conditional, one-time
exception below leaves ordinary publication validators in force; implementation
and Production writing require separate acceptance.

### Verified discovery evidence

An authenticated single-request document export on 2026-10-12 at
05:20:51–05:21:00 UTC contained 16,947 documents. Its complete `_id`/`_rev`
index matched a subsequent raw query. It includes one settings draft, no
release variants, 5,158 image assets and 5,272 shared media records. All 19,063
discovered `_ref` values resolve. These are observations of this snapshot.

| Identity family | Distinct old identities | Fields containing them |
| --- | ---: | ---: |
| `contentId` | 24 | 30 |
| `categoryId` | 12 | 12 |
| `endGalleryId` | 20 | 25 |
| `placementId` | 1,485 | 2,326 |

The complete private candidate map proposes 2,393 field changes in 2,368
documents. It has no target collisions, old-to-new swap chains or unidentified
string consumers. A whole-document substring scan classifies 2,393 domain-field
occurrences and 4,682 deliberately preserved technical `_id`/`_ref` occurrences.
Human text, `_key`, URLs and unrelated identities are not rewritten.

An offline copy with only the proposed fields replaced preserves every other
document value and reference. Before/after comparisons found no order changes
in 27 affected occurrence containers or five content-listing/category sibling
groups. All affected curated placements are manual; zero affected containers
are seeded. New seeded ordering or tied-order changes at freeze require new
calculations and review; these observations do not validate that future case.

Private evidence lives under the ignored worktree `temp/identity-retirement/`:
`candidate-map.json`, `verification-summary.json`, `listing-order-evidence.json`,
`reference-inventory.json`, and `source-artifact-inventory.json`. The last file
inventories 99 available source/approval/plan/recovery artifact locations; their
presence establishes neither current approval nor a successful restore. Real
titles, slugs, source paths and the full mapping stay outside Git.

- Document snapshot SHA-256:
  `df2e1bec8f5a7650922bc4cbc6ebe91460f0bdf2af9ba966c32c8da86b1d7090`
- Candidate-file SHA-256:
  `ee799ba63ea453749f2715f7ed6f6e2e65ca4389c47825f3963f5433d0b46e41`

This export contains documents and asset metadata, not asset binaries or deleted
history. It is not a verified binary backup. Sanity documents that a normal
single export request captures request-time state; cursor-mode export has
different consistency limits. See the [Export API](https://www.sanity.io/docs/http-reference/export).

### Code and artifact consumers

| Consumer | Verified dependency / consequence |
| --- | --- |
| `sanity/schemas/content-placement-validation.ts:520`, `category.ts:98`, `gallery-placement.ts:303`, `article-end-gallery-placement.ts:129` | Published identity checks prohibit ordinary renames. Preserve these validators through any accepted operator exception. |
| `src/lib/sanity-content-tree.ts:386`, `sanity-article.ts:197` | Category-reference projection, language identity and event-date/content-ID ordering. |
| `src/lib/gallery-pagination.ts:298`, `article-end-gallery-pagination.ts:45`, `content-listing-cursor.ts:125` | Binary ID ordering and authenticated cursor scope/boundary inputs. |
| `scripts/recompute-shuffled-order-plan.mts:29` | HMAC-SHA256 over placement identity; assess seeded materialization explicitly. |
| `src/lib/enquiry-media.ts:279`, `locale-prefix-request.ts:298` | Curated enquiries and `?enquire=` identify an occurrence, not just an image. |
| `src/lib/site-navigation.ts:174`, `sitemap.ts`, `sanity/schemas/site-link.ts:44` | Tree identities resolve route components; static navigation hrefs are paths. `siteSettings.featuredGalleryId` must follow a mapped content ID if it targets one. |
| `src/lib/legacy-redirects-data.ts`, `legacy-redirects-tracking.ts` | Legacy pathname mapping/accounting; verify destinations against the new tree. |
| `src/lib/sanity-cache.ts:15` | Shared representation cache tags; invalidate affected representations and coordinate reader/API generations. |
| `scripts/joomla-import-manifest.mts:258`, `joomla-import-plan.mts:473` | Manifest content identities also generate provider IDs. Changing only `content_id` can create new documents instead of addressing retained ones. |
| `scripts/write-joomla-content.mts:1864` and category/foundation/service writers | Existing non-media reimport uses `createOrReplace` by planned `_id`; old plans can restore old fields. Retire or adapt these paths before cutover. |
| Intro recovery, rally import/conversion plans, receipts, manifests and snapshot/export archives | Preserve historical approved inputs/digests. A new recovery/reimport generation requires the accepted identity/document mapping and fresh approval. |

## Decision

**Accepted decision:** rename all 1,541 mapped project-owned domain IDs while
retaining Sanity `_id` and `_ref`. The owner selected “Kaikki 1 541 domain-ID:t;
Sanityn dokumentti-ID:t säilyvät” in response to the exact map/scope question.
Acceptance binds the candidate-file and snapshot SHA-256 values above.

The original private JSON remains unchanged, marked `writable: false` and
`owner-review-required`. Its generation-time status is superseded by the separate
`owner-approval-2026-10-12.json` receipt, which binds those digests and records that
Production writing is not approved. These are review evidence, not an importer plan.
This discovery implements no runtime migration tool, writer or schema relaxation.

The owner accepted both scopes:

1. **Pages and categories:** 24 content, 12 category and 20 end-gallery identities;
   67 fields in 42 documents. This is the smaller part of the scope. It still affects
   content/category cursors and identity-based links.
2. **Occurrences:** 1,485 placement identities in 2,326 documents, completing
   domain-prefix retirement with extra ordering and enquiry-link consequences.
   Together the scopes cover 2,393 fields in 2,368 documents. Scope acceptance
   does not approve writing them.

### Candidate naming policy

Use an explicitly selected content-language subtag (`fi` in the approved map) and
the existing authored slug. Missing/conflicting preferred-language metadata
blocks a candidate; no translation or fallback is invented. Only already-valid
lowercase ASCII, single-hyphen slugs are used. No case folding or transliteration
changes an authored slug or public URL.

Synthetic examples: `article-coastal-visit`, `gallery-coastal-visit`, and
`category-trips`. Root names have a 64-character minting budget. A deterministic
eight-hex old-identity suffix resolves truncation/collision, followed by an
injectivity/reserved-name check; this snapshot required neither. End galleries
use `<article-id>-end` within 128 characters. Occurrences use
`<container-id>-image-<original import serial>` within 256 characters. An absent
or ambiguous serial blocks its candidate. The serial is its original occurrence
number, not current `order`; reordering never remints it.

After an accepted cutover these identities remain permanent. Future titles,
slugs, category moves and translations never rename them. Preserve shared
language identity and absent language versions exactly as observed.

## Options Considered

| Option | Benefits | Costs / selection status |
| --- | --- | --- |
| Keep identities and use readable previews | AB#256 already supplies useful names; no identity migration | Legacy values remain in technical fields. Credible lowest-cost option. |
| Rename domain IDs, preserve Sanity documents | Descriptive domain names; existing references/history retained | Selected by the owner for both scopes; conditional one-time exception, reader compatibility, import retirement and verified cutover/rollback required. |
| Replace both domain and Sanity identities | Removes origin text from internal Studio document URLs too | `_id` is immutable: requires replacement documents, reference rewrites and draft/release/history/cleanup decisions. No need established for this extra migration. |

Sanity's [ID contract](https://www.sanity.io/docs/content-lake/ids) prohibits
patching `_id`. Retaining it preserves the document's existing identity/history
and does not remove every internal legacy string.

## Trade-off Analysis

Readable domain names improve manual inspection. Occurrence renames dominate
the write count and add less editorial benefit after AB#256. The owner explicitly
accepted their inclusion with the page/category scope. Matching titles or images
never justify deletion or deduplication. Preserve identity equivalence, media/container binding,
native-ratio delivery and availability rules.

An unchanged manual `order` alone is insufficient: ID tie-breaks can move items.
Seeded HMAC keys change when IDs change. Current comparisons cover this snapshot;
a future writer must repeat them on frozen data. No production order preservation
is claimed by this offline evidence.

## Consequences

The dated amendments to ADR-0002 §1 and ADR-0003's permanent content/category
and end-gallery contracts permit this exact one-time mapping only after all
implementation and cutover gates below pass. The original permanence rules
continue to govern ordinary edits and every subsequent rename. ADR-0008's sibling
equivalence and ADR-0009's HMAC algorithm stay intact; record their cutover inputs
and operational consequences. No schema or validator change is authorized here.

Only listed domain fields may change. Keep `_id`, `_ref`, `_key`, slugs, parent
references, media IDs, asset bytes/metadata/dimensions, captures, captions,
visibility, manual orders/seeds, poll/service/operational state and system
documents intact. ADR-0028's retained JPEGs/ZIPs, metadata preservation, expiry
limits and public-file exception receive no new permission or reclassification.

### Required implementation and cutover gates

1. **Confirm the accepted map and freeze.** Scope and candidate-map acceptance
   are recorded above; alias implementation/retention, the operational plan and
   actual cutover still need separate acceptance. Bind current authoritative
   source manifests, receipts and recovery generation. Stop editorial/import/other
   writer activity before rehearsal and through cutover. Refresh the complete raw
   snapshot and all draft/release variants, and reconcile changes against the
   immutable approved map. Changed targets or additional mapped fields/documents
   require a reviewed delta and renewed owner acceptance; today's counts cannot
   waive this. Never regenerate the approved artifact in place.
2. **Retire unsafe reimports.** Disable old live-write paths or apply both the
   accepted domain map and retained provider-document map. Unmapped old input
   fails. Reminting `_id` from a new manifest ID is forbidden. Preserve old
   approved artifacts as history; approve a new generation explicitly.
3. **Rehearse recovery.** Take a current full backup with asset binaries and
   demonstrate restore into an owner-approved isolated target before rewriting
   Production. Inventory target data first. Apply the accepted mapping there
   through the proposed guarded writer and reader/import transition; validate
   all references, routes, language variants, media/legacy bytes and complete
   ordering. Exercise interruption/resume, concurrent-edit rejection and guarded
   rollback on that copy. Bind its receipts and evidence digest to the accepted
   map and cutover approval. No restore or migration rehearsal has been performed
   by this discovery.
4. **Prepare reader compatibility.** Separately review a bounded server-side
   old-to-new alias lookup for enquiry links and API identity inputs, preserving
   validation/visibility/locale guards. Paths and old bare numeric Joomla
   lightbox queries retain their existing ADR-0003/AB#19 policy. Old authenticated
   continuation tokens use the existing stale/mismatched-scope 404 and restart
   navigation; never translate boundaries into success that could skip/repeat
   items. Agree on alias retention before writing; external bookmarks/messages
   have not been inventoried or assumed absent.
5. **Classify batches.** Refresh non-CDN raw data, identity indexes, references
   and ordering evidence. Use the immutable approved map to classify records as
   old, already-new or conflicting; mixed fields/unexpected values or revisions
   stop the batch. Reminting a proposal is not a resume mechanism. Abort if
   affected drafts/releases now exist until their treatment is explicitly
   accepted. Record per-batch receipts.
6. **Apply and verify.** A separate bounded writer patches listed fields at the
   original `_id` with `ifRevisionID`, never blind replacement or asset uploads.
   Atomicity covers one transaction, not a multi-batch job. Capture post-write
   revisions from mutation receipts. Establish verified raw read-back despite
   eventual query consistency before success. Verify references/routes, missing
   languages, complete order and media/legacy data; invalidate representation
   caches and test fresh pages and retained old inputs against the new reader.
7. **Rollback deliberately.** Retain original fields and receipts. Restore only
   listed fields using each recorded **post-write** revision, stopping on
   concurrent edits. Preserve the settings draft and unrelated later documents.
   Classify untouched/completed/conflicting records against the approved map.
   A dataset import alone does not prove exact rollback: reconcile extra records
   and verify assets.

Sanity's [transaction documentation](https://www.sanity.io/docs/content-lake/transactions)
explains revision guards, per-transaction atomicity and query consistency. These
are future implementation requirements, not evidence that a writer exists.

## Action Items

- [x] Inventory raw data, references and available source/recovery artifacts.
- [x] Produce the complete private candidate map and offline field/order evidence.
- [x] Document code consumers, alternatives, cutover, resume and rollback requirements.
- [x] Record owner acceptance of all 1,541 domain IDs, exact map digest and the
  conditional, dated ADR permanence amendments (AB#257 AC2, 2026-10-12).
- [ ] Bind source freeze and prove current backup/restore rehearsal.
- [ ] Separately scope and review reader/import compatibility and guarded writer.
- [ ] Perform a separately approved cutover and verify recovery/retirement records.

AB#257 remains Active until the owner reviews and commits these documents and
the planning change merges. Accepted planning scope does not authorize a live write.
