# Production failure triage plan (AB#159)

**Status:** prelaunch runbook; production alert threshold and controlled failure exercise are pending AB#18.

## First five minutes

1. Record alert time, affected public URL or function, deployment identifier, and whether impact is ongoing. Keep form bodies, buyer or client identifiers, private gallery links, tokens, signed URLs, and full provider response bodies out of incident notes.
2. Verify the public home and a CMS-backed content page from an independent connection. Distinguish a monitor fault from a real outage.
3. Check the hosting deployment and function status. Separate expected 4xx (unknown path, invalid cursor, refused form) from unexpected 5xx or a spike in failed requests. A 4xx count alone is not an application outage.
4. Inspect the narrow incident time window in Runtime Logs and deployment logs, then the redacted application events. Note the current hosting tier's actual log retention; Preview's Hobby log window in `docs/deployment.md` is one hour, while Production's tier remains an AB#18 decision.
5. If a recent deployment plausibly caused the failure, identify the last known-good deployment and use the staged rollback sequence in `docs/deployment.md`; AB#118 must rehearse it before handoff. Verify both public paths and the contact path after rollback.

## Route the failure

| Symptom | Evidence to inspect | Initial action |
| --- | --- | --- |
| Public 5xx or blank page | Deployment/build logs, function status, first failing release | Compare with last good release; rollback if safe |
| CMS content absent or stale | Sanity adapter errors, published content, revalidation events and cache history | Check dataset/configuration and webhook; use `docs/cache-revalidation.md` for controlled invalidation |
| Contact or enquiry delivery failure | `contact.submission` or `enquiry.submission` state and redacted `errorClass`, mail provider status | Check credentials/provider health without copying payloads into logs |
| Widespread expected 4xx | Route and status aggregate, not request bodies | Confirm whether traffic is legitimate; do not page solely for invalid requests |
| Monitor missed probes | Monitor status and independent manual GET | Repair monitor separately from the site |

Application submission events have a random correlation ID, state, and closed error class (`src/lib/contact-log.ts`); accepted and terminal events can be paired without logging form content. `sanity.revalidation` is a separate redacted event. Hosting-provider request logs can contain paths, query strings, IP-related data, and user agents, so keep access limited and avoid copying raw lines into public issues.

## Alert and exercise gate

At launch, choose an alert source and a repeated-failure threshold for production 5xx and failed contact/enquiry delivery. Record the threshold, evaluation window, recipient, and expected 4xx exclusions. If the available plan cannot provide a reliable threshold, document the manual check cadence and owner rather than implying an automatic alert.

Exercise one controlled failure in a safe environment using a reversible deployment/configuration or a provider test mode. Trace it from alert to redacted log evidence to diagnosis, restore service, and record recovery time. Do not submit real personal data to create a test event. A Preview exercise establishes the workflow; a Production-specific check after AB#18 still needs to confirm the actual alert route and access.

## Closeout

Write an incident summary with timeline, scope, cause, recovery action, and follow-up owner. If a credential or personal data may have been exposed, use the security response procedure rather than this routine outage path. This plan does not claim a live alert, exercised rollback, or production incident evidence.
