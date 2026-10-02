# Dependency vulnerability monitoring (AB#160)

The dependency inventory is the committed `package-lock.json`. GitHub Dependabot
alerts and security update pull requests remain enabled; the scheduled Azure
Pipelines audit adds a check when `main` has not changed. Neither channel merges
a dependency update automatically.

## Detection and ownership

- The `Daily dependency audit` schedule in `azure-pipelines.yml` runs at
  **06:00 UTC**, every day, on `main`, with `always: true`. Its separate job
  runs `npm audit --include=prod --include=dev --audit-level=low` on the
  committed lockfile. A finding or registry error fails the job, and the log
  gives the advisory detail. A scheduled run skips the normal quality gates and
  Preview deployment; push and PR runs retain them.
- The repository owner is the accountable reviewer. In Azure Pipelines, the
  owner must subscribe to failed runs for this pipeline and verify delivery to
  an address they monitor. In GitHub, the owner must watch the repository with
  **Security alerts** selected and verify notification delivery in the account's
  notification settings. A green/failed log is not a delivered notification.
- GitHub's repository security settings are a second detection channel. On
  2026-09-27 the vulnerability-alerts API returned **204** (enabled), and the
  automated-security-fixes API returned `{"enabled":true,"paused":false}`.
  This verifies configuration, not a future notification or pull request.
  The available GitHub token lacks the `notifications` scope, so the owner's
  repository-watch and delivery settings could not be checked through that API.
- When the YAML reaches `main`, check Azure Pipelines' **Scheduled runs** view
  for the effective schedule. A schedule configured in the pipeline UI takes
  precedence over YAML; remove that override if present. On 2026-09-27 the
  existing pipeline definition showed only CI and pull-request triggers, with no
  UI schedule. Confirm one actual scheduled run and the failure subscription
  before treating the gate as live.

## Triage each finding

1. Record the advisory ID, affected package and resolved lockfile version,
   severity, dependency path, first detected date, and where the package runs:
   public server, browser, build/deployment tooling, or test tooling. Check
   code and deployment usage; the npm/GitHub `prod` or `runtime` label is
   only a starting point.
2. Check the upstream advisory for affected version ranges, exploit
   preconditions, and the first fixed version. Confirm whether a compatible
   update exists; `npm audit fix` is a suggestion, not approval to rewrite the
   lockfile or cross a major version.
3. For a fix, update `package.json` and `package-lock.json` together in a
   reviewable branch. Run lint, tests, build, and browser journeys. Review
   changed transitive packages and the Preview deployment before promoting a
   production revision through the existing release gate. Never auto-merge a
   security PR.
4. If no usable fix exists, record the exposure analysis, mitigations, owner,
   next review date, and a deadline or trigger for revisiting the decision on
   a work item. Leave the alert and scheduled failure visible until a reviewer
   deliberately resolves or dismisses it with a reason. An unavailable fix is
   not a clean audit.
5. Separately check [Node.js security releases](https://nodejs.org/en/blog/vulnerability/)
   for the pinned Node major and [Next.js security releases](https://nextjs.org/blog)
   for the installed Next.js version at least with the daily audit review.
   An npm audit with no finding does not prove those platforms are current.
   For Node, align the pipeline, `package.json`, and Vercel runtime pins
   before deployment; for Next.js, test the exact resolved lockfile version.

Prioritize a confirmed issue on a reachable public runtime. A critical or high
finding gets same-day review; the reviewer records a time-bound decision when a
fix cannot be shipped that day. Lower-severity findings are reviewed during the
next weekly maintenance pass. These are review targets, not a promise that a
particular upstream fix exists.

## Initial evidence and remaining live check

On 2026-09-27, running the exact scheduled command against `main`'s
`package-lock.json` returned **28 vulnerable package entries**: 1 low,
11 moderate, 15 high, and 1 critical. The entries form a dependency chain
through the direct `vercel@59.11.7` package. The same 28 entries remained under
`npm audit --omit=dev` because this CLI is currently declared in
`dependencies`. A source search found no application import of `vercel`;
the pipeline uses a separately pinned global CLI for deployment. This is
evidence that the package's manifest classification needs review, not proof
that every advisory is exploitable in the deployed site. Do not blindly apply
npm's offered `vercel@54.17.3` downgrade: it crosses a major version and is
not the CLI version pinned by the deployment pipeline.

The nonzero audit result is a controlled check of advisory retrieval and
failure behavior on the committed lockfile. The after-merge scheduled run,
maintainer notification delivery, a reviewed dependency/lockfile update, CI
gates, and deployment follow-through are still required to complete this
story's end-to-end demonstration. Record their run/PR/deployment links on
AB#160 once observed.

### Next.js advisory checked during this change

At the initial 2026-09-27 check, the committed lockfile resolved `next@16.3.3`. [GHSA-vcvr-r3jv-pc5j](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j)
affects 16.2.0 through 16.3.5 when an application passes attacker-controlled
values into SVG rendered by the Node `next/og ImageResponse` implementation;
16.3.6 is patched. A repository search on 2026-09-27 found no
`next/og` or `ImageResponse` use in this application, so that stated exploit
precondition was not found here. This is a source-based exposure assessment,
not a claim that an outdated framework needs no maintenance.

A trial `next@16.3.6` package/lockfile update passed lint, all 4,166
browser-free tests, the production build, and isolated Chromium and WebKit
journeys. The full Playwright run lost its `next start` server and subsequent
tests received `ECONNREFUSED`: once after 326 passes at four workers and again
after 177 passes at two workers. The same two-worker sequence with the original
16.3.3 lockfile passed beyond 380 tests before that comparison was deliberately
stopped. This suggests a version-associated problem under sustained test load,
but does not establish the framework's root cause. The trial update was removed
from this branch rather than offered for deployment with a failing gate.

**Time-bound decision:** the repository owner should retest a patched Next.js
release by 2026-09-30, when the [announced September security release](https://nextjs.org/blog)
is due, or investigate the 16.3.6 process exit sooner if `ImageResponse` use
is introduced. Record the tested version, the full browser gate, and the
deployment result on AB#160. The current source has no identified path to the
specific `ImageResponse` advisory; review that assessment if the code changes.

### 2026-10-02 remediation follow-up (AB#186)

The earlier inventory and Next.js trial above are historical. Main already
contains the exact development-only Vercel CLI 61.0.0 and one shared local
Azure CLI installation. The current follow-up pins Next.js/eslint-config-next
to 16.3.8, refreshes compatible brace-expansion versions, and updates the old
undici 5.28.4 consumer to 5.29.0. Fresh full audit counts are 12 → 10 affected
package entries; the production-only audit is zero. The isolated current
Vercel CLI 62.1.0 comparison retains the same thirteen undici advisory IDs,
so the selected deployment CLI remains 61.0.0.

[AB#186's dated evidence](audits/ab186-dependency-review.md#2026-10-02-follow-up--ab186-remains-active)
contains raw reports, checksums, tooling reachability, and the override and
residual owners/review deadlines (2026-10-13). No owner acceptance or automatic
alert dismissal is implied. The scheduled audit remains visibly nonzero while
these advisories remain. AB#186 is still Active; its exact-candidate gates,
Preview verification and owner decision must be reviewed before AB#117 closes.
