# PhotoSite Starter

A modern, clonable photography website template built with Next.js.

## Purpose

PhotoSite Starter is a high-quality photography website foundation designed to serve two roles:

- **A template** that a technically oriented photographer can clone, brand, connect to their own CMS, and deploy on their preferred hosting.
- **A real production site** — the first implementation replaces an existing Joomla 3 photography site.

This is **not** a SaaS or multi-tenant system. Each photographer runs their own clone.

## Core principles

- MVP first — keep the architecture simple, extend only when there is a real need
- Photos are the main content: fast, high-quality, distraction-free galleries
- **Images are never cropped** — thumbnails and previews always preserve the original
  aspect ratio and full frame. A cropped preview misrepresents the photo, and a strong
  image can go unseen because of it; compositions are shown exactly as taken
- Browser-facing images use bounded, versioned web derivatives with their true intrinsic
  dimensions; camera masters and private or sales assets never enter public media data
- Video is a natural companion to photos: the media model must not assume photo-only
  content; playback via self-hosted MP4/WebM or click-to-load embeds (no auto-loading
  third-party players)
- Generic by design: no hardcoded names, brand colors, or contact details in components or schemas — these come from site settings or the CMS
- One gallery core serves the public portfolio, blog mini-galleries, and (later) private client galleries
- Privacy-friendly: no tracking cookies, no cookie banner if avoidable
- Accessibility target: WCAG 2.1 AA (where applicable)

## Tech stack

