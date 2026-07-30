# ADR-0003: Public content tree and URL structure

**Status:** Proposed
**Date:** 2026-07-29
**Deciders:** Project owner (Ilkka Rytkönen)
**Work item:** AB#102

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
recorded; the status stays `Proposed` until the project owner accepts it.

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
6. image grid.

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

Cursor continuation pages do not repeat the lead, page-jump navigation, or long body.
They retain a compact visible `h1` identifying the gallery and continuation, followed by
the section controls and grid. This preserves page context and heading semantics without
duplicating the editorial content. Cursor URL canonical and indexing policy is decided
separately in this ADR.

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

### 6. Locale-prefixed public story namespaces from the first production launch

Place the category tree and its canonical gallery and article pages beneath one shared,
human-facing namespace. The English segment is `stories`; the Finnish segment is
`tarinat`.

The first production deployment publishes Finnish and English content from its first
launch. Every localized public content-tree route carries an explicit locale prefix,
including the default Finnish locale:

- Finnish: `/fi/tarinat/...`
- English: `/en/stories/...`

Supported locales and their story namespaces are deployment-owned route configuration
chosen before launch. The first production deployment configures `fi` and `en`. Locale
prefixes and namespace segments are not editable CMS content: adding or removing a
supported locale, or changing a live namespace, is a route migration that requires an
explicit compatibility and redirect plan.

Finnish is the default locale of the first production deployment. The default locale
receives no privilege in the URL space: it carries its prefix like every other locale, so
which locale is default stays a configuration value rather than a property baked into
every canonical path.

The unprefixed site root `/` owns no content. It redirects permanently to the default
locale's home route — `/fi` for the first production deployment — never to the story
root, and never on the basis of the visitor's browser language. Changing which locale is
the default therefore moves one redirect target rather than every published URL, but it
is still a deliberate route change, not a content edit.

Routes that are not visitor-facing prose stay unprefixed and outside the locale
contract: `/robots.txt`, `/sitemap.xml`, the favicon, and any later machine endpoint.

Alternate-language metadata on a localized page names every published version of the same
stable identity, including a self-referencing entry, plus an `x-default` entry pointing at
the default locale's version. When the default locale has no published version of that
content, `x-default` is omitted rather than pointed at another language.

A clone that supports only one locale still uses the prefix contract. The template offers
no unprefixed single-locale mode, because adding a second locale would then move every
canonical URL the clone had already published — the migration this decision exists to
avoid.

The namespace owns these route shapes:

- `/<locale>/<story-namespace>`: public content-tree root;
- `/<locale>/<story-namespace>/<category-path>`: category branch; and
- `/<locale>/<story-namespace>/<canonical-category-path>/<content-slug>`: canonical
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
keep their own route owners but compose with the same explicit locale-prefix contract.
The current `/portfolio`, `/blog`, and `/blog/<slug>` routes are reserved for
compatibility and redirects rather than new canonical content. AB#104 owns the portfolio
migration and AB#124 owns the article-route migration.

Public navigation composes deployment-owned static links with the public tree's top-level
categories. The tree is the source of content navigation, and site settings never restate
it as a hand-maintained link list. How that navigation is presented — and to what depth —
is an implementation decision, not a route decision.

Reserve a separate localized top-level route for later virtual keyword queries:
`/en/search` in English and `/fi/haku` in Finnish. These routes do not identify persisted
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
`valokuvat` would have preserved no legacy URL either: the locale prefix moves every path
regardless.

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

Content-managed history, locale-prefix migrations, and deployment-specific legacy
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
language.

### 8. Lowercase gallery URLs with section filters and opaque cursor continuation

Canonical path slugs use lowercase letters and hyphens between words. Display labels
and titles retain their authored casing, so a category labelled `WRC` and a page titled
`Neste Rally Finland 2008` may have these public views:

- `/fi/tarinat/wrc/neste-rally-finland-2008`;
- `/fi/tarinat/wrc/neste-rally-finland-2008?section=palkintojenjako`;
- `/fi/tarinat/wrc/neste-rally-finland-2008?cursor=<opaque-token>`; and
- `/fi/tarinat/wrc/neste-rally-finland-2008?section=palkintojenjako&cursor=<opaque-token>`.

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
sibling order first, then canonically placed content pages newest first with the immutable
content identifier as the tie-breaker; a secondary listing uses the same order and links
to the canonical detail route. What a listing entry shows is an implementation decision;
its route, its deterministic order, and its continuation contract are decided here.

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
  canonical route beneath `/fi/tarinat`;
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
validation, canonical and secondary placement, the localized story namespace with `fi` and
`en` prefixes, slug stability with redirect history, and the section and cursor URL
contract.

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

**Cons:** each supported locale requires an explicit prefix-to-namespace configuration
and locale-aware metadata.

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

**Pros:** `/en/stories` and `/fi/tarinat` are natural in their own languages; stable
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
| Future URL migration | Adds locale prefixes later |
| Fit with the production inventory | Poor |

**Pros:** multilingual routing, metadata, and content association remain outside the
first launch.

**Cons:** the existing English galleries and pages cannot receive honest same-language
redirects, and adding English later moves every unprefixed Finnish canonical URL.

**Rejected** because a production replacement should not knowingly break useful
published English content or require a second site-wide route migration.

### Option AN: Launch with explicit Finnish and English locale prefixes

