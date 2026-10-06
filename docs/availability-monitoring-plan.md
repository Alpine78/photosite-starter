# Public availability monitoring plan (AB#158)

**Status:** prepared for production-domain launch; monitor account, alert recipients, and live exercise are pending AB#18.

## Monitor contract

The site owner chooses and controls an external uptime service. Its probes use ordinary unauthenticated GET requests against the final canonical production origin; no tracking script, private endpoint, bearer token, signed URL, or secret query string is added to the site.

Check two public URLs:

1. The public home page, requiring an HTTP success response and a recognizable page marker. This catches routing or deployment failure.
2. A stable, published content page chosen at launch, requiring an HTTP success response and a marker in the server-rendered content. This catches a site shell that loads while CMS-backed content cannot be served. Reconfirm the URL after content renames.

A permanent canonical redirect may be followed once to the recorded canonical origin; any unexpected redirect chain, protected login page, timeout, 5xx, missing marker, or noncanonical destination is unhealthy. Choose a cadence and timeout within the monitor's supported settings at launch, then document the actual values. Alert after repeated failures to avoid a single transient probe, and send a recovery notice only after repeated successful checks. Record the failure and recovery thresholds and notify at least two owner-controlled destinations if available.

## Exercise before relying on alerts

After AB#18 supplies the production domain, record the two exact URLs and expected markers. Test a known-good run. Then use the monitor's own test or a controlled, reversible check failure to exercise the full failure notification path, restore the check, and confirm recovery notification. Save times and notification evidence outside this repository if it contains account data. Check that neither alert contains private URL parameters or credentials.

## Response and failure modes

On an alert, verify from another network and inspect deployment status and provider status before assuming an application outage. Check the public content URL separately: a shell-only success does not prove content availability. If the monitor itself is unavailable or misses scheduled probes, treat that as a monitoring fault and use a manual public check; do not claim the site is healthy from missing data. Use the production failure triage plan (AB#159) and rollback procedure (AB#118) for a confirmed site incident.

## Launch record to fill

| Item | Actual value / evidence |
| --- | --- |
| Production origin and content URL | Pending AB#18 |
| Owner and backup alert recipient | Pending owner setup |
| Provider, cadence, timeout, redirects | Pending owner setup |
| Failure and recovery thresholds | Pending owner setup |
| First healthy probe | Pending live check |
| Failure and recovery notification exercise | Pending live exercise |

The document does not claim that monitoring is active. Its criteria need the real production domain and owner account.

## Owner-run probe preparation (AB#206)

`npm run check:availability -- <config.json>` performs ordinary anonymous GETs only
when explicitly invoked. It provisions no account, schedule, telemetry or alerts.
Keep operator configuration private (64 KiB maximum), for example:

```json
{"checks":[{"url":"https://example.test/","heading":"Photographs"},{"url":"https://example.test/stories/example","heading":"Example","link":{"text":"Stories","href":"/stories"}}],"timeoutMs":10000,"maxBytes":1048576}
```

Choose two actual public pages/markers at launch. Config supports one or two distinct
URLs, exact normalized h1 text and an optional exact link text/root-relative href.
An optional `canonicalUrl` permits one 301/308 redirect to that exact public URL;
all other redirects/chains fail. HTTPS is required except explicit loopback HTTP
for local production-build checks. Credentials, query/fragment, public IP literals
and private/API/admin/Studio namespaces are refused. This is trusted operator input,
not an exposed request endpoint or proof against DNS rebinding.

One total deadline (1–60,000 ms) spans headers, redirect and decoded body reads.
Decoded bytes are capped (1 byte–2 MiB); timeout, oversized body, non-HTML, non-200 and
missing marker retain distinct fixed classes. Output contains check indexes/classes,
never URLs or response bodies. Exit 0 means all supplied checks passed, 1 means an
unhealthy check and 2 means invalid configuration. Body cancellation cannot extend
the deadline. Existing parse5 checks HTML h1/link nodes, excluding script, style,
template, noscript, hidden/aria-hidden and explicit inline-hidden subtrees. It does
not execute scripts or establish computed CSS/pixel visibility.

A cached content page proves availability, not a live CMS read or POST delivery.
AB#158's actual monitoring account, cadence, notification destinations and controlled
failure/recovery exercise remain pending after AB#18.
