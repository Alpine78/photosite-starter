# ADR-0037: Cookieless site analytics as an opt-in adapter

**Status:** Accepted
**Date:** 2026-10-19
**Deciders:** Project owner (accepted 2026-10-19; the open assumptions below remain implementation checks)
**Work item:** AB#371

## Context

The owner wants visitor statistics (page views and visitors) for the public site.
Constraints stated by the owner on 2026-10-19:

- no cost beyond the existing Vercel Pro plan;
- no self-hosted or external database or server;
- no cookie banner.

Repository rules that bound the decision:

- `AGENTS.md`: privacy by default, no tracking cookies, no Google Analytics, no
  auto-loading third-party embeds, goal of no cookie banner. Analytics is a roadmap
  feature; AB#371 is the prioritization request.
- `AGENTS.md`: the codebase stays generic. A clone must not inherit a hardwired
  statistics provider, and a clone on another host must still build and run.
- ADR-0011: `connect-src 'self'`; nothing is fetched cross-origin from the browser.
- ADR-0004: hosting-provider request and security telemetry is an accepted, separately
  documented boundary, and signed URL tokens are never persisted in analytics. A browser
  analytics script is a different processing from that telemetry and needs its own record.
- ADR-0034 / ADR-0028 / ADR-0032: client delivery, administrator and retained legacy
  unlisted namespaces exist whose URLs must not be sent to any third party.

### Verified facts (Vercel documentation read 2026-10-19)

