# Private client gallery data flow

What a private delivery gallery holds, where it goes, who can see it, how long
it lives, and what the access cookie is. Written for the person who has to
answer those questions about a running deployment — the site owner, a customer
who asks, and the AB#117 launch review.

It records the **reference deployment**: the one this repository is maintained
against. A clone provisions its own object store and database, so a clone owns
its own version of this file. Nothing here is legal advice or a privacy policy;
this is the operational record a notice would be written from.

Sibling to [`contact-data-flow.md`](contact-data-flow.md), which covers the
contact form and the gallery-item enquiry. The boundary itself is
[ADR-0014](adr/0014-private-gallery-security-delivery-retention-boundary.md)
(AB#122), and this file is its action item 10. Work items: AB#29 (delivery and
the ZIP), AB#145 (administration and the customer notification), AB#130 (proof
selection).

**Status: no production or preview deployment serves client photographs.**
`PRIVATE_GALLERY_STORE` is `off` in those deployments; no object store or
private database is provisioned. The `memory` mode runs only in development
and serves synthetic metadata through the routes behind that switch. This file
describes what a provisioned deployment will do, so that the decisions are reviewable *before*
customer photographs exist rather than after. The per-asset mint route is present
and tested with a development fixture; it returns a signed object URL only after
fresh session authorization and a per-session 60-per-minute rate check, but no
deployed object store or private database can
serve one yet.

AB#130 now defines proof-selection values, pure server-side rules and a first-ready
transition plan checked against verified proof objects. A separate first-publication
plan rechecks the complete proof set and frozen pricing, refuses an expired upload
preparation or prior publication metadata, and derives the immutable six-calendar-month
access expiry from server time. The development proof fixture passes through both
plans before becoming visible; the plan itself does not commit a publication,
seal or expose a customer capability, or queue a publication message. Those
steps still need one durable administrator-authorized transaction. The upload
plan retains
each proof's complete filename, stable media identity and server-minted placement
identity alongside its opaque object key; after upload verification a pure join
can form the initial proof placements for that transition. These values are not
persisted or served in a deployed environment. A server-only store contract and
single-process development implementation now model conditional draft edits,
versioned immutable confirmations and a pending outbox entry containing the
exact validated photographer email as one atomic operation. The metadata-only
status read cannot return the recipient or message; a separate server-only
worker read can. Administrator reopen keeps earlier snapshots and the
original access expiry; resend queues a unique attempt only against the
currently locked version. A server-only customer read now checks the current
session and gallery before reading proof state, then projects at most 100 current
watermarked proof cards per page, the selected references and full filenames,
and the frozen-pricing summary. A confirmed review takes its selected list and
quote from the immutable confirmation even if a current placement is later
removed; the current cards remain live. No object key, media identity, byte
count, session value, recipient or outbox content crosses that projection. A
malformed row refuses the whole view. The in-process reference store supplies
the draft and current confirmation together; a future database adapter must
use one consistent read and bounded page and selected-row queries.
The customer write facade checks same-origin JSON requests and a streamed 64 KiB
limit before accepting a revisioned edit or confirmation. It reauthorizes the
session on each request; the store then checks that session's capability
generation, published state and access expiry in the same write as its draft
CAS. Edit responses include the atomic pricing summary; confirmation responses
contain only the version, time and quote, never the photographer recipient or
outbox material. A later database adapter must perform the generation and CAS
guards in one transaction using database time. A development-only
`GET`/`POST`/`PUT` proof API now consumes this facade through a second, distinct
in-memory proof gallery. The link and proof metadata
are fixtures, never a deployment with customer images. The API returns `no-store`
JSON and one generic refusal for absent, invalid, expired or wrong-gallery
access; only a valid holder sees a stale-draft conflict. Confirmation queues
the frozen message into an in-process outbox, but no request sends email.
The memory implementation has no cross-process durability or database uniqueness
guarantees; its proof route is a development fixture only. A future private database will
hold the published included count, integer extra-image unit price and currency, permanent
gallery-local references with full filenames and stable media identities, a
revisioned draft, immutable confirmation versions, and notification outbox
attempts. A pure server-only projection now prepares a plain-text photographer
notification from one immutable confirmation, including every selected reference
and complete filename; a shared exact formatter presents integer minor-unit
amounts in the owner's currency and locale. A server-only Resend gallery transport
now accepts one validated recipient per queued attempt and shares the existing
contact path's HTTP provider behavior. Its attempt key is distinct from the
contact path's; the pending memory outbox uses a stable key per initial version
and a new unique key for each administrator resend, copying the original
recipient and message. A server-only reference dispatcher now reserves one
queued attempt, sends the exact frozen request through an injected transport,
and records sent or redacted failed status without logging the message. An
automatic retry reuses the same key after a 60-second delay. Three claims are
allowed per row; each has a 30-second lease, and an abandoned final claim
ends as `worker-interrupted` rather than a fictitious provider failure.
A server-only batch runner now discovers at most 100 due attempts through the
store seam and dispatches them sequentially. Active leases and not-yet-due
retries are excluded; an expired lease is discoverable for recovery. A competing
worker's successful claim is a normal skipped candidate. Results and redacted
infrastructure errors carry only aggregate progress, never message contents.
The development store lists its own gallery's due rows; a future PostgreSQL
adapter needs a bounded indexed cross-gallery query and fair scheduling so one
gallery's retry backlog cannot starve others. No runtime scheduler invokes the
runner yet.
Earlier pending attempts stay intact after administrator reopen; their
version in the frozen message distinguishes them from later ones.
The provider's 24-hour idempotency window cannot eliminate duplicate email
if a send succeeds but its status write is lost and a much later retry runs;
the immutable confirmation remains the authoritative record. A transport
configuration module (`gallery-notification-transport.ts`) now selects and
validates a `resend` or development-only `sink` transport for this path,
mirroring the contact form's own adapter selection and refusing `sink`
outright in a production deployment. The production proof store, PostgreSQL
outbox, and scheduled worker that would invoke the batch runner do not exist.

