# ADR-0039: Image keyword taxonomy and ingest boundary

**Status:** Accepted
**Date:** 2026-10-21
**Accepted:** 2026-11-04
**Deciders:** Project owner
**Work item:** AB#55

## Context

Dynamic keyword galleries ([ADR-0012](0012-dynamic-keyword-gallery-query-contract.md))
treat the taxonomy as a black box that resolves a token to a canonical keyword id,
follows an alias, names a keyword's parent and answers whether one keyword is an
ancestor of another. This record decides what is inside that box: the keyword document,
the relationship between Lightroom-authored input and the site's curated keywords,
hierarchy maintenance, and what reaches public queries. AB#56 (schema), AB#57 (import
mapping), AB#58/59/68–75 and AB#90 build on it, and AB#25 consumes its tags decision.

Evidence and constraints already in place:

- **AB#65 benchmark** ([keyword-query-benchmark.md](../keyword-query-benchmark.md)),
  8000 non-personal media and 243 keywords on a real Sanity project: materializing the
  ancestor closure on the medium (strategy B, `expandedKeywordIds`) is the fastest read
  and the only one-request-per-page keyset walk. Its price is the hierarchy move: moving
  the broad root rewrote 3541 media documents (about 14 s to accept, 15 s to re-sync,
  45 s to revert). Keyword-side materialization and query-time traversal pay 1.7–2.4×
  on every uncached read and re-resolve the closure on every continuation page.
- **ADR-0012 §3/§5:** canonical ids are comma-joined into the cursor's
  `normalizedFilter` (`v<taxonomyVersion>:<ids>`, at most 256 characters). An id must
  never contain a comma, and five worst-case ids plus separators and prefix must fit;
  otherwise the serialization has to become a digest.
- **ADR-0002:** keywords are media-owned, not placement-owned; `privateOnly`,
  `publiclyRenderable` and `dynamicallyDiscoverable` are separate media decisions.
  [ADR-0022](0022-capture-sequence-rally-galleries.md) already makes rally gallery
  membership media-owned.
- **ADR-0003 decision 4:** article `tags` are free strings that own no route.
  [ADR-0033](0033-unified-site-search.md) leaves "tags and photo keywords share a
  vocabulary?" to this record.
- **[ADR-0008](0008-localized-authored-text.md):** authored display text is localized.
- **AB#54 (extraction spike)** recorded its evidence on 2026-11-04 in
  [the spike report](../audits/ab54-lightroom-keyword-spike-2026-11-04.md). Open questions
  1 and 2 below carry the results.

## Decision

### 1. Two document types: `keyword` and `keywordCategory`

A **`keywordCategory`** is configurable content: localized title, slug, order and
optional description. The first deployment's rally categories (for example driver, team,
car, event) are seed fixtures, never schema enums or component constants.

A **`keyword`** document has:

| Field | Meaning |
| --- | --- |
| `keywordId` | Domain identity, immutable after first publication, unique. Lowercase ASCII `[a-z0-9]` and single `-`, 2–40 characters, no leading/trailing `-`. Separate from Sanity `_id`, as ADR-0030 does for content. |
| `title` | Localized display form (ADR-0008). Default locale required; other locales fall back to it. Names normally carry one title. |
| `category` | Required reference to a `keywordCategory`. |
| `parent` | Optional single reference to another `keyword`. At most one parent. |
| `aliases` | Strings that also resolve to this keyword (spellings, former names, Lightroom synonyms). |
| `description` | Optional localized text. |
| `visibility` | `public` or `internal` (decision 7); fixed by where the document is stored, not a toggle. |
| `status` | `active`, `merged` (with `mergedInto` reference) or `retired`. |

The 40-character bound gives five ids plus four commas = 204 characters, leaving 52 for
the `v<taxonomyVersion>:` prefix inside ADR-0012's 256. Literal ids therefore stay in
the cursor scope and URL; no digest is needed. A validator enforces the syntax, so the
bound cannot erode silently.

### 2. Lightroom is input; the site's taxonomy is authoritative

Lightroom keywords are **imported audit data**. The site's **effective keywords** are
references to `keyword` documents on the medium, and they alone feed public queries.

On each **public medium**:

- `keywords` — the effective public set: references to active **public** `keyword`
  documents only.
- `expandedKeywordIds` — derived (decision 3).

In one **private keyword record** per medium (decision 7's private ID path, for example
`keywordRecord.<mediaId>`):

