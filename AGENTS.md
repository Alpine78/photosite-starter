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
  **ADR-0019's image comparison is a scoped exception:** a visitor-controlled
  reveal may temporarily occlude part of either complete, native-ratio image.
  It never crops a derivative or stretches an image, offers a complete-image view,
  and shows both full frames without an overlay when ratios differ or JavaScript
  is unavailable.
- **Hero convention.** Heroes display at the image's _native_ ratio — whatever it is
  (16:9, 3:2, 4:5, …) — via `h-auto w-full` plus the asset's real `width`/`height`; the
  code imposes no aspect ratio and never crops. The "full-width banner" look comes from
  the _photographer supplying a wide-format image_, not from a fixed-height crop band.
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
- If information is missing, STOP and say so clearly: _"I don't have enough information
  to answer this correctly."_ Then ask for the missing code, file, requirement, or docs.
- **A design or reference you cannot read is missing information.** When the task
  builds on a referenced source (a Claude Design project, Figma file, mockup, export,
  or linked document) and the session cannot open it, stop before any file change that
  depends on it. Say which source is unreadable and ask for access or an export.
  Labelling a guess as an "assumption" does not make it acceptable, and an instruction
  to start working does not override this rule. Read-only exploration and creating the
  work item may go ahead; the dependent implementation may not.
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