The proof gallery's authorized page now renders a real selection panel
(`PrivateGalleryProofPanel`) instead of a placeholder sentence. The gallery's
first page of proof cards is server-rendered so the current draft and price
are visible without JavaScript. Each visible card mints its own short-lived
signed preview URL through the already authorized `/asset` route and places it
directly in a native-ratio `<img>` with `referrerPolicy="no-referrer"`; the
application never proxies object bytes. A page-local queue allows at most four
concurrent mints and 50 starts per rolling minute, leaving room under the
server's per-session 60-per-minute limit for retries and other tabs. A failed
image load remints once; further failures show an explicit retry control. A
page turn, checkbox toggle, or confirmation uses a JSON `fetch` against the
customer read/write facade. Image viewing and all interactions need JavaScript,
stated on the page in words. The development fixture contains only proof
metadata, so its `/asset` route cannot supply real signed URLs or image bytes;
this browser path is exercised with intercepted mint and image responses.
A toggled checkbox saves immediately as one whole-selection edit rather than
accumulating unsaved local state, using the store's `expectedRevision` CAS so
two tabs cannot silently overwrite each other; checkboxes disable while a save
is in flight to serialize writes against one revision. Once the facade reports
`confirmed: true` the panel renders only the frozen confirmation snapshot —
no checkbox, no edit control — so a later change to the gallery's live
placements cannot appear to reopen what the customer already confirmed. The
panel still runs only against the development memory fixture; no production
store exists for it to render real customer photographs from.

The administrator's own proof surface (`PrivateGalleryProofAdminPanel`, on the
signed-in administrator page) looks up one proof gallery by its handle and
shows its draft/confirmation state, pricing, current selection summary and —
once confirmed — the latest queued notification attempt's delivery status:
pending, sent, or failed with its error class and retry time. This status view is deliberately
narrower than the confirmation email or the customer panel: it never shows a
filename, a selected image, or a customer identity, because the question it
answers is "is the notification stuck", not "what did the customer pick" (the
administrator already has the confirmation email for that). Reopen unlocks the
draft for a new round of edits without touching any earlier confirmation or
outbox row; resend queues a fresh delivery attempt under the same confirmation
version, repeatably — two clicks queue two attempts rather than colliding.
Both re-authorize the administrator session on every call, exactly as the
customer mutation endpoint re-authorizes the customer session. There is still
no gallery creation, publication, or customer/job association in any form: an
administrator can only ever address a proof gallery whose handle they already
hold, and the development fixture has exactly one.

## What is held, and why it is different from the contact form

The contact form collects three fields a visitor typed. A private gallery holds
**photographs of identifiable people** — a wedding, a family, a portrait
sitting — supplied by the photographer, not the customer, and delivered to
them. That is a materially larger amount of personal data than anything else in
this repository, and it is the reason ADR-0014 exists at all.

