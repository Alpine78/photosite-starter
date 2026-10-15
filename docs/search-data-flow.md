# Site search data flow (AB#299)

This is the reference deployment's processing record for the site search. Each
clone owns its own hosting, content project and copy of this record. The route,
matching, transport and privacy decisions are recorded in
[ADR-0033](adr/0033-unified-site-search.md).

## What a search carries

A visitor's search is **one text query of at most 100 characters and the
language of the page it was typed on**. Nothing else is sent: no identifier, no
cookie, no account, no device or location data. The application sets no cookie
for search and writes nothing to the visitor's local or session storage.

| Entry point | Transport | Where the term appears |
| --- | --- | --- |
| The header dialog | `POST /api/search`, JSON body `{q, lang}`, at most 1 KiB | The request body only. It is **not** in a URL, the browser history, or a `Referer` |
| The results page (and its no-JavaScript form) | `GET <search route>?q=…` | **The URL**: the visitor's browser history, and any hosting request log that records query strings |
| "Show all results" in the dialog | A link to the results page | The same URL, and only when the visitor follows it |

No link in the dialog is prefetched by the framework: a prefetch of the "show all"
URL would send the term to the host before the visitor followed it, and prefetching
result links would reveal which pages a half-typed query matches. A public-journey test
fails if any request, to any URL, carries the term while the visitor types.

The URL exposure of the results page is a deliberate trade for working with no
JavaScript and for a shareable, reloadable address. It is why the dialog posts
instead: the common path never writes a term into a URL. The site's
`Referrer-Policy` (`strict-origin-when-cross-origin`) means a navigation from a
results page to another origin sends that origin only, never the query.

## Processors

- **The hosting provider** (Vercel in the reference deployment) receives every
  request and runs the application. A results-page URL, including its `q`, is
  the kind of value a hosting provider commonly records in request logs; this
  deployment does not control that retention and does not claim it is absent.
  A `POST` body is not part of the URL.
- **The content store** (Sanity in the reference deployment) is **never sent a
  search term**. The search reads one cached, public story index per language
  and matches it inside the application. What the store receives is the same
  cacheable, parameterised read of already published content that every
  listing makes, carrying only the language.
- **No third party.** No search service, analytics, tag manager, font or
  script is added, and the public-journey suite fails if a page reaches another
  origin.

## What the application stores and logs

- **Stored:** nothing about a search. The only cached data is the public story
  index (titles, short leads, free keywords, dates and public cover derivatives
  of already published stories), held in the framework's tagged data cache and
  invalidated by the signed content webhook. It contains no visitor data.
- **Logged:** the application never logs, stores or analyses a search term, on
  success or on failure. When a search cannot be answered it logs the error's
  class and message, which describe the content store and never the query. There
  are no search statistics and no "popular searches": that list is not built
  because it would require recording what visitors searched for.
- **Retention:** none by the application. Browser history and any hosting log
  follow their own retention.

## What is searchable

Published stories (articles and galleries) in the visitor's own language and
published services that are not hidden from listings: titles, free keywords and
short leads. A story is searchable only when the public content tree gives it a
canonical route, and it links to exactly that route, so an unpublished,
ended, secondary-only or private page cannot appear. Article bodies, categories,
images, private client galleries, polls and retained delivery galleries are not
searched. A hit exposes a title, a short lead, a date, a public route and a
public cover derivative with its true dimensions, and never a media identity,
master, archive locator or provider detail.

## Boundaries

- The endpoint accepts `POST` with a JSON body of exactly two string fields,
  same origin only, and refuses everything else (`415`, `403`, `413`, `400`,
  `422`). Responses are `no-store` and carry no CORS headers.
- Input is bounded identically on both entry points by one function: 100
  characters, 8 tokens of at least two characters. Query syntax is treated as
  punctuation, never interpreted, and a query with no usable word matches
  nothing.
- There is no application-level rate limit, because a warm search makes no
  upstream request; the platform firewall remains the defence in depth
  (ADR-0004 §5). The decision to add one if measurement shows CPU cost is
  recorded in ADR-0033.
- Results pages are `noindex`, carry no canonical or alternate-language link,
  and are not in the sitemap.

## For a clone and the launch review

- Confirm the hosting provider's request-log retention for query strings, and
  update the privacy notice if it differs from what visitors are told.
- If search is ever extended to record queries (suggestions, analytics, "popular
  searches"), this record and ADR-0033 must change first: that would make the
  query personal-data-adjacent processing with its own basis and retention.
