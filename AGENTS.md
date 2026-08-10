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

## Feature status awareness

Current state: **MVP in progress.** Built: site settings mock layer, typed deployment
configuration, responsive header and footer, home page, services listing and detail
pages, the shared generic media model, the public
image rendition boundary, the portfolio thumbnail grid, the shared bounded gallery
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
Articles have moved into that tree: the shared project-owned content-page boundary
(`src/lib/content-page.ts`) carries the variant, the six ADR-0003 body blocks, the cover,
the publication date, and tags, and the `article` variant renders at its one canonical
detail route in every configured locale space, with breadcrumbs following canonical
ancestry, the ADR-required table of contents derived from the body's level-2 headings,
sibling navigation read through a bounded two-row neighbour query over the global article
publication order, self-referencing canonical metadata, `hreflang`/`x-default` alternates, an
Open Graph article, and the identity-based language switch. The pre-launch `/blog` and
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
(`SITE_CONTENT_SOURCE`, no default, `mock` refused in a production deployment),
validated connection settings carrying an optional server-only read token, and a
project-owned query client over the Content Lake HTTP API that always asks for the
published perspective, bounds and classifies its failures, never falls back to another
source, and adds no runtime dependency. Sanity's HTTP surface lives in
`src/lib/sanity-config.ts` and `src/lib/sanity-client.ts`, and ESLint stops `src/app`
and `src/components` from importing either (ADR-0006, `docs/sanity-setup.md`).
The public-journey harness is
in place too — a production-build Playwright suite with an external-request guard, gated
in Azure Pipelines — carrying the home/navigation smoke test, the portfolio lightbox
journey, the content-tree journey (branches, the canonical detail route, redirects, and
404s), the services journey (the listing, one service detail with its cover, price list,
and breadcrumb, the navigation between them and into the story section, and an unknown
slug's 404), and the contact submission smoke test; route-specific journey suites are
separate stories that join the gate as their features land.
Not yet built: the curated gallery detail
route (AB#104) — a gallery's canonical path 404s until it lands — tree-driven header and
mobile navigation (AB#111),
localized static routes and localized authored settings — the contact route is
unprefixed-only for now — public continuation routes and
controls — a category listing is bounded to its first page and answers any `?cursor=`
with a 404, because none has been issued — lightbox zoom tuning, the gallery-item
enquiry (AB#60), the fuller contact journey suite (AB#89),
sitemap/robots, structured data, the Sanity content schemas and adapters that would put
authored content behind the connection (AB#80, AB#81, AB#82, AB#112, AB#114) — so every
page still renders from the mock layer — tagged caching and webhook revalidation (AB#83),
deployment.

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
- **Do not create commits automatically when a task appears complete.** Suggest a
  conventional commit message at useful review points; the user reviews and commits.
- When a task's requirements are implemented, report that clearly and suggest the final
  commit message.
- When a change is ready, provide a PR title and description without waiting for a separate
  request: concise summary, key implementation details, validation performed, and any
  validation that could not be run and why. Deliver it as a **fenced Markdown block that
  can be copied straight into the PR form** — it is pasted verbatim, so chat formatting
  has to be stripped by hand otherwise.
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
| `docs/asset-inventory.md` | licensing audit | any third-party asset, font, or shipped dependency is added or removed |
| `docs/contact-data-flow.md` | the site owner, a visitor who asks, and the AB#117 launch review | the contact form's fields, delivery path, processors, logs, or retention change |
| `docs/sanity-setup.md` | the site owner and whoever provisions a clone's CMS | the Sanity connection settings, ownership/transfer story, perspective, or failure behavior change |
| `NOTICE`, `licenses/` | anyone receiving the product | a third-party component with an attribution requirement is added |
| `.claude/skills/`, `.agents/skills/` | agents | a recurring workflow needs a skill; duplicate into both, no symlinks |

Rules:

- Keep documentation changes in the same PR as the change they describe.
- **Status text goes stale silently.** The MVP checklist in `README.md` and the feature
  status in this file describe a moving target. When you finish a story, check both —
  the code and Azure Boards are authoritative, and prose that contradicts them is worse
  than no prose.
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
