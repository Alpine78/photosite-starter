# ADR-0022: Capture-sequence rally galleries without placement documents

**Status:** Accepted
**Date:** 2026-09-23
**Deciders:** Project owner (Ilkka Rytkönen)
**Work item:** AB#165

## Context

The current curated-gallery model stores every occurrence of a photograph as its own
`galleryPlacement` document (AB#114). AB#114 moved placements off an embedded array
because the query engine loads a whole document to project it: a placement array cannot
be read as a bounded window. Each gallery language is its own document (ADR-0003
decision 7), so a bilingual gallery photograph costs **four** Content Lake documents:
the `sanity.imageAsset`, the `media` document (ADR-0002), the FI placement, and the EN
placement.

That cost now determines how much of the site a plan can hold. Measured and calculated
on 2026-09-23:

| Quantity | Documents | Source |
| --- | ---: | --- |
| Production, public read | 6,820 | live query; 3,350 `galleryPlacement`, 1,712 `media`, 1,712 `sanity.imageAsset`, 46 other |
| Remaining approved Joomla import (AB#137) | 5,466 | `remaining-document-candidates.json` plus one asset per media; 2,064 of it article end-gallery placements |
| 16–17 new rally collections, ~2,700 photos, at 4 documents each | ~10,800 | owner estimate × current cost |
| Sanity Free, per dataset | 10,000 | Sanity technical-limits page |
| Sanity Growth, included / technical maximum | 25,000 / 50,000 | Sanity pricing page / technical-limits page |

The audited Production count was 6,832. The public read cannot see drafts, which
accounts for the difference.

What the Production rally galleries actually contain, from the same live read:

- Every one of the 10 FI/EN rally gallery pairs is `manual`. All 3,350 placements carry
  a `sectionId`: 5–12 stage sections per gallery (for example `SS 3 Moksi 1`,
  `Huoltoparkki` / `Service Park`). FI and EN documents share section ids and slugs and
  differ only in some labels.
- No placement carries an `alt`, `caption`, or `credit` override. None is hidden and none
  is pinned. The per-occurrence fields the placement document exists to hold are unused
  here.
- 31 media documents are referenced by more than two placements, which means they appear
  in more than one gallery. The `Rally Finland 2001–2019` best-of reuses year-gallery
  photographs.

The owner exports each rally from Lightroom in capture-time order and names the files
with a running number. Across the eight remaining-plan galleries checked against their
import artifacts, the authored order follows that number almost everywhere:

- 2016 and 2021 match exactly.
- 2017, 2019 and Rally Estonia 2023 each contain one deliberate jump. In 2019, a
  service-park photograph numbered 0673 was placed after SS3.
- 2022 restarts its numbering in every stage.
- 2018 has 8 unnumbered files and 2019 has 15.
- Latvia 2024 and Secto 2023 were imported in other batches and have not been checked yet.

The authored order in these galleries is filename order with a handful of exceptions.
Nothing in them needs a per-occurrence document.

## Decision

**Add a third gallery ordering rule, `capture-sequence`. A capture-sequence gallery has
no placement documents. Its items are the `media` documents that name the gallery. They
are ordered by an owner-controlled, filename-derived sequence number and sectioned by a
media-owned section id. Media identity (`mediaId`) is kept unchanged.**

### 1. Membership and ordering live on the media document

A `media` document may carry one optional `captureSequence` object:

| Field | Meaning |
| --- | --- |
| `galleryContentId` | The language-neutral `contentId` of the one capture-sequence gallery this photograph belongs to. It is not a reference to a language document, so the FI and EN gallery documents read the same media. |
| `sequence` | A positive integer from the file name's four-digit running number, unique within the gallery. |
| `sectionId` | The gallery section this photograph belongs to. It uses the id the gallery document's own `sections` already declares, and is shared by both languages. |

One media document belongs to **at most one** capture-sequence gallery. It may still be
placed in any number of curated galleries through ordinary `galleryPlacement`
documents, because those placements are independent of this object.

The gallery document's `orderingRule` gains the value `capture-sequence`, beside
`manual` and `seeded-random` (ADR-0009). Its `sections`, labels, slugs, intros, title,
lead, body, cover, and dates are unchanged. A gallery holds exactly one representation.
A `galleryPlacement` that references a capture-sequence gallery is a defect: Studio
blocks publishing it, and the read path refuses the gallery with a classified error
rather than merging two sources.

### 2. Order, identity, and the cursor

- **Order:** `(sequence asc, mediaId asc)`. `mediaId` only breaks a tie that uniqueness
  validation should already have prevented, so the order is always total.
- **Item identity:** `itemId = mediaId`. This is the dynamic-result rule from ADR-0002,
  and it is correct here because a photograph appears in a capture-sequence gallery at
  most once. See the ADR-0002 amendment.
- **Cursor:** the existing `GalleryOrderingBoundary` wire shape is reused as
  `{pinnedTier: 0, key: sequence, placementId: mediaId}`. The last slot holds the item
  identity whatever its field name says. The keyset-cursor wire format therefore does
  not change.
- **Ordering scope:** `GalleryCursorScope.ordering = "capture-sequence-v1"`. A token
  minted under `manual-v1` or a seeded scope therefore fails as `wrong-scope` on a
  converted gallery, and the reverse also holds.
- **`visibilityVersion`:** the newest `_updatedAt` among media whose
  `captureSequence.galleryContentId` names the gallery. It is not filtered by visibility
  or section. This is the same conservative class as the curated adapter's
  newest-placement version.

### 3. The bounded read

The read uses the AB#114/AB#134 `CuratedGallerySectionSource` shape, answered from
`media` documents instead of placements:

- **Filter:** type is `media`; `captureSequence.galleryContentId == $contentId`;
  `publiclyRenderable == true`; `privateOnly` is false or undefined; and, for a named
  section, `captureSequence.sectionId == $sectionId`. All of this is evaluated in GROQ
  **before** the limit, so no page is shortened after the fetch.
- **Window:** an id lookup for the boundary (`mediaId == $afterMediaId`) plus
  `(sequence > $after || (sequence == $after && mediaId > $afterMediaId))`, ordered
  `sequence asc, mediaId asc`, `[0...$candidateLimit]` with `pageSize + 1` candidates.
  It follows the existing curated idiom exactly. Ordering is numeric on `sequence`, and
  the `mediaId` tie-break uses the same JS string comparison as `comparePlacementIds`.
- **Projection:** media rows go through `PUBLIC_MEDIA_PROJECTION` and
  `projectPublicMedia` unchanged. ADR-0005's derivative, dimension, and no-crop
  guarantees therefore apply as they do today. There are no placement overrides to
  apply.
- **Caching:** the new query keys carry the `sanity:galleries` and `sanity:media` tags.
  A caption fix on a media document therefore invalidates the gallery through the
  existing webhook map (AB#83) with no new tag.
- **Unchanged:** the browser-facing `GalleryPage` contract, the grid, the lightbox,
  continuation links, in-place append, and section controls. `src/app` and
  `src/components` do not learn a new kind.

### 4. Sections

The gallery document keeps declaring its sections per language, exactly as today. The
media `sectionId` is the language-neutral key both documents share. Every existing
`sectionId` and `?section=` slug on a converted gallery is preserved. A section with no
media is the existing valid empty section.

The "All" view is ordered by `sequence` alone. It is not grouped by section, so an
interleaved numbering interleaves sections. The importer warns about that case, because
it usually means a file is in the wrong stage.

### 5. Enquiry (AB#60)

A curated enquiry request already names its container (`contentId`) and is authorized
through the public content tree first. When that gallery's `orderingRule` is
`capture-sequence`, the resolver reads `itemId` as a `mediaId`. It then requires
`captureSequence.galleryContentId == contentId` and applies the same
`publiclyRenderable && enquiryEligible && !privateOnly` composition.

The container, never the caller, selects the identity space, so the ADR-0002 concern
that a caller-chosen kind prevents does not arise. A placement id sent for a converted
gallery matches nothing. It collapses to the existing generic
`404 item-unavailable`, and the `?enquire=` view renders its existing refusal.

### 6. File naming and import contract (for new collections)

Approved by the owner on 2026-09-23:

- **File name:** `<filePrefix>_<NNNN>_<sectionKey>.jpg`, for example
  `Tet_Rally_Latvia_2024_0327_SS2_Milzkalne_1.jpg`.
  - `NNNN` is four digits, runs across the whole rally, and is unique.
  - `sectionKey` is everything after the number.
  - Characters are ASCII letters, digits, `_`, and `-` only.
- **`rally.json` beside the files:** `filePrefix`, FI/EN title, `eventDate`, and an
  ordered `sections` list of `{key, fi, en}`. It maps each `sectionKey` to a gallery
  section. Labels with non-ASCII letters live only here.
- **Accepted input:** exported web JPG/WebP only, longest edge ≤ 2048 px
  (`MAX_PUBLIC_DELIVERY_DIMENSION`). Camera masters (DNG and similar) are refused.
- **Authority:** the file name is the ordering authority. EXIF capture time is not read
  and does not affect order.
- **The importer refuses, and does not guess, when:**
  - a prefix does not match `rally.json`;
  - a number is duplicated;
  - a `sectionKey` in the files is not declared, or a declared section has no files;
  - an image exceeds the format or size rules.
- **The importer warns** when section number ranges interleave. The owner may accept
  that warning explicitly.
- **Content hash:** each file's content hash is recorded for idempotency.
- **`mediaId`:** minted opaquely as ADR-0002 §1 requires, never derived from the file
  name.

### 7. Converting existing placement-based galleries

Conversion runs per gallery, is owner-approved, and is a separate implementation phase.
It is allowed only when **all** of these hold:

1. **A file name for every photograph.** Every converted `mediaId` maps unambiguously to
   a local source file through the import artifacts (`photograph-identities.json`,
   plan `assetRequirements`). Sanity is never asked for a file name, because it stores
   none. A renamed file maps back to its existing `mediaId` through its unchanged
   content hash (`byContentHash`), so a rename re-uploads nothing. A re-export from
   Lightroom changes the bytes and does **not** qualify. A missing or conflicting
   mapping blocks that gallery.
2. **A numbering the rule can use.** The gallery's files carry a unique running number
   under the §6 convention. 2022 (numbering restarts per stage) and the unnumbered
   2018/2019 files block their galleries until the owner renames the files. There is no
   "section, then number" exception.
3. **Sections agree.** The FI and EN placements of each photograph agree on its
   `sectionId`, and the existing section ids and slugs carry over unchanged.
4. **One capture-sequence gallery per photograph.** No photograph would belong to two
   capture-sequence galleries. Use in a curated gallery, such as the best-of, is
   allowed. The report lists the 31 reused media by distinct gallery `contentId`.
5. **Order changes are approved.** A per-gallery deviation report lists every position
   where the new order differs from the current authored order, and the owner approves
   it.
6. **The live read is verified before deletion.** Placements are deleted only after a
   `sanity dataset export` whose restore has been tested, and after the new read path
   has been verified against that gallery in Production.

**Accepted consequence:** the item identity of a converted gallery changes from
`placementId` to `mediaId`, and its ordering scope changes. Every `?cursor=` URL and
every `?enquire=<placementId>` URL already issued for it therefore returns 404. Some
continuation URLs may already have been indexed as self-canonical pages (ADR-0003
decision 8). This one-time loss is accepted. Parameter-free gallery URLs and
`?section=` URLs are unaffected.

Out of scope for conversion: the `Rally Finland 2001–2019` best-of, which spans years so
filename order is not its order, and every `seeded-random` gallery (ADR-0009), which
needs a materialized per-occurrence key. Both stay placement-based.

### 8. Studio

Studio still edits captions, alt text, and flags on the media document, as today. The
per-gallery view of "this rally's photographs in order" is **Studio configuration
guidance**, documented in `sanity/README.md`: a structure-builder list filtered by
`captureSequence.galleryContentId` and ordered by `sequence`. It is not part of the
exported schema objects, which stay dependency-free per the repository convention.

## Options Considered

### A. Keep placement documents and buy capacity (Growth plan)

This option needs no code change. It does not fix the cost structure. The new rallies
alone would add ~10,800 documents, and the full set (~23,100) would reach the 25,000
included in Growth. The plan choice stays open and is independent of this ADR.

### B. Compact placements into bounded segment documents

This option stores ordered arrays of about 50–75 occurrences per document, keeping media
documents. It saves most placement documents. The costs:

- It adds a second curated representation, with hidden-item lookahead across segments.
- A segment has to be sized against the 1,000-attribute document limit.
- Editing is awkward.
- It keeps per-occurrence data these galleries never use.

It remains the right tool for a large gallery whose order really is hand-authored. That
is not the rally case.

### C. Drop media documents for gallery images, with segments referencing assets directly

This option saves the most documents. It removes `mediaId` from about 1,500 photographs.
It makes them invisible to the dynamic keyword gallery and archive search (ADR-0012), which
enumerate media documents. Those rally photographs are exactly the corpus that search
exists for. Rejected.

### D. Store gallery order as manifests in object storage (R2)

The document savings over option B are negligible, because a gallery's order fits in a
few documents either way. The costs:

- It puts a second content store on the public read path.
- The Sanity webhook does not see its changes (AB#83).
- Order and text are no longer updated together.
- The order is not editable in Studio.

Rejected.

### E. Capture-sequence (chosen)

Membership and order are media-owned. The filename number is the ordering authority.

## Trade-off Analysis

**What is saved.** A capture-sequence photograph costs two documents (asset and media)
instead of four. Calculated, not measured:

| Scenario | Documents |
| --- | ---: |
| Everything placement-based: Production + remaining Joomla + new rallies at 4 each | ~23,100 |
| New rallies imported as capture-sequence (2 each) | ~17,700 |
| … plus Production rally galleries converted (≤ 3,312 placements; the best-of's 38 stay) | ~14,400 |
| … plus the 2,064 article end-gallery placements, **if** a later decision applies the same rule to them | ~12,300 |

Even the last row exceeds Sanity Free. Roughly 5,900 photographs at two documents each
already make about 11,800. **This ADR does not make the site fit the Free plan.** Moving
image bytes out of Sanity, or choosing a plan, is a separate decision.

**What is given up, for these galleries only:**

- **No per-occurrence overrides.** A photograph cannot be hidden from, or captioned
  differently in, only its rally gallery. Its caption is the media caption everywhere.
  Production uses no such override today.
- **No hand ordering.** Reordering means renaming files, then re-importing or patching
  `sequence`. This is deliberate: the file system is the owner's ordering tool.
- **One rally per photograph.** A second rally needs a curated gallery.
- **Identity changes on conversion.** See the accepted consequence in §7.

**What is kept:**

- `mediaId` and every media-level flag;
- future keyword search over the same photographs;
- bounded server-side pagination with section filtering;
- signed, scope-bound cursors;
- the public derivative boundary;
- enquiry;
- ADR-0003 URLs and section slugs;
- every existing curated and seeded gallery, unchanged.

## Consequences

- `GalleryOrdering` gains `{kind: "capture-sequence"}`, and `orderingScopeString` gains
  `capture-sequence-v1`. `buildCuratedGalleryPage` and the cursor codec are reused
  unchanged, with `mediaId` in the boundary's identity slot.
- `sanity/schemas/media.ts` gains the optional `captureSequence` object. Studio validates
  it:
  - the named gallery exists and is `capture-sequence`;
  - `sequence` is a positive integer, unique per gallery;
  - the `sectionId` is declared by the gallery.
- `sanity/schemas/gallery.ts` gains the `capture-sequence` ordering value, and publishing
  a placement against such a gallery is blocked.
- `sanity-gallery.ts` dispatches on `orderingRule`, and the mock fixture gains a
  capture-sequence gallery. The two representations stay separate code paths behind one
  source contract. That is a lasting cost of two gallery kinds, accepted because each is
  simpler than a hybrid.
- The enquiry resolver branches on the container's ordering rule (§5).
- A new owner-run folder importer is needed (§6). Its shape follows `write:joomla`:
  - dry-run by default;
  - the write token only from the environment;
  - collision preflight;
  - private reports at mode 0600;
  - console output limited to counts.
- Two sets of user-facing links are lost once, on converted galleries only (§7).

## Action Items

1. [ ] Read path: `GalleryOrdering` kind, media schema object, gallery rule value,
       `sanity-gallery.ts` capture-sequence source, mock fixture, enquiry branch, cache
       tags. Unit and Playwright coverage for pagination walk, sections, hidden or
       private media, cursor scope mismatch, and no-JavaScript continuation.
2. [ ] Folder importer (§6), exercised on one new rally before any bulk run.
3. [ ] Conversion tool and per-gallery deviation report (§7). Galleries convert one at a
       time with owner approval.
4. [ ] `sanity/README.md`: Studio structure guidance for the per-gallery image list (§8).
5. [ ] Owner: rename the 2022 files and the unnumbered 2018/2019 files under §6 without
       re-exporting, before those galleries convert.
6. [ ] Separate decision: whether the article end-gallery placements (AB#161) adopt the
       same rule, after checking their order against file names.
7. [ ] Architecture diagram: draw the capture-sequence read path as planned, not
       operating, when the read path story starts.

## What this ADR did not establish

- **No code, schema, or Production data changed.** The document figures are
  calculations from a live count and the prepared plan, not a post-conversion audit.
- **Latvia 2024 and Secto 2023** were not checked against their file names.
- **Whether Sanity counts drafts or asset documents toward the plan quota** is not stated
  on either Sanity page consulted. The figures assume assets count, as the Production
  audit did.
- **The Sanity plan and any move of image bytes out of Sanity** are not decided here.
