# Site analytics data flow (AB#371)

This is the reference deployment's processing record for optional page-view
statistics. Each clone owns its own hosting, analytics account and copy of this
record. The provider choice, route exclusion and cost posture are recorded in
[ADR-0037](adr/0037-cookieless-site-analytics.md).

**Status:** implemented, **off everywhere** until the owner sets
`SITE_ANALYTICS=vercel` on the Production deployment and enables Web Analytics in
the Vercel dashboard. Nothing in this record describes a deployment that is
already collecting.

## What is sent

When enabled, the visitor's browser loads the provider's script from this site's
own origin (`/_vercel/insights/…` by default) and reports **one page view per
page load or client-side navigation**. Per the provider's documentation
([privacy](https://vercel.com/docs/analytics/privacy-policy)) a data point may
store: event time, URL, dynamic path, referrer, filtered query parameters,
geolocation (country, region, city), device OS, browser and version, device type
and script version. Visitors are told apart by a hash created from the incoming
request rather than by a stored identifier, and the visitor session is discarded
after 24 hours.

The application narrows this before anything leaves the browser:

| Rule | Where | Effect |
| --- | --- | --- |
| Off unless a production deployment opts in | `readSiteAnalyticsProvider` | Development, Preview, the Playwright harness and any clone that never set `SITE_ANALYTICS` load nothing |
| Pathname only | `scrubAnalyticsEvent` | Query strings and fragments are removed from every event URL, so a token or personal value in a URL never reaches the provider |
| Excluded namespaces | `isAnalyticsExcludedPath` | The retained legacy `client-gallery` namespace, the private-gallery and administrator prefixes the Proxy reserves, `/api`, and their locale-prefixed aliases send nothing. An undecodable path segment is treated as excluded |
| Rendered by the public shell only | `SiteRoot` | The document shells of the private, client and administrator namespaces never include the script at all; the exclusion above is a second layer |
| Page views only | — | No custom events and no identification call exist in this slice |

The **referrer** and the **geolocation** are added by the provider from the
request and cannot be narrowed by application code. The application's
`Referrer-Policy` (`strict-origin-when-cross-origin`) means a cross-origin
referrer carries only its origin.

## What the application stores and logs

- **Stored:** nothing. The application sets no cookie for analytics and writes
  nothing to local or session storage for it. The package's client code contains
  no `document.cookie`, `localStorage`, `sessionStorage` or `indexedDB` use
  (checked in the installed 2.0.1 build); the provider's own script, which is
  served by the provider, is checked in a browser on a deployed site — see
  below. A public-journey test pins the default: no provider script, no request
  under `/_vercel`, and no cookie on the home page.
- **Logged:** the application logs no analytics events or visitor values.
- **Retention:** none by the application. The provider's reporting window on Pro
  is 12 months; its session hash is discarded after 24 hours.

## Processors

- **Vercel** (the hosting provider in the reference deployment) receives and
  stores the data points above. Its role (processor or controller) for
  Web Analytics data under the current Data Processing Addendum is **not yet
  recorded here**: ADR-0004 documents the split for hosting telemetry, and this
  record must state the Web Analytics position from the current terms before the
  AB#117 launch review closes.
- **No other party.** The browser makes no request to any other origin because
  of analytics, and the content security policy is unchanged (`script-src 'self'`,
  `connect-src 'self'`).

## Cost and control

Pro bills Web Analytics at $0.03 per 1,000 events, from the plan's shared
$20 monthly credit; there is no included allowance. The owner sets a low,
**notify-only** Spend Management threshold. Automatic project pausing is not used,
because it would take the site down. Counts are lower bounds: content blockers
drop events, and this site makes no attempt to evade them.

## Verification still owed on a deployed site

Local builds cannot run the provider's script, so these are checked once after
the first Production deployment with `SITE_ANALYTICS=vercel`, and recorded here:

1. The script and intake load from this origin with no CSP violation in the
   browser console, and the Proxy does not intercept `/_vercel/*`.
2. The browser's storage inspector shows no cookie, `localStorage` or
   `sessionStorage` entry written by analytics.
3. A page view appears in the Vercel dashboard, and a visit to a private,
   administrator or legacy client-gallery page does not.
4. A page view reached with a query string and fragment arrives as a bare path.

## Speed Insights (AB#376)

**Status:** implemented, **off everywhere**. It is a separate switch,
`SITE_SPEED_INSIGHTS=vercel`, with the same production-only, public-shell-only
and `scrubAnalyticsEvent` rules as page-view statistics above.

**What is sent.** For each page load the provider's script reports the visitor's
[Web Vitals](https://vercel.com/docs/speed-insights/metrics) measured with native
browser APIs. Per the provider's
[privacy page](https://vercel.com/docs/speed-insights/privacy-policy) (updated
2026-03-18) each data point stores: route, URL, network speed class, browser,
device type and OS, country, the Web Vital, its **attribution selector** (a CSS
path to the element concerned, such as `html>body img.header`, which describes page
structure rather than the visitor), SDK version and server-received time. Data
points are anonymous and not tied to a visitor or IP address. The application
removes query strings and fragments and sends nothing from the reserved
namespaces; the provider adds the country from the request.

**Storage and origins.** The npm package (2.0.0) writes no cookie or web storage
and, in production, injects its script from this site's own origin. The script it
loads is served by Vercel; its behaviour is verified at runtime below.

**Processor and retention.** Vercel receives and stores the data points. Its role
and the retention period for Speed Insights data under the current terms are
**not yet recorded here** and must be stated before enabling.

**Free tier.** Real Experience Score only; 10,000 events per rolling 30 days
shared across the team, after which collection pauses for at least 14 days.
There is no charge on this tier.

**Checks before enabling** (on an unpromoted production-target deployment built
with `SITE_SPEED_INSIGHTS=vercel`, in clean browser contexts, comparing with the
setting off so deployment-protection cookies are not mistaken for the collector's):

1. The script and every intake request go to this origin, through the Proxy, with
   successful responses and no CSP violation; record the actual paths.
2. No cookie, `Set-Cookie` header, `localStorage`, `sessionStorage` or IndexedDB
   entry is created by the collector.
3. Emitted payloads carry bare paths, and private, administrator, legacy client
   and their locale-prefixed pages send nothing, including after client-side
   navigation, in both locales.
4. After promotion, data appears in the Vercel dashboard.
5. The owner records the consent (no-banner) assessment. If a banner would be
   needed, `SITE_SPEED_INSIGHTS` stays unset and the feature is removed.

## For a clone and the launch review

A clone can leave `SITE_ANALYTICS` unset and ship no statistics, or point it at
`vercel` on its own Vercel account. A different provider needs its own adapter
and its own record; it must reuse the same pure policy (`src/lib/site-analytics.ts`).
Whether this processing is exempt from consent under the ePrivacy rules is a
legal question this record does not answer; "no cookie banner" is a product goal.
