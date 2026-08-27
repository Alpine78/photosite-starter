# ADR-0003: Public content tree and URL structure

**Status:** Accepted
**Date:** 2026-07-29
**Amended:** 2026-08-10 — see Amendments
**Deciders:** Project owner (Ilkka Rytkönen)
**Work item:** AB#102

## Amendments

This broad record remains accepted as a whole. A scoped clause is amended in place only
when implementation produces evidence the original text did not have, and each partial
amendment preserves the old rule and records its date, reason, replacement, and affected
sections as required by the ADR convention.

### 2026-08-10 — Pre-launch scaffold routes are removed, not redirected (AB#124)

Decision 6 originally reserved `/portfolio`, `/blog`, and `/blog/<slug>` "for
compatibility and redirects rather than new canonical content". Implementing AB#124
established what that sentence assumed without checking: none of these routes has ever
been deployed, published, or indexed — they resolve only on a developer's machine. A
redirect is owed to a URL somebody can be holding, and adding one for a URL nobody has
puts an unverified source into the redirect registry that every collision, loop, and
chain check then has to carry.

The decision now reads that such routes are removed and answer an ordinary 404, and that
only URLs verified in the production Joomla inventory (AB#19) earn a redirect. AB#124
removed `/blog` and `/blog/<slug>` on that basis; AB#104 applies the same rule to
`/portfolio` unless the inventory says otherwise.

Changed text: decision 6's closing paragraph, one consequence bullet, and the split
implementation action items 8–11. The canonical route contract, the redirect-history
rules, and every other decision are unaffected.

### 2026-08-10 — The story root previews recent routed content (AB#124)

Decision 8 originally described content listings only in terms of category ownership.
The first browser review showed that a story root containing category links alone gives
no preview of the authored stories and makes a deliberately sparse locale look empty.
Moving content into the root would weaken the canonical-placement rule, while loading an
unbounded tree would weaken the listing-query boundary.

The story root now uses the same bounded, deterministic listing projection to show
recent published content from across the tree. It includes only variants whose detail
route is currently served, and every card links to its existing category-owned canonical
path. The overview therefore creates neither a root placement nor a second URL. Category
branches retain their canonical-and-secondary membership rule unchanged.

Changed text: decision 8's category-listing paragraph. The canonical placement, ordering,
continuation, and category-branch contracts are unaffected.

### 2026-08-27 — A category branch listing aggregates its descendant subtree (AB#140)

Decision 5 and decision 8 described a category branch listing as showing that category's
own **directly** placed content — the pages whose canonical or secondary category *is that
exact category* — one level deep. Decision 8 stated it twice: "a listing presents public
child categories in sibling order first, then canonically placed content pages newest
first", and "Category branch membership remains canonical-plus-secondary; the aggregation
applies only to the story root." The 2026-08-10 amendment above restated it a third time:
"Category branches retain their canonical-and-secondary membership rule unchanged."

Implementing the tree produced evidence that rule leaves a real gap. A parent category
with several child branches — "Motorsport" over "Formula" and "Rally" — shows none of
either branch's galleries on its own page, because each gallery's canonical (and any
secondary) placement is on the leaf, not the parent. A visitor at "Motorsport" sees only
child-category links and must drill into each branch individually to see any content. The
only pre-existing way to surface a leaf's gallery on an ancestor page was to add a manual
secondary placement per gallery, which does not scale and duplicates information the tree
already encodes.

The rule now reads: a category branch listing includes every published page whose
canonical **or** secondary placement is in that category **or in any category within its
descendant subtree**. Aggregation flows downward only — a descendant category's own
listing is unchanged and still shows only its own subtree scope, so visiting "Rally" never
shows "Formula" content. Direct child-category navigation links are still listed alongside
the aggregated content grid; aggregation supplements the sibling-category listing, it does
not replace it. The deterministic order is unchanged (newest first, immutable content
identifier as tie-breaker) and now spans the aggregated set, independent of which
descendant branch an item's canonical category sits in. Secondary placement keeps its
exact prior meaning and remains available as a manual cross-branch override, distinct from
this automatic same-subtree aggregation. The story root's cross-category recent overview
(2026-08-10 amendment) is unaffected — it was already a global projection.

Aggregation is tree-driven from category ancestry and requires no author change to
existing content: no page gains a newly required placement field.

Consequences this introduces, recorded so a later reader does not treat them as defects:

- A page now appears in the listing of every ancestor of each of its canonical and
  secondary placements, not just its immediate categories.
- Moving a category, or changing a placement, now changes the content shown on multiple
  ancestor listings at once. It still changes no canonical detail URL, no breadcrumb (which
  follows canonical ancestry), and no sitemap entry — aggregation is listing-only.
- A secondary cross-branch placement now also gains ancestor-wide visibility up its new
  branch, not only a single listing entry on the category it names.
- The global newest-first order interleaves items from different descendant branches rather
  than grouping them by branch.
- The aggregated set is larger, so a branch listing reaches the one-page bound (decision 8,
  `MAX_CONTENT_LISTING_PAGE_SIZE`) far more readily than a single-level one did. The read
  stays bounded: the adapter is given the in-scope descendant category ids and applies the
  ordering and the `pageSize + 1` limit in the store (a category-scoped query over those
  ids), rather than receiving an unbounded per-content-id candidate list; work scales with
  the number of categories in the subtree, not the amount of content in it. Paging past
  that first bounded page is the continuation contract's job, below.

Because the aggregated set routinely exceeds one page, AB#140 also builds the category
listing continuation that decision 8 reserved ("Category listing pages use the same
continuation contract without the filter") and that was previously left to AB#66/AB#115.
AB#140 lands in two changes on one branch: the first (this amendment) is the aggregation
rule and its bounded first-page read; the second is the continuation itself — an opaque
cursor sharing the gallery cursor's signing secret, the route wiring that consumes it, and
the canonical/indexing policy for a category continuation URL — recorded in its own
**ADR-0013** because it is a URL/data contract in its own right. Until that second change
merges, a branch whose aggregated content exceeds `MAX_CONTENT_LISTING_PAGE_SIZE` serves
only its first page and answers `?cursor=` with a 404, exactly as every category listing
does today; aggregation makes that state reachable with fewer items, and closing it is the
same-story follow-up, not a deferral to another story. This amendment covers only the
aggregation rule.

Changed text: decision 5's "secondary listings" description of what a branch shows;
decision 8's category-listing paragraph and its "the aggregation applies only to the story
root" sentence; and the 2026-08-10 amendment's "Category branches retain their
canonical-and-secondary membership rule unchanged." The canonical placement rule itself
(one canonical category per published page), the detail-route, breadcrumb, redirect, and
sitemap contracts, and the story-root overview are all unaffected.

## Context

The public site needs one navigable category tree for curated galleries and editorial
articles. The decision must precede the category domain, public routes, related CMS
schemas, sitemap, and legacy redirects.

The current mock layer models `Gallery` and `Article` independently. Both are public
content pages, but a gallery is currently an ordered media collection while an article
is an editorial sequence of content blocks. Treating them as entirely unrelated would
duplicate their future category, routing, and canonical-location rules. Treating them
as indistinguishable would lose the gallery-specific result set used by the grid,
lightbox, sections, and pagination.

ADR-0002 already distinguishes body content from gallery media placement: an image in
a page body is not automatically a gallery item and does not enter the gallery result
set or lightbox sequence.

This ADR was completed in small decisions. Every decision in the AB#102 scope is now
recorded, and the project owner accepted the completed decision on 2026-07-31.

## Decision

### 1. One content page with explicit gallery and article variants

Adopt one project-owned public content-page boundary with exactly one explicit variant:
`gallery` or `article`.

The common page owns the fields and behavior shared by both variants. Its shared
body-block subset is defined below.

- A `gallery` variant owns an ordered curated-gallery result set in addition to the
  common page content.
- An `article` variant owns an editorial content sequence and does not implicitly
  acquire a gallery result set from media embedded in that sequence.
- Both variants may contain substantial text and media in their body.
- Text length, image count, or the presence of body media never infers or changes the
  variant.
- The author selects the variant from the page's primary purpose: a curated photographic
  series with supporting narrative is a `gallery`; an editorial or travel narrative
  whose written story is primary is an `article`, however many media placements its body
  contains.
- Variant-specific renderers may present the common page differently, but both variants
  participate in the same public content tree.

The variant discriminator is a project-owned domain concept. This decision does not
choose whether a future CMS represents the variants with one conditional schema or two
provider schemas mapped to the shared domain boundary.

### 2. One shared body-block set

Gallery and article variants support the same six body-block types:

1. paragraph;
2. heading at level 2 or 3;
3. ordered or unordered list;
4. blockquote with optional attribution;
5. media placement; and
6. privacy-first YouTube embed.

The page title owns the single `h1`, so an authored body cannot add another `h1`.
A YouTube block does not contact YouTube until the visitor explicitly chooses to load
the player, preserving the site's privacy-by-default policy.

A media block is a content placement. On a gallery page it remains separate from the
variant's curated gallery result set: it does not enter the image grid, lightbox
sequence, sections, or pagination. The same separation applies regardless of how much
text or media either variant contains.

This decision defines which body blocks are allowed, not where the body renders relative
to a gallery's section controls and image grid.

### 3. Gallery-page content order and persistent section controls

The canonical first page of a gallery renders in this document order:

1. page title;
2. short lead;
3. content-derived page-jump navigation when a long body exists;
4. optional long body;
5. gallery section controls; and
6. optional selected-section introduction; and
7. image grid.

The short lead introduces the gallery. A gallery may consist of the lead and curated
gallery alone; a long body is not required. When present, the long body provides
supporting context and renders before the section controls and grid. It is expected to
be a few paragraphs as an authoring guideline, not a schema length limit. When an
editorial or travel narrative is the page's primary purpose and may run to book length,
the author chooses the `article` variant instead. Per decision 1, body length alone never
infers the variant.

Page-jump navigation is derived from structure, not controlled by an authoring toggle:

- with no long body, the page renders no page-jump navigation, because there is nothing
  to skip;
- with a long body, the navigation offers a link to the image grid; and
- when the long body carries level-2 headings, the same navigation lists them as a table
  of contents, so supporting context remains navigable without scrolling through it.

The article variant derives the same heading-based table of contents from its body and
omits the grid link it has no grid for.

Section controls render immediately above the image grid. Once they reach the viewport
edge they remain available while the visitor moves through the grid, but use a
reveal-on-scroll-up pattern on both mobile and desktop:

- scrolling down moves the controls just outside the viewport to preserve image space;
- any deliberate upward scroll reveals them promptly;
- keyboard focus within or moving to the controls keeps or makes them visible;
- the controls remain in normal document order and usable without the enhancement;
- motion respects the visitor's reduced-motion preference; and
- the compact mobile presentation must not consume a large part of the viewport.

The exact responsive control form and section-selection behavior belong to the gallery
section story. This ADR requires equivalent access on mobile and desktop rather than
assuming that a desktop control row will fit a narrow viewport.

A named gallery section may have a short optional locale-specific introduction. The
first page of the selected section renders its authored label as a level-2 heading and
the introduction after the section controls and before the grid. The introduction uses
a deliberately small content subset: paragraphs, ordered or unordered lists, and inline
links and emphasis. It cannot contain headings, media, or embeds. This supports concise
context such as an ordered event result beneath a `Palkintojenjako` section without
turning the section into a nested content page. The parameter-free `All` view does not
concatenate section introductions; it uses the gallery's own lead and optional body.

Cursor continuation pages do not repeat the lead, page-jump navigation, long body, or
selected-section introduction. They retain a compact visible `h1` identifying the
gallery and continuation, followed by the section controls and grid. This preserves page
context and heading semantics without duplicating the editorial content. Cursor URL
canonical and indexing policy is decided separately in this ADR.

### 4. An ordered category tree with a maximum depth of five

Model public content categories as one ordered tree beneath an implicit site root. The
implicit root is not an authored category and owns no public route. It permits multiple
content-managed top-level categories without hardcoding photographer-specific roots.

Each persisted category has:

- an immutable, project-owned `categoryId`;
- an editable display label;
- an editable path segment (`slug`);
- zero or one parent category; and
- an explicit sibling order value.

Top-level categories have no persisted parent. Every other category has exactly one.
The first persisted top-level category is depth one, and the maximum category depth is
five. A content page below the category path does not count as a category level.
Article tags, media keywords, and gallery sections are separate concepts and never
consume category depth.

Sibling categories sort by their explicit author-defined order and then by immutable
`categoryId` as a deterministic tie-breaker. Slugs are unique among siblings. The same
slug may appear under different parents because its full ancestry produces a different
path.

The category domain rejects, rather than repairs:

- self-parenting;
- direct or indirect cycles;
- a non-root category whose parent is missing from the public tree;
- depth greater than five; and
- sibling slug collisions.

A future CMS should prevent publishing these states, while the project-owned domain
validation remains the authoritative backstop. It reports deterministic errors and
never guesses a parent, truncates ancestry, or silently renames a colliding slug.

A category with no directly placed public content remains public when it has a public
descendant, so structural branch categories are valid. A leaf with neither directly
placed public content nor public descendants is omitted from public navigation, public
category routes, and the sitemap. It may remain in draft or authoring data.

Gallery and article variants may be placed in the same category. Categories remain
distinct from tags, keywords, and gallery sections. Multiple category listings and one
canonical content placement are decided separately below.

### 5. One canonical content placement with secondary listings

Every published gallery or article has exactly one explicit canonical category
placement. Draft content may remain unplaced while it is being authored, but it cannot
enter the public tree until its canonical placement is valid and public.

A content page may additionally have zero or more unique secondary category placements.
Its canonical category cannot also occur in that secondary set. The variant and content
identity do not change when placements change.

Only the canonical placement owns a public content-detail route. A secondary category
may include a card or other listing entry for the content, but that entry links to the
one canonical detail route. It does not create a second detail page beneath the
secondary category. The detail page's breadcrumb follows canonical category ancestry,
regardless of which category listing the visitor used to reach it.

The canonical detail page emits an absolute, self-referencing `rel="canonical"` URL.
Secondary category listing pages remain distinct pages with their own canonical
metadata; an individual listing card has no canonical metadata of its own.

The exact public route prefix and path shape are decided separately in this ADR. Whatever
shape is selected, internal links, generated metadata, and the sitemap use the same
canonical detail URL.

A canonical category must remain public. Before it can be hidden or removed, each
affected published content page must either receive a new valid canonical category or
leave publication. When a canonical placement or its ancestry changes the public detail
URL, the old canonical URL redirects permanently to the new one. Adding, removing, or
reordering only secondary placements never changes the canonical URL.

This is content placement, not media placement. ADR-0002's canonical media context
identifies one photograph's public home; this decision identifies one gallery or
article page's home in the public content tree.

### 6. Localized public story namespaces with an unprefixed default locale

Place the category tree and its canonical gallery and article pages beneath one shared,
human-facing namespace. The English segment is `stories`; the Finnish segment is
`tarinat`.

The first production deployment publishes Finnish and English content from its first
launch. The default Finnish locale omits a locale prefix, while every non-default locale
carries an explicit prefix:

- Finnish: `/tarinat/...`
- English: `/en/stories/...`

Supported locales, the default locale, non-default locale prefixes, and story namespaces
are deployment-owned route configuration chosen before launch. The first production
deployment configures Finnish as the default locale and English beneath `/en`. These
values are not editable CMS content. Adding a non-default locale does not move existing
default-locale URLs, but removing a locale, changing the default locale, or changing a
live prefix or namespace is a route migration that requires an explicit compatibility
and redirect plan.

Every configured non-default locale prefix is reserved at the root. A default-language
static route cannot claim `/en` or any other configured locale prefix, and configuration
validation rejects that collision before deployment.

Finnish owns the unprefixed visitor-facing route space in the first production
deployment. The site root `/` serves the Finnish home page directly; it is not a language
chooser and never redirects according to browser language. Changing the configured
default locale would change which language owns the unprefixed canonical routes, so it
requires a deliberate migration of the affected visitor-facing URLs.

Canonical Finnish URLs never use `/fi`. A request carrying that redundant default-locale
prefix redirects permanently to the corresponding unprefixed canonical route only when
that exact Finnish route exists. An unknown `/fi/...` path follows normal not-found
behavior rather than receiving a blanket redirect.

Language-neutral machine routes keep fixed, unlocalized root paths outside the
visitor-facing locale contract: `/robots.txt`, `/sitemap.xml`, the favicon, and any
later machine endpoint.

Alternate-language metadata on a localized page names every published version of the same
stable identity, including a self-referencing entry, plus an `x-default` entry pointing at
the default locale's version. For the first deployment, `hreflang="fi"` and `x-default`
therefore point to the same unprefixed Finnish canonical URL. When the default locale has
no published version of that content, both its locale alternate and `x-default` are
omitted rather than pointed at another language.

A clone that supports only one locale publishes that default locale without a prefix.
Adding a non-default language later gives only the new language a prefix and does not
move the existing default-language URLs. Changing which language is default remains a
route migration.

Let `<locale-base>` be empty for the default locale and `/<locale-prefix>` for every
non-default locale. The namespace owns these route shapes:

- `<locale-base>/<story-namespace>`: public content-tree root;
- `<locale-base>/<story-namespace>/<category-path>`: category branch; and
- `<locale-base>/<story-namespace>/<canonical-category-path>/<content-slug>`: canonical
  gallery or article detail.

The content variant is not encoded in the path. Changing between `gallery` and `article`
does not by itself change the canonical URL.

At each category level, public child categories and canonically placed content share one
local slug namespace. A child category and a canonical content page cannot own the same
slug beneath one parent. Gallery and article variants also share this namespace.
Secondary content placements own no detail route and therefore create no slug
collision. Validation rejects ambiguity before publication; the route resolver never
guesses whether a path identifies a category or content.

Localized static routes remain outside the story namespace. Home, services, and contact
keep their own route owners but compose with the same default-unprefixed,
non-default-prefixed locale contract.

The template's pre-launch `/portfolio`, `/blog`, and `/blog/<slug>` routes own no
canonical content once the story namespace exists. They were never deployed, published,
or indexed, so their replacement is removal rather than a compatibility redirect: a
redirect is owed to a URL somebody can actually be holding, and a route that only ever
resolved on a developer's machine has no such claim. Adding one would also put a second,
unverified source into the redirect registry that every collision, loop, and chain check
then has to carry. Only URLs verified in the production Joomla inventory earn a redirect,
and AB#19 owns that mapping. AB#124 removed `/blog` and `/blog/<slug>` on this basis;
AB#104 owns `/portfolio` and applies the same rule unless the inventory says otherwise.

Public navigation composes deployment-owned static links with the public tree's top-level
categories. The tree is the source of content navigation, and site settings never restate
it as a hand-maintained link list. How that navigation is presented — and to what depth —
is an implementation decision, not a route decision.

Reserve a separate localized top-level route for later virtual keyword queries:
`/en/search` in English and `/haku` in Finnish. These routes do not identify persisted
category nodes and are not implemented by this ADR.

Category and content labels and slugs may be localized, while immutable category and
content identifiers associate language versions. Canonical URLs remain
language-specific. A version may publish in one locale without requiring every other
configured locale to exist. Alternate-language metadata names only versions that are
actually published; it never invents a translation.

Preserving the useful English content already published by the first production site is
a bounded launch requirement. It does not require every new Finnish page to receive an
English version. AB#128 owns locale-aware public routing and language switching. Exact
deployment-specific legacy redirects remain in AB#19.

The later multilingual authoring experience must provide one action for creating a
missing locale version from an existing gallery or article. The target starts as a
linked draft and preserves the source page's variant, media references, gallery order,
sections, cover, and body-block structure so the author can concentrate on rewriting
language-dependent text. Source text remains available as the editing base, but the
target cannot publish until its localized text, slug, SEO fields, media text, and
canonical category placement have been reviewed. The action never duplicates source
media assets, never overwrites the source locale, and never publishes or machine
translates automatically. AB#125 owns this post-launch authoring workflow.

Optional AI translation and editorial assistance is a separate post-MVP capability owned
by AB#126. It may prepare reviewable suggestions inside the AB#125 draft, but it does not
change the manual review and publication controls. Azure Foundry direct model inference
is the default adapter, while the application-facing boundary stays provider-neutral and
provider selection remains deployment configuration. AB#126 chooses a supported model,
API, and deployment design from implementation-time evidence without exposing
provider-specific types to the content or authoring contracts.

The public namespace alternatives considered were `explore`, `stories`, `browse`,
`work`, `collections`, `archive`, and `discover`. `stories` was selected because it is
human-facing and can describe both photographic series and editorial articles without
putting either implementation type in the URL.

The Finnish alternatives considered were `valokuvat` — the segment the current production
site uses — together with `kuvat`, `galleriat`, and `tarinat`. The first three name
photographs, while the namespace also holds editorial articles, so `tarinat` was selected
as the segment that carries the same breadth as `stories` in its own language. Keeping
`valokuvat` would still leave gallery detail routes to migrate into the shared
`tarinat` namespace.

### 7. Stable slugs, permanent redirect history, and locale-switch fallback

Display labels and public path segments have separate lifecycles. Editing a content
title or category label does not automatically change its slug. The slug is generated
or chosen before first publication and then remains stable unless the author invokes an
explicit URL-change action.

Before changing a published slug, canonical placement, or category parent, the authoring
UI shows the old and proposed paths. A category move also previews the affected
descendant categories and canonically placed content. These high-impact changes require
explicit confirmation. Changes before first publication create no redirect history.

Every previous published path redirects permanently and directly to the current
same-language canonical URL. If a path changes from A to B and later to C, both A and B
resolve directly to C. Redirect chains and loops are rejected. Previous published paths
remain reserved and cannot be reassigned automatically to unrelated content.

Redirect history is retained indefinitely. The authoring integration records the
previous path against stable category or content identity, the project-owned domain
validates it, and the route layer emits the redirect. Sitemap entries, canonical
metadata, and internal links use only the current path.

A category cannot be removed or hidden while it still owns public children or canonical
content. Those dependants must first move or leave publication. Secondary placements
may be detached. Unpublishing content without a genuine replacement produces a public
404 in the MVP; it does not invent a redirect. An explicit successor may receive a
redirect when the editorial relationship is real.

Content-managed history, locale-route migrations, and deployment-specific legacy
mappings are separate redirect sources combined into one validated route registry.
AB#19 owns the first production site's Joomla mappings. Collision, loop, and chain
checks apply across all sources.

Redirects never infer a change of language. A Finnish historical URL redirects to the
current Finnish canonical URL, and an English historical URL redirects to the current
English canonical URL.

Language switching is explicit navigation based on stable identity:

- from a content page, open the published target-locale version of the same content;
- when that version is missing, open the target-locale version of its canonical parent
  category, one tree level up;
- from a category, open the same category in the target locale, or its target-locale
  parent when the category version is missing; and
- resolve to the target language's canonical first page, dropping source-language
  section and cursor state.

The switch communicates when it will open a parent category instead of an exact content
translation. A valid localized public tree guarantees that the required parent ancestry
exists; the target-language story root is the defensive fallback for invalid or stale
data. Language switching does not automatically redirect a visitor based on browser
language. It resolves the target by stable identity rather than editing path strings:
switching to Finnish emits the unprefixed canonical URL, while switching to English emits
the `/en`-prefixed canonical URL.

### 8. Lowercase gallery URLs with section filters and opaque cursor continuation

Canonical path slugs use lowercase letters and hyphens between words. Display labels
and titles retain their authored casing, so a category labelled `WRC` and a page titled
`Neste Rally Finland 2008` may have these public views:

- `/tarinat/wrc/neste-rally-finland-2008`;
- `/tarinat/wrc/neste-rally-finland-2008?section=palkintojenjako`;
- `/tarinat/wrc/neste-rally-finland-2008?cursor=<opaque-token>`; and
- `/tarinat/wrc/neste-rally-finland-2008?section=palkintojenjako&cursor=<opaque-token>`.

The route resolver never treats differently cased paths as separate content. Canonical
paths also carry no trailing slash. A request that differs from the canonical path only by
casing or by a trailing slash, and that resolves unambiguously, redirects permanently to
the canonical form; the site root `/` is the one exception, and decision 6 owns it. The
opaque cursor value is case-sensitive and is never normalized.

Parameter order and unrecognized parameters never trigger a redirect. Redirecting there
would break inbound campaign, referral, and analytics links for no gain, so the resolver
reads the parameters it knows and ignores the rest. Canonical metadata, sitemap entries,
and internal links always emit only recognized parameters in the stable order `section`,
then `cursor`, which is what keeps an unknown parameter from producing an indexable
duplicate.

The absence of `section` means the complete `All` view. A named section is a
gallery-local filtered view selected by its stable section slug; it is not a child
category, content page, or separately authored route. The default values `section=all`
and an empty section parameter normalize to the parameter-free first page. Selecting a
different section always removes the previous cursor and opens that section's first
page.

Each named section has a stable gallery-local identity, an authored label, a slug, an
explicit order, and an optional localized introduction as defined in decision 3.
Section membership belongs to a gallery media placement rather than to the underlying
media asset, so assigning or moving an item does not move the source asset or affect its
use in another gallery. The exact provider schema and section authoring interface remain
AB#105's responsibility.

Section slugs are lowercase and hyphenated, unique within their gallery, and validated
against the reserved token `all`, so an authored section can never shadow the unfiltered
view. A section slug is fixed at first publication. Changing one is an explicit action
that warns the author that shared and bookmarked section links will stop resolving:
section views are `noindex` and non-canonical, so this ADR keeps no redirect history for
them and a retired slug returns the 404 defined below. AB#105 owns section authoring and
mints the slug.

Query parameter names and the reserved `all` token stay English in every locale. They are
a machine contract between the route layer and the shared gallery query rather than public
prose, and localizing them would fork the parser and give one view two spellings.
Localization applies to the path vocabulary a visitor reads, shares, and recognizes as
their own language.

A cursor is a server-issued opaque continuation bookmark. It means “continue after the
last item returned for this gallery, section, order, visibility version, and page size”;
it is not an editable slug or a numeric page chosen by the author. The browser must
return the token unchanged. The shared gallery contract owns cursor creation and
validation, while the public route only transports the token.

Because unfiltered continuation URLs are indexable, the cursor contract may not invalidate
them casually. AB#66 must keep a token valid across changes that do not move the slice
boundary it names — appending images to the end of a gallery, editing captions, or
republishing an unchanged order — and invalidate only when reordering, removal, or a
visibility change makes that boundary meaningless. Without this property, ordinary editing
of a 400-image gallery would retire every indexed continuation URL at once.

The continuation control has a real `href` containing the next cursor URL. JavaScript
may progressively enhance that link by appending results and updating browser history,
but the URL also renders a bounded continuation page without JavaScript. Reloading or
sharing the URL therefore restores a meaningful view. Continuation pages retain the
compact visible gallery heading and section controls defined above.

Canonical and indexing behavior is:

- the parameter-free gallery page is indexable and self-canonical;
- an unfiltered cursor continuation is indexable and self-canonical because it contains
  a distinct sequential slice of the gallery;
- every named-section view, with or without a cursor, is `noindex` and points its
  canonical metadata to the parameter-free gallery page because it is an alternate
  filter of the same curated result set;
- only the parameter-free gallery URL enters the sitemap; crawlable continuation links
  expose later unfiltered slices; and
- fragments such as `#gallery` may support in-page jumps but never identify a section,
  continuation page, or canonical URL.

Category listing pages use the same continuation contract without the filter. A category
route accepts `?cursor=`; `?section=` is a gallery-local filter and carries no meaning
there, so it is ignored like any other unrecognized parameter. The parameter-free category
page and its cursor continuations are self-canonical and indexable, and only the
parameter-free URL enters the sitemap. A listing presents public child categories in
sibling order first, then content pages newest first with the immutable content identifier
as the tie-breaker. A branch's content pages are those whose canonical or secondary
placement is in that category **or in any category within its descendant subtree**
(2026-08-27 amendment); a secondary listing entry uses the same order and links to the one
canonical detail route. What a listing entry shows is an implementation decision; its
route, its deterministic order, and its continuation contract are decided here.

The story root uses that same bounded listing projection for a cross-category recent
overview. Its candidates are published pages whose variants currently have a served
detail route, ordered newest first with the same immutable-id tie-breaker. An overview
card still links to the category-owned canonical path and creates no root placement. A
category branch aggregates its own descendant subtree downward (2026-08-27 amendment); the
story root aggregates the whole tree. Neither aggregation adds a placement or a second URL.

A valid section with no public items returns a successful accessible empty state and
remains `noindex`. An unknown section and a malformed, tampered, wrong-scope, or stale
cursor return an accessible 404 response with a link to the gallery's parameter-free
first page; they are `noindex` and create no redirect or successful cache entry. An
unknown category path or content slug returns the same accessible 404 rather than a
redirect to an ancestor, because guessing an ancestor would claim a relationship the data
does not state.

### 9. Same-language legacy targets with an explicit retirement policy

AB#19 owns the machine-checkable redirect mapping for the first production deployment.
Its source inventory contains the public Joomla page routes observed before migration.
This ADR defines how target classes are chosen; AB#19 records the exact source and
target pair only after the migrated content's locale, canonical category, and slug are
known.

Legacy routes follow these target rules:

- a Finnish gallery, article, or category route maps directly to its current Finnish
  canonical route beneath `/tarinat`;
- an English gallery, article, or category route maps directly to its current English
  canonical route beneath `/en/stories`;
- language aliases and other historical aliases map directly to the same final target,
  never through another legacy URL;
- a localized static page maps to the exact same-language canonical route owned by that
  page's implementation story;
- a Joomla component, tag, search, feed, or other system route receives a redirect only
  when a public replacement has the same visitor intent; otherwise AB#19 records a
  justified `410 Gone`;
- intentionally retired legacy content receives an exact successor only when the
  editorial relationship is genuine; otherwise the migration mapping uses `410 Gone`;
  and
- query strings, fragments, and numeric gallery lightbox states are never stripped or
  translated automatically. AB#19 records an explicit behavior when a stable equivalent
  section, gallery, or media target exists.

There is no blanket redirect to a locale root, story root, category, or home page.
Redirects never change language. A missing English replacement is a content-migration
gap to resolve before cutover, not permission to redirect the old English URL to
Finnish.

The mapping is revisited when:

- the migration discovers a public source URL absent from the inventory;
- a target's locale, canonical category, slug, or publication state changes before
  cutover;
- AB#66 introduces a genuine replacement for a retired tag or keyword-query route;
- supported locales or their namespace configuration changes;
- query-state or image deep links prove to have meaningful inbound traffic; or
- production verification finds a chain, loop, collision, missing target, or unexpected
  status.

After cutover, a canonical target move is added to the flattened redirect history
rather than silently rewriting the migration evidence.

### Scope of implementation

This ADR decides the public content tree and its URL contract; it does not authorize
building every capability it names. The MVP implements the variant boundary, the shared
body-block set, gallery page order and section controls, the category tree and its
validation, canonical and secondary placement, the localized story namespace with
unprefixed Finnish and prefixed English routes, slug stability with redirect history,
and the section and cursor URL contract.

Named here and built by their own stories: locale-aware routing and language switching
(AB#128), the localized-version authoring workflow (AB#125), AI editorial assistance
(AB#126), the deployment-specific legacy mapping (AB#19), the cursor and query contract
(AB#66), section authoring (AB#105), and the portfolio and article route migrations
(AB#104, AB#124). Naming a rule here gives those stories a decided vocabulary; it is not a
licence to build them early.

## Options Considered

### Option A: Separate gallery and article models

| Dimension | Assessment |
| --- | --- |
| Conceptual separation | High |
| Shared-rule duplication | High |
| Gallery-specific behavior | Clear |
| Fit for one content tree | Requires coordination between two parallel models |

**Pros:** each type is simple in isolation; gallery-only fields cannot appear on an
article.

**Cons:** shared category, URL, canonical, and editorial fields need parallel rules and
can drift.

**Rejected** because galleries and articles are both public content pages governed by
the same tree.

### Option B: One undifferentiated model inferred from content quantity

| Dimension | Assessment |
| --- | --- |
| Initial model complexity | Low |
| Authoring predictability | Poor |
| Gallery-specific behavior | Ambiguous |
| Long-term stability | Poor |

**Pros:** no explicit variant selection is needed.

**Cons:** there is no durable threshold at which text or image quantity turns a gallery
into an article. Editing content could silently change routing or presentation, and body
images could be confused with the curated gallery sequence.

**Rejected** because content quantity is not a stable content-type boundary.

### Option C: Shared content page with explicit variants

| Dimension | Assessment |
| --- | --- |
| Initial model complexity | Medium |
| Shared-rule duplication | Low |
| Gallery-specific behavior | Clear |
| Authoring predictability | High |

**Pros:** common behavior has one owner; the author deliberately chooses the page's
primary form; gallery items remain distinct from body media.

**Cons:** validation and rendering must understand the discriminator, and some fields
are meaningful only for one variant.

**Accepted for this part of the ADR.**

### Option D: Restrict gallery bodies to a smaller block subset

| Dimension | Assessment |
| --- | --- |
| Gallery authoring surface | Smaller |
| Shared rendering | Partial |
| Editorial flexibility | Lower |
| Rule maintenance | Requires an exception list |

**Pros:** gallery authoring initially presents fewer choices.

**Cons:** a gallery cannot use an already-supported list, quote, body media, or
privacy-first video without revisiting the domain boundary. The common content page
would still need variant-specific body validation.

**Rejected** because no current product or technical constraint justifies the
restriction.

### Option E: Share all six existing body-block types

| Dimension | Assessment |
| --- | --- |
| Gallery authoring surface | Broader |
| Shared rendering | Complete |
| Editorial flexibility | High |
| Rule maintenance | One allow-list |

**Pros:** both variants use one body contract and renderer; galleries can carry rich
supporting context without changing variant.

**Cons:** the CMS must present the difference between a body-media placement and a
curated gallery item clearly.

**Accepted for this part of the ADR.**

### Option F: Put the gallery body before the grid with conditional jump links

| Dimension | Assessment |
| --- | --- |
| Narrative flow | Strong |
| Gallery reachability | Direct through a generated jump link |
| No-body galleries | No redundant controls |
| Authoring complexity | No manual display toggle |

**Pros:** supporting context is read in order before the photographs; visitors can skip
directly to the grid; a simple lead-and-gallery page stays visually minimal.

**Cons:** without using the jump link, even a few body paragraphs add distance before
the first image.

**Accepted for this part of the ADR.**

### Option G: Put the long body after the grid

| Dimension | Assessment |
| --- | --- |
| First-image reachability | Fast |
| Narrative flow | Weak |
| Long-gallery behavior | Body may sit behind hundreds of images or later pages |
| Authoring complexity | Low |

**Pros:** photographs appear immediately after the lead and controls.

**Cons:** supporting context becomes difficult to discover in a large gallery and its
position becomes unclear once cursor pagination is introduced.

**Rejected** because the body provides context for the gallery rather than an epilogue
to it.

### Option H: Collapse the long body by default

| Dimension | Assessment |
| --- | --- |
| Gallery reachability | Fast |
| Narrative visibility | Reduced |
| Interaction complexity | Additional disclosure state |
| Progressive enhancement | More complicated |

**Pros:** the body occupies little space until requested.

**Cons:** meaningful editorial content is hidden by default and requires an interaction
even when it is only a few paragraphs.

**Rejected** because an anchor link provides fast gallery access without hiding content.

### Option I: Keep section controls static above the grid

| Dimension | Assessment |
| --- | --- |
| Implementation complexity | Low |
| Access within a large gallery | Poor |
| Viewport use | No persistent obstruction |
| Mobile behavior | Simple |

**Pros:** no scroll-direction behavior or sticky positioning is required.

**Cons:** changing section near the end of a large gallery requires returning to the
start of the grid.

**Rejected** because persistent section access is a stated large-gallery requirement.

### Option J: Keep section controls permanently visible while scrolling

| Dimension | Assessment |
| --- | --- |
| Section access | Immediate |
| Implementation complexity | Low to medium |
| Viewport use | Poorer, especially on mobile |
| Interaction predictability | High |

**Pros:** controls never need to be rediscovered.

**Cons:** they continuously cover or displace part of the photographic viewport even
while the visitor is scrolling down to view more images.

**Rejected** because permanent visibility gives the controls too much visual weight.

### Option K: Hide on downward scroll and reveal on upward scroll

| Dimension | Assessment |
| --- | --- |
| Section access | Prompt on user intent |
| Implementation complexity | Medium |
| Viewport use | Good |
| Accessibility | Requires explicit focus and reduced-motion rules |

**Pros:** images receive the viewport while browsing downward; section controls return
without a trip to the start of the grid.

**Cons:** direction detection is an enhancement that must avoid flicker, accidental
hiding, and keyboard-focus loss.

**Accepted for this part of the ADR.**

### Option L: A permissive category graph

| Dimension | Assessment |
| --- | --- |
| Multiple-parent reuse | Supported |
| Canonical ancestry | Ambiguous |
| Validation complexity | High |
| Navigation predictability | Poor |

**Pros:** one category object could appear beneath several parents.

**Cons:** one category would have several paths, breadcrumbs, and potential canonical
locations. Cycle handling and moves would become graph operations rather than tree
operations.

**Rejected** because secondary content listings do not require categories themselves to
have multiple parents.

### Option M: One strict ordered tree beneath an implicit root

| Dimension | Assessment |
| --- | --- |
| Multiple top-level categories | Supported |
| Canonical ancestry | Unique |
| Validation complexity | Moderate |
| Navigation predictability | High |

**Pros:** every category has one resolvable ancestry and path; multiple authored roots
remain possible without a public wrapper category.

**Cons:** placing a category beneath another parent is a move, not a second placement.

**Accepted for this part of the ADR.**

### Option N: Allow unlimited authored depth

| Dimension | Assessment |
| --- | --- |
| Structural flexibility | Highest |
| Authoring guardrails | None |
| URL and navigation depth | Unbounded |
| Generic template fit | Risks accidental complexity |

**Pros:** the domain never blocks an unusually deep taxonomy.

**Cons:** accidental nesting can produce unusably deep navigation and URLs, and every
consumer must handle unbounded authored depth.

**Rejected** because the public site needs a practical authoring boundary.

### Option O: Limit categories to five persisted levels

| Dimension | Assessment |
| --- | --- |
| Structural flexibility | High |
| Authoring guardrails | Explicit |
| URL and navigation depth | Bounded |
| Generic template fit | Covers deep hierarchies without becoming unbounded |

**Pros:** accommodates multi-level photography subjects while keeping route and
navigation design finite.

**Cons:** a clone requiring a sixth category level must deliberately revise the
decision.

**Accepted for this part of the ADR.**

### Option P: Publish completely empty leaf categories

| Dimension | Assessment |
| --- | --- |
| Authoring preview | Public |
| Visitor value | None until content arrives |
| Sitemap quality | Adds empty destinations |
| Navigation clarity | Weaker |

**Pros:** routes can exist before their content is ready.

**Cons:** visitors and crawlers reach pages with no content or onward branch.

**Rejected** because incomplete leaf categories are authoring state, not public
navigation.

### Option Q: Hide empty leaves but retain structural branches

| Dimension | Assessment |
| --- | --- |
| Authoring preview | Remains outside the public tree |
| Visitor value | Every public node has content or an onward branch |
| Sitemap quality | No empty destinations |
| Navigation clarity | Strong |

**Pros:** parent categories can organize descendants without requiring directly placed
content, while empty endpoints stay private.

**Cons:** publishing an empty leaf alone does not create a public placeholder route.

**Accepted for this part of the ADR.**

### Option R: Infer canonical placement from category order

| Dimension | Assessment |
| --- | --- |
| Authoring effort | Lowest |
| Canonical stability | Poor |
| Intent clarity | Poor |
| Reordering safety | Poor |

**Pros:** the author assigns categories without a separate canonical choice.

**Cons:** sorting or removing a category could silently change the content's URL and
breadcrumb. The official location would be an incidental array position rather than a
deliberate decision.

**Rejected** because canonical ownership must not change as a side effect of listing
order.

### Option S: Make canonical and secondary placements explicit

| Dimension | Assessment |
| --- | --- |
| Authoring effort | One deliberate canonical choice |
| Canonical stability | High |
| Intent clarity | High |
| Reordering safety | High |

**Pros:** one placement clearly owns the route and breadcrumb; secondary listing order
cannot change it.

**Cons:** publication validation must require one valid canonical category and prevent
duplicates across the two placement roles.

**Accepted for this part of the ADR.**

### Option T: Generate a detail route beneath every assigned category

| Dimension | Assessment |
| --- | --- |
| Number of content URLs | One per placement |
| Duplicate-content risk | High |
| Redirect surface | Large |
| Visitor path continuity | Preserves the listing path in the address bar |

**Pros:** the detail URL appears to remain inside whichever category the visitor chose.

**Cons:** one content page has several public URLs, relying on canonical hints to repair
an ambiguity created by the application. Moves and removals multiply redirect work.

**Rejected** because secondary discovery does not require duplicate detail pages.

### Option U: Generate one detail route at the canonical placement

| Dimension | Assessment |
| --- | --- |
| Number of content URLs | One |
| Duplicate-content risk | Low |
| Redirect surface | One canonical history |
| Visitor path continuity | Breadcrumb may differ from the referring secondary listing |

**Pros:** internal links, metadata, sitemap entries, and redirects agree on one URL.

**Cons:** entering through a secondary category does not make that category the detail
page's breadcrumb parent.

**Accepted for this part of the ADR.**

### Option V: Publish the generated category tree at the site root

| Dimension | Assessment |
| --- | --- |
| URL length | Shortest |
| Static-route collisions | High |
| Future route reservation | Fragile |
| Route ownership | Distributed |

**Pros:** category and content URLs have no namespace segment.

**Cons:** authored roots can collide with home, services, contact, portfolio, blog, and
later query routes. Every future static page reserves another category slug.

**Rejected** because short paths do not justify permanent root-level ownership
ambiguity.

### Option W: Give galleries and articles separate route namespaces

| Dimension | Assessment |
| --- | --- |
| Type visibility | Explicit in the URL |
| Shared-tree fit | Poor |
| Variant changes | Change the URL |
| Collision handling | Simple within each type |

**Pros:** the router knows the variant from the path.

**Cons:** one content tree is split into type-specific public spaces, and changing a
page's deliberate variant becomes a route migration.

**Rejected** because gallery and article are variants of one public content page.

### Option X: Use one localized story namespace

| Dimension | Assessment |
| --- | --- |
| URL length | One additional namespace segment |
| Static-route collisions | Isolated |
| Shared-tree fit | Strong |
| Multilingual evolution | Locale-specific namespace map |

**Pros:** one route owner handles categories and both content variants; static pages and
future keyword queries remain separate; the public term is not an implementation type.

**Cons:** each supported locale requires an explicit locale/default/namespace
configuration and locale-aware metadata.

**Accepted for this part of the ADR.**

### Option Y: Reuse the English `stories` segment in every language

| Dimension | Assessment |
| --- | --- |
| Router configuration | Simplest |
| Local-language URLs | Partial |
| Cross-language symmetry | Same segment text |
| Public vocabulary | English leaks into other locales |

**Pros:** one static namespace name works for every language.

**Cons:** a Finnish public route remains partly English even when its category and
content slugs are localized.

**Rejected** because public route vocabulary should follow the active language.

### Option Z: Localize the namespace per language

| Dimension | Assessment |
| --- | --- |
| Router configuration | Requires a typed locale-to-segment map |
| Local-language URLs | Complete |
| Cross-language association | Uses stable content/category identities |
| Launch cost | Locale-aware routing and metadata required |

**Pros:** `/en/stories` and `/tarinat` are natural in their own languages; stable
identifiers, not translated strings, associate variants.

**Cons:** locale-aware routing and language-specific canonical metadata are required
from the first production launch.

**Accepted for the first production deployment.**

### Option AA: Keep slugs synchronized with editable labels and titles

| Dimension | Assessment |
| --- | --- |
| Authoring convenience | Automatic |
| URL stability | Poor |
| Redirect volume | High |
| Change intent | Implicit |

**Pros:** public paths always resemble the latest title or label.

**Cons:** a spelling correction can unexpectedly move a published route and every
descendant route beneath a renamed category.

**Rejected** because normal copy editing must not mutate public identity.

### Option AB: Freeze published slugs until an explicit URL change

| Dimension | Assessment |
| --- | --- |
| Authoring convenience | Requires a deliberate URL action |
| URL stability | High |
| Redirect volume | Controlled |
| Change intent | Explicit |

**Pros:** title and label edits are safe; URL-impacting actions can show and validate
their full consequences before publication.

**Cons:** an author must separately update a stale slug when changing public wording is
actually desired.

**Accepted for this part of the ADR.**

### Option AC: Preserve redirect chains and allow old-path reuse

| Dimension | Assessment |
| --- | --- |
| History writes | Simplest |
| Resolution hops | Can grow |
| Loop risk | High |
| Inbound-link safety | Poor |

**Pros:** each change only records its immediate predecessor, and old names can be
recycled.

**Cons:** visitors and crawlers may traverse chains, loops become possible, and an old
external link can later reach unrelated content.

**Rejected** because route history must remain deterministic over the site's lifetime.

### Option AD: Retain reserved history and resolve directly to current canonical URLs

| Dimension | Assessment |
| --- | --- |
| History writes | Requires normalization |
| Resolution hops | One |
| Loop risk | Validated away |
| Inbound-link safety | High |

**Pros:** every historical URL has one stable outcome; sitemap and internal links remain
free of aliases.

**Cons:** published path names remain unavailable for unrelated reuse unless an explicit
future migration supersedes the history.

**Accepted for this part of the ADR.**

### Option AE: Disable language switching when an exact translation is missing

| Dimension | Assessment |
| --- | --- |
| Semantic precision | Exact page or nothing |
| Visitor continuation | Poor |
| Implementation complexity | Low |
| Missing-translation clarity | Clear but blocking |

**Pros:** the language switch never changes content level.

**Cons:** the visitor cannot continue browsing in the chosen language even when the
equivalent category branch exists.

**Rejected** because the public tree provides a useful, predictable fallback.

### Option AF: Fall back one canonical tree level

| Dimension | Assessment |
| --- | --- |
| Semantic precision | Nearest available context |
| Visitor continuation | Good |
| Implementation complexity | Moderate |
| Missing-translation clarity | Requires an explicit label or message |

**Pros:** an untranslated gallery still leads to the corresponding target-language
category; stable identities resolve the link without translating path strings.

**Cons:** the visitor lands on a broader page and must choose another item.

**Accepted for the public multilingual boundary.**

### Option AG: Give each gallery section a child path

| Dimension | Assessment |
| --- | --- |
| URL readability | High |
| Route semantics | Implies a separately authored child resource |
| Collision surface | Adds section/content ambiguity |
| Filter composition | More complex |

**Pros:** the selected section is visible in the path and produces short URLs.

**Cons:** a gallery-local filter would look like a child category or content page and
would enter the same local path namespace as persisted content.

**Rejected** because sections do not own public content-tree nodes.

### Option AH: Represent the selected section with a query parameter

| Dimension | Assessment |
| --- | --- |
| URL readability | Clear |
| Route semantics | Explicitly a view of the gallery |
| Share and restore | Supported |
| Filter composition | Natural with a cursor |

**Pros:** the canonical content route stays unchanged; a section remains a shareable,
gallery-local filter; changing the filter can reset continuation state deterministically.

**Cons:** filtered variations require an explicit indexing and canonical policy.

**Accepted for this part of the ADR.**

### Option AI: Expose numeric offset pages

| Dimension | Assessment |
| --- | --- |
| Human readability | High |
| Fit with the shared result contract | Poor |
| Behavior after reorder | Susceptible to duplicates or gaps |
| Random access | Apparent but unsupported without offset queries |

**Pros:** `page=2` is familiar and easy to type.

**Cons:** the shared query boundary returns opaque continuation cursors rather than page
counts or random-access offsets. Translating a page number back to a cursor would require
fetching preceding pages or adding a second pagination contract.

**Rejected** because it would misrepresent and duplicate the accepted bounded cursor
contract.

### Option AJ: Transport the opaque cursor in the query string

| Dimension | Assessment |
| --- | --- |
| Human readability | Low |
| Fit with the shared result contract | Exact |
| Scope validation | Strong |
| Progressive enhancement | Works as a real link |

**Pros:** the server can bind continuation to gallery, section, ordering, visibility,
and page size; no archive-sized fetch or offset translation is required.

**Cons:** the token is not meaningful to a person and becomes invalid when its bound
result-set version is stale.

**Accepted for this part of the ADR.**

### Option AK: Canonicalize and noindex every parameterized gallery view

| Dimension | Assessment |
| --- | --- |
| Search-result surface | Only the first page |
| Duplicate control | Strong |
| Discovery of later unfiltered slices | Weaker |
| Pagination semantics | Treats distinct slices as duplicates |

**Pros:** search results contain only the clean parameter-free gallery URL.

**Cons:** an unfiltered continuation contains different media and is a real page in the
sequential gallery, so pointing every continuation to the first page loses that
distinction.

**Rejected** for unfiltered cursor pages; retained for named-section filters.

### Option AL: Self-canonicalize unfiltered continuations and noindex section filters

| Dimension | Assessment |
| --- | --- |
| Pagination semantics | Each distinct unfiltered slice has its own URL |
| Filter-URL growth | Contained |
| Crawlability | Sequential real links expose later slices |
| Metadata complexity | Depends on both section and cursor state |

**Pros:** unfiltered pagination remains crawlable and accurately canonicalized, while
alternate section filters do not multiply indexed views of one curated gallery.

**Cons:** implementation must distinguish four metadata states and expired cursor URLs
can leave the index until crawlers observe their 404 responses.

**Accepted for this part of the ADR.**

### Option AM: Launch the replacement as Finnish-only

| Dimension | Assessment |
| --- | --- |
| Initial implementation | Smallest |
| Existing English routes | Lose same-language targets |
| Adding English later | Can add `/en` without moving Finnish URLs |
| Fit with the production inventory | Poor |

**Pros:** multilingual routing, metadata, and content association remain outside the
first launch.

**Cons:** the existing English galleries and pages cannot receive honest same-language
redirects, and multilingual routing and version association are merely deferred.

**Rejected** because a production replacement should not knowingly break useful
published English content.

### Option AN: Prefix every locale, including the default

| Dimension | Assessment |
| --- | --- |
| Initial implementation | Larger but bounded |
| Finnish URL length | Adds `/fi` to every visitor-facing route |
| Default-locale change | Canonical paths stay stable |
| Site root | Redirect or separate language chooser required |

**Pros:** no canonical URL depends on which locale is default, and every locale follows
the same visible prefix shape.

**Cons:** the primary-language URLs carry an unnecessary segment, the shape differs from
the current site's default-language convention, and `/` cannot serve the ordinary home
page directly.

**Rejected** because shorter primary-language URLs are preferred and the project accepts
that changing the default locale later would require a controlled route migration.

### Option AO: Launch bilingually with an unprefixed default locale

| Dimension | Assessment |
| --- | --- |
| Initial implementation | Larger but bounded |
| Existing English routes | Preserve same-language targets |
| Finnish URL length | No locale prefix |
| Default-locale change | Requires a route migration |
| Translation completeness | May remain asymmetric |

**Pros:** Finnish routes remain short, `/` serves the ordinary Finnish home page, the
current default-language convention remains familiar, and existing English content can
receive stable `/en` canonical targets without requiring every new page to be
translated.

**Cons:** the default locale becomes part of route identity; root-level locale prefixes
must be reserved; changing the default locale later moves affected canonical routes and
requires direct permanent redirects.

**Accepted for the first production deployment.**

### Option AP: Redirect old English pages to Finnish equivalents

| Dimension | Assessment |
| --- | --- |
| Initial implementation | Low |
| Language preservation | None |
| Visitor expectation | Violated |
| Future correction | Requires replacing cross-language redirects |

**Pros:** most old URLs could return a successful destination without migrating their
English content.

**Cons:** the redirect silently changes language, misstates the canonical replacement,
and conflicts with the accepted locale-switch and redirect rules.

**Rejected** because a legacy request is not consent to change language.

## Trade-off Analysis

The explicit variant adds one concept compared with an undifferentiated page, but it
prevents presentation from changing as content grows. A shared base is slightly more
abstract than two unrelated types, but it gives category placement, canonical location,
and route policy one domain owner. Keeping the curated gallery result set
variant-specific preserves the media-placement boundary already accepted in ADR-0002.

Sharing the complete current body-block set avoids an otherwise arbitrary gallery-only
restriction and lets one renderer enforce semantics and privacy behavior. The cost is
primarily authoring clarity: the CMS must distinguish body media from gallery items
instead of removing body capabilities.

Putting the gallery body before the grid preserves the intended narrative order.
Content-derived jump links make the grid directly reachable without adding a manual CMS
setting or hiding the body in a disclosure. Treating book-length travel narratives as
articles keeps gallery copy supporting rather than primary without introducing a numeric
text-length boundary. Heading-derived navigation can still make a gallery's supporting
context easier to navigate when it has enough structure to need it.

Static section controls are too distant near the end of a large gallery, while an
always-visible sticky bar consumes valuable photographic viewport. Hiding the sticky
controls during downward browsing and revealing them on upward intent balances both.
The behavior is progressive enhancement: semantic controls remain available in document
order, and focus and reduced-motion rules are part of correctness rather than later
polish.

An implicit site root keeps several top-level categories in one resolvable tree without
inventing a public wrapper category. Single parentage makes ancestry, breadcrumbs, and
future route generation deterministic. Five authored levels provide substantial
hierarchy while bounding navigation and URL complexity. Stable identity remains
separate from editable labels and paths so a rename does not create a new category.

Strict validation is preferable to silent recovery because repairing an orphan, cycle,
or slug collision would publish a route the author did not choose. Hiding empty leaves
keeps incomplete authoring state out of public navigation, while allowing content-free
branch categories preserves useful hierarchy.

An explicit canonical placement adds one authoring choice but prevents category order
from changing page identity accidentally. Secondary listings provide cross-category
discovery without generating duplicate detail routes. This makes the breadcrumb
canonical rather than referral-specific, trading a small loss of path continuity for a
stable URL, smaller redirect surface, and unambiguous sitemap.

A shared story namespace adds one URL segment but prevents generated categories from
competing with static site routes. Keeping the variant out of the path preserves URL
identity if editorial intent changes. Localizing the namespace makes public vocabulary
coherent in each language. Bilingual launch adds bounded work for routing, metadata, and
version association, but preserves existing useful same-language content and links.

Omitting the default-locale prefix keeps the most-used paths short and follows the
current site's familiar default-language convention. It also lets `/` remain the
ordinary home page and lets a single-locale clone add a prefixed second language later
without moving its existing routes. The trade-off is deliberate: the configured default
locale is baked into visitor-facing URL identity. Changing it later moves affected
canonical route families and requires flattened permanent redirects. Non-default locale
prefixes must also be reserved at the root so a default-language static route cannot
claim `/en` or another configured prefix. Browser-language detection remains rejected
because it would override a visitor's deliberate language choice.

Reusing the gallery continuation contract on category listings avoids inventing a second
pagination shape for the same problem. Fixing a deterministic default order costs some
authoring flexibility, but a listing whose order can drift between requests produces
duplicate and missing entries across continuation pages — the failure that opaque cursors
exist to prevent.

Normalizing case and trailing slashes while ignoring unknown parameters splits the URL
into the part that is identity and the part that is not. A path is identity, so a variant
spelling of it should collapse to one canonical form. Query parameters arrive from
campaigns, referrers, and messaging apps that append their own, so redirecting on them
would break real inbound links; emitting only recognized parameters in canonical metadata
achieves the same de-duplication without touching the request.

Section slugs get stability without a second history store. Because section views are
`noindex` and canonicalize to the parameter-free gallery, a retired section slug costs a
broken shared link rather than search visibility, which does not justify the redirect
machinery that path history requires. Making the slug immutable after publication, with an
explicit warned change action, puts the cost where the author can see it.

Separating slugs from labels keeps editorial changes cheap and URL changes deliberate.
Permanent, flattened history consumes a small amount of route data but protects inbound
links and makes every old path deterministic. Reusing old paths or retaining chains
would reduce write work at the cost of ambiguity that becomes harder to repair over
time.

Stable identities make an exact cross-language link possible without comparing
translated slugs. Falling back one canonical level gives the visitor useful
target-language context when a translation is missing. Dropping section and cursor
state avoids claiming that language variants have identical transient result sets.

Lowercase hyphenated slugs keep one human-facing path independent of title casing.
Keeping `section` in the query string preserves the distinction between persisted
content-tree nodes and a gallery-local filter. An opaque cursor is less readable than a
page number but composes directly with the bounded result contract and rejects stale or
foreign continuation state instead of silently returning the wrong slice.

Unfiltered continuation pages contain different ordered media, so self-canonical URLs
represent them more accurately than pointing every page to the first. Named sections
are alternate filters over the same curated gallery, so keeping them out of the index
avoids multiplying search results. Real continuation links preserve crawlability and
non-JavaScript access at the cost of maintaining server-rendered continuation views.

Indexing continuation URLs is only defensible if those URLs survive ordinary editing,
which is why cursor durability became a requirement on AB#66 rather than an implementation
detail. A token that expired on every republish would put the gallery's later slices in
the index and then retire them wholesale, and the alternative — making continuations
`noindex` — would hide most of a 400-image gallery from search entirely. If durability
proves impractical, `noindex` continuations are the fallback, not indexed churn.

Exact legacy targets cannot be authored safely from source strings alone because their
new paths depend on migrated locale identity and canonical category placement. Defining
target classes here while keeping the row-level mapping in AB#19 separates a reusable
route policy from first-site deployment data. A justified `410 Gone` is more honest than
a broad redirect when a Joomla system view or retired page has no genuine replacement.

## Consequences

- Galleries and articles can share category, navigation, and URL rules.
- A gallery can carry supporting narrative without becoming an article; narrative-first
  travel stories use the article variant.
- The variant follows the page's primary purpose, so no numeric text or image threshold
  changes it automatically.
- An article can contain many body images without those images entering a gallery
  lightbox or result set.
- Gallery and article presentation remain deliberately distinct.
- Both variants share one body-block allow-list and semantic renderer.
- Body headings cannot compete with the page title for the `h1`.
- YouTube remains opt-in and makes no third-party request on initial page load.
- A gallery may contain only its short lead and image grid.
- An optional gallery body appears before the section controls and grid.
- Page-jump links appear only when the optional long body exists.
- Level-2 headings in a long body become a table of contents in both variants.
- Section controls stay reachable throughout a large grid without permanently consuming
  viewport space.
- A named gallery section may add a short localized introduction before its first image
  slice, including an ordered result list, without becoming a category or content page.
- The `All` view never concatenates section introductions, and cursor continuation pages
  do not repeat them.
- Cursor continuation pages omit repeated editorial content but retain a compact visible
  page heading and section controls.
- The public taxonomy has one implicit root, unique category ancestry, and at most five
  persisted category levels.
- Category identity survives label, slug, and parent changes.
- Sibling ordering is author-controlled and deterministic even when order values tie.
- Invalid category structures fail validation instead of being silently repaired.
- Empty branch categories may organize public descendants; empty leaves are not public.
- Tags, media keywords, and gallery sections cannot accidentally become route-owning
  content categories.
- Every published gallery and article has one explicit canonical category and may have
  additional secondary category listings.
- All listings link to one detail route, so canonical metadata does not need to
  reconcile application-generated duplicate detail pages.
- Breadcrumb ancestry follows canonical placement rather than the referring listing.
- A canonical category cannot disappear while published content still depends on it.
- Canonical placement or ancestry changes may require redirects; secondary placement
  changes do not.
- Categories and canonical content live beneath one localized story namespace:
  `stories` in English and `tarinat` in Finnish.
- The first production deployment publishes canonical content-tree routes beneath
  `/tarinat` and `/en/stories` from its first launch.
- Finnish is the default locale, owns the unprefixed visitor-facing routes, and serves
  its home page directly at `/`; browser language never selects or redirects it.
- Canonical Finnish URLs never carry `/fi`; a redundant default-locale prefix redirects
  only when the corresponding unprefixed Finnish route exists.
- Changing the default locale moves affected canonical route families and therefore
  requires a deliberate compatibility and redirect plan.
- `x-default` names the default locale's version and is omitted rather than pointed at
  another language when that version does not exist.
- A single-locale clone publishes unprefixed default-language URLs; adding a prefixed
  non-default language later does not move them.
- `/robots.txt`, `/sitemap.xml`, and the favicon retain fixed language-neutral root
  routes.
- Existing useful English content receives English canonical targets, while a new
  Finnish page may publish without an English version.
- Child categories and canonical content share a collision-checked local slug namespace.
- Gallery and article variants do not appear in canonical URLs.
- Static pages, compatibility routes, and virtual keyword queries remain outside the
  story namespace.
- Content navigation derives from the public tree's top-level categories; site settings
  own only static links.
- The default locale, supported locales, non-default prefixes, and localized namespaces
  are project-owned route configuration, not editable CMS fields.
- Configured non-default locale prefixes reserve their root segments against
  default-language static-route collisions.
- A future locale-copy action creates a linked draft from existing structure and media,
  leaving translation, review, and publication deliberate.
- Published labels and titles may change without changing their stable slugs.
- Every historical published path resolves directly to the current same-language
  canonical URL and remains reserved.
- High-impact category moves and canonical placement changes require an impact preview
  and explicit author confirmation.
- Invalid redirects, dependent category deletion, and silent language changes are
  rejected.
- A language switch opens the matching published version or its canonical parent
  category one level up when the exact version is missing.
- Canonical path and section slugs use lowercase letters with hyphens between words;
  authored labels and titles retain their intended casing.
- Casing and trailing-slash variants of a path redirect permanently to one canonical form.
- Unknown query parameters are ignored rather than redirected or 404'd, so campaign and
  referral links keep working without creating indexable duplicates.
- A gallery section is represented by `?section=<section-slug>` and never becomes a
  content-tree child route.
- The `All` view has no section parameter, and changing section resets continuation to
  the selected section's first page.
- A section cannot be slugged `all`, and a published section slug is immutable unless the
  author invokes a warned change action; no redirect history is kept for section views.
- Query parameter names and the reserved `all` token stay English in every locale.
- Cursor values are opaque, case-sensitive server bookmarks transported unchanged in
  `?cursor=<opaque-token>`.
- AB#66 inherits a durability requirement: a token survives appends and non-boundary
  edits, and expires only when reordering, removal, or a visibility change moves the
  boundary it names.
- Category listings paginate with the same cursor contract and a deterministic order;
  `?section=` has no meaning on a category route.
- Parameter-free gallery pages and their unfiltered cursor continuations are
  self-canonical and indexable; named-section views are `noindex` and canonicalize to
  the parameter-free gallery.
- Continuation controls remain real links, with JavaScript append behavior as progressive
  enhancement.
- Invalid section and cursor state returns an accessible non-indexable 404 instead of
  guessing, redirecting, or exposing a successful cache entry.
- An unknown category path or content slug 404s rather than redirecting to an ancestor.
- Legacy redirects always preserve language and point directly to an exact canonical
  replacement.
- Retired Joomla views without a genuine replacement use a justified `410 Gone` rather
  than a blanket redirect.
- The template's own pre-launch routes were never deployed or indexed and are removed
  rather than redirected; only AB#19's verified production inventory earns redirects.
- AB#19 owns exact deployment-specific rows and must explicitly handle meaningful query,
  fragment, and numeric lightbox states.
- The future CMS schema shape remains open; provider documents must map to the
  project-owned variant boundary.
- The current separate mock `Gallery` and `Article` types will eventually need to map to
  or adopt the shared boundary, but this ADR does not authorize that implementation yet.
  AB#124 has since adopted it for `Article`; `Gallery` follows in AB#104.

**To revisit — migration triggers**

- **Cursor durability proves impractical in AB#66** → make unfiltered continuations
  `noindex` and rely on the parameter-free sitemap entry. The rest of the URL contract is
  unaffected, which is the test of whether the indexing rule was separable.
- **A clone needs a sixth category level** → the limit is a validation constant, but
  raising it re-opens navigation, breadcrumb, and URL-depth design rather than just the
  number.
- **A locale is added, removed, or made default** → adding a prefixed non-default locale
  reserves a new root segment without moving existing routes; removing a locale or
  changing the default requires a compatibility plan and direct flattened redirects for
  every affected canonical route.
- **Authors ask for breadcrumbs that follow the referring secondary category** → revisit
  Option U deliberately instead of generating a second detail route, which is the failure
  Option T was rejected for.
- **Section slug changes prove common rather than exceptional** → add gallery-local slug
  aliases. Because section views are `noindex`, this stays link preservation, not SEO.
- **One listing order stops fitting every category** → make the order configurable per
  category; the cursor contract is unaffected.
- **The CMS forces two document types for the two variants** → the mapping layer absorbs
  it. This boundary is the mapping target, not the thing that changes.

## Action Items

Decisions 1–9 of the AB#102 scope are recorded above: variant boundary, shared body
blocks, gallery page order, category tree, canonical placement, story namespace and
locales, slug and redirect lifecycle, section and cursor URLs, and legacy target classes.
The decision is accepted. Remaining implementation belongs to the stories named below.

1. [x] Accept the ADR (`Proposed` → `Accepted`) and update its status in the ADR index.
2. [x] Update `README.md` and `AGENTS.md` in this PR: locale-aware public routing is a
       launch requirement, not a post-MVP roadmap item.
3. [ ] AB#40 supplies the deployment-default `<html lang>` and date-formatting locale.
       Implement default-unprefixed Finnish and `/en`-prefixed English routing in
       AB#128, including `/` as the Finnish home, exact `/fi/...` normalization,
       replacing the deployment-wide defaults with per-route locale behavior, and
       `hreflang` with `x-default`.
4. [ ] Carry the cursor durability requirement into AB#66 so indexed continuation URLs
       survive ordinary gallery editing.
5. [x] Give AB#105 the section identity and authoring rules: label, explicit order,
       optional localized introduction, placement-owned membership, lowercase
       gallery-unique slug, reserved `all`, and slug immutability after publication
       behind a warned change action.
6. [ ] Build the category listing route with the continuation contract and ordering rule
       decided here.
7. [ ] Record the deployment-specific legacy mapping in AB#19 against the target classes
       in decision 9, including the old site root.
8. [x] Remove the pre-launch `/blog` and `/blog/<slug>` routes in AB#124. They were never
       deployed or indexed, so they answer 404 rather than entering the compatibility
       redirect registry; only AB#19's verified production inventory earns redirects.
9. [ ] Apply the same evidence rule to the pre-launch `/portfolio` route in AB#104.
10. [x] Map the mock `Article` type onto the shared content-page boundary in AB#124. It is
        now the `article` variant, and its mock taxonomy is represented by ordinary tree
        categories and canonical/secondary placements.
11. [ ] Map the mock `Gallery` type onto the shared content-page boundary in AB#104.
12. [ ] Implement the post-launch localized-version authoring workflow in AB#125.
13. [ ] Design Azure Foundry-default, provider-neutral AI editorial assistance in
        AB#126.

## What this ADR did not establish

- **Nothing here was measured.** Like ADR-0002 and unlike ADR-0001, this is a design
  decision recorded before implementation. No prototype, schema, or route was built.
- **The CMS schema shape is not chosen.** One conditional document type and two provider
  types both satisfy the variant boundary.
- **The gallery query itself is AB#66's.** Page size, ordering, and cursor encoding are
  decided there; this ADR only transports the token and states one durability requirement.
- **Section storage and authoring UI are AB#105's.** This ADR decides the section's
  public identity, introduction boundary, placement-owned membership, URL form, and slug
  rules without choosing the provider schema or admin interaction design.
- **Rendition and delivery URLs remain out of scope**, as in ADR-0002;
  [ADR-0005](0005-public-image-rendition-boundary.md) proposes their boundary.
- **Visual design is not decided.** Listing entries, breadcrumb rendering, navigation
  presentation, and the section control's responsive form are implementation work; only
  their routes, ordering, and accessibility requirements are fixed here.
- **Private galleries stay outside the public tree.** Nothing here grants AB#122 content a
  public route.
- **No specific AI model, API version, or deployment topology is chosen.** Azure Foundry
  is the default adapter, while AB#126 selects supported implementation details and
  preserves the provider-neutral application boundary.
- **Sitemap file structure is the SEO story's.** This ADR decides which URLs qualify for a
  sitemap, not whether there is one file per locale or an index.