The running implementation history lives in [`docs/feature-status.md`](docs/feature-status.md).
Search the part relevant to the task, then verify it against the current code and,
for an Azure Boards item, its authoritative description, acceptance criteria,
discussion and relations. Update the status document when implementation status
changes; it is supporting context, not a substitute for the work item.

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
  directly: it carries the guard that fails a test which reaches a third-party origin, and
  it gives every test its own synthetic client address — on the browser context *and* on
  `request`, Playwright's API context, so a spec that posts to an endpoint directly does
  not silently share one throttle bucket with the entire matrix (AB#146).
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
npm run verify:legacy-redirects -- report # AB#19: mapping report; check <origin> [<canonical-origin>] probes a production build
npm run benchmark:keywords -- plan # AB#65 spike: fixture + query-strategy benchmark (owner-run for the live matrix)
npm run convert:joomla -- --source <articles.ndjson> --out <dir> # owner-run: convert legacy content, report only, never writes
npm run write:joomla -- --plan <import-plan.json> --image-root <dir> --out <dir> --approved-digest <hash> # owner-run: write an approved import plan to Sanity, dry-run by default
npm run plan:rally -- --folder <rally folder> --out <dir> # owner-run: plan a capture-sequence rally import offline, never writes
npm run write:rally -- --plan <plan.json> --folder <rally folder> --out <dir> --approved-digest <hash> # owner-run: write an approved rally plan to Sanity, dry-run by default
npm run plan:rally-conversion -- --gallery <contentId> --folder <renamed copy> --artifacts <dir> --out <dir> # owner-run: plan converting a published rally gallery, read-only
npm run write:rally-conversion -- --plan <plan.json> --folder <renamed copy> --out <dir> --approved-digest <hash> --backup-archive <path> # owner-run: write an approved rally gallery conversion to Sanity, dry-run by default
npm run fix:joomla-intro -- --out <dir> [--approved-digest <hash> --yes] # owner-run: move imported Joomla intros into listing-only leads, plan-only by default
npm run admin:secret # owner-run: generate the private-gallery administrator credential (ADR-0015 §4)
```

`npm run test:e2e` needs the browsers once: `npx playwright install chromium webkit`
(add `--with-deps` on Linux).

## Git workflow

- **Branch before the first file change.** While the checkout is on `main`, no file in
  the working tree may be modified — code, documentation, and configuration alike, and a
  change that "is only a one-liner" is not an exemption. Read-only work comes first and
  is expected: read the work item, explore the code, and check `git status` and the
  tracking state so the branch starts from a clean, up-to-date `main`. Creating and
  publishing the branch and verifying its upstream are the final setup steps before
  the first edit (see below). If editing has already begun on `main`, stop and branch —
  uncommitted changes carry over — rather than committing them there.
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

### Branch publication and VS Code worktrees

These rules apply to **every new work branch**, with or without a linked worktree.
The branch used as the starting point and the upstream used for synchronization are
separate choices: start from `origin/main`, but track `origin/<the work branch name>`.

1. **Inspect before creating.** Read `git status --short --branch`, `git branch -vv`,
   and `git worktree list --porcelain`; fetch `origin` and verify the starting point.
   Reuse the checkout for a single task when it is available. Use a linked worktree
   when another task occupies it. Preserve other tasks' uncommitted changes and do
   not switch a branch in a checkout used by another active session.
2. **Set repository-local defaults.** Verify `origin` is the intended repository and
   apply the settings below with `--local`, never `--global`. Git configuration is
   shared by this repository's worktrees, but is not committed or inherited by a
   clone; check it at the start of each task. `branch.autoSetupMerge=simple` allows
   automatic tracking only when the local and remote branch names match.

   ```bash
   git config --local branch.autoSetupMerge simple
   git config --local push.default simple
   git config --local push.autoSetupRemote true
   git config --local remote.pushDefault origin
   ```

3. **Create without inheriting the base branch's upstream.** For an ordinary branch,
   use `git switch --no-track -c "$work_branch" origin/main`. For a linked worktree,
   use the example below. Never create a detached worktree for implementation, use
   `--track`/`--track=inherit` from `origin/main`, or set a work branch's upstream to
   `main` or `origin/main`.
4. **Publish immediately with an explicit destination.** Creating the same-named
   remote work branch is part of task setup, before the first edit. Set its push
   remote to `origin` and use the explicit same-name push refspec in the example below.
   This publishes the existing
   starting commit; it does not require an agent-created commit or upload uncommitted
   changes. Do not force-push or overwrite an unrelated existing branch. If the user
   explicitly requests local-only work, leave the upstream unset so VS Code offers
   **Publish Branch**. If publication fails, report the failure and leave the upstream
   unset; never substitute `origin/main` or claim **Sync Changes** is ready.
5. **Verify before editing and at handoff.** In the actual working directory, check
   the top-level path, current branch, upstream, and push destination using the commands
   below. The branch must be the intended work branch, the upstream must be exactly
   `origin/$work_branch`, and the dry-run must target that same remote branch. Inspect
   effective `branch.<name>.pushRemote` and `remote.<name>.push` settings if the
   destination differs. When continuing an existing branch with a wrong upstream,
   repair it to its same-named remote branch; if that remote branch does not exist,
   unset the wrong upstream and publish explicitly. Never leave a work branch tracking
   `origin/main` for the user to repair in the editor.
6. **Use one worktree location and predictable names.** Linked worktrees belong under
   the primary checkout's ignored `temp/worktrees/` directory, with a directory name
   derived from the complete branch name (replace `/` with `-`). Do not scatter them
   across `/tmp`, arbitrary folders, or folders named after a different work item.
   Run edits, checks, and Git commands in the selected worktree, not in the primary
   checkout. Do not move or remove an existing worktree merely to normalize its path.
7. **Keep worktrees visible in the existing VS Code window.** The tracked
   `.vscode/settings.json` enables `git.detectWorktrees` and
   `scm.alwaysShowRepositories`; preserve these settings. Native worktree detection
   reads Git's registered worktrees, so visibility must not depend on opening a file
   in a worktree or on scanning nested folders. Check that `git.detectWorktreesLimit`
   accommodates the registered worktrees. If detection was enabled in an already
   open session, run **Developer: Reload Window** once, then **Source Control: Focus
   on Repositories View**. If a worktree was explicitly closed or ignored, reopen its
   path with **Git: Open Repository...** and check `git.ignoredRepositories`. A separate
   window (`code -n <path>`) is optional, not the normal discovery step. If the GUI
   cannot be inspected, say so and give the exact recovery command; do not claim that
   Source Control visibility was verified.

Example for a new linked worktree (Bash; replace the path and branch):

```bash
primary_root="/path/to/photosite-starter"
work_branch="chore/example-change"
worktree_dir="$primary_root/temp/worktrees/${work_branch//\//-}"
git -C "$primary_root" worktree add --no-track -b "$work_branch" "$worktree_dir" origin/main
cd "$worktree_dir"
git config --local "branch.$work_branch.pushRemote" origin
git push --set-upstream origin "refs/heads/$work_branch:refs/heads/$work_branch"
git rev-parse --show-toplevel
git status --short --branch
git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}'
git push --dry-run --porcelain
```

At handoff, report the working directory, branch, upstream, publication result, and
any remaining editor step alongside the suggested commit message. The user still
reviews and commits all file changes. **Sync Changes** pulls and pushes commits; it
does not publish uncommitted edits.

References: [Git tracking and push settings](https://git-scm.com/docs/git-config),
[VS Code worktree detection](https://code.visualstudio.com/docs/sourcecontrol/branches-worktrees#automatically-detect-worktrees),
[VS Code repository view and synchronization](https://code.visualstudio.com/docs/sourcecontrol/repos-remotes).

### Retiring a completed worktree

Removing its directory does not delete its branch. Retire only a checkout the
user has authorized you to clean up, after inspecting it:

1. Fetch `origin`, confirm the PR is **merged**, and compare its final source
   branch and head SHA with the checkout's branch and `git rev-parse HEAD`.
   Preserve checkouts another session or dev server still uses; never unlock one.
2. Inspect `git status --short --untracked-files=all` and
   `git ls-files --others --ignored --exclude-standard`. The second check is
   mandatory: ordinary removal does not protect ignored `.env.local`, private
   imports, local data, dependencies or test artifacts. Preserve or explicitly
   authorize disposal of every local file before removing the directory.
3. For an ordinary merge, verify `git merge-base --is-ancestor HEAD origin/main`
   in that checkout. A squash merge cannot be proved by this ancestry check;
   require separate evidence that the exact reviewed patch was integrated, or
   leave the worktree for the owner. A merged PR alone does not cover later local
   commits or edits.
4. From outside that checkout, run `git -C "$primary_root" worktree remove "$worktree_dir"` with both variables set to the inspected repository/path.
   Never add `--force`, reset changes or delete branch refs as part of retirement.
   `git worktree prune` cleans stale registrations, not live checkout directories.
5. Recheck `git worktree list --porcelain`. If VS Code retains the entry, run
   **Developer: Reload Window**, then **Source Control: Focus on Repositories View**.
   Check worktree detection/its limit and ignored repositories; use **Git: Open
   Repository...** to reopen an explicitly closed checkout. Report when the GUI
   has not been inspected instead of claiming its repository list is verified.

To reattach a retained branch, use `git worktree add "$worktree_dir" "$work_branch"`
under the canonical `temp/worktrees/` path. The branch must not be checked out
elsewhere. Do not create a replacement branch or change its same-name upstream.

## CI / project management

- Source code: GitHub (public, `Alpine78/photosite-starter`)
- CI: Azure Pipelines (`azure-pipelines.yml`) — lint + test + build + Playwright smoke
  tests on push/PR to `main`. Journey suites for new features join that gate as they land
- Project management: Azure DevOps Boards, org `ilkkarytkonen`, project `photosite-starter`
  (Agile process: Epic → Feature → User Story → Task)
- Workflow: feature branch → PR → review → CI → merge to `main`

## Documentation

This is the complete set — there is no other documentation to hunt for:

| File                                 | Audience                                                           | Update it when                                                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                          | humans evaluating or cloning the project                           | scope, structure, setup, or MVP progress changes                                                                                                            |
| `AGENTS.md`                          | all AI agents (canonical)                                          | project-level working rules or conventions change                                                                                                           |
| `docs/feature-status.md`             | maintainers and agents seeking implementation history             | a feature's implementation status changes; verify against code and Azure Boards                                                                              |
| `CLAUDE.md`                          | Claude Code only                                                   | a Claude-specific skill or workflow changes — it imports this file, so put shared rules here                                                                |
| `docs/adr/`                          | future maintainers                                                 | a hard-to-reverse technical decision is made (see below)                                                                                                    |
| `docs/architecture/`                 | anyone forming a mental model of the system                        | a system boundary, layer, external dependency, or the deploy flow changes — edit the `.d2` source and re-run `npm run diagrams`, never the `.svg`           |
| `docs/theme-contract.md`             | whoever restyles a clone or builds a theme preset (AB#37)          | a semantic design token is added, renamed, or revalued, the light/dark mechanism changes, or a surface moves in or out of the "stays explicit" list         |
| `docs/gallery-presentation.md`       | whoever authors gallery layout defaults or restyles the gallery grid (AB#157) | the placement rule, a responsive threshold, the caption-access mechanism, or the layout/caption inheritance model changes                                   |
| `docs/article-reading-position.md` | owner refining AB#20 | confirmed scope, open decisions or unapproved implementation slices change; no runtime acceptance is implied |
| `docs/asset-inventory.md`            | licensing audit                                                    | any third-party asset, font, or shipped dependency is added or removed                                                                                      |
| `docs/contact-data-flow.md`          | the site owner, a visitor who asks, and the AB#117 launch review   | the contact form's fields, delivery path, processors, logs, or retention change                                                                             |
| `docs/private-gallery-data-flow.md`  | the site owner, a customer who asks, and the AB#117 launch review  | a private gallery's stored data, the access link or cookie, its processors, logs, or retention change                                                       |
| `docs/poll-data-flow.md`             | the site owner, a visitor who asks, and the AB#117 launch review   | a poll's stored data, the poll-specific voting cookie, the write credential, logs, or retention change                                                              |
| `docs/article-comments-and-ratings.md` | owner refining AB#26 | confirmed scope, open decisions or unapproved implementation slices change; no runtime acceptance is implied |
| `docs/sanity-setup.md`               | the site owner and whoever provisions a clone's CMS                | the Sanity connection settings, ownership/transfer story, perspective, schemas, media policy, or failure behavior change                                    |
| `docs/sanity-seeding.md`             | the site owner and whoever seeds a clone's sample or first content | the seed script's fixture content, id/idempotency contract, write-token story, verification steps, or go-live cleanup checklist change                      |
| `sanity/README.md`                   | whoever wires a clone's Studio to these schemas                    | a document type is added, or how the Studio consumes them changes                                                                                           |
| `docs/deployment.md`                 | the site owner and whoever provisions a clone's hosting            | the Preview environment, pipeline deployment stage, environment-variable split, runtime pins, or promotion/rollback mechanism change                        |
| `docs/security-privacy-review.md`    | the site owner and future launch reviews                           | the launch security/privacy review is rerun, a finding's disposition changes, or the security response headers change (also update ADR-0011)                |
| `docs/keyword-query-benchmark.md`    | AB#55's taxonomy ADR and whoever runs the AB#65 spike              | the keyword-query benchmark fixture, harness, or matrix changes, or an owner-run live measurement is completed and its numbers/recommendation are filled in |
| `docs/review-catalog.md` | owner refining AB#27 | confirmed scope, open decisions or unapproved implementation slices change; no runtime acceptance is implied |
| `docs/commercial-policy-requirements.md` | owner and qualified legal/tax reviewers (AB#49) | proposed offer, licensing boundary, sales channel, buyer classification, processors, law or review evidence changes; this is requirements, not legal advice |
| `docs/photographer-operations.md` | owner refining AB#28 | confirmed scope, open decisions or unapproved implementation slices change; no runtime acceptance is implied |
| `NOTICE`, `licenses/`                | anyone receiving the product                                       | a third-party component with an attribution requirement is added                                                                                            |
| `.claude/skills/`, `.agents/skills/` | agents                                                             | a recurring workflow needs a skill; duplicate into both, no symlinks                                                                                        |

Rules:

- Keep documentation changes in the same PR as the change they describe.
- **Status text goes stale silently.** The MVP checklist in `README.md` and the feature
  status in `docs/feature-status.md` describe a moving target. When you finish a story,
  check both —
  the code and Azure Boards are authoritative, and prose that contradicts them is worse
  than no prose.
- **Architecture diagrams are generated, never hand-edited.** `docs/architecture/*.d2`
  is the source; the `.svg` beside it is a build artifact that `npm run diagrams`
  rewrites and `npm run diagrams:check` gates. Diagrams show _what_ the boundaries are
  and ADRs record _why_ — a diagram never replaces a record, and anything drawn that is
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

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