- [Next.js](https://nextjs.org) (App Router, TypeScript)
- [Tailwind CSS](https://tailwindcss.com) v4
- Headless CMS: [Sanity](https://www.sanity.io) — connection, schemas, and adapters in place
  ([ADR-0006](docs/adr/0006-sanity-data-access-boundary.md)), wired into every route-facing
  seam behind `SITE_CONTENT_SOURCE`; the mock layer remains available outside Production
- GitHub for source code
- Azure DevOps (Boards for project management, Pipelines for CI)

## Project structure

- `src/app` – App Router routes and layouts
- `src/components` – reusable UI components *(added as features land)*
- `src/lib` – shared logic, configuration, data access, and the generic media model
- `scripts` – deployment tooling that runs outside the application bundle
- `sanity/schemas` – the CMS document types, as plain objects a customer's Studio
  consumes; content-store configuration, not application code
- `docs/adr` – architecture decision records ([conventions](docs/adr/README.md))
- `docs/architecture` – [architecture diagrams](docs/architecture/README.md): the system
  context, the application and data boundaries, and the build/deployment flow, as D2
  source with generated SVG

Import alias: `@/*` → `src/*`

New to the codebase? [docs/architecture](docs/architecture/README.md) has three
diagrams — the systems around the site and who owns them, the layers a request crosses
and the imports the build refuses, and the path from a commit to a verified deployment —
each with the prose to go with it. Anything not operating yet is drawn as such.

Working rules for AI coding agents live in [AGENTS.md](AGENTS.md).

## Getting started

Copy `.env.example` to `.env.local`, then set the values for the deployment.
The application fails during development or build if a required value is missing
or invalid.

| Setting | Purpose |
| --- | --- |
| `SITE_LOCALE` | BCP 47 default locale with a concrete language subtag, for the document language and date formatting |
| `SITE_LOCALE_ROUTES` | Public route space per supported locale: `locale\|prefix\|namespace` entries |
| `SITE_CANONICAL_BASE_URL` | Public origin every canonical and Open Graph URL is built from |
| `SITE_DEFAULT_SOCIAL_IMAGE` | Versioned public derivative used as the default social preview |
| `SITE_DEFAULT_SOCIAL_IMAGE_VERSION` | Byte version of that image; required only for a remote URL |
| `SITE_DEFAULT_SOCIAL_IMAGE_WIDTH` | True intrinsic pixel width of that image |
| `SITE_DEFAULT_SOCIAL_IMAGE_HEIGHT` | True intrinsic pixel height of that image |
| `SITE_DEFAULT_SOCIAL_IMAGE_ALT` | Optional alt text for that image; unset emits none |
| `SITE_CONTENT_SOURCE` | Which store authored content comes from: `mock` or `sanity` |

`SITE_CANONICAL_BASE_URL` must be a bare origin. Credentials, a query, or a
fragment would be published in `rel="canonical"` and `og:url`, and a base path
would be dropped when a route path resolves against it, so all four are
rejected at startup rather than repaired.

The default social image crosses the same public media boundary as every other
browser-facing image: a local `/gallery` path carrying its version in the
filename, or an HTTPS URL that contains the version declared in
`SITE_DEFAULT_SOCIAL_IMAGE_VERSION`. Its dimensions are declared rather than
measured, because the file is deployment-owned and nothing in the application
can read its size. Pages that carry a content image of their own use that
image's real rendition dimensions instead.

`SITE_LOCALE_ROUTES` declares where each supported locale's public routes live,
as comma-separated `locale|prefix|namespace` entries. The default locale leaves
the prefix empty because its routes carry none, and must be the locale named by
`SITE_LOCALE`. A single-locale English clone reads `en-GB||stories`; the
bilingual first production deployment reads `fi||tarinat,en|en|stories`. That
assigns the unprefixed route space and `/tarinat/…` namespace to Finnish, and
the `/en` route space and `/en/stories/…` namespace to English. Every configured
prefix is reserved against the root routes the application already owns, and
every story namespace is reserved against static routes inside its locale
space. A redundant
default-locale prefix (`/fi/…`) redirects permanently to the unprefixed route
when that exact route exists; unknown targets remain 404s. Browser language
never redirects a visitor. A locale without a concrete language subtag, such as
`und`, is rejected because it cannot supply the routing contract's default
language prefix.

Each locale's category branches and content pages are served from its own
content tree, together with that tree's recorded path history: a category or a
page that a move or rename retired redirects permanently, in one hop, to its
current path in the same language. A page has exactly one canonical address —
the category listing it also appears in links there rather than to a copy of its
own — and switching language resolves by stable identity, opening the nearest
published page and saying so when it is not an exact translation. A
locale whose content has not been authored yet publishes nothing — its story
routes 404 rather than falling back to another language's tree — and a page in a
locale the authored site description was not written in emits no description at
all rather than that one.

`SITE_LOCALE` does not translate the application-owned UI labels. They live in
`src/lib/deployment-config.ts` as one set per language subtag — English and
Finnish ship — and a clone adds or edits a set there. Every locale in
`SITE_LOCALE_ROUTES` must find one, or the deployment fails at startup rather
than rendering one language's chrome in another.

Authored SiteSettings copy — site name, navigation, footer, contact — is not
localized yet, and the static routes it links to exist only in the unprefixed
space. A prefixed locale therefore renders its pages without that shared chrome:
its category branches carry their own breadcrumbs and language switch instead.
Localized settings and localized static routes are separate stories.

### Contact form delivery

The contact endpoint posts through a project-owned adapter, so the delivery provider is
replaceable and every clone runs its own account — there is no shared credential and no
cross-customer contact database.

```bash
SITE_DEPLOYMENT_STAGE=development   # "development" | "preview" | "production"
CONTACT_DELIVERY_ADAPTER=sink       # "sink" | "resend"
```

`sink` accepts a message and sends nothing: it is what local development, CI, and the
Preview environment run on. It is **refused in a production deployment** — reporting
success while delivering nothing is silent data loss, so the first attempted submission
fails safely instead. `SITE_DEPLOYMENT_STAGE` is what tells it which environment this is,
and an unset value counts as production, so the guard fails closed. `resend` delivers over
Resend's HTTP API and needs three
more settings — `CONTACT_DELIVERY_FROM` (a sender on a domain verified in *your* Resend
account), `CONTACT_DELIVERY_TO` (the mailbox that receives enquiries), and
`RESEND_API_KEY`. The key is read server-side only; it never reaches a `NEXT_PUBLIC_`
variable, a URL, or the client bundle.

There is deliberately no default. A default of `sink` would let a production deployment
discard enquiries silently, and a default of `resend` would fail every developer machine
on a missing credential; an unset value serves the contact page normally and reports the
missing setting when a submission is attempted.

Swapping providers means writing one file next to
[`src/lib/contact-delivery-resend.ts`](src/lib/contact-delivery-resend.ts) and changing
the adapter name. Nothing else in the contact path knows which provider is configured.
What the form collects, who processes it, and how long anything lives is recorded in
[docs/contact-data-flow.md](docs/contact-data-flow.md).

### Content source

Where authored content comes from is declared, never inferred.

```bash
SITE_CONTENT_SOURCE=mock            # "mock" | "sanity"
```

`mock` reads the project's own demo fixtures — placeholder copy and AI-generated
placeholder photographs. It is what local development, CI, and the Playwright harness run
on, and it is **refused in a production deployment**: publishing that material as a
photographer's own work is misrepresentation, not a mode. The setting is validated as part
of the deployment configuration, which every route resolves, so an illegal combination
fails the build rather than a later content read. As with the contact adapter, there is no
default, and an unset `SITE_DEPLOYMENT_STAGE` counts as production, so the guard fails
closed.

`sanity` reads the deployment's own Content Lake through five more settings —
`SANITY_PROJECT_ID`, `SANITY_DATASET`, `SANITY_DATASET_VISIBILITY`,
`SANITY_API_VERSION`, and `SANITY_READ_TOKEN` — the last required whenever the dataset is
declared private, because an unauthenticated read of one answers with an empty result
rather than an error, and a site that looks unwritten is worse than one that refuses to
build. A private reference deployment uses separate read-only build and runtime tokens,
scoped to Azure Pipelines and Vercel respectively. The Sanity organization, project, dataset,
assets, and billing belong to the site owner; there is no shared account and no shared
credential, so handing the site over is a change of settings rather than of code. Every
read asks for the **published** perspective, and no setting can change that — draft access
is absent from the code rather than switched off. A failed read raises with a classified
error; nothing ever falls back to demo content.

Sanity's runtime connection lives in two files. ESLint stops `src/app` and
`src/components` from importing either, and both carry the `server-only` marker so a
Client Component reaching them through an adapter fails the build — provider knowledge and
the read token stay behind the adapter boundary. Setup, ownership, transfer, and failure
behavior are in [docs/sanity-setup.md](docs/sanity-setup.md); the trade-offs are in
[ADR-0006](docs/adr/0006-sanity-data-access-boundary.md).

The document types are separate again, in [`sanity/schemas`](sanity/README.md) — plain
objects that import nothing, so describing a schema costs no dependency and a clone points
its own Studio at them. The shared **media** document is the first one, with a server-only
adapter behind it: one photograph is one document; an uploaded asset must be an exported
web copy within the site's own delivery limit rather than a camera master, checked in the
Studio so the publish is blocked and again at the boundary because the Studio is not the
only writer; a world-readable dataset is offered no field for archive locations at all,
since anything in it is published whether the site reads it or not; and authored text is
keyed by language subtag so adding a language is content rather than code
([ADR-0008](docs/adr/0008-localized-authored-text.md)). The remaining schemas — category,
article, gallery, service, site settings, and home page — and their adapters exist too, and
are wired into every route-facing seam behind `SITE_CONTENT_SOURCE`: a deployment declaring
`sanity` renders this content for real; one declaring `mock` (never allowed in Production)
keeps rendering the fixture layer below.

```bash
npm ci
npm run dev
```

Other scripts:

```bash
npm run lint      # ESLint
npm test          # browser-free TypeScript tests (one run)
npm run build     # production build
npm run test:e2e  # public-journey smoke tests against a production build
npm run diagrams  # regenerate docs/architecture/*.svg from their .d2 sources
npm run diagrams:check  # CI gate: sources compile, committed SVGs are current

npm run verify:preview -- <url> <dpl_id> # assert ownership, protection, and noindex
```

### Hosting

The reference host is Vercel, provisioned in the site owner's own team — see
[ADR-0004](docs/adr/0004-reference-production-host-and-ownership-boundary.md) for why, and
[docs/deployment.md](docs/deployment.md) for the provisioning runbook, the
Preview/Production settings split, and the promotion and rollback mechanism. The
repository pins the function region and the Node major so a clone inherits them; nothing
in it names a team, project, token, or domain.

## Testing

Two layers, with no overlap between them.

**[Vitest](https://vitest.dev)** is the single browser-free runner for deterministic
domain, query, adapter, and server-validation tests. `npm test` runs
`src/**/*.test.ts` and `scripts/**/*.test.mts` in Node and exits after one run. Tests must not depend on a browser,
external network, live CMS or email services, secrets, or production/personal fixture
content.

**[Playwright](https://playwright.dev)** covers what only a browser can prove: public
journeys through a real **production build**. Specs live in `e2e/**/*.spec.ts` and the
harness in `e2e/support/`. Install the browsers once, then run the suite:

```bash
npx playwright install chromium webkit   # add --with-deps on Linux
npm run test:e2e
npx playwright show-report               # after a failure
```

`npm run test:e2e` builds the site and serves it with `next start` on
`http://127.0.0.1:3100` (Playwright starts and stops it), then runs every spec in two
projects: desktop Chromium and mobile WebKit. The suite protects the home page, the site
menu's composition and disclosure behavior, the curated gallery route — its grid's
reading order at every column count, the lightbox, its metadata, its empty state, its
zoom and pan behaviour — click/tap/keyboard magnification with no crop, a
state-announcing zoom control, the caption stepping aside while keeping its accessible
text, bounded pan, and state resetting on slide change and close — its
cursor continuation without JavaScript, its compact continuation page, its in-place
append and lightbox continuation, and the
addresses it refuses — the services routes,
the public content tree — including a category branch listing's `?cursor=` continuation
walked with JavaScript disabled: several pages through the real link with no duplicates or
gaps, the compact continuation page and its self-canonical metadata, the link back to the
first page, and the 404s for a tampered token and one minted for another branch — and
contact submission — including invalid input, delivery failure, and retry; a
route-specific suite joins the gate by landing in `e2e/`. The run
leaves `.next` holding a build made with the harness settings, so run `npm run build`
again before serving your own deployment build locally. Retries, timeouts, browser
matrix, and parallelism are set explicitly in
[playwright.config.ts](playwright.config.ts) rather than left to defaults that differ
between a laptop and a build agent.

The application under test runs on harness-owned settings from
`e2e/support/harness-environment.ts` — a reserved `.test` canonical origin and the
project's own mock content, no credentials — so traces and screenshots retained on
failure can be published without a review of what they might contain. Every request to
an origin other than the site under test is blocked and fails the test, which keeps the
privacy rules honest and is where an external delivery adapter plugs in a test double
instead of reaching a real service. The contact form already uses it: the harness
selects `CONTACT_DELIVERY_ADAPTER=sink`, so the journey exercises the real endpoint,
the real validation, and the real response contract without a credential in the
environment or a synthetic enquiry in a real mailbox. Delivery *failures* are reached
the same way — a reply-to address on the reserved `delivery-failure.test` domain makes
the sink report that class of failure — so the endpoint's classification and the advice
the form gives are exercised end to end rather than stubbed. Each test also arrives from
its own synthetic address, so the endpoint's per-client throttle bounds a real client
instead of the whole browser matrix.

## CI

Azure Pipelines ([azure-pipelines.yml](azure-pipelines.yml)) runs two stages.

**Quality gates** run on every push and pull request to `main`: lint, browser-free tests,
the [architecture diagram](docs/architecture/README.md) check, the production build, and
the Playwright smoke suite. Test results are published on every
run; traces and screenshots are published as a pipeline artifact when the suite fails.

**Preview release candidate** deploys `main` to the site owner's own Vercel project after
those gates pass, verifies that the deployment is access-protected and non-indexable,
repoints a stable protected `*.vercel.app` alias at it so a webhook configured once keeps
working across redeploys (AB#136), and publishes the URL to the run summary. It never runs
for a pull request, and it skips entirely until the hosting is provisioned — so a clone
without a Vercel project still gets a green pipeline. See [deployment](docs/deployment.md).

## MVP scope

- [x] Next.js App Router project setup (TypeScript, Tailwind, `src/`)
- [x] CI pipeline (lint + test + build + production-build smoke tests)
- [x] Responsive base layout with header and footer
- [x] Semantic design tokens and a documented theme contract — *brand-sensitive
  colours, text roles, borders, accent, focus, type, and corners defined once in
  `src/app/globals.css`, explicit light/dark, override points for a future preset in
  [`docs/theme-contract.md`](docs/theme-contract.md)*
- [x] Site and deployment settings (branding, contact, navigation, locale, canonical base URL, default social image, built-in labels)
- [x] Home page
- [x] Services listing and individual service pages
- [x] Shared generic media model (photo and video capable)
- [x] Implementation of the proposed public image rendition boundary
  (ADR-0005 awaits owner approval)
- [x] Blog / article content type (supports long story articles) — *articles are the
  `article` variant of the shared content page and live in the content tree; the
  pre-launch `/blog` scaffold routes are gone. A photograph placed in an article or
  gallery body opens the fullscreen lightbox in its own sequence (AB#147), separate
  from a gallery's curated grid. An article's or curated gallery's explicit cover now
  renders as a full-bleed, fold-safe hero with the title (and, for a gallery, the lead
  description) overlaid (AB#149) — no authored cover, no hero, and no page repeats a
  gallery's own opening photograph by default. An article's optional per-article author
  overrides the site's photographer name on the hero byline, one meta line shared with
  the event date (AB#151); the gallery variant has no byline field*
- [ ] Hierarchical public content tree with category routes, breadcrumbs, and accessible navigation
  — *category domain model, canonical placement contract, the server-rendered category
  branch routes with breadcrumbs, a bounded recent-content overview on the story root,
  deterministic category listings, and permanent redirects
  for retired paths, the canonical article detail route — breadcrumbs, a table of
  contents derived from the body's headings, and publication-ordered sibling navigation —
  and the tree-driven site menu, which composes the configured static links with the
  first two category levels behind an accessible disclosure in both the wide and the
  compact layout, the canonical curated gallery detail route, gallery cursor
  continuation and the in-place gallery append, and — now — category branch listing
  continuation: a large branch pages through a keyset `?cursor=` (self-canonical,
  indexable, no JavaScript required) sharing the gallery cursor's signing secret
  ([ADR-0013](docs/adr/0013-category-listing-continuation-cursor.md)). Story-root listing
  continuation and progressive append for category listings are deferred. An authored
  `eventDate` (defaulting to `publishedAt` when unset) is now the ordering key behind
  category listings, the story-root overview, article sibling navigation, and this same
  cursor, so a photographer publishing out of chronological order still presents in
  real-world order; an optional `endDate` auto-hides a page, read-time-gated, once it
  passes, for both the mock and Sanity paths
  ([ADR-0017](docs/adr/0017-authored-event-date-ordering-key.md), AB#150)*
- [ ] Locale-aware public routing — unprefixed Finnish default routes alongside English
  (`/en/…`), language switching, and `hreflang` metadata
  ([ADR-0003](docs/adr/0003-public-content-tree-and-url-structure.md))
  — *route configuration, prefix reservation, redundant default-prefix normalization,
  per-locale labels and content trees, category branches in every configured locale space
  with `hreflang`/`x-default` links, and the identity-based language switch on those pages
  done; localized static routes and localized authored settings pending*
- [ ] Curated public galleries with shared pagination, fullscreen lightbox, optional sections,
  and optional long-form body content — *shared bounded result contract, the canonical
  gallery route inside the content tree with breadcrumbs, metadata, and a deterministic
  cover, the row-major grid that reads in the gallery's own order at one, two, and three
  columns, the fullscreen lightbox (open, close, navigate, caption and credit)
  ([ADR-0001](docs/adr/0001-lightbox-library.md)), and server-rendered cursor
  continuation — a real `href` that pages through a large gallery with no JavaScript —
  and the in-place append — the same link enhanced to bring the next slice into the
  page, with the lightbox continuing past the items it was opened from — and an
  optional lead and long-form body sharing the article variant's own block set and
  content-derived page-jump navigation (AB#106), and click/tap/keyboard zoom with
  bounded pan, a state-announcing zoom control, and a caption that steps aside while
  zoomed (AB#78), and an optional per-gallery seeded-random ordering rule — a
  deterministic shuffle with pinned leads, materialized once rather than rolled per
  request, so the grid, every continuation page, and the lightbox share one order and a
  reseed retires an in-flight cursor as `wrong-scope` (AB#129, [ADR-0009](docs/adr/0009-seeded-random-gallery-ordering.md))
  — done for both the mock and Sanity sources; on Sanity, rotation is a two-step
  administrator operation (edit the seed, then `npm run recompute:shuffled-order`) and the
  gallery serves an accessible "being reordered" state in between — HTTP 200 + `noindex` on
  the detail page, a real 503 from the continuation endpoint. Named section controls are
  URL-driven and keyboard-operable, restoring the selected section across reload, shared
  link, and browser history, with the grid and lightbox reading the same filtered ordered
  set (AB#115). Zoom animation and level tuning remain, as does one physical-device
  pinch/pan check that ADR-0001 records as an outstanding gap*
- [x] Contact form — *accessible `/contact` page and bounded `POST /api/contact`
  handler, a replaceable delivery adapter (Resend over its HTTP API, plus a sink adapter
  for development, CI, and Preview), abuse controls, and operational events carrying no
  personal data ([data flow](docs/contact-data-flow.md)), covered by a public-journey
  suite over validation, success, delivery failure, and retry; the gallery-item enquiry
  (AB#60) is a separate story*
- [ ] Basic SEO (metadata, sitemap, robots.txt) — *settings-driven titles, descriptions,
  canonical URLs, and Open Graph output done for every current public page; `sitemap.xml`
  and `robots.txt` done (AB#85) — every published, public, indexable category, article,
  gallery, service, and static page listed exactly once, parameter-free only (no cursor or
  section URLs), deterministic and absolute from deployment settings, refreshed on every
  request rather than frozen at build time; validated JSON-LD structured data done
  (AB#86) — `WebSite` + `Organization` on the site root, `Service` on a service detail,
  `Article` on an article detail, nothing on gallery, category, listing, or continuation
  routes; every value from typed settings or content, optional properties omitted rather
  than fabricated, and `</script>`-safe serialization*
- [ ] CMS integration (Sanity) — *mock data layer in place under `src/lib`; validated
  customer-owned connection, published-perspective query client, and the enforced
  data-access boundary done ([setup](docs/sanity-setup.md),
  [ADR-0006](docs/adr/0006-sanity-data-access-boundary.md)); the shared media document and
  its server-only adapter done, including the publish-blocking derivative limit that
  refuses a camera master, the dataset-visibility rule for archive locations, and the
  language-keyed authored text
  ([ADR-0008](docs/adr/0008-localized-authored-text.md)); site settings and home-page
  schemas now project through server-only adapters into the existing `SiteSettings` and
  `HomeContent` contracts, with semantic navigation targets and the shared public-media
  projection; the public category tree's schema and adapter now feed the vendor-neutral
  content-tree domain, resolving category references locally rather than dereferencing in
  GROQ; the shared rich-content body-block schema (paragraph, heading, list, quote, media
  placement, click-to-load YouTube) now underlies both the article schema — one document
  per published language, unlike a category's one document for every language — and the
  gallery body; the article, service, and gallery schemas and adapters now project into the
  existing `ContentPage`/`ContentPlacementInput` and `Service` contracts. A gallery's own
  curated items are their own document type (`galleryPlacement`, one per placement, not an
  embedded array like a gallery's sections) so a large gallery can be read a bounded page at
  a time — an id lookup plus a keyset range query, never the whole placement list — the same
  shape `content-listing.ts` already uses for articles; `src/lib/sanity-gallery.ts`'s
  `readSanityCuratedGalleryPage` composes that bounded read with the shared curated-gallery
  pagination contract. That contract understands a seeded-random ordering rule (AB#129,
  [ADR-0009](docs/adr/0009-seeded-random-gallery-ordering.md)) — a materialized per-placement
  shuffle key with a pinned lead tier — on both sources: the Sanity adapter serves a
  `seeded-random` gallery as two keyset lanes in one round trip, `galleryPlacement` stores
  `shuffledOrder` + a `shuffledOrderSeed` marker, and `npm run recompute:shuffled-order`
  (owner-run, revision-guarded, refuses to run while a draft exists) materializes the keys
  after a seed change. Between the seed edit and that recompute a bounded consistency
  aggregate makes the gallery serve an accessible "being reordered" state — HTTP 200 +
  `noindex` on the detail page (a true 503 there is a documented follow-up), a real 503
  from the continuation endpoint — recovering on its own once the `sanity:galleries` cache
  tag is invalidated.
  Tagged caching and signed webhook revalidation are done
  ([cache-revalidation](docs/cache-revalidation.md)).
  Sample content seeding is done too: an owner-run script
  ([`seeding`](docs/sanity-seeding.md), `npm run seed:sanity`) writes 474 sample documents —
  settings/home, a 3-level category tree, services, bilingual articles, and three galleries
  (one with sections and a body, one with 400 placements testing the paginated read, one
  seeded-random) — into a real project over the plain HTTP API, distinguishable from real
  content by public, root-level `seed--` ids and removable by the documented verified
  cleanup before go-live.
  Every route-facing seam (`site-settings.ts`, `home-content.ts`, `services.ts`, `content.ts`,
  `gallery.ts`) is now wired: `SITE_CONTENT_SOURCE=mock` keeps reading fixtures, and `sanity`
  reads every one of these adapters, never a mixed mock/Sanity page. Closing that wiring
  completed two adapter gaps it exposed — a bounded gallery listing-record read and a bounded
  article sibling-navigation read — and gave the optional `/services` intro a matching
  optional field on the settings singleton. A deployed Preview render of Sanity-authored
  content enabled the AB#83 cross-instance cache-invalidation gate, which a managed-cache
  propagation run verified on Preview on 2026-08-26; AB#83 remains Active only until that
  evidence is reviewed and merged*
- [ ] Production deployment — *the protected Preview environment is provisioned and its
  fully automated pipeline was verified by build 144 on 2026-08-24: the pinned runtime and
  region, gated deploy stage, project/team ownership, access protection, and non-indexability
  checks all ran against a real release-candidate URL
  ([deployment](docs/deployment.md)). Production promotion and exercised rollback remain
  pending under AB#18 and AB#118*
- [ ] Redirects for important legacy URLs (first implementation)

## Later roadmap (not in MVP)

- Keyword-driven dynamic galleries generated from one or more hierarchical keywords
  using AND matching, shareable URLs, and the same paginated grid and lightbox as
  curated galleries
- Video showcase in galleries, articles, and service pages; video delivery/sharing
  in client galleries
- Private client galleries, subject to a separate security and storage decision
  covering revocable/expiring access, noindex/no-store behavior, retention, and downloads.
  That decision is **drafted** in
  [ADR-0014](docs/adr/0014-private-gallery-security-delivery-retention-boundary.md)
  (Proposed, not yet accepted); implementation would be AB#29 (delivery) and AB#130
  (proof selection)
- Proof galleries with photo selection and extra-photo pricing
- Optional image sales and fulfilment (enquiry first; checkout and cart only
  after a separate product, legal, security, and delivery decision)
- Multilingual authoring workflow: creating a linked localized draft from an existing page
  in one action, and optional provider-neutral AI translation assistance. The public
  locale-aware routing itself is in the MVP above, not here
- EXIF display with per-category visibility
- Service-specific testimonials
- Cookieless analytics

## License

[MIT](LICENSE) for the project's own source.

Third-party material — the Geist typefaces, PhotoSwipe, and two vendored agent skills —
stays under its own license. Attribution is in [NOTICE](NOTICE), full license texts in
[licenses/](licenses/), and the audit behind both, covering every shipped asset, in
[docs/asset-inventory.md](docs/asset-inventory.md).

The demo photographs in `public/gallery/` are AI-generated placeholders owned by the
project author. They are meant to be replaced with the photographer's own work.

## Contributing

**This project does not accept external contributions.** The repository is public to be
read, cloned, and rebranded, but pull requests are not accepted. This keeps future
licensing decisions unencumbered without the overhead of a contributor agreement.

Found a bug or have an idea? Open an issue — that is welcome.

## Status

🚧 Work in progress — MVP in progress. The public pages (home, services, contact, and the
canonical article and gallery routes in the content tree) read from either source behind
`SITE_CONTENT_SOURCE` — the mock fixture layer, or a customer's own Sanity project — whose
images use the accepted project-owned public rendition contract and whose galleries use the
shared paginated gallery result contract either way. The content tree's category domain model, canonical
placement contract, and public category branch routes are built — breadcrumbs,
deterministically ordered listings that aggregate every canonically and secondarily
placed page in the category's whole descendant subtree, not only its direct
placements ([ADR-0003](docs/adr/0003-public-content-tree-and-url-structure.md),
2026-08-27 amendment), permanent redirects for retired paths, and a visible
identity-based language switch — plus a bounded recent-content overview on the story
root — in every configured locale space, with
`hreflang`/`x-default` alternates. Articles render at their canonical detail routes in
that tree, and the site menu is driven by it: the configured static links and the tree's
first two category levels compose into one navigation, in the wide layout and the compact
one, with the deeper branches reached from the landing page above them. Curated galleries
render at their own canonical routes in that tree; the header, footer, and home page reach
the featured one by its stable content identity rather than by a written-down path, and the
pre-tree `/portfolio` route was removed rather than redirected, because it was never
deployed or indexed. A gallery larger than one page issues an opaque continuation cursor
and serves the next bounded slice at its own indexable, self-canonical `?cursor=` URL; the
control that reaches it is a real link, so a large gallery pages through with no JavaScript
at all, and a token that names no slice of that gallery is a 404 rather than a silent
return to the first page. A category branch listing whose aggregated subtree exceeds one
page now pages through the same way ([ADR-0013](docs/adr/0013-category-listing-continuation-cursor.md)):
a keyset `?cursor=` over `(publishedAt, contentId)`, signed with the shared
`GALLERY_CURSOR_SIGNING_KEY`, on its own indexable self-canonical URL, reached by a real
link that works with no JavaScript, with a compact continuation page and an invalid-cursor
404 that links back to the branch. The story root still serves only its bounded first page.
Static routes and authored
SiteSettings copy exist only in the unprefixed default-locale space; localizing them is a
separate story. The Sanity connection, its published-perspective query client, and the
enforced data-access boundary are in place, as are every schema and adapter — media,
category, site settings, home page, article, service, and gallery — and every route-facing
seam now dispatches on `SITE_CONTENT_SOURCE`, so a deployment reads consistently from one
source and never mixes them on one page.
The gallery grid lays its items out row by row, so what the eye reads is the order the
source, the DOM, keyboard focus, and the lightbox all use, and every frame keeps its native
aspect ratio uncropped. It opens a fullscreen lightbox that navigates the loaded result by
keyboard, control, and gesture, presents the caption and credit of the photograph on
screen, and magnifies a frame on a click, tap, or the `z` key with pan bounded to the
image and the caption stepping aside while zoomed; its zoom animation/level tuning is a
later slice. The contact form is built and
delivers through a replaceable adapter that stores nothing, and a public-journey suite
covers its validation, success, failure, and retry states; the gallery-item enquiry
(AB#60) builds on it. Seeded random gallery ordering renders from both the mock fixture and
Sanity (rotation is a two-step owner operation, with an accessible "being reordered" notice
in between); gallery section controls are done, while story-root listing continuation is
still open; the CMS schemas and adapters are done and wired in. The deployment path exists in
the repository — a pinned runtime and region, a pipeline stage that deploys a release
candidate only after every gate passes, and a check that refuses to publish a URL whose
project/team ownership, access protection, and non-indexability were not verified — but
the existing customer-owned Vercel project is still being provisioned, so the stage has
never run. Keyword-driven dynamic galleries remain
post-MVP. See the MVP scope checklist above.
