# Production security and privacy launch review (AB#117)

**Date:** 2026-08-22
**Reviewer:** Claude Code, with an independent Codex CLI plan review and a project
owner decision on scope (see "How this review was run")
**Work item:** AB#117 — "Run production security and privacy launch review"

This is the launch-gate review AB#117's acceptance criteria require. It is a
point-in-time review: rerun it (or at least re-check the finding register below)
before every subsequent production promotion, not only once.

The [2026-10-05 operational checkpoint](#2026-10-05-operational-checkpoint-ab13711718)
supersedes historical claims below that Resend is unprovisioned or the remaining
migration bundle is unapproved. It is scoped preparation, not the final AB#117 verdict.

The [2026-10-13 CMS publication/restoration record](audits/ab117-cms-publication-smoke-2026-10-13.md)
verifies one owner-approved visible home-text change and exact restoration, genuine
Production/Preview hook delivery, temporary-writer revocation/401 denial and unchanged
unrelated dataset revisions. It establishes the current serving chain; the existing
artifact retains `gitDirty: 1`. Final immutable/canonical release verification,
full recovery and the broader launch verdict remain open.

The [2026-10-13 Studio formatter investigation](audits/ab278-studio-sprintf-exposure-2026-10-13.md)
narrows GHSA-hp3w-g68c-fv3c to the observed local tooling path: the installed formatter
still reproduces RangeError, but the current compiled Studio graph and normal YAML
library import do not load it. The advisory remains open and unpatched; owner residual
risk acceptance and final hosted-release review are not inferred.

The [2026-10-24 synthetic gallery rehearsal](audits/client-gallery-lifecycle-rehearsal-2026-10-24.md)
records real-provider checks under AB#401: the current proof-publication identity
check accepted an Editor robot, and the tested built-in Editor grant was too broad
for cleanup. Those activation findings remain open. Local mail used a secret
placeholder and establishes failure handling only. The later
[AB#403 mail-only test](audits/proof-notice-mail-verification-2026-10-24.md)
verified one locally configured Resend acceptance and durable notice state, with
all four test records removed. The owner separately confirmed mailbox receipt on
2026-10-25; hosted delivery remains untested. These are scoped operational records,
not a rerun or approval of the full launch review.

The [2026-10-25 credential options (ADR-0040, Proposed)](adr/0040-client-gallery-cleanup-credential-options.md)
record a read-only project-role observation and the broader content exposure of a
possible Editor cleanup token. No exception is accepted; restricted WRITE and the
activation block remain. This is decision preparation, not a full launch-review rerun.

## How this review was run

A plan for this review was sent to Codex (OpenAI's CLI, `codex-review-loop` skill,
phase 1 — a one-time plan sanity check, not the iterative review-fix loop) before any
code was written. Codex's findings were treated as a report to verify, not a command
list — each one was checked against the actual codebase, and one of them (the Sanity
webhook "replay" finding) did not hold up under verification and was not acted on; see
the AC4 section below and ADR-0011. The three findings that did hold up materially
changed this review's scope and are recorded in ADR-0011 (CSP) and below (AB#116/AB#83
board state, AC3 scope). The project owner then made three explicit decisions before
implementation:

1. **AB#116** ("Provision reference preview environment and deploy release
   candidate") was reopened to `Active`. Its own acceptance criterion — "a repeatable
   release-candidate deployment produces a testable URL" — was confirmed not met:
   `az pipelines runs show` on the latest `main` run shows the pipeline's
   `DeployPreview` stage as `skipped`, not `succeeded`, matching the repository's
   then-current feature-status text ("the deploy stage has never run and no release
   candidate has ever been produced or verified") rather than the Closed state the
   board carried.
   The same evidence applies to **AB#83**'s own documented "Deployed verification
   gate" (`docs/cache-revalidation.md`: "No Production deployment currently exists...
   AB#83 therefore remains open until a staged/current deployment can run [the
   cross-instance propagation check]"), which was also reopened to `Active` on the
   same evidence and the same reasoning the owner had just applied to AB#116.
2. **AC3** ("Secrets, least privilege, customer ownership, recovery access, and log
   redaction are verified") is answered here at two different levels of confidence:
   what is verifiable from code and this repository's own provisioned accounts today
   is verified below; what requires a live Vercel/Resend account that does not exist
   yet is carried forward as an explicit, owned checklist rather than marked done.
3. **CSP** ships now with `'unsafe-inline'` on `script-src`/`style-src` as documented,
   accepted residual risk rather than withheld pending a larger rendering-architecture
   change. Full reasoning in ADR-0011.

A separate five-angle Claude self-review (`/code-review`) then ran against the
implemented diff, before Codex's iterative review-fix loop. It caught a real process
failure this review had made: the text below and in `AGENTS.md` had asserted AB#83 was
reopened to `Active`, but the corresponding `az boards work-item update` call had been
reasoned about and never actually executed — `az boards work-item show --id 83` still
showed `Closed`. That is fixed now (see below); it is recorded here rather than quietly
corrected, because presenting an unexecuted action as done is exactly what this
project's anti-hallucination rule (`AGENTS.md`) exists to catch, and a security review
that gets caught making that mistake about its own process should say so. The same
self-review also found the initial CSP `img-src` implementation granted the bare
`cdn.sanity.io` host with no path restriction — contradicting its own docstring's claim
of path-scoping, and a real gap (any other Sanity customer's project on the same shared
CDN host would have been an allowed image source) — plus two smaller reuse/efficiency
issues and a test-isolation bug. All are fixed; see ADR-0011 and the finding register
below (findings 4, 8, 9, 10).

The `codex-review-loop` skill's iterative Codex review-fix loop then ran against the
implemented, self-reviewed, staged diff. Round 1 found two more real issues: the new
`src/lib/embed-origins.ts` module had never been `git add`ed (so the reviewed diff
didn't include it and wouldn't build applied on its own), and the CSP omitted
`'unsafe-eval'`, which Next's own CSP guide documents as required in development for
React's debugging `eval()` calls — confirmed directly against a real `npm run dev`
server, not just the documentation. Both fixed (finding 11); the full gate was re-run
(lint, 1617/1617 tests, `tsc --noEmit`, build). Round 2 reported no further findings —
"internally consistent... no actionable regression was identified" — and the loop
stopped there, per the skill's own rule not to keep looping past a clean review.

## Finding register

| # | Finding | Severity | Disposition | Evidence |
| - | - | - | - | - |
| 1 | No security response headers existed (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) | Launch-blocking | **Fixed** | ADR-0011, `next.config.ts`, `next-config.test.ts` |
| 2 | 6 high-severity `npm audit` findings (4 production: `next`'s bundled `postcss`/`sharp`, `nanoid`; 2 dev-only: `brace-expansion`, `js-yaml`) | Launch-blocking | **Fixed** | See "Dependency audit" below |
| 3 | Fixing #2 bumped `next` 16.2.11→16.3.2, whose broader build-time type-checking surfaced a **pre-existing** type-check gap in `page-metadata.test.ts` (stale fixtures missing `privacyNotice`/`stage`/`contentSource`, and a `metadataBase` type narrowing) that `next build` on 16.2.11 was silently not catching | Medium (masked a CI gate gap) | **Fixed** | Reproduced independently via `tsc --noEmit` against an isolated `main` worktree (predates this change); see "Dependency audit" |
| 4 | AB#116 and AB#83 marked Closed despite their own stated live-deployment verification gates never having run | Process/governance | **Fixed** (reopened) | See "How this review was run" above |
| 5 | `main` branch protection | — | **Already done** (verified, not applied by this review) | See "AC3" below — this review's first check used the legacy branch-protection API, which reported "not protected"; the real answer is two active GitHub *rulesets* (the modern replacement), one added 2026-08-21, which the legacy API doesn't see. Corrected after the site owner flagged it |
| 6 | Sanity webhook idempotency-key format is validated but never stored/compared | Informational — **not a real gap** | **No change needed** | `docs/cache-revalidation.md`, `sanity-revalidation.test.ts`'s existing "accepts duplicate delivery as the same idempotent invalidation plan" test; `revalidateTag` is itself idempotent, so a replay ledger would add state to prevent a no-op |
| 7 | Live Vercel/Resend account ownership, MFA, role scoping, and data-retention terms cannot be verified — no such account is provisioned yet | Accepted, tracked | **Carried forward**, not closed | See AC3 below and `docs/contact-data-flow.md`'s existing "Before production launch" checklist |
| 8 | This review had asserted AB#83 was reopened to `Active` without actually running the `az boards work-item update` call — a process failure in the review's own execution, caught by the self-review pass, not by the plan review | Process — **caught and fixed** | **Fixed** | `az boards work-item show --id 83` confirmed `Closed` at time of catch; the update command was then actually run and reverified `Active` |
| 9 | The CSP `img-src` grant for a Sanity deployment allowed the entire `cdn.sanity.io` host with no path restriction, contradicting its own docstring's claim of path-scoping — any other Sanity customer's project on the same shared CDN host would have been an allowed image source | Medium — real gap, caught before merge | **Fixed** | `next.config.ts`'s `contentSecurityPolicy()` now scopes to `https://cdn.sanity.io/images/{projectId}/{dataset}/`, matching `sanityImageRemotePatterns`'s existing optimizer allow-list; `next-config.test.ts` asserts the bare host never appears |
| 10 | Two smaller issues, also caught and fixed before merge: (a) `Permissions-Policy`'s scoped-feature list was a manually re-typed copy of the YouTube embed's `allow` attribute, with no shared source to prevent drift; (b) `sanityBuildSettings()` was independently re-validated twice per build (once for `images.remotePatterns`, once for the CSP), and a new test hand-duplicated the file's own test harness instead of extending it, which also meant it never cleared `SANITY_READ_TOKEN`/`NEXT_PUBLIC_SANITY_READ_TOKEN` and could fail nondeterministically depending on the runner's ambient environment | Low | **Fixed** | (a) `YOUTUBE_EMBED_ALLOW_FEATURES` in `src/lib/embed-origins.ts`, consumed by both `youtube-embed.tsx` and `next.config.ts`; (b) `sanityBuildSettings(process.env)` computed once at module scope and passed into both call sites; `getConfigResponse()` in `next-config.test.ts` gained an optional `environment` parameter, reused by the Sanity-deployment test |
| 11 | Round 1 of the Codex review-fix loop (against the staged diff) found two more real issues: (a) the new `src/lib/embed-origins.ts` module had never been `git add`ed, so the diff Codex reviewed didn't include it and would not build if applied on its own; (b) the CSP omitted `'unsafe-eval'`, which Next.js's own CSP guide documents as required in development for React's debugging `eval()` calls — confirmed against a real `npm run dev` server, which showed the resulting CSP violation directly | (a) Process, (b) Medium — dev-only, never affects a built/deployed response | **Fixed** | (a) all three new files staged with `git add`; (b) `script-src` now conditionally includes `'unsafe-eval'` only when `NODE_ENV === "development"`, with tests for both branches — see ADR-0011 |
| 12 | No continuous dependency-advisory gate existed (finding #7's AC7 counterpart) | Low, accepted-risk-turned-actionable | **Fixed** | GitHub Dependabot vulnerability alerts and automated security fixes enabled at the site owner's direction, both verified `enabled: true` — see "Recommended follow-up" |

No other launch-blocking finding was identified. Findings 1–4 and 8–12 are fixed and
re-tested (full gate + Playwright suite + a targeted `curl` header check across every
response shape — 200, 308 redirect, 404, 410, 400, 405 — see "Verification performed").
Finding 5 turned out to already be handled, not a gap this review needed to close.
Finding 7 is the one item genuinely carried forward, not closed — it requires
infrastructure (a live Vercel/Resend account) that does not exist yet.

## Data-flow inventory (AC1)

| Flow | Processor | What crosses the boundary | Where it's documented |
| - | - | - | - |
| Hosting / edge / TLS | Vercel | Every HTTP request/response; environment variables at build and runtime | ADR-0004, `docs/deployment.md` |
| CMS content | Sanity (Content Lake HTTP API) | Published documents read via a server-only adapter; a write-scoped token for seeding only | ADR-0006, `docs/sanity-setup.md`, `docs/sanity-seeding.md` |
| CMS media delivery | Sanity's asset CDN (`cdn.sanity.io`) | Public image renditions only, browser-fetched directly | ADR-0005, ADR-0006 |
| Contact form delivery | Resend (HTTP API) | The enquiry's field values, sent server-side only; nothing is stored by this application | `docs/contact-data-flow.md` |
| Cache invalidation | Sanity → this application's `/api/revalidate` | A signed webhook naming which document changed; no document body is logged | `docs/cache-revalidation.md`, ADR-0004 |
| Opt-in video embed | YouTube (`youtube-nocookie.com`) | Only after a visitor explicitly clicks; no request before that | `youtube-embed.tsx`, `AGENTS.md`'s privacy-by-default rule |
| Source control / CI | GitHub, Azure DevOps (Pipelines + Boards) | Source code (public repo), pipeline secrets (`VERCEL_TOKEN`, `SANITY_READ_TOKEN`, etc. as pipeline-scoped variables), work-item text | `azure-pipelines.yml`, this review's own AC3 section |
| Operational logs | Vercel Runtime Logs | Redacted correlation-id-keyed events only (see AC3) | `docs/contact-data-flow.md`, `docs/cache-revalidation.md` |

This corrects a gap the plan-review phase flagged: an earlier draft of this review
listed only "Resend + Sanity + Vercel" as external processors. YouTube (opt-in, after
a click) and the GitHub/Azure DevOps supply-chain/operational flow belong in the
inventory too, even though neither carries visitor data the way Resend/Sanity do.

## AC2 — CSP, HSTS, framing, MIME sniffing, referrer, permissions, HTTPS, error behavior

Fully covered by ADR-0011, which is the authoritative record for this criterion. Summary:

- **CSP**: shipped, strict on every directive except `style-src` (`'unsafe-inline'`
  for server-rendered style attributes). Public HTML has a per-request script nonce
  with `'strict-dynamic'` and no `'unsafe-inline'` since AB#390 (ADR-0011 amendment
  2026-10-22); redirects, API, maintenance and the inactive private namespaces keep the
  static `'unsafe-inline'` fallback, as do Next.js's prerendered error-page paths
  (`/404`, `/500`), whose build-time HTML has no nonce. Every journey test fails on a
  reported violation.
- **HSTS**: deliberately not set at the application level; Vercel's platform default
  (`max-age=63072000`) already applies, verified against Vercel's own documentation
  rather than assumed.
- **Framing**: `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'`.
- **MIME sniffing**: `X-Content-Type-Options: nosniff`.
- **Referrer**: `Referrer-Policy: strict-origin-when-cross-origin`.
- **Permissions**: `Permissions-Policy` denies unused browser features outright and
  scopes the rest to `self` plus the one embed origin that needs them, pinned to that
  embed's own `allow` attribute by a shared constant and a test.
- **HTTPS**: enforced by Vercel at the platform edge; no live deployment exists yet to
  observe the effective behavior end-to-end (see AC3/AB#116 finding) — this is a
  carried-forward verification, not a code gap.
- **Error behavior**: `docs/adr/0007-proxy-request-path-boundary.md` already documents
  the 404/410 boundary and its one known RSC-payload limitation (tracked as AB#132);
  unchanged by this review. `next build`'s TypeScript step (now stricter after the
  dependency bump — finding #3) and the full Playwright suite were re-run and pass.

## AC3 — Secrets, least privilege, customer ownership, recovery access, log redaction

2026-10-13 rotation preparation: [AB#285's private-operation inventory](audits/ab285-bypass-rotation-readiness-2026-10-13.md)
identifies current CI and native Preview-hook consumers before replacing exposed
automation bypasses. Four entries exist; three still lack a confirmed consumer.
No key/header/CI-secret mutation or residual-risk acceptance was performed.

2026-10-14 execution: [AB#287’s owner-approved rotation](audits/ab287-launch-bypass-rotation-2026-10-14.md)
updated the existing CI/local/Preview-hook consumers to one verified replacement.
Fresh main CI 977 succeeded before all four exposed entries were revoked; native
readback contains one default replacement and each old value now receives the SSO
challenge. Hook signing and other protection settings are preserved. The owner
explicitly accepted retirement of the three entries with unconfirmed consumers.
AB#287 remains Active pending its evidence PR; AB#117’s final acceptance stays open.


**Verified now, from code and this repository's own provisioned accounts:**

- **No secret ever reaches the browser bundle.** `next.config.ts` throws at build time
  if `NEXT_PUBLIC_SANITY_READ_TOKEN` is set at all; `sanity-revalidation.ts` throws if
  `NEXT_PUBLIC_SANITY_WEBHOOK_SECRET` is set, or if the real secret looks like an
  unresolved platform placeholder (`[SENSITIVE]`, `$(NAME)`) rather than a usable
  value. Both are pinned by `next-config.test.ts` and `sanity-revalidation.test.ts`.
- **Least privilege inside the code boundary.** The Sanity adapter reads through an
  explicit allow-list projection (`PUBLIC_MEDIA_PROJECTION` and equivalents) rather
  than a whole document — an archive locator, provider id, or capture date cannot
  reach a public payload because the query never asks for it, not because a later
  filter removes it.
- **Log redaction.** Every operational log call in this codebase (`contact-log.ts`,
  `sanity-client.ts`, the `/api/revalidate` route) writes only
  `{event, correlationId, state, errorClass}` — grepped across `src/lib` and `src/app`
  for `console.*` calls outside those files; none logs a field value, request body,
  token, signature, or stack trace.
- **GitHub repository access** (source of truth for what ships): the repository is
  intentionally public (`README.md`'s own stated policy). Collaborator check
  (`gh api repos/Alpine78/photosite-starter/collaborators`) shows exactly one
  collaborator (the owner, admin). `main` is protected by two active GitHub
  rulesets (`gh api repos/Alpine78/photosite-starter/rulesets`, ids `17600572` and
  `21133560`, the second added 2026-08-21): together they block branch deletion,
  block non-fast-forward pushes (force-push), require a pull request to merge, and
  require the `Alpine78.photosite-starter` CI status check to pass before merge —
  with `current_user_can_bypass: "never"` on both, so not even the repository owner
  can merge around them. This review's first pass checked the legacy
  `branches/main/protection` REST endpoint, which returned 404 "Branch not
  protected" — that endpoint does not see rulesets at all, so it was checking the
  wrong API, not observing a real gap. Corrected after the site owner pointed out
  the rulesets were already in place.
- **Pipeline secret scoping.** `azure-pipelines.yml`'s `DeployPreview` stage reads
  `VERCEL_ORG_ID`/`VERCEL_PROJECT_ID`/`VERCEL_TOKEN`/`VERCEL_AUTOMATION_BYPASS_SECRET`
  and `SANITY_READ_TOKEN` as pipeline-scoped variables, never printed and never
  committed; the stage explicitly checks all four Vercel variables are present before
  running rather than silently deploying with a partial credential set.

**Not verifiable yet — carried forward, not closed:**

`docs/contact-data-flow.md`'s existing "Before production launch" checklist already
names exactly this gap and is the authoritative tracker; this review does not
duplicate it, only confirms it is still accurate and still open:

- Resend account ownership, data-residency/retention terms, sub-processor list, and
  DPA, confirmed against the account actually provisioned.
- Vercel privacy role, Runtime Logs access scoping, and data retention/deletion terms
  in force at provisioning.
- Recipient mailbox retention/deletion practice, written into
  `SiteSettings.contact.privacyNotice`.

All three require a live Vercel/Resend account, which does not exist yet (AB#116's
reopened state). This review's honest position is: **AC3 is answered for the code
boundary; the live-account half is explicitly not done and must not be marked done**
until AB#116 actually produces a deployment to verify against.

**Re-checked 2026-08-25**, against AB#116 (closed 2026-08-24) and AB#83's
Preview Sanity wiring (`docs/cache-revalidation.md`, 2026-08-25). The three
items split three ways now, not one — mailbox retention turns out not to
share the Resend items' blocker at all:

- **Vercel privacy role, Runtime Logs access scoping, retention/deletion
  terms.** The account is no longer hypothetical: AB#116 provisioned a real,
  protected Preview deployment on the customer-owned Vercel team. An earlier
  draft of this re-check claimed no Vercel CLI or authenticated API access
  existed in this session — **wrong, corrected after actually checking**:
  the then-pinned CLI (`npx vercel@58.9.1 whoami`) was already
  authenticated on this machine from earlier provisioning work, and the same
  credential reads the team API. Checked live, 2026-08-25 — **this is a
  Preview-account inspection; it is not, and does not claim to be, a
  Production hosting-tier decision or a closed Production privacy
  boundary**:
  - **Team membership**: exactly one member, role `OWNER`, confirmed — no
    names, emails, or tokens read beyond that.
  - **`billing.plan` reads `"hobby"`, not `"pro"`** — contradicting ADR-0004
    §1 and every deployment doc, which assumed Pro throughout. **No Production
    deployment existing yet does not, by itself, settle the compliance
    question**: Vercel's fair-use rule turns on the deployment's purpose of
    financial gain, not on whether it is labeled Preview or Production, so
    this repository's dual purpose as a professional software portfolio
    (`AGENTS.md`) could put the current Preview/development usage inside
    that definition already — see the residual-risk bullet below, which
    applies to Preview today, not only to a future Production choice.
    **Owner decision, 2026-08-25 (recorded on ADR-0004's own 2026-08-25
    amendment and as comments on AB#117 and AB#18): Hobby remains in use for
    development and Preview, accepting this as an open interpretation risk
    rather than a settled one; no decision has been made to use Hobby for
    Production, and the Production tier is unresolved, to be reconsidered
    immediately before AB#18.** ADR-0004's original Decision (Pro) remains
    the authoritative Production plan for now — this re-check does not
    change it, and does not grant a Hobby exception for Production.
    PhotoSite Starter as software is unaffected either way: it remains
    production-grade and commercial-capable, and any clone actually run as
    a commercial photography business needs Pro or Enterprise, unchanged.
  - **Observability Plus and exact Runtime Logs retention for the current
    Preview environment are now confirmed, not open.** Checked against
    Vercel's own current documentation
    (`vercel.com/docs/observability/observability-plus`, page dated
    2026-07-06, checked 2026-08-25): Hobby's Runtime Logs retention is **one
    hour** (not the Pro figure of one day this ADR and `docs/deployment.md`
    state for Production), and Observability Plus is **not offered on
    Hobby at all** — "Upgrade to a Paid Pro plan to access Observability
    Plus." These are facts about Preview today; if Production stays on
    Hobby, the same figures would apply there, and if Production moves to
    Pro, the original one-day (or 30-day) figure applies instead — that
    choice is what AB#18 has to make. Deployment Protection (Vercel
    Authentication) and Protection Bypass for Automation are both confirmed
    available and already working on Hobby (AB#116's verified `302` SSO
    challenge; AB#83's two working named bypass secrets), unaffected by
    which way the Production decision goes.
  - **The interpretation risk is not scoped to a future Production choice —
    it applies to the current Hobby-on-Preview usage too.** Vercel's
    fair-use rule turns on the deployment's purpose, not its label; "no live
    Production deployment yet" does not by itself put today's usage outside
    the "financial gain of anyone involved in any part of the production"
    wording, given this repository's dual purpose as a professional
    software portfolio (`AGENTS.md`). This review does not claim that
    question is settled by its own reading of the public terms, for Preview
    or for Production — the owner accepts it as an open risk for as long as
    Hobby remains in use, per the 2026-08-25 decision above. **Vercel
    Support's explicit confirmation would give certainty for the current
    Preview usage too, and becomes mandatory specifically if Hobby is later
    proposed for Production** (not decided): that path would additionally
    require the site to operate as genuinely non-commercial per Vercel's
    fair-use definition (checked directly against
    `vercel.com/docs/limits/fair-use-guidelines`, 2026-08-25) — no pricing,
    no paid services, no prints for sale, no donations, no advertising, no
    affiliate purpose. **If Pro is chosen for Production instead** —
    matching ADR-0004's original Decision — that half of the analysis
    becomes moot for Production; it does not retroactively resolve whatever
    period this team spent on Hobby beforehand.
  The gap changed from *"no account exists"* to *"the current Preview
  account is fully inspected and its facts are recorded."* **AB#117 closes
  the Preview-account inspection here. It does not close, and must not be
  read as closing, the Production hosting-tier decision or the Production
  privacy boundary** — both stay open until AB#18 actually decides the
  tier and this section is re-read against whichever one is chosen.
- **Resend account ownership, DPA, retention.** `docs/deployment.md`'s own
  environment-variable table still lists `RESEND_API_KEY` as unset and
  Production-only, and AB#18 (production promotion) is still `New` —
  confirmed via `az boards work-item show --id 18` during this re-check.
  There is no evidence a Resend account has been created at all — only that
  this deployment's own configuration doesn't reference one, not that no
  such account exists anywhere. **Owner decision, 2026-08-25: this item's
  sequencing is resolved, not left circular.** Provisioning the Resend
  account and completing this ownership/DPA/retention review is prerequisite
  work owned by AB#117 itself, done before AB#18 — not something AB#18's own
  production provisioning produces, and not a deferral or weakening of this
  acceptance criterion. AB#18's scope narrows to match: it wires the
  *already-reviewed* account into Production (secrets, sending domain) and
  verifies contact delivery, and does not itself provision or review the
  account. Recorded as a comment on both AB#117 and AB#18 (2026-08-25). The
  account itself has not been provisioned yet — that is a real third-party
  signup only the site owner can perform — so this item stays open until it
  is, now with an unambiguous owner rather than an open sequencing question.
- **Recipient mailbox retention/deletion practice.** This one does *not*
  share the Resend blocker, on inspection: Resend is only the delivery
  transport into a mailbox, not what creates one, and AB#116's own
  provisioning record (Azure Boards) confirms the site owner already
  operates a real mail service independent of this project — production
  promotion is required to preserve its existing DNS mail records. The
  recipient mailbox this item asks about is very likely that pre-existing
  service, so confirming its retention practice does not need to wait for a
  Resend account — see `docs/contact-data-flow.md`'s checklist, corrected
  the same way.

None of the three sub-items closes the Production privacy boundary by
itself, though each makes different progress. The first — Vercel — has its
*Preview*-account inspection closed: team membership, plan tier,
Observability Plus availability, and Runtime Logs retention are all checked
and recorded for the environment that actually exists today. The
*Production* hosting tier remains genuinely undecided — ADR-0004's Pro
Decision stands until AB#18 reconsiders it — so this sub-item's open action
is that decision itself, plus (only if Hobby is chosen for Production)
obtaining Vercel Support's confirmation first. The second — Resend — needs
the site owner to actually provision the account as AB#117's own
prerequisite work, then complete the review against it; the sequencing
question is resolved, the provisioning itself is not yet done. The third —
the recipient mailbox — can simply be done: confirm it with the site owner
and record its provider's retention practice.

## AC4 — Contact and webhook method, origin, schema, body-size, replay/idempotency, abuse controls

Both endpoints were already built to this exact contract (AB#12/ADR-0004 for contact,
AB#83 for the webhook) and are exercised by existing tests, re-read and re-run as part
of this review rather than newly written:

| Endpoint | Method | Origin | Schema | Body size | Replay/idempotency | Abuse control | Tests |
| - | - | - | - | - | - | - | - |
| `/api/contact` | POST-only (no other export) | `Sec-Fetch-Site` + `Origin`/`Host` same-origin check, ahead of the throttle | Closed field whitelist, honeypot | Declared + streamed byte cap | `idempotencyKey` passed to the delivery adapter | Per-instance sliding-window rate limiter, salted/hashed client key | `contact-request.test.ts` (21 cases), `contact-rate-limit.test.ts`, `route.test.ts` |
| `/api/revalidate` | POST-only | N/A (server-to-server, authenticated by signature, not origin) | HMAC signature over raw bytes verified before JSON parsing; closed document-id/type pattern | Declared + streamed 16 KiB cap | Idempotent by design — see finding #6 | Signature requirement itself bounds who can trigger it | `sanity-revalidation.test.ts` (11 cases), `route.test.ts` |

**Finding #6** (Codex's replay concern) did not hold up: see the finding register and
ADR-0011's Context section for the full reasoning — `revalidateTag` is naturally
idempotent, so there is nothing a replay ledger would prevent that isn't already a
harmless no-op.

## AC5 — Draft, private, non-discoverable, full-resolution data cannot leak

**2026-10-17 scope reconciliation:** the owner selected existing Sanity/unlisted
delivery for future client work too ([ADR-0034](adr/0034-ongoing-unlisted-client-delivery.md)).
AB#117's authoritative AC5 now records the public metadata/file exception;
its previous wording is preserved in discussion. S3/Postgres provisioning is no
longer a prerequisite for this owner. Camera masters, archive locators, private
and sales assets remain outside the public boundary. Original-JPEG/metadata/ZIP
exceptions remain limited to ADR-0028's 21 retained galleries. New galleries use
bounded public web derivatives and have no ZIP delivery yet. Their default-off
AB#303 reader checks fresh publication, pause/deadline, identity and asset metadata;
fixture gates do not establish deployed permissions, CDN behavior, quota
suitability, customer notice acceptance or final launch approval. Native Studio
drafts do not make their uploaded asset bytes private. The [runtime/data-flow
contract](deployment.md#ongoing-unlisted-client-galleries-adr-0034) records those
limits. AB#117 remains **Active**; all other findings and criteria are unchanged.
Older dated checkpoints below describe their original scope and evidence.

**2026-10-10 scoped owner decision:**
[ADR-0028](adr/0028-legacy-unlisted-gallery-continuity.md) accepts unlisted public
Sanity delivery for the 21 retained legacy galleries, separately from protected
AB#29/145. Public dataset documents and direct assets are enumerable without
authentication; page expiry does not revoke file URLs or purge CDN copies.
This explicitly differs from this criterion's original confidentiality boundary.
Before closing AB#117, reconcile that scoped accepted residual with the
work item's AC5 and the applicable visitor notice, including public source JPEGs
and embedded metadata preserved at the owner's explicit request. Verify source
hashes and true dimensions without resizing or stripping metadata, CMS display
field exclusions, fresh expiry checks, exact
link/download continuity, region and billing/cleanup limits. ZIP transport and
the entire unlisted runtime/import remain unverified. The owner rejected the
separate UpCloud/PostgreSQL order for this path; protected-store provisioning
remains separate roadmap work, not a prerequisite for the limited exception.
No customer content was uploaded by this documentation slice, and the launch
gate remains **Active**.

Scoped implementation checkpoint, 2026-10-06 (AB#199): private-gallery startup
scrubs the capability before Next captures its initial router URL. The external
bootstrap is loaded through the private root layout's `beforeInteractive` queue;
the inline queue contains only a fixed same-origin path under ADR-0011's existing
CSP residual. The pending capability remains local until parsed bootstrap markup
permits its exchange. No capability enters React props/state, history state,
browser storage or operational logs; authorized documents start no exchange.
This correction enables no Production storage or public activation. Local gates
passed: lint, 4,479 browser-free tests and the complete production-build browser
matrix (738 passes, 36 documented skips, four workers and zero retries). See the
private-gallery data flow's AB#199 checkpoint for ordering proof and the separate
shared-fixture counter concern; these checks establish no live-storage readiness.

- **Sitemap**: `sitemap.ts`'s `buildSitemapPaths` reads through the exact same seams
  (`getContentTrees`, `getServices`, locale route config) route pages themselves read
  — nothing not public/renderable/indexable can appear. No `?cursor=`/`?section=` URL
  ever enters the list (ADR-0003 decision 8's parameter-free-only rule).
- **Robots**: disallows everything for a non-production `SITE_DEPLOYMENT_STAGE` as
  defense in depth; real Preview protection is Vercel's own access control plus
  `X-Robots-Tag: noindex` (`docs/deployment.md`).
- **Private Sanity dataset**: a private dataset requires a read token; an
  unauthenticated read of a private dataset would otherwise answer 200 with an empty
  result, which the code explicitly guards against (a misconfigured site must fail
  loudly, not render as if unauthored).
- **Full-resolution derivatives**: `MAX_PUBLIC_DELIVERY_DIMENSION` (2048px) is
  enforced twice — at the Sanity schema/publish step and again at the adapter read
  step — and is the same number as the image optimizer's widest candidate, pinned by
  a test (`next-config.test.ts`'s "bounds a deployment's own derivatives to the widest
  candidate it emits").
- **Direct CDN URL exposure**: `next.config.ts`'s `images.remotePatterns` allows only
  this deployment's own validated `projectId`/`dataset` path on `cdn.sanity.io`, never
  a wildcard host — and now the CSP `img-src` restates the same validated origin
  rather than a bare `https://cdn.sanity.io` grant (ADR-0011).

**Not verifiable yet**: a live inventory of the actually-provisioned Sanity dataset's
asset store (checking for an abandoned upload, a draft still referencing a public
asset, or a sensitive filename that reached the CDN before a publish was rejected)
requires querying the selected external project. AB#84 provides a `--yes` write and
live-verification workflow (`docs/sanity-seeding.md`), but its PR #62 explicitly records
that the write-enabled CLI was not run against an external dataset, and no later owner
run is presently demonstrated. There is therefore no evidenced seeded asset store to
audit yet. A separate Sanity project *does* exist for Preview; its bounded audit and the
remaining draft limitation are recorded in the re-check below. Any eventual external
seed target must receive the same asset-listing and published-reference cross-check
before production promotion.

**Re-checked and actually run, 2026-08-25.** AB#83's Preview Sanity wiring
gives the reference deployment a live project and a dedicated `preview`
dataset (`docs/cache-revalidation.md`, "Deployed verification gate"). Two
earlier drafts of this re-check claimed the identifiers needed to query it
weren't retrievable in this session; both were wrong, corrected here after
actually checking:

- **The identifiers were retrievable — from a file already on disk.**
  `.vercel/.env.preview.local` exists in this checkout (`.vercel/` is
  gitignored, so it wasn't visible to earlier searches of the repository) —
  the product of an earlier `vercel link`/`vercel pull` run during AB#83's
  own provisioning work. It carries the deployment's real Preview values,
  including the two documented non-secret settings: `SANITY_PROJECT_ID` and
  `SANITY_DATASET="preview"` (`SANITY_DATASET_VISIBILITY="public"`,
  `SANITY_API_VERSION="v2025-02-19"`). The project id itself is not
  reproduced here, consistent with `docs/sanity-setup.md`'s existing
  ownership boundary for every other Sanity credential in this repository —
  it stays in `.vercel/.env.preview.local` and Azure Boards (recorded
  against AB#83), not in tracked files. Nothing else in that file was read.
- **The audit was then actually run** — a live, unauthenticated `GET` against
  that project's Content Lake API for the `preview` dataset, consistent with
  the dataset's declared public visibility needing no read token for
  root-level, non-draft documents. It found **exactly one document**,
  `service` type, `_id: "webhook-test-1"` (`_createdAt` 2026-08-24,
  `_updatedAt` 2026-08-25 — matching AB#83's own webhook-verification
  timeline exactly, so this is that mutation, not an unexplained document),
  published, with a null `slug` — a normal artifact of writing through the
  raw mutate API rather than Studio, which enforces that field (the same
  "Studio validation doesn't bind an API import" gap `content-tree.ts` and
  the article/gallery Studio validators already exist to backstop).
  `sanity.imageAsset` and `sanity.fileAsset` counts were both **zero**.
- **The published test artifact was removed on 2026-08-25.** After the site
  owner deleted `webhook-test-1` with a temporary Editor token and revoked
  that token, a second unauthenticated `GET` used Sanity's non-CDN
  `api.sanity.io` query endpoint. The same response returned a successful
  arithmetic canary (`2`), `null` for the exact document id, and a published
  root-document count of zero. This closes the malformed *published*
  document cleanup; it does not change the draft limitation below.
- **What this audit method can and cannot prove — corrected after a further
  review round.** An earlier draft of this section claimed that adding
  `perspective=raw` to an unauthenticated request "confirmed, not assumed"
  that no draft exists in this dataset. **That claim was wrong, and is
  retracted here.** Checked directly against Sanity's own documentation
  (`sanity.io/docs/content-lake/perspectives`, which states its walkthrough
  "presumes... an authenticated client with permissions to see both drafts
  and published content") and its IDs-and-paths access model: dataset
  *public visibility* only grants unauthenticated read access to root-level
  document IDs with no period in them; a draft's `drafts.<id>` form contains
  a period and is hidden from an unauthorized client **regardless of dataset
  visibility** — `perspective=raw` does not change that, since the
  perspective controls *which version* of a document a query resolves to,
  not *whether* the client is authorized to see it at all. An unauthenticated
  query returning zero `drafts.**` matches is therefore consistent with
  either "no drafts exist" or "drafts exist but this request cannot see
  them" — it cannot distinguish the two. **The claim this audit can actually
  support is narrower: at the time of the first read, no *published*
  (root-level) document beyond `webhook-test-1`, and no published image/file
  asset, existed in this dataset. The later non-CDN check confirms that the
  published artifact is now gone.** Whether an unpublished draft is sitting
  in `preview` — the
  literal question AC5 asks — remains unverified. The temporary Editor token
  used for deletion was revoked without running that authenticated draft
  query, so a later check needs a new, read-capable credential.
- **This document was not harmless, so deleting it was necessary.**
  `src/lib/sanity-services.ts`'s `projectPublicService` throws
  (`readString(document.slug)` returns `undefined` for a `null` slug, which
  fails the `SERVICE_SLUG` check at lines 184–189) for exactly this
  document, and `readPublicServices` calls it inside an unguarded `.map()`
  over every result row — so the *entire* services listing throws, not just
  this one row, the moment a route actually reads services through
  `SITE_CONTENT_SOURCE=sanity` against this dataset. No route read Sanity at
  the time, so it had not broken the site, and the owner removed it before
  route wiring. There is no abandoned upload or stray sensitive filename
  among this dataset's *published* content — that part of the audit is now
  clean, within the published-only limitation noted above — but the draft
  question stays open.
- **The premise of the second open question was wrong.** This review
  previously treated AB#84's 448-document fixture build as a completed
  external seed run whose target had merely been lost. PR #62's own
  verification record says the opposite: `npm run seed:sanity` and
  `--delete-all` were run in their non-writing defaults, and "The
  write-enabled CLI was not run against an external dataset as part of this
  fix." AB#84 has no discussion recording a later owner run; the repository
  and sanitized shell-history search found none either. One apparent local
  log candidate was rejected rather than promoted to evidence: a live
  non-CDN query found zero `seed--*` documents and only Sanity's unrelated
  movie-example types. The supported conclusion is therefore **not** that a
  known seed run landed in an unidentified dataset. It is that no external
  AB#84 seed run is presently demonstrated. That is a handoff/acceptance
  discrepancy, not an asset store AC5 can audit. The owner accepted the
  finding on 2026-08-25 and reopened AB#84 to `Active`; it stays there until
  evidence of the external run is supplied or the acceptance criterion is
  explicitly narrowed and accepted.

Two things remain for this Sanity finding: check `preview` for drafts with an
authenticated read-capable token, since the unauthenticated reads cannot do
so; and resolve AB#84's handoff discrepancy by either recording evidence of
an owner-run external seed or treating the live seed as work still to be done
against the deliberately selected deployment dataset. Any eventual external
run must record its project/dataset target and then receive the same bounded
document-and-asset audit. The malformed published artifact cleanup itself is
complete.

## AC6 — No tracking cookies, local tracking, or auto-loaded third-party embeds

Verified by repo-wide grep (`document.cookie`, `Set-Cookie`, `gtag`, `analytics`,
external `<script src>`) — zero matches in `src/`. The one third-party embed
(`youtube-embed.tsx`) is click-to-load, uses `youtube-nocookie.com`, and makes no
network request until a visitor explicitly clicks. Unchanged by this review; the CSP
added by this review (ADR-0011) additionally makes this a *browser-enforced* property
now (any future auto-loading third-party script or embed would be blocked by
`script-src`/`frame-src`/`connect-src` unless the CSP is explicitly widened for it),
not only a code-review convention.

## AC7 — Dependency audit and accepted residual risks

Before this review: `npm audit --omit=dev` reported 4 high-severity findings; a full
`npm audit` (including dev dependencies) reported 6.

| Package | Before | After | Fix path |
| - | - | - | - |
| `nanoid` | 3.3.16 | 3.3.18 | `npm audit fix` (semver-compatible, no `--force`) |
| `next` (bundled `postcss`) | `next@16.2.11` → `postcss@8.4.31` | `next@16.3.2` → `postcss@8.5.23` | same |
| `sharp` (next/image's optional dependency) | 0.34.5 | 0.35.3 | same |
| `postcss` (direct/Tailwind toolchain) | 8.5.25 | 8.5.25 (unaffected; already patched) | — |
| `brace-expansion` (dev, two nested copies) | 1.1.16 / 2.1.2 | 1.1.18 / 2.1.4 | same |
| `js-yaml` (dev) | 4.3.0 | 4.3.1 | same |

`npm ci` was run against the updated lockfile for a clean reinstall, and `npm audit`
now reports **0 vulnerabilities**. Every gate was re-run against the updated
dependency tree: `npm run lint` (clean), `npm test` (1616/1616), `npm run build`
(clean — after fixing finding #3, a pre-existing gap the `next` bump's broader
type-checking surfaced), and the full Playwright suite (210/210, 4 skipped
unrelated to this change).

**Resolved, not just accepted**: GitHub Dependabot vulnerability alerts and automated
security fixes were enabled during this review (`gh api -X PUT
repos/Alpine78/photosite-starter/vulnerability-alerts` and
`.../automated-security-fixes`; both verified `enabled: true`) — no new dependency, no
pipeline change. Future high/critical advisories now open their own PR automatically,
closing what would otherwise have been an accepted gap in continuous dependency
governance beyond this point-in-time audit.

**Current status: AB#186 is Closed** (zero full and production-only audit
findings; exact-main CI #655 passed with an authenticated protected Preview) —
see [current evidence](audits/ab137-renderer-readiness-2026-10-07.md#merged-source-and-dependency-gate).
The dated updates below are preserved history; AB#117 stays Active.

**2026-10-02 update (AB#186, Active then):** the old zero-finding result above is
historical. [Historical dependency evidence](audits/ab186-dependency-review.md#2026-10-02-follow-up--ab186-remains-active)
records the new 12 → 10 full-audit result, zero production-only entries, the
shared local Azure CLI tree and thirteen residual undici advisory records.
Tooling reachability and a 2026-10-13 review deadline do not constitute owner
acceptance. AB#186 is an explicit predecessor of AB#117; the current candidate's
gates and Preview verification, followed by an explicit owner decision on the
remaining tooling risk, are required before this launch gate closes.

**2026-10-07 update (AB#186, Active):** a new candidate's full audit is clear
(25 high affected package entries before, zero after); the production-only
audit remains zero. It uses a local, depth-bounded `braces` fork because no
upstream fix is published, plus a major Undici 5.x → 6.29.0 substitution in the
Vercel CLI's development dependency tree. Clean install, lint, unit tests,
production build and E2E pass. This does not certify Vercel's compatibility
with that major substitution: authenticated Preview checks and owner review
remain necessary before AB#186 or this launch gate can close.

**2026-10-07 merged verification (AB#186, Closed):** PR #281 merged after
owner review; exact main CI #655 passed quality gates and a real authenticated,
protected Preview deployment using the patched CLI tree. AB#186 was explicitly
moved Active → Closed. The Active/candidate statements above describe earlier
checkpoints; no residual advisory acceptance was needed for the zero-audit
candidate. AB#117 remains Active with its independent live privacy/security gates.
[Current evidence](audits/ab137-renderer-readiness-2026-10-07.md#merged-source-and-dependency-gate).

## Verification performed

2026-10-21 mobile reflow check: [166 pages at 320 and 375 px](audits/ab117-mobile-reflow-2026-10-21.md) — one long-word title overflowed at 320 px (fixed under AB#382); no content image lacks dimensions.
2026-10-21 afternoon checks: [third parties, cookies, layout shift, keyboard focus and redirects](audits/production-checks-2026-10-21-afternoon.md) — no third-party request, cookie or storage on 332 anonymous page loads; no load-time layout shift; one 0.12 desktop shift from a justified gallery's open last row while scrolling (owner decision); every keyboard focus stop visible; 415/415 legacy redirect rows pass.
2026-10-21 evening checks: [dark theme, interactive states, structured data, caching and indexing](audits/production-checks-2026-10-21-evening.md) — no dark-theme contrast issue; one interactive-state contrast issue (search count, AB#387); reduced motion respected; caching and variant-URL indexing match their decisions.
2026-10-21 night: [mobile performance and CSP nonce feasibility](audits/performance-and-csp-2026-10-21.md) — LCP 2.1–3.9 s on image pages under a slow mobile profile (6.4 s on a gallery page, addressed by #577/#580, not yet live); nonce-based `script-src` judged feasible now that public HTML already renders per request, pending a work item and an ADR-0011 amendment.

2026-10-23 AB#130 proof deletion: the Studio action deletes a proof gallery and all its private records (terms with key material and customer address, selection, versions, notices, reminders) in one transaction with the editor's own session, never retried; completeness comes from fresh Doc API reads of deterministic IDs and the existing terms-revision guard on every customer write and reminder claim, and it refuses rather than guesses on unreadable, copied or referenced records. The gallery's image assets are deleted with it (owner decision 2026-10-24) unless the index shows another document using one, and a use that appears later makes Content Lake refuse the whole transaction. It does not purge Sanity history or backups, reach downloaded copies or the CDN cache, or withdraw sent email; [proof-selection-data-flow.md](proof-selection-data-flow.md) records these limits and the activation prerequisites.

2026-10-23 AB#130 reminder stop: `/client-proof/<handle>/reminders` renders no gallery data and never changes state on GET; its button POSTs the fragment key to the selection route's `stop-reminders` branch, which checks only gallery identity and the key (uniform refusal otherwise) and deletes the customer's address and language with the stop.

2026-10-23 AB#130 reminder run: `/api/proof-reminders` is default-off, accepts only the platform's `CRON_SECRET` bearer token (constant-time) and answers counts only. It decrypts a selection key in memory only to build the customer's link, verifies it against the stored hash, and never logs addresses, links or keys (`proof.reminder` closed outcomes only); reminder records hold no address. The customer's address is used only as the reminder's recipient, and every reminder carries the self-service stop link. Activation needs the privacy notice to name the reminder.

2026-10-23 AB#130 photographer notice: after a committed confirmation the site emails the owner's existing contact mailbox (job reference, totals, proof numbers and original filenames; no customer address or key), with a per-version idempotency key and deterministic content. Logs carry only `proof.notice` with a correlation ID and a closed class. The confirmed version and notice are shown read-only in Studio on their private dotted IDs; nothing new reaches the public dataset.

2026-10-23 AB#130 selection page: the proof page now reads the `#select=` key in the browser and sends it only in same-origin POST bodies (superseding the earlier proof-page note that the fragment is neither read nor sent); it never enters a URL, query or log, the fragment stays out of `Referer` (`no-referrer`), and the language switch carries it only to the same gallery. Customer copy states that the key proves possession of the link, not identity. A refused key shows one uniform message.

2026-10-23 AB#130 selection write route: `/api/proof-selection` is default-off, same-origin JSON only, with per-client and per-gallery limits, a bounded closed body and a separate server-only `SANITY_PROOF_SELECTION_TOKEN`. A closed or replaced gallery, an unknown handle and a wrong key are one indistinguishable 404, decided before any private read or write; the key is compared in constant time against the terms' hash read fresh. Responses carry only the holder's own selection and the price terms, never the job reference, address or key material; logs carry a correlation ID and a closed class.

2026-10-24 AB#396 replacement publication: the FI/EN Studio action uses the signed-in
editor's session and one revision/create-guarded mutation for delivery publication and
the complete selected proof deletion. No new route, token, persisted public linkage or
processor. Target images are protected by ID; late strong references fail the whole
transaction. Unknown answers retain the exact reviewed plan for read-only reconciliation;
no automatic retry. Client/proof and private-record release versions fail Studio validation, while public
story/gallery scheduling remains. Old proof URLs become unknown/404 after deletion.
These are editorial controls, not an API ACL. Pre-existing schedules, other Studios,
direct/weak-reference writers and stale editor buffers need the
[documented pre-activation checks](adr/0038-proof-selection-in-existing-sanity.md#replacement-deletion-amendment-2026-10-24).
Fixture tests and the runtime-parser payload check do not prove hosted permissions,
release behavior or provider concurrency. No live operation or activation performed.

2026-10-23 AB#130 proof replacement: a replaced proof link redirects only to the exact referenced, available new delivery gallery (ID-bound, never a legacy handle), revealing the delivery link only to proof-link holders as ADR-0038 accepts; the redirect drops the `#select=` fragment so the selection key never travels to a delivery URL.

2026-10-23 AB#130 proof page: `/client-proof/<handle>` is a default-off, read-only public page for published proof galleries. It projects only display data (no filenames, high-water mark, terms or selection data), reads the published document by its own ID and refuses drafts, dotted private records, private-only assets and unnumbered proofs, and carries the reserved-path hygiene. The selection key in the link's fragment is neither read nor sent. Public files and metadata remain enumerable, as ADR-0038 records.

2026-10-22 AB#130: a new write route, `/api/proof-gallery/publish`, is off by default. It accepts only an exact Studio origin (CORS without credentials), checks `/users/me` and performs every read and its one atomic transaction with that editor token, so it holds no write credential; selection keys are stored hashed plus AES-256-GCM-encrypted under a server-only secret and returned once after commit. **Corrected 2026-10-24:** an Editor robot passed this identity check; it does not currently prove a human user session ([AB#401 evidence](audits/client-gallery-lifecycle-rehearsal-2026-10-24.md), follow-up AB#402). Activation waits for the terms and Studio-action slices and an owner-run hosted check ([ADR-0038 amendment](adr/0038-proof-selection-in-existing-sanity.md)).

2026-10-22 AB#130 Studio action: the publish action exists only in a Studio built with `SANITY_STUDIO_PROOF_GALLERIES=enabled`, and only that Studio signs in with `loginMethod: 'token'`, which makes the editor's token readable by scripts on the Studio origin (accepted in the ADR-0038 amendment). The action posts once, cookieless, to the configured site origin; the route binds publication to the validated draft revision and refuses unrequested terms; the customer's address is stored only when a reminder is on. Any answer other than the route's own rejection is shown as an unknown outcome without retry. Native unpublish and delete are removed so no private terms are orphaned.

2026-10-22 AB#390: public HTML now runs under a per-request script nonce (`src/proxy.ts`, `src/lib/content-security-policy.ts`); `e2e/content-security-policy.spec.ts` covers every public page family and the fixture-level guard fails any journey with a CSP violation. The 2026-10-21 header check below predates it; the next Production header check must expect the nonce policy on HTML.

2026-10-21 Production header check: [CSP, frame, MIME, referrer, permissions and HSTS headers on sampled page, API and sitemap responses](audits/ab117-production-headers-2026-10-21.md) match ADR-0011 and `next.config.ts`; no public `Set-Cookie`. It also explains why public HTML is served `no-store`: the routes read query parameters, so they render on demand (cache, not security).

2026-10-20 public Production read-only audit: [sitemap and internal-link statuses, document language, h1, alt attributes, heading levels, duplicate ids, computed control names and load timing over 166 pages](audits/ab117-public-production-audit-2026-10-20.md). No defect in those classes; one Finnish alt text on an English listing is AB#255 content work. It does not establish WCAG conformance.

- `npm run lint` — clean (re-run after every fix round).
- `npm test` — 1616/1616 unit tests pass (re-run after every fix round; +1 from the
  self-review fix round's added coexistence test).
- `npx tsc --noEmit -p tsconfig.json` — clean (also used to isolate finding #3).
- `npm run build` — clean, including TypeScript (re-run after every fix round).
- `npm run test:e2e` (full Playwright public-journey suite, production build) —
  210 passed, 4 skipped (pre-existing, unrelated to this change).
- A real production server (`npm run build && npm run start`) with `curl -I` header
  inspection confirming every new header is present with the expected value, re-run
  after the self-review fix round across every distinct response shape the application
  produces: an ordinary `200` page, a real `308` permanent redirect
  (`/stories/happenings` → `/stories/events`), a `404` (both the App Router boundary and
  an unknown path), a `410 Gone` legacy-redirect page, a `400` from `/api/gallery`, and a
  `405` from `/api/contact` — all six carry the full header set, and the two API routes'
  own `Cache-Control: no-store` (set inside the Route Handler) coexists correctly with
  the config-level headers rather than one replacing the other.
- A headless-Chromium Playwright walk of `/`, `/services`, `/services/portrait-sessions`,
  `/contact`, and a curated gallery page (including opening the PhotoSwipe lightbox) —
  zero CSP violation console messages, zero uncaught page errors, zero failed
  same-origin requests.
- A five-angle Claude `/code-review` self-review of the implemented diff (required by
  the `codex-review-loop` skill before any Codex review-fix round), whose findings are
  findings 8–10 above — all fixed and reverified by the gates above before proceeding.

## Recommended follow-up

Two items from an earlier draft of this section — GitHub branch protection and
Dependabot — are done, not merely recommended:

- **`main` branch protection**: already in place before this review started (two
  active rulesets, one added 2026-08-21) — see AC3. This review's first pass checked
  the wrong (legacy) API and incorrectly reported it missing; corrected above.
- **Dependabot**: enabled during this review (`gh api -X PUT
  repos/Alpine78/photosite-starter/vulnerability-alerts` and
  `.../automated-security-fixes`, both verified `enabled: true` afterward). This
  closes AC7's "no continuous dependency-advisory gate exists" residual-risk note —
  it's no longer accepted risk, it's closed.

Still open, not applied by this review:

1. **Complete `docs/contact-data-flow.md`'s "Before production launch" checklist.**
   Split by what actually blocks each item as of the 2026-08-25 re-check (see AC3
   above): the Vercel privacy-role/Runtime-Logs item's **Preview-account
   inspection is closed** — team membership, plan tier, Observability Plus
   availability, and Runtime Logs retention (one hour on Hobby, today) are
   all checked and recorded. The **Production hosting tier remains
   unresolved** — ADR-0004's Pro Decision stands until AB#18 reconsiders it
   (`docs/adr/0004-reference-production-host-and-ownership-boundary.md`'s
   2026-08-25 amendment) — so this item's real remaining action is that
   decision itself: upgrade to Pro (needs nothing further), or bring Hobby
   into Production (needs Vercel Support's confirmation first — see item 4
   below). **The Resend items' sequencing is decided
   (owner decision, 2026-08-25, recorded on AB#117 and AB#18):
   provisioning the account and completing this ownership/DPA/retention
   review is AB#117's own prerequisite work, done before AB#18, not
   something AB#18's production provisioning produces or that AB#117 defers
   to it.** What remains is the provisioning itself — a real third-party
   signup the site owner has to perform — and then running this review
   against the account that results. The recipient mailbox item does not
   share that blocker at all: it is very likely the site owner's
   already-existing mail service, not something Resend provisions, so it
   can be confirmed and recorded now.
2. **Resolve AB#84's live-seed handoff, and check `preview` for drafts with a
   read-capable token**
   (see AC5). AB#83's `preview` dataset was queried live 2026-08-25
   (`SANITY_PROJECT_ID`/`SANITY_DATASET` recovered from
   `.vercel/.env.preview.local`, a gitignored file already on disk), but only
   unauthenticated — which, per Sanity's own access model, can see this
   dataset's *published, root-level* content and nothing else: a draft
   sitting in this dataset would be invisible to that read regardless of
   `perspective=raw`. Within that limitation, the first read found exactly
   one published document, AB#83's own `webhook-test-1`, and zero published
   assets — no abandoned upload or sensitive filename among published
   content. That document had a null `slug`, which
   `src/lib/sanity-services.ts` will throw on for the whole services listing
   the moment a route reads Sanity services against this dataset. The owner
   deleted it on 2026-08-25; a follow-up unauthenticated `GET` through the
   non-CDN API returned a successful canary, `null` for that exact id, and
   zero published root documents. The cleanup is complete, but the same
   request still cannot see drafts. A later evidence check also corrected
   this review's earlier premise: PR #62 explicitly says AB#84 did not run
   the write-enabled CLI against an external dataset, and no later owner run
   is durably recorded. AB#84 was therefore reopened to `Active`; resolve
   that handoff discrepancy first.
   If an external run is then performed or evidenced, record its target and
   audit that dataset's bounded document/type and asset counts; separately,
   re-check `preview` for drafts using an authenticated read-capable token.
3. Re-run this review's finding register (not necessarily the whole document) before
   the actual AB#18 production promotion. AC5's `preview`-dataset audit was
   actually executed this re-check (item 2 above) — clean on published
   content and abandoned assets; its one malformed published artifact
   (`webhook-test-1`) was deleted and confirmed absent through the non-CDN
   API on 2026-08-25, while the draft question remains genuinely open
   (this session's unauthenticated read structurally cannot see drafts).
   What's left: the authenticated draft check; resolving AB#84's unperformed
   or at least unrecorded external-seed handoff before treating any target as
   auditable; AC3's Vercel item's
   still-open Production tier decision — item 4 above — which is not yet
   made either way; and AC3's Resend items, which now have a decided owner
   (AB#117, prerequisite work, per item 1 above) but still need the account
   itself provisioned and the review run against it before AB#18's own
   promotion checklist reads as complete.
4. **Decide the Production Vercel plan tier before AB#18, and obtain Vercel
   Support's confirmation first if Hobby is the chosen path.** Nothing is
   decided yet: ADR-0004's original Decision (Pro) remains the standing
   plan (see AC3 and
   `docs/adr/0004-reference-production-host-and-ownership-boundary.md`'s
   2026-08-25 amendment), and Hobby is only what Preview happens to be
   running today. If Pro is chosen for Production, this item closes with no
   further action. If Hobby is proposed for Production instead, this
   repository's dual purpose as a professional software portfolio alongside
   a personal photography site leaves a genuine interpretation risk under
   Vercel's broad commercial-usage wording that this review's own reading
   of the public terms does not settle — obtain Vercel Support's
   confirmation before AB#18 promotes production, not after.


## Scoped implementation review — AB#162, 2026-09-18

This reviews article poll voting and its historical-import extension. It does
not re-open or certify the live infrastructure checks of AB#117 above.
Authoritative scope: AB#162 description/acceptance criteria and its AB#26
relation; decisions: ADR-0018 and its completion amendment.

### Findings corrected in this branch

| Severity | Location and failure path | Correction and regression evidence |
| --- | --- | --- |
| High | `poll-vote-access.ts` / `poll-vote-sanity.ts`: separate receipt and increment requests could leave a receipt without a count; `inc` of a missing bucket also failed the first vote | One transaction contains plain receipt create, lazy tally creation, selected-bucket initialization and atomic increment. Adapter tests assert its wire contract, conflict path and simulated concurrent dedup. |
| High | First-vote identity minted in POST: losing its response lost the browser token, so a retry could increment again | Preparation establishes a stable poll cookie before any write; unprepared POST writes nothing. Browser tests abort a real successful POST response, then retry without another POST or count. |
| Medium | `poll-identity.ts`: a raw token embedded in a public receipt ID disclosed it and long IDs exceeded Sanity's limit; a shared cookie linked different polls | Bounded SHA-256 receipt IDs and independent per-poll tokens. Identity and wire tests cover canonical tokens, bounds and absence of raw token/choice/time in records. |
| Medium | Poll eligibility / CMS projection trusted malformed dates and option data | Runtime shape, date, identity, count and uniqueness checks fail closed. Tests cover impossible dates, duplicate published identities/options and invalid counts. Studio additionally prevents changing/removing published option IDs. |
| Medium | A React submitting-state check alone left a second submission possible before a render | The shared hydration guard now uses a synchronous in-flight ref. Browser regression submits the same form twice before painting and observes one POST; contact/enquiry journeys remain covered. |
| Medium | Legacy markers had no resolved poll/tally import path | The private TSV resolver checks actual totals, emits closed pairs in source order, binds counts into approval digests, and validates writer dependencies and closed-pair allow-lists. Synthetic migration tests cover tampering, language and total mismatch/overflow. The owner's actual source was parsed offline: 22 polls, 110 option rows, all totals consistent. |

No unresolved finding was identified in the reviewed code. Request tests also
cover the closed two-field POST allow-list, origin/content-type/body bounds,
quoted/duplicate cookies, ordinary GET without cookie creation, and redacted
provider failures. Provider modules retain server-only and ESLint boundaries.
No dependency or browser-policy relaxation was introduced.

### Residual limits and checks

[Poll processing record](poll-data-flow.md) records pseudonymous public-dataset
receipts, no automatic receipt cleanup, cookie duration/necessity, local-only
throttling, cookie clearing and simultaneous first-time preparations in separate
tabs. The close-date check precedes the transaction; an editor changing the poll
between that read and the write is not locked out by a cross-document revision
guard. Historical imports carry an explicitly closed sentinel, never an invented
source closing date.

Fixture tests do not certify an actual Sanity credential or execute a live
migration. Before launch, the owner must provision/check the runtime credential,
verify provider transaction/conflict behavior, review regenerated conversion
approvals/plans and audit the imported pairs. Mobile WebKit tests assert the real
Secure wire attribute but adapt cookies for the plain-HTTP loopback test origin;
an actual HTTPS deployment remains the live cookie check. The test adaptation
does not change application cookie attributes.


### Validation of the completed branch

- Full Vitest run: 153 files, 3,748 passing tests.
- Production-build Playwright run: 588 passed, 28 conditional skips, two
  failures from the existing video test's ambiguous button selector after a
  poll button was added. The selector now names the localized YouTube control;
  both Chromium/WebKit cases passed on their focused production-build rerun.
  The aggregate verified set is 590 passing cases and 28 conditional skips.
- All 12 poll cases passed in the full run. Narrow-viewport screenshot inspected.
- Production build, TypeScript, diagram rendition check and diff whitespace
  check passed. ESLint reports zero errors and one existing unrelated
  `presetMediaDark` warning in `theme-contract.test.ts:117`.

### 2026-10-04 scoped check — remaining migration text links (AB#137)

The working branch adds bounded paragraph/list links through the standalone
Studio validator, conversion, writer and Sanity public projection. The writer
rejects unknown nested fields, non-string keys, unsafe/oversized URLs and mixed
plain/linked representations. The category writer retains only safe destinations
that also satisfy the existing category path contract. Unresolved legacy links
and BA Gallery markers refuse conversion. Gallery listing-only flags require a
nonblank summary and cannot be imported as false or another value type.

The renderer uses React-escaped text and native same-tab anchors with
`noreferrer`. No raw HTML, automatic external request, new dependency, processor,
credential exposure or browser-policy relaxation was introduced. All 4,449
unit tests and lint passed. The affected production-build browser journeys passed
34 cases across Chromium and mobile WebKit, including keyboard/fragment navigation
with and without JavaScript and the external-request guard. A second full unit
run after the key/path validation corrections also passed. The first independent
Claude code review prompted a clearer owner-decision exclusion for linked intros;
the preservation test and full unit suite passed afterwards. The review was limited
to generic code, synthetic tests and tracked documentation; private migration
evidence was excluded pending explicit external-review permission.
The third Claude diff review reported no findings after the intro exclusion and
absolute-URL runbook/ADR clarifications. That round independently read the complete
current AB#137 and AB#172 requirements and discussions; earlier truncated discussion
reads were corrected. Lint, all 4,449 unit tests, the production build and the 34
focused browser journeys also passed with lockfile dependencies (Next.js 16.3.8).
The full browser suite was not run.

After the owner's explicit authorization, Claude rounds four and five also read
the private migration proposal and source evidence. Findings concerned the
approval report's alt-text scope, historical conversion decisions and provenance,
service-parent evidence, and a missing pair of portfolio records. Codex corrected
the initial reporting gaps; Claude wrote the recurring portfolio-register
correction within round five. Codex inspected those edits and verified complete
32-version coverage, the unchanged content plan, all preview hashes and eight
changed-input refusal probes. The fifth review also prompted removal of a stray
backslash before the review digest. The five-round limit was reached: the last
correction passed Codex's checks, but received no subsequent independent Claude
diff review. The earlier generic-code NO FINDINGS verdict remains scoped to that
code; it is not a clean private-artifact or launch verdict. Semantic source review
was sampled, and changed inputs in an older partial approval remain owner decisions.

The scoped Codex security self-review found no remaining security issue. This is not AB#117's launch verdict:
live target availability, the exact content/rights/privacy approval, project quota,
a recoverable Production baseline, post-import state/asset verification and write
credential revocation remain migration gates. The prepared remaining-content plan
is unapproved; no Production write or paid plan change was performed.

### 2026-10-05 operational checkpoint (AB#137/117/18)

PR #246 is merged and exact main CI #545 passed. The fresh manual prebuilt candidate
uses that source; all 607 provider archive members match local manifests. It reached
READY with deployment protection and noindex, preserving both existing aliases and the
project's Production target. The old default alias returns anonymous HTTP 200; activating
it changes public serving code and still requires the release gates. The immutable
candidate's protection is distinct from that public alias. Fourteen current-content
route/pagination GETs pass. Contact
GET and four fixed rejected POST probes pass; no test reaches the delivery adapter.
The owner verified a real email and Reply-To on the preceding candidate. Current
Production delivery settings exist, but actual delivery from the new source is unverified.

The approved content and category digests are unchanged. Both dry runs, complete
baseline freshness, zero collision results, quota projection and all 3,512 derivative
checks pass. Seven shared existing assets and all baseline IDs are protected by the
rollback guard. No Production CMS write or revocation occurred. The current operator
is an Administrator and production/preview visibility is public; region was not returned
by the checked metadata endpoints. Token and robot-principal inventories are separate;
the cleanup scope still needs reconciliation, including the old temporary Editor.
The read-only audit credential's effective permissions were verified separately.

[The contact checkpoint](contact-data-flow.md#2026-10-05-account-and-notice-checkpoint)
records the actual Resend provisioning, provider residence, tracking uncertainty and
missing CMS notice fields. Account MFA, credential scope, terms/retention and mailbox
deletion practice remain open. The owner's earlier approval to rotate the exposed
Vercel automation bypass was executed: the private receipt records old-secret rejection,
replacement verification and consumer updates; fresh readback verifies the replacement
entry and protected access. No second rotation or approval is needed for that incident.
Secret values and private content/evidence are not committed.

This checkpoint does not close AB#117. AB#132's exact local production-build probes still
fail semantically without JavaScript; no acceptance is recorded. AB#186's current full
audit adds tooling advisory families and requires a current residual decision before
promotion. The Production hosting-tier decision, physical-device check, pending legacy
routes, compatible serving-code activation, approved import, full post-write audit and
credential revocation remain open. The October 8 go/no-go and October 15 legacy-host
removal dates remain in force; Infomaniak mail must survive any web-DNS change.

### 2026-10-07 email-account MFA confirmation (AB#117)

The owner confirms two-factor login is enabled on both Infomaniak and Resend
(AB#117 comment `59470`). This resolves those accounts' MFA checklist item on
owner confirmation, superseding the October 5 uncertainty above; no independent
dashboard inspection was performed. Resend sending-only/domain-scoped key access,
tracking settings, provider message/log/backup retention and practical twelve-month
correspondence deletion remain open. AB#117 stays Active. No account setting or CMS
content was changed by this documentation update.

### 2026-10-07 email settings confirmation (AB#117)

The owner confirms the existing Resend key already has Sending access restricted to
the verified sending domain, both open and click tracking have been turned off, and
the account uses Free (AB#117 comment `59471`). These resolve the key-scope and
tracking checklist items on owner confirmation, superseding their uncertainty above;
no independent dashboard/API readback was performed. Resend's published Free policy
specifies 30-day email/log retention and 7-day backups, as recorded in
[the contact inventory](contact-data-flow.md#2026-10-07-owner-preferences-and-notice-draft-ab117-ab18).
The owner-supplied Infomaniak description matches kSuite Free on the official
comparison. Its published guidance excludes in-plan mailbox restore and describes
up to 30-day recovery after upgrading; this does not establish absence of backups.
Comment `59472` records the product identification and the owner's explicit commitment
to twelve-month enquiry/own-copy deletion with necessary contract/legal exceptions.
This confirms the owner policy, not an implemented automatic job or observed deletion.
Exact technical backup erasure and remaining provider/launch checks stay open.
AB#117 remains Active; no CMS write or provider change was performed by this task.

### 2026-10-08 fresh Production preparation (AB#117/137)

The [afternoon checkpoint](audits/ab137-production-preparation-2026-10-08.md) records exact main CI #719 with real protected Preview deployment, a manual Production-configured prebuilt candidate and all 611 provider archive members matching its frozen source/artifact manifests. Thirty current-content GET checks passed. The two scriptless 404 probes remain expected semantic failures; the October 7 owner acceptance is preserved without a new acceptance or GO decision.

A new read-only complete baseline and final raw revision comparison cover 3,593 documents and all 1,748 asset binaries. New binary-header inspection covers every archived public image; all 3,512 planned derivatives, both offline writer dry runs and raw collision/shared-asset checks passed. A fresh root dependency audit reports zero vulnerabilities and matches the frozen package/lockfile hashes; this is not independent certification of vendored patches. No real restore or full existing-content approval traceability is claimed.

The [provider/notice record](contact-data-flow.md#2026-10-08-provider-contract-and-scoped-notice-preparation-ab117137) distinguishes Resend's automatically effective DPA from the unresolved applicability of Vercel's Pro/Enterprise DPA to the still-Hobby team. Existing MFA, key-scope, tracking-off and deletion confirmations are retained. Exact Infomaniak Free backup erasure remains unverified. The refreshed notice is an offline, revision-bound single-field proposal; no CMS notice/bulk write occurred.

AB#117 remains Active pending actual content migration and post-write audit/revocation, the remaining provider/hosting resolution, legacy targets and final public launch evidence. No billing upgrade, public promotion, email delivery, DNS change or physical-device verification was performed. Private helpers received scoped local boundary checks, not a claimed independent line-by-line review or a full launch approval.

### 2026-10-08 approved notice and operator signing-key incident (AB#117)

The owner approved the exact FI/EN notice. The [publication record](contact-data-flow.md#2026-10-08-owner-approved-notice-publication-ab117137)
records its guarded single-field write, independent reads, complete post-write
baseline and rendered Finnish copy after normal signed cache reconciliation.

A local operator assertion diagnostic exposed two active webhook signing values.
The error boundary was corrected to withhold values. Controlled, deliberately
invalid-schema requests established that one value is accepted by current Preview
and the other by the old serving Production deployment and protected candidate;
those scope probes never produced a cache plan. The separately identified two
legitimate Production recovery calls were accepted. CMS write credentials, email
keys and the Vercel bypass were not exposed by that diagnostic; no credential value
is committed in this record. No unauthorized use was observed or ruled out.

The owner subsequently authorized the prepared key/alias maintenance and deletion
of its three named old deployments. Both Vercel signing variables were replaced
with distinct environment-specific Secret values. Unrelated environment metadata
was unchanged. Protected replacements retain the original provider source-archive
UIDs; output paths match, while packaged runtime UIDs may change. Current runtimes
accept the new signatures, reject both exposed values, and acknowledge valid
signed reconciliations. Two active local credential files were synchronized.

Production aliases now point to the maintenance replacement using the **same old
application source**. During maintenance, CI deployed merged PR #304 to stable
Preview; its new signing key was verified and that newer deployment was preserved.
The compatible Production candidate remains protected and unactivated. The three
authorized old immutable deployments were deleted; each now returns provider
`404 DEPLOYMENT_NOT_FOUND`. The bypass inventory is unchanged. All 3,593 raw CMS
document revisions still match the complete post-notice baseline; this maintenance
made no CMS document, billing, mail-delivery or DNS change.

Two concrete residuals prevent a claim of full remediation:

- **Historical keys:** all 90 listed historical deployments were inventoried. Of
  86 other READY versions probed, 80 still accept the exposed environment key
  (6 Production, 74 Preview), with the new-key control rejected. All 80 return a
  verified anonymous Vercel SSO challenge. They were not covered by the three-ID
  deletion authorization and remain retained; a private, individually identified
  retirement proposal is prepared. No blanket revocation or absence of misuse is
  claimed.
- **CMS-triggered delivery:** the Preview hook's dataset mismatch was corrected
  on October 9 after the owner's separate explicit approval. Both deployment
  environments' actual `production` data source was reread through the
  single-variable endpoint; only the existing hook's dataset changed from `preview`
  to `production`. Readback proves all other settings, including the rotated
  secret, URL, headers, filter and identity-only projection, are unchanged. Direct
  signed production-update and duplicate requests each returned 200; wrong-dataset
  and wrong-signature controls returned 403 and 401. These were manual receiver
  probes, not Sanity-generated deliveries. Automatic delivery remains to be
  observed on a genuine CMS change; no test content was written. The stable Preview
  alias and all 3,593 raw document IDs/revisions/types remained unchanged across
  the operation. No Production hook was created. The October 8 automatic approval
  rejection applied to the earlier secret-only scope; the separate October 9
  owner approval covers the completed dataset correction.

AB#117 remains Active for these residuals and the existing launch gates. Private
operator helpers received scoped self-verification, not an independent line-by-line
review or a full security/privacy approval.


### Production import completion evidence, 2026-10-09 (AB#137 / AB#117)

The [AB#137 completion addendum](audits/ab137-production-launch-2026-10-09.md#completion-addendum-2026-10-09)
records the completed approved import, authenticated raw document/asset checks,
494 anonymous route/gallery GET cases, the fresh pre-service-price baseline and
subsequent exact service checks. The dedicated migration credential is retired with
management readback and a 401 denial; unrelated credentials were preserved.

A post-retirement authenticated raw comparison verifies unchanged non-group
revisions and the narrowly recorded system-group revision/timestamp changes and
revoked-member removals. Earlier failed strict/retry evidence is retained. These
receipts do not establish full historical content approval, dataset region,
physical-device acceptance, restored recovery or retirement of other Editor keys.
The final private PNG correction was self-verified after the Claude round limit,
not certified by another clean operator review.

AB#117 stays Active. The protected historical old-key receivers, pre-DNS alias
indexing, remaining legacy mapping and private-customer continuity remain explicit
residuals alongside final launch controls. No new CMS mutation, credential
retirement, contact POST or DNS change was performed by this documentation follow-up.

## Original legacy JPEG file delivery — 2026-10-14 (AB#250 / AB#117)

The retained-gallery byte gate rejected an ordinary image-CDN response because
its bytes differed from the unchanged uploaded JPEG. Upload metadata alone does
not prove public delivery preserves embedded metadata. The explicit alternative
JPEG file binding is validated in the importer/compiler, legacy reader and byte
verifier; it renders through the file CDN with no optimizer or transforms.

The effective browser policy must permit that same configured project/dataset
file path in `img-src`; otherwise valid file bytes are blocked at presentation.
The scoped amendment to ADR-0011 adds this path without granting a bare CDN host,
other projects/datasets, script/connect access or file access through the public
optimizer. Ordinary public media and protected-gallery delivery contracts are
unchanged. The import approval and complete live byte/browser checks are separate
gates. This source correction does not claim customer publication, provider
support, completed credential retirement or the final AB#117 acceptance.

## Site search — 2026-10-15 (AB#299 / AB#117)

Scoped review of the new untrusted-input surface: `POST /api/search`, the
`?q=` results page and the story index read. [ADR-0033](adr/0033-unified-site-search.md)
(Proposed) and [`search-data-flow.md`](search-data-flow.md) hold the decisions and
the processing record. This is a source review with fixture-based tests, not a
live-infrastructure check.

**Checked and held:**

- *Request boundary.* The endpoint exports `POST` only, rejects a foreign or
  missing `Origin` and a non-JSON body before reading the body, bounds the body
  to 1 KiB, accepts exactly two string fields, and validates `lang` against the
  configured locales. Responses are `no-store` with no CORS headers. Covered by
  `src/app/api/search/route.test.ts` and `e2e/site-search.spec.ts`.
- *Query as data.* Input is truncated to 100 characters and 8 tokens of at least
  two characters; `*`, quotes and `-` are separators; a query with no usable word
  matches nothing. No visitor text reaches GROQ at all — matching is in memory —
  so the injection and "match everything" classes of a CMS query do not arise.
- *Output.* No `dangerouslySetInnerHTML`: highlights are text nodes in `<mark>`,
  and the echoed query is rendered by React. A hostile query is asserted to
  appear as text only.
- *Projection.* The story read names its fields, shares the audited public-media
  projection for covers, is capped at the client's 1 MiB response ceiling and
  fails closed on a malformed or oversized answer. A hit carries a title, lead,
  date, public route and a cover's public `src` with true dimensions; the
  contract test pins the exact key set, so no media identity, caption, credit or
  provider field crosses to the browser.
- *Eligibility.* A hit exists only when the locale's content tree gives the page a
  canonical path (services: resolved and not hidden), so drafts, unpublished,
  ended, secondary-only, private-gallery and retained delivery pages cannot be
  found, and the link is the public route itself.
- *Privacy.* No cookie, storage, analytics or third party; the term is in a POST
  body from the dialog, never in a URL, and is never logged or sent to the CMS.
  The no-JavaScript results page keeps it in the URL by design, recorded as an
  accepted, documented exposure.
- *Browser policy.* No CSP change: the dialog's `fetch` is same-origin
  (`connect-src 'self'`), the veil uses a background token, and nothing inline is
  added beyond the CSSOM scroll lock the header already uses elsewhere.

**Residual and open (not findings):**

- No application rate limit. A warm search makes no upstream call, so distinct
  terms cost bounded CPU rather than quota; the platform firewall is the defence
  in depth (ADR-0004 §5). ADR-0033 names the trigger for adding one.
- The index's size, record count and search latency are **unmeasured on Preview**
  (ADR-0033 §4); a very large archive would approach the response ceiling and
  the design's revisit trigger.
- A hosting provider may record the results-page query string in its request
  log; its retention is not this deployment's to state and belongs in the launch
  review's provider checklist.
- Manual keyboard and screen-reader passes, and a hosted check of `/haku` after
  the owner updates `SITE_LOCALE_ROUTES`, are still to be recorded.


## Browser-local article continuity — 2026-10-18 (AB#20 / AB#362 / AB#364)

The owner explicitly accepted device-local reading continuity: stable article
identity, locale, existing chapter anchor and save timestamp, retained for up to
90 days. The versioned storage port validates exact fields, age, count and
serialized bounds; it touches only its positions and disabled-preference keys.
No article title, full URL, image, pixel offset, visitor identity, request or
external processor is added. Local article identifiers can still reveal reading
history to someone with access to the same browser profile. Article settings
explain device-only retention and offer disable/clear; persistence failures are
reported honestly, with session suppression and no promise that denied removals
revoke bytes across a restart. Expiry cleanup runs on next use.

The browser integration preserves explicit fragments and native history, avoids
focus/history/URL mutation during restoration, and saves only accepted deliberate
article reading. Settings/observer share browser-only state; server rendering
never acquires storage or shares reader data between requests. Gallery bodies,
CSP, cookies, contact processing and CMS/media projections remain unchanged.
The [policy and verification boundary](article-reading-position.md) distinguishes
automated process restart from physical devices/bfcache. This is a functional
and data-flow review, not a new legal conclusion or launch approval.

## Dependency alert check and temporary residual — 2026-10-19 (AB#160)

Read on 2026-10-19 through the GitHub API and the repository's Security overview:
Dependabot vulnerability alerts and Dependabot security updates are enabled, and
secret scanning with push protection is enabled. Dependabot has opened and the owner
has merged security and version PRs, for example #228, #229, #269 and #270. Security
policy and private vulnerability reporting are **disabled**; this check changes
neither and they remain for the launch review.

**Open alert #66** (GHSA-hp3w-g68c-fv3c, medium, CVSS 5.3, CWE-1284): `sprintf-js`
denial of service through unbounded precision specifiers, affecting versions up to
1.1.3 with no patched version published. GitHub reports it against
`studio/package-lock.json` as scope `runtime`. The locked version is 1.0.3, reached
only through `sanity` → `@sanity/cli` → `@vercel/frameworks` → `js-yaml` →
`argparse`; the root application lockfile does not contain it. This was read from
the lockfile, not from an installed tree, and the Studio's use of `argparse` was not
inspected.

**Owner-accepted temporary residual (2026-10-19):** the owner accepted the open alert
for one month. *Assessment, not verified:* the dependency sits in the Studio's
command-line tooling chain, outside the public site's runtime, and no visitor input
is believed to reach it. *Review:* 2026-11-19, or sooner when a patched version is
published; re-read the alert and the lockfile then. No code or dependency changed.

**Enforced by the scheduled audit (AB#380, 2026-10-20):** the daily audit failed on this
accepted chain (#1279, #1311). `sanity` 6.20.0, the latest release, resolves the same
chain, so no update removes it. The acceptance is now a dated exception in
`scripts/npm-audit-accepted-advisories.json` bound to advisory source 1241202
(GHSA-hp3w-g68c-fv3c), the nine reviewed Studio install paths (the eight chain packages plus `@sanity/locale-fi-fi`, which inherits the same advisory only through its peer dependency on `sanity`; one npm audit run reported it and local runs did not, for a reason not determined) and a moderate ceiling.
It turns the Studio audit green as `accepted` until 2026-11-19 00:00 UTC; after that,
or on a new advisory, package, install path or severity, the audit fails again.

**Notification delivery is not demonstrated.** The owner searched their mailbox and
found no GitHub Dependabot message newer than 2024; the 2024 messages belong to other
repositories. So no notification email for this repository's alert #66 (opened
2026-10-11) or for its Dependabot PRs has been seen. Whether that is a GitHub
notification setting, a mail filter or another cause is unknown and is not inferred
here. AB#160's notification-delivery acceptance therefore remains open and nothing
here claims it met.

## Optional site analytics — 2026-10-19 (AB#371 / AB#117)

**2026-10-20 (AB#376):** `@vercel/speed-insights` 2.0.0 (Apache-2.0) adds a second,
independent opt-in, `SITE_SPEED_INSIGHTS`, with the same production-only,
public-shell-only and URL-scrubbing controls and an unchanged CSP. It is off until
the runtime checks and the owner's no-banner assessment in
[analytics-data-flow.md](analytics-data-flow.md#speed-insights-ab376) pass.

ADR-0037 adds an off-by-default page-view statistics adapter. It changes AC6's
"zero matches for `analytics` in `src/`" statement: `src/lib/site-analytics.ts`,
`src/components/site-analytics.tsx` and the `SiteRoot` wiring now exist, and
`@vercel/analytics` 2.0.1 (MIT, no transitive dependencies) is a production
dependency whose client code is bundled. It is inert unless a production
deployment sets `SITE_ANALYTICS=vercel`; development, Preview and the
Playwright harness stay off even if the value is inherited, and an unknown value
fails the build.

Controls: the script is rendered only by the public shell, never by the private,
client or administrator document shells; a second layer drops events from the
reserved namespaces (derived from the Proxy's configured prefixes, with
locale-prefixed, encoded and mixed-case aliases) and reduces every other URL to
its pathname, so no query string or fragment token reaches the provider
(ADR-0004). The CSP is unchanged. The package's client code contains no cookie
or web-storage use (checked in the installed build), and the default
no-script/no-cookie state is pinned by a public-journey test.

Open and **not** claimed here: the provider's own script behaviour on a deployed
site (CSP, Proxy handling of `/_vercel/*`, absence of cookie and storage
writes, namespace exclusion in the dashboard) is verified after the first
Production deployment and recorded in [analytics-data-flow.md](analytics-data-flow.md);
Vercel's role for Web Analytics data under its current DPA is still to be
recorded; and whether the processing is exempt from consent is a legal question
this review does not answer. No tracking cookie, banner or third-party origin is
introduced by this change.

### 2026-10-24 source review: delivery cleanup (AB#397–398)

The separately gated delivery-cleanup endpoint authenticates before provider IO,
rejects Preview, holds a dedicated server-only token behind an ESLint-bounded
facade and returns/logs closed counts only. HEAD cannot invoke the mutating GET.
Snapshots and Doc responses are bounded and validated; uncertain mutations are
read back and fenced by the exact private control revision before another attempt.
Source/gallery/asset revisions and strong-reference integrity arbitrate atomic
deletion against competing publication and known asset uses.

Residuals requiring hosted acceptance: full dataset READ includes transient private
proof fields; the export cannot attest hidden documents. Image-asset WRITE grants
may be broader than enrolled ownership. Late weak/direct-API release writers are
not closed by Studio validation. Shared assets are retained without a later sweep;
provider caches, downloads, history and backups are outside ordinary deletion.
The [cleanup runbook](client-gallery-cleanup.md) records the role, capacity,
provider-semantics, synthetic-race and privacy-notice checks. Source tests/review
do not establish live permission or authorize activation. Both flags remain off.

AB#399's source-only read-readiness probe adds a private manifest, explicit opt-in,
GET-only exact export/Doc URLs, bounded file/response processing and cause-free
closed diagnostics. Raw private records pass through local operator memory, never
reports/persistence/CI. Named canary matches and capacity measurements do not prove
global READ or token-role identity, WRITE/atomic deletion or hosted allowance.
Synthetic fixtures cover refusals and redaction; that source slice executed no
actual probe. The separately authorized AB#401 run on 2026-10-24 subsequently
measured real reads and synthetic deletion, with readiness still false. See the
[dated evidence and remaining findings](audits/client-gallery-lifecycle-rehearsal-2026-10-24.md).

## 2026-10-25 proof-image deletion guards (AB#404)

The manual proof-deletion and replacement-publication source now retains each
candidate image's fresh revision and submits a guarded patch immediately before
its delete, within the existing atomic operation. Deterministic fixtures cover
changed/deleted assets rolling back the whole unit, malformed/missing read evidence,
and untouched shared/target images. The shared-use query and Content Lake's strong
reference check remain the separate reference-integrity boundary; an asset revision
does not change when another document adds a reference. This is source verification,
not a rerun of AB#401 or the launch review. Hosted permission/error-shape acceptance,
controlled writers and unsupported weak references remain open. See the
[deletion procedure](proof-selection-data-flow.md).
