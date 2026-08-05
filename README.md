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
| `SITE_LOCALE` | BCP 47 locale for the document language and date formatting |
| `SITE_CANONICAL_BASE_URL` | Absolute public base URL used by URL-based metadata |
| `SITE_DEFAULT_SOCIAL_IMAGE` | Absolute HTTP(S) URL or image path reserved for the default social preview |

`SITE_LOCALE` does not translate the application-owned UI labels. For a
non-English single-locale deployment, update `builtInLabels` in
`src/lib/deployment-config.ts` to match. AB#128 owns later per-route locale behavior.

```bash
npm ci
npm run dev
```

Other scripts:

```bash
npm run lint   # ESLint
npm test       # browser-free TypeScript tests (one run)
npm run build  # production build
```

## Testing

[Vitest](https://vitest.dev) is the single browser-free runner for deterministic
domain, query, adapter, and server-validation tests. `npm test` runs
`src/**/*.test.ts` in Node and exits after one run. Tests must not depend on a browser,
external network, live CMS or email services, secrets, or production/personal fixture
content. Playwright remains the separate public-journey layer.

## CI

Azure Pipelines ([azure-pipelines.yml](azure-pipelines.yml)) runs lint, tests, and build
on pushes and pull requests to `main`.

## MVP scope

- [x] Next.js App Router project setup (TypeScript, Tailwind, `src/`)
- [x] CI pipeline (lint + test + build)
- [x] Responsive base layout with header and footer
- [x] Site and deployment settings (branding, contact, navigation, locale, canonical base URL, default social image, built-in labels)
- [x] Home page
- [x] Services listing and individual service pages
- [x] Shared generic media model (photo and video capable)
- [x] Implementation of the proposed public image rendition boundary
  (ADR-0005 awaits owner approval)
- [x] Blog / article content type (supports long story articles)
- [ ] Hierarchical public content tree with category routes, breadcrumbs, and accessible navigation
- [ ] Locale-aware public routing — unprefixed Finnish default routes alongside English
  (`/en/…`), language switching, and `hreflang` metadata
  ([ADR-0003](docs/adr/0003-public-content-tree-and-url-structure.md))
- [ ] Curated public galleries with shared pagination, fullscreen lightbox, optional sections,
  and optional long-form body content — *thumbnail grid and shared bounded result contract done*
- [ ] Contact form
- [ ] Basic SEO (metadata, sitemap, robots.txt) — *root title/description and metadata base done; per-route canonical/Open Graph output and sitemap/robots pending*
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

Third-party material — the Geist typefaces and two vendored agent skills — stays under
its own license. Attribution is in [NOTICE](NOTICE), full license texts in
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
paginated gallery result contract. The future Sanity adapter remains open, as does
the accepted locale-aware route contract. The hierarchical content tree, localized
routing, public continuation routes and controls, lightbox, contact form, and CMS
integration are still open. Keyword-driven dynamic galleries remain post-MVP. See the
MVP scope checklist above.
