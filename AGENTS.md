# AGENTS.md — PhotoSite Starter

Canonical agent instructions for this repository. `CLAUDE.md` imports this file —
edit here, not there.

## Project overview

A clonable photography website template (Next.js App Router, TypeScript, Tailwind CSS v4).
The first production implementation replaces an existing Joomla 3 photographer site, but the
codebase must stay generic so another photographer can clone and rebrand it.
**A real production project, not a demo. Not a SaaS, not multi-tenant.**

Secondary goal: a credible portfolio project demonstrating professional Git, CI/CD,
documentation, and project management practices (Azure DevOps, AZ-400 learning).

## Hard rules

- **Keep it generic.** Never hardcode a photographer's name, location, contact details,
  brand colors, or service categories into components, schemas, or data models. These
  belong in site settings (`SiteSettings`) or CMS content. This covers **assets**, not
  just code: a clone inherits every file in `public/`, so demo images must carry no
  watermark, signature, studio name, or URL burned into the pixels.
- **MVP first.** Do not build roadmap features (client galleries, proof selection,
  multilingual authoring and AI translation, EXIF toggles, analytics) before they are
  explicitly prioritized. **Locale-aware public routing is prioritized:** ADR-0003 makes
  unprefixed default-locale Finnish routes and `/en/…` English routes a first-launch
  requirement. The authoring workflow around them is not.
- **Minimal dependencies.** Do not add a library without a clear, stated need.
- **Small, reviewable changes.** No large rewrites without an explicit request.
- **Never crop images.** Gallery, preview (thumbnails included), and hero/banner images
  must always show their original aspect ratio and full frame — no `object-cover`, no
  fixed-aspect crop cells, no `<Image fill>` cover. Use layouts that respect each image's
  native ratio (masonry, or `object-contain`). A cropped preview misrepresents the work
  and can make a strong image go unseen.
- **Hero convention.** Heroes display at the image's *native* ratio — whatever it is
  (16:9, 3:2, 4:5, …) — via `h-auto w-full` plus the asset's real `width`/`height`; the
  code imposes no aspect ratio and never crops. The "full-width banner" look comes from
  the *photographer supplying a wide-format image*, not from a fixed-height crop band.
  Always pass the asset's true pixel dimensions so the ratio (and CLS reservation) is
  correct.
- **Public derivatives only.** Browser-facing media may contain only a versioned public
  web-delivery derivative and that derivative's true intrinsic dimensions. Camera
  masters, archive locators, provider internals, and private or sales assets stay behind
  a server-only adapter and never enter the optimizer or browser payload. Use bounded,
  context-specific responsive `sizes`; transforms may downscale but never crop or
  upscale. URL parameters are optimization controls, not access protection.
- **Privacy by default.** No tracking cookies, no Google Analytics, no auto-loading
  third-party embeds. Goal: no cookie banner.
- **Accessibility:** target WCAG 2.1 AA. Keyboard navigation matters, especially in galleries.

## Development priorities

When making decisions, prioritize in this order:

1. Working functionality (MVP first)
2. Simplicity over completeness
3. Image quality and gallery experience
4. Small, incremental, reviewable progress

Avoid: building full systems at once, overengineering, polishing UI before functionality exists.

## Information accuracy & anti-hallucination rules (CRITICAL)

- NEVER invent technical facts, library capabilities, API signatures, or framework behavior.
- NEVER assume missing information. NEVER present guesses as facts.
- If information is missing, STOP and say so clearly: *"I don't have enough information
  to answer this correctly."* Then ask for the missing code, file, requirement, or docs.
- When library/framework behavior may be version-sensitive (Next.js, Tailwind v4, Sanity),
  verify against current documentation instead of answering from memory. Use a
  documentation lookup tool if available (e.g., Context7 MCP); otherwise consult the
  official docs. Do not use external lookup for things verifiable from this codebase.
- In answers, separate clearly: **facts** (verified), **assumptions** (explicitly labeled),
  **recommendations**.
- When uncertain: ask questions, request context, pause implementation. Do not continue
  with a guessed solution.

### Azure Boards work item gate

- Before implementing or reviewing work identified by an Azure Boards ID, read the
  authoritative work item, including its description, acceptance criteria, discussion,
  and relevant relations. Repository prose and the current diff are supporting context,
  not substitutes for the work item.
- Use the configured Azure DevOps integration when available. With Azure CLI, set the
  project default once and then read the item by its organization-wide ID:

  ```bash
  az devops configure --defaults organization=https://dev.azure.com/ilkkarytkonen project=photosite-starter
  az boards work-item show --id <id>
  ```

  `az boards work-item show` does not accept `--project`; the configured default supplies
  project context for commands that need it.
- If the work item cannot be read because authentication, tooling, permissions, or
  connectivity is missing, **stop before implementation or review**. State the blocker
  and get the Azure Boards connection working, or ask the user to provide the complete
  current work item. Do not infer scope or acceptance criteria and do not give an
  approval/rejection verdict without them.

### Azure Boards work item state

The board is the project's status, so an agent that implements a story also moves it.
Leaving the state behind makes the board lie about what is in flight and what shipped,
and nobody notices until a standup contradicts the repository.

