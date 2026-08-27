# ADR-0013: Category-listing continuation cursor contract

**Status:** Accepted
**Date:** 2026-08-27
**Deciders:** Ilkka Rytkönen
**Work item:** AB#140

## Context

ADR-0003 decision 8 reserved a continuation contract for category branch listings —
"Category listing pages use the same continuation contract without the filter. A category
route accepts `?cursor=`; … The parameter-free category page and its cursor continuations
are self-canonical and indexable" — but left it unbuilt. AB#140's first change (the
2026-08-27 amendment to ADR-0003) made a category branch listing aggregate its whole
descendant subtree, which makes a branch exceed `MAX_CONTENT_LISTING_PAGE_SIZE` (24) far
more readily than the old single-level listing did. Until this contract exists, such a
branch serves only its first page and answers `?cursor=` with a 404.

The gallery already has a continuation cursor (AB#67): an opaque, HMAC-signed token bound
to the gallery, its section filter, its ordering rule, a visibility version, and the page
size, transported in `?cursor=` and readable only by the adapter that holds the signing
key (`gallery-cursor.ts`, `gallery-pagination.ts`). This ADR decides how much of that
mechanism a category branch listing reuses and where the two contracts must differ.

A category branch listing is ordered `(publishedAt DESC, contentId ASC)` (ADR-0003
decision 8). `contentId` is immutable identity. `publishedAt` is authored and frozen
nowhere in the schemas. A store (Sanity) orders and compares `publishedAt` as its stored
string — a date-only `2024-06-18` or a datetime.

## Decision

### 1. Keyset over `(publishedAt, contentId)`, carried verbatim

The cursor names a boundary `after = (afterPublishedAt, afterContentId)`. The next page is
the rows whose sort key is strictly greater in `(publishedAt DESC, contentId ASC)` order,
still ordered and still capped at `pageSize + 1`. A store expresses it as
`publishedAt < $afterPublishedAt || (publishedAt == $afterPublishedAt && contentId >
$afterContentId)`.

`afterPublishedAt` travels in the token as **the exact authored string**, not a parsed
timestamp. Converting to epoch milliseconds and back would turn a date-only `2024-06-18`
into `2024-06-18T00:00:00.000Z`, which is not string-equal to the stored value, so the
same-date tie-break comparison would break.

For the same reason, the in-memory reference ordering (`content-listing.ts`
`orderContentListingRecords` / `selectContentListingAfterBoundary`) compares `publishedAt`
**as a string**, not as a parsed timestamp — so the mock adapter, the store's
`order(publishedAt desc, contentId asc)`, and the keyset `publishedAt < $afterPublishedAt`
filter are byte-for-byte the same order. `publishedAt` must therefore be stored in a form
whose lexical order is its chronological order (ISO 8601, one offset), which the schema's
own `Date.UTC` round-trip validation already enforces; `Date.parse` is kept only to reject
an unorderable value as an adapter defect.

Keyset over an immutable identity, not offset, is chosen for the same reason the gallery's
is: a continuation URL is indexable, and offset pagination would duplicate or skip entries
whenever content is added or removed between page loads. Keyset stays coherent across
appends and removals — including the boundary row itself being removed, since the
comparison is against the *key*, not a row that must still exist.

### 2. A conservative visibility version, unlike the gallery's reasons but the same shape

Keyset over `(publishedAt, contentId)` is **not** coherent across two changes:

- an edit to any in-scope item's authored `publishedAt` (not only the boundary item's) —
  it can move that item across an issued boundary key and cause a skip or a duplicate; and
- a category re-parent that changes which categories are in the branch's descendant
  subtree, and so which content the listing aggregates.

The cursor scope therefore carries a `visibilityVersion`, and a token whose version no
longer matches is `stale` — the accepted, standard keyset-over-offset trade-off, the same
one the gallery cursor already documents for a reorder. It is derived **without
enumerating the subtree** (AC5):

- a digest of the in-scope subtree category id list, recomputed from the content tree on
  every request — so a re-parent changes it with no query; combined with
