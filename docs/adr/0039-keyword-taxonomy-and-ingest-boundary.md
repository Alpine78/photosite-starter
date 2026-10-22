# ADR-0039: Image keyword taxonomy and ingest boundary

**Status:** Proposed
**Date:** 2026-10-21
**Deciders:** Project owner (pending)
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
- **AB#54 (extraction spike) is not done.** Whether `dc:subject` and
  `lr:hierarchicalSubject` survive the real upload path, in what form, where extraction
  runs and which dependency reads them are still unknown. Decisions that depend on that
  evidence are written as conditional and listed under open questions; they are not
  assumed.

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
- **Uniqueness.** `keywordId` is globally unique across active keywords and merge
  records. Public URL tokens are `keywordId`s only; aliases and titles serve import
  matching and Studio search, never URL resolution. An alias or title may not equal
  any other keyword's `keywordId`. The normalized match key (decision 5)
  of a title or alias is unique **within its category** among active keywords and the
  merge records that still resolve to them (a merged keyword's `keywordId`, title and
  aliases stay reserved for its target, so a new keyword cannot capture a term that
  already maps through a merge); the same
  name in two categories (a car make and a team) is allowed, and an import term that
  matches both is ambiguous and goes to review.
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
- **Delete** is allowed only for a keyword nothing references (Sanity reference
  integrity). Otherwise retire it.

### 5. Display, matching and slugs

- Display uses the localized `title` exactly as authored, including Finnish characters.
- The **match key** is: Unicode NFC, locale-independent lowercase, whitespace collapsed
  and trimmed. Diacritics are preserved, because "Mäki" and "Maki" can be different
  people.
- `keywordId` is ASCII. Studio proposes it from the default title by transliterating
  `ä→a`, `ö→o`, `å→a`, other letters through Unicode decomposition, then lowercasing and
  hyphenating. A proposed id that collides is a validation error the editor resolves by
  choosing another id; no automatic numeric suffix is added.
- Import mapping order: the hierarchical path when the import provides one (only if
  AB#54 shows it survives), otherwise the flat term's match key against titles and
  aliases. One match maps; zero or several go to review.

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
- **Embedded image metadata is public too.** An uploaded file is downloadable from
  Sanity's public asset URL with whatever IPTC/XMP it carries, so storing extracted
  terms privately protects nothing if the bytes still contain them. Ingest reads the
  keywords from the local Lightroom export **before** upload, and the file uploaded for
  public use carries no keyword metadata (`dc:subject`, `lr:hierarchicalSubject`, IPTC
  keywords). **The JPEG is never re-encoded on import** (owner rule 2026-10-22): keyword
  metadata is removed only by omitting whole metadata segments (XMP, extended XMP,
  Photoshop/IPTC), so the compressed image data stays byte for byte the export's.
  `sharp` may read metadata but never writes the uploaded file. Which other embedded
  fields the public file keeps is decided with AB#54's evidence. ADR-0028's byte-for-byte metadata exception stays limited to
  the 21 legacy delivery galleries.

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

1. **Open (AB#54).** Whether `dc:subject` (flat keywords) and `lr:hierarchicalSubject`
   (Lightroom's `Parent|Child` paths) are present in the owner's exported JPEGs, and in
   what form. Decision 5's path-first mapping applies only if the hierarchical field is.
   The owner exports JPEGs from Lightroom, so AB#54's control files are three such
   exports (no keywords, flat keywords, hierarchical keywords).
2. **Partly answered by documentation; dependency open (AB#54).** Verified: Sanity's
   upload metadata extraction covers dimensions, placeholders (`lqip`, `blurhash`,
   `thumbhash`), `palette`, `image`, `exif` and `location`; it lists no IPTC or XMP
   keyword extraction. Extraction therefore reads the local JPEG export's own metadata
   before upload, not Sanity asset metadata, and the uploaded public file has its
   keyword metadata removed by segment omission without re-encoding (decision 7).
   Which reader parses the keywords (licence, maintenance, shipped cost) is AB#54's
   remaining decision; recommended: `sharp`'s raw XMP plus a small tested parser, with
   `exiftool-vendored` as the fallback.
3. **Answered: yes, from the exported JPEGs.** The vocabulary is seeded from the
   keywords embedded in the JPEGs the owner exports from Lightroom; no separate
   keyword-list export is required. Unmatched terms enter review as in decision 2.
4. **Owner has no preset categories.** Proposed default: when hierarchical paths exist,
   their top-level terms become the initial categories for the editor to confirm;
   otherwise one general category. Person keywords start `internal` (decision 7) and
   become public only when an editor chooses.
5. **Answered: 6 levels is enough.**
6. **Answered: check during implementation.** Studio visibility of private-path
   documents is verified as part of AB#56 before any private document is written.

## Action Items

1. [ ] Owner reviews and accepts, amends or rejects this record (AB#55).
2. [ ] AB#54 evidence resolves open questions 1 and 2; amend decision 5 accordingly.
3. [ ] AB#56 implements decisions 1, 4 and 5 (schema, validation, fixtures).
4. [ ] AB#57 implements decision 2's mapping and review routing; AB#70 the review queue.
5. [ ] AB#69 implements decision 3's resumable re-sync before any production move.
6. [ ] AB#68 projects only `expandedKeywordIds` and public keyword fields (decision 7).
7. [ ] AB#25 builds tag archives on decision 6.
