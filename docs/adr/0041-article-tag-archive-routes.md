# ADR-0041: Article tag archive routes

**Status:** Proposed
**Date:** 2026-11-03
**Deciders:** Project owner (Ilkka Rytkönen) — acceptance pending
**Work item:** AB#25

## Context

Articles carry free `tags` (`sanity/schemas/article.ts`), displayed as plain text at the
end of an article and a gallery. AB#25 asks for one server-rendered archive per canonical
tag slug, listing only published matching articles.

The existing decisions shape this:

- [ADR-0003](0003-public-content-tree-and-url-structure.md) keeps tags out of the category
  tree: they consume no depth and cannot become route-owning categories. The article
  schema's field help goes further and says tags "own no public route". An archive does
  not create a category, but it does create a route, so that help text changes.
- [ADR-0039](0039-keyword-taxonomy-and-ingest-boundary.md) decision 6 keeps tags separate
  from photo keywords, as free per-article strings. The owner accepted ADR-0039 on
  2026-11-04. This record depends on that one decision and does not re-open it.
- [ADR-0013](0013-category-listing-continuation-cursor.md) already defines bounded listing
  continuation, and [ADR-0033](0033-unified-site-search.md) (Proposed) defines a
  deployment-owned `searchNamespace` beside the story and service namespaces.

**Not established:** how many distinct tags the reference dataset has, how many articles
each has, and how consistently they are spelled. No live read was made for this proposal.
Action item 1 measures it, because the sitemap threshold below depends on it.

## Decision

1. **Route.** `/<tagNamespace>/<tagSlug>` per locale, with a deployment-owned
   `tagNamespace` in `locale-routes.ts` beside `storyNamespace`, `serviceNamespace` and
   `searchNamespace`, optional with the default `tags`, under the same collision checks. A separate namespace cannot collide
   with a category or page slug, which a segment under the story namespace could. The
   namespace name is deployment configuration, never hard-coded in components.
2. **Slug.** Derived, never stored: Unicode NFKD, combining marks removed, lower-cased,
   every run of other characters replaced by one hyphen, and leading or trailing hyphens
   trimmed. `Ääni ja kuva` becomes `aani-ja-kuva`. A tag that yields an empty slug has no
   archive and stays plain text.
3. **Identity and label.** A tag archive is the set of published articles in that locale
   whose tag derives to the slug. Spellings that derive to one slug share one archive,
   which merges accidental variants without editing articles. The heading is the most
   frequent spelling, with ties broken by code-point order, so it is deterministic.
4. **Rename and aliases.** There are none: tags are free strings. Editing every article's
   tag moves the archive, and the old URL becomes a 404. A redirect is added by hand only
   when a real inbound link justifies it. Keeping tags free is what ADR-0039 chose; a
   governed alias list would rebuild the keyword vocabulary it declined.
5. **Locale.** Tags belong to one locale's article version. Archives have no `hreflang`
   alternates, because a tag in another language is not a translation of this one. The
   language switch on an archive leads to the other locale's story root and says so,
   rather than claiming an equivalent page (AB#255's rule).
6. **Unknown, empty and zero results.** All answer the normal 404, so an archive exists
   only while it lists something. This inherits the scriptless 404 limitation accepted in
   ADR-0007 and tracked in AB#370.
7. **Pagination.** The first page is bounded and continues with ADR-0013's signed cursor
   and its refusal behaviour, not a new mechanism. A continuation page is `noindex`.
8. **Canonical and sitemap.** The first page is self-canonical. A tag with **at least two
   published articles** is listed in the sitemap; a single-article tag is served as
   `noindex`, because its page only repeats a listing and invites thin-content indexing.
   The threshold is a proposal to confirm with action item 1's numbers.
9. **Scope.** Articles only, as AB#25 states. Gallery tags stay plain text. No client-side
   filter control. On an article, a tag with an archive becomes a link; one without stays
   text. Client deliveries and unlisted pages never contribute, because the query is the
   same published public article listing the category archive uses.

## Options Considered

| Option | Benefit | Cost / reason |
| --- | --- | --- |
| Separate `tagNamespace` (proposed) | No collision with the content tree; follows ADR-0021 and ADR-0033 | One more per-locale route setting |
| Segment under the story namespace | Shorter configuration | Reserves a word in a tree authors can name freely; a category with that slug collides |
| Query parameter on the story listing | No new route | Not a canonical archive URL as AB#25 requires; mixes filtering with the category cursor |
| Stored tag documents with slugs and aliases | Renames keep their URLs | Turns free strings into a governed vocabulary, which ADR-0039 decision 6 rejects |

## Trade-off Analysis

Deriving slugs keeps authoring as it is and costs no migration, but a rename loses its URL
and two distinct words could in theory derive to one slug. The owner writes the tags, and
action item 1 reports any collision before launch, so this looks acceptable for a personal
site. A clone with many authors would feel it more; stored tags stay possible later,
because the URL shape would not change.

## Consequences

- `tags` gain a public URL surface, so spelling becomes visible: a typo creates a page
  until the threshold in decision 8 hides it from search.
- Each locale route gains one more namespace. Like `searchNamespace`, it is optional with a
  default, so an existing deployment's configuration stays valid and gets `tags` unless it
  names another word. A category or page is unaffected, because the namespace is separate.
- The schema's "own no public route" help text changes. ADR-0003's rule that tags never
  own the tree stays true.
- Cache invalidation must include the affected tag archives when an article's tags change.

## Action Items

1. [ ] Owner-approved read-only census of published tags per locale: distinct tags, articles
   per tag, spellings that derive to one slug. Confirm decision 8's threshold from it.
2. [ ] Owner accepts or changes this record, including the namespace words for the
   reference deployment. ADR-0039 decision 6 has to stand.
3. [ ] Implement behind route and listing tests: slug derivation, collisions, 404 cases,
   cursor refusal, `noindex`, sitemap, cache invalidation, keyboard journey (AB#25).
