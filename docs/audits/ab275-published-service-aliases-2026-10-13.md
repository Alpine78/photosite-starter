# AB#275 — published English service aliases, 2026-10-13

The owner-approved Production category/service publication recorded in
[#386](https://github.com/Alpine78/photosite-starter/pull/386) supplies five English
service variants that were unavailable when merged #384 selected ancestry fallbacks.
AB#19 requires a direct same-language canonical replacement when available. This
follow-up changes exactly those five first-site mapping rows and removes their
unavailable-content notice; it changes no generic routing or CMS data.

| Legacy source | Published canonical target |
| --- | --- |
| `/en/photography/funeral` | `/en/services/funeral-photography` |
| `/en/photography/real-estate` | `/en/services/property-photography` |
| `/en/wedding/ceremony` | `/en/services/wedding-photography/ceremony` |
| `/en/wedding/half-day` | `/en/services/wedding-photography/half-day` |
| `/en/wedding/whole-day` | `/en/services/wedding-photography/full-day` |

These are the same exact Joomla menu/article identities recorded by
[AB#271](ab271-remaining-legacy-decisions-2026-10-13.md), with now-published targets.
The property path follows the actual approved slug, not the service's internal ID.
Half-day and full-day remain separate. The distinct from-morning/over-twelve-hour
offer and ceremony-with-portraits decisions retain their existing behavior. English
Blog remains a home fallback: its category fields are published, but its eighteen
articles are still drafts and the empty public category returns 404.

An exact source-file comparison against main `c32d1e8` verifies five changed rows
and identical bytes outside those rows. All source identities and query policies
are preserved, including numeric flags and the existing stripping of Joomla gallery
state. The registry still classifies all 415 inventory paths: 232 redirects, 179
Gone, zero pending, three excluded and one already live. There is no new origin,
external processor, credential, CMS write, redirect engine change or deployment.

## Validation and limits

The existing legacy probe ran against this branch's local production build using
actual Production CMS content at 18:16:32 UTC. All five aliases returned **301**;
each declared target returned **200** directly. Source Location, unavailable-notice
behavior and target canonical checks returned no issues. The private sanitized
probe receipt has SHA-256
`b7fb19ca4b6f89803d7dfce31d395cc9736e987c7b60847e2589dbdfb5daaa1d`.

Lint and a real-content production build, including TypeScript checking, passed.
The focused registry/resolver/probe suite passed 103 tests. All 6,061 browser-free
tests passed in the normal local execution environment; the initial sandbox run's
CLI subprocess tests produced empty output and failed, so that run is not counted
as passing. The production harness passed 106 legacy redirect cases with four
data-dependent skips, and all 26 fallback-notice cases, across Chromium and WebKit.
Harness journeys use synthetic content; the separate real-content probe establishes
availability of these five first-site targets. The scoped security review found no
remaining issue in these fixed, same-origin data changes; existing query and request
boundaries are unchanged. This is not the final release security/privacy review.

AB#275 is Active pending owner review and merge. AB#271 is verified Closed after
#384 merged; parent AB#19 remains Active. Final deployed-source and canonical
verification, English article publication, supported whole-ZIP transport, rollback
proof and final launch acceptance remain open. No DNS or deployment promotion occurred.
