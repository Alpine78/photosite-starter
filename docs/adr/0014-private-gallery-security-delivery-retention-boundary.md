# ADR-0014: Private client gallery security, delivery, and retention boundary

**Status:** Accepted
**Date:** 2026-08-31
**Deciders:** Project owner (Ilkka Rytkönen)
**Work item:** AB#122

## Context

AB#122 is a spike/ADR that must decide the security, storage, delivery, proof-selection,
and retention boundary for **private client galleries** before any of that feature is
built, split, or estimated. It is explicitly **post-MVP**. Its parent is the Feature
AB#63 ("Private client galleries: delivery and proof selection"); its two implementation
successors are AB#29 (private delivery galleries and the protected full-gallery ZIP) and
AB#130 (private proof selection with included and extra-image pricing). This record
authorises **no implementation** — it fixes the boundary those stories build inside, and
each of them moves its own Azure Boards state.

### The legacy baseline and the confirmed business context

- The existing Joomla site publishes **unlisted** customer gallery pages. Customer-facing
  access is meant to expire after **six months**, but the gallery files stay on the web
  host until someone deletes them by hand. The legacy `public_html` is ~36.5 GB, largely
  these galleries.
- Customers are **explicitly allowed to share gallery access with family members.** The
  risk of a link holder acting on that access is accepted by the site owner. There is no
  per-customer account and no separate confirmation code.
- Private galleries have two distinct modes:
  - **Delivery gallery** — completed images: uncropped web-resolution viewing and **one**
    ZIP containing the complete delivered gallery. No individual full-resolution
    downloads.
  - **Proof gallery** — choosing images: web derivatives exported from Lightroom with a
    **large baked-in watermark**, an included-image allowance, extra-image price
    visibility, and a final customer selection. The application does **not** add a dynamic
    watermark in the initial implementation, and a watermark is a deterrent, never an
    authorization mechanism.
- The photographer keeps a **separate long-term offline archive** and may sell old images
  later as a paid service. **The website is not the long-term archive.**
- The result must stay a **customer-owned, single-photographer deployment** — not a SaaS,
  not multi-tenant, no shared customer database.

### The isolation requirement (owner comment, 2026-08-14)

Private client-gallery **functionality** may live in the same Next.js application and
deployment as the public site. Private gallery **storage** is a separate service
boundary. Specifically:

- Private-gallery metadata, authorization, derivatives, and downloads must be isolated
  from the public Sanity content and the public media path.
- A Sanity Free/public dataset and permanent public asset URLs must **not** be used for
  client-gallery assets.
- The application reaches private object storage through a **server-only adapter** and
  issues asset access **only after authorization**, using short-lived access (signed
  URLs) or another mechanism approved by this spike.
- The exact storage provider, metadata store, access model, and deployment topology are
  decisions for this ADR.

### The storage-independence checkpoint (owner comment, 2026-08-11)

Application hosting and private-gallery object storage are evaluated **independently** —
keeping Next.js on Vercel does not require storing gallery derivatives or ZIP files on
Vercel. Candidates named for comparison: **UpCloud Managed Object Storage** (Finnish
provider; S3-compatible; 250 GB from EUR 5/month; zero-cost egress subject to a Fair
Transfer Policy), **Cloudflare R2** (a non-European-company comparison candidate for its
object-storage and egress characteristics), and **Infomaniak / other European offerings**
only after their private-object, signed-access, lifecycle, API, and recovery capabilities
are verified. **Ordinary web-hosting disk space is not assumed to provide the
authorization boundary.** The comparison must cover private object authorization,
non-enumerability, expiring signed access, six-month lifecycle deletion, cache and backup
consequences, protected ZIP creation and delivery, failure recovery, logs, and cost.
Large ZIPs and full-resolution assets must **not** be proxied through an ordinary Vercel
Function.

### Constraints inherited from accepted decisions

- **[ADR-0002](0002-media-identity-and-placement-boundary.md)** reserves `privateOnly` on
  the media record — it "hard-excludes from every public surface regardless of the
  others; its enforcement mechanism is AB#122's decision, not this one." It also fixes
  that the provider asset reference and `archiveLocator` are **server-only** and that
  `archiveLocator` is never even resolved into anything public. This ADR defines how
  `privateOnly` is enforced, stored, and expired.
- **[ADR-0005](0005-public-image-rendition-boundary.md)**: browser-facing sources are
  public web derivatives only, never archive masters or private/sales-delivery assets; a
  public → private move needs a new or revoked public source URL plus a provider
  cache purge; "keep private delivery under AB#122".
- **[ADR-0004](0004-reference-production-host-and-ownership-boundary.md) §6** already
  constrains this work:
  - A successful authorization may mint a short-lived, object-scoped download URL from a
    customer-owned object store; the browser downloads **directly** from storage; the
    application must **not** proxy a camera original through a Vercel Function.
  - Vercel Functions have a **100 MB request-body** limit and a **4.5 MB response-body**
    limit (re-verified 2026-08-31 — the Evidence records the current official-source
    discrepancy). This does not make every single full-resolution JPEG technically
    impossible to proxy, but it makes proxying
    **unreliable**: an allowed processed JPEG or ZIP can exceed 4.5 MB, and this ADR's
    20 GB ZIP ceiling is far outside the Function response boundary.
  - Generated ZIP archives are not assumed to fit a synchronous Function request —
    evaluate asynchronous generation, temporary storage, duration, memory, and cleanup.
  - Signed-URL query tokens are never persisted in content, application logs, analytics,
    or caches; account for unavoidable storage/CDN request logging and token redaction.
  - Draft, private, contact-form, authorization, and signed-download responses are always
    excluded from the public cache.
  - Customer-owned accounts throughout; no shared cross-customer account, credential, or
    production resource.
- **[ADR-0006](0006-sanity-data-access-boundary.md)**: the project reaches its content
  store over `fetch` with **no client SDK**, behind a module guarded by
  `import "server-only"`, with an ESLint rule keeping `src/app` and `src/components` from
  importing it. This is the pattern the private-store adapters follow.
- **[ADR-0007](0007-proxy-request-path-boundary.md)**: `src/proxy.ts` is the one layer
  that can set per-prefix response behaviour before a route renders.
- **[ADR-0011](0011-security-response-headers.md)**: the site-wide CSP allows only `self`
  plus (for a Sanity deployment) that deployment's own `cdn.sanity.io` image path; a new
  browser-facing origin needs an explicit, narrow grant.
- **`AGENTS.md` hard rules**: keep it generic (no photographer identity, contact details,
  or brand in code — a private-gallery configuration is deployment config, not code);
  MVP-first (this ADR decides a boundary and authorises no build); minimal dependencies
  (a storage-signing helper, a Postgres driver, and a ZIP writer are each new
  dependencies with a stated need, and none is a UI framework); privacy by default (goal:
  no cookie banner); accessibility WCAG 2.1 AA; images are never cropped; only public web
  derivatives ever reach the browser on the public side.

## Decision

### 1. Roles and the two workflows (AC1)

Three roles, and the access model is designed around the distinction:

- **Photographer / administrator** — creates a gallery and links it to a customer and
  job (where those records exist), prepares the web derivatives, the watermarked proofs,
  and the delivery ZIP **locally, outside the application**, and uploads them with an
  owner-run CLI (§8c), publishes, revokes or replaces access, resends the
  notification, deletes, and (for a proof gallery) reopens a confirmed
  selection. Every one of these is behind the administrator boundary of §4.
- **Customer** — the paying client named on the job. Holds the gallery link.
- **Share recipients** — family the customer forwards the link to. **Same authority as
  the customer, by explicit requirement** — there is no separate identity, login, or
  confirmation code for them.

**Delivery-gallery flow.** Prepare web derivatives and one full-gallery ZIP → create the
gallery, link it to the customer/job → publish (only after derivatives and a verified ZIP
are durably present) → one notification email carries the access link → customer and
recipients view uncropped web-resolution images and download the one protected ZIP →
access expires automatically six months after publication.

**Proof-gallery flow.** Prepare baked-in-watermarked web derivatives and the pricing
(included count, extra-image unit price, currency) → publish (freezes a pricing snapshot
and assigns each proof a permanent `001`-based reference in ascending complete-filename
order, with a stable internal media identity as the tie-break) → customer and recipients
view proofs, select, see the selected / included / extra counts and the calculated extra
total, review an explicit summary, and confirm (no separate code) → confirmation stores
an immutable, versioned server-side snapshot and queues one photographer email → the
administrator may reopen for a new version, preserving the prior one → access expires
automatically six months after publication.

### 2. Isolation is structural, not projected (AC9; ADR-0002 `privateOnly`)

`privateOnly` is enforced by **construction**, not by a projection that could be
forgotten:

- **Private records live only in the private metadata store (§8b).** The public content
  store — Sanity or the mock layer — has no representation of a private gallery, its
  customer/job link, its placements, or a proof selection. It cannot, because the public
  read adapters have no code path to the private store.
- **Private image bytes live only in the private object store (§8a),** under opaque keys.
  No private byte is ever in a public bucket, on `cdn.sanity.io`, in `public/`, or passed
  to the `next/image` optimizer. Object keys never contain a customer name, a filename, a
  job number, or a sequential id.
- **The boundary is a module boundary.** The private-store and private-object adapters
  are guarded by `import "server-only"`, and an ESLint `no-restricted-imports` rule stops
  `src/app` and `src/components` importing them — the same mechanism ADR-0006 uses for
  Sanity.
- **A `privateOnly === true` media record fails every public projection closed.** The
  public gallery, dynamic-result, and enquiry adapters refuse it outright; there is no
  "try private, then fall back to public"; and a serialization test proves a `privateOnly`
  record cannot enter any public payload — the same kind of test ADR-0002 §6 and ADR-0005
  §5 already require for provider and archive fields.
- **Shared project identity is allowed; shared delivery is not.** The same photograph may
  carry a public `mediaId` and also be used privately, but the **provider object** and
  the **browser rendition** on each side are distinct. A private use never reuses a public
  derivative URL, and moving a public image to private use follows ADR-0005's
  source-revocation rule.
