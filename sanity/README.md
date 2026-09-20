# Sanity Studio schemas

The document types this site reads, as plain objects that import nothing.

This directory is **content-store configuration, not application code**. Nothing under
`src/` imports it, and it is never bundled into the site — the same reasoning that keeps
the deployment tooling in `scripts/`. The application reads content through the adapters
in `src/lib`, which know the field names and never the Studio (ADR-0006).

## Why there is no `sanity` package here

A Sanity schema type is a plain JavaScript object. `defineType` and `defineField` are
typed identity helpers: convenient inside a Studio, and a dependency here. Importing them
would pull the `sanity` package into a repository that deliberately runs without a CMS
library, so the types are written as plain objects and checked against the local
declarations in [`schemas/schema-types.ts`](schemas/schema-types.ts) instead.

Those declarations cover only what these schemas use. Widen them when a schema needs
something, not in advance.

## Using them in a Studio

The Studio is the site owner's own project, created and billed in their Sanity account
(see [`docs/sanity-setup.md`](../docs/sanity-setup.md)). It is not part of this
repository. Point its schema configuration at these files:

```ts
// sanity.config.ts, in the owner's Studio project
import { defineSchemaTypes } from "./path/to/photosite-starter/sanity/schemas";

export default defineConfig({
  // …project, dataset, plugins…
  schema: {
    // Whether this dataset is world-readable. It decides which fields exist:
    // a public dataset is offered no place to record where a master lives,
    // because anyone holding the project id can read every published document
    // in it.
    types: defineSchemaTypes({
      datasetVisibility: "private",
      // The generated story root in every configured locale's route space,
      // one entry per SITE_LOCALE_ROUTES locale. This example matches
      // SITE_LOCALE_ROUTES=fi||tarinat,en|en|stories.
      storyRootPaths: ["/tarinat", "/en/stories"],
    }),
  },
});
```

`storyRootPaths` must list every configured locale's story namespace from
`SITE_LOCALE_ROUTES` — the default locale's unprefixed and each other locale's with its
own prefix — in the same order that doesn't matter, but with none missing. The schema
uses the full list to stop an editor from publishing both a generated `story-root` entry
and a static link to any configured locale's copy of that same destination; naming only
one locale's path would leave every other locale's collision undetected until the site
reads the document. The runtime adapter repeats that check against the deployment's
validated route configuration.

`datasetVisibility` must match the site's own `SANITY_DATASET_VISIBILITY`, and both must
match what the dataset actually is in Sanity. It is not a preference: a public dataset is
readable by anyone holding the project id, so the archive-location field does not exist
there at all, and on the site's side declaring `private` makes the read token required —
an unauthenticated read of a private dataset returns an empty result rather than an
error, so without that guard a misconfigured deployment renders as though nothing had
been written. The reference deployment uses separate read-only credentials for its
trusted Azure build and its Vercel runtime; `docs/deployment.md` owns their provisioning.

The schemas validate against the dataset while an editor works — an uploaded image
is measured and its format checked before it can be published, media and category IDs
are checked for being unique and unchanged, and a prospective category publication is
checked against the whole published tree. Those rules use the Studio's own client, so
they need no configuration beyond the above. Studio validation cannot protect API
imports; the site's adapters repeat the public boundary checks for that reason.

The site settings and home page are each published as exactly one document. Their
visitor-facing text uses the same language-keyed `localizedText` values as media and
categories. Navigation stores only static application routes or semantic targets for the
generated story root and the identity-resolved featured gallery; it never stores a second
category tree. The home hero references the shared media document rather than copying an
asset URL or dimensions.

Articles and services are two more document types, each with a different relationship to
language. A category is one document describing every published language; an article is
the opposite — one document *per* language, because ADR-0003 decision 7 lets a page's
languages be authored and published independently. `language` plus the immutable
`contentId` together identify one version, and a standard publish is blocked until
exactly one of `canonicalAtStoryRoot` and `canonicalCategory` is set (ADR-0003 decision 5), while a draft may stay unplaced. A
service carries no language field at all: `src/lib/services.ts#getServices` takes no
locale, matching the still-unlocalized `/services` route, so nothing here describes a
capability the site does not yet read.

Both an article's body and a gallery's optional body share one set of block object types —
`sanity/schemas/content-block.ts` — covering the ten shared body kinds:
paragraph, heading, list, quote, media placement, a click-to-load YouTube embed,
mini-gallery, table, poll, and image comparison. They
are named `content<Kind>Block` rather than the bare discriminant, because Sanity type
names share one namespace and `media.ts` already claims `media` for the shared photograph
document. `defineContentBodyField` builds a body field restricted to a given allow-list of
these kinds — every kind by default; a gallery's body allows every kind too, but unlike an
article's it is optional (ADR-0003 decision 3: a gallery's body is separate editorial
content, not the page itself).