- Web Analytics identifies visitors by a hash created from the incoming request, uses no
  third-party cookies, and discards the visitor session after 24 hours
  ([privacy](https://vercel.com/docs/analytics/privacy-policy)).
- Each data point may store timestamp, URL, dynamic path, referrer, filtered query
  parameters, geolocation (country, region, city), OS, browser, device type and script
  version (same page).
- `<Analytics />` from `@vercel/analytics/next` accepts `mode`, `debug`, `beforeSend`
  (returning `null` drops the event; the event URL can be modified), `scriptSrc`,
  `eventEndpoint` and `viewEndpoint`
  ([package](https://vercel.com/docs/analytics/package)). Version 2 passes default
  endpoints at build time as paths under the deployment's own origin.
- Pro plan: no included events, $0.03 per 1,000 events, 12-month reporting window,
  custom events included; Web Analytics Plus is a $10/month add-on that is not needed
  ([pricing](https://vercel.com/docs/analytics/limits-and-pricing)). The enable dialog
  in the owner's dashboard shows "Included in your plan" with 12 months of history.
- Pro includes $20 of monthly credit shared across all usage; usage beyond it is billed
  on demand, with a notification at 75% and optional Spend Management actions
  ([Pro plan](https://vercel.com/docs/plans/pro-plan)).
- Speed Insights is free on all plans but limited to the Real Experience Score and
  10,000 events over a rolling 30 days shared across the team; collection pauses for at
  least 14 days when the limit is reached. All Core Web Vitals and breakdowns need
  Speed Insights Plus ($10 per project per month plus $0.65 per 10,000 events on Pro)
  ([pricing](https://vercel.com/docs/speed-insights/limits-and-pricing)).

### Assumptions to verify at implementation

- With package version 2 the script and intake are served from this origin, so the
  current CSP (`script-src 'self'`, `connect-src 'self'`) may need no change. Verify
  against the production build's response headers and the browser console; do not
  widen the CSP to a third-party origin without amending ADR-0011.
- No cookie, `localStorage` or `sessionStorage` entry is written. One third-party
  vendor page claims otherwise; Vercel's own documentation says no cookies. Verify in
  a real browser.
- Vercel's role (processor or controller) for Web Analytics data under its current DPA
  is not established here. Record it from the current terms in the data-flow document.

## Decision

Provide site analytics as an **optional adapter that is off by default**,
with **Vercel Web Analytics** as the reference deployment's provider.

1. **Opt-in.** One server-side setting enables it. Development, Preview and the
   Playwright harness never load it, and the e2e third-party-origin guard stays intact.
   A clone on another host leaves it off and builds unchanged.
2. **Decision logic is a pure module** with Vitest tests: is analytics enabled for this
   deployment, which route namespaces are excluded, and how an event URL is reduced.
3. **Route exclusion.** Client delivery, administrator, unlisted-gallery and other
   token-bearing namespaces send nothing. The excluded set derives from the existing
   route contract, not from a second hand-maintained list.
4. **URL reduction.** Events carry the pathname only; query strings and fragments are
   removed before sending.
5. **No custom events in the first slice.** Page views only, so the data-flow document
   stays small and the privacy surface stays minimal.
6. **Cost posture.** The owner configures a low Spend Management notification
   threshold (notify only; no automatic project pause, since a pause would take the
   site down). This is a manual dashboard step recorded in the PR.
7. **Speed Insights is not adopted by this decision.** Its free tier is a single score
   with a small shared quota that pauses collection, and useful metrics require a paid
   add-on. It may be proposed separately.

## Options Considered

| Option                                      | Cost                              | Cookies           | Infra the owner runs | Verdict                                                                           |
| ------------------------------------------- | --------------------------------- | ----------------- | -------------------- | --------------------------------------------------------------------------------- |
| Vercel Web Analytics (opt-in adapter)       | Within Pro credit at expected use | None (per vendor) | None                 | Chosen                                                                            |
| Plausible cloud                             | Paid subscription                 | None              | None                 | Rejected: owner will not pay                                                      |
| Umami or Plausible self-hosted              | Hosting plus database             | None              | Server and database  | Rejected: owner excluded servers and databases                                    |
| GoatCounter hosted service                  | Donation-based                    | None              | None                 | Not evaluated: terms (including commercial use) unverified, third-party-run       |
| Hosting runtime logs only                   | None                              | None              | None                 | Rejected: one-day retention on Pro (ADR-0004), no history, coarse                 |
| Own counter in the app                      | None                              | None              | Needs a datastore    | Rejected: requires an external database                                           |
| Speed Insights as the statistics tool       | Free tier or paid add-on          | Not stated        | None                 | Not a visitor-statistics product; free tier is one score with a pausing quota     |
| No analytics                                | None                              | None              | None                 | Valid fallback; leaves the owner without usage data                               |

## Trade-off Analysis

- **Vendor lock-in is contained, not removed.** The adapter boundary keeps clones
  independent of Vercel, but the reference deployment's history lives in Vercel. A later
  switch loses that history.
- **Cost is small but not zero.** The analytics line item is billed from the shared
  credit; heavy traffic or other usage could exhaust the credit and incur on-demand
  charges. The notify-only threshold makes that visible without risking downtime.
- **Privacy is better than the alternatives but not nil.** Country-level geolocation,
  referrer, browser and device are stored per data point. Whether this is exempt from
  consent under the ePrivacy rules is a legal question this ADR does not answer; the
  project goal of "no cookie banner" is a product goal, not a legal opinion. Record the
  assessment in the data-flow document before the AB#117 launch review closes.
- **Measurement gaps.** Content blockers will drop some events, so counts are lower
  bounds.

## Consequences

- New runtime dependency (`@vercel/analytics`, MIT per the vendor); record it in
  `docs/asset-inventory.md` before it lands.
- New `docs/analytics-data-flow.md` in the style of the other data-flow documents;
  `docs/security-privacy-review.md` and the README roadmap line change in the same PR.
- ADR-0011 is amended only if the CSP actually needs to change.
- ADR-0004's hosting-telemetry boundary is not widened; the analytics script is recorded
  as its own boundary.

## Action Items

1. [x] Owner accepts this ADR (2026-10-19); status is `Accepted`.
2. [ ] Verify the CSP and cookie/storage assumptions against a production build.
3. [ ] Implement the pure decision module, the opt-in component and its tests.
4. [ ] Write `docs/analytics-data-flow.md`; update `docs/asset-inventory.md`,
       `docs/security-privacy-review.md`, README and `docs/feature-status.md`.
5. [ ] Owner enables Web Analytics in the Vercel dashboard and sets a notify-only
       Spend Management threshold.
6. [ ] Record the Vercel role and retention for Web Analytics data from the current terms.