| What | Where it lives | Notes |
| --- | --- | --- |
| Web-resolution previews (≤ 2048 px, ≤ 8 MB each) | Private object store | The only image bytes a browser ever receives |
| One full-gallery ZIP of the delivered full-resolution JPEGs | Private object store | Delivered whole; no individual full-resolution downloads |
| Gallery record: opaque id, opaque handle, state, capability generation, timestamps | Private database | No customer name, address, or contact detail is required by this model |
| Capability record: the link secret, AES-256-GCM encrypted | Private database | Encrypted rather than hashed, so the photographer can re-issue the link |
| Session records: a **hash** of each session identifier, plus its gallery and expiry | Private database | Never the identifier itself |
| Per-gallery exchange counter and access budget | Private database | Counts, not identities |

**Camera masters never go online.** The photographer prepares derivatives and
assembles the ZIP on their own machine; the full-resolution originals stay
there (ADR-0014 §8c). Archive locators and provider internals never reach any
browser payload (ADR-0002), and the private item projection carries no object
key, gallery id, or byte count.

**Object keys carry nothing about the customer or the photograph** — no name,
no shoot title, no original filename, no capture date. A key is not
browser-facing, but it is visible to anyone who can list the bucket and to the
provider's own tooling, and a listing reading `.../smith-wedding-2026/DSC_0431.jpg`
would publish the customer relationship to all of them.

## The access link, and what each half is exposed to

A gallery link is `https://<site>/<prefix>/<handle>#<capability>`.

- The **handle** (128 bits) is in the path. It therefore appears in the
  browser's address bar and history, in the hosting provider's request logs, and
  in any intermediary that sees the URL. It is opaque and names nothing on its
  own: knowing a handle does not open a gallery.
- The **capability** (256 bits) is in the **fragment**, which a browser never
  sends to a server. It is the whole credential. The bootstrap script reads it,
  removes it from the address bar with `history.replaceState`, and posts it once
  in a request body — never in a URL, so it reaches no access log and no
  `Referer`.

**Residual, documented and not eliminated** (ADR-0014 §3): the notification
email carries the complete link, so the customer's mail provider and any email
security service hold it, and a scanner that executes JavaScript can invoke the
exchange. The mitigations are the short session lifetime, the exchange rate
limits, revocation by the photographer, and the fact that a scanner's session is
bound to its own cookie jar. A customer who suspects a link was intercepted asks
the photographer to replace it, which retires the old one.

## The access cookie

One cookie, set only after a valid capability is exchanged.

| Property | Value | Why |
| --- | --- | --- |
| Name | `__Secure-pg_session` | The prefix requires `Secure` and a secure origin |
| Contents | A 256-bit random identifier, and nothing else | Not a token carrying claims; the server holds only its SHA-256 hash |
| `HttpOnly` | yes | Script cannot read it |
| `Secure` | yes | Never sent over plain HTTP |
| `SameSite` | `Lax` | The gallery is reached by following a link |
| `Path` | `/<prefix>/<handle>` | Scoped to the one gallery, so a second gallery's routes never receive it |
| `Domain` | **absent** | Host-only; no sibling subdomain receives it |
| Lifetime | `min(7 days, time left in the access window)` | Never outlives the gallery's own six-month window |

It is **strictly necessary for a service the customer asked for**: without it,
following the link would authorise nothing. It carries no identifier that
follows anyone across sites, is scoped to a single gallery path, and is used for
nothing but authorising that gallery. This repository's goal of running without
a cookie banner rests on that characterisation — which is an engineering
description, not a legal conclusion, and the deployment owner is the one who
decides what their notice says.

## The administrator session cookie

A second cookie, entirely separate, for the site owner rather than a customer.
It is set when the operator signs in at the administrator namespace, and cleared
when they sign out — which also deletes the server's session row, because a
cookie cleared alone would leave a live session any copy of the identifier could
still present. Nothing about a customer is stored in it or alongside it.