The `contentGalleryBlock` mini-gallery adds an optional title (maximum 120 characters)
and an `images` array of 1–12 objects, each holding its own stable `_key` and a `media`
reference. Repeated photographs are allowed as distinct occurrences. The reader preserves
these identities and rejects unresolved, private, or otherwise undeliverable references;
this block neither owns nor changes a curated gallery placement. See the
[AB#24 amendment](../docs/adr/0003-public-content-tree-and-url-structure.md).

## Galleries

`gallery.ts` is the `gallery` variant of the same shared content-page boundary, and like
`article.ts` — not like `category.ts` — it is one document *per* language: a gallery's
placement overrides (`altOverride`/`captionOverride`) and section labels are plain,
un-keyed text, matching `GalleryContentPage`'s own per-language `title`/`summary`/`body`.
`contentId` plus `language` together identify one version, an explicit story-root or
category placement is required to publish, and `language`/`slug`/canonical placement freeze once published — all shared
with `article.ts` through `content-placement-validation.ts`, which both documents' Studio
guards call so a `contentId` cannot be claimed by both an article and a gallery, and a
local slug namespace collision is caught regardless of which of the two types causes it.

A gallery's named sections (AB#105) stay a gallery-local object array on the document —
`sections` — bounded to `MAX_GALLERY_SECTIONS` (20) and never the pagination bottleneck a
placement list is. A gallery's own curated items are a separate document type,
`gallery-placement.ts` (`galleryPlacement`), each referencing its `gallery` — **not** an
embedded array, unlike `sections`. AB#113 originally embedded placements the same way as
sections; AB#114 found that incompatible with its own "bounded, without loading the
complete gallery" requirement, verified against Sanity's own documentation: the Content
Lake filters and projects whole documents, with no way to keyset-paginate a slice of one
document's array field, and a document is capped at 1,000 attributes (Free/Growth plan) —
a ceiling a few hundred placements already approaches. Splitting placements into their own
documents is what lets `src/lib/sanity-gallery.ts` answer one page of a gallery with an id
lookup plus a keyset range query, the same shape `content-listing.ts` already uses for
articles under one category, instead of loading every placement to answer any one page.

Every `placementId` is public and site-wide unique with an immutable media/gallery binding
(ADR-0002 §1); `gallery-placement.ts`'s own Studio validation enforces that in one round
trip per document, including the rule this repository adds for what ADR-0002's MVP text
left open: the same occurrence in two language versions of one gallery shares one
`placementId`, and only when it keeps naming the same photograph and section. Repeating a
photograph within one gallery is allowed but flagged with `rule.custom(check).warning()` —
Sanity's non-blocking severity — rather than refused (ADR-0002 §2). The required media
reference stays a separate blocking rule in the validation array. The gallery cover's
duplicate-opening hint uses the same custom-warning registration; it approximates the
first visible placement in manual order, without reproducing shuffled ordering or public
media eligibility. Local rule types and test builders enforce this API distinction (AB#156).
A placement's own `visible` flag
is purely subtractive; whether the referenced photograph is itself publicly renderable is a
separate question the read-side adapter answers by excluding such a placement entirely,
never by rejecting the whole gallery (ADR-0002 §3's AND-composition) — and, since AB#114's
bounded query filters on `media->publiclyRenderable` directly, a returned row is always
already excludable-or-not decided before it ever reaches that adapter code. `order` is an
authored field on each placement document, not array position — splitting placements into
documents left nothing for a position to be, a real authoring-experience cost (no more
drag-to-reorder) accepted for the bounded-query property. A section's optional `intro`
reuses the shared paragraph/list rich-text model in `gallery-section-intro.ts` — its own
dedicated object types, not the seven-kind `content-block.ts` set, since an intro needs
inline emphasis and links that the shared body blocks' plain-string paragraphs and lists do
not carry. `orderingRule`/`orderingSeed` let a gallery declare a seeded-random ordering
(AB#129, [ADR-0009](../docs/adr/0009-seeded-random-gallery-ordering.md)); each
`galleryPlacement` also carries the materialized sort key — `shuffledOrder` (a read-only,
generated 64-character hex value) and a `shuffledOrderSeed` marker, both empty on a pinned
lead and on a manually-ordered gallery. A routine Publish of a `seeded-random` gallery,
and of a new or re-pinned placement in one, is always allowed — the placement-level
publication validator blocks only the one *structurally impossible* value: a
`shuffledOrder` that is present but not a 64-char hex string. An absent, now-stale, or
leftover-after-a-rule-switch key all publish fine, because those are transient states
`npm run recompute:shuffled-order` (which reads only published placements) exists to
resolve — blocking them would deadlock the author. That owner-run step materializes the
keys after a seed change.
Between a seed edit and that recompute the public site serves the gallery as temporarily
unavailable rather than mis-paginated (ADR-0009's 2026-08-28
amendment).

The bounded, windowed read of a gallery's placements is `src/lib/sanity-gallery.ts`'s
`readSanityCuratedGalleryPage` (AB#114), composing `gallery-sections.ts`'s shared
`CuratedGallerySectionSource` contract over `galleryPlacement` documents. For a
`seeded-random` gallery it serves the tiered order (pinned leads by `order`, then the rest
by `shuffledOrder`) as two keyset lanes in one round trip and includes a bounded
consistency aggregate that raises `ordering-stale` while a recompute is outstanding
(AB#129 PR2). The cover
fallback to the first visible placement when none is explicitly authored remains
unimplemented at the route-facing seam, matching every other Sanity adapter built so far
(settings, home, article, service, and this one) — the adapter exists and is tested, but
`src/lib/gallery.ts`'s route-facing `getGalleryPage` still reads only the mock layer, to
avoid a mixed mock/Sanity deployment before every adapter is ready.

Copying the files works too — they have no imports to satisfy — but a copy drifts. Prefer
a path, a submodule, or a workspace dependency, so a schema change arriving from upstream
reaches the Studio the same way a code change reaches the site.

## The rule these schemas follow

One photograph is one document, described once, referenced from everywhere it appears.
Where it sits — the order in a gallery, the section it belongs to, a caption written for
one particular page — belongs to the container that places it, never to the photograph.
[ADR-0002](../docs/adr/0002-media-identity-and-placement-boundary.md) explains why, and
[ADR-0008](../docs/adr/0008-localized-authored-text.md) explains why authored sentences
are language-keyed arrays rather than fields named after this deployment's languages.

## Gallery presentation (AB#157)

`siteSettings` and each per-language `gallery` document expose optional
`galleryLayout` (`grid`, `masonry`, `justified`) and `galleryCaptionPlacement`
(`below`, `overlay`). Both are independently clearable dropdowns. No initial value
creates a gallery override: empty means inherit that field from site settings;
empty site settings mean `grid` and `below`. Existing documents need no migration.
Unknown stored enum values are rejected as malformed content by their adapter,
not converted to CSS or silently replaced. Both content sources use
`effectiveGalleryPresentation` after projection. Presentation never enters a
placement, cursor, section filter, or lightbox ordering rule.

See [gallery presentation](../docs/gallery-presentation.md) for public behaviour.

## Article polls (AB#162)

`poll` is an authored document with a language, question, 2–10 stable option IDs
and labels, and an authored closing instant. `contentPollBlock` references it
inside the shared body model. Poll/option IDs are bounded at 64 characters and
question/label at 500. `pollTally` and `pollVoteReceipt` have no Studio schemas:
publishing an edit to `poll` writes a different document from its live tally.
They are still accessible to dataset API readers. Runtime writes use a distinct
credential; see [ADR-0018](../docs/adr/0018-article-poll-voting-storage-and-dedup.md)
and [Sanity setup](../docs/sanity-setup.md).

## Image comparisons (AB#23)

`contentImageComparisonBlock` is available in both article and gallery bodies.
Author `first` and `second` media references, `firstLabel` and `secondLabel`
(required nonblank strings, maximum 200 characters), and optionally `title`
(nonblank when set, maximum 120 characters). Labels name the comparison sides;
they do not replace the media documents' descriptive alt text. Use public image
media with matching native aspect ratios, normally equal-size pairs. The reader
validates both images through the existing public-media boundary and refuses
unresolved or nonpublic references. The reveal becomes interactive after both
images load; different ratios remain full images without an overlay. Captions
and credits survive in both views. Neither image enters another lightbox's slides.
See [ADR-0019](../docs/adr/0019-before-after-image-comparison.md).

## Category descriptions

Each locale may provide up to eight paragraph or list blocks in a category
introduction, with inline emphasis and safe links. The Studio schema and public
reader enforce the same limit. This accommodates longer existing introductions
without truncating their text; the category label supplies the page's only H1.
Headings, quotation blocks and arbitrary HTML are not part of this restricted model.

## Links in article and gallery text

A body paragraph offers **Text** for plain text or **Linked text** for text runs
with optional links. Fill one of these fields. A list likewise uses **Items** or
**Linked list items**, with one span array per item. Include the spaces around a
link in the text runs. Existing plain-text documents continue to work unchanged.

Linked text supports HTTP(S) URLs without credentials, paths beginning with `/`,
and heading/gallery fragments beginning with `#`. It does not support HTML,
new-tab behavior, or executable URLs. The bounds are 100 runs and 10,000 characters
per paragraph/item, 100 rich list items and 2,048 characters per URL. The public
reader and migration writer enforce these rules as well as Studio. Paragraph and
list links work without JavaScript. Category descriptions retain their separate,
restricted introduction model.