- a content-mutation signal. For a store: the most recently updated in-scope published
  `article`/`gallery` document's `_updatedAt`, read with one bounded `order(_updatedAt
  desc)[0]` query (`sanity-content-tree.ts#readPublicCategoryListingContentVersion`) — a
  `publishedAt` edit always bumps `_updatedAt`. For the mock fixture: a digest of every
  in-scope record's `(contentId, publishedAt)`, which is free because the mock is not a
  store and enumerating a fixture is legitimate.

This is deliberately conservative: it may invalidate a token that a stricter analysis
would have kept, never the reverse.

### 3. One shared HMAC primitive and one shared signing secret

The HMAC codec is extracted from `gallery-pagination.ts` into `keyset-cursor.ts`: a
generic signed `<base64url(payload)>.<base64url(HMAC-SHA256(payload))>` token whose
payload carries a query-scope digest, a visibility-scope digest, and the boundary pair
`(afterKey, afterId)`. `afterKey` is `string | number` — the gallery passes its numeric
placement `order`, the category listing passes the verbatim `publishedAt` string. The
wire field names, the signature domain string, and the digest labels keep their historical
`gallery-` prefixes so a cursor AB#67 already issued and indexed still decodes.
`gallery-pagination.ts` keeps its `GalleryCursorScope`/`GalleryCursorCodec`/
`GalleryCursorError` names as a thin typed façade; `content-listing-cursor.ts` is the
category-listing façade with its own `ContentListingCursorError`.

The signing secret is **`GALLERY_CURSOR_SIGNING_KEY`, shared** with the gallery cursor
(owner decision), resolved through one loader (`loadKeysetCursorSigningKey`). It stays a
request-time Sensitive value, not a build-time `SITE_*` setting, for the reasons
`gallery-cursor.ts` documents: it is a credential, nothing at build time issues a cursor,
and it must be one stable value per environment. **Rotating it now retires every issued
and indexed continuation URL for both galleries and category branches at once** — a
deliberate, documented act.

### 4. Scope binding

A category-listing cursor scope is: a constant `sourceId` (`content-listing`); a
`normalizedFilter` of `` `${locale} ${categoryId}` `` (so a token minted for one branch
cannot be replayed against another branch or another locale); the ordering rule
(`published-desc-v1`); the `visibilityVersion` from decision 2; and the page size. The
story root has no continuation contract and issues no cursor; a `?cursor=` at the story
root stays a 404 (`reject`), unchanged.

### 5. Route, canonical, and indexing behaviour (ADR-0003 decision 8, unchanged)

- A `category` route `carry`s a `?cursor=` to the adapter; the resolver forms no opinion
  about the token. Only the adapter, which holds the signing key, can tell a real slice
  from a forgery, so the render layer validates it and a bad one is a 404 with no
  redirect (`ContentListingCursorError` → `notFound()`).
- A token at a non-canonical spelling (casing, redundant default prefix, retired path,
  trailing slash) is validated *before* normalization, via an injected
  `categoryListingCursorNamesASlice` predicate: a good token redirects once to the
  canonical address and keeps its exact value (the cursor is case-sensitive and never
  normalized); an invalid one 404s without creating a redirect. Absent the predicate, the
  strict default refuses.
- A repeated `?cursor=` at a category route is a 404 — it names no single slice.
- The parameter-free category page and each `?cursor=` continuation are **self-canonical
  and indexable**; a continuation names **no `hreflang`/`x-default` alternates**, because
  the cursor is scoped to one locale's ordering and no other locale holds an equivalent
  slice (the identical reasoning the gallery continuation already applies). Only the
  parameter-free URL enters `/sitemap.xml`.