| Property | Value | Why |
| --- | --- | --- |
| Name | `__Host-pg_admin_session` | The prefix is browser-enforced: `Secure`, `Path=/`, and no `Domain`, so no sibling subdomain can set it |
| Contents | A 256-bit random identifier, and nothing else | The server holds only its SHA-256 hash; there is no operator identity in it, because there is one operator and no user table |
| `HttpOnly` | yes | Script cannot read it |
| `Secure` | yes | Never sent over plain HTTP |
| `SameSite` | `Strict` | An administrator route is never arrived at by following a link from elsewhere |
| `Path` | `/` | Required by `__Host-`. The cookie therefore travels on public requests too — the deliberate trade for a cookie a subdomain cannot set |
| `Domain` | **absent** | Required by `__Host-` |
| Lifetime | 2 hours by default, 12 hours maximum, absolute | No sliding renewal: using the session never extends it |

The login that mints it is rate-limited by a counter holding **a window start
and an attempt count, and nothing else** — no address, no client identifier, no
record of who tried. It is one row for the whole deployment, so there is nothing
in it that is about a person.

The credential itself is a `scrypt` hash in the deployment's own configuration
(`PRIVATE_GALLERY_ADMIN_SECRET_HASH`). It is not a customer's data and not a
record of anyone: there is one operator, no user table, no email address, and no
account to enumerate. Nothing about a login attempt — successful or not — is
stored beyond that counter.

