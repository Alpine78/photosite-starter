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
  The audit uses the `Default` self-hosted pool, so it does not consume the
  Microsoft-hosted monthly minute allowance. It still needs an available agent
  and self-hosted parallel-job capacity; see [Azure's parallel-job limits](https://learn.microsoft.com/en-us/azure/devops/pipelines/licensing/concurrent-jobs?view=azure-devops).
- The repository owner is the accountable reviewer. In Azure Pipelines, the
  owner must subscribe to failed runs for this pipeline and verify delivery to
  an address they monitor. In GitHub, the owner must watch the repository with
  **Security alerts** selected and verify notification delivery in the account's
  notification settings. A green/failed log is not a delivered notification.
- GitHub's repository security settings are a second detection channel. On
  2026-10-02 the vulnerability-alerts API returned **204** (enabled), and the
  automated-security-fixes API returned `{"enabled":true,"paused":false}`.
  This verifies configuration, not notification delivery. Existing settings
  were read without changing them.
  The available GitHub token lacks the `notifications` scope, so the owner's
  repository-watch and delivery settings could not be checked through that API.
- Check Azure Pipelines' **Scheduled runs** view when changing the schedule.
  A schedule configured in the pipeline UI takes precedence over YAML;
  remove that override if present. On 2026-10-02 the
  existing pipeline definition showed only CI and pull-request triggers, with no
  UI schedule. The 2026-10-02 scheduled-run example is recorded below;
  failure-notification delivery remains unverified.

## Live evidence checked on 2026-10-02

**Configuration and execution verified; maintainer notification delivery
unverified. AB#160 remains Active.** The dated observations below demonstrate
the existing audit and a security update reaching protected Preview. They do
not demonstrate receipt of either channel's notification or Production promotion.

| Check | Observed evidence |
| --- | --- |
| Dependabot configuration | Vulnerability-alerts API: HTTP 204; automated-security-fixes API: `{"enabled":true,"paused":false}`. No settings were replaced. |
| Audit without a new source revision | [Scheduled run #497](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=497) started at 06:00 UTC on revision `06e0cab2b34d61ed5c63b9587690ea559c1ef29c`, the same revision as [main CI #494](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=494), which finished at 05:34 UTC. The exact scheduled command reported 12 affected-package entries (9 moderate, 2 high, 1 critical) and exited 1. Verify and DeployPreview were skipped. These are that revision's package entries, including inherited parent entries, not 12 demonstrated exploits or a count for later `main`. |
| Reviewable security update | Dependabot [PR #229](https://github.com/Alpine78/photosite-starter/pull/229) updated `package.json` and `package-lock.json` from Next.js 16.3.3 to 16.3.6 for [GHSA-vcvr-r3jv-pc5j](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j). Its merge event names the repository owner, with no auto-merge-enabled event and `auto_merge: null`. |
| Existing PR gates | [PR CI #496](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=496) passed Verify for PR #229. The existing lint, unit-test, diagram, production-build and browser-journey gates were retained; audit and deployment were skipped on this PR run. |
| Deployment follow-through | [Main CI #501](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=501) passed Verify and DeployPreview for PR #229's merged revision `06e0f081c8e2cc894e582ce945b1bd1b3f8e884e`. Deployment `dpl_BGXUzSdgcNgfXFLYegFiuSbLFmHm` passed identity checks, an unauthenticated 302 challenge to `vercel.com/sso-api`, and `X-Robots-Tag: noindex`; the stable Preview alias was repointed successfully. |
| Maintainer notifications | Receipt is not yet confirmed for Dependabot alerts or failed scheduled audits. GitHub's available token lacks the `notifications` scope; Azure CLI could not discover the notification-subscriptions resource. Neither limitation proves that a subscription is absent or that delivery succeeded. |

Run #501 verifies its named revision only. The later [PR #230](https://github.com/Alpine78/photosite-starter/pull/230)
merged as `5c3464f8348bd152650a94e0f27ade2a4e7bef43` and pins Next.js to
16.3.8; run #501 is not Preview evidence for that later revision. AB#186's
residual-advisory decision and exact-candidate Preview check remain separate.

### Remaining live check: notification receipt

The accountable maintainer is the repository owner assigned to AB#160. Verify
that maintainer's settings and receipts, not just the API token owner's settings.
The maintainer still needs to check [GitHub security notifications](https://docs.github.com/en/subscriptions-and-notifications/how-tos/managing-security-notifications)
(repository watch: **Security alerts** or **All Activity**, plus the account's
delivery channel) and an [Azure failed-build subscription](https://learn.microsoft.com/en-us/azure/devops/organizations/notifications/manage-your-personal-notifications?view=azure-devops)
for this pipeline. The Azure subscription must include scheduled runs, rather
than only builds queued by the recipient. Verify receipt against an actual
advisory or failed audit run; a configured subscription alone is insufficient.
A security-PR notice alone does not prove Dependabot alert delivery, and an
update to an existing advisory does not necessarily generate a new notice.
Record the channel, receipt date and advisory/run identifier on AB#160, without
an email address or message contents. No notification was sent or subscription
changed during this check. This procedure is defined but has not been verified
as completed. Until receipt is evidenced, AC1's delivery requirement, AC2's
maintainer-visibility requirement and AC4's notification step remain open.

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

## Historical initial evidence (2026-09-27)

On 2026-09-27, running the exact scheduled command against `main`'s
`package-lock.json` returned **28 vulnerable package entries**: 1 low,
11 moderate, 15 high, and 1 critical. The entries form a dependency chain
through the direct `vercel@59.11.7` package. The same 28 entries remained under
`npm audit --omit=dev` because this CLI was then declared in
`dependencies`. A source search found no application import of `vercel`;
the pipeline then used a separately pinned global CLI for deployment. This was
evidence that the package's manifest classification needs review, not proof
that every advisory is exploitable in the deployed site. Do not blindly apply
npm's offered `vercel@54.17.3` downgrade: it crosses a major version and is
not the CLI version pinned by the deployment pipeline.

The nonzero audit result is a controlled check of advisory retrieval and
failure behavior on that committed lockfile. The later scheduled run and
security-update CI/Preview evidence are recorded above; maintainer notification
delivery is still required to complete the end-to-end demonstration.

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

**Historical time-bound decision:** the initial review set a retest deadline of
2026-09-30, or sooner if `ImageResponse` use was introduced. Successful full
CI and protected Preview evidence for 16.3.6 was observed on 2026-10-02 in
PR #229 and run #501 above. The initial source review found no path to the
specific `ImageResponse` advisory; reassess that precondition if the code changes.

### 2026-10-02 remediation follow-up (AB#186)

**Current status: AB#186 is Closed** (zero full and production-only audit
findings; exact-main CI #655 passed with an authenticated protected Preview) —
see [current evidence](audits/ab137-renderer-readiness-2026-10-07.md#merged-source-and-dependency-gate).
The text below is the preserved 2026-10-02 checkpoint.

The earlier inventory and Next.js trial above are historical. Main already
contains the exact development-only Vercel CLI 61.0.0 and one lockfile-pinned
Vercel CLI installation used by Azure. The merged PR #230 pins Next.js/eslint-config-next
to 16.3.8, refreshes compatible brace-expansion versions, and updates the old
undici 5.28.4 consumer to 5.29.0. Fresh full audit counts are 12 → 10 affected
package entries; the production-only audit is zero. The isolated current
Vercel CLI 62.1.0 comparison retains the same thirteen undici advisory IDs,
so the selected deployment CLI remains 61.0.0.

[AB#186's dated evidence](audits/ab186-dependency-review.md#2026-10-02-follow-up--ab186-remains-active)
contains raw reports, checksums, tooling reachability, and the override and
residual owners/review deadlines (2026-10-13). No owner acceptance or automatic
alert dismissal is implied. The scheduled audit remains visibly nonzero while
these advisories remain at that historical checkpoint. AB#186 was Active then.

**2026-10-07 merged verification:** PR #281's remediated candidate has zero full
and production-only audit findings. Exact main CI #655 passed quality gates and
an authenticated protected Preview deployment with the patched CLI tree. AB#186
was explicitly moved Active → Closed; the October 2 residuals and open Preview
check above are superseded by that evidence. The scheduled audit remains in place;
AB#117 still needs its separate live launch review.
[Current evidence](audits/ab137-renderer-readiness-2026-10-07.md#merged-source-and-dependency-gate).
