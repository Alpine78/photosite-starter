# Production security and privacy launch review (AB#117)

**Date:** 2026-08-22
**Reviewer:** Claude Code, with an independent Codex CLI plan review and a project
owner decision on scope (see "How this review was run")
**Work item:** AB#117 — "Run production security and privacy launch review"

This is the launch-gate review AB#117's acceptance criteria require. It is a
point-in-time review: rerun it (or at least re-check the finding register below)
before every subsequent production promotion, not only once.

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
   `DeployPreview` stage as `skipped`, not `succeeded`, matching `AGENTS.md`'s own
   feature-status text ("the deploy stage has never run and no release candidate has
   ever been produced or verified") rather than the Closed state the board carried.
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

- **CSP**: shipped, strict on every directive except `script-src`/`style-src`
  (`'unsafe-inline'`, documented accepted residual risk — Next.js App Router's own
  inline hydration script and inline style attributes require it or a
  static-rendering-breaking nonce migration; see ADR-0011).
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
  the repository-pinned CLI (`npx vercel@58.9.1 whoami`) is already
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
requires querying the real project. AB#84's seed script already ran against a real
Content Lake project with a `--yes` live-verification step
(`docs/sanity-seeding.md`) — that verification covers the *seeded* content's shape,
not a general audit of everything ever uploaded to that dataset. This is a
narrower, real gap than AC3's "no live account exists" gap (a Sanity project *does*
exist here), and is recorded as a follow-up: run the dataset's own asset-listing query
and cross-check against what's referenced by a published document before production
promotion.

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
  `sanity.imageAsset` and `sanity.fileAsset` counts are both **zero**.
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
  support is narrower: no *published* (root-level) document beyond
  `webhook-test-1`, and no published image/file asset, exist in this
  dataset.** Whether an unpublished draft is sitting in `preview` — the
  literal question AC5 asks — remains unverified, and would need a real,
  authenticated Sanity token with draft-read permission to check, which this
  session does not have and did not use.
- **This document is not harmless, though, and closing the audit here would
  be wrong.** `src/lib/sanity-services.ts`'s `projectPublicService` throws
  (`readString(document.slug)` returns `undefined` for a `null` slug, which
  fails the `SERVICE_SLUG` check at lines 184–189) for exactly this
  document, and `readPublicServices` calls it inside an unguarded `.map()`
  over every result row — so the *entire* services listing throws, not just
  this one row, the moment a route actually reads services through
  `SITE_CONTENT_SOURCE=sanity` against this dataset. That is not true today
  (no route reads Sanity yet, `docs/deployment.md`), so nothing is broken
  right now — but it is a live landmine for the first PR that wires services
  into a route against this dataset, and it should be deleted (or corrected
  with a real slug) before that happens. This session has no write-scoped
  Sanity credential — `.vercel/.env.preview.local` carries only the runtime
  app's values, and a write token is deliberately never placed in a deployed
  environment (`docs/sanity-seeding.md`) — so deleting it is the site
  owner's action, not something performed here. There is no abandoned
  upload or stray sensitive filename among this dataset's *published*
  content — that part of the audit is genuinely clean, within the
  published-only limitation noted above — but this one malformed published
  document is a real, actionable follow-up, not a closed finding, and the
  draft question stays open.
- **That result also settles the second open question**, decisively rather
  than by inference: `preview` is *not* where AB#84's 448-document seed run
  (6 `media`, 6 `category`, 1 `siteSettings`, 1 `homePage`, 3 `service`,
  3 `article`, 2 `gallery`, 426 `galleryPlacement`) landed —
  `webhook-test-1` is AB#83's own artifact, unrelated to that seed run.
  Zero `media`, `category`, `article`, `gallery`, or `galleryPlacement`
  documents exist here, against an expected several hundred. The seed
  script's own contract explains why: it writes to
  whatever `--dataset` its operator names, with no fixed relationship to any
  deployment's Preview/Production dataset (`docs/sanity-seeding.md`: "nothing
  stops you from pointing it at your real production dataset... or a
  throwaway dataset first"). Wherever AB#84's actual seed content lives, it
  is a *different* Sanity project/dataset than the one AB#83 wired to
  Preview — this session has no record of which one (not in `.env.local`,
  not on AB#83/AB#84/AB#116 in Azure Boards, not in this repository), and
  that dataset — the one that actually holds the 6 real demo photographs
  this audit exists to check for abandonment — remains unaudited.

Three things remain, each narrower than "no live account exists" ever was:
identify which project/dataset AB#84's seed run actually targeted (the
operator's own shell history or terminal scrollback from that session is the
likely record, since nothing durable captured it), then run this same query
shape against it; delete or fix `webhook-test-1` in the `preview` dataset
before any route reads services through it, since it is a confirmed
landmine, not a closed finding; and check `preview` for drafts with an
actually authenticated token, since this session's unauthenticated read
could not do so and AC5 asks specifically about drafts.

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

## Verification performed

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
2. **Run a live Sanity asset-store audit against AB#84's actual seed target,
   clean up `preview`, and check `preview` for drafts with a real token**
   (see AC5). AB#83's `preview` dataset was queried live 2026-08-25
   (`SANITY_PROJECT_ID`/`SANITY_DATASET` recovered from
   `.vercel/.env.preview.local`, a gitignored file already on disk), but only
   unauthenticated — which, per Sanity's own access model, can see this
   dataset's *published, root-level* content and nothing else: a draft
   sitting in this dataset would be invisible to that read regardless of
   `perspective=raw`. Within that limitation: `preview` holds exactly one
   published document, AB#83's own `webhook-test-1`, and zero published
   assets — no abandoned upload or sensitive filename among published
   content. That one document has a null `slug`, which
   `src/lib/sanity-services.ts` will throw on for the whole services listing
   the moment a route reads Sanity services against this dataset — a real,
   confirmed landmine that needs deleting or fixing before that happens, not
   a closed finding. The published-content result also shows `preview` is
   not where AB#84's 448-document seed run (6 real demo photos among them)
   landed — that script always writes published, root-level documents, so
   this conclusion doesn't depend on the draft-visibility limitation — so
   the audit AC5 actually needs, against whichever dataset that content
   landed in, has not happened yet. What remains: identify which
   project/dataset AB#84's seed run targeted, then run this same query shape
   against it; delete or fix `webhook-test-1`; and re-check `preview` for
   drafts using an authenticated token, since AC5 asks specifically about
   drafts and this pass could not answer that.
3. Re-run this review's finding register (not necessarily the whole document) before
   the actual AB#18 production promotion. AC5's `preview`-dataset audit was
   actually executed this re-check (item 2 above) — clean on published
   content and abandoned assets, one confirmed cleanup item
   (`webhook-test-1`'s null slug), and the draft question genuinely open
   (this session's unauthenticated read structurally cannot see drafts).
   What's left: that cleanup; the authenticated draft check; AC5's audit
   against AB#84's real seed target, once identified; AC3's Vercel item's
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
