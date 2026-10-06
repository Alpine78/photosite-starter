# Production failure triage runbook (AB#159)

**Status, 2026-10-02:** prelaunch preparation; the alert decision is **Proposed**.
AB#159 remains **Active**. Notification configuration/test (AC2) and the controlled
Production failure trace (AC3) remain open after AB#18; AB#118 then owns rollback
rehearsal and customer handoff. No Production alert or failure exercise is verified here.

The site owner responds and names a backup operator in the launch record below. Use
existing events and hosting logs under [ADR-0004](adr/0004-reference-production-host-and-ownership-boundary.md#5-images-logs-and-secrets).
Only operators who need them access provider logs. Incident notes and notifications may
contain time, deployment ID, route **template**, status/count, random application
correlation ID, state, and closed error class. Exclude form content, customer/client
identifiers, query strings, private gallery links, tokens, signed URLs, and provider
response bodies. Inspect raw provider metadata in its restricted dashboard; never paste
raw logs or stack traces into a public issue or an alert.

## First five minutes

1. Record detection time (UTC), affected route template, impact, and deployment ID.
   Verify the public home and AB#158's published content page from another connection,
   including their content markers. If probes are missing, check the monitor itself;
   missing data proves neither health nor an outage.
2. In the site's Vercel project, open **Logs**. Select **Production**, the affected
   host/deployment, and the incident window, starting five minutes before detection.
   Filter **Status Code** to the observed 5xx codes; open a request for its function
   output and deployment. Use **Route** to group by template, rather than copying a
   private path. Expand the window/deployment scope if necessary.
3. Separate failures from expected refusals: unknown paths, invalid cursors, refused
   form input/headers, unavailable enquiry items, and throttling can produce expected
   4xx. Those counts alone do not warrant paging. A known-good public path unexpectedly
   refusing access still needs investigation.
4. Search the event names below in the same window. Clear the HTTP-status filter when
   looking for all event states: not every error-level line is a 5xx, and successful
   terminal events use info. Inspect runtime failures even without an application event.
   Use the deployment's separate **build logs** for build/configuration history; a
   successful build does not prove requests or mail delivery are healthy.
5. If the current release caused the fault, identify a usable last known-good deployment
   and follow [promotion and rollback](deployment.md#promotion-and-rollback). AB#118
   owns the tested procedure. Verify public content and synthetic contact/enquiry
   delivery after recovery, not only the home-page GET.

Dashboard filters and UTC timestamps are documented in
[Vercel Runtime Logs](https://vercel.com/docs/logs/runtime) (checked 2026-10-02).
Confirm actual retention/access at launch; if the incident has aged out, record missing
evidence instead of concluding that no failure occurred.

## Find and classify the failure

| Search / symptom | Evidence and first action |
| --- | --- |
| Unexpected 5xx or blank public page | Inspect the failed request, runtime error, and deployment; compare the first failing release with the last good one. Check hosting status and content independently. |
| `sanity.query`, `state: failed` | A failed Sanity transport read, with random `correlationId`, closed `errorClass`, and project-owned `tag` such as `site-settings`, `home-page`, or `enquiry.gallery`. Check dataset/credentials for `configuration`, `unauthorized`, or `not-found`; query implementation for `query-rejected`; provider health for `rate-limited`, `unavailable`, or `timeout`; transport/envelope for `malformed-response`. Never copy query parameters or response bodies. |
| Adapter validation/configuration failure without `sanity.query` | Inspect the restricted runtime error's type and adapter/configuration. Failures before transport or during projection may emit no query event. Check required published content/settings; an absent event does not establish healthy reads. |
| Content stale while reads succeed | Search `sanity.revalidation` on `/api/revalidate`: `accepted` means invalidation was accepted, not that subsequent reads succeeded. `rejected` with `configuration` can be a 500 defect; invalid signature/input refusals are expected 4xx. `failed` / `cache-unavailable` is 503. Check webhook delivery and [cache recovery](cache-revalidation.md#recovery-and-reconciliation). |
| `contact.submission` on `/api/contact`, or `enquiry.submission` on `/api/enquiry` | Pair `accepted` and terminal `delivered`/`delivery-failed` by application `correlationId`. Use the class table below. Accepted alone proves no delivery; delivered means provider acceptance, so verify owner-mailbox arrival during an exercise. |
| Error-level `rejected` submission | Check class/status before escalating. Input refusals and honeypot discards are expected; the latter may return 200. Some header refusals emit no application event and are visible only in request telemetry. |

| Delivery failure class | HTTP status | Initial action |
| --- | --- | --- |
| `configuration` | 500 | Verify deployment-owned adapter, sender, recipient, and credential settings without revealing values; deploy corrected settings. |
| `provider-rejected` | 502 | Check sender/domain and provider configuration privately; repeated submission does not correct a refusal. |
| `provider-quota-exceeded` | 502 | Check account sending allowance; retrying immediately does not replenish it. |
| `provider-unavailable`, `timeout` | 503 | Check provider status and restore delivery; retry within a bounded incident/exercise plan. |
| Enquiry `source-unavailable` | 503 | Inspect Sanity read availability before mail delivery. |
| Enquiry `source-error`, `malformed-source`, `internal` | 500 | Inspect CMS/configuration or runtime defect; these differ from an unavailable item's expected 4xx. |

Contracts: [contact-log.ts](../src/lib/contact-log.ts),
[sanity-client.ts](../src/lib/sanity-client.ts), the
[revalidation route](../src/app/api/revalidate/route.ts),
[contact-delivery.ts](../src/lib/contact-delivery.ts), and the
[enquiry route](../src/app/api/enquiry/route.ts). Count each failed **request** once in
the status view. Within a submission family, count one terminal failure per correlation
ID; accepted lines and related Sanity errors are evidence, not additional failed
submissions. A retry is a new request/correlation ID and counts separately. Do not use
client identifiers or form payloads to deduplicate.

## Alert-threshold decision draft

**Recommendation for owner review:** retain [AB#158's external checks](availability-monitoring-plan.md)
and existing logs; add application-error notifications where probes miss material
failures. Availability-only cannot establish contact/enquiry delivery health: both GET
probes can succeed while POST delivery fails. This leaves AC2 open rather than declaring
its availability-only alternative satisfied.

Proposed operator escalation thresholds (policy, **not configured alert rules**):

| Signal | Proposed threshold / response |
| --- | --- |
| Sustained unexpected server failure | At least 3 failed requests on the same route within 10 minutes: notify the owner and investigate deployment, runtime, and provider health. |
| Material submission failure | One confirmed `delivery-failed` contact/enquiry request: investigate promptly, including configuration/quota or CMS failures. Low traffic does not make a lost enquiry harmless. |
| Failed Sanity read | Apply the sustained threshold to affected requests; investigate a single failure immediately if it prevents a verified critical public journey. |
| Availability outage / recovery | AB#158's repeated-failure and repeated-success settings remain pending owner setup. |
| Expected refusals | Exclude expected 4xx, rejected input/honeypot events, and successful events from application-error thresholds. |

### Choose the notification path after AB#18

| Option | Coverage, privacy/retention/cost, and decision |
| --- | --- |
| Availability plus manual review | Covers two GET journeys, not delivery failures. No new application telemetry processor; use actual host retention. Interim proposal: owner reviews after each deployment and availability/customer report, and every 30 minutes during an explicitly staffed launch window if retention is at least one hour. Unstaffed intervals can lose evidence. Manual review does not close AC2. |
| Native Vercel error-anomaly notifications | Evaluate first if the Production tier supports them. Detects request-error anomalies, not arbitrary `errorClass` predicates or the fixed counts above. Confirm low-traffic coverage, owner destinations, payload, retention/access and incremental billing before enabling. Material delivery failures still need demonstrated coverage. |
| Dedicated redacted-event alerting | Consider if native coverage is inadequate and the owner does not accept the gap. Fixed thresholds need separate implementation and processor/data-field, retention/deletion, access, cost and ADR-0004 review. Do not forward raw request logs to obtain it. |

**Provider facts checked 2026-10-02; recheck before setup:**
[Vercel Alerts](https://vercel.com/docs/alerts) uses five-minute error counts against
a baseline and provider minimum-activity checks; low-volume errors may produce no
alert. [Configuration](https://vercel.com/docs/alerts/configure-alerts) requires
Pro/Enterprise with Observability Plus and offers owner notification subscriptions.
Select 5xx and this site's project; record severities/destinations and review any extra
scope against the Production requirement. Three failures do not guarantee a native alert.

[Observability Plus](https://vercel.com/docs/observability/observability-plus) documents
Runtime Logs retention of Hobby 1 hour, base Pro 1 day, and Plus 30 days. Plus bills per
event and can be enabled by default on a newly upgraded Pro team. Verify actual settings
and charges alongside AB#18's tier decision. Broader provider telemetry retention is
separate under ADR-0004; the log window does not promise deletion of all service data.

This draft enables no service, drain, browser instrumentation, destination or automatic
investigation. Before enabling a path, inspect its actual payload against the allowlist
above and record recipients, retention and cost. If it cannot meet that boundary, choose
another path. Relying on availability alone requires an explicit owner decision accepting
the delivery gap and explaining launch sufficiency; this draft makes no such decision.

## Controlled failure after AB#18

1. Rehearse classification on Preview with the existing `sink` adapter and synthetic
   `timeout@delivery-failure.test` reply-to (valid fields and published subject/item).
   Expect 503 and terminal `delivery-failed` / `timeout`. The sink is refused in
   Production; these addresses trigger simulated failures only in the sink. This
   rehearsal proves neither Production delivery nor its alerts.
2. After AB#18, choose and verify one reversible Production failure method. Before
   execution record owner-approved scope, time/request limits and restoration action.
   Use synthetic content and an owner-controlled recipient. Do not invent provider
   test modes or casually remove shared live credentials; record effects on genuine
   submissions and stop if impact exceeds the agreed limit.
3. Start live logs before injection. Record the failing request's time/deployment,
   detection source, notification receipt, redacted event/class and diagnosis.
   A channel test alone is not a failure trace. A silent native alert is a coverage
   failure; stop at the request limit instead of forcing an anomaly with more traffic.
4. Restore known-good configuration/deployment. Confirm the failed journey works,
   mailbox arrival for a delivery check, and AB#158's public markers. Record recovery
   time/notice where supported. A staged Production-target URL alone does not verify
   the canonical host's alert scope.
5. Save redacted results against AB#159, with restricted account/payload evidence.
   Resolve coverage gaps before AB#118 handoff; keep AB#159 Active until accepted.

## Launch decision and exercise record

| Required evidence | Actual value / result |
| --- | --- |
| AB#18 promotion, canonical host and deployment ID | Pending AB#18 |
| Owner/backup roles and notification destinations | Pending owner setup; personal account details stay outside the repository |
| Actual tier, retention/access, Plus setting and cost | Pending launch read-back |
| Approved thresholds, path, scope/severities and gaps | Proposed above; owner decision pending |
| Notification payload/privacy inspection and receipt test | Not run |
| Failure method, scope, request/time limits and restoration | Pending post-AB#18 exercise approval |
| Failure/detection/notification times, redacted event/class and diagnosis | Not run |
| Restoration, successful journey/mailbox check, recovery time/notice | Not run |
| Residual gaps, follow-up owner and AB#118 evidence | Pending exercise |

## Recovery limits and closeout

[AB#118's rollback path](deployment.md#promotion-and-rollback) restores code and the
environment captured by that deployment. It does not restore Sanity content,
email-provider/mailbox state, private-gallery store/object state, or other external
systems. It cannot recover an undelivered message: the application stores no form
content. Rotated/expired credentials can make an old deployment unusable. CMS/cache
need their own [reconciliation](cache-revalidation.md#recovery-and-reconciliation);
rollback alone does not prove restored code and current content/cache agree.

Record a redacted timeline, impact, cause, recovery, remaining gaps and owner.
The owner must also address any credential/data exposure as a security incident;
restoring availability does not resolve that exposure.

## Offline emitter summary (AB#205)

Run `npm run summarize:contact-failures -- <emitter.ndjson>` on privately saved bare
application-emitter JSON lines for `contact.submission` and `enquiry.submission`.
Provider log wrappers are not accepted. Each line must end in a newline; input is
limited to 4 MiB, 64 KiB per record, 40,000 records and 10,000 family/correlation keys.
No live logs are fetched. Output contains fixed state/class counts only, never IDs,
form fields, exception messages, URLs or raw lines. Unknown/extra fields, malformed
records, missing IDs and conflicting terminal outcomes count as invalid evidence.

Repeated accepted or identical terminal events count once per family/correlation.
An accepted-only correlation is incomplete. Expected input/item refusals and honeypots
are separated from delivery failures and rejected source/runtime defects. Every
`delivery-failed` event is a failure. Exit 0 means complete valid supplied evidence,
1 means observed failures, and 2 means invalid or incomplete evidence (including empty
or unterminated input). Invalid/incomplete status takes precedence while observed
failure counts remain visible. No timestamps means no alert window or cadence can be
inferred. Delivered means provider acceptance, not mailbox arrival. Missing emitter
events can conceal runtime/transport faults; a complete summary does not prove overall
service health. Live notification and controlled failure exercises remain open in AB#159.