- A continuation page is thinner (ADR-0003 decision 8's compact-heading rule): the
  branch title marked "continued", a link back to the parameter-free first page, the
  child-category navigation (wayfinding, not republished editorial content), the
  identity-based language switch (which drops the cursor and opens the other locale's
  first page), and the content grid. No story-root introduction.
- The continuation control is a real `<a href>` carrying the next `?cursor=` URL, so a
  large branch pages through with **no JavaScript**. Progressive in-place append (the
  gallery's own later enhancement) is explicitly out of scope here.
- The 404 for an invalid category cursor carries a link back to the branch's
  parameter-free page (`not-found-return.ts`), the same honesty check the gallery 404
  performs — verified to actually serve before it is offered.

## Options Considered

### A. A second, category-specific signing secret

A distinct `CONTENT_LISTING_CURSOR_SIGNING_KEY`. **Rejected** by owner decision: a second
Sensitive value to provision and rotate, for no isolation benefit — the two cursor
families are already separated by their `sourceId` and scope digests, so sharing the key
cannot let a gallery token be spent as a category token or vice versa. The one shared
consequence — rotating the key retires both families' indexed URLs — is acceptable and
documented.

### B. No visibility version (keyset alone)

Rely on keyset over `(publishedAt, contentId)` being self-consistent. **Rejected**:
`publishedAt` is authored and unfrozen, so a mid-walk date edit anywhere in scope, or a
category re-parent, can silently duplicate or skip an entry across an indexed
continuation URL. The gallery cursor's own visibility version exists for the structurally
identical hazard (a reorder moving an item across a boundary), so the category listing
must have an equivalent.

### C. Freeze `publishedAt` after first publish

Make the ordering key genuinely immutable, as `slug` and `canonicalCategory` already are.
**Rejected** for this ADR: it is a real authoring-workflow constraint (an author can no
longer correct a wrong publication date) that reaches well beyond pagination, and it
still would not cover the re-parent hazard. The conservative visibility version handles
both at request time without constraining authoring.

### D. Offset / page-number pagination

**Rejected** for the same reason ADR-0003 decision 8 rejected it for galleries: an
indexable continuation URL built on an offset duplicates and skips entries under ordinary
editing.

### E. `noindex` category continuation pages

Sidestep the durability requirement by not indexing continuations. **Rejected**: ADR-0003
decision 8 explicitly makes an unfiltered continuation "indexable and self-canonical
because it contains a distinct sequential slice", and the same reasoning applies to a
category branch's later slices. `noindex` is decision 8's stated *fallback* if durability
proves impractical, not the default.

## Trade-off Analysis

Reusing one HMAC primitive and one secret keeps the security-sensitive surface small and
already-audited, at the cost of a slightly awkward historical name (`afterOrder` in the
wire payload now also holds a `publishedAt` string). The conservative visibility version
adds one bounded query per category branch render on the Sanity path (the mock computes
it for free), mirroring the gallery's own extra per-page round trip; it can over-invalidate
a token after an unrelated edit anywhere in the subtree, which is the accepted keyset
trade-off. Category-only scope (no story root, no progressive append) keeps PR2 within
AB#140 and matches AC7's "the story root is unaffected".

## Consequences

- `GALLERY_CURSOR_SIGNING_KEY` is now read by two modules. Its documentation
  (`.env.example`, `docs/deployment.md`, `docs/architecture/application-boundaries.d2`)
  describes both. Rotating it retires indexed continuation URLs for galleries **and**
  category branches.
- A deployment whose category branches all fit inside one page never reads the secret —
  resolution stays lazy.
- `keyset-cursor.ts` is the shared primitive; a future third keyset cursor builds on it
  rather than copying HMAC code.
- The category listing continuation is a no-JavaScript, real-link contract. AB#140 does
  not add an in-place append; that is a later, separate enhancement if it is ever wanted.
- The story root keeps serving only its bounded first page. Story-root continuation, if
  ever prioritised, is a new story with its own `routed-content` adapter path.

## Action Items

- [x] Extract `keyset-cursor.ts`; generalise the boundary key to `string | number`.
- [x] `content-listing-cursor.ts` — the category-listing façade and its
      `ContentListingCursorError`.
- [x] `ContentListingQuery.after`, `CategoryListing.nextCursor`, and the mock + Sanity
      keyset reads.
- [x] `computeCategoryListingVisibilityVersion` (mock digest; Sanity
      `readPublicCategoryListingContentVersion`).
- [x] Route wiring: `cursorDisposition` `carry` for `category`,
      `categoryListingCursorNamesASlice`, the compact continuation render, self-canonical
      `?cursor=` metadata with no alternates, and the category branch return in
      `not-found-return.ts`.
- [x] A JavaScript-disabled `e2e/category-continuation.spec.ts` journey.
- [ ] Story-root listing continuation — deferred, its own story.
- [ ] Progressive in-place append for category listings — deferred.
