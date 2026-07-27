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

```bash
npm ci
npm run dev
```

Other scripts:

```bash
npm run lint    # ESLint
npm run build   # production build
```

## CI

Azure Pipelines ([azure-pipelines.yml](azure-pipelines.yml)) runs lint and build on pushes and pull requests to `main`.

## MVP scope

- [x] Next.js App Router project setup (TypeScript, Tailwind, `src/`)
- [x] CI pipeline (lint + build)
- [x] Responsive base layout with header and footer
- [x] Site settings (name, branding, contact, navigation)
- [x] Home page
- [x] Services listing and individual service pages
- [x] Shared generic media model (photo and video capable)
- [x] Blog / article content type (supports long story articles)
- [ ] Portfolio galleries with fullscreen lightbox — *grid done, lightbox pending*
- [ ] Contact form
- [ ] Basic SEO (metadata, sitemap, robots.txt) — *root metadata done, sitemap/robots pending*
- [ ] CMS integration (Sanity) — *mock data layer in place under `src/lib`*
- [ ] Production deployment
- [ ] Redirects for important legacy URLs (first implementation)

## Later roadmap (not in MVP)

- Video showcase in galleries, articles, and service pages; video delivery/sharing
  in client galleries
- Private client galleries (token/PIN access, noindex, expiration)
- Proof galleries with photo selection and extra-photo pricing
- Multilingual content
- EXIF display with per-category visibility
- Service-specific testimonials
- Cookieless analytics

## License

[MIT](LICENSE)

## Status

🚧 Work in progress — MVP in progress. The public pages (home, services, blog, portfolio
grid) are built against a mock data layer; the lightbox, contact form, and CMS integration
are still open. See the MVP scope checklist above.