- `importedKeywords` — the last import: raw terms, hierarchical paths when available,
  source and time.
- `keywordOverrides` — editor decisions that a re-import must respect: `added`
  (keywords an editor added that no import term maps to) and `removed` (tombstones: a
  mapped term the editor rejected for this medium).
- `internalKeywords` — the effective internal set: references to `internal` keywords.

Raw import terms can contain anything a photographer typed in Lightroom, including a
client's name, so they never live on the public medium.

**Re-import is deterministic.** For the new import, map every raw term to a keyword
(decision 5). Canonicalize mapped ids and both override sets through merge chains
(decision 4); removals win over additions for the same canonical id. Then

```text
effective = (mapped(newImport) ∪ overrides.added) − overrides.removed
```

restricted to active keywords, then split by visibility into the medium's `keywords` and
the private record's `internalKeywords`. A term removed in Lightroom disappears from the
effective set on the next import unless an editor added it explicitly; an editor's rejection
survives every re-import until the editor clears it. Unmatched or ambiguous terms go to
the review queue (AB#70), never to a guessed keyword. Running the same import twice
produces the same document.

### 3. Ancestor closure is materialized on the medium (strategy B)

`expandedKeywordIds` holds the `keywordId` of every effective public keyword and every
ancestor (a public keyword's parent must itself be public). It is derived from `keywords` and the authored `parent` edges on every write
that touches either, read-only in Studio, and never authored. Public matching (ADR-0012
§4) reads only this field, so selecting a parent matches its descendants in one indexed
array test.

A structural change — a parent move, merge or retirement — increments one global
`taxonomyVersion` (ADR-0012 §5) and enqueues a **re-sync** (AB#69): recompute
`expandedKeywordIds` for media whose closure changed, in bounded batches, idempotently
(derive from current edges, write with the revision guard, skip unchanged documents),
resumable from its last confirmed batch. A failed or interrupted run is recovered by
running it again; until it finishes, results may reflect the previous hierarchy for the
affected keyword, which `taxonomyVersion` already makes cursors detect as stale. The
measured cost (3541 media for the broadest move) is accepted because moves are rare,
administrator-initiated events, while reads happen on every visitor request.

### 4. Hierarchy governance

- **No cycles.** Validation walks `parent` upwards and rejects a direct or indirect cycle
  and any chain deeper than 6 levels.
- **Uniqueness.** `keywordId` is never reused: it is globally unique across active,
  merged and retired keywords. Public URL tokens are `keywordId`s only; aliases and titles serve import
  matching and Studio search, never URL resolution. An alias or title may not equal
  any other keyword's `keywordId`. The normalized match key (decision 5)
  of a title or alias is unique **within its category** among active keywords and the
  merge records that still resolve to them (a merged keyword's `keywordId`, title and
  aliases stay reserved for its target, so a new keyword cannot capture a term that
  already maps through a merge); the same
  name in two categories (a car make and a team) is allowed, and an import term that
  matches both is ambiguous and goes to review.
  See [ADR-0012's proposed 2026-10-22 amendment](0012-dynamic-keyword-gallery-query-contract.md#scoped-amendment--2026-10-22-id-only-public-tokens-ab55).
- **Rename** changes `title`; `keywordId` and references stay, so every page shows the
  new name without touching media documents. The former title's match key is kept as an
  alias automatically, so the next identical Lightroom import still maps to the same
  keyword instead of dropping it to review. Removing that alias is a separate, deliberate
  editor action.
- **Merge** sets the source to `merged` with `mergedInto`. The target must be an active
  keyword other than the source; merged keywords are never active, and cyclic chains
  are rejected. The source's `keywordId`
  then resolves to the target, so an old URL redirects once to the canonical selection
  (ADR-0012 §8); the re-sync re-points media references. The source document is kept as
  the redirect record, not deleted. The re-sync also canonicalizes and deduplicates both
  `keywordOverrides.added` and `keywordOverrides.removed` through merge chains in each
  medium's private keyword record; a removal wins and clears any conflicting addition.
- **Retire** sets `retired`. A retired keyword is excluded from public resolution
  (unknown-keyword, ADR-0012 §8) and from effective sets on the next re-sync. Both private
  override sets retain entries for the retired canonical id as dormant editor decisions;
  re-import preserves them but cannot make a retired keyword effective. A keyword
  with active children cannot be retired or merged until they are re-parented, so no
  orphan is created implicitly.
- **Delete** is allowed only for a never-published keyword: nothing references it and
  it never appeared publicly. Otherwise retire it, keeping its `keywordId` reserved.

### 5. Display, matching and slugs

- Display uses the localized `title` exactly as authored, including Finnish characters.
- The **match key** is: Unicode NFC, locale-independent lowercase, whitespace collapsed
  and trimmed. Diacritics are preserved, because "Mäki" and "Maki" can be different
  people.
- `keywordId` is ASCII. Studio proposes it from the default title by transliterating
  `ä→a`, `ö→o`, `å→a`, other letters through Unicode decomposition, then lowercasing and
  hyphenating. A proposed id that collides is a validation error the editor resolves by
  choosing another id; no automatic numeric suffix is added.
- Import mapping order: the hierarchical path when the import provides one (AB#54: only
  when the Lightroom export ticks Write Keywords as Lightroom Hierarchy), otherwise the
  flat term's match key against titles and aliases. One match maps; zero or several go
  to review. How a flat term that repeats a mapped path's parent or synonym is treated
  is settled by AB#57, so that it does not reach review as a separate term.

### 6. Article tags stay separate from photo keywords

Article `tags` remain free per-article topic strings (ADR-0003 decision 4) and AB#25
builds their archive on that basis. They are not keyword references.

Reasons: tags are authored by hand per article, few and topical; photo keywords are
imported in bulk from Lightroom, hierarchical, reviewed, and drive a cursor-paginated
query over thousands of media. Sharing one vocabulary would make every article tag a
governed keyword with category, hierarchy and review, or let unreviewed tags into the
public image query. Revisit if the owner wants a keyword selection to surface related
stories (ADR-0033's trigger): an optional reference from a tag to a keyword can be added
then without merging the vocabularies.

### 7. Privacy boundary

- **Projection is not access control.** The reference deployment's Sanity dataset is
  publicly readable, so anything stored in an ordinary document is anonymously
  queryable whether or not the application projects it. Sensitive keyword data is
  therefore stored only in documents whose `_id` lies on a private ID path (it contains
  a `.`), which Sanity never returns to unauthenticated requests — the same mechanism
  [ADR-0038](0038-proof-selection-in-existing-sanity.md) proposes for proof selection.
  That covers every `internal` keyword (for example `keyword.<keywordId>`) and every
  medium's private keyword record (decision 2). A public document never references a
  private one: even the reference id could reveal a name.
- Only `public`, `active` keywords appear in public payloads, URLs, counts, search
  indexes and sitemaps. `internal` keywords serve editors (for example a client's name
  on a delivery shoot).
- **Making an internal keyword public** creates a new public `keyword` document with the
  same `keywordId`, moves its assignments from the private records to the media's
  `keywords`, and deletes the private document; the reverse moves assignments to
  private records, removes them from public media, and completes decision 3's re-sync
  with a `taxonomyVersion` bump before deleting the public document. Either visibility
  transition is rejected while any other keyword document references the keyword as
  `parent`, whatever its visibility; editors re-parent those first. Incoming
  `mergedInto` references also block making an internal keyword public. Making a
  public keyword internal moves it and every merge record that resolves to it together
  as one operation: create a private replacement for each, rewrite incoming
  `mergedInto` references to the private replacements, then delete the public documents
  after the re-sync. Children via `parent` block the transition for every group member.
  A clone whose
  dataset is private may keep the same model; the path rule costs
  it nothing.
- Media that is `privateOnly`, belongs to a client delivery gallery, or is not
  `publiclyRenderable` and `dynamicallyDiscoverable` never contributes to a public
  result, count or keyword annotation, whatever keywords it carries (ADR-0012 §2).
- A keyword naming a person is `public` only for subjects photographed in a public role
  at a public event (a competing rally driver). New person keywords created from an
  import default to `internal` until an editor makes them public.
- A removal request for a named person is handled by making the keyword `internal`
  (the visibility transition above), not by retiring it: a retired public document is
  still anonymously readable, with its title, aliases and `keywordId`. Merge records
  that redirect to it are handled the same way, and identifying terms in public
  documents are redacted. Retirement stays for ordinary vocabulary maintenance. This
  record is not legal advice; the owner's privacy notice must describe the practice.
- **Embedded image metadata must not outlive the private record.** AB#54 measured image
  assets: the ordinary image CDN served no IPTC, XMP or GPS on the requests tested, and
  the unchanged original with all of it needs an authenticated `dlRaw` request. A `file`
  asset is served directly and publicly. Storing extracted terms privately therefore
  protects little if the stored bytes still contain them, so ingest reads the keywords
  from the local Lightroom export **before** upload and removes keyword metadata from the
  uploaded file (decision 8).

### 8. Embedded metadata and no re-encoding on import (owner decisions 2026-10-22, kept fields revised 2026-11-04)

These rules apply to every image import path, including the Joomla migration
derivative tool; implementation and the legacy re-upload are AB#391.

- **No re-encoding up to the public bound.** A JPEG whose longest edge is at most
  2048 px is uploaded with its compressed image data byte for byte the export's; only
  metadata segments may change. `sharp` may read metadata but never writes such a
  file.
- **Larger sources are the one exception.** A source above 2048 px is downscaled and
  re-encoded to the public bound (never cropped or upscaled), and the kept metadata
  below is carried over to the new file.
- **Removed:** keyword metadata (XMP `dc:subject`, `lr:hierarchicalSubject`,
  `lr:weightedFlatSubject`, IPTC Keywords) and the creator's street address, region and
  postal code, which can go out of date.
- **Kept:** copyright status and notice, creator name, city, country, phone, email and
  website, EXIF exposure, camera and lens data including serial numbers, and GPS
  location. Location stays so later features
  can show where a photograph was taken (a map, a lightbox button); the owner leaves
  a sensitive location out in the Lightroom export. Treat all kept fields as public:
  a `file` asset exposes them directly. AB#54 found that the ordinary image CDN does not
  serve them or the original compressed bytes, so visitors of an image asset see neither.
  Knowing this, the owner decided on 2026-11-04 to do AB#391's legacy re-upload.
- **Precise edits, not whole segments.** Because copyright and creator data share the
  XMP and IPTC segments with keywords, removal edits individual fields. Recommended
  tool: `exiftool-vendored` (MIT wrapper, actively maintained), run only in the
  owner-run import scripts; ExifTool's own licence and behaviour are verified on
  AB#54's test files before it is recorded in the asset inventory.
- **Already uploaded legacy images** were re-encoded with all metadata stripped; they
  are re-uploaded with the new tool as a separate owner-approved migration (AB#391).
- ADR-0028's byte-for-byte exception for the 21 legacy delivery galleries is unchanged.

## Options Considered

1. **Keyword-side ancestor materialization (strategy A).** Cheap move (about 2 s), but
   1.7–2.3× slower uncached reads and two requests per page; rejected on AB#65 evidence.
2. **Query-time traversal (strategy C).** Slowest read and most round trips; rejected.
3. **Lightroom as the source of truth, keywords as plain strings on media.** No Studio
   governance, renames would bulk-edit media, and hierarchy, aliases and privacy could
   not be enforced; rejected.
4. **One shared vocabulary for tags and keywords.** See decision 6; rejected for now with
   a revisit trigger.

## Trade-off Analysis

The read path is optimized at the cost of a heavier, rarer write path. That needs the
resumable re-sync (AB#69) before the first real hierarchy move, and it means a large
move is an operational event with a visible lag. In exchange, every visitor query is one
indexed array test with no per-page closure resolution.

Keeping Lightroom terms as audit data plus explicit overrides costs three extra fields
per medium, but makes re-import repeatable and keeps an editor's decisions from being
overwritten by the next export.

## Consequences

- Harder: a hierarchy move or merge requires a re-sync job and a `taxonomyVersion` bump;
  until it completes, results lag the new structure.
- Harder: editors must resolve id collisions and ambiguous import terms by hand.
- Easier: renames are free; merged ids keep working as redirects; public queries never
  see internal or private data.
- ADR-0012's open serialization item is closed: literal ids fit the cursor scope.

## Open questions and owner answers (2026-10-22)

1. **Answered by AB#54.** `dc:subject` is present whenever keywords exist.
   `lr:hierarchicalSubject` is present only when the export ticks Write Keywords as
   Lightroom Hierarchy; it then holds root-first `Parent|Child` paths, and a keyword
   without parents is a single term. The owner's export preset must tick this option for
   decision 5's path-first mapping to apply.
2. **Answered by AB#54.** Sanity's documented upload metadata extraction lists no IPTC or
   XMP keyword extraction, and the default upload's asset document held none. Extraction
   therefore reads the local JPEG export's own metadata before upload, not Sanity asset
   metadata, and the uploaded file has its keyword metadata removed field by field without
   re-encoding (decision 8). Recommended reader and editor: `exiftool-vendored`, as a
   `devDependency` for owner-run import scripts; licence, maintenance and cost are in
   [the spike report](../audits/ab54-lightroom-keyword-spike-2026-11-04.md).
3. **Answered: yes, from the exported JPEGs.** The vocabulary is seeded from the
   keywords embedded in the JPEGs the owner exports from Lightroom; no separate
   keyword-list export is required. Unmatched terms enter review as in decision 2.
4. **Answered 2026-11-04: only a path of at least two levels proposes a category.** The owner
   has no preset categories. The top-level term of such a path becomes an initial category
   for the editor to confirm. Every other keyword, including a parentless one such as a make
   or a name, goes to one general category. Person keywords start `internal` (decision 7) and
   become public only when an editor chooses. The fields AB#54 read carry no marker for a
   person, so the editor's review (decision 2) identifies them.
5. **Answered: 6 levels is enough.**
6. **Answered: check during implementation.** Studio visibility of private-path
   documents is verified as part of AB#56 before any private document is written.

## Scoped amendment — 2026-11-04: implementation details (AB#56)

**Previous rule:** decisions 3 and 4 left open where `taxonomyVersion` lives, how a merge
record's reserved terms are scoped, and whether a merge can be undone.

**Replacement:**

- **Taxonomy state.** A `keywordTaxonomyState` document holds `taxonomyVersion`,
  `resyncedVersion` and `publicationSequence`: numbers only, so it reveals no name. A
  re-sync is outstanding while `resyncedVersion` is behind `taxonomyVersion`, and AB#69
  acknowledges the version it processed, so a newer request is never cleared by an older
  run.
- **One publication at a time.** Studio publishes a keyword only through its own action.
  One transaction writes the keyword and advances the state under the revision read with
  the keyword graph, so concurrent publications conflict rather than together forming a
  cycle or a name collision. Content Releases and scheduled drafts are refused. The import
  and the re-sync must take the same guard.
- **Term ownership.** A merge record's terms are claimed in its own category and belong to
  the active keyword its chain ends at. Terms collide only when they resolve to different
  keywords. A retired keyword, or a chain no longer ending at an active keyword, claims no
  term; every `keywordId` stays reserved.
- **A merge is one-way.** A published merge record cannot return to active, retire or be
  retargeted, because the re-sync canonicalizes media and overrides to the target and a
  reversal could not reconstruct them. Reactivating a retired keyword stays possible, as a
  structural change whose terms are re-checked.
- **Delete and unpublish.** Studio offers delete only for a never-published keyword, and no
  unpublish. Decision 4 cannot bind a direct API write.

**Reason:** Studio validation alone reads a snapshot and runs per document, so it cannot
stop two concurrent publications, and native publish cannot write a second document.

**Affected sections:** decisions 3 and 4.

**Owner decision, 2026-11-04:** decision 4's rule that a title or alias may not equal any
other keyword's `keywordId` now applies only **within the keyword's category**. As written,
a published keyword `toyota` blocked a second keyword titled "Toyota" in another category,
although the same decision allows that name. Public URLs resolve `keywordId`s alone, so a
name in another category cannot capture one. An import term that matches both still goes
to review. `keywordId` itself stays globally unique and never reused.

**Private-path evidence for open question 6, 2026-11-04 (`preview` dataset, synthetic
documents):** requests without credentials to the query API, the CDN and the document
endpoint returned the ordinary-path control and not `keyword.<id>`; the document endpoint
listed it as omitted for `permission`. An authenticated read returned both. The Sanity CLI's
`documents query --anonymous` also returned the private document, so that flag is not
evidence of anonymous access. The owner's look at the document in Studio is still open.

## Action Items

1. [x] Owner reviews and accepts, amends or rejects this record (AB#55). Accepted 2026-11-04.
2. [x] AB#54 evidence resolves open questions 1 and 2; amend decision 5 accordingly.
3. [ ] AB#56 implements decisions 1, 4 and 5 (schema, validation, fixtures).
4. [ ] AB#57 implements decision 2's mapping and review routing; AB#70 the review queue.
5. [ ] AB#69 implements decision 3's resumable re-sync before any production move.
6. [ ] AB#68 projects only `expandedKeywordIds` and public keyword fields (decision 7).
7. [ ] AB#25 builds tag archives on decision 6.
8. [ ] AB#391 applies decision 8 to every import path and re-uploads legacy public images.
