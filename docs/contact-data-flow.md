# Contact form data flow

What the contact form collects, where it goes, who can see it, and how long it
lives. Written for the person who has to answer those questions about a running
deployment — the site owner, a visitor who asks, and the launch review in
AB#117, whose acceptance criteria require exactly this inventory.

It records the **reference deployment**: the one this repository is maintained
against. A clone configures its own accounts, so a clone owns its own version of
this file. Nothing here is legal advice or a privacy policy; the visitor-facing
notice is authored content (`SiteSettings.contact.privacyNotice`), and this file
is the operational record behind it.

Related: [ADR-0004](adr/0004-reference-production-host-and-ownership-boundary.md)
decided the hosting and ownership boundary and accepted the logging boundary
below on 2026-08-04. Work item: AB#12.

## What is collected

Three fields, and nothing else. The endpoint refuses a request carrying any
other field rather than ignoring it.

| Field | Purpose |
| --- | --- |
| Name | Addressing the reply |
| Email address | Delivering the reply; used as `Reply-To` |
| Message | The enquiry itself |

Attachments and submitted HTML are outside the MVP: there is no field for
either, so nothing downstream has to strip one. No cookie is set, no analytics
is loaded, and no third-party script runs on the page.

## Where it goes

```
Visitor's browser
  │  POST /api/contact  (application/json, same-origin, ≤ 8 KB)
  ▼
Application (Vercel Function, arn1/Stockholm)
  │  validate → compose plain-text email → discard the submission
  ▼
Delivery adapter (CONTACT_DELIVERY_ADAPTER)
  │  "resend": POST https://api.resend.com/emails
  │  "sink":   accepts and sends nothing — refused in a production deployment
  ▼
Site owner's mailbox (CONTACT_DELIVERY_TO)
```

The application stores nothing. There is no database, no queue, no file, and no
cache holding form content at any point — the message exists in function memory
for the length of one request and is gone when it returns.

`SITE_DEPLOYMENT_STAGE` declares which environment a deployment is, and an
undeclared stage counts as `production`. The sink adapter is refused there:
reporting success while delivering nothing is silent data loss, and a document
saying where the adapter belongs is not a control. Building the delivery path
fails on the first attempted submission instead, so the misconfiguration
surfaces as an error rather than as enquiries that never arrive. The page and
the deployment can still build and start without delivery credentials.

## Processors

| Party | Role | Data it sees | Retention | Ownership |
| --- | --- | --- | --- | --- |
| **Vercel** (hosting) | Processor for the application; controller for its own Service-Generated Data | Request metadata: path, status, region, user agent, IP address. Not form fields — those are in the request body, which Runtime Logs do not record | Runtime Logs 1 day on Base Pro without Observability Plus. Broader Service-Generated Data is not assumed to be deleted with that window | Customer-owned Vercel Pro team (AB#116) |
| **Resend** (delivery) | Processor for the outbound message | The whole email: name, address, message text | Email data 30 days on standard plans, per Resend's documentation | Customer-owned Resend account, customer-verified sending domain, environment-scoped API key |
| **Mailbox provider** | Processor for the received message | The whole email | Whatever the owner's mailbox retention is | Customer-owned |

Open and click tracking are **disabled by default** for a Resend domain and are
left disabled: the outbound message is plain text with no links to rewrite, no
HTML part, and no tracking pixel.

## Application-emitted logs

The application writes one event per submission and nothing else. Its schema is
fixed by ADR-0004 §5 and enforced by `src/lib/contact-log.ts`:

```json
{"event":"contact.submission","correlationId":"<random uuid>","state":"delivered"}
```

`state` is one of `accepted`, `delivered`, `rejected`, `delivery-failed`. A
non-success event adds `errorClass`, drawn from a set the type system closes —
never a provider message, which can restate the request it describes.

Two categories of refused request are deliberately **not** logged per
occurrence, because either would hand an unbounded log-volume lever to anyone
willing to keep sending:

- A request that fails the stateless header checks — wrong method, wrong content
  type, another site's origin — never became a submission. Those appear as
  statuses in the hosting provider's request log instead.
- A throttled client is logged once per window rather than once per request.

No name, address, message, provider response body, API key, or client
identifier is ever written. The correlation identifier is random, embeds nothing
about the visitor, and is not stored beside form content, because no form
content is stored. It is returned to the visitor only when the corresponding
application event was written, so a person never receives an untraceable
reference when asking what happened.

## Abuse-control data

The endpoint keeps one thing in memory: a per-runtime-instance count of recent
attempts per client, keyed by a SHA-256 hash of the client IP salted with a
random value minted at process start.

- Not reversible to an address, not correlatable across instances, and
  meaningless after the instance ends.
- Never logged, never returned, never persisted.
- Best-effort by design. ADR-0004 §2 forbids depending on process memory for
  shared state and the MVP provisions no shared store, so this blunts a burst
  against one instance; the platform firewall is the control that bounds a
  determined sender.

The honeypot field carries no data of its own: a submission that fills it is
answered exactly as a successful one and delivered nowhere.

## Boundary rules the code enforces

- Form fields travel only in the bounded request body — never in a path, query
  string, or fragment, and therefore never in a referrer or a hosting-provider
  request log. Query parameters on the route are not read or copied anywhere.
- Only `POST` and only `application/json` are accepted, and the `Origin` must
  match the host the browser addressed. Those checks run *before* the throttle,
  so a cross-origin POST — which a browser will send without a preflight — cannot
  spend the allowance belonging to a real visitor at the same address.
- The submit control is inert until the page hydrates, so a form submission
  cannot fall back to a native GET that would put the fields in the URL.
- Responses are `no-store` and carry no CORS headers.
- Credentials are read server-side only, never through a `NEXT_PUBLIC_`
  variable, a URL, or the client bundle. Preview and Production hold different
  values, and Preview delivers to the sink adapter with synthetic data.

## Before production launch

These are AB#116's and AB#117's to close, and they are listed here so the gap is
visible rather than assumed:

- [ ] Verify Resend's current data-residency options, retention terms,
      sub-processor list, and DPA (including EU transfer clauses) against the
      account actually provisioned, and record what was agreed. The choice was
      made on the understanding that email data is retained for 30 days and
      account data is held in the United States under SCCs — that has to be
      confirmed against the terms in force at provisioning, not assumed from
      this file.
- [ ] Record the Vercel privacy role, data categories, access, retention,
      deletion, and transfer boundary in force at provisioning (ADR-0004,
      action item 3), and limit Runtime Logs access to operators who need it.
- [ ] Confirm the recipient mailbox's own retention and deletion practice, and
      write it into `SiteSettings.contact.privacyNotice`.
- [ ] Replace every placeholder value in that notice with what this deployment
      actually does.
