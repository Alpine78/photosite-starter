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

The sink also reports a chosen delivery failure — an outage, a refused request,
an exhausted allowance — when the reply-to address is on the reserved
`delivery-failure.test` domain, so the failure states the form can show are
reachable in Preview and in the public-journey suite without breaking a
deployment. `.test` is reserved by RFC 6761 and resolves nowhere, so no address
anyone could receive mail at can land on one by coincidence, and the behavior
lives in the adapter that a production deployment already refuses to build.

## Processors

| Party | Role | Data it sees | Retention | Ownership |
| --- | --- | --- | --- | --- |
| **Vercel** (hosting) | Processor for the application; controller for its own Service-Generated Data | Request metadata: path, status, region, user agent, IP address. Not form fields — those are in the request body, which Runtime Logs do not record | **Preview, today: Runtime Logs 1 hour on Hobby** (checked live and against Vercel's own documentation, 2026-08-25 — this row's original "1 day on Base Pro" figure describes Production's still-undecided plan, per [ADR-0004](adr/0004-reference-production-host-and-ownership-boundary.md)'s 2026-08-25 amendment; see "Before production launch" below). **Production's retention figure follows whichever tier AB#18 chooses** — unresolved. Broader Service-Generated Data is not assumed to be deleted with that window | Customer-owned Vercel team, provisioned by AB#116, currently on Hobby for Preview/development — **the Production tier is unresolved, not decided: ADR-0004's original Pro Decision stands until AB#18 reconsiders it. See [ADR-0004](adr/0004-reference-production-host-and-ownership-boundary.md)'s 2026-08-25 amendment and "Before production launch" below** |
| **Resend** (delivery) | Processor for the outbound message | The whole email: name, address, message text | Email data 30 days on standard plans, per Resend's documentation — **unconfirmed against a real account; see below** | Customer-owned Resend account, customer-verified sending domain, environment-scoped API key — **this describes the intended setup, not a verified live account: as of 2026-08-25 no Resend account has been confirmed to exist, and provisioning it is AB#117's own prerequisite work (see "Before production launch" below)** |
| **Mailbox provider** | Processor for the received message | The whole email | Whatever the owner's mailbox retention is | Customer-owned |

Open and click tracking are **disabled by default** for a Resend domain and are
left disabled: the outbound message is plain text with no links to rewrite, no
HTML part, and no tracking pixel.

## Application-emitted logs

The application writes at most two events per submission and nothing else — an
`accepted` event once a request is a real submission, then exactly one terminal
event (`delivered`, `delivery-failed`, or `rejected`). A request refused before
it becomes a submission writes at most one `rejected` event, or none at all (see
below). The schema is fixed by ADR-0004 §5 and enforced by
`src/lib/contact-log.ts`:

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

## Gallery-item enquiry (`/api/enquiry`)

Since AB#60 a second endpoint lets a visitor ask the photographer about one
specific gallery photograph. It reuses this same flow — the same header checks
ahead of the throttle, the same bounded body and closed field whitelist, the
same honeypot rule, the same delivery adapter and mailbox, and the same
per-instance abuse counter — and adds only the item context.

**What is collected.** The three contact fields above, plus the *public*
identity of the photograph the visitor is looking at:

| Field | Purpose |
| --- | --- |
| `kind` | `curated` or `dynamic` — which kind of result the item came from |
| `locale` | The route locale, so the server reads the right content tree |
| `contentId` | The gallery's stable identity (curated enquiries only) |
| `itemId` | The occurrence (`placementId`) or the photograph (`mediaId`), per ADR-0002 §1 |

The endpoint refuses a request carrying any other field. Nothing here is a
provider identifier, an archive path, or a file URL: those are resolved
**server-side** and never accepted from the browser.

**Server-side resolution.** The server turns the submitted context into the
photographer-facing facts an answer needs — the stable `mediaId`, the caption
and credit already resolved for it, the gallery it sits in, and, **only from a
private Sanity dataset**, the `archiveLocator` that points at the master file
(ADR-0002 §1). A curated container is authorized against the public content tree
first; an unknown, unpublished, private, or non-enquirable item, or a dynamic
enquiry the content source cannot yet authorize, all resolve to one generic
`404` so a probe cannot tell which check failed.