The sign-in form keeps its secret field and submit button disabled until
hydration (AB#153); without JavaScript they remain disabled. The field has no
HTML submission name. An unexpected native submission therefore carries no
secret and explicitly POSTs to the login endpoint, which refuses non-JSON
content. Once hydrated, the form sends the secret only in the same-origin JSON
POST body. Browser regressions cover disabled JavaScript, blocked and delayed
hydration, and forced native submission with a synthetic canary.

Two properties are worth stating plainly, because they are what a reader of this
record would otherwise have to take on trust:

- **Rotating the administrator secret ends every live session.** Each session
  row carries a digest of the credential it was minted against, and every
  request compares it against the deployment's current one. Central revocation
  is therefore a configuration change and a redeploy, not a table anyone has to
  remember to clear.
- **An irreversible operation — deleting a gallery, revoking or replacing access
  — needs the credential proved again** within the preceding five minutes, so a
  session left open on an unlocked laptop cannot destroy a customer's gallery.

It shares no store, no cookie name, no lifetime, and no field with the customer
access cookie above. Neither can be presented as the other.

There is **no visitor-facing privacy notice on the private gallery page today**.
The contact form has one (`SiteSettings.contact.privacyNotice`); whether the
private gallery needs its own, and what it says, is an open question for AB#145
along with the rest of the customer-facing administration surface. It is listed
here rather than left to be noticed at launch.

## Processors

| Processor | What it sees | Status |
| --- | --- | --- |
| Object-store provider (reference: UpCloud Managed Object Storage, EU) | The derivative and ZIP bytes, and the object keys | **Not provisioned.** AB#29 |
| Database provider (PostgreSQL-family, EU, vendor open) | The gallery, capability, session, and counter records | **Not provisioned.** AB#29 |
| Vercel | The requests themselves; no private image or ZIP byte passes through a Function | Live for Preview only |
| Resend | The notification email and its recipient address | **Not provisioned.** AB#117 owns the account and its DPA review; AB#145 owns the send |

No private byte is proxied through a Function: the browser fetches previews and
the ZIP directly from the object store over a short-lived signed URL. The
practical consequence for this record is that the hosting provider never holds
image bytes, and the object-store provider never holds an application session.

## Application-emitted logs

Two event names, `private-gallery.exchange` and `private-gallery.view`. Each
line carries exactly three things: a random correlation identifier, a state, and
a redacted error class.

**Never logged:** the capability, the handle, the session identifier or its
hash, an object key, a customer's address, or any image data. Unit tests assert
the absence of the first three on both the accepted and the rejected paths.

Ordinary refusals are **not** logged at all — an expired session, a wrong
capability, an unknown handle. Only defects are: a data-integrity problem, a
configuration mistake, and the first refusal of a rate window. Logging the
ordinary ones would let anyone fill the log by reloading a private URL, and
would turn the log into a record of who tried what and when.

## Abuse-control data

The per-IP throttle key is a **salted SHA-256 digest** of the forwarded address,
with the salt generated per process, never configured, never logged, and never
stored. No raw address is retained by the application. The state is in-process
and best-effort; it disappears on restart.

The persistent controls are counts rather than identities: a per-gallery
exchange counter (20 per hour) and a per-gallery access budget (ten times the
gallery's own bytes per 30-day window, keyed by gallery and capability
generation). Neither records who made a request.

## Retention

- **Access ends at six calendar months** from publication, computed once and
  immutable. From that instant every authorization check refuses, regardless of
  what still exists in storage.
- **Objects are deleted after that**, by a scheduled worker that must run at
  least daily. Verified deletion completes within 30 days of the cleanup
  trigger — the earlier of the access expiry, an administrator delete, or an
  abandonment deadline.
- **Session rows are reaped on their own expiry**, in bounded batches,
  independently of whether their gallery has entered deletion.
- **A backstop bucket rule** expires objects at 275 days, noncurrent versions at
  30 days, and aborts incomplete multipart uploads at 7 days. It is a net for
  objects the worker missed, never the access clock.
- The longest a legitimate object lives is therefore
  `30 + six calendar months + 30 + 30` days.
- **A database restore re-runs the worker**, which is what makes expiry
  restore-safe. The database's point-in-time-recovery window must sit inside the
  30-day ceiling, or a restore could reintroduce records the lifecycle promised
  were gone — which is why it is a provider-selection criterion in
  [`deployment.md`](deployment.md) rather than a preference.

## Boundary rules the code enforces

- The capability travels only in a fragment and then in a bounded request body —
  never in a path, query string, or referrer.
- Every private response carries `Cache-Control: no-store`,
  `X-Robots-Tag: noindex, nofollow`, and `Referrer-Policy: no-referrer`, whether
  the feature is on or off, and `robots.txt` disallows the namespace.
- The bootstrap document **looks nothing up**. It renders identically for a
  handle that names a real gallery and one that names nothing, so an initial
  `GET` never reveals whether a gallery exists.
- Every exchange failure answers identically — same status, same body, no
  `Retry-After` — so nothing distinguishes an unknown handle from a throttled
  known one.
- Authorization is re-derived on **every** request from the cookie and a fresh
  gallery read. A revoke or a closed window takes effect on the next navigation.
- A gallery is read by the session's own id, never by the handle in the URL, so
  no store lookup is ever keyed by something a visitor supplied.
- A page never receives an object key, and no request may name one: a signed URL
  is minted from a server-owned identifier only.
- Signed URLs are `GET`-only, single-object, and capped at
  `min(configured TTL, time left in the access window)` — minutes for a preview,
  at most six hours for the ZIP.
- Credentials are server-side only, never through a `NEXT_PUBLIC_` variable, a
  URL, or the client bundle; a `NEXT_PUBLIC_` mirror of any of them fails the
  build.

## Before production launch

Open, and listed so the gap is visible rather than assumed:

- **The two services are not provisioned.** The object store and the database,
  their three least-privilege credentials, the bucket's default-deny policy, the
  live verification gate, the backup and restore rules, drift monitoring, and the
  exit path are all in [`deployment.md`](deployment.md) and are the site owner's
  to run. None of it has been exercised, because no deployment has provisioned
  either service.
- **The Resend account does not exist**, and its DPA and data-residency review is
  AB#117's own prerequisite work.
- **The administrator-authentication boundary is designed; its namespace and
  session model are built, and nothing that authenticates is.**
  [ADR-0015](adr/0015-administrator-authentication-boundary.md), accepted
  2026-09-02, decides it: its own reserved namespace, a `__Host-` administrator
  session sharing nothing with the customer path, a persisted login rate limit,
  and a generated single-operator secret verified with scrypt. What exists today
  is §1's namespace — `PRIVATE_GALLERY_ADMIN_ROUTE_PREFIX`, reserved as a root
  segment separate from the customer prefix, carrying the same `no-store`,
  `noindex, nofollow`, and `no-referrer` response hygiene and a production
  `robots.txt` `Disallow` — and §2's session model and cookie contract, recorded
  in the section above. It owns no route, so every path under it is a 404, **no
  administrator session cookie is set by any deployment, and no administrator
  credential is read, verified, or stored anywhere.** §3's persisted login rate
  limit and §4's `scrypt`-verified secret are the remaining slices. The record's
  accepted residuals — a bearer credential with no second factor, and no audit
  trail of administrative changes — belong here once they are real.
- **No visitor-facing privacy notice exists for the private gallery**, as above.
- **This file has not been reviewed against a running deployment**, because there
  is not one. Every retention and processor claim here describes intended
  behaviour that the provisioning gate is what will confirm.
