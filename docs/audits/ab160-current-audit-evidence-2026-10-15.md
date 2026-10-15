# AB#160 — current scheduled-audit evidence, 2026-10-15

Status: configuration/execution verified; notification receipt remains unverified.
AB#160 remains Active. No setting, dependency, alert subscription or deployment
was changed and no notification was sent.

## Read-only observations

GitHub `GET /repos/Alpine78/photosite-starter/vulnerability-alerts` returned 204;
`GET /repos/Alpine78/photosite-starter/automated-security-fixes` returned
`{"enabled":true,"paused":false}`. This establishes enabled features, not that
an accountable maintainer received an alert. Available token scopes still lack
`notifications`; no broader scope was requested.

`az pipelines build list --reason schedule --top 3` returned these completed runs:

| Run | Queued UTC | Source revision | Result |
| --- | --- | --- | --- |
| [1009](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=1009) | 2026-10-15 06:00:28 | `d63f437f4450b0ffe246a400a0c9ae0a0bace454` | Failed |
| [976](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=976) | 2026-10-14 06:00:51 | `2a26e970220ac101c9efa41a3238004bd868f79d` | Failed |
| [885](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=885) | 2026-10-13 06:01:07 | `15fcf761fa3006227aa43ad70c7cecc266633bbe` | Failed |

Only run 1009's task timeline and audit logs were examined in this pass. Its
root command `npm audit --include=prod --include=dev --audit-level=low` succeeded
with zero vulnerabilities. Its independent Studio command
`npm audit --prefix studio --include=prod --include=dev --audit-level=low` failed
with eight moderate affected-package entries, all in the inherited `sprintf-js`
chain for GHSA-hp3w-g68c-fv3c. Eight entries are not eight independent exploits.
Verify, standalone Studio quality gates and DeployPreview were skipped, as intended
for a scheduled audit. The pipeline failure is visible evidence, not a broken
schedule or notification receipt.

The current source at `eabbc5d` retains `always: true`, the 06:00 UTC main schedule,
self-hosted `Default` pool, and the separate root/Studio audit commands. Studio's
`succeededOrFailed()` condition preserves its check after a root failure. The
actual pipeline UI schedule-override configuration was not re-read. The observed
runs establish execution on these dates, not every future schedule or an unchanged
main revision. The earlier same-revision witness remains in the process document.

## Remaining acceptance

| Requirement | Evidence and next action |
| --- | --- |
| Notification settings and receipt | Owner-pending for both channels; inspect existing subscriptions and preserve an actual redacted receipt. Do not create fake delivery evidence or send a new test without authorization. |
| Reviewable security update through deployment | The dated PR #229 / CI #496 and #501 evidence remains valid for that revision and protected Preview only; Production follow-through and notification linkage remain unverified. |
| Unpatched-advisory decision | [AB#278's exposure trace](ab278-studio-sprintf-exposure-2026-10-13.md) is existing evidence, not owner risk acceptance. Confirm an accountable decision and a dated revisit before closing the maintenance story. Do not apply the audit's forced Sanity downgrade. |
| Supported Node/Next releases | Keep the existing process to check primary Node.js security announcements and Next.js advisories alongside npm audit; this pass did not establish latest-release status. |

No current-main clean dependency result is inferred from an earlier scheduled
revision. No risk, launch or full-story acceptance is granted here.