**Where the resolved facts go.** Into the body of the email the site owner
receives, and nowhere else. The `archiveLocator` in particular appears **only**
in that email — never in the HTTP response, never in an operational-log line,
never in a URL. It reaches the email because that message is delivered solely to
the owner's own mailbox, the same one the contact form uses.

**Delivery.** The same Resend account (or the non-production sink) as the
contact form. The idempotency key is namespaced `enquiry:<submissionId>` so an
enquiry and a contact submission can never share a provider key even if their
client-generated identifiers coincide.

**Logs.** The same three-field schema, under a distinct event name and its own
closed class set:

```json
{"event":"enquiry.submission","correlationId":"<random uuid>","state":"delivered"}
```

Same `state` values, same `errorClass` rules — structural classes only, never a
provider message and never the resolved `mediaId` or `archiveLocator`. As with
the contact endpoint, an `accepted` event is followed by exactly one terminal
event on every path, including a content-store outage during resolution or the
settings read; a store failure is recorded as `source-unavailable` (retryable)
or `source-error` (not), an unclassifiable defect as `internal`.

**Nothing is stored.** No enquiry field, and no resolved fact, is written
anywhere. The processing record for a delivered enquiry is the email in the
owner's mailbox, subject to that mailbox's own retention.

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
visible rather than assumed. AB#117's launch review
(`docs/security-privacy-review.md`, AC3) confirmed on 2026-08-22 that all four remain
open: they require a live Vercel/Resend account, which does not exist yet (AB#116 was
reopened for the same reason).

**Re-checked 2026-08-25**, against AB#116 (closed 2026-08-24). The four items
no longer share one blocker — they split three ways:

- **The Vercel item's Preview-account inspection is closed; the Production
  hosting-tier decision is not.** Checked live 2026-08-25: exactly one
  member, role `OWNER` (nobody else to limit); `billing.plan` reads
  `"hobby"`, not the `"pro"` this project's own provisioning docs assume
  for Production; Runtime Logs retention is one hour and Observability Plus
  is not offered on Hobby at all (checked against Vercel's own current
  documentation, 2026-08-25) — all facts about the environment that exists
  today. **Owner decision, 2026-08-25: Hobby remains in use for development
  and Preview; no decision has been made to use Hobby for Production, and
  the Production tier is unresolved, to be reconsidered immediately before
  AB#18.** ADR-0004's original Decision (Pro) remains the authoritative
  Production plan for now. Recorded in full in
  [ADR-0004](adr/0004-reference-production-host-and-ownership-boundary.md)'s
  2026-08-25 amendment and as comments on AB#117 and AB#18. **The
  interpretation risk isn't scoped to a future Production choice — it
  applies to the current Hobby-on-Preview usage too**, since Vercel's
  fair-use rule turns on the deployment's purpose, not its Preview/Production
  label: this repository's own secondary purpose as a professional software
  portfolio leaves a genuine interpretation risk under Vercel's broad
  "financial gain of anyone involved in any part of the production" wording
  that this review does not claim to have settled, for Preview or
  Production. The owner accepts this as an open risk for as long as Hobby
  remains in use. Vercel Support's explicit confirmation would give
  certainty for Preview too, and is needed before AB#18 promotes production
  **specifically if Hobby is proposed for Production**. **If Pro is chosen
  for Production instead**, that half of the analysis becomes moot for
  Production, though it doesn't retroactively resolve whatever period was
  spent on Hobby beforehand.
