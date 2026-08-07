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
- Headless CMS (planned: [Sanity](https://www.sanity.io); mock data first)
- GitHub for source code
- Azure DevOps (Boards for project management, Pipelines for CI)

## Project structure

- `src/app` – App Router routes and layouts
- `src/components` – reusable UI components *(added as features land)*
- `src/lib` – shared logic, configuration, data access, and the generic media model
- `docs/adr` – architecture decision records ([conventions](docs/adr/README.md))

Import alias: `@/*` → `src/*`

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

Each locale's category branches are served from its own content tree, together
with that tree's recorded path history: a category a move or rename retired
redirects permanently, in one hop, to its current path in the same language. A
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
CONTACT_DELIVERY_ADAPTER=sink   # "sink" | "resend"
```

`sink` accepts a message and sends nothing: it is what local development, CI, and the
Preview environment run on. `resend` delivers over Resend's HTTP API and needs three
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
```

## Testing

Two layers, with no overlap between them.

**[Vitest](https://vitest.dev)** is the single browser-free runner for deterministic
domain, query, adapter, and server-validation tests. `npm test` runs
`src/**/*.test.ts` in Node and exits after one run. Tests must not depend on a browser,
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
projects: desktop Chromium and mobile WebKit. It leaves `.next` holding a build made
with the harness settings, so run `npm run build` again before serving your own
deployment build locally. Retries, timeouts, browser matrix, and parallelism are set
explicitly in [playwright.config.ts](playwright.config.ts) rather than left to defaults
that differ between a laptop and a build agent.

The application under test runs on harness-owned settings from
`e2e/support/harness-environment.ts` — a reserved `.test` canonical origin and the
project's own mock content, no credentials — so traces and screenshots retained on
failure can be published without a review of what they might contain. Every request to
an origin other than the site under test is blocked and fails the test, which keeps the
privacy rules honest and is where an external delivery adapter plugs in a test double
instead of reaching a real service. The contact form already uses it: the harness
selects `CONTACT_DELIVERY_ADAPTER=sink`, so the journey exercises the real endpoint,
the real validation, and the real response contract without a credential in the
environment or a synthetic enquiry in a real mailbox.

## CI

Azure Pipelines ([azure-pipelines.yml](azure-pipelines.yml)) runs lint, browser-free
tests, the production build, and the Playwright smoke suite on pushes and pull requests
to `main`. Test results are published on every run; traces and screenshots are published
as a pipeline artifact when the suite fails.

## MVP scope

- [x] Next.js App Router project setup (TypeScript, Tailwind, `src/`)
- [x] CI pipeline (lint + test + build + production-build smoke tests)
- [x] Responsive base layout with header and footer
- [x] Site and deployment settings (branding, contact, navigation, locale, canonical base URL, default social image, built-in labels)
- [x] Home page
- [x] Services listing and individual service pages
- [x] Shared generic media model (photo and video capable)
- [x] Implementation of the proposed public image rendition boundary
  (ADR-0005 awaits owner approval)
- [x] Blog / article content type (supports long story articles)
- [ ] Hierarchical public content tree with category routes, breadcrumbs, and accessible navigation
  — *category domain model, canonical placement contract, and the server-rendered category
  branch routes with breadcrumbs, bounded deterministic listings, and permanent redirects
  for retired paths done; content detail routes (AB#104, AB#124), tree-driven header and
  mobile navigation (AB#111), and listing continuation controls pending*
- [ ] Locale-aware public routing — unprefixed Finnish default routes alongside English
  (`/en/…`), language switching, and `hreflang` metadata
  ([ADR-0003](docs/adr/0003-public-content-tree-and-url-structure.md))
  — *route configuration, prefix reservation, redundant default-prefix normalization,
  per-locale labels and content trees, category branches in every configured locale space
  with `hreflang`/`x-default` links, and the identity-based language switch on those pages
  done; localized static routes and localized authored settings pending*
- [ ] Curated public galleries with shared pagination, fullscreen lightbox, optional sections,
  and optional long-form body content — *thumbnail grid, shared bounded result contract, and
  fullscreen lightbox (open, close, navigate, caption and credit) done
  ([ADR-0001](docs/adr/0001-lightbox-library.md)); zoom tuning, preloading,
  sections, and continuation controls pending*
- [x] Contact form — *accessible `/contact` page and bounded `POST /api/contact`
  handler, a replaceable delivery adapter (Resend over its HTTP API, plus a sink adapter
  for development, CI, and Preview), abuse controls, and operational events carrying no
  personal data ([data flow](docs/contact-data-flow.md)); the gallery-item enquiry
  (AB#60) and the fuller journey suite (AB#89) are separate stories*
- [ ] Basic SEO (metadata, sitemap, robots.txt) — *settings-driven titles, descriptions,
  canonical URLs, and Open Graph output done for every current public page; sitemap,
  robots, and structured data pending*
- [ ] CMS integration (Sanity) — *mock data layer in place under `src/lib`*
- [ ] Production deployment
- [ ] Redirects for important legacy URLs (first implementation)

## Later roadmap (not in MVP)

- Keyword-driven dynamic galleries generated from one or more hierarchical keywords
  using AND matching, shareable URLs, and the same paginated grid and lightbox as
  curated galleries
- Video showcase in galleries, articles, and service pages; video delivery/sharing
  in client galleries
- Private client galleries, subject to a separate security and storage decision
  covering revocable/expiring access, noindex/no-store behavior, retention, and downloads
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

🚧 Work in progress — MVP in progress. The public pages (home, services, blog, and the
initial portfolio grid) are built against a mock data layer whose images use the
accepted project-owned public rendition contract and whose portfolio uses the shared
paginated gallery result contract. The content tree's category domain model, canonical
placement contract, and public category branch routes are built — breadcrumbs,
deterministically ordered listings, permanent redirects for retired paths, and a visible
identity-based language switch — in every configured locale space, with
`hreflang`/`x-default` alternates. Content *detail* routes and tree-driven header and
mobile navigation are not (AB#104, AB#111, AB#124). Static routes and authored
SiteSettings copy exist only in the unprefixed default-locale space; localizing them is a
separate story. The future Sanity adapter remains open.
The portfolio grid opens a fullscreen lightbox that navigates the loaded result by
keyboard, control, and gesture and presents the caption and credit of the photograph on
screen; its zoom tuning and preloading are a later slice. The contact form is built and
delivers through a replaceable adapter that stores nothing; the gallery-item enquiry
(AB#60) and the fuller journey suite (AB#89) build on it. Public continuation routes and
controls, and CMS integration, are still open. Keyword-driven dynamic galleries remain
post-MVP. See the MVP scope checklist above.
