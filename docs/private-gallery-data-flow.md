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

**Status: the feature serves nothing in any deployment today.**
`PRIVATE_GALLERY_STORE` is `off` everywhere, no object store or database is
provisioned, and the routes exist behind that switch. This file describes what a
provisioned deployment will do, so that the decisions are reviewable *before*
customer photographs exist rather than after.

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
  their three least-privilege credentials, the bucket's default-deny policy, and
  the live verification gate are all in [`deployment.md`](deployment.md) and are
  the site owner's to run.
- **The Resend account does not exist**, and its DPA and data-residency review is
  AB#117's own prerequisite work.
- **The administrator-authentication boundary is designed but not built.**
  [ADR-0015](adr/0015-administrator-authentication-boundary.md), accepted
  2026-09-02, decides it: its own reserved namespace, a `__Host-` administrator
  session sharing nothing with the customer path, a persisted login rate limit,
  and a generated single-operator secret verified with scrypt. Nothing of it
  exists yet, so no administrator session cookie is set by any deployment. When
  it is built, this file gains that cookie in the section above and the record's
  accepted residuals — a bearer credential with no second factor, and no audit
  trail of administrative changes — belong here too.
- **No visitor-facing privacy notice exists for the private gallery**, as above.
- **This file has not been reviewed against a running deployment**, because there
  is not one. Every retention and processor claim here describes intended
  behaviour that the provisioning gate is what will confirm.