- **The two Resend-account items** (data-residency/DPA terms; replacing the
  notice's Resend-related placeholders) are unchanged in one sense — this
  deployment's own configuration still shows no Resend account wired in,
  delivery for Preview still runs on the `sink` adapter (`docs/deployment.md`),
  and `RESEND_API_KEY` stays unset and Production-only — but their sequencing
  is no longer open. **Owner decision, 2026-08-25: provisioning the Resend
  account and completing this ownership/DPA/retention review is prerequisite
  work under AB#117, done before AB#18, not something AB#18's own production
  provisioning produces.** This resolves the circularity the 2026-08-25
  re-check first surfaced (AB#18's own description requires AB#117's
  security/privacy gate complete before promotion, which made "wait on
  AB#18" self-contradictory): AB#117 does not defer or weaken this
  acceptance criterion, it owns provisioning the account and completing the
  review directly. AB#18's own scope is narrowed to match — it wires the
  *already-reviewed* account into Production (secrets, sending domain) and
  verifies contact delivery works, and does not itself provision or review
  the account. Recorded as a comment on both AB#117 and AB#18
  (2026-08-25). The account has not been provisioned yet — provisioning a
  real third-party account is the site owner's action, not something this
  repository's tooling performs — so both items remain open until it is.
- **The recipient-mailbox item** turns out not to share the Resend items'
  blocker at all: Resend is only the delivery transport into a mailbox, not
  what creates one, and AB#116's own provisioning record (Azure Boards)
  confirms the site owner already operates a real mail service independent
  of this project. The recipient mailbox this item asks about is very
  likely that pre-existing service, answerable now without a Resend
  account — see the checklist entry below.

Re-check this list again once the Resend account is provisioned, rather than
assuming it is still accurate.

- [ ] Verify Resend's current data-residency options, retention terms,
      sub-processor list, and DPA (including EU transfer clauses) against the
      account actually provisioned, and record what was agreed. The choice was
      made on the understanding that email data is retained for 30 days and
      account data is held in the United States under SCCs — that has to be
      confirmed against the terms in force at provisioning, not assumed from
      this file. **Owned by AB#117 as prerequisite work (decided
      2026-08-25), not deferred to AB#18: the account still needs to be
      provisioned, by the site owner, before this item can close.**
- [ ] Record the Vercel privacy role, data categories, access, retention,
      deletion, and transfer boundary **in force for Production** (ADR-0004,
      action item 3), and limit Runtime Logs access to operators who need it.
      **Preview's own facts are checked and recorded, 2026-08-25, but this
      item asks about Production, and Production's tier is not decided.**
      Team membership: exactly one member, `OWNER` role — nobody else to
      limit, today. `billing.plan` for the current (Preview) team reads
      `"hobby"`, not the `"pro"` ADR-0004's Decision states for Production;
      owner decision: Hobby remains in use for development and Preview, no
      decision has been made to use Hobby for Production, and the tier is
      unresolved until AB#18 — see
      [ADR-0004](adr/0004-reference-production-host-and-ownership-boundary.md)'s
      2026-08-25 amendment. Runtime Logs retention is one hour on Hobby and
      Observability Plus is not offered on Hobby at all (both checked
      against Vercel's current documentation, 2026-08-25) — true of Preview
      today, and would carry over to Production only if Hobby is chosen for
      it. **This item stays open until the Production tier is decided and
      its actual privacy role/retention/access facts are recorded against
      that tier** — see the next item for what that decision needs.
- [ ] **Decide the Production Vercel plan tier before AB#18.** Not decided:
      ADR-0004's original Decision (Pro) still stands; Hobby is only what
      Preview happens to be running. If Pro is chosen, this item and the one
      above close together with no further action. **If Hobby is proposed
      for Production instead, first obtain Vercel Support's explicit
      confirmation that this repository's dual purpose as a professional
      software portfolio alongside a personal photography site doesn't put
      it outside Hobby's fair-use terms** — Vercel's own guidance recommends
      contacting Support when unsure, this review's own reading of the
      public terms is not a substitute for that confirmation, and getting it
      before AB#18 promotes production is materially cheaper than reversing
      a plan/ToS decision after the site is live on a real domain.
- [ ] Confirm the recipient mailbox's own retention and deletion practice, and
      write it into `SiteSettings.contact.privacyNotice`. **Re-checked
      2026-08-25: not blocked on Resend at all.** Resend is only the
      delivery transport into a mailbox; it is not what creates the mailbox.
      AB#116's own provisioning record (Azure Boards) confirms the site
      owner already operates a real mail service independent of this
      project — production promotion is required to preserve its existing
      DNS mail records — so the recipient mailbox this item is asking about
      is very likely that pre-existing service, not something Resend
      provisions. This item is answerable now: confirm with the site owner
      which mailbox receives contact enquiries and check that provider's own
      retention terms.
- [ ] Replace every placeholder value in that notice with what this deployment
      actually does. **Partially unblocked: the mailbox-retention half can
      be written in now; the Resend data-residency/DPA half above is
      AB#117's prerequisite work (decided 2026-08-25) and still needs the
      account provisioned first.**