- **Move the item to `Active` before the first file change**, in the same read-only step
  that reads the work item and checks out the branch. Not after the implementation is
  written, and not "once it's clearly going to work" — the state exists to say the work
  is in flight, which is true from the first edit.
- **Move it to `Closed` when the work is merged**, together with the closing commit or
  the merged pull request. If the PR body carries `Fixes AB#<id>`, confirm the item
  actually reached `Closed` after the merge rather than assuming the link did it; close
  it explicitly when it did not.
- **Never close an item the user has not accepted.** Handing back a finished branch is
  not a merge. Report the state the item is in and what still has to happen for it to
  close.
- Report every transition in the message that accompanies the work, so the state change
  is reviewable rather than silent.

```bash
az boards work-item update --id <id> --state Active   # before the first edit
az boards work-item update --id <id> --state Closed   # after the merge
```

Agile process states for a User Story are `New` → `Active` → `Resolved` → `Closed`.
`Resolved` is optional here; a story that is merged goes straight to `Closed`.
If a state transition fails, say so — a silent failure leaves the same stale board as
never having tried.

## Feature status awareness

Current state: **MVP in progress.** Built: site settings mock layer, typed deployment
configuration, responsive header and footer, home page, services listing and detail
pages, the shared generic media model, the public
image rendition boundary, the shared bounded gallery
result contract, the fullscreen lightbox behind a project-owned PhotoSwipe wrapper
(open, close, navigate, trapped focus, focus return keyed by `itemId`, and the caption
and credit of the active item, associated with it for assistive technology),
the public content category domain model with its canonical placement
contract, settings-driven page metadata with canonical URLs and Open Graph values, and
the locale route contract — configured locale route spaces, root prefix reservation,
locale-space namespace reservation, redundant default-prefix normalization,
route-specific document and Open Graph locale selection, and tested helpers for
identity-based language switching and alternate metadata. The public category branch
routes are in place on top of that: the story-namespace root and every public category
path in each configured locale space, with breadcrumbs following canonical ancestry, a
deterministically ordered listing of child categories and content (secondary listings
included, each linking to the one canonical detail route) read through a bounded query
that pushes the order and row limit to the adapter, a bounded recent-content overview on
the story root, uncropped cover media with a defined
missing-cover state, single-hop permanent redirects for casing variants and for the
recorded previous paths a move or rename retired, `hreflang`/`x-default` alternates, and
a visible identity-based language switch. Page metadata omits the site description in
any locale it was not authored in rather than publishing it under a translated title.
Application-owned UI labels are per-locale (English and Finnish sets ship).
The site menu is driven by that tree: `buildSiteNavigation` composes the configured
static links with the public categories, dropping any configured link into the story
namespace so no two entries own one route space, and it carries the first two category
levels — deeper branches are reached from the landing page above them. Both layouts
render it as a disclosure, not a menu widget: every entry is a link, one submenu is open
at a time, a pointer or focus landing outside closes it, and the compact panel keeps its
own scroll boundary rather than covering or locking the page. Escape is heard on the
document, not on the menu, because WebKit leaves focus on `document.body` after a pointer
activates a button; the submenu takes it in the capture phase and the compact panel in
the bubble phase, so the menu unwinds one level per key and returns focus to the control
that owned each.
Articles have moved into that tree: the shared project-owned content-page boundary
(`src/lib/content-page.ts`) carries the variant, the six ADR-0003 body blocks, the cover,
the publication date, and tags, and the `article` variant renders at its one canonical
detail route in every configured locale space, with breadcrumbs following canonical
ancestry, the ADR-required table of contents derived from the body's level-2 headings,
sibling navigation read through a bounded two-row neighbour query over the global article
publication order, self-referencing canonical metadata, `hreflang`/`x-default` alternates, an
Open Graph article, and the identity-based language switch.
Curated galleries render there too: the `gallery` variant has its canonical detail route
in every locale space, reading its result through `src/lib/gallery.ts` — route components
import that contract and no mock or provider type. A gallery larger than one page now continues rather than being refused: it issues an
opaque cursor signed with the deployment's own `GALLERY_CURSOR_SIGNING_KEY` — a
server-only runtime secret resolved lazily, so a deployment whose galleries all fit inside
one page never reads it — and serves the next bounded slice at its own indexable,
self-canonical `?cursor=` URL, which names no `hreflang` alternates because no other
locale holds an equivalent slice. The control that reaches it is a real link, so a large
gallery pages through with no JavaScript at all (ADR-0003 decision 8), and script
progressively enhances that same link into an in-place append: the next slice arrives in
the page a visitor is already on, read from a bounded `GET /api/gallery` route handler
addressed by canonical path and opaque token. One projection (`gallery-slice-server.ts`)
serves both the server render and that endpoint, so an appended item carries the same
identities, captions, and delivery sources as one that was there from the start, and
`appendGallerySlice` de-duplicates by result identity without reordering what is already
loaded. Nothing loads on its own — no scroll observer, no prefetch — so a four-hundred-item
gallery is never implicitly retrieved whole. The control announces loading, failure, and
completion, keeps focus on itself across an append, and retries in place; the open lightbox
asks for one more slice when a visitor reaches the last loaded item, and a failed
continuation neither closes it nor loses the photograph on screen. The address bar is
deliberately left alone, because every slice already has its own honest address through the
unenhanced link. The continuation
page is deliberately thinner than the first, per decision 3: a compact `h1` naming the
gallery and the continuation, the identity-based language switch (which deliberately
drops the cursor and opens the other locale's first page), then the grid — no lead, date,
or tags, so editorial content is not republished under several URLs. It also carries the
way back a cursor cannot, because tokens point forward only and the URL is indexable. A token that is
malformed, tampered with, scoped to another gallery, or stale is a 404 rather than a quiet
return to the first page, and so is a repeated `?cursor=` — and a token arriving at a
non-canonical spelling (casing, redundant prefix, retired path, or trailing slash) is
validated before normalization: a good token redirects once to the canonical address and
keeps its exact value, while an invalid one 404s without creating a redirect. The cursor is scoped to
the gallery *and the full route locale*, so a slice cannot cross between `en-GB` and
`en-US`. The key enters at the
`gallery.ts` seam rather than in the fixture, ESLint keeps `src/app` and `src/components`
away from it, and rotating it retires every continuation URL already issued and indexed.
The 404 for an invalid cursor carries the link back to that gallery decision 8 requires,
following at most one canonical normalization and verifying that both the content page and
the parameter-free gallery result are served, so an unknown or broken address gets no
invented one. It reaches the boundary through `src/proxy.ts` (ADR-0007), which copies the
bounded requested pathname and cursor presence — never its value — into project-owned
request headers and overwrites any client-supplied values. The Proxy also owns
trailing-slash normalization so the adapter can validate a cursor before a 308. App Router
renders a not-found boundary with no params, and renders it before the page, so nothing
in-tree can tell it. One site-wide limitation bounds that link and predates this work: on
Next.js 16.2.11 the tested 404 responses carry their semantic UI only in the RSC payload,
so no heading or link renders without JavaScript. ADR-0007 records the experiments already
performed without claiming a framework root cause; AB#132 owns the minimal reproduction and
version comparison.
One authoritative manual order governs the source, the DOM, keyboard focus, and the
lightbox sequence, and the grid is row-major (one, two, three columns, top-aligned, native
ratios, never cropped) precisely so the visual reading order cannot contradict it; the
column-major CSS masonry it replaced did. A gallery's listing card takes its explicit
cover or the deterministic first public item (`selectCuratedGalleryCover`), a published
gallery with no items renders an accessible empty state (the mock publishes one, so it is
a state the site serves rather than one only a test has seen). Category listings still answer `?cursor=` with a 404, because none issues one;
`?section=` stays an ignored unrecognized parameter until AB#105, and AB#129 owns the
seeded random order. The continuation link is progressively enhanced in the browser to
append one bounded slice in place, with loading, failure, retry, and completion states;
the open lightbox grows from the same result and offers its own reachable retry without
closing or losing the current item. Focus stays on the continuation control while it
exists and moves to the completion notice when the final slice removes it. No slice is
loaded until the visitor activates the control or reaches the last loaded lightbox item.
A ~400-placement fixture gallery exercises the boundary. The pre-tree `/portfolio` route was removed rather than
redirected, per ADR-0003's 2026-08-10 amendment. Site settings name the featured
gallery once, as `featuredGalleryId`; header, footer, and home entries only mark where it
belongs and what to call it, so no two surfaces can feature different galleries. Each
resolves that identity to the locale's canonical route through the tree
(`getPublicContentRoute`, which also checks the variant), so no deployment-specific
content path is written down, and an unpublished target — or one naming an article — drops
the entry instead of putting a working link behind a label describing something else. The pre-launch `/blog` and
`/blog/<slug>` scaffold routes were removed rather than redirected — they were never
deployed or indexed, and only AB#19's verified production inventory earns redirects.
The privacy-respecting contact form is in place: an accessible `/contact` page in the
unprefixed default-locale route space, a fixed `POST /api/contact` handler accepting
only same-origin JSON within a bounded body and a closed field whitelist, shared
normalization and validation rules the form and the endpoint both run, honeypot and
per-instance throttling, a replaceable `ContactDeliveryAdapter` boundary with a Resend
HTTP adapter and a sink adapter that a production deployment refuses to build, and
operational events limited to a random correlation identifier, a state, and a redacted
error class. No form content is stored anywhere; the processing record is
`docs/contact-data-flow.md`. Deployments declare themselves through
`SITE_DEPLOYMENT_STAGE`, which defaults to production so a safeguard fails closed.
The customer-owned Sanity connection is bootstrapped: a declared content source
(`SITE_CONTENT_SOURCE`) that `loadDeploymentConfig` validates, so an unset value or
`mock` in a production deployment fails the build rather than a later read; connection
settings validated against Sanity's own project-id and dataset rules, carrying an
optional server-only read token; and a project-owned query client over the Content Lake
HTTP API that always asks for the published perspective, bounds and classifies its
failures, never falls back to another source, and adds no CMS library. Sanity's HTTP
surface lives in `src/lib/sanity-config.ts` and `src/lib/sanity-client.ts`; ESLint stops
`src/app` and `src/components` from importing either, and the `server-only` marker
catches the indirect case ESLint cannot see (ADR-0006, `docs/sanity-setup.md`).
The first schema and adapter sit on top of that connection: the shared media document
(`sanity/schemas/`, plain objects a customer Studio consumes, no `sanity` package) and
the server-only adapter (`src/lib/sanity-media.ts`) that projects it into the same
`ImageMedia` the fixtures produce. One photograph is one document — placement fields stay
on whatever places it (ADR-0002) — and the adapter reads an allow-list rather than a
document, so the archive locator, the provider ids, and the capture date used for
ordering cannot reach a payload. The rendition's delivery URL is validated against the asset's own stored
`path` rather than reconstructed: Sanity's documented upload response has an `assetId`
that is only part of the path's filename, so nothing infers an identifier from a name.
Only the trailing `-<width>x<height>.<format>` is parsed, and the version is the opaque
name to its left, which Sanity derives partly from the file's content.
The export policy is enforced twice, because a read-time refusal is late: the schema
measures an upload against `MAX_PUBLIC_DELIVERY_DIMENSION` (2048px, the same number as
the optimizer's widest candidate, pinned by a test) and its format, and blocks the
publish; the adapter checks again, because the Studio binds an editor and not the HTTP
API. Neither un-uploads a file — an asset is public on the CDN before anyone presses
publish — so `docs/sanity-setup.md` carries a deletion procedure. Dataset visibility is
declared twice and must agree: in the Studio schema, where a world-readable dataset is
offered no archive-location field at all, because a field the adapter never projects is
still published by a public dataset; and as `SANITY_DATASET_VISIBILITY`, where declaring
`private` makes the read token required — an unauthenticated read of a private dataset
answers 200 with an empty result, so without that guard a misconfigured site renders as
though nothing had been authored and the connectivity probe agrees with it. The image
field also stops Sanity storing the uploaded filename, which its own documentation warns
may carry sensitive information. `mediaId` is checked in the Studio
for uniqueness across the dataset — with an explicit `raw` perspective, because a
client's default would not see another document's unpublished draft, and comparing on
published identity so a document does not collide with its own draft or release version —
and for not having changed since the last publish, and again at the boundary — its syntax, one document per identity by id, and no repeated
identity within a page. A malformed answer from the store is a classified failure, never
an empty result. Authored text is language-keyed (ADR-0008): alternative text falls back
to the site's own language, a caption is dropped rather than shown in the wrong one. A
video raises rather than half-publishing; the model stays image/video capable but the
public video projection is deliberately a later story with its own delivery ADR (recorded
on AB#82). `next.config.ts` allows the optimizer exactly this deployment's own asset path
prefix, with the project id and dataset validated before they are interpolated into it,
and nothing at all when the content source is the fixtures.
The category schema and adapter sit beside it: the public content tree's node
(`sanity/schemas/category.ts`) and the server-only adapter (`src/lib/sanity-content-tree.ts`)
that projects it into `content-tree.ts`'s own `ContentCategoryInput`. One document is one
category in every published language — `label` and `slug` are language-keyed arrays, the
same shape ADR-0008 gives media's `alt` and `caption`, because a category has no
per-language publication lifecycle to preserve the way a gallery or article will; a
category missing an entry in the requested language is simply absent from that language's
tree rather than a defect. `categoryId` is checked in the Studio the same way `mediaId`
is — syntax, dataset-wide uniqueness with the same `raw`-perspective query, and
immutability after first publish. Its document-level validation reads the published tree,
overlays the document being edited, and blocks self-parenting, indirect cycles, orphaned
parents, sibling-slug collisions, and excess depth before the standard Publish action.
`content-tree.ts` remains ADR-0003 decision 4's authoritative backstop because API writes
bypass Studio validation: the adapter resolves a `parent` reference against every category
id it fetched rather than trusting a GROQ dereference, so an unresolved reference is
reported as a missing parent instead of silently becoming a top-level category. Published
parents and existing localized slugs are immutable in the ordinary form; a customer
Studio's warned URL-change workflow must feed before/after snapshots through
`diffPublicCategorySnapshots`, show the affected categories and content, and persist the
accepted path history before publishing. Canonical and secondary category placement stays off this
schema entirely — ADR-0003 decision 5 makes it a property of the gallery or article being
placed, not of the category receiving it — so `readPublicContentTree` accepts placements as
plain input from whatever adapter reads that content once AB#113 and AB#81 exist, and
composes them with the fetched categories through the same `buildContentTree` call the mock
layer already uses.
The global settings and home-page schemas and adapters sit beside those boundaries too.
Each is a published singleton: none is a fallback to fixtures, and a missing or duplicate
published document raises as a classified content defect. Authored prose is language-keyed;
brand identities stay language-neutral. Static navigation stores only validated root-relative
application paths, while the story root and featured gallery are semantic targets resolved
from deployment routing and the one `featuredGalleryId`, so settings contain neither a second
category tree nor a generated content path. The Studio schema receives every configured
locale's generated story-root path as configuration and refuses a static link duplicating
any of them; the runtime adapter repeats the check against validated route configuration.
The home hero dereferences the shared media
document through `PUBLIC_MEDIA_PROJECTION` and `projectPublicMedia`, retaining its public
derivative and true dimensions. These adapters return the existing `SiteSettings` and
`HomeContent` contracts but are not wired into route-facing seams until the other authored
content adapters exist, avoiding a mixed mock/Sanity deployment.
The shared rich-content body-block schema and the article and service schemas and
adapters sit beside those boundaries too. `sanity/schemas/content-block.ts` gives both
public content variants the six ADR-0003 decision 2 body blocks — paragraph, heading,
list, quote, media placement, and click-to-load YouTube — as Sanity object types named
`content<Kind>Block` rather than the bare discriminant, because `media.ts` already claims
`media` in the one namespace Sanity type names share; `defineContentBodyField` builds a
body field restricted to a caller-chosen allow-list of these kinds, every kind by default,
so a narrower context such as a future gallery section introduction reuses the same six
types instead of a second body schema. `src/lib/sanity-content-blocks.ts` is the read
half, projecting a query result back onto `content-page.ts`'s `ContentBlock` union; a
media block reuses `projectPublicMedia` unchanged, so a photograph placed in a body is
validated by exactly the boundary ADR-0005 established for every other public rendition.
The article schema (`sanity/schemas/article.ts`) is the `article` variant of the shared
content-page boundary, and — unlike a category's one document for every language — is one
document *per* language: ADR-0003 decision 7 lets a page's languages be authored and
published independently, so `language` plus the immutable `contentId` together identify
one version, and two documents may share a `contentId` (one per published language) but
never both `contentId` and `language`. `canonicalCategory` is required, so a standard
Studio publish cannot leave an article unplaced — Sanity's own validation model blocks
publishing, not saving a draft, which is exactly ADR-0003 decision 5's allowance for
unplaced draft content. Field-level requirement is not the whole guard, though:
`sanity/schemas/article-validation.ts` fetches every category and every other published
article in this language, overlays the document being edited, and restates
`content-tree.ts`'s own public-category propagation and local-slug-namespace computation —
not just a check against other articles in the same category, which would still miss a
sibling *category*'s slug, or a collision only exposed because this very publish turns a
previously private canonical- or secondary-placement ancestor category public for the
first time. So a routine "Publish"
click cannot be the moment a colliding local slug (ADR-0003 decision 6) or a canonical
category with no published version in the article's own language reaches the public tree —
both states are otherwise only caught when a route reads the whole tree, which rejects it
outright. Gallery placements are not fetched yet, since no gallery schema exists before
AB#113; that story extends the same query. The same validator freezes `language`, `slug`,
and `canonicalCategory` once a document has
been published at all, the same way `category-validation.ts` freezes a category's `parent`
and path segments, so an ordinary edit cannot silently discard a live canonical URL or —
since `language` plus `contentId` together are the whole identity — turn one language's
published page into a different language's version by editing the field, rather than
starting the new language as its own linked document the way AB#125's workflow requires.
`content-tree.ts` remains the authoritative backstop for a document an API import wrote
without going through any of this Studio validation. Tags stay a separate free-text
field, unrelated to categories and consuming no tree depth. `src/lib/sanity-article.ts`
reads three separate projections rather than one, matching `content-listing.ts`'s rule
that a listing card must never load an article body: `readPublicArticlePlacements` feeds
`content-tree.ts`'s placement contract, resolving `canonicalCategory`/`secondaryCategories`
references the same way `sanity-content-tree.ts` resolves a category's own `parent` —
raw, then looked up locally through the newly exported `readCategoryDocumentIndex`, so an
unresolved reference reports as a missing category rather than collapsing into "unplaced";
`readPublicArticleListingRecords` answers a bounded `ContentListingQuery`; and
`readPublicArticlePage` reads one full page by locale and stable identity, returning
`undefined` for a language with no published version — the normal bilingual state, not an
error — throwing a classified `SanityArticleError` when two published documents collide on
one identity, and, because the schema's own `min(1)` body requirement binds only the
ordinary Studio editor and not an API import, refusing to project an article whose body
came back missing or empty rather than silently publishing a page with nothing in it. Each
body block also carries Sanity's own stable per-item `_key` through to
`content-page.ts`'s `ContentBlock` as an optional `key`, which `ContentBody` prefers over
array position for its React key — the mock fixture layer has no such concept and simply
omits it, falling back to position, which is safe there because fixture content is never
live-reordered the way Studio content is. The service schema (`sanity/schemas/service.ts`)
and adapter (`src/lib/sanity-services.ts`) model `src/lib/services.ts`'s existing `Service`
contract directly: no language field, matching the still-unlocalized `/services` route, and
no category placement, tags, or redirect history, because a service is not part of the
ADR-0003 public content tree. Its `slug` is checked for syntax and uniqueness the same
asynchronous way `media.ts` and `category.ts` check theirs at publish time, without the
immutability half those two also enforce, because a service has no redirect-history concept
requiring it; `readPublicServices` repeats the uniqueness check across a whole listing read
too, since Studio's rule does not bind an API import and a silently duplicated slug would
otherwise hand a visitor two cards for one URL while `readPublicServiceBySlug` throws for
the same state. None of these three adapters is wired into a route-facing seam yet, for the
same reason the settings and home-page adapters are not.
The public-journey harness is
in place too — a production-build Playwright suite with an external-request guard, gated
in Azure Pipelines — carrying the home/navigation smoke test,
the content-tree journey (branches, the canonical detail route, redirects, and
404s), the curated gallery journey (each chrome surface's identity-resolved link
checked separately, the grid's reading order against DOM and lightbox order at one, two,
and three columns, the lightbox, canonical and `hreflang`/`x-default` metadata, the empty
gallery's accessible state, and the 404s for a cursor, an unknown slug, and the removed
`/portfolio` route), the gallery continuation journey (run with JavaScript disabled: four
pages walked through the real link with no duplicates or gaps, the continuation page's
compact heading and absent lead, its self-canonical metadata and absent alternates, its
link back to the first page, and the 404s for an unminted token, a token
issued by another gallery, and a repeated parameter), the gallery append journey (the
in-place append with its order and de-duplication, focus staying on the control until
completion moves it to the notice, a failed
continuation that keeps what is loaded and retries, the lightbox reading the grown list,
continuing past the last loaded item from inside the open viewer, and a failure that
neither closes it nor loses the item), the services journey (the listing, one service detail with its cover, price list,
and breadcrumb, the navigation between them and into the story section, and an unknown
slug's 404), the site-menu journey (its composition, the disclosure opened by pointer and
by keyboard and dismissed either way with focus return, the level-at-a-time Escape
unwind, ancestry marking, a branch below the menu reached from its landing page, and the
compact panel's viewport behavior), and the contact journey (a labelled form,
required-field and invalid-address reporting against the field that caused it, a
successful submission, a delivery failure that may pass later — announced,
referenced, and retried — and one a retry cannot fix, pointing at the direct
address). Those failure states are the endpoint's own answers rather than a
stubbed response: the sink adapter reports a chosen failure class for a reply-to
address on the reserved `delivery-failure.test` domain, which RFC 6761 makes
unreachable for a real enquiry and which a production deployment never builds.
Each test also arrives from its own synthetic address, so the endpoint's
per-client throttle bounds a client rather than the whole browser matrix.
Route-specific journey suites are separate stories that join the gate as their
features land.
The repository half of the customer-owned Preview environment is in place on top of it:
the function region and the Node major are pinned in `vercel.json` and `package.json`
rather than inherited from the platform, and a test fails the gate if the pipeline's pin
and the deployment's drift apart; the pipeline runs a second stage that deploys a
release candidate to Vercel only after every gate passes, only from `main`, never from a
pull request, and only once the pipeline-authorized Preview variable group's explicit
enable flag is true — so provisioning can remain incomplete without reddening the branch.
It builds and deploys the prebuilt output, binds the generated URL and immutable
deployment ID to the expected Vercel project and team through the authenticated API,
then asserts both access protection and an unscoped `noindex` before it publishes the
URL, because none of those properties implies the others. Failed or cancelled
verification deletes only that verified deployment ID.
The provisioning runbook, the Preview/Production environment split, and the recorded
promotion and rollback commands are `docs/deployment.md`.
Not yet built:
localized static routes and localized authored settings — the contact route is
unprefixed-only for now — category listing continuation, which stays bounded to its first page and
answers any `?cursor=` with a 404 — gallery sections
(AB#105), the gallery lead and long-form body (AB#106), seeded random gallery ordering
(AB#129), lightbox zoom tuning, the gallery-item
enquiry (AB#60),
sitemap/robots, structured data, the remaining Sanity content schemas and adapters that
would put authored content behind the connection (AB#113, AB#114) —
the media, category, settings, home, article, and service schemas/adapters exist, but no
route-facing seam reads them yet, so every page still renders from the mock layer — tagged
caching and webhook revalidation (AB#83),
and the deployment itself: provisioning is under way — a Vercel project exists, but
protection, Preview environment values, and deployment credentials are not finished;
the disabled variable group currently carries only the non-secret project/team IDs, and
no domain exists — so the deploy stage has never run and no release candidate has ever
been produced or verified. Production promotion (AB#18), exercised rollback and handoff
(AB#118), and legacy URL redirects (AB#19) are later stories.

The repository's architecture is also drawn, not only described: `docs/architecture/`
holds the system context, the application and data boundaries, and the build/deployment
flow as authoritative D2 source with committed SVG renditions, rendered by an
exactly-pinned engine and gated by `npm run diagrams:check` so a stale picture fails CI
rather than misleading a reader. Anything not operating yet is drawn as such.

This paragraph goes stale easily — treat it as a starting hint, not as truth. The MVP
checklist lives in `README.md`, and Azure Boards is authoritative. Before starting work,
check the current state of the code and the relevant work item scope; do not assume a
feature exists or is missing.

## Implementation strategy

Features are implemented in small working slices. Example (gallery):

❌ DO NOT: build grid + lightbox + zoom + captions + EXIF + client galleries at once.

✅ DO:
1. Thumbnail grid with mock data
2. Fullscreen lightbox (open/close/navigate)
3. Keyboard navigation and swipe
4. Captions, zoom, preloading

Then iterate.

## Conventions

- App Router under `src/app`, shared components in `src/components`, shared logic in `src/lib`
- Import alias `@/*` → `src/*`
- Deployment tooling lives in `scripts/` as `.mts`, runs on the pinned Node major
  without a build step or extra dependency, and keeps its decisions in a pure module
  beside the file that performs the IO. Its Vitest tests sit next to it
  (`scripts/**/*.test.mts`) — it is not part of the application bundle, so it does not
  live in `src/`
- CMS document types live in `sanity/schemas/` as plain objects that import nothing — a
  Sanity schema type is a plain object, so describing one costs no dependency. They are
  content-store configuration exported to the customer's own Studio, not application
  code: nothing under `src/` imports them, and their Vitest tests sit next to them
  (`sanity/**/*.test.ts`). The one link to the application is a test asserting that an
  adapter projects only fields the schema declares
- Browser-free TypeScript tests use Vitest, live in `src/**/*.test.ts`, and must stay
  deterministic with no browser, external network, secrets, personal data, or live
  CMS/email dependencies. Playwright is reserved for separate public-journey tests.
- Public-journey tests use Playwright, live in `e2e/**/*.spec.ts`, and run against a
  **production build** that the harness builds and serves itself (`npm run test:e2e`).
  Import the project test object from `e2e/support/fixtures.ts`, never `@playwright/test`
  directly: it carries the guard that fails a test which reaches a third-party origin.
  The application under test runs on harness-owned settings in
  `e2e/support/harness-environment.ts` — that is where a test adapter for external
  delivery is selected, and it must stay free of credentials and personal data, because
  failure traces and screenshots are published as pipeline artifacts. Assert against
  accessible roles, names, and states or application-owned routes; a clone rebrands the
  site name, navigation labels, and content, so a journey test must not depend on them.
- TypeScript strict mode; build must pass with `npm run build`
- Tailwind CSS v4 (CSS-based config via `@tailwindcss/postcss`, no `tailwind.config` file)
- Mobile-first, semantic HTML, visible focus states
- No UI component libraries that define the overall look (e.g., Material UI, Bootstrap,
  Ant Design, Chakra) — the visual design is custom, built with Tailwind. Targeted
  libraries solving a specific problem (e.g., a lightbox) are fine when justified.
  This does not restrict application frameworks (Next.js) or utility tooling (Tailwind).
- Content/UI/infrastructure stay separated; design images to be CDN- and cache-friendly
- Model media generically: gallery items and content blocks must be able to represent
  videos as well as photos (video showcase and sharing are on the roadmap — don't build
  video features early, but don't bake photo-only assumptions into data models)
- CMS: Sanity is planned; until integrated, use a clearly separated mock data layer in `src/lib`
- Project skills use the open `SKILL.md` format: `.claude/skills/` for Claude Code,
  `.agents/skills/` for Codex. A skill needed by both is duplicated into both locations
  (no symlinks — unreliable on Windows + Git). Tool-specific skills go only in that
  tool's directory. No project skills exist yet; create them only for recurring workflows.

## Commands

```bash
npm run dev       # dev server
npm run lint      # ESLint (CI gate)
npm test          # browser-free TypeScript tests (CI gate, one run)
npm run build     # production build (CI gate)
npm run test:e2e  # Playwright public-journey smoke tests (CI gate, builds and serves)
npm run diagrams  # regenerate docs/architecture/*.svg from their .d2 sources
npm run diagrams:check # CI gate: sources compile and committed SVGs are current
npm run verify:preview -- <url> <dpl_id> # assert ownership, protection, and noindex
```

`npm run test:e2e` needs the browsers once: `npx playwright install chromium webkit`
(add `--with-deps` on Linux).

## Git workflow

- **Branch before the first file change.** While the checkout is on `main`, no file in
  the working tree may be modified — code, documentation, and configuration alike, and a
  change that "is only a one-liner" is not an exemption. Read-only work comes first and
  is expected: read the work item, explore the code, and check `git status` and the
  tracking state so the branch starts from a clean, up-to-date `main`. Creating the
  branch is then the last step before the first edit. If editing has already begun on
  `main`, stop and branch — uncommitted changes carry over — rather than committing them
  there.
- Branches: `feature/<id>-short-description`, `fix/<id>-short-description`, `chore/...`, `codex/...` — never commit directly to `main`. Include the work item id in the branch name when the branch belongs to one story (e.g. `feature/6-responsive-header`).
- Conventional commits: `feat: add gallery grid`, `fix: focus trap in lightbox`, `chore: bump deps`
- Reference the Azure Boards work item in the PR description with `AB#<id>`
  (`Fixes AB#5` closes the work item on merge); include `AB#<id>` in commit messages
  when the commit clearly belongs to one work item
- **Never run `git commit` yourself, under any circumstances.** This is an absolute
  requirement, stricter than "ask if unclear": not when a task appears complete, not for
  a follow-up fix, not after the user has approved the change in conversation, and not
  because an earlier commit in the same session set a precedent. The user reviews every
  change in their editor before it becomes a commit — a commit the agent creates skips
  that review even if it is later technically correct. Leave the working tree with the
  change staged or unstaged, whichever is convenient, and hand control back with a
  suggested message instead. This overrides any general instruction elsewhere that
  commits may be created when "requested by the user" — in this repository, request or
  not, the agent does not run the command.
- **Always suggest a commit message**, every time a change is ready to review: finishing
  a task, landing a fix, addressing review feedback. Propose a conventional commit
  message (`feat: ...`, `fix: ...`, including `AB#<id>` when it belongs to one work item)
  and stop there.
- **Always suggest a PR title and description when a work item appears complete**,
  without waiting for a separate request: concise summary, key implementation details,
  validation performed, and any validation that could not be run and why. Deliver it as
  a **fenced Markdown block that can be copied straight into the PR form** — it is pasted
  verbatim, so chat formatting has to be stripped by hand otherwise.
- **No AI attribution** in commit messages or PR descriptions — no "Generated with…"
  footers or equivalent. End the description at the last substantive line.

## CI / project management

- Source code: GitHub (public, `Alpine78/photosite-starter`)
- CI: Azure Pipelines (`azure-pipelines.yml`) — lint + test + build + Playwright smoke
  tests on push/PR to `main`. Journey suites for new features join that gate as they land
- Project management: Azure DevOps Boards, org `ilkkarytkonen`, project `photosite-starter`
  (Agile process: Epic → Feature → User Story → Task)
- Workflow: feature branch → PR → review → CI → merge to `main`

## Documentation

This is the complete set — there is no other documentation to hunt for:

| File | Audience | Update it when |
| --- | --- | --- |
| `README.md` | humans evaluating or cloning the project | scope, structure, setup, or MVP progress changes |
| `AGENTS.md` | all AI agents (canonical) | project-level working rules or conventions change |
| `CLAUDE.md` | Claude Code only | a Claude-specific skill or workflow changes — it imports this file, so put shared rules here |
| `docs/adr/` | future maintainers | a hard-to-reverse technical decision is made (see below) |
| `docs/architecture/` | anyone forming a mental model of the system | a system boundary, layer, external dependency, or the deploy flow changes — edit the `.d2` source and re-run `npm run diagrams`, never the `.svg` |
| `docs/asset-inventory.md` | licensing audit | any third-party asset, font, or shipped dependency is added or removed |
| `docs/contact-data-flow.md` | the site owner, a visitor who asks, and the AB#117 launch review | the contact form's fields, delivery path, processors, logs, or retention change |
| `docs/sanity-setup.md` | the site owner and whoever provisions a clone's CMS | the Sanity connection settings, ownership/transfer story, perspective, schemas, media policy, or failure behavior change |
| `sanity/README.md` | whoever wires a clone's Studio to these schemas | a document type is added, or how the Studio consumes them changes |
| `docs/deployment.md` | the site owner and whoever provisions a clone's hosting | the Preview environment, pipeline deployment stage, environment-variable split, runtime pins, or promotion/rollback mechanism change |
| `NOTICE`, `licenses/` | anyone receiving the product | a third-party component with an attribution requirement is added |
| `.claude/skills/`, `.agents/skills/` | agents | a recurring workflow needs a skill; duplicate into both, no symlinks |

Rules:

- Keep documentation changes in the same PR as the change they describe.
- **Status text goes stale silently.** The MVP checklist in `README.md` and the feature
  status in this file describe a moving target. When you finish a story, check both —
  the code and Azure Boards are authoritative, and prose that contradicts them is worse
  than no prose.
- **Architecture diagrams are generated, never hand-edited.** `docs/architecture/*.d2`
  is the source; the `.svg` beside it is a build artifact that `npm run diagrams`
  rewrites and `npm run diagrams:check` gates. Diagrams show *what* the boundaries are
  and ADRs record *why* — a diagram never replaces a record, and anything drawn that is
  not operating yet must say so on the diagram itself.
- Record hard-to-reverse technical decisions as an ADR in `docs/adr/`: a dependency the
  UI is built around, a data model boundary, a hosting or CMS commitment, a product
  boundary. See `docs/adr/README.md` for naming and format. Routine choices do not need
  one.
- **Anything third-party that ships gets recorded before it lands** — a font, an image,
  an icon set, a vendored skill, a runtime dependency. Add it to
  `docs/asset-inventory.md` with source, author, license, attribution requirement, and
  commercial-use status; if the license requires attribution, add it to `NOTICE` and put
  the license text in `licenses/`. This project is redistributed to people who rebrand
  and deploy it, so "it's only a placeholder" is not an exemption.
- **The project accepts no external contributions** (see `README.md`). Do not add
  contribution guides, PR templates, or CLA tooling.

## Definition of Done (summary)

Acceptance criteria met, tests pass, TypeScript build passes, lint passes, responsiveness
and accessibility checked, documentation updated, PR approved.

## Final principle

> Make it work → make it simple → then improve.

Build the simple, fast, visually high-quality photographer site first. Extend to client
galleries, proof selection, and other advanced features only after that.
