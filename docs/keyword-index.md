# Public keyword index

**Audience:** whoever changes keyword search, the typeahead or the browsable keyword index.
**Work item:** AB#59. **Decisions:** [ADR-0039](adr/0039-keyword-taxonomy-and-ingest-boundary.md),
[ADR-0012](adr/0012-dynamic-keyword-gallery-query-contract.md).

`src/lib/keyword-index.ts` builds one value per language from two cached inputs. Payload version:
`KEYWORD_INDEX_VERSION`, currently 1.

## It stays on the server

AB#59 describes one compact payload, while AB#74 forbids a browser downloading the full vocabulary. Both
hold because the index is a server-side value: AB#74 asks a bounded endpoint that reads it, and AB#75
renders it on the server. Aliases exist for import matching, so they should not reach a browser wholesale.

## What an entry holds

| Field | Meaning |
| --- | --- |
| `keywordId` | The canonical public token. It also serves as the slug: ADR-0039 has no separate one. |
| `title` | In the requested language, falling back to the default language. |
| `aliasKeys` | Match keys of the aliases, sorted, without repeats. For matching only; never shown. |
| `categorySlug`, `categoryTitle` | The configurable category. |
| `ancestorIds` | The parent chain from the root, without the keyword itself. |
| `count` | Eligible media whose stored `expandedKeywordIds` holds this keyword. |

Entries sort by category order (a category with none goes last), then category slug, then `keywordId`.

## Rules

- **Only active, public, ordinary-path keywords exist here.** A private, merged, retired or draft term has no
  entry, and its name and count appear nowhere.
- **A keyword with no eligible media has no entry,** because its gallery would be empty.
- **Eligibility equals a keyword gallery's** (ADR-0012 §2), so a count cannot promise more than its link shows.
- **Counts read the stored closure,** like the gallery. During a re-sync they can lag the hierarchy, and an ancestor
  can be missing while its child is present.
- **A malformed row raises.** An unknown parent or category fails the read rather than hiding keywords.
- **The vocabulary and the closures are separate reads,** so counts can briefly reflect another generation.

## Browsing

`src/components/keyword-browser.tsx` renders the index on the search landing state (AB#75), as plain links grouped by category
and nested by hierarchy. ADR-0012 §8 reserves that state for it. Defined behaviour:

- **Metadata:** the landing state is `noindex` and has no canonical link. Each one-keyword gallery it links to is `noindex` with a canonical
  link to its own first page. All are outside the sitemap. ADR-0012 §8 keeps selections out until evidence argues for a bounded indexable subset.
- **Reaching it:** the search dialog links to the search page, because a JavaScript visitor's search control opens the dialog instead.
- **Categories:** a keyword nests under its nearest ancestor in the same category. With none, it is a root of its own category.
- **An orphan:** a keyword whose parent is not in the public vocabulary, and whatever sits under it, is left out of the index.
- **A slow store:** the page waits 3 seconds at most for the index, and then renders without it. A fault is logged.
- **Nothing to show, or a store that cannot answer:** the section is absent and search keeps working. A failure is logged.
- **A results page** does not show the browser.
- **While a re-sync is outstanding,** a keyword whose parent has no entry sits under its nearest listed ancestor.

## Selecting

`src/components/keyword-selector.tsx` (AB#74) is an ARIA combobox above the browser. It asks `POST /api/keyword-suggest`, debounced by
200 ms, for at most eight suggestions. A browser never receives the vocabulary, and an alias matches but is never returned. The term stays
out of URLs and logs, as with the site search. A descendant replaces its selected ancestor and is not undone by removing the descendant. The
address it builds passes the server's validation like any other, so it can bypass nothing. Without script it stays out of the page, and
the plain links serve instead.

## Matching

`keywordIndexMatchKey` is the import's match key: Unicode NFC, locale-independent lowercase, whitespace collapsed
and trimmed. Diacritics are preserved, because "Mäki" and "Maki" can be different people. A test holds it to
`sanity/schemas/keyword-rules.ts`.

A visitor matches titles and aliases. A keyword's id and a merged keyword's former names do not participate.

## Caching and invalidation

Both inputs carry the `sanity:keywords` tag (AB#83). The index itself is rebuilt from them on each read, which is cheap
(see below). A change to a `keyword`, `keywordCategory`, `keywordTaxonomyState` or `media` document expires the tag
through the signed webhook, with no deployment.

**Owner step, in this order:** deploy this change first, because the webhook answers an unknown document type with
400. Then add the three keyword types to the live webhook's filter ([contract](cache-revalidation.md)), and make one
reconciling edit so that anything changed during the rollout is picked up. Until then the index converges within the
one-hour cache lifetime.

## Budget and measurements

| Measure | Budget | How it is held |
| --- | --- | --- |
| A 500-keyword index, worst-case ids, titles and aliases | 250 KB of JSON | Test |
| One page of closures: 1000 media, twenty 40-character ids each, base64-encoded as Next stores it | under 2 MB, Next's fetch cache item limit | Test |
| Parsing, counting and building it on a read, without the reads themselves | 50 ms | Measured once, because time is not deterministic. Measured below at about 10 ms |

Measured locally on 2026-11-05 with synthetic data, median of seven runs, on a development machine:

| Step | Input | Result |
| --- | --- | --- |
| Index size | 500 keywords with 40-character ids, titles and three aliases | 218,203 bytes of JSON |
| Closure size, typical | 8000 media, five short ids each | 496,012 bytes, in eight cached pages |
| Closure size, large | 8000 media, six 40-character ids each | 2,080,012 bytes, in eight cached pages of about 260 KB |
| Parsing the worst-case closures | | 1.9 ms |
| Counting them | | 3.3 ms |
| Building the index, counting included | | 4.3 ms |
| Serializing and parsing the index | | 0.3 ms and 0.4 ms |

**The closures are the scaling risk,** because they grow with the media count rather than the vocabulary. Next stores a
response base64-encoded and refuses to cache one past 2 MB, so the read is paged. A read makes one request per 1000 eligible
media until the cache holds them, and refuses an archive past 200,000. A closure has no hard bound, so a page could still pass
the limit; that page then goes uncached and is fetched again, with correct results. Media changing between pages can shift a
count slightly until the next read after expiry. AB#73 validates this at archive scale.