- **Only prepared derivatives enter the private path (AC6).** For a proof gallery, only
  the externally-prepared, baked-in-watermarked web derivative is uploaded to the private
  object store or referenced by a private route. An unwatermarked master and an
  `archiveLocator` value never enter the private object store, a private route, or any
  browser payload — the watermark is a deterrent, not the authorization boundary, which
  is §3 and §5.
- **Expiry removes access before it deletes bytes (§7).** A private object that a
  retention job has not deleted yet is still unreachable, because authorization has
  already failed closed.

### 3. Customer access: a fragment capability exchanged for a server-side session (AC2)

**Owner decision, 2026-08-31.**

**The shareable artifact** is a link of the form
`https://<site>/<private-prefix>/<gallery-handle>#<capability>`, where:

- `<gallery-handle>` is an opaque, non-enumerable random string with an entropy floor of
  **at least 128 bits from a CSPRNG**, base64url (not a slug, not a sequential id, not
  derived from the customer or job).
- `<capability>` is a single high-entropy secret — **256 bits from a CSPRNG**, base64url —
  and it is the **whole** credential. Anyone holding the link is authorized. No account,
  no password, no separate confirmation code (AC2; AB#29; AB#130).

**The capability travels in the URL fragment.** Browsers never send a fragment to a
server, so the capability does not appear in **this deployment's** request line, in its
edge / CDN / proxy access logs, or in `Referer` on the first hop — the exposure the
query-parameter transport could not avoid. What the fragment does **not** protect against
is a party that already holds the whole link: the recipient's mail provider and any email
security service scanning the message have the full URL, fragment included, and a
JavaScript-executing link scanner can run the bootstrap script and call the exchange
endpoint itself. This is a documented residual risk (threat table below), not a claim
that the capability is unreachable; the mitigations are the short session TTL, per-IP /
per-handle rate limiting on the exchange, revocation, and the fact that a scanner
obtaining a session gets one bound to its own cookie jar, not the customer's.

**The initial `GET` is non-sensitive.** It returns only a minimal bootstrap document — no
gallery metadata, no image references, no customer data — plus a small first-party
script served as an **external same-origin file**. It needs no CSP grant beyond the
existing `script-src 'self'` and does not add another inline-script use to ADR-0011's
accepted `'unsafe-inline'` residual. The script:

1. reads the fragment and immediately removes it with `history.replaceState`;
2. `POST`s the capability to a **same-origin exchange endpoint** in a bounded JSON body;
3. on failure shows a generic "this link is not valid" state and never reveals whether
   the handle exists.

**The exchange endpoint:**

- applies the same-origin / fetch-metadata checks already used by the contact and enquiry
  endpoints (`sec-fetch-site: same-origin`, reusing the `checkContactRequestHeaders`
  pattern) and rejects a cross-origin or non-`fetch` caller;
- rate-limits the exchange in two layers: a **per-IP best-effort in-process** limiter
  (fast, cheap, not the real defence) and a **per-gallery / per-handle persistent,
  time-windowed counter** in Postgres that actually bounds re-exchange across instances
  and deployments (the same reason §8e's access budget is persisted, not per-instance);
- looks the capability up, and on success creates a server-side session record in the
  private metadata store and sets a cookie carrying **only** the session identifier. The
  **session identifier is generated by a CSPRNG with an entropy floor of at least 128
  bits** (256 recommended) — "opaque" is not enough: a sequential or otherwise
  predictable identifier would let an attacker guess a live cookie and bypass the
  capability entirely. Unlike the capability, the session identifier never needs to be
  reconstructed, so the metadata store keeps only its **hash**; a lookup hashes the
  cookie value and matches;
- bounds the session table: expired session rows are reaped on the next scheduled
  retention-worker run (§7), not only when the gallery is deleted, and a **per-gallery
  active-session cap** (default 50, per capability generation) is enforced by **atomically
  deleting the oldest session and accepting the new one** when the cap is already reached —
  the newest device always works; an evicted holder simply re-exchanges the link they
  still have. So repeated cookie-less re-exchange over the six-month window can churn
  sessions but never grows the table past the cap.

**The session cookie** is `Secure`, `HttpOnly`, `SameSite=Lax`, `Path`-scoped to the
private prefix, with `Max-Age` capped at `min(sessionTTL, accessExpiresAt − now)`.
`sessionTTL` is **at most 7 days** (an ADR-fixed maximum a deployment may lower but not
raise); when it lapses the visitor re-opens the link, which they still hold, and the
bootstrap exchanges it again. The session is not silently renewed on activity — a bounded
absolute lifetime is what keeps a scanner's or a lost device's session from lasting until
`accessExpiresAt`. `Lax` (not `Strict`) so the cookie survives a customer returning to
the clean gallery URL from a bookmark or a forwarded link within that week; cross-site
write protection does not lean on `SameSite` — the exchange and every proof-selection
mutation run their own same-origin / fetch-metadata checks (§5). The capability itself is
**never** placed in a cookie. The session record is bound to the gallery id, the
capability **generation** (below), and `accessExpiresAt`.

After the exchange the browser is at the clean URL `.../<gallery-handle>` with no
fragment, and every later request authorizes on the session cookie.

**Amendment 2026-09-01 (AB#29 session slice):** the cookie `Path` is
`/<private-prefix>/<gallery-handle>`, not the bare private prefix. This is within — and
stricter than — "scoped to the private prefix", and it lets one browser hold concurrent
sessions for two galleries (a client with both an engagement and a wedding gallery)
instead of the second exchange silently overwriting the first. Every
cookie-authenticated endpoint — the exchange, the gallery page, the proof API, and
logout — therefore lives under `/<private-prefix>/<gallery-handle>/…`. The cookie
carries **no `Domain` attribute** (a `__Secure-` name plus an explicit host-only cookie);
a request that presents more than one cookie of the session name is refused rather than
resolved to the first.

**JavaScript is an accepted requirement** for customer-gallery access, documented in the
deployment's privacy notice and handoff docs. There is deliberately **no**
query-parameter fallback and **no** token-in-URL mode — see Options Considered. A
reusable six-month bearer capability must never reach infrastructure logs before
application code can redact it.

**Capability storage is recoverable, not hash-only** — because AB#29's "resend access
instructions" and the administrator "copy access link" action must reconstruct the exact
link — and the encryption contract is fixed here, not left to AB#29:

- **One fixed AEAD:** AES-256-GCM, with a fresh random **96-bit nonce** and a 128-bit
  authentication tag for every encryption; never a bare cipher or unauthenticated mode.
- **A versioned server-only keyring**, not a "printable string of some length".
  `PRIVATE_GALLERY_CAPABILITY_KEYS` maps opaque `keyId` values to base64-encoded 256-bit
  random keys, and `PRIVATE_GALLERY_CAPABILITY_ACTIVE_KEY_ID` selects the key used for
  new envelopes. Both are validated, resolved lazily as request-time Sensitive values,
  never `NEXT_PUBLIC_`, and independent per environment. (The
  cursor-signing precedent supplies only the *lazy-resolution and Sensitive-variable
  conventions*; a cursor is server-minted signed data, a gallery capability is a random
  bearer credential, so this ADR reuses neither `GALLERY_CURSOR_SIGNING_KEY` nor an HMAC
  token format.)
- **A versioned envelope** per stored capability:
  `{ version: 1, algorithm: "A256GCM", keyId, nonce, ciphertext, tag }`; binary fields
  use base64url. An unknown version or algorithm fails closed.
- **Canonical associated data:** the UTF-8 bytes of the fixed-order JSON tuple
  `["private-gallery-capability-v1", galleryId, handle, generation]`, after the normal
  field validation. This encoding is unambiguous even when a string contains a delimiter,
  and binds the ciphertext to its gallery, handle, and generation.
- **Decrypt fails closed** — a bad tag, an unknown `keyId`, or mismatched associated data
  is a refusal, never a fallback to plaintext or an empty capability.
- **Rotation** adds a new key to the keyring, changes the active `keyId`, and re-encrypts
  every stored capability under it, via an owner-run step or lazily on next read. Old
  keys remain resolvable until an authoritative store scan confirms that no envelope
  references their `keyId`; only then may they be removed.

A metadata-store dump without the key yields no working link. Lookup is by a separate
non-secret indexed handle, never by the capability value.

**Capability generation.** The gallery record carries a generation counter; the
capability envelope and every session record carry the generation they were created
under. A signed URL does **not** recheck that counter at the object store: its minting
request checks the current generation, after which the URL is bounded only by its signed
expiry. **Revocation** increments the generation, which invalidates the previous link and
every session derived from it at the next application check (O(1), no session
enumeration) and prevents every new signed-URL mint. An already-minted URL retains only
the explicitly accepted residual lifetime in §5. **Replace** additionally issues a fresh
link for a new notification; **revoke** leaves the gallery with no valid capability. A
bare revoke also deliberately disables administrator "copy access link" and "resend"
for that generation: the old envelope is not decrypted with historic associated data.
Those actions become available again only through **replace**, which creates the new
generation's capability.

**Expiry.** `accessExpiresAt` is an immutable absolute UTC instant on the gallery record,
computed once at publication by the six-calendar-month rule defined in §7 (add six to the
UTC month, clamp to the month's last day, preserve time-of-day). No operation changes it.
Every authorization step — the exchange, session validation, and every signed-URL mint —
refuses at or after it and caps its own output lifetime at it. A missing or unparseable
value fails closed.

**Threat evaluation (AC2).**

| Threat | Treatment |
| --- | --- |
| Keyspace enumeration | 256-bit CSPRNG capability; brute force is infeasible. This is the primary control. |
| Online guessing | Per-IP and per-handle rate limit on the exchange; a bad capability returns a generic failure with no "handle exists" signal. |
| Handle / object enumeration | Opaque handle, opaque object keys, no index route, no listing without a session, and any listing is scoped to the one gallery. |
| Expiry | Absolute UTC instant, checked everywhere, fail closed; sessions and signed URLs cannot outlive it. |
| Revocation / replacement | A generation increment invalidates the capability and application sessions and stops new URL minting immediately at the next application check. An object-store URL already minted remains usable only for its bounded signed TTL (§5). |
| Link forwarded to family | Accepted by design (AC2). |
| Referrer / history / *this deployment's* infra-log leakage of the capability | Fragment transport + `history.replaceState` + `Referrer-Policy: no-referrer` on the private prefix (§6). |
| Email provider / link-scanner processing the full link | **Residual, documented, not eliminated.** The recipient's mail systems and any email security service hold the full URL including the fragment, and a JavaScript-executing scanner can invoke the exchange. Mitigated by the short session TTL, exchange rate limiting, revocation, and a scanner's session being bound to its own cookie jar — a well-behaved scanner sandboxes and discards. A customer who suspects a link was intercepted asks the photographer to replace it (generation bump). |
| Session-cookie guessing | Session identifier is a CSPRNG value with a ≥128-bit floor; the store keeps only its hash. |
| Shared / lost device | Accepted; mitigated only by session TTL and expiry. |
| Search-engine discovery | Fragment carries no crawlable target; `noindex`, `robots` disallow, an auth wall, and no inbound links (§6). |
| Capability theft from the metadata store | Stored encrypted at rest under a separately-held key. |
| Signed-URL theft after minting | Bounded by the signed TTL (§5) — minutes for a preview, at most 6 hours for a ZIP — and capped at `accessExpiresAt`; a stolen URL cannot be renewed without a session, and each stays a single object. |
| Bulk egress via repeated re-exchange | Per-gallery aggregate download/mint ceilings (§8e), persisted in the metadata store, not per-session — clearing the cookie and re-exchanging does not reset them. |

### 4. Administration is a separate, stronger boundary

Create, prepare, publish, revoke, replace, delete, resend, and reopen are
**administrator** operations behind their own authentication boundary, **distinct from
and stronger than** a customer capability. A customer capability never authorizes any of
them, and the two paths share no credential and no session.

This ADR fixes that the boundary **exists**, is **route-aware and enforced in the
application** on every administrator route and every administrator mutation, and is
isolated from the customer path. It does **not** fix the administrator identity mechanism
(a single-operator credential checked server-side, an external IdP with a session, …) —
that is an implementation decision for AB#29 with its own review. It rules **out** Vercel
Deployment Protection as that mechanism: Deployment Protection is scoped to a project's
deployment URLs, not to a path prefix, so on the shared public production deployment it
would either gate the whole site or not gate `/admin` at all
(`https://vercel.com/docs/deployment-protection`, checked 2026-08-31). The control has to
live in the application, where a route can be distinguished.

### 5. Per-request authorization is two-stage, per asset class (AC3)

Every private request is authorized independently — the gallery page, each thumbnail,
each web preview, the ZIP, every proof-selection read and write, and any future private
asset. There is no "the page loaded, so its images are public" gap. Delivery of image
bytes is a **two-stage** contract, because a direct object-store `GET` does not carry the
application session:

**Stage 1 — the application** checks, on every private request: a valid, unexpired
session; the gallery is currently in the **`published`** state (not `draft`, `preparing`,
`ready`, `access-suspended`, `expiring`, `deleting`, `deleted`, or `deletion-failed` — a
gallery leaving `published` for any reason, expiry or an administrator revoke or delete,
refuses every customer request immediately); the session's generation matches the
gallery's current generation;
and the requested asset resolves **by a server-owned identifier** to a placement that
belongs to **this** gallery. The caller never supplies a raw object key or a cross-gallery
identifier; the resolver rejects anything it did not itself mint, so the signed-URL
endpoint cannot be used as an IDOR probe or a signing oracle.

An administrator **revoke** increments the capability generation and moves the gallery
`published → access-suspended`. Access is refused, but no object deletion begins. An
administrator **replace** increments the generation, issues a fresh link, and moves an
`access-suspended` gallery back to `published`. **Delete** stays on its own path: it
increments the generation and moves the gallery `published → expiring` before object
deletion begins. Each operation stops a live session from minting a new signed URL;
already-minted URLs remain valid only until their signed TTL (minutes for a preview, at
most 6 hours for a ZIP — §5 Stage 2), which is also capped at `accessExpiresAt` (below).
A revocation therefore has a bounded worst-case exposure of one ZIP TTL, which the
administrator accepts as the cost of not proxying 20 GB through a Function.

**Stage 2 — the object store** independently authorizes one `GET`. Stage 1 mints a
**single-object, `GET`-only signed URL**, `signedExpiry = min(configuredTTL,
accessExpiresAt − now)`:

- **A preview** uses `configuredTTL` in **single-digit minutes** and is delivered by an
  `<img>` element pointed at the URL.
- **The ZIP** — up to the §8e size ceiling — uses a **ZIP-specific `configuredTTL` sized
  to the download** (an ADR-fixed maximum of **6 hours**, still capped at
  `accessExpiresAt`), is authorized and minted **at click time** against the gallery's
  current `activeZipObjectKey` (§8c) each time the download control is used (never
  rendered eagerly into the page), and is delivered by a top-level signed download
  navigation (§6). The signed URL names one **immutable** object key, so the store must
  honour **`Range`** for a paused or dropped download to resume against exactly those
  bytes within the URL's lifetime, and a regeneration in the meantime cannot change what
  that URL returns (the predecessor object is retained past the longest TTL — §8c). A
  resume attempt after the URL expires, or after 6 hours on a slow link, falls back to the
  download control, which re-authorizes and re-mints against whatever key is active then.

Neither delivery is a script `fetch`, so neither depends on the store's CORS policy. No
private byte is proxied through a Vercel Function (ADR-0004 §6; a permitted processed
full-resolution JPEG or ZIP may exceed the 4.5 MB response cap, and the 20 GB ZIP ceiling
cannot be served through that boundary, so a proxy is not a general delivery path).

Private bytes therefore **do** reach the browser — of an authorized holder of a valid
gallery link or session (the model proves capability possession, not identity), over a
per-request signed URL. `AGENTS.md`'s "Public derivatives only" rule is amended in this
change with a scoped exception naming this ADR: the public optimizer and the public media
contract are untouched, and camera masters, `archiveLocator`, and provider internals
still never reach any browser (ADR-0002). What crosses is (a) a bounded web derivative —
a watermarked proof or a ≤ 2048 px delivery preview — and (b) for a delivery gallery, the
one protected full-gallery ZIP of the delivered full-resolution JPEGs, delivered whole
(§8c; no individual full-resolution downloads, AC5). Never a master.

**Thumbnails and previews** use the same direct short-lived signed `GET` — one mechanism
for every size, so even preview bytes stay off the Function path. They are uncropped web
derivatives at their native ratio (the `AGENTS.md` no-crop rule and ADR-0005's ceilings
apply to a private preview exactly as to a public one). A provider without presigned `GET`
would instead need an authorized streaming route within the 4.5 MB and duration caps;
that is a fallback, not the reference.

**Consequences this ADR states rather than hides:**

- Revocation cannot instantly kill an already-minted signed URL — there is a bounded
  window equal to the signed TTL.
- A URL minted just before `accessExpiresAt` is still capped at it.
- A preview URL rendered eagerly can expire before a lazily-loaded image requests it, so
  the client **must** treat a `403`/expired response as "re-request a fresh URL from
  Stage 1" — a documented retry contract, not an error state.
- A copied signed URL works until its deadline and no further.

**Proof-selection writes** are `POST`/`PUT` only, same-origin / fetch-metadata checked
(not `SameSite` alone), bounded body, and use **optimistic concurrency**: each mutation
carries the version it read, and a stale version is rejected. Concurrent share recipients
therefore cannot silently overwrite one another, and a confirmation cannot race a stale
draft (AB#130's versioned-snapshot requirement).

### 6. Response and delivery hygiene (AC4)

- **`Cache-Control: no-store`** on every private response — the bootstrap, the exchange,
  the gallery page, the proof API, and any authorized byte route. Private routes render
  dynamically; nothing private enters the Next.js Data Cache, the AB#83 tagged cache, or
  any shared/CDN cache (ADR-0004 already excludes "draft, private, authorization, and
  signed-download responses").
- **`X-Robots-Tag: noindex, nofollow`** on every private response, plus
  `<meta name="robots" content="noindex,nofollow">` on the page.
- **`Referrer-Policy: no-referrer`** on the private prefix — stricter than ADR-0011's
  site-wide `strict-origin-when-cross-origin` — so neither a signed storage URL nor the
  clean gallery URL leaks through `Referer` to the storage host or anywhere else.
- **`robots.txt`** (`buildRobotsPolicy`) adds `Disallow: /<private-prefix>/` as defence
  in depth — crawl guidance only, never access control (ADR-0011's posture).
- **`/sitemap.xml`** (`buildSitemapPaths`) never reaches the private namespace: its
  inputs are the public content tree, services, and static routes only. This is an
  invariant to preserve and to test, not a change here.
- **Delivery mechanism avoids CORS by construction.** A preview loads as a plain
  `<img src="<signed URL>">` and the ZIP is fetched by a **top-level signed download
  navigation** (`<a href>` / `window.location`, `Content-Disposition: attachment`).
  Neither is a cross-origin `fetch`/XHR, so neither is subject to the object store's CORS
  policy, and the client never needs to read the response body in script. The ADR
  deliberately defines **no** client-side `fetch` of a private object. If a future
  enhancement adds one (a progress bar, a client-side `HEAD` preflight), that change must
  also configure an **exact-origin** CORS policy on the bucket (`Access-Control-Allow-
  Origin` set to the site origin, `Range` in `Access-Control-Allow-Headers`, the needed
  headers in `Access-Control-Expose-Headers`) — it does not come for free with the CSP
  grant.
- **Object-store response headers.** Application `no-store` does not control what the
  object store returns, so the store is configured (per-object metadata) to return
  `Cache-Control: no-store` on every private object — **not** `private, max-age=…`, which
  would let a browser keep private image or ZIP bytes on disk past a revocation and
  contradict this section's and §7's "nothing private is cached" guarantee. It also
  returns the correct `Content-Type`, `Content-Disposition: attachment` for the ZIP, and
  honours `Range` requests for the ZIP.
- **CSP.** The private routes need the private object-store origin added **narrowly** to
  `img-src` only (previews and thumbnails load as `<img>`), scoped to the exact host and
  applied on the private routes only. No `connect-src` grant is needed, because the ADR
  defines no client-side `fetch` of a private object (see the delivery-mechanism bullet
  above). Named as an implementation action item against ADR-0011, not applied here.
- **Application logs stay the closed shape.** ADR-0004 §5 and `src/lib/contact-log.ts`
  fix operational events to a random correlation identifier, a state, and a redacted
  error class — **nothing else**. Private-gallery operational events keep exactly that
  shape: no gallery reference, no customer reference, no filename, no capability, no
  signed URL, no selection content. Everything an administrator needs to see — which
  gallery, delivery status, failure detail — lives in **durable, admin-visible status
  records in the private metadata store**, not in operational logs. This ADR does not
  amend ADR-0004 §5.
- **Provider request logging.** Signed-URL query strings may still appear in a provider's
  own infrastructure request logging outside the S3 API surface. UpCloud exposes no
  configurable S3 bucket access logging at all (Evidence), removing one such surface; the
  reference posture is (a) prefer a store with no configurable access log or a short
  retention, (b) keep signed TTLs short so a logged URL is already stale, and (c) never
  emit the token from the application. This restates ADR-0004 §6's accepted residual
  rather than removing it.

### 7. Retention and the six-month lifecycle (AC7)

**A metadata-driven retention worker is authoritative. Provider lifecycle rules are only
a backstop.** A bucket lifecycle rule keys on object age, a fixed date, a prefix, or a
tag — never on a gallery's publication-derived `accessExpiresAt` — and upload can precede
publication. An age rule therefore cannot implement the exact access clock; the metadata
store must. The preparation, deletion-grace, and lifecycle-policy limits below are
ADR-fixed maximums: a deployment may lower them, but must not raise them.

- **Calendar semantics.** `accessExpiresAt` is computed once, when the gallery first
  enters `published`, and is then immutable. It is the publication instant with **six
  added to the UTC month**; if the target month has no matching day the date is **clamped
  to that month's last day**, and the time-of-day is preserved. Worked examples:
  `2026-08-31T12:00:00Z → 2027-02-28T12:00:00Z` (Feb has no 31st, clamped);
  `2026-08-15T09:00:00Z → 2027-02-15T09:00:00Z`; `2026-12-31T00:00:00Z → 2027-06-30T00:00:00Z`.
  A proof-gallery **reopen does not shift** `accessExpiresAt`; the selection window stays
  inside the original access window. The server value is authoritative; no client clock is
  trusted.
- **Gallery state machine.** `draft → preparing → ready → published`. A gallery in
  `draft` holds **no objects**. Before any object write, the authenticated administrator
  opens an upload preparation in one Postgres transaction: the server records the bounded
  manifest and server-assigned opaque object keys, then moves `draft → preparing`. Only
  after that commit does the owner CLI receive the upload plan and write objects, so an
  object-store operation is never described as atomic with a database transition and the
  worker always has an enclosing preparation to reconcile. Standalone revoke and
  replace use `published → access-suspended → published`. **An administrator delete is
  valid from every object-bearing state** — `preparing`, `ready`, `published`, and
  `access-suspended` — and moves the gallery to `expiring → deleting → deleted`. The same
  states also reach `expiring` automatically: `preparing`/`ready` when the 30-day
  preparation maximum passes, `access-suspended` when it is not replaced within its bounded
  window (default 30 days), and `published` at `accessExpiresAt`. `deletion-failed`
  transitions back to `deleting` on the next
  scheduled worker run (retry), and only a human acknowledgement after repeated failure
  parks it for manual intervention. All transitions are explicit and recorded in the
  status records.
- **Bounded maximum lifetime.** Every window a legitimate object passes through is
  bounded: preparation (first upload → publication) at most **30 days** (publication after
  that deadline is refused and the objects enter cleanup); access exactly **six calendar
  months**; a revoked-and-not-replaced `access-suspended` gallery at most a further **30
  days** before cleanup; then at most the **30-day deletion grace** below. A legitimate
  object therefore lives for at most `30 + six calendar months + 30 + 30` days.
- **Access ends first.** At `accessExpiresAt` the worker moves `published → expiring`;
  from that instant every authorization check refuses regardless of object state.
- **Then objects are deleted.** A **scheduled** cron or platform-scheduled run of the
  worker is required **at least once every 24 hours**. It is a `scripts/*.mts` job on the
  pinned Node major, with its decision logic in a pure module beside the IO (the
  `AGENTS.md` deployment-tooling convention; **named as an action item, not built here**).
  Owner-run invocation of the same script is for repair or backfill only, never the
  normal retention mechanism. Every scheduled run reaps expired session rows in bounded,
  expiry-indexed batches, independently of whether their gallery has entered deletion.
  For a gallery cleanup the worker enumerates the gallery's objects from the store's
  manifest, deletes them
  **idempotently**, verifies deletion, retries partial failure, and only then moves
  `deleting → deleted`. Verified deletion must complete no later than **30 days after the
  cleanup trigger** — the *earlier* of `accessExpiresAt`, an administrator delete request,
  or the abandonment deadline for a `preparing` / `ready` / `access-suspended` gallery —
  so an early delete is not silently given the full original access window to finish. It
  also aborts incomplete multipart uploads and removes noncurrent versions, every
  superseded ZIP object past its retention margin, and any delete markers.
- **Deletion guard.** Once a gallery has entered `deleting`, it cannot return to
  `published`. Making a gallery available again after deletion is a brand-new publication
  with re-uploaded objects and a fresh immutable six-month clock, never a revival of the
  deleted gallery.
- **Backstop lifecycle rule.** A coarse **age-based** expiration rule on the private
  bucket prefix catches objects the worker missed — a crashed job, an orphaned upload. Its
  threshold is fixed at **275 days after object creation**: the 30-day preparation maximum
  + the longest six-calendar-month span (184 days) + the 30-day `access-suspended` window
  + the 30-day deletion grace, rounded up with one day of headroom. At that age a gallery
  is past every legitimate deadline, so the rule can only hit a genuine orphan. The same
  policy expires noncurrent versions within **30 days** and aborts incomplete multipart
  uploads after **7 days**. A deployment may lower these ages, but may not raise them;
  lowering the 275-day object threshold also requires lower preparation, suspension, or
  grace limits so the rule remains beyond every legitimate object lifetime. The rule is
  **not** the gallery clock. Both UpCloud and R2 support prefix + age/date expiration and
  multipart-abort rules (Evidence).
- **Drift monitoring.** The worker's final step asserts the backstop lifecycle policy is
  present and enabled and reports if it is not — a silently disabled policy is a finding
  (the same post-check pattern the shuffled-order recompute script already uses).
- **ZIP retention.** The **active** ZIP object of a delivery gallery (the one
  `activeZipObjectKey` points at — §8c) is retained for the whole access window and
  deleted with the rest of the gallery's objects when the worker runs. A **superseded**
  ZIP object (a prior immutable version after a regeneration) is retained for at least
  `maxZipSignedTTL (6 h) + clock margin` past the pointer swap so no in-flight download or
  `Range` resume breaks, then the worker's superseded-object sweep removes it. A proof
  gallery has no ZIP.
- **Caches.** Nothing private is cached, so there is nothing to purge; the worker's
  checklist still asserts the no-store posture held.
- **Backups.** The private **object store** must not carry backup or version history that
  outlives `accessExpiresAt + 30 days`; if versioning is on for accident recovery, its
  noncurrent-version expiration must be ≤ the 30-day deletion grace. The private **metadata
  store's** point-in-time recovery / snapshot window is **bounded** — the ADR fixes a
  ceiling of **30 days** (AB#29 may set it lower), never longer, and PITR is never a
  substitute for the retention worker. **A restore from any metadata backup runs the
  retention worker before traffic resumes**, so a gallery that expired since the backup
  does not come back accessible; the restore runbook states this as a gate, not a
  suggestion.
- **Database-side retention (decided, not deferred).** Row lifetimes are set here; the
  customer/job schema itself is AB#28's, but its retention is not open-ended:
  - **Capability and session records** are deleted when the gallery reaches `deleted` —
    a recoverable credential must not outlive the media it unlocked.
  - **Notification-delivery records** are deleted with the gallery.
  - **Proof confirmation snapshots** are the one deliberate exception: they are a durable
    record the photographer may need after the gallery is gone (AB#130: "the email is not
    the sole record of the selection"), so they are retained for a bounded, documented
    period past media deletion — a default of **24 months**, which the deployment owner
    may adjust against invoicing and legal need, not indefinitely.
  - **Customer/job rows** follow AB#28's own record-retention decision; this ADR requires
    that decision to name a maximum, not leave it unbounded.
- **Offline archive.** Explicitly outside the website lifecycle. The website never reads,
  writes, indexes, or is the system of record for the photographer's offline archive;
  `archiveLocator` stays server-only and is never a delivery input (ADR-0002).

### 8. Storage, metadata store, ZIP, resource limits, and cost (AC8, AC9)

#### 8a. Object storage — S3-compatible, customer-owned, separate

Private image objects and the ZIP live in an **S3-API-compatible object store in an
account the site owner controls**, separate from Sanity and from any public delivery
bucket, reached only through a server-only adapter (an S3 request-signing helper is a
small, justified dependency; a full cloud-vendor SDK is not required and is avoided,
matching ADR-0006's "no SDK unless justified").

- **Reference choice: UpCloud Managed Object Storage.** An EU/Finnish company; regions
  include Helsinki (`FI-HEL2`) and Frankfurt (`DE-FRA1`); S3-standard compatible — bucket
  lifecycle policies, presigned URLs (≤ 7 days), IAM policies, bucket and object ACLs,
  bucket policies, and versioning; 250 GB from EUR 5/month with zero-cost egress under a
  Fair Transfer Policy; **no** configurable S3 bucket access logging, which is an
  advantage for signed-URL tokens here. Checked 2026-08-31 (Evidence).
- **Documented alternative: Cloudflare R2.** S3 API; presigned URLs for GET/HEAD/PUT/
  DELETE with expiry from 1 second to 7 days; lifecycle rules by age, date, or prefix
  plus incomplete-multipart abort and storage-class transitions; USD 0.015/GB-month
  standard storage, Class A USD 4.50/million, Class B USD 0.36/million, **egress free**,
  10 GB-month free tier; an EU jurisdiction restriction is a configurable bucket setting.
  Trade-off: a US company — a data-residency consideration the owner weighs per
  deployment. This is the "non-European-company comparison candidate" the 2026-08-11
  comment named.
- **Permitted only after a capability check: Infomaniak and other European offerings** —
  each must be verified for private-object authorization, presigned expiry, lifecycle
  expiration, S3 API breadth, and recovery before use (2026-08-11 comment).
- **Rejected:**
  - *Ordinary web-hosting disk space* — no per-object authorization, no presigned expiry,
    no lifecycle deletion (the 2026-08-11 comment's explicit exclusion).
  - *Vercel Blob* — couples private delivery to the app host, against ADR-0004's
    storage-independence finding, and the private/public split wants a separate account
    entirely.
  - *A public or Sanity-hosted asset* — a permanent public `cdn.sanity.io` URL is exactly
    what the 2026-08-14 comment excludes, and it breaks ADR-0005's
    public-derivative-only rule.

**The bucket is default-deny; naming "private" is not the control.** The provisioning
gate fixes and verifies:

- **No public-read ACL** on the bucket or on any object, ever. Writers cannot set a
  public ACL. Provisioning uses the provider's verified private default and bucket-policy
  controls; correctness does not depend on every upload setting an ACL header that its
  credential is not permitted to modify.
- **A provider-verified bucket policy or equivalent that rejects anonymous / unsigned
  access** for every operation while still accepting the intended presigned `GET`, so a
  request without valid authorization is refused whatever an object ACL happens to say.
  UpCloud has **no S3 `PublicAccessBlock` API** (verified 2026-08-31 against its
  S3-compatibility table); the equivalent is this explicit deny policy plus the no-public-
  ACL rule, and AB#29 verifies the combined effect live rather than assuming a
  block-public toggle exists.
- **Three least-privilege credentials, not one:**
  - the **runtime request-path / verifier** credential signs `GET` URLs and may issue a
    metadata-only `HEAD` for an exact server-assigned key during upload verification —
    object-read permission on exactly the private key prefix, no `ListBucket`, no writes,
    no other bucket;
  - the **retention-worker** credential (scheduled — §7) adds prefix-scoped enumeration
    and deletion of objects, versions, and incomplete multipart uploads, and nothing more;
  - the **owner-run CLI** credential writes (`PutObject` and the create/upload/complete/
    abort operations needed for multipart) on the private prefix and lives only on the
    photographer's machine (Action Item 7); it has no object read, delete, bucket listing,
    ACL, or policy permission.
  None can write a bucket policy or ACL, delete the bucket, or reach another bucket.
- **AB#29's provisioning gate runs live checks** before the deployment is accepted:
  an unsigned `GET` and an unsigned `LIST` both fail; a signed `GET` succeeds; `Range`
  works against a 20 GB ZIP object; and the object responses carry `Cache-Control:
  no-store` and, for the ZIP, `Content-Disposition: attachment`.

#### 8b. Private metadata store — a PostgreSQL-family engine, vendor deferred

**Owner decision, 2026-08-31: fix the engine family, defer the vendor.**

A **dedicated private relational store in the PostgreSQL family**, in an account the site
owner controls, reached only through a server-only project adapter, with an ESLint import
boundary keeping `src/app` and `src/components` out of it (the ADR-0006 pattern).

The ADR commits to the **engine family and these required invariants**, because they are
what rule the alternatives in or out:

- **Multi-statement transactions with rollback** — a publish, or a proof confirmation,
  touches several rows and must commit as one unit or not at all.
- **Enforced uniqueness at write time** — a database-level `UNIQUE` constraint that
  rejects a colliding write atomically: one permanent `001`-based reference per proof
  (AB#130), exactly one active logical ZIP row per delivery gallery. Not a
  query-then-write check that races under concurrent share recipients.
- **Optimistic-concurrency updates** — a conditional update keyed on the row version, for
  draft locking and a confirmation that must not race a stale draft (§5).
- **Referential integrity inside the ADR-0014-owned graph** — gallery → placement →
  selection, plus the gallery's capability, sessions, upload preparations, ZIP versions,
  and outbox records, use foreign keys so an orphaned selection or placement is
  unrepresentable. Customer/job identifiers are optional external references behind an
  adapter until AB#28 chooses its own store; this ADR promises no cross-store foreign key.
  If AB#28 later adopts this same Postgres boundary, that decision may add the wider
  customer → job → gallery constraints.
- **Indexed lookups on the hot path** — session validation runs on *every* private
  request, and a large proof selection is paged with a keyset query; both want real
  secondary indexes.
- **An outbox table** for idempotent notification and worker delivery (§8d).
- **Explicit retention-state columns** — the §7 state machine.
- **Restore-safe expiry** — a backup restore re-runs the retention worker (§7).

The **concrete EU provider is a reversible provisioning decision for AB#29.** Before
implementation, that story verifies, for the chosen provider: current data residency (an
EU region); encryption at rest and in transit; automated backup, point-in-time recovery,
and a **tested** restore; unambiguous customer ownership and export; connection pooling
suitable for serverless execution (a pooler or an HTTP driver); a schema-migration path;
and current cost. Candidate shapes named without binding one: an EU-region managed
Postgres from the Vercel Marketplace; a managed Postgres in the owner's existing
infrastructure provider.

**A private Sanity dataset is compared and rejected**, not left open, and on the correct
grounds. Sanity's Content Lake **does** support multi-document transactions and
`ifRevisionID` optimistic concurrency, and this repository already uses both
(`scripts/sanity-seed-http.mts` batches each write set as a transaction;
`scripts/recompute-shuffled-order.mts` sends `ifRevisionID`-guarded patches and treats a
`409` as a conflict) — so those are **not** the gap. A second, token-gated dataset would
also reuse the server-only HTTP adapter pattern (there is no Sanity client SDK dependency
to carry — ADR-0006 §2). It is rejected because the Content Lake is a **document store
for published editorial content**, and this store is neither:

- **No enforced-at-write uniqueness.** Sanity has no `UNIQUE` constraint; the project's
  own `mediaId` / `categoryId` uniqueness is enforced by a `raw`-perspective
  query-then-publish check in Studio validation, which is acceptable for low-frequency
  authoring but races under concurrent share recipients assigning proof references or
  minting a ZIP row.
- **No referential integrity.** The customer / job / gallery / placement / selection
  graph has foreign-key constraints a document store does not provide, so an orphaned or
  dangling reference is only caught by application code.
- **Wrong workload and retention shape.** A content lake is provisioned, priced, and
  cached for published-content reads over a CDN. Per-request session validation, PII-
  bearing customer rows, and short-lived capability records are a transactional
  workload with its own retention regime — and the 2026-08-14 owner comment's whole point
  is to keep private data **out of** the Sanity boundary, not to add a second dataset
  inside it.

Emulating enforced uniqueness and referential integrity on top of Sanity is more custom
code and more failure modes than adopting a relational store once. A later
customer/job/contract/invoicing module (AB#28) *could* reuse this store, but AB#28 has
made no such decision and this ADR does not make it for it — the possibility is noted, not
relied on.

**KV / Redis is rejected** — Redis has `MULTI`/`EXEC`/`WATCH`, so "no transactions" is
not the reason. It is rejected because it is not a system of record for relational data:
no schema, no foreign keys, no `UNIQUE`, and a durability and query model built for a
cache, not for the private gallery/placement/selection graph or immutable versioned
snapshots.

#### 8c. Preparation, upload, and ZIP versioning

**The photographer prepares everything locally.** Web derivatives, watermarked proofs,
and — for a delivery gallery — the ZIP of the delivered full-resolution processed JPEGs
are all produced on the photographer's own machine, which is where the full-resolution
masters already live (§1). The ZIP is assembled from that same local set, so
**full-resolution files never enter online storage loose and never need temporary online
storage** — the local machine is the assembly workspace. A cloud "background job" is
therefore *not* how the ZIP is built; it could not be, without the source files it must
not hold.

**Upload is owner-run, not browser-driven.** An owner-run CLI (`scripts/*.mts` on the
pinned Node major, decision logic in a pure module beside the IO) pushes the prepared
objects to the private store using a server-side storage credential **on the
photographer's machine**. The browser **never writes** to the private object store — only
the read path (signed `GET`, §5) is browser-facing. This is why §6's CSP grant is
`img-src` only with no `connect-src`, and why the app needs no bucket CORS policy: there
is no browser-origin `fetch`/`PUT` to the store at all.

**The server coordinates upload without sharing a transaction with S3.** Through the
separate administrator-authentication boundary (§4), the app first commits the bounded
preparation manifest and assigned opaque keys described in §7. The CLI uploads only that
plan, then calls an authenticated completion operation with the preparation id and upload
receipts — it never connects to Postgres or changes gallery state itself. The server uses
metadata-only reads of those exact keys to verify presence, expected size, and the
provider-supported checksum semantics selected by AB#29 (a multipart ETag is not assumed
to be a content hash). If verification fails, the gallery remains `preparing`, reports the
bounded failure in its administrator-visible status, and the CLI may retry; the retention
worker eventually removes an abandoned preparation and its objects. If verification
succeeds, one Postgres transaction records the verified object versions, moves the
gallery toward `ready`, and — for a regenerated delivery ZIP — swaps
`activeZipObjectKey`. This is the only atomic step; the preceding S3 writes are reconciled,
not transactionally coupled.
*(A future admin-UI upload — a bounded signed multipart `PUT` from the browser — is a
documented later option, not the reference. It would additionally require: an exact-origin
CORS policy on the bucket, a `connect-src` grant scoped to the admin routes only, per-part
and total-size limits, per-part checksums, explicit abort/complete handling, and the app
handing back only opaque per-part upload URLs, never a raw object key. AB#29 does not
build it unless it is asked for.)*

**ZIP versioning uses immutable keys and an atomic pointer, not a mutable canonical key.**
Each (re)generation writes the ZIP under a **new opaque, immutable object key** and, after
the server's **checksum / manifest verification**, the server swaps a single
`activeZipObjectKey` pointer **atomically in one Postgres transaction**. A previous ZIP
object is retained for at least
`maxZipSignedTTL (6 hours) + a clock-skew margin` after it stops being the active version,
then the retention worker sweeps it. So a signed URL always addresses the exact immutable
bytes it was minted for — an in-progress download or a `Range` resume within the URL's
lifetime never sees a different ZIP and never breaks — while a URL minted *after* a
regeneration addresses the new key. There is exactly one *active* logical ZIP per gallery
at any instant; there may briefly be one retained predecessor.

**Readiness is per gallery kind.** A **delivery** gallery does not reach
`ready`/`published`, and its first notification is not queued, until its web derivatives
**and** a verified active immutable ZIP object are durably present. A **proof** gallery has no ZIP; it
reaches `ready` when its watermarked derivatives are uploaded, its pricing snapshot is
frozen, and every proof has its permanent `001`-based reference assigned (§1). Neither
kind is accessible before `published`.

**Loose full-resolution JPEGs are not stored online.** The delivery gallery serves only
web-resolution previews plus the one ZIP (AC5 — no individual full-resolution downloads).
The full-resolution set exists online only inside the ZIP object. The photographer's
offline archive remains the source for any future per-image sale (AB#95); a later sales
feature must not silently turn this six-month client bucket into a long-term sales
archive.

**Rejected:** on-demand ZIP generation inside a Vercel Function — a permitted ZIP may
exceed the 4.5 MB response cap, the 20 GB ceiling is far outside it, and generation cannot
be guaranteed within the Function's bounded duration and memory (ADR-0004 §6, confirmed
2026-08-31); on-demand streaming assembly from an external worker is noted as the fallback
**only** if pre-generated ZIP storage cost is later shown to be material.

#### 8d. Durable publication and notification — a state machine plus an outbox

Publication is the durable state machine of §7 (`draft → preparing → ready → published`),
**not** an in-request "transaction" spanning object storage, Postgres, ZIP generation,
and email — those four cannot share one.

- A **unique publication-notification record** per gallery: the first notification is
  queued exactly once, when the gallery reaches `published` (readiness per §8c — a
  verified ZIP for a delivery gallery, frozen derivatives + pricing + references for a
  proof gallery). A retried publish does not create a second initial notification (the
  uniqueness constraint plus the outbox make it idempotent).
- **Resend the notification** (AB#29, AB#130) is a separately recorded delivery attempt
  against the same recipient; it creates no new gallery publication and no new
  proof-selection version. Delivery status and failures are readable by the administrator
  from the status records, not from logs.
- **The delivery-gallery notification is addressed to the customer** (AB#29), and the
  **proof-confirmation notification to the photographer** (AB#130). Neither can reuse the
  `ContactDeliveryRequest` contract, which carries no recipient and whose adapter factory
  binds every send to the single configured `CONTACT_DELIVERY_TO` owner mailbox
  (`src/lib/contact-delivery.ts`). Instead, a **gallery-notification transport** with a
  **validated per-message recipient** sits on top of the same Resend HTTP **provider**
  adapter; a production build refuses a sink provider the same way the contact path does.
  The queue, persistence, retry, status, and deduplication are the outbox's job, in the
  private metadata store — the provider adapter is transport only.

#### 8e. Resource limits — default ceilings decided here

Each of these is **bounded and fail-closed**. The ADR sets a **default ceiling** so AB#29
and AB#130 inherit an enforceable, feasibility-checked boundary rather than an open
question; a deployment may tune a value in its private configuration, but never to
"unbounded". The defaults are sized from the real workload — a wedding or event gallery
is a few hundred frames; a web derivative is ~0.2–2 MB; a processed full-resolution JPEG
is ~5–15 MB.

| Dimension | Default ceiling | Reasoning |
| --- | --- | --- |
| Files per gallery | **1 000** | Comfortably above a large wedding + engagement set; keeps a single gallery's total bytes and ZIP bounded. |
| Page / window size (items per rendered page, per manifest read, per signed-URL batch) | **100** | A separate, smaller bound than the per-gallery total: the grid paginates, the lightbox preloads a bounded window, a manifest read returns one page, and a single request mints at most this many signed URLs. The public gallery's own `MAX_…_PAGE_SIZE` pattern, applied to the private read. |
| Per-derivative longest edge and bytes (both preview kinds) | **longest edge ≤ 2 048 px and ≤ 8 MB**, for a delivery preview and a watermarked proof alike | `2 048 px` is `MAX_PUBLIC_DELIVERY_DIMENSION` (`src/lib/image-delivery.ts`) — the actual web-delivery export policy, not the `8 192 px` contract maximum. An explicit pixel bound is what stops a highly-compressed near-full-resolution proof from turning the protected gallery into an individual high-resolution delivery path. |
| Total gallery bytes (derivatives + ZIP) | **25 GB** | 1 000 frames × ~15 MB full-res inside the ZIP + previews, with headroom. |
| ZIP bytes | **20 GB** | The full-resolution set for the file-count ceiling. |
| Concurrent object writes / multipart parts during the owner-run CLI upload (per gallery) | **8** | Bounded fan-out for the prepare-and-upload step. ZIP *generation* is local on the photographer's machine (§8c), so it has no deployment-side concurrency limit. |
| Proof-selection request body | **64 KB** | A selection is a list of references, not content. |
| Selected-image count (proof) | **= files-per-gallery ceiling** | A customer cannot select more than exists. |
| Signed-URL mint rate | **60 / minute per session** | Covers a fast gallery scroll; not a bulk-scrape rate. |
| **Aggregate authorized-access budget per gallery** | **10 × the gallery's total bytes per fixed 30-day window** (see the 2026-09-02 amendment), charged at the authorized object's full nominal byte size for every signed-URL mint across **all** sessions of the gallery's current capability generation, persisted in Postgres | A ZIP mint costs the whole ZIP size; a preview mint costs that derivative's size. Clearing the cookie and re-exchanging for a fresh session does **not** reset the budget, because it is keyed on the gallery + generation, not the session. A generation bump resets it, which is intended: a replaced link is a fresh grant. |

**Amendment 2026-09-02 (AB#29 signed-URL slice):** the access-budget window is
**fixed, not rolling**. The original table said "rolling 30 days", which this record's own
design cannot express: it persists **one counter row** per gallery and capability
generation, and a rolling window needs the timestamp and size of every mint — for a
1 000-file gallery that is a thousand rows per full browse, pruned forever, summed on
every image load. One row cannot answer "what was spent in the last 30 days"; it can only
answer "what has been spent since this window opened".

The implemented semantics are therefore a fixed window that opens on the first charge and
resets when it lapses, with the standard consequence that **up to twice the allowance can
be spent across a boundary** — the ceiling late in one window, the ceiling again early in
the next. For a 5 GB gallery (52 GB budget, ~10 ZIP mints) that is ~20 mints inside about
48 hours rather than 10 in 30 days.

That is accepted rather than worked around, on this reasoning: the budget already counts
**authorizations, not delivered bytes** — a URL replayed inside its TTL costs nothing and
`Range` requests are invisible, as this section says itself — so precision was never
available in the dimension that matters. Doubling a ceiling already set at ten times the
gallery's own size still refuses a scrape, reaching it needs deliberate timing at the
boundary by someone who already holds a valid link and session, and the per-session mint
rate, the short signed TTLs, and generation revocation all bind first. A bounded sliding
approximation (two counters, worst case ~1.1×) was considered and rejected: it buys
precision in an already-approximate control at the cost of complicating the one atomic
statement that runs on **every image load**. If Fair Transfer pressure ever makes the
burst shape matter, that two-counter form is the documented upgrade path and needs one
extra column, not a schema change.

A request that would exceed a bound is refused, never queued unboundedly. The per-session
mint rate and the per-gallery authorized-access budget are **both** enforced; the budget
is the load-bearing application-visible control, because it and the exchange's per-gallery
re-exchange counter are the parts persisted in Postgres — the exchange's per-IP layer is
best-effort in-process only (§3). This budgets authorized access, not measured egress. A
replay of an already-minted URL within its TTL is not separately counted and cannot be;
the signed TTL (minutes for a preview, at most 6 hours for a ZIP) plus
capability-generation revocation bounds a leaked URL. Measuring actual bytes, including
`Range` requests and replays, would require a
delivery or telemetry mechanism that the reference UpCloud Managed Object Storage does
not provide: the browser sends the signed `GET` directly to the store, and the store
exposes no S3 bucket access logging.

#### 8f. Operational cost — a dated snapshot

Figures checked 2026-08-31; snapshots, not contractual quotes (ADR-0004's convention).

| Line | Reference (UpCloud) | Alternative (R2) |
| --- | --- | --- |
| Object storage, assumed 50–150 GB working set (legacy `public_html` ~36.5 GB, six-month rotation) | EUR 5/month covers 250 GB; egress included under Fair Transfer | ~USD 0.015/GB-month; egress free; per-operation Class A/B charges |
| Private Postgres (the dominant new recurring cost) | **Order of magnitude: ~EUR 0–30/month, driven by the plan floor, not usage.** The dataset is tiny — thousands of rows, no media bytes — so cost is whichever managed-Postgres tier carries automated backup and a PITR window within the § 7 ≤ 30-day ceiling. That is a free/hobby tier on several EU-region managed offerings, or a small paid tier in the low tens of euros where PITR needs a paid plan. This range is an estimate for comparison, not a quote: AB#29 does the live per-provider check (current price, EU region, PITR/restore, ownership) and pins one. The boundary — engine family, isolation, invariants — does not depend on which. | same |
| Email | The **same Resend provider boundary** the contact flow already defines — that account is itself not yet provisioned or verified (`docs/contact-data-flow.md`, AB#117), so this ADR adds per-message publication and confirmation sends but no new provider relationship beyond the one AB#117 owns | same |
| Function compute | **New but bounded — no byte transfer.** The bootstrap `GET`, the exchange `POST`, each dynamically-rendered private page, per-request session validation, proof-selection mutations, and signed-URL minting are all Function invocations with active-CPU time. No private image or ZIP byte passes through a Function (§5), so there is no transfer or large-response cost. The workload is bounded by private-gallery visitor volume — a handful of clients per active gallery, not public traffic. AB#29 records a bounded estimate or a measurement once the routes exist. | same |

Total added recurring cost is roughly **EUR 5–35/month** (object storage EUR ~5, Postgres
EUR ~0–30, email and Function compute negligible), all customer-owned. Even the top of
that range is small against a photography business's other costs, so cost does not
distinguish the storage or metadata-store options — capability, EU residency, and
ownership do.

### 9. Deployment topology (AC9)

- Private-gallery **routes** live in the **same Next.js application and deployment** as
  the public site (2026-08-14 comment), under a dedicated path prefix, always dynamically
  rendered, never statically generated, never cached.
- **The private prefix is a reserved root segment.** It goes through the same
  root-namespace validation `src/lib/locale-routes.ts` already applies (`reservedRootSegments`),
  so a clone cannot configure it to collide with a locale prefix, the redundant
  default-locale prefix, a story namespace, a public asset directory, or an existing
  static route — any of which would let the public locale catch-all shadow or intercept a
  private route. A collision fails the deployment, the same way a colliding locale prefix
  already does.
- Private **storage and metadata** are a **separate service boundary** in the owner's own
  account(s) — separate from Sanity, separate from any public bucket, separate
  credentials.
- Both are reached only through server-only adapters (`import "server-only"`) with an
  ESLint import boundary for `src/app` and `src/components` (ADR-0006 pattern).
  `src/proxy.ts` (ADR-0007) owns the private-prefix response-header rules of §6.
- **No SaaS, no multi-tenancy, no shared customer database.** Each clone provisions its
  own object store and its own Postgres, in its own accounts; there is no cross-customer
  table, bucket, or credential. Consistent with ADR-0004's ownership boundary.
- **Configuration location.** The private bucket name(s), the object-store endpoint and
  region, the database connection, the private path prefix, and every credential live in
  **validated deployment configuration** — environment variables validated the way
  `deployment-config.ts` validates the `SITE_*` and Sensitive values — **never** in the
  client-served `SiteSettings` or the CMS. A generic clone sets its own values; no
  photographer identity is baked into code.

### 10. Why this is an ADR (AC10)

The hard-to-reverse decisions recorded here: the structural public/private isolation
boundary (a leaked private byte or customer record is unrecoverable); the
fragment-capability + server-session access contract and the recoverable-capability
storage model (the link shape and the stored-secret contract that AB#29 and AB#130 build
on and that notification emails carry); the S3-compatible object-store commitment and the
separate PostgreSQL-family private store with its required invariants; the six-month
retention model (worker-authoritative, lifecycle-as-backstop, backup constraint,
fail-closed access); and the "direct short-lived signed URL, never proxy a private byte"
delivery rule (operationalising ADR-0004 §6). These meet the `/architecture` threshold.
The ADR authorises **no implementation** — AB#29 and AB#130 build.

## Options Considered

### Access transport

| Option | Verdict |
| --- | --- |
| **Fragment capability + server-side session (chosen)** | The capability never reaches a server request line or an infrastructure log; the initial `GET` is non-sensitive; a session cookie carries the rest. Cost: JavaScript is required for customer-gallery access. |
| Query parameter (`?k=`) exchanged server-side for a session, then redirect | **Rejected.** The initial request puts a reusable six-month credential into edge / CDN / proxy logs and email-scanner fetches before any application redaction can act. `Referrer-Policy` only protects *subsequent* requests. Kept as the documented fallback if a deployment must support no-JavaScript access. |
| Token stays in the URL for the session's life, `Referrer-Policy: no-referrer` only | **Rejected.** The credential sits in browser history, in referrers, and in every request log for the gallery's whole life. |
| Per-customer accounts and passwords | **Rejected.** AC2 explicitly wants shareable access with no separate code, and AB#29 forbids a reusable plaintext password by email. |

### Capability storage

| Option | Verdict |
| --- | --- |
| **Encrypted at rest under a server-only key (chosen)** | Recoverable for "resend" and "copy access link" (AB#29); a store dump without the key is useless. |
| Bare hash only | **Rejected.** The application could never reconstruct the link to resend it — it would have to mint an additional capability every time, multiplying live credentials. |
| Plaintext in the private store | **Rejected.** A store dump yields working links; encryption under a separately-held key is nearly free. |

### Object storage

UpCloud (reference) / Cloudflare R2 (documented alternative) / web-hosting disk
(rejected) / Vercel Blob (rejected) / Sanity-hosted (rejected) — see §8a.

### Private metadata store

Dedicated PostgreSQL-family engine, vendor deferred (chosen) / a second private Sanity
dataset (rejected — not for lack of transactions or optimistic concurrency, which Sanity
and this repo both have, but for no enforced-at-write uniqueness, no referential
integrity, and the wrong workload and isolation shape) / KV–Redis (rejected — not a
relational system of record) — see §8b.

### ZIP generation

Pre-generated under an immutable key, verified, then atomically activated by a Postgres
pointer, with one active version (chosen) / on-demand
inside a Function (rejected) / on-demand streaming worker (fallback only) — see §8c.

### Retention clock

Metadata worker authoritative + provider lifecycle rule as a backstop (chosen) / a
provider lifecycle rule as the primary clock (rejected — it cannot track each gallery's
publication-derived `accessExpiresAt` when object upload precedes publication) / delete
only on explicit administrator action (rejected — this is the legacy failure mode, where
files linger for years).

### Deliverable

One ADR carrying the spike (chosen) / an ADR plus a separate `docs/` companion document
(rejected — there is no fixture corpus, harness, or live measurement to justify a
companion, unlike `docs/keyword-query-benchmark.md`; AC8's comparison belongs in Options
Considered, Trade-off Analysis, and a dated Evidence section).

## Trade-off Analysis

**Shareability against auditability.** The design gives every link holder full authority
by explicit requirement. The compensating controls are entropy, short signed TTLs,
revocation, and expiry — not per-user identity. A deployment that later needs to know
*who* opened a gallery would need a different access model, and this is called out as a
migration trigger.

**A JavaScript requirement against credential-log safety.** The fragment transport keeps
a reusable six-month secret out of infrastructure logs, at the cost of no-JavaScript
access. Accepted, because the alternative puts the credential somewhere application code
cannot redact it. The query-exchange variant remains documented for a deployment that
must relax the JavaScript requirement and can accept the initial-request exposure.

**A recoverable capability against a bare hash.** Storing the secret so it can be re-sent
trades a little at-rest exposure — mitigated by encryption under a separately-held key —
for a feature AB#29 requires. Hash-only would push the problem into AB#29 as extra
"mint a second capability" machinery and multiple live credentials per gallery.

**Pre-generated ZIP storage cost against request-time compute risk.** Paying to store one
ZIP per active delivery gallery is predictable and small under a six-month rotation.
Assembling it in-request is not possible within the platform's body and duration caps at
all, so this is less a trade-off than a forced move; the real alternative (a streaming
worker) is heavier and deferred until the storage cost is shown to matter.

**A separate Postgres against reusing the content store.** A new dependency and a new
account, against not fighting a document store for transactions, enforced uniqueness,
referential integrity, and an outbox. A later customer/job module (AB#28) might reuse the
same store, but that is an unmade decision, not a justification counted here.

**Worker-authoritative retention against provider lifecycle rules.** More moving parts —
a job, a state machine, drift monitoring — against a retention promise that actually
holds when scheduled deletion half-fails. The lifecycle rule stays, but only as a
backstop.

**Two-stage authorization against a single gate.** Direct-from-storage delivery keeps
large bytes off the Function path (mandatory per ADR-0004 §6) at the cost of a bounded
revocation lag and an expired-URL retry contract. Both are stated in §5, neither is
hidden.

**EU residency against R2 economics.** UpCloud keeps data with an EU company and includes
egress; R2's free egress and per-GB price are attractive, but it is a US company. Left as
a per-deployment call, with UpCloud as the reference.

## Consequences

**Easier**

- AB#29 and AB#130 start from a decided access contract, storage shape, retention model,
  and isolation boundary instead of renegotiating them.
- `privateOnly` (ADR-0002) finally has a defined enforcement: structural isolation, a
  fail-closed public projection, and a serialization test.
- ADR-0004 §6's "never proxy a private byte" rule has a concrete mechanism — two-stage
  authorization plus a short signed `GET`.
- No cookie banner: the only cookie is a strictly-necessary access-session cookie,
  designed not to require consent and documented in the deployment's privacy notice —
  stated cautiously, not as a blanket legal claim for every jurisdiction.

**Harder**

- Two new customer-owned services (an object store and a Postgres database) to provision,
  secure, back up, and hand off — new entries for `docs/deployment.md` and the handoff
  runbook.
- A retention worker, an outbox, and a state machine are real code AB#29 must build and
  test, not configuration.
- New dependencies: an S3 request-signing helper, a Postgres driver/pooler, and a ZIP
  writer — each with a stated need, none a UI framework (`AGENTS.md`).
- The CSP gains a private object-store origin on the private routes (an ADR-0011 action
  item); `src/proxy.ts` gains a private-prefix rule (an ADR-0007 action item).
- JavaScript is required for customer galleries — a documented, accepted reduction from
  the public site's no-JavaScript-friendly posture.
- A bounded revocation lag (the signed-URL TTL) and an expired-preview retry contract are
  permanent properties of direct-from-storage delivery.

**To revisit — migration triggers**

- **A deployment needs no-JavaScript customer-gallery access** → adopt the documented
  query-exchange variant with an explicitly accepted initial-request log exposure.
- **Pre-generated ZIP storage cost becomes material at real volume** → move to on-demand
  streaming assembly from an external worker.
- **The chosen Postgres provider fails an AB#29 verification** (residency, PITR,
  ownership, pooling, cost) → pick another; the engine-family decision and the invariants
  stand.
- **Object Lock / WORM retention becomes a requirement** (a legal hold on a selection) →
  UpCloud's "coming soon" Object Lock or an R2 equivalent; not needed for the six-month
  model.
- **A per-image sales feature (AB#95) needs online full-resolution originals** → it
  provisions its own store and lifecycle rather than using this bucket.
- **Multi-instance per-IP rate limiting is needed** (only the fast per-IP throttle is
  single-instance; the per-gallery / per-handle defence is already persisted) → a shared
  store for that per-IP layer — the same open item the contact endpoint already has.

## Action Items

1. [ ] **AB#29** builds the private delivery gallery: the object-store and Postgres
   adapters (server-only, ESLint-bounded), the fragment-bootstrap and exchange endpoint,
   the session model with its AEAD capability envelope (§3), the two-stage authorization,
   the **owner-run CLI** that assembles the ZIP locally and uploads only a server-issued
   immutable-keyed preparation plan, plus the authenticated server completion operation
   that verifies it and transactionally swaps `activeZipObjectKey` (§8c), the publication
   state machine + outbox,
   the **gallery-notification transport with a validated per-message recipient** (over the
   Resend provider, not the fixed-recipient `ContactDeliveryRequest` contract), and the
   retention worker with its bounded-lifetime caps and row-retention periods (§7). It picks
   and verifies the concrete Postgres provider (residency, encryption, PITR window ≤ 30
   days + tested restore with the worker-runs-first gate, ownership/export, serverless
   pooling, migration, cost) and the concrete object-store account, and runs the §8a
   provisioning-gate live checks (unsigned GET/LIST fail, signed GET works, `Range` on a
   20 GB ZIP, `no-store` + `Content-Disposition` preserved) before the deployment is
   accepted.
2. [ ] **AB#130** builds private proof selection on the same boundary: watermarked-
   derivative upload, permanent `001`-based references, versioned immutable confirmation
   snapshots with optimistic concurrency, the pricing snapshot, and the photographer
   confirmation email through the same outbox and gallery-notification transport.
   **Both AB#29 and AB#130 carry the repository's WCAG 2.1 AA requirement:** every private
   gallery, invalid/expired-access state, upload/status surface, and proof-selection
   control is keyboard-operable, has visible focus, and exposes loading, error, and
   confirmation status to assistive technology.
3. [ ] The administrator-authentication boundary (§4) is designed and reviewed in
   AB#29 — mechanism open, separation from the customer path fixed.
4. [x] **ADR-0011**: add the private object-store origin to `img-src` (previews load as
   `<img>`; no `connect-src` grant — §6) on the private routes only, in the same change
   that introduces them; add `next-config.test.ts` coverage. *Done (AB#29, 2026-09-02).*
   The grant is emitted only for `PRIVATE_GALLERY_STORE=enabled` and is sourced at the
   internal rewrite target, a build-time constant, rather than the configurable public
   prefix. Two `next.config.ts` behaviours were **measured against a production build**
   rather than assumed, and both had been guessed wrongly earlier in this story: a
   `headers()` rule matches the original request path *and* the path the Proxy rewrote to,
   and among matching rules the **last** one wins for a given header name. This makes
   `PRIVATE_GALLERY_S3_ENDPOINT` a build-time input for an `enabled` deployment — an
   origin, not a credential, on the same footing as the Sanity ids the optimizer allow-list
   already reads at build; recorded in `.env.example` and `docs/deployment.md`.
5. [x] **ADR-0007 / `src/proxy.ts`**: add the private-prefix response rules (`no-store`,
   `noindex`, `Referrer-Policy: no-referrer`); `buildRobotsPolicy` gains the `Disallow`.
   *Done (AB#29, PR #102), with one behaviour found later and recorded in `src/proxy.ts`:
   a `NextResponse.next()` response's headers replace a same-named `next.config.ts` value
   while a `rewrite()` response's do not, which silently cost `no-referrer` until
   `e2e/private-route-hygiene.spec.ts` caught it.*
6. [x] **`buildSitemapPaths`**: add a test asserting the private namespace never enters
   the sitemap. *Done (AB#29, PR #102) — `src/lib/sitemap.test.ts`, across three different
   configured prefixes so the assertion is about the namespace rather than one spelling.*
7. [ ] **`.env.example` and `docs/deployment.md`**: document the validated server-only
   `PRIVATE_GALLERY_CAPABILITY_KEYS` keyring (base64-encoded **256-bit random** AES keys)
   and `PRIVATE_GALLERY_CAPABILITY_ACTIVE_KEY_ID` (request-time Sensitive,
   per-environment, never `NEXT_PUBLIC_`; old keys retained through the §3 scan), the
   object-store endpoint / region / bucket, the Postgres connection, and the private path
   prefix — validated deployment configuration, never `SiteSettings`. Document all three
   storage credentials separately: deployed runtime/verifier object-read access for exact
   keys only (`GET` signing + metadata `HEAD`, no list/write); deployed retention-worker
   prefix-scoped enumeration/deletion and incomplete-multipart cleanup; and owner-run CLI
   write/multipart access with no read/delete/list/ACL/policy permission. The CLI credential
   lives only on the photographer's machine (or a one-off provisioning run), never in a
   deployed environment — the same posture `docs/sanity-seeding.md` takes for
   `SANITY_SEED_TOKEN`.
8. [x] **`docs/architecture/application-boundaries.d2` and `system-context.d2`**: the
   private route group, the private-gallery adapter node, the private object store, and
   the private Postgres are added as dashed `planned` nodes with `pending-flow` edges in
   this ADR's change (both SVGs regenerated). AB#29 makes them solid.
   `deployment-flow.d2` is unchanged — no deploy step operates yet.
9. [ ] **`docs/deployment.md` and the AB#118 handoff runbook**: provisioning, backup /
   PITR, the mandatory at-least-daily retention-worker schedule, owner-run repair /
   backfill, drift monitoring, and the exit path for both new services.
10. [x] A privacy-notice section (the deployment owner's, per ADR-0004's "not a legal
    conclusion") for the access-session cookie and the private-gallery data flow, sibling
    to `docs/contact-data-flow.md`. *Done (AB#29, 2026-09-02):
    `docs/private-gallery-data-flow.md`. It records the operational facts a notice would
    be written from, not the notice itself. Two gaps it surfaces rather than closes: no
    visitor-facing privacy notice exists on the private gallery page — the contact form
    has one, and whether this needs its own belongs with AB#145's customer-facing
    surface — and nothing in it has been checked against a running deployment, because
    there is not one.*
11. [x] **`AGENTS.md`** "Public derivatives only" is amended in this change with a scoped
    exception naming this ADR (§5), so AB#29's authorized private-derivative delivery
    (link/session-holder, not identity) does not require violating a canonical rule. The
    restored `private or sales/fulfilment` clause continues to bar AB#95's sales assets;
    the public media contract and optimizer path are untouched.

## Evidence

Checked 2026-08-31 against current official documentation:

- **Vercel Functions request / response limits.** Vercel's later 2026-06-29 changelog
  (`https://vercel.com/changelog/vercel-functions-now-support-100mb-request-bodies`)
  raises the Function **request body to 100 MB**. The general limitations page
  (`https://vercel.com/docs/functions/limitations`) still contains the older sentence
  assigning 4.5 MB to both directions, while the current response-error documentation
  (`https://vercel.com/docs/errors/function_response_payload_too_large`) independently
  keeps the **response body at 4.5 MB**. This ADR follows the later request announcement,
  records the documentation discrepancy rather than hiding it, and depends only on the
  unchanged response boundary: permitted private objects may exceed 4.5 MB and the 20 GB
  ZIP ceiling is incompatible with it. Current duration and memory ceilings (Hobby 300 s;
  Pro/Enterprise up to 1,800 s with Fluid Compute; Hobby 2 GB and Pro/Enterprise 4 GB)
  reinforce, but do not carry, the decision not to proxy any private byte.
- **Cloudflare R2 pricing** (`https://developers.cloudflare.com/r2/pricing/`): USD
  0.015/GB-month standard storage, Class A USD 4.50/million, Class B USD 0.36/million,
  **egress free**, 10 GB-month free tier.
- **Cloudflare R2 presigned URLs**
  (`https://developers.cloudflare.com/r2/api/s3/presigned-urls/`): GET / HEAD / PUT /
  DELETE, expiry 1 second to 7 days (604 800 s).
- **Cloudflare R2 object lifecycles**
  (`https://developers.cloudflare.com/r2/buckets/object-lifecycles/`): expiration by
  `Days` or `Date`, prefix filter, `AbortIncompleteMultipartUpload`, storage-class
  transitions; 1000 rules per bucket; applied within ~24 h.
- **UpCloud Managed Object Storage**
  (`https://upcloud.com/docs/products/managed-object-storage/s3-standard-compatibility/`
  and `https://upcloud.com/products/object-storage/`, via search 2026-08-31):
  S3-standard compatible — bucket lifecycle policies, presigned URLs (≤ 7 days), IAM
  policies, bucket and object ACLs, bucket policies, and versioning **supported**; S3
  bucket access logging (`GetBucketLogging` / `PutBucketLogging`) **not supported**;
  Object Lock "coming soon". Regions include Helsinki (`FI-HEL2`) and Frankfurt
  (`DE-FRA1`). 250 GB from EUR 5/month; zero-cost egress subject to a Fair Transfer
  Policy.

## What this ADR does not establish

- **No code, no schema, no account.** Nothing is implemented; no object store, database,
  or credential is provisioned.
- **No concrete Postgres vendor**, and no concrete object-store account — both are AB#29
  provisioning decisions with their own verification.
- **No pricing quote** — the cost figures are dated public snapshots, not contractual.
- **No administrator identity mechanism** — §4 fixes that the boundary exists, not how it
  authenticates.
- **No dynamic watermarking** — proofs are externally prepared with a baked-in watermark
  (AC6); the watermark is a deterrent, not authorization.
- **No customer access beyond six months** — that product change is outside this ADR and
  requires an approved amendment to AB#122 AC7 before this boundary can be reconsidered.
- **No sales, checkout, licensing, or fulfilment** — AB#95; a future per-image sale
  provisions its own store rather than using this six-month bucket.
- **No customer / job / contract / invoicing model** — AB#28; this ADR names the link
  from a private gallery to a customer/job record but does not design that record.
- **The architecture diagrams are updated in this change** — `application-boundaries.d2`
  gains the private route group, the private-gallery adapter node, the private object
  store, and the private Postgres; `system-context.d2` gains the private object store and
  private Postgres as the site owner's own external systems, with the owner-provisions and
  site-reads / visitor-downloads relationships. All are dashed `planned` nodes and
  `pending-flow` edges labelled "planned — ADR-0014", and both SVGs are regenerated. They
  become solid when AB#29 makes them operate. `deployment-flow.d2` is unchanged — no
  deploy step operates yet.
- **This is a product-requirement and architecture boundary, not a legal compliance
  conclusion** — each deployment owner remains responsible for its own privacy notice,
  processing record, provider terms, and applicable legal review (as ADR-0004 states).
