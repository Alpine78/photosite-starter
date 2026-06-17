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
  belong in site settings (`SiteSettings`) or CMS content.
- **MVP first.** Do not build roadmap features (client galleries, proof selection,
  multilingual, EXIF toggles, analytics) before they are explicitly prioritized.
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

## Feature status awareness

Current state: **pre-MVP skeleton** — create-next-app base, CI pipeline, no features yet.
The MVP checklist lives in `README.md`. Before starting work, check the current state of
the code and the relevant work item scope; do not assume a feature exists or is missing.

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
npm run dev     # dev server
npm run lint    # ESLint (CI gate)
npm run build   # production build (CI gate)
```

## Git workflow

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
  validation that could not be run and why.

## CI / project management

- Source code: GitHub (public, `Alpine78/photosite-starter`)
- CI: Azure Pipelines (`azure-pipelines.yml`) — lint + build on push/PR to `main`
- Project management: Azure DevOps Boards, org `ilkkarytkonen`, project `photosite-starter`
  (Agile process: Epic → Feature → User Story → Task)
- Workflow: feature branch → PR → review → CI → merge to `main`

## Documentation updates

- Update `README.md` when scope, structure, or setup changes
- Update `AGENTS.md` only when project-level working rules or conventions change
- Keep documentation changes in the same PR as the change they describe

## Definition of Done (summary)

Acceptance criteria met, TypeScript build passes, lint passes, responsiveness and
accessibility checked, documentation updated, PR approved.

## Final principle

> Make it work → make it simple → then improve.

Build the simple, fast, visually high-quality photographer site first. Extend to client
galleries, proof selection, and other advanced features only after that.