| Dimension | Assessment |
| --- | --- |
| Initial implementation | Larger but bounded |
| Existing English routes | Preserve same-language targets |
| Future URL migration | Avoided for these locales |
| Translation completeness | May remain asymmetric |

**Pros:** Finnish and English have stable canonical namespaces from the first launch;
the existing English content can be migrated without requiring every new page to be
translated; language switching uses stable identities.

**Cons:** locale-aware routing, metadata integration, and public version association
become launch requirements even though copy and AI-assisted translation workflows remain
later work.

**Accepted for the first production deployment.**

### Option AO: Redirect old English pages to Finnish equivalents

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
coherent in each language. Explicit `fi` and `en` prefixes add launch work for routing,
metadata, and version association, but preserve existing same-language links and avoid
a later migration of every Finnish canonical URL.

Prefixing the default locale too costs one segment on the most-visited paths and buys the
property that no canonical URL depends on which locale is default. The unprefixed root
then has to mean something, and a permanent redirect to the default locale's home is the
option that stays honest: a language chooser at `/` would add a page nobody asked for, and
browser-language detection would override a deliberate choice the visitor may have made.
Requiring the prefix even in a single-locale clone looks like needless ceremony until the
clone adds a second language, which is precisely when an unprefixed mode would force it
to move every URL it had published.

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
  `/fi/tarinat` and `/en/stories` from its first launch.
- Finnish is the default locale, and the unprefixed root `/` redirects permanently to
  `/fi` rather than serving content or detecting a browser language.
- No canonical URL depends on which locale is default, so changing the default moves one
  redirect target instead of every path.
- `x-default` names the default locale's version and is omitted rather than pointed at
  another language when that version does not exist.
- A single-locale clone still publishes prefixed URLs, so adding a second language later
  moves nothing.
- `/robots.txt`, `/sitemap.xml`, and the favicon stay unprefixed.
- Existing useful English content receives English canonical targets, while a new
  Finnish page may publish without an English version.
- Child categories and canonical content share a collision-checked local slug namespace.
- Gallery and article variants do not appear in canonical URLs.
- Static pages, compatibility routes, and virtual keyword queries remain outside the
  story namespace.
- Content navigation derives from the public tree's top-level categories; site settings
  own only static links.
- Locale prefixes, supported locales, and namespace localization are project-owned route
  configuration, not editable CMS fields.
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
- AB#19 owns exact deployment-specific rows and must explicitly handle meaningful query,
  fragment, and numeric lightbox states.
- The future CMS schema shape remains open; provider documents must map to the
  project-owned variant boundary.
- The current separate mock `Gallery` and `Article` types will eventually need to map to
  or adopt the shared boundary, but this ADR does not authorize that implementation yet.

**To revisit — migration triggers**

- **Cursor durability proves impractical in AB#66** → make unfiltered continuations
  `noindex` and rely on the parameter-free sitemap entry. The rest of the URL contract is
  unaffected, which is the test of whether the indexing rule was separable.
- **A clone needs a sixth category level** → the limit is a validation constant, but
  raising it re-opens navigation, breadcrumb, and URL-depth design rather than just the
  number.
- **A locale is added, removed, or made default** → route configuration plus a
  compatibility and redirect plan; canonical paths stay put by construction.
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
What remains is acceptance, and the work those decisions hand to other stories.

1. [ ] Accept the ADR (`Proposed` → `Accepted`) and update its status in the ADR index.
2. [ ] Update `README.md` and `AGENTS.md` in this PR: locale-prefixed public routing is a
       launch requirement, not a post-MVP roadmap item.
3. [ ] Implement locale-prefixed Finnish and English routing in AB#128, including the
       `/` → `/fi` redirect, per-locale `<html lang>`, locale-aware date formatting, and
       `hreflang` with `x-default`. `src/app/layout.tsx` currently hardcodes `lang="en"`
       and the blog pages format dates with `en-GB`.
4. [ ] Carry the cursor durability requirement into AB#66 so indexed continuation URLs
       survive ordinary gallery editing.
5. [ ] Give AB#105 the section slug rules: lowercase, gallery-unique, `all` reserved,
       immutable after publication behind a warned change action.
6. [ ] Build the category listing route with the continuation contract and ordering rule
       decided here.
7. [ ] Record the deployment-specific legacy mapping in AB#19 against the target classes
       in decision 9, including the old site root.
8. [ ] Migrate `/portfolio` (AB#104) and `/blog` (AB#124) to compatibility redirects into
       the story namespace.
9. [ ] Map the mock `Gallery` and `Article` types onto the shared content-page boundary
       when the content tree is implemented.
10. [ ] Implement the post-launch localized-version authoring workflow in AB#125.
11. [ ] Design Azure Foundry-default, provider-neutral AI editorial assistance in
        AB#126.

## What this ADR did not establish

- **Nothing here was measured.** Like ADR-0002 and unlike ADR-0001, this is a design
  decision recorded before implementation. No prototype, schema, or route was built.
- **The CMS schema shape is not chosen.** One conditional document type and two provider
  types both satisfy the variant boundary.
- **The gallery query itself is AB#66's.** Page size, ordering, and cursor encoding are
  decided there; this ADR only transports the token and states one durability requirement.
- **Section storage and authoring UI are AB#105's.** This ADR decides only the section's
  URL form and slug rules.
- **Rendition and delivery URLs remain out of scope**, as in ADR-0002; AB#108 owns them.
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
