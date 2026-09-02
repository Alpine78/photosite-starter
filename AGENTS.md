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
- **Public derivatives only.** Browser-facing media on the **public** surface may contain
  only a versioned public web-delivery derivative and that derivative's true intrinsic
  dimensions. Camera masters, archive locators, provider internals, and private or
  sales/fulfilment assets stay behind a server-only adapter and never enter the optimizer
  or any browser payload. Use bounded, context-specific responsive `sizes`; transforms may
  downscale but never crop or upscale. URL parameters are optimization controls, not
  access protection.
  **Private client galleries (ADR-0014) are the one scoped exception,** for an
  **authorized holder of a valid gallery link or session** (the model proves possession of
  the capability, not identity), through a short-lived single-object signed object-store
  URL the server mints per request, never touching the public optimizer or the public
  media contract: (a) a bounded private **web derivative** — a watermarked proof, or a
  web-resolution (≤ 2048 px longest edge) delivery preview; and (b) for a delivery
  gallery, **one protected full-gallery ZIP** of the delivered full-resolution processed
  JPEGs, delivered whole — no individual full-resolution downloads. Camera masters,
  archive locators, and provider internals still never reach any browser. **This exception
  is for ADR-0014 client galleries only and grants nothing to AB#95 sales/fulfilment
  assets,** which stay fully behind the server-only adapter until their own decision.
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
pages, a semantic design-token layer (AB#36) — the brand-sensitive colours, text
roles, borders, accent, focus indicator, type families, and corner scale defined once
in `src/app/globals.css`, consumed by shared components through static Tailwind
utilities, with explicit light/dark (`prefers-color-scheme` plus a `data-theme` pin,
`color-scheme` set), a documented override contract for a future preset
(`docs/theme-contract.md`, AB#37), and AA text/focus contrast enforced by
`src/lib/theme-contract.test.ts` and `e2e/theme.spec.ts`; the shared generic media model, the public
image rendition boundary, the shared bounded gallery
result contract, the fullscreen lightbox behind a project-owned PhotoSwipe wrapper
(open, close, navigate, trapped focus, focus return keyed by `itemId`, and the caption
and credit of the active item, associated with it for assistive technology),
its zoom and pan behaviour (AB#78): the one-click/tap/`z`-key magnification and the
gesture pan are the library's own, bounded by ADR-0005's zoom cap, and the wrapper adds
only the two things the library omits — `aria-pressed` on the library's zoom button,
synced from a cached `zoomPanUpdate` handler through the browser-free `isLightboxZoomed`
predicate (`src/lib/lightbox-zoom-state.ts`), and the caption stepping out of the way
while zoomed (AB#16's dormant `data-visually-hidden` hook, now also dropping the region's
`pointer-events` and `tabindex` so it neither eats a pan gesture nor holds a keyboard
stop) while its text and the image's `aria-describedby` link stay intact; zoom, pan, and
caption state reset with the slide and on close because the library resets the
magnification and rebuilds the dialog. `e2e/gallery-lightbox-zoom.spec.ts` covers mouse,
synthesized tap/double-tap, keyboard, and pointer-drag paths — including a drag that
starts over the hidden caption, proving the region's dropped `pointer-events` lets the
gesture through — and the vertical pan-bound clamp (the axis that does not double as
slide navigation); the one physical-device pinch/pan check (AC6) is documented as
outstanding in ADR-0001 and AB#78 stays open until it is done. Zoom *animation and level
tuning* stay a later slice.
There is also
a bounded adjacent-image preload window (`LIGHTBOX_PRELOAD_WINDOW`, `image-delivery.ts`,
ADR-0010) that replaces the library's own unstated default with one slide back and two
forward, structurally unable to cross a gallery's page cursor because it only ever
addresses slides already in the viewer's loaded array, with its own failure/retry
behaviour and bounded network/memory footprint measured against a real browser and
recorded in the ADR,
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
that pushes the order and row limit to the adapter. That branch listing aggregates every
canonically and secondarily placed page in the category's whole descendant subtree, not
only its direct placements (ADR-0003, 2026-08-27 amendment, AB#140): a parent surfaces a
deep branch's galleries with no per-item secondary placement, aggregation flows downward
only, and the query is scoped by the in-scope subtree category ids so a store-backed
adapter pages it with a category-scoped `references()` query rather than an unbounded
per-content-id list — the story root keeps its own explicit routed-content id list. There
is also a bounded recent-content overview on
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
version comparison. AB#117 bumped Next.js to 16.3.2 (`npm audit fix`, dependency-vulnerability
remediation) and the Playwright 404/redirect suite still passes at that version, but that is
not the same check as AB#132's own version-comparison reproduction, which has not been rerun.
One authoritative order governs the source, the DOM, keyboard focus, and the
lightbox sequence, and the grid is row-major (one, two, three columns, top-aligned, native
ratios, never cropped) precisely so the visual reading order cannot contradict it; the
column-major CSS masonry it replaced did. That order is manual (the administrator's
authored `order`) unless a gallery opts into the **seeded-random rule** (AB#129,
ADR-0009): a deterministic shuffle whose per-placement sort key
(`computeShuffledOrder` in `src/lib/gallery-shuffle.ts` — HMAC-SHA256 of `placementId`
keyed by `orderingSeed`, fixed-width hex) is *materialized* once by whoever produces the
rows, never recomputed on the read path, with pinned lead placements kept in their exact
manual positions ahead of the shuffled rest (ADR-0009 §3). `gallery-pagination.ts`'s
boundary key is the tiered `(pinnedTier, key, placementId)` triple
(`GalleryOrderingBoundary`), with the tier recoverable from `key`'s type so
`keyset-cursor.ts`'s wire format is unchanged and a pre-AB#129 `manual` cursor still
decodes. `GalleryOrdering` (`{kind:"manual"}` | `{kind:"seeded-random", seed}`) is the
one structured value a caller supplies; `orderingScopeString` derives the
`GalleryCursorScope.ordering` value centrally (`seeded-random-v1:<seed>`), so the seed is
part of the cursor digest and a reseed retires an in-flight cursor as `wrong-scope`, not
`stale`. Both sources serve it: the mock fixture's `content-shuffled-showcase` (34
placements, 3 pinned), and (AB#129 PR2) a `SITE_CONTENT_SOURCE=sanity` deployment —
`galleryPlacement` stores `shuffledOrder` (raw 64-hex) + a `shuffledOrderSeed` marker,
`sanity-gallery.ts` serves the tiered order as two keyset lanes (pinned by `order`, then
by `shuffledOrder`) in one round trip, and the Studio publish block on `seeded-random` is
lifted. Rotation is two steps (ADR-0009 2026-08-28 amendment): edit `orderingSeed` in
Studio, then `npm run recompute:shuffled-order -- --gallery <id> --language <lang>`
(owner-run, `ifRevisionID`-guarded, refuses to run while an unpublished draft of the
gallery or a placement exists, re-checks the gallery rev/rule/seed before and after the
patches, ends with an authoritative consistency query that runs even for an empty plan).
Between the two the `basics` query's bounded `staleShuffledOrderCount` aggregate makes the
adapter raise `ordering-stale` (re-raised at the `@/lib/gallery` seam as
`GalleryOrderingStaleError`) — *after* the cursor/section validation, so a bad token still
404s mid-rotation. The detail route renders an accessible "being reordered" notice
(**HTTP 200 + `noindex`** — an App Router page render cannot set 503; named limitation,
follow-up tracked with AB#132), and the `/api/gallery` continuation endpoint (a Route
Handler, which can) returns a real **503 + `Retry-After`**. Recovery is automatic once the
recompute's placement patches invalidate the `sanity:galleries` cache tag; the command's
final check gates only its own exit code.
A gallery's listing card takes its explicit
cover or the deterministic first public item in the active order
(`selectCuratedGalleryCover`), a published
gallery with no items renders an accessible empty state (the mock publishes one, so it is
a state the site serves rather than one only a test has seen). Category listings still answer `?cursor=` with a 404, because none issues one;
`?section=` stays an ignored unrecognized parameter until AB#115 wires it into a route. The continuation link is progressively enhanced in the browser to
append one bounded slice in place, with loading, failure, retry, and completion states;
the open lightbox grows from the same result and offers its own reachable retry without
closing or losing the current item. Focus stays on the continuation control while it
exists and moves to the completion notice when the final slice removes it. No slice is
loaded until the visitor activates the control or reaches the last loaded lightbox item.
A ~400-placement fixture gallery exercises the boundary.
Gallery sections (AB#105) sit on top of that same boundary: a gallery-local named subset
of a curated gallery's placements (ADR-0003 decision 8), with a stable id, a
gallery-unique lowercase-hyphenated slug, a label, an explicit manual order, and an
optional short intro restricted to paragraphs, ordered or unordered lists, and inline
links or emphasis — a dedicated inline-span model (`src/lib/gallery-sections.ts`), since
the shared `ContentBlock` union's `paragraph`/`list` kinds carry only plain-string text
with no inline structure to reuse. Membership is placement-owned, never media-owned:
`sectionId` lives on the placement, so assigning or moving an item never touches the
underlying photograph or its use elsewhere. `readCuratedGallerySectionPage` composes the
request: a raw `?section=` slug resolves to `{kind: "all"}` or a matched section (absent,
empty, and the reserved `all` token all mean unfiltered; an unmatched slug throws
`UnknownGallerySectionError`, which is also the whole of "rename, delete, and stale URL"
behaviour, since a retired or renamed-away slug simply matches nothing and no redirect
history is kept for sections, unlike category or content renames); the resolved filter —
never a raw slug — reaches a `CuratedGallerySectionSource` before any placement row is
read, and folds into `GalleryCursorScope.normalizedFilter` so the existing HMAC
scope-matching a cursor already goes through is what makes selecting a different section
invalidate a stale one, with no new cursor logic. A named section's own label and intro
appear only on that section's first, uncursored slice; the full section catalog is
exposed on every page for a future control; `All` never concatenates a section's intro,
and a continuation never repeats one. A valid section with no placements answers a
successful empty page rather than a 404; an unknown section, like an unrecognized cursor,
is the same 404-class failure. The mock fixture extends the large archive with two
150-placement sections spanning more than one 24-item page each, plus a third declared
section with none, so both cross-page section continuation and the empty-section state are
exercised, not just asserted. Controls, browser history, and the grid/lightbox wiring that
consumes this query are deliberately out of scope here — AB#115's job, which inherits
correct unknown/empty-section behaviour by construction rather than redefining it — and so
is `route.ts`/the catch-all page ever reading `?section=` from a real request. AB#105's own
review surfaced a real gap it did not close on its own: `source` received neither the
requested cursor nor the page size, so nothing let a store-backed adapter answer a large
section with a bounded keyset query instead of fetching the whole section on every
continuation — the same limitation the pre-existing unfiltered `All` view already had,
inherited from `buildCuratedGalleryPage` (AB#67/AB#104). AB#134 closes it: `buildCuratedGalleryPage`
now takes a caller-supplied `GalleryWindowResult` (the current boundary item, found by
identity, plus up to `pageSize + 1` items strictly after it) instead of the full ordered
set it used to derive both the slice and `hasNextPage` from, and `CuratedGallerySectionSource`
is now asynchronous and receives that bounded `GalleryWindowRequest` — `candidateLimit` plus
an optional `after` boundary key — rather than "every placement matching this filter."
`resolveGalleryWindowRequest` decodes a cursor into that boundary key before a source is ever
called, so cursor decoding moved from inside `buildCuratedGalleryPage` to just ahead of the
source call it now has to inform; `selectGalleryWindow` is the shared in-memory reference
implementation `mock-gallery.ts`'s fixture source composes, and the one a store-backed
adapter (AB#114) replaces with two real queries — an id lookup for the boundary and a keyset
range query for the rest — whose ordering must agree exactly with the file's own JS
string-comparison tie-break, not a database's default collation. The redesign also narrowed
cursor staleness from "any change anywhere in the gallery that shifts an array offset" to
"the boundary item itself was reordered, hidden, or removed" — the accepted, standard
behaviour of keyset over offset pagination, deliberately chosen over preserving the old,
broader trigger. What AB#105 already made bounded and tested before AB#134, and remains true
now, is the axis it always owned: a section-scoped read is never required to load a
*different* section's placements, or the rest of an unsectioned gallery, to answer correctly.
A gallery's optional lead and long-form body (AB#106) are ordinary `ContentPage` fields,
not a gallery-specific type: the short lead already rendered from AB#104's own
`page.summary`, and the long body reuses the exact `ContentBlock` set and `ContentBody`
renderer an article's body already reads through, so a gallery gains no article-specific
model of its own. `ContentPageJumpNav`, extracted from the article variant's own
heading-only navigation, gives the gallery variant its content-derived page-jump
navigation (ADR-0003 decision 3): present only when a long body exists, always offering a
link to the grid (`#gallery`, an in-page anchor rather than a route) ahead of any level-2
headings the body carries, and reusing the same `listContentHeadings`/`buildHeadingIds` an
article's own table of contents is built from, so a heading's anchor and the link that
names it cannot drift between the two variants. Both the navigation and the body are
omitted on a continuation slice, along with the rest of the page's editorial framing
(decision 3), and a gallery with no body renders neither wrapper. Body media renders
through the same `MediaFigure`/`ContentBody` boundary as an article's, so it carries the
same public-rendition, native-dimension, no-crop, lazy-loading guarantees and stays
separate from the gallery's own curated result set, grid, lightbox, sections, and
pagination (decision 2) — a body photograph is a content placement, never a gallery item.
A three-level nested table of contents (AB#21) and an inline mini-gallery body-block type
(AB#24) remain later, unimplemented extensions of this same boundary.
The pre-tree `/portfolio` route was removed rather than
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
`HomeContent` contracts, and AB#135 wires both into their route-facing seams
(`src/lib/site-settings.ts`, `src/lib/home-content.ts`) alongside every other content adapter,
so a deployment never mixes a mock and a Sanity source on one page.
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
the same state. Several rounds of independent review hardened these adapters and the article
publication guard further: content-block and service Studio schemas reject a blank list item
or description paragraph, matching the adapters' own read-time rule, so an ordinary publish
cannot create content the read boundary refuses; every place a Sanity document reference
resolves against a `categoryId` index marks an unresolved reference with a value the identity
pattern can never produce (`unresolved-ref:<ref>`), so a coincidental string collision with an
unrelated category's real id can never silently alias to it; `publishedAt` is checked as a real
ISO calendar date via a `Date.UTC` round trip, not merely `Date.parse`, which is lenient enough
to normalize `2026-02-31` into March 3 rather than reject it; a category listing's candidate id
list is chunked to the Sanity GET URL's byte budget — measured the same way
`buildSanityQueryUrl` measures the real request, not approximated — so a category with a few
hundred articles cannot make the query itself fail, and a single pathologically large id is
rejected outright rather than silently emitted as an oversized chunk; and `readContentBlocks`
rejects two body blocks sharing one stable key, since a duplicate breaks the render-time React
identity the key exists to provide. AB#135 wires the article and service adapters into their
route-facing seams (`src/lib/content.ts`, `src/lib/services.ts`); the shared content-block
schema and adapter were already reached transitively through every content page that renders
a body.
The gallery schema and adapter (AB#113) sit beside the article ones, sharing their
identity/URL-freeze/local-slug-namespace guard through a new `content-placement-
validation.ts` rather than duplicating it: a `contentId` can no longer be claimed by both
an article and a gallery, and a local slug collision between the two types is caught the
same way a collision between two articles already was. `gallery.ts` is one document per
language, like `article.ts` and unlike `category.ts`, because its placement overrides and
section labels are plain per-language text, matching `GalleryContentPage`'s own shape. Its
named sections (AB#105) stay a gallery-local object array on the document itself —
`sections`, bounded to `MAX_GALLERY_SECTIONS` (20) — but its curated items do not: AB#114
found, verified against Sanity's own technical-limits documentation, that an embedded
`placements` array cannot be read as a bounded, keyset-paginated window without the query
engine loading the whole document (Content Lake filters and projects whole documents; a
single one is capped at 1,000 attributes on the Free/Growth plan, a ceiling a few hundred
placements already approaches), so each placement is now its own `galleryPlacement`
document (`sanity/schemas/gallery-placement.ts`), referencing its `gallery`. `order` is
therefore an authored field rather than array position — a real authoring-experience cost
(no more drag-to-reorder) accepted for the bounded-query property. Its own document-level
Studio guard (`validateGalleryPlacementPublication`, one round trip per placement) enforces
what ADR-0002 leaves to be decided for a gallery specifically: every `placementId` is
public and site-wide unique with an immutable media/gallery binding, except that the same
occurrence may legitimately share one `placementId` across a gallery's own language
versions; repeating a photograph within one gallery is allowed but flagged with Sanity's
non-blocking `rule.warning(...)` rather than refused (ADR-0002 §2, closing that ADR's own
deferred action item); and a section's slug is immutable once published, restating
`gallery-sections.ts#assertGallerySectionsSlugStable`. A section's optional intro reuses
the same restricted paragraph/list/emphasis/link model `gallery-sections.ts` already
defines, through dedicated object types (`gallery-section-intro.ts`) rather than the
six-kind shared body blocks, whose plain-string paragraphs and lists carry no inline
structure. `orderingRule`/`orderingSeed` let a gallery declare a seeded-random ordering,
and (AB#129 PR2) `galleryPlacement` also stores the materialized key: `shuffledOrder`
(read-only, raw 64-hex `computeShuffledOrder(orderingSeed, placementId)`) and a
`shuffledOrderSeed` marker, absent on a pinned lead and on a `manual` gallery.
[ADR-0009](docs/adr/0009-seeded-random-gallery-ordering.md) decides that rule's contract
— a materialized, precomputed sort key recomputed on rotation, because GROQ has no hash
function to compute one live and keyset pagination needs a stored, sortable field —
narrowly split off AB#66's broader dynamic/keyword-gallery contract, which stays open.
Placement-level Studio validation (folded into the existing one-round-trip publication
query) blocks only the one *structurally impossible* generated value — a `shuffledOrder`
present but not a 64-char hex string. Absent, now-stale, leftover-after-a-rule-switch, and
just-re-pinned states all publish fine, because those are transient and the recompute step
(which reads only published placements) resolves them — blocking would deadlock the
author. What that same validator now *does* freeze once published is `placementId` itself
(alongside the media/gallery binding it already froze): it is an identity (ADR-0002 §1)
and the HMAC input for `shuffledOrder`, so renaming it in place would leave a read-only
key pointing at the old id with no `ordering-stale` signal — a re-identification is a new
placement. The `gallery`
document's publish block on `seeded-random` is lifted; `orderingSeed` gains the pagination
boundary's length ceiling and is rejected if it has surrounding whitespace (it is used
verbatim by `orderingScopeString`, the recompute step, and the stale-count query — an
inconsistent trim anywhere would strand the gallery `ordering-stale`). `src/lib/sanity-gallery.ts`'s
`readSanityCuratedGalleryPage` (AB#114) is the bounded, windowed read: two HTTP round trips
per page (this gallery's ordering rule, section catalog with intro, and a conservative
`visibilityVersion` derived from the most recently updated matching placement's
`_updatedAt`, then the placement window itself), composing `gallery-sections.ts`'s shared
`CuratedGallerySectionSource` contract — an id lookup for a named cursor boundary plus a
keyset range query for the rest, following Sanity's own documented `order > $after ||
(order == $after && placementId > $afterId)` idiom rather than array-slice offset
pagination — over `galleryPlacement` documents, filtered by `visible` and
`media->publiclyRenderable` in GROQ itself so a returned row is already within
`CuratedGallerySectionSource`'s contract and nothing here can silently shrink a page by
dropping a row after the fetch. For a `seeded-random` gallery (AB#129 PR2) the same read
adds `orderingSeed` and a bounded `staleShuffledOrderCount` aggregate to the basics query
(non-zero => `SanityGalleryError "ordering-stale"`, the two-step-rotation window), serves
the tiered order as two keyset lanes in one round trip — `pinned` (by `order`) then
non-pinned (by `shuffledOrder`), using `coalesce(pinned, false)` so a null/absent
`pinned` still counts as non-pinned — concatenated and sliced, because ADR-0009 §3's
tiered key cannot be one GROQ `order()` clause without a `select()` a fake-store test
cannot pin; and passes the scope string as an always-true `$orderingScope` param so the
window fetch-cache key varies by seed. `projectGalleryPlacement` never rejects a whole gallery
over one placement whose media is not publicly renderable (ADR-0002 §3's AND-composition):
it resolves to no candidate row for that placement, distinct from throwing for a genuinely
malformed one — though the GROQ-side filter means this call site never actually exercises
that branch, since every row it sees already passed the same check server-side. A
~400-placement fixture, exercised against a fake Content Lake that answers the adapter's own
two query shapes rather than a general GROQ interpreter, walks the whole archive and a
150-item section spanning several pages with no duplicate or missing item.
AB#135 wires every content adapter above into its route-facing seam: `src/lib/gallery.ts`'s
`getGalleryPage`, `src/lib/content.ts`'s tree/redirects/listing/detail-page/sibling-navigation
reads, `src/lib/site-settings.ts`, `src/lib/home-content.ts`, and `src/lib/services.ts` all
dispatch on `SITE_CONTENT_SOURCE` — `mock` continues to read the fixture layer unchanged, and
`sanity` now reads every one of these adapters, never a mixed mock/Sanity page. Closing that
wiring surfaced two gaps the adapters themselves had not: `sanity-gallery.ts` gained a bounded
gallery listing-record read (`readPublicGalleryListingRecords`, mirroring the article
adapter's own chunked, byte-budgeted multi-id query, since a category branch can list
galleries and articles side by side) and `sanity-article.ts` gained a bounded two-row sibling
query (`readPublicArticleAdjacentRecords`, one HTTP round trip via a `^`-referenced keyset
comparison) — gallery sibling navigation stays unbuilt because no current route requests it.
A locale with no published categories, articles, or galleries is omitted from the
Sanity-backed tree entirely, matching the mock's own "unauthored locale is absent, not empty"
contract; a placement without its localized category still reaches the tree validator and
fails instead of being hidden as an empty locale. No adapter yet
records previously published path history (ADR-0003 decision 7's URL-change workflow remains
unbuilt), so a Sanity deployment's redirect map is honestly empty rather than borrowed from
the mock. `/services`' optional listing intro gained a matching optional `servicesIntro`
field on the `siteSettings` singleton (schema, adapter, and seed fixture), read through
`getSiteSettings()` rather than its own separate source, so the page never mixes an authored
catalog with fixture-only intro copy. `content.ts`'s Sanity tree build is wrapped in React's
`cache()` so the several seams one request touches (`resolveRequest`'s trees and redirects,
`getCategoryListing`, `getAdjacentContent`) share one per-locale read instead of repeating it,
without reintroducing the cross-request module cache AB#83's revalidation cannot reach.
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
On top of that, once a deployment is verified the stage repoints a stable
`*.vercel.app` **integration alias** (`PREVIEW_STABLE_ALIAS`, AB#136) at it, so a
Sanity webhook configured once with `https://<alias>/api/revalidate` keeps working
across ordinary redeploys instead of going stale. The repoint is a transaction
(`scripts/repoint-preview-alias.mts`, decision logic in `scripts/preview-alias.mts`):
it refuses the project's default production domain and any alias currently resolving to a
production deployment; a **revision gate** (AB#144) resolves `main`'s tip live
(`git ls-remote`) immediately before the assignment and, if this deployment's commit
(`$(Build.SourceVersion)`) is no longer that tip, leaves the alias untouched
(`superseded`, a pipeline warning, not a failure) — fail-closed if the tip can't be
resolved; the monotonic `createdAt` guard runs earlier and is retained as defence in depth
(including for an owner-run invocation of the same repoint script outside CI; a direct
`vercel alias` command bypasses it); the alias host is re-verified for the
same SSO challenge + exact `noindex`; and a failed re-verification restores the previous
target (or removes a first assignment) only while the alias still points at what that run
assigned. Concurrent `DeployPreview` runs are serialized by a stage-level exclusive lock
(`lockBehavior: sequential` + an Exclusive lock check on the variable group) — execution,
not commit order, which is why the revision gate exists. The alias is constrained to
`*.vercel.app` because only that inherits Standard Protection + `noindex`; a custom domain
is refused. `PREVIEW_STABLE_ALIAS` is required once the deploy stage is enabled.
`npm run verify:preview-alias` is the read-only check for handoff/rollback. The revision
gate never initiates an assignment for a candidate already known to be superseded; the
residual is that the alias may remain on its last verified `main` target after `main`
advances if the current-tip run has not itself succeeded. That target is stale relative
to the tip but remains verified and protected. A declined older run emits the
`superseded` warning. The tip is resolved through
the checkout's `origin`; a private-repo clone must enable `persistCredentials`. The live
AC5 exercise is owner-run; ADR-0004 §3
has a 2026-08-31 amendment for the "generated URL, not a custom preview domain" clause.
The provisioning runbook, the Preview/Production environment split, and the recorded
promotion and rollback commands are `docs/deployment.md`.
Sample content seeding (AB#84) sits on top of every schema and adapter above: an
owner-run script (`npm run seed:sanity`, `scripts/seed-sanity-content.mts`) that writes
474 sample documents — a 3-level category tree, one published settings and home
singleton, 3 services, 3 article documents (one page authored in both `fi` and `en`,
one `fi`-only, exercising ADR-0003 decision 7's independent per-language publication),
3 galleries, and 451 gallery placements — into a real Content Lake over the plain
mutate/asset-upload HTTP API, never through a Studio and never wired into the
application or CI. Every seeded document's own six real, already-vetted demo
photographs (`public/gallery/*.webp`) back all 6 minted `media` documents — never more
identities than there are photographs, per ADR-0002 — reused across hundreds of
placements, including one photograph placed in both galleries under two different
`placementId`s to prove identity survives reuse. One gallery (`featured`) has two named
sections and a body; `archive` has neither and carries the 400 placements that exercise
AB#114's keyset-paginated read across several pages; `shuffled` (AB#129 PR2) is a
`seeded-random` gallery of 25 placements — 3 pinned leads, 22 with pre-computed
`shuffledOrder` keys — so the seed run writes a gallery that is already a consistent
generation and `verify:sanity-live` can walk its materialized tiered order. Every document's
`_id` is a public, root-level, dot-free `seed--` id: Sanity restricts dot-path ids to
authenticated reads even in a public dataset, so the fixture cannot use `path()` as its
namespace without becoming invisible to the application's tokenless public reads.
Cleanup normalizes published, draft, and release ids and recognizes the reserved prefix
locally; the legacy private `seed.…` ids from the first implementation are recognized
for deletion but never written. The write is fully self-policed: because Sanity's mutate API
does not run a Studio's async validation rules, `sanity-seed-fixtures.mts`'s own
`validateSeedFixtures` re-derives every invariant an API import could otherwise violate
(unique identities, every reference resolving to the right document type, an acyclic
category tree, deterministic `_key`s on every array item so a later hand-edit in
Studio is safe) before a byte is sent, and a preflight query refuses to run at all if a
another `siteSettings`/`homePage` document already exists, rather than silently
creating a second published singleton. `--yes` ends with a live verification step:
hand-written GROQ existence/shape checks run against the dataset just written, so a
future owner-run external write can prove the "representative content queries pass"
acceptance criterion against that real project rather than a fake one. PR #62 did not
run this write-enabled path against an external dataset. The command also reports (or,
with `--prune-stale`, deletes) any
previously seeded document a shrunk fixture no longer includes. `docs/sanity-seeding.md`
is the full runbook: the write-token story (a separate, write-scoped
`SANITY_SEED_TOKEN`, never the runtime app's read-only `SANITY_READ_TOKEN`), the
go-live checklist that empties and verifies every seed-owned document and the six
uploaded assets (which mint their own non-`seed--` ids and need a manual Studio
deletion, disclosed rather than automated at six files), and export/recovery through
Sanity's own `dataset export`/`import` CLI. Seeding a dataset did not, on its own, change
what any route reads — every page rendered from the mock layer until AB#135's route-facing
switch landed (below), so a seeded project and the live site were two separate, unconnected
facts until that story shipped. A deployment declaring `SITE_CONTENT_SOURCE=sanity` now
renders this seeded content for real.
`/sitemap.xml` and `/robots.txt` (AB#85) sit on top of the public content tree,
locale route configuration, and services boundary: fixed, language-neutral root
routes per ADR-0003, generated from `src/lib/sitemap.ts`'s `buildSitemapPaths`, a
pure function over exactly the seams route pages already read — `content.ts`'s
`getContentTrees`, `services.ts`'s `getServices`, and deployment-owned locale route
config — rather than a second query of its own, so a route not public, renderable,
and indexable there is not public, renderable, and indexable here either. Category
and content paths come from `content-tree.ts`'s `listPublicRoutePaths`, generalized
from that module's own pre-existing private path index rather than a duplicated
walk; a configured locale with no published tree yet, and a published tree with no
public category yet, are both omitted the same way `resolveStoryRoute` 404s them,
rather than emitting a URL that does not resolve. A gallery or category's `?cursor=`
continuation and a gallery's `?section=` filter never enter the list, because they
are not category-tree or static-page identities the walk ever reaches, matching
ADR-0003 decision 8's parameter-free-only sitemap-eligibility rule exactly. A
duplicate generated path is treated as a defect and throws rather than being
silently deduplicated, the same posture `content-tree.ts` already takes toward its
own structural invariants. `src/app/sitemap.ts` declares `force-dynamic`, because
Next.js caches a metadata-route file like this one at build time by default —
confirmed against the framework's own documentation — which would freeze the list
against every later publish, unpublish, or slug change the AB#83 freshness target
requires; `robots.txt` needs no such override, since Next already treats it as
dynamic. `robots.txt` expresses crawl guidance only, never access control:
`src/lib/robots.ts`'s `buildRobotsPolicy` disallows everything for a non-production
`SITE_DEPLOYMENT_STAGE` as defense in depth, while a Preview deployment's actual
protection remains the platform's own access control plus its `X-Robots-Tag:
noindex` header, per `docs/deployment.md`. Two scope boundaries were considered and
deliberately left alone rather than built speculatively: verifying that a
tree-canonical placement's underlying detail record still exists would mean loading
a full page body (or gallery page) per candidate during sitemap generation, the
exact "a listing loads a body" pattern `content-listing.ts` and
`mock-content-pages.ts` already reject elsewhere, so this boundary trusts the
tree's `published` and canonical-placement state the same way `content.ts`'s own
listing-record query does; and ADR-0002 §4's reserved, route-owned `indexable` field
— letting an author keep one public gallery or article out of the sitemap without
unpublishing it — is not implemented anywhere in `content-tree.ts`, the article or
gallery Sanity schemas, or the mock fixtures yet, so there is no such state for the
sitemap to consult today. Both are documented as deliberate, not silently dropped.
AB#19's legacy-URL redirect registry (`src/lib/legacy-redirects.ts`) is partially
built: a reusable, generic, pure validated-lookup module — same-shape precedent to
`content-redirects.ts`, but a separate registry, since a legacy Joomla path is a
disjoint taxonomy from the `/tarinat`/`/en/stories` namespace that file owns — wired
into `src/proxy.ts`, the only layer in this Next.js version able to answer a genuine
`410 Gone` at all (a Server Component page's built-in error APIs stop at 404/403/401)
and the only one that can emit a literal `301` rather than the route tree's own
308-hardcoded `permanentRedirect()`. Of the 442-record production Joomla crawl
inventory (415 distinct paths) AB#19's own comments and ADR-0003 decision 9 govern,
this pass decides only the 174 `component/tags/tag/...` and
`en/component/tags/tag/...` Joomla tag-browsing pages, each a justified `410 Gone`
because no current-site replacement exists (a future one is AB#66's). Every other
path — every legacy gallery, article, category, and static page, plus
`component/komento/*` (a real Joomla gallery component, not system debris) and
`sivustokartta/*` (real aliased content, not a generic sitemap page) — stays recorded
as an explicit pending row in `src/lib/legacy-redirects-tracking.ts` rather than a
guessed target, because ADR-0003 decision 9 itself requires a migrated page's locale,
canonical category, and slug to be known first, and no route reads real migrated
content yet (`SITE_CONTENT_SOURCE=mock`). `legacy-redirects-data.test.ts` keeps this
bookkeeping honest: every distinct crawled path is accounted for by exactly one of a
decided row, a pending row, an excluded row (Joomla's own `/404` error page, owed no
redirect), or an already-live row (the site root), and the decided set is pinned to
its exact reviewed count so a future inventory update cannot silently reclassify an
unreviewed path the way `component/komento/*` and `sivustokartta/*` first appeared to.
The crawl also surfaces a finding for whoever resolves the Finnish `/portfolio` row:
it was a real, live, published Joomla page, which is evidence against the assumption
the 2026-08-10 ADR-0003 amendment relied on to remove this template's own dead
`/portfolio` scaffold without a redirect — that removal was about the template's own
never-deployed route, not the production site's real one at the same path.
The numeric gallery lightbox query-state policy the crawl comment flagged as
unresolved (Joomla's own bare `?4738` query, layered on a page's pathname rather than
a distinct crawled route) is decided and closed, separately from the per-pathname
decisions above: `legacyRedirectDestinationSearch` never strips or translates such
state automatically (ADR-0003 decision 9), covered by dedicated Vitest and Playwright
cases naming the crawl's own shape. No `redirect` row exists yet to exercise the
301 case end-to-end — every decided row so far is a `410 Gone` tag page — and that gap
stays open, deliberately, until a real redirect row exists; fabricating one to close it
would mean guessing a canonical target this pass explicitly defers.
The category branch listing continuation is now built (AB#140 PR 2, ADR-0013): a branch
whose aggregated subtree exceeds `MAX_CONTENT_LISTING_PAGE_SIZE` pages through a keyset
`?cursor=` over `(publishedAt, contentId)`, signed with the shared
`GALLERY_CURSOR_SIGNING_KEY` (one HMAC primitive extracted to `keyset-cursor.ts`, one
secret for both cursor families). The cursor scope carries a conservative
`visibilityVersion` — a digest of the in-scope subtree category ids plus, for a store, the
most recent in-scope content `_updatedAt` (`readPublicCategoryListingContentVersion`); for
the mock, an in-memory `(contentId, publishedAt)` digest — so an authored-date edit or a
category re-parent invalidates an in-flight token with `stale`. `cursorDisposition` now
`carry`s a `?cursor=` at a `category` route (the story root still `reject`s one, having no
continuation contract); a token at a non-canonical spelling is validated by an injected
`categoryListingCursorNamesASlice` before a redirect. A continuation page is compact —
branch title marked "continued", a link back to the first page, the child-category
navigation, the language switch (which drops the cursor), then the grid — self-canonical
with its `?cursor=` and naming no `hreflang` alternates, and its control is a real `<a>`
so it pages through with no JavaScript (progressive in-place append is deliberately not
built). The invalid-cursor 404 offers the branch's own parameter-free page
(`not-found-return.ts`). Only the parameter-free URL enters the sitemap. Story-root listing
continuation is deliberately out of AB#140's scope.
The gallery-item enquiry (AB#60) is partially built — its server-only identity and
authorization seam (PR1) and its `POST /api/enquiry` endpoint (PR2); the lightbox entry
point and the e2e journey (PR3 / AB#123) remain. `src/lib/enquiry-media.ts`
(`import "server-only"`) takes a
**discriminated** request — `{kind:"curated", locale, contentId, itemId}` where
`itemId === placementId`, or `{kind:"dynamic", locale, itemId}` where `itemId === mediaId`
(ADR-0002 §1); the caller states the kind because the two identity spaces share one syntax
and inferring it would let a stale or wrong-container curated reference resolve as dynamic.
It validates the route locale against the configured locales and the identities against
the shared `MAX_ITEM_ID_LENGTH` bound, authorizes a curated request's container through the
public content tree (`getPublicContentRoute(..., "gallery")` — a published Sanity gallery
document alone does not establish a supported public route, and this check runs before the
content source is touched), then dispatches to a mock or Sanity resolver that composes
`publiclyRenderable && enquiryEligible && !privateOnly` (ADR-0002 §3/§4, plus
`dynamicallyDiscoverable` for a dynamic request per ADR-0012 §2, every flag compared strict
`=== true` so a pre-field document fails closed) and returns the stable `mediaId`, the
resolved caption/credit, and — from the private dataset only — the `archiveLocator`, as a
discriminated union whose dynamic arm cannot carry a `placementId`. `enquiryEligible` is a
new opt-in media field (both dataset visibilities); `archiveLocator` gains a 512-char
schema bound restated and pinned in the resolver, which raises `malformed-source` on a
value past it rather than passing it to a later email. The resolved target is
server-consumer-facing — the public gallery result contract carries none of these fields
and a serialization test proves the projection cannot start leaking them. The Sanity
**curated** path is a two-round-trip read (gallery `_id` for `contentId`+`language`, then
`galleryPlacement` scoped by `gallery._ref` so a sibling-language placement sharing the
`placementId` is never picked), explicitly projected, `[0...2]` ambiguity-detected; the
Sanity **dynamic** path fails closed (`dynamic-unsupported`, no query) until AB#58 (the
dynamic query and its result context) and AB#68 (`dynamicallyDiscoverable` in the model)
exist — the mock dynamic path is fully implemented and unit-tested. A classified
content-store failure during resolution surfaces through `classifyEnquiryFailure`: a
`SanityQueryError` (transport) keeps its own retry decision — `source-unavailable`
(retryable) or `source-error` (not) — while any other `Sanity…Error` (a read that
completed and returned a document the adapter refused to trust — content tree, article,
gallery, settings, media) becomes `malformed-source`. `resolveEnquiryTarget` wraps its
whole tree+source operation, and the route re-runs the same classifier over
`getSiteSettings()`/email composition, so a route never answers a raw provider error with
a bare 500 or an `accepted` event with no terminal.
`POST /api/enquiry` (PR2) reuses the contact path rather than restating it: the same
`checkContactRequestHeaders` ahead of the throttle, `readContactSubmission` (now taking an
optional `extraFields` whitelist — the contact route passes none, so its result shape is
unchanged) widened by exactly `kind`/`locale`/`contentId`/`itemId`, the same honeypot rule,
`buildEnquiryEmail` beside `buildContactEmail` in one delivery module, the shared
`jsonNoStore` + `DELIVERY_FAILURE_STATUS`, and one private `writeSubmissionLine` under two
separately-closed wrappers (`logContactEvent` / `logEnquiryEvent`, `event:"enquiry.submission"`).
Its own rate-limiter instance, so an enquiry and a contact message never spend each other's
allowance; its idempotency key is namespaced `enquiry:<submissionId>`. Every resolver
rejection collapses to one generic browser answer — `malformed-request` → 400, the five
identity/authorization rejections → one `404 {reason:"item-unavailable"}` that discloses
nothing, `source-unavailable` → 503 retryable, `source-error`/`malformed-source` → 500 —
while the operational log keeps the specific class. After the `accepted` event, every path
(resolution, settings read, email composition, delivery, an unclassifiable defect →
`internal`) writes exactly one terminal event. `archiveLocator` and the resolved
`mediaId`/caption/credit reach only the owner's email — never a response, never a log line
(route tests assert both).
PR3 adds the visitor-facing surface. The lightbox carries an "Enquire about this
photograph" control — a real `<a>` in the PhotoSwipe top bar whose `href` is the gallery's
own parameter-free path plus `?enquire=<itemId>` for the slide on screen (a stable string
prop, not a callback, so it does not churn the open viewer). ADR-0003 §8's 2026-08-30
amendment makes `?enquire=` a recognized gallery *action state*: a single value in the
shared public-identity grammar (`src/lib/public-identity.ts`, used by both the route parser
and `enquiry-media.ts` so they cannot drift), recognized only on a gallery route and only
with neither `cursor` nor `section` — `enquire` plus either is a 404 with no redirect,
resolved in `resolveLocalePrefixRequest` before the cursor/section refusal checks; an
unrecognized `enquire` is preserved through normalization and otherwise ignored. The view
is a `200` `noindex, follow` server form (`GalleryItemEnquiry`) whose canonical points at
the parameter-free gallery, with no `hreflang` and no sitemap entry; its metadata
short-circuits before any gallery-result read, so a gallery being reordered does not block
it. The form is `EnquiryForm` over a shared `SubmissionForm` extracted from `ContactForm`
(the status machine, honeypot, hydration guard, and error summary are now shared, not
duplicated; the idempotency `submissionId` is bound to message + endpoint + a discriminated
enquiry context, and the server page keys the form by `itemId` so a new `?enquire=` URL
starts fresh). It reuses the deployment-authored `SiteSettings.contact.privacyNotice` and
adds one generic line (`labels.enquiry.itemContextNotice`) that a reference to the
photograph travels with the message. `e2e/gallery-enquiry.spec.ts` walks the journey
(lightbox → second slide → Enter-key and click activation → the `?enquire=` form →
delivery, a `delivery-failure.test` failure + retry, a not-`enquiryEligible` item's
accessible refusal, a malformed `?enquire=` ignored, and `?enquire=`+`cursor=` → 404) and
asserts the `noindex`/gallery-canonical/absent-`hreflang` metadata.
No dynamic-result entry point (AB#58/AB#71 own the dynamic query and its UI); AB#60 stays
open until a real dynamic result can be wired in or its acceptance criteria are amended.
The identity/origin smoke is built (AB#123): `e2e/enquiry-identity.spec.ts` is a
production-build Playwright suite that proves the whole chain is *wired and enforced* when
the app really runs — the browser-driven curated journey sends exactly the public context
(`kind`/`locale`/`contentId`/`itemId`, nothing resolved or private) and gets back only the
generic receipt, the enquiry view reuses the contact privacy notice, and a direct request
to the running endpoint covers the dynamic origin that has no UI (a dynamic reference
resolves; a dynamic request carrying a container is a `malformed-body`; an unknown
occurrence collapses to the one generic `404 item-unavailable`; the reused cross-origin and
content-type guards still hold). The resolution *semantics* it complements — which trusted
`mediaId` a reference resolves to, context preservation, no invented placement, every
tampered/unknown/private/unpublished/non-enquirable class — are already proven against the
real mock content source by `src/lib/enquiry-media.test.ts`, the route's generic-answer
collapse and no-leak posture by `route.test.ts`, and `buildEnquiryEmail`'s private
`archiveLocator` handling by `contact-delivery.test.ts`, so the smoke asserts wiring and
the browser-only properties rather than re-deriving the matrix. It joins the Azure
Pipelines gate through `testMatch: "**/*.spec.ts"` — no pipeline change.
Not yet built:
localized static routes and localized authored settings — the contact route is
unprefixed-only for now — story-root listing continuation and progressive in-place append
for category listings (both deferred by ADR-0013) — gallery section controls, URL wiring, and lightbox
integration (AB#115; the section domain model and server-side query themselves are AB#105,
above, whose bounded-query contract AB#134 has since supplied), a **true HTTP 503** for
the seeded gallery `ordering-stale` state *on the detail route* — the `/api/gallery`
endpoint already returns a real 503, but PR2 serves the detail page as an accessible HTTP
200 + `noindex` because an App Router page render cannot set an arbitrary status (a
follow-up would route the gallery detail through a handler; tracked with AB#132) — and its
`shuffledOrderGeneration` atomic-flip alternative to the brief recompute refusal window
(a documented ADR-0009 migration trigger, not built), the dynamic keyword-driven gallery
and archive search itself (ADR-0012 decides the query/cursor/route contract; AB#58/AB#71
build it), lightbox zoom tuning, and the dynamic-result enquiry entry point (AB#58/AB#71).
Private client galleries are **partially built**: a link can now be opened and exchanged
for a session, but only against a development fixture store — a real deployment still
serves nothing. Their security,
delivery, proof-selection, and retention boundary is
[ADR-0014](docs/adr/0014-private-gallery-security-delivery-retention-boundary.md)
(AB#122, **Accepted**): a structural public/private isolation boundary, a
fragment-capability link exchanged for a server session, two-stage per-asset
authorization with direct short-lived signed object-store URLs (never a private byte
through a Function), an S3-compatible object store plus a separate PostgreSQL-family
private store, and a worker-authoritative six-month retention lifecycle. The one
canonical-rule change it makes is a scoped exception to "Public derivatives only" above,
for an authorized gallery-link/session holder — restoring the `private or
sales/fulfilment` clause that exception must not weaken. AB#29 (delivery + ZIP) builds on
it in slices and stays **Active**; **AB#145** (administration and customer notification,
split out of AB#29 on 2026-09-02) and AB#130 (proof selection) have not started.

Built so far, all of it behind `PRIVATE_GALLERY_STORE=off` (the default) with **no store
adapter and no provisioned infrastructure**, so an `enabled` deployment throws on the
first request that needs a store rather than half-serving: the
isolation boundary and validated two-phase configuration, the domain model and its
nine-state machine, and the `privateOnly` fail-closed guard on every public projection
(#101); the reserved route namespace's response hygiene in `src/proxy.ts` — `no-store`,
`noindex, nofollow`, `Referrer-Policy: no-referrer` — plus `robots.txt`'s `Disallow` (#102);
the AES-256-GCM capability envelope with its canonical associated data and rotation
primitives (#103); the session model and its per-gallery-path `__Secure-` cookie contract
(#104); and the capability exchange's two rate-limiting layers, its gallery/capability
lookup, and the constant-time verification of a submitted capability, behind
`src/lib/private-gallery-access.ts` — the one facade a route may import, since it owns an
ordering a route must not reassemble (#105).
The link and its exchange are now routes: the Proxy rewrites the deployment-configured
prefix onto a reserved internal segment (`/private-gallery`, `request-path.ts`) so a
file-system route can serve a configurable public path, and refuses a direct request to
that segment. **Next.js runs the Proxy again on the path it rewrote to** — measured
against a production build, not assumed — so the internal branch tells its own second pass
apart from a stranger by the request path the first pass carried, and answers it with a
`next()` rather than a second rewrite, because only a `next()` response's headers replace
`next.config.ts`'s site-wide `Referrer-Policy` (a `rewrite()`'s do not, which silently cost
§6's `no-referrer` until `e2e/private-route-hygiene.spec.ts` caught it). That header check
is namespace hygiene, not authorization: it keeps a second URL shape away from crawlers and
links, and a forged header reaches only a page that looks nothing up and an exchange that
still demands the real capability. The bootstrap document renders identically for every
well-formed handle and **looks nothing up**, because the capability is in the fragment and
a browser never sends one; `public/private-gallery-bootstrap.js` (an external same-origin
file, so no new inline-script grant) reads it, strips it from the address bar with
`replaceState`, and posts it to `POST <prefix>/<handle>/exchange`, which answers a session
cookie or **one indistinguishable 403** for every failure class — same status, same body,
no `Retry-After` — so nothing separates an unknown handle from a throttled known one.
`PRIVATE_GALLERY_STORE=memory` is a development-only fixture store (accepted only where
`SITE_DEPLOYMENT_STAGE` is `development` — preview is refused as well as production, since
it is a shared environment standing in for production) whose published, non-secret link is what the
Playwright journey and a local `npm run dev` actually exercise; it seals that fixture under
an ephemeral per-process key and never reads the deployment keyring.
That same address then serves a second document: with a session cookie that currently
authorizes *this* gallery it renders the gallery itself, and ADR-0014 §5 Stage 1 is
re-derived on **every** request from the cookie plus a fresh gallery read, so a revoke or a
closed access window takes effect on the next navigation rather than whenever the session
would have run out. The gallery is read by the **session's own `galleryId`**, never by the
handle in the URL: a `findGalleryByHandle` would be an unauthenticated lookup primitive
over a caller-supplied string, so the requested handle is instead compared against what the
session already named. Every unauthorized outcome — no session, an expired one, a
superseded capability generation, a session belonging to another gallery — renders the same
bootstrap document, so the page is no more of an existence oracle than the exchange is. The
authorized view is deliberately thin: it names the access window and says the photographs
are not viewable yet, because §5 Stage 2's per-asset signed URLs need the object store that
does not exist; an empty grid would claim the gallery had been delivered and found empty.
Building it surfaced a defect in the fixture store that a single-process assumption had
hidden: **Next.js compiles each route into its own server bundle, so a module imported by
both the exchange Route Handler and the page is instantiated twice under one `next start`**
— measured with a construction probe against a production build — which gave the two routes
two different fixtures and made a session minted by one invisible to the other. The
singleton is now pinned to `globalThis`, the pattern Next.js documents for a
development-only client; the Postgres adapter keeps its state in Postgres and never had the
problem.
The six-month lifecycle's *rules* are built too, as pure policy over the state machine
(`src/lib/private-gallery-retention.ts`), the same split the exchange rate limiter already
uses: `computePrivateGalleryAccessExpiry` adds six to the **UTC** month and clamps to the
target month's last day with the time of day preserved — calendar months rather than 180
days, because "six months" is what a photographer tells a customer, and the ADR's own
worked examples are golden vectors; `evaluatePrivateGalleryRetention` decides what one
scheduled run does with one gallery (an abandoned preparation, a reached access expiry, a
revoked gallery never replaced, cleanup due, a failed deletion retried until a human
acknowledges it), refusing to treat a **missing** retention timestamp as an unreached
deadline, because one corrupt row would otherwise keep private objects alive indefinitely.
Every proposed transition is checked against the state machine, so this module cannot
invent an edge; nothing here ever proposes a way back to `published` (§7's deletion guard).
The 275-day backstop bucket age is pinned to the parts it is derived from — preparation +
the longest six-calendar-month span (184 days) + suspension + deletion grace + a day — so
lowering a window without revisiting the rule fails a test, and
`assertPrivateGalleryRetentionWindows` makes "a deployment may lower a window but never
raise one" executable rather than advisory. The development fixture publishes through the
real clock rather than an approximation. **The worker that performs the IO is not built** —
ADR-0014 names it as its own action item and it needs both stores; its schedule (at least
every 24 hours) and the backstop lifecycle policy are in `docs/deployment.md` so they can
be provisioned with everything else.
ADR-0014 §5 **Stage 2's decision** is built as pure policy too
(`src/lib/private-gallery-delivery.ts`) — everything that happens before a signature,
which is where the security is: a signer handed the wrong key or an unbounded expiry is
correct and useless. `PrivateGalleryMintRequest` has **no object-key field**, so a caller
names a `placementId` this deployment minted or nothing at all for the gallery's one ZIP,
and the key comes back from the store row — the type is what stops the endpoint being an
IDOR probe or a signing oracle, rather than a validation someone must remember. Stage 1's
state and generation are re-checked rather than inherited, because minting is the step
that hands out bytes and a gallery can leave `published` between a page render and a click
on the download control; a placement or ZIP row belonging to another gallery is refused,
and a ZIP is only ever signed against `activeZipObjectKey` (§8c makes the pointer the sole
answer to "which version is current"). `computePrivateGallerySignedUrlTtlSeconds` is
`min(configuredTTL, accessExpiresAt − now)` floored to seconds, with per-kind ceilings —
single-digit minutes for a preview, six hours for the ZIP — that a deployment may shorten
and never lengthen, since the TTL is exactly what a leaked URL is worth. §8e's per-gallery
access budget (10× the gallery's own bytes, charged at full nominal size on every mint,
keyed by gallery **and** capability generation so re-exchanging does not reset it) is a
counter evaluator of the same shape as the exchange's, consulted only after every free
check has passed so an unauthorized request cannot spend a gallery's allowance; a corrupt
row throws rather than resetting, the one direction a budget must not fail. The window is
**fixed rather than rolling**, which ADR-0014 §8e's 2026-09-02 amendment now says outright
after this slice found the table and the design disagreeing: one persisted counter row
cannot express a rolling window (that needs every mint's timestamp — a thousand rows per
browse of a 1 000-file gallery, summed on every image load), so up to twice the allowance
can be spent across a boundary. Accepted because the budget counts *authorizations, not
delivered bytes* — a replayed URL costs nothing and `Range` is invisible — so precision was
never available where it would matter; a two-counter sliding approximation (~1.1×) is the
recorded upgrade path if Fair Transfer pressure ever makes the burst shape matter.
What a private item may *be*, once it crosses into a browser payload, is fixed too
(`src/lib/private-gallery-item.ts`) — the private counterpart of `projectPublicMedia`, for
the same reason: a store row carries more than a page may render, and the safe subset is
produced by one function rather than remembered at each call site. A `PrivateGalleryItem`
has **no `objectKey`** (a page holding one could ask for a signature by naming it, the
exact request shape the delivery boundary refuses), no `galleryId`, and no `nominalBytes`;
it is built field by field rather than by spreading the row, so a column added later
cannot reach a payload by merely existing. The placement gained its **true intrinsic
`width`/`height`**, which the model lacked entirely — without them `AGENTS.md`'s no-crop
rule is not expressible at all, since a layout that does not know a photograph's shape can
only guess it, and guessing is cropping. §8e's derivative ceilings (2 048 px longest edge,
tied to `MAX_PUBLIC_DELIVERY_DIMENSION` so a private preview cannot quietly out-resolve a
public one, and 8 MB) are enforced again at read time rather than trusted from the upload
tool, and an oversized derivative is **refused, never downscaled on the fly** — that would
be a crop-shaped decision made by the wrong layer. A malformed row throws rather than
being skipped, because a skipped item silently shortens a customer's gallery and nobody
would know a delivered photograph is missing; a page over the 100-item bound is refused
rather than truncated, and two placements sharing an identifier are a defect.
The authorized view now renders those items as a **grid of reserved frames**
(`src/components/private-gallery-grid.tsx`): row-major, one to three columns,
top-aligned, each frame at its own native ratio via an inline `aspect-ratio` built from
the derivative's true pixels — per-item data Tailwind cannot generate a class for, and
rounding every photograph to the nearest available class would be cropping by another
name. The frames hold **no bytes**: §5 Stage 2's signed preview URLs need the object
store that is not provisioned, so what exists is the geometry, and the `<img>` a later
slice drops in cannot reflow the page. The page says that in words, because a grid of
empty boxes would otherwise read as "your gallery is empty" — a different and alarming
claim that has its own separate wording. `e2e/private-gallery-link.spec.ts` measures the
laid-out box of every frame in a real browser against the ratio the fixture declares, and
asserts the fixture's shapes genuinely differ (landscape, portrait, square, panorama), so
a cropping grid could actually fail it; a second case proves no object key reaches the
document, RSC payload included. The item read happens strictly **after** authorization —
an unauthorized request never reaches a placement row — and a projection or store defect
falls back to the unauthorized document rather than rendering a gallery quietly missing
photographs.
Objects now have an assigned shape (`src/lib/private-gallery-object-key.ts`):
`<keyPrefix>/g/<galleryId>/<preview|proof|zip>/<128-bit CSPRNG token>`. The token is not a
counter, which is what makes the runtime credential's deliberate *absence* of `ListBucket`
meaningful — sequential keys would make reading one object imply reading the gallery. A key
carries nothing about the customer or the photograph (no name, no filename, no capture
date, no gallery handle): it is not browser-facing, but it is visible to anyone who can
list the bucket and to the provider's own tooling. Every part is validated before it is
joined, so an "opaque" gallery id carrying a separator or a dot cannot place an object
outside the prefix that all three credentials and the backstop lifecycle rule are scoped
to, and `isPrivateGalleryObjectKeyInPrefix` checks a stored key segment-wise on the way
back out, so `photos-private/…` never passes as being inside `photos`. The key layout is
now in `docs/deployment.md`'s runbook, because the IAM policies cannot be written against a
guess.
The bounded **upload preparation** (`src/lib/private-gallery-upload.ts`) is §8c's answer to
an object store and a database that cannot share a transaction: the database always knows
first. `openPrivateGalleryUploadPreparation` validates a declared manifest against §8e's
ceilings — file count, per-derivative pixels and bytes, one ZIP at most, and the gallery
total — assigns one immutable key per entry, and returns a plan with the 30-day deadline;
the administrator boundary commits it and moves the gallery to `preparing` **before** the
CLI writes a byte, so the retention worker always has an enclosing preparation to reconcile.
An object written without one would be invisible to cleanup and would survive until the
275-day backstop. A bad entry refuses the *whole* manifest, since a partial plan would put
keys in the database for objects the CLI was never told to write. Sizes here are
*declared*, not measured: the completion step re-checks the real object with a metadata
read, because a declaration is a claim and the bucket is the fact — checking only at
completion would mean writing gigabytes before refusing, and checking only at planning
would trust the client.
**Completion** closes that loop (`src/lib/private-gallery-upload-completion.ts`): it
reconciles three independent accounts of the same objects — the plan the server assigned,
the receipts the CLI reports, and metadata-only reads of those exact keys — and **only the
third is evidence**. A receipt is a claim, carried solely so a checksum the store cannot
compute for us has somewhere to travel; it never proves an object exists or is the right
size. An object at a key the plan never assigned fails the completion, because nothing
vouches for it and it would sit in the bucket uncovered by any manifest. One bad object
fails the whole thing: a half-verified gallery is one a customer could be shown with
photographs missing, and the failure list is bounded so a bad run cannot flood an
administrator's status. **An ETag is never accepted as a content hash** — §8c says so, and
it is the one plausible shortcut that would be wrong, since a multipart ETag is a digest of
part digests, so comparing it against a hash of the file fails for correct data and
*sometimes passes*, which is worse than always failing. Which checksum algorithm a
deployment uses stays the provisioning-time decision §8c defers: the comparison is
algorithm-agnostic and refuses two differently-named digests rather than guessing. On
success the outcome names the ZIP pointer swap and, when it supersedes one, how long the
predecessor must be retained — the longest a ZIP URL can live plus a clock-skew margin
(this slice's hour, not an ADR number), because without it a regeneration would break an
in-flight download or `Range` resume minted against the old immutable key.
Everything else is unbuilt: the signer itself, the ZIP generation, the owner-run upload
CLI, the retention worker's IO, and the concrete object-store/Postgres providers with their
live provisioning gate (the owner-run runbook for those two services
is in `docs/deployment.md`). **Administration — creating a gallery, publishing it, the
customer notification with its delivery state and resend, and revoking or replacing
access — split out of AB#29 into AB#145 on 2026-09-02** and has not started.
Validated JSON-LD structured data (AB#86) is built: `src/lib/structured-data.ts` is a pure
builder + `</script>`-safe serializer (`<`, `>`, `&`, U+2028, U+2029 escaped — `JSON.stringify`
alone does not, per Next.js's own guidance) rendered through the `<JsonLd>` server component.
The supported set is core only, owner-decided at refinement: `WebSite` + `Organization` on the
home/site root, `Service` on a service detail route, `Article` on the `article` content variant's
canonical detail route. Nothing is emitted on a gallery detail, a category branch, the story
root, the `/services` listing, `/contact`, or any `?cursor=` / `?section=` continuation. Every
value is an explicitly modelled `SiteSettings`, `Service`, or `ContentPage` field or a
deployment-config value: `Organization.name` is `siteName` and `sameAs` is the configured social
links, but no `logo`, `contactPoint`, `provider`, `author`, `publisher`, `offers`, or address
entity is synthesized, and an absent optional field omits its property rather than emitting a
placeholder. Route URLs and asset URLs share `page-metadata.ts`'s rules through the new
`canonical-url.ts` (`canonicalRouteUrl` applies ADR-0003's no-trailing-slash shape and must be
origin-absolute against the canonical base; `absoluteAssetUrl` resolves a relative rendition and
preserves an already-absolute public CDN derivative). The AC5 external-validator check is manual
(CI reaches no external service); the representative builder outputs are the snapshot fixtures in
`structured-data.test.ts`, and `e2e/structured-data.spec.ts` proves the per-route inclusion and
exclusion wiring against a production build.
The AB#65 spike that informs the keyword-taxonomy ADR (AB#55) and ADR-0012's own open
questions has its **tooling** built — a deterministic ~8000-media synthetic fixture corpus
(`scripts/keyword-benchmark-fixtures.mts`, entirely non-personal, validated), the three
ancestor-strategy GROQ builders and an in-memory equivalence oracle
(`scripts/keyword-benchmark-queries.mts`), the analytical models for ADR-0012 §3's
selection-collapse, §6's cache cardinality (collapse-aware antichain count, not just
`Σ C(V,k)`) and invalidation fan-out, and hierarchy-move write amplification
(`scripts/keyword-benchmark-model.mts`), a measurement-capable read-only transport that the
shipped one could not provide — endpoint (API vs API-CDN) selection, server `ms`, payload
bytes, cache headers (`scripts/keyword-benchmark-http.mts`) — the full measurement matrix and
its Markdown renderer (`scripts/keyword-benchmark-plan.mts`), and an owner-run orchestrator
(`npm run benchmark:keywords -- plan|seed|run|move|clean`, `scripts/keyword-benchmark.mts`)
that seeds a **dedicated disposable** dataset, runs a strategy × shape × endpoint matrix with
a GROQ-vs-JS ordering correctness gate (ADR-0012 §9), and performs one reverting hierarchy
move with query-visibility-lag timing (AC7). **The live measurement was run** (2026-08-27,
against a throwaway Sanity project seeded and torn down; results and reasoning in
`docs/keyword-query-benchmark.md`). It **reversed the pre-run hypothesis**: `media-expansion`
(ancestor closure materialized on the medium) is the fastest read at every shape (~1.7–2.4×
faster than the keyword-side join strategies, and the only one whose paginated walk is one
request per page), so the recommendation to AB#55 is **strategy B**, accepting the
expensive-but-rare hierarchy move (moving the broad root rewrote 3541 media docs: ~15 s to
re-sync, ~45 s to revert) rather than paying a join on every visitor request. The
GROQ-vs-JS keyset ordering agreed on every walk including the sub-second `capturedAt` pairs,
so ADR-0012 §9's risk did not materialise. 3 of 4 hierarchy-move cells were measured live;
`deep`×strategyB is modelled (its re-sync probe needed a fix, landed after the run). AB#65
stays Active until this write-up is reviewed and merged.
Tagged caching and webhook revalidation (AB#83) are built — see the large paragraph earlier
in this file and `docs/cache-revalidation.md`. Its previously outstanding "Deployed
verification gate" is now complete: on 2026-08-26 a revision-guarded Preview publish and
its revision-guarded restoration each produced an accepted signed webhook, a
`REVALIDATED` response with a new ETag on the current route-wired Preview deployment, and
seven further `HIT` responses that all carried the one current value. The webhook ran on
an older Preview deployment while the reads ran against the newer one, directly proving
that invalidation was not confined to one warm process or deployment. A raw-perspective
audit confirmed the original seed value was restored and no draft or test marker remained.
AB#83 can close when this evidence is reviewed and merged; the item remains Active until
then.
The deployment itself: AB#116 is **closed** — the Preview environment is fully provisioned
and proven working by a real, verified, fully-automated pipeline run (build 144, `main`,
2026-08-24). `DeployPreview` built, deployed to Preview, bound the deployment identity to
the expected project/team, and verified both access protection (a 302 redirect to
`vercel.com/sso-api`) and non-indexability (`X-Robots-Tag: noindex`) against a live URL.
Three root causes were found and fixed only by actually running this, not by code review:
`vercel deploy`/`vercel build` needed an explicit `--target=preview`, since a project's
first-ever deployment is otherwise assigned to production regardless of the omitted
`--prod` flag; a TypeScript parameter-property in `scripts/vercel-preview-api.mts` crashed
under Node's native type stripping (vitest's transpiler tolerated it, so this was invisible
until the script ran for real); and the Vercel project's own Framework Preset was "Other"
instead of "Next.js," which made every deployment serve only a fallback 404 regardless of
the two code fixes — corrected directly on the Vercel project, no code involved. The
verification script's access-protection check was also wrong in its own right (assumed a
bare `401`; Vercel Authentication actually redirects) and is fixed to bind to the specific
redirect target rather than accepting any redirect status, preserving the original
deliberate refusal to treat an ambiguous redirect as proof. Production promotion (AB#18)
and exercised rollback and handoff (AB#118) are later stories, now unblocked rather than
waiting on provisioning. Legacy URL redirects (AB#19) are partially built —
see above — with 238 of 415 distinct crawled paths still pending real content
migration (including `component/komento/*` and `sivustokartta/*`).
The production security and privacy launch review itself (AB#117) is built: security
response headers (CSP, HSTS-adjacent, framing, MIME-sniffing, referrer, permissions —
ADR-0011, `docs/security-privacy-review.md`), a dependency-vulnerability remediation
(`npm audit fix`, 6 high-severity findings to 0), and the review document walking all
8 acceptance criteria against evidence. Two criteria were only partly closeable at the
time of that review: AC3's live Vercel/Resend account verification and AC5's live Sanity
asset-store audit both named the same AB#116 gap now closed above. `docs/security-privacy-review.md`
and `docs/contact-data-flow.md` were re-checked on 2026-08-25 against the now-live
Preview infrastructure (AB#116's closed Vercel deployment, AB#83's Preview Sanity
wiring), and each carried-forward item split rather than closed outright, in different
ways for the two accounts. Vercel: partially run, not just re-scoped — an earlier draft
wrongly claimed this session had no Vercel CLI/API access; corrected after actually
checking, since the repository-pinned CLI is already authenticated on this machine.
Team membership checked live: one member, `OWNER` role, so "limit seats" is trivially
satisfied for the environment that exists today. That check surfaced a real finding —
the team's `billing.plan` reads `"hobby"`, not the `"pro"` ADR-0004 §1 and every
deployment doc assume for Production. **This closes a Preview-account inspection, not
a Production hosting-tier decision.** The owner's decision, 2026-08-25: Hobby remains
in use for development and Preview; no decision has been made to use Hobby for
Production, and the Production tier is unresolved, to be reconsidered immediately
before AB#18. ADR-0004's original Decision (Pro) remains the authoritative Production
plan for now — this re-check does not change it and does not grant a Hobby exception
for Production. (An earlier draft of this paragraph stated the opposite — a settled
decision to keep the whole reference deployment on Hobby, matching Vercel's
non-commercial fair-use terms; that was wrong and was corrected at the owner's
direction before any of it was committed.) PhotoSite Starter as software is
unaffected either way — the starter remains the same generic, commercial-capable
template it always was, and a photographer's clone actually run as a paid business
still needs Pro or Enterprise, unchanged. Recorded as
[ADR-0004](docs/adr/0004-reference-production-host-and-ownership-boundary.md)'s
2026-08-25 amendment (which also records the verified Preview facts — Hobby's Runtime
Logs retention is one hour, not the one-day Pro figure this ADR states for Production;
Hobby has no RBAC at all — without rewriting the ADR's original Decision) and as
comments on AB#117 and AB#18, including a correction of the earlier overstated
framing. **That correction is not scoped to a future Production choice: the
interpretation risk applies to the current Hobby-on-Preview usage too**, since
Vercel's fair-use rule turns on the deployment's purpose, not its Preview/Production
label — "no live Production deployment yet" does not by itself settle it, given this
repository's dual purpose as a professional software portfolio. The owner accepts this
as an open risk for as long as Hobby remains in use, not proof of Vercel
Terms-of-Service compliance. Vercel Support's explicit confirmation would give
certainty for Preview too, and becomes mandatory specifically **if Hobby is later
proposed for Production** (one of two options AB#18 will choose between; not decided).
**If Pro is chosen for Production instead** — this ADR's original Decision — that half
of the analysis becomes moot for Production, though it does not retroactively resolve
whatever period this team spent on Hobby beforehand.

Sanity: this one was actually run too, not just re-scoped. Two earlier drafts of this
re-check wrongly claimed the identifiers couldn't be retrieved — first blaming a
missing credential (wrong: `preview` is public, no token needed), then blaming the
Azure Pipelines variable group (wrong system: `docs/deployment.md` puts these in the
Vercel project's Preview environment). Both were corrected by actually checking:
`.vercel/.env.preview.local`, a gitignored file already on disk from AB#83's own
provisioning work, carries the real values (project id and dataset `preview`,
public — the project id itself stays out of this repository per
`docs/sanity-setup.md`'s ownership boundary, the same as every other Sanity credential;
it is recorded against AB#83 in Azure Boards). The first live,
unauthenticated query (2026-08-25) found exactly one published document,
AB#83's own `webhook-test-1` webhook-verification artifact, and zero
published image/file assets. **A prior draft of
this same paragraph claimed adding `perspective=raw` "confirmed" no draft exists in
this dataset — wrong, retracted after checking Sanity's own access-control
documentation directly**: dataset public visibility grants unauthenticated read access
only to root-level, non-dotted document IDs; a `drafts.<id>` document is hidden from an
unauthorized client regardless of dataset visibility or perspective, so this session's
read cannot rule drafts in or out. What it could show — no published document beyond
`webhook-test-1`, no published asset — was genuinely clean, and separately, that one
document was not harmless: its null `slug` would make `sanity-services.ts` throw for
the whole services listing the moment a route read Sanity services against this
dataset. The owner deleted it on 2026-08-25; a second unauthenticated `GET` through
Sanity's non-CDN API returned a successful canary, `null` for the exact id, and zero
published root documents. The draft check is now closed: a later authenticated
raw-perspective query (2026-08-25, same day) found zero `drafts.*` documents, with the
dataset's only rows being Sanity's own internal `system.group`/`system.retention`
records rather than customer or seed content. A further evidence check also
corrected the earlier claim that AB#84's 448-document seed run had landed in an
unidentified dataset: PR #62 explicitly says its write-enabled CLI was not run against
an external dataset, and no later owner run is durably recorded. The owner accepted the
finding on 2026-08-25 and reopened AB#84 to **Active**; it remains there until the
external owner-run target and verification are evidenced or its acceptance criteria are
explicitly amended and accepted. That run happened the same day, against this same
Preview project and dataset: a temporary, Editor-role `SANITY_SEED_TOKEN`, minted by the
owner for this run only and revoked immediately after, drove `npm run seed:sanity -- --yes`
to write exactly 448 `seed--` documents and upload the 6 demo-photograph assets, and
all 8 of the script's built-in live-verification checks — both singletons, the
category/service/article
counts, the archive gallery's full 400-row placement window, the featured gallery's two
sections, and the cross-gallery shared-media placement — reported `PASS`. A follow-up
count confirmed no unrelated or malformed document remained: every non-`seed--`
document in the dataset was either a Sanity-internal `system.*` record or one of the
six expected image assets. AC5's audit now has a real, evidenced target — this Preview
run, recorded on AB#84 — though AB#84 itself stays open until the owner reviews and
accepts it; `docs/sanity-seeding.md`'s new *Production handoff* section is this run's
distillation into the exact command, inputs, verification, and rollback path the later
Production launch seed inherits. A codex-review-loop round on that handoff caught a real
gap the run's own two verification layers left open: AC3 requires *representative
repository adapter queries* against Content Lake, and neither the offline adapter test
(which fakes the store) nor the seed script's own `--yes` step (hand-written GROQ, not
adapter code) actually is that. `src/lib/sanity-live-verification.test.ts`
(`npm run verify:sanity-live`) closes it: a third, opt-in, non-`npm test` suite that
exercises the real `src/lib/sanity-*.ts` adapters — settings, home, services,
categories/content tree, articles in every language they were actually published,
gallery sections, media projection, sibling and placement ordering, and the full curated
gallery's cursor chain page by page including the page-size boundary — against the same
live Preview dataset, using a real `SanityClient` and the existing Vitest `server-only`
stub, and all of it passed. It was Preview-only as built (a hardcoded read of
`.vercel/.env.preview.local`) and, like every other Sanity adapter test, reaches no route
or component. AB#138 (2026-08-26) closed a prerequisite gap this section's own
"unimplemented future work" once named for AB#137: `verify:sanity-live` now resolves its
target env file through `src/lib/sanity-live-verification-config.ts`, defaulting to the
same Preview file but overridable via `SANITY_LIVE_VERIFICATION_ENV_FILE`, and refuses to
assemble a hybrid target from an incomplete file plus ambient environment variables. It
remains a fixture-verification suite, not a generic health check — its assertions are
still AB#84's exact fixture values, so it only proves anything against a dataset seeded
with that same fixture, Production included. For a Production dataset carrying different,
owner-approved launch content, AB#138 also added a separate read-only content audit tool
(`npm run audit:sanity`, `scripts/audit-sanity-content.mts` and `scripts/sanity-audit.mts`,
transport in the newly split-out `scripts/sanity-read-http.mts`) that makes no assumption
about specific content: one bounded, keyset-paginated, `raw`-perspective scan over the
whole dataset, classifying every document as published, draft, or a release version by id
shape rather than a known-type allow-list (so an unexpected or obsolete document is
listed, not silently omitted), listing every document and every image/file asset
individually by id — a count alone cannot answer "is any of this actually approved
launch content?" — with each asset's dimensions, and reporting only the *presence* of the
two fields it treats as private/internal (`archiveLocator`, `capturedAt`) — never a value,
matching the same never-log-sensitive-values posture the rest of this project's Sanity
boundary already holds. The asset-filename and private-field checks are scoped to their
real types (`sanity.imageAsset`/`sanity.fileAsset`, `media`), so a coincidentally
same-named field on an unrelated type is never misreported as one of them, while the
unfiltered per-type scan still surfaces that type either way. It fails closed on missing or ambiguous `--project`/`--dataset`/`--api-version`
configuration (flag and environment variable disagreeing is refused rather than guessed),
needs only a Viewer-role `SANITY_AUDIT_TOKEN` (verified against Sanity's own documentation:
reading drafts and releases requires authentication but no stronger role), and both new
offline suites (`scripts/sanity-audit.test.mts`,
`src/lib/sanity-live-verification-config.test.ts`) run under `npm test` against a fake
transport, reaching no live project. AB#138 is scoped entirely to this reusable tooling —
it does not itself connect to, seed, or audit any real Production dataset — and is a
recorded predecessor of AB#137, which still owns the real Production run once a real
customer-owned project, owner-approved launch content, and a temporary credential exist.
The Resend-account items
(DPA, data-residency/retention terms) are unchanged in one sense — this deployment's
own configuration still shows no Resend account wired in, and whether one exists at
all is unverified — but their sequencing is no longer
open: **owner decision, 2026-08-25, recorded as a comment on both AB#117 and AB#18:
provisioning the Resend account and completing this ownership/DPA/retention review
is AB#117's own prerequisite work, done before AB#18, not something AB#18's
production provisioning produces.** AB#117's acceptance criteria are not weakened or
deferred by this — AB#117 owns getting the account and running the review, in full;
AB#18's own scope narrows to match, wiring the *already-reviewed* account's secrets
and sending domain into Production and verifying delivery, not provisioning or
reviewing the account itself. The account has not been provisioned yet — that is a
real third-party signup only the site owner can perform, not something this
repository's tooling does — so the item stays open, now with a decided owner rather
than an unresolved circularity. The recipient-mailbox item turned out not to share that blocker on
inspection: Resend is only the delivery transport into a mailbox, not what creates
one, and AB#116's own provisioning record shows the site owner already operates a
real mail service independent of this project — so confirming that mailbox's
retention practice is answerable now, without a Resend account. Do not assume either checklist is
complete because an infrastructure gap closed — read the 2026-08-25 re-check sections
in both documents before treating any of AC3 or AC5 as done.

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
- Brand-sensitive styling (colours, text roles, borders, accent, focus, type families,
  corner scale) goes through the semantic tokens in `src/app/globals.css` —
  `bg-surface`, `text-muted`, `border-border-strong`, `text-danger`, … — never a raw
  `black`/`white`/colour-scale utility or a hand-written `dark:` pair in a component.
  Deliberate photographic treatments (the hero scrim, the lightbox viewer) are the
  documented exception. The full contract and the preset override points are in
  `docs/theme-contract.md`
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
  tool's directory: `architecture` and `security-review` are duplicated into both;
  `codex-review-loop` (`.claude/skills/` only) gives Claude Code an independent Codex
  plan/diff reviewer, while `claude-review-loop` (`.agents/skills/` only) gives Codex the
  mirrored Claude plan/diff reviewer and hands a recurring failed Codex correction to
  Claude to edit directly. Create further skills only for recurring workflows.

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
npm run benchmark:keywords -- plan # AB#65 spike: fixture + query-strategy benchmark (owner-run for the live matrix)
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
| `docs/theme-contract.md` | whoever restyles a clone or builds a theme preset (AB#37) | a semantic design token is added, renamed, or revalued, the light/dark mechanism changes, or a surface moves in or out of the "stays explicit" list |
| `docs/asset-inventory.md` | licensing audit | any third-party asset, font, or shipped dependency is added or removed |
| `docs/contact-data-flow.md` | the site owner, a visitor who asks, and the AB#117 launch review | the contact form's fields, delivery path, processors, logs, or retention change |
| `docs/sanity-setup.md` | the site owner and whoever provisions a clone's CMS | the Sanity connection settings, ownership/transfer story, perspective, schemas, media policy, or failure behavior change |
| `docs/sanity-seeding.md` | the site owner and whoever seeds a clone's sample or first content | the seed script's fixture content, id/idempotency contract, write-token story, verification steps, or go-live cleanup checklist change |
| `sanity/README.md` | whoever wires a clone's Studio to these schemas | a document type is added, or how the Studio consumes them changes |
| `docs/deployment.md` | the site owner and whoever provisions a clone's hosting | the Preview environment, pipeline deployment stage, environment-variable split, runtime pins, or promotion/rollback mechanism change |
| `docs/security-privacy-review.md` | the site owner and future launch reviews | the launch security/privacy review is rerun, a finding's disposition changes, or the security response headers change (also update ADR-0011) |
| `docs/keyword-query-benchmark.md` | AB#55's taxonomy ADR and whoever runs the AB#65 spike | the keyword-query benchmark fixture, harness, or matrix changes, or an owner-run live measurement is completed and its numbers/recommendation are filled in |
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
