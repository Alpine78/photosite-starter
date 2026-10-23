# ADR-0038: Proof selection for unlisted client galleries in the existing Sanity project

**Status:** Accepted (2026-10-22)
**Date:** 2026-10-21
**Deciders:** Project owner
**Work item:** AB#130 (parent AB#63; related AB#29, AB#145, AB#28, AB#95)

## Context

[ADR-0034](0034-ongoing-unlisted-client-delivery.md) chose ongoing unlisted client
delivery in the existing Sanity project for this deployment and rejected a separate
S3-compatible store and PostgreSQL service. It deferred proof selection (AB#130) until a
compatible design exists, and stated that no public write permission follows from the
delivery decision.

AB#130's acceptance criteria ask for an owner-reviewable design before any
implementation. The business workflow it must preserve, carried over from the earlier
protected model (its historical criteria are kept in the work item's discussion):

- externally watermarked web proofs, shown full-frame at their native ratio;
- a permanent gallery-local reference per proof (`001`, `002`, …) in natural filename
  order, never reused, unchanged by later reordering;
- explicit selected / not-selected state, the selected count, included count, extra
  count, extra unit price, currency and extra total visible before confirmation;
- a deliberate confirmation that stores an immutable, versioned record of exactly what
  was selected, locks casual edits, and can be reopened only by the administrator,
  keeping earlier versions;
- a photographer notification that is distinct from the durable record, with visible
  delivery status and resend;
- the design must also settle who may write a selection, abuse controls, persistence,
  what becomes public, customer/job linkage, expiry and retention.

It must do so without claiming that holding a public unlisted link proves authority to
edit, without treating email as the record, and without publishing customer, contact,
job or selection data. Payment, invoicing and receipts stay in AB#28/AB#95.

### Verified facts this design relies on

- **Path IDs in a public dataset are not publicly readable.** Sanity: "All documents
  that contain a `.` in their `_id` can only be accessed when a user is logged in or a
  valid authentication token is provided … (minimum `read` permission required)", and
  "it is not possible to make documents under a sub-path … publicly available"
  ([Sanity: document IDs and paths](https://www.sanity.io/docs/content-lake/ids),
  read 2026-10-21). Drafts (`drafts.`) and release versions (`versions.`) already rely on
  this rule.
- **Assets are a different matter.** Image and file assets in a public dataset are
  reachable by URL without authentication; ADR-0034 already accepts that for delivered
  images. A proof image is therefore public by URL, which is why proofs are watermarked.
- **Runtime writes from a public request have a precedent and a known cost.**
  [ADR-0018](0018-article-poll-voting-storage-and-dedup.md) §7–§8: document-type-scoped
  token roles are a Growth-plan feature, so a runtime write token may in practice be a
  dataset-wide Editor token; the real safety boundary is a narrow server code path that
  never takes an ID, type or mutation shape from the request, behind an import
  restriction. The project already ships this pattern for poll votes.
- **Mail delivery and throttling already exist.** Contact and enquiry delivery use the
  Resend adapter (`src/lib/contact-delivery.ts`); `src/lib/contact-rate-limit.ts` is a
  best-effort, per-instance limiter with no shared store (ADR-0004 §2), backed by the
  platform's own controls.
- **Client galleries today** (`sanity/schemas/client-delivery-gallery.ts`): a published
  `clientDeliveryGallery` with a random, non-customer-derived 128-bit `handle`, explicit
  `available` / availability mode / exclusive UTC deadline, and up to 256 ordered
  public web images; `/client-gallery/<handle>` serves it with `noindex`, `no-store` and
  `no-referrer`.

## Decision

Accepted by the owner on 2026-10-22, including the owner answers and Decision 9 below.
Implementation follows the action items as small reviewable slices; production
activation is a separate owner decision.

1. **Proofs are a separate unlisted gallery type in the public dataset.**
   A `clientProofGallery` document reuses the client-gallery shape: random handle,
   explicit availability and an optional deadline (indefinite by default, Owner
   answers 4), an optional reference to the delivery gallery that replaces it (Owner
   answers 5), ordered items. Each item holds a public,
   externally watermarked web proof (the same ≤2048 px public derivative contract as
   delivery images; no server-side watermarking), its complete original filename as
   text, and a `reference` field. Viewing needs only the link, exactly like delivery.
   Nothing customer-, job- or price-specific is stored in the public document.

2. **References are assigned once, at first publication, and never change.**
   A Studio publish action numbers the proofs `001…` in natural ascending order of the
   complete filename (Lightroom-style numeric runs compared as numbers), with a stable
   internal item identity as the tie-breaker for duplicate names. Later additions take
   the next unused number; removed numbers are not reused; reordering never renumbers.
   The publish validation refuses a gallery whose references are missing, duplicated or
   changed after first publication.

3. **Everything private lives under a private ID path in the same dataset.**
   Per gallery, the server keeps documents whose `_id` contains a dot, e.g.
   `proofTerms.<galleryId>`, `proofSelection.<galleryId>` and
   `proofSelection.<galleryId>.v<n>`. Per the verified rule above they are never
   readable without authentication, yet stay in the owner's existing project, backups
   and Studio, with no new service. They hold:
   - **terms**: included count, extra unit price in minor units, ISO 4217 currency, an
     opaque administrator-entered job reference, the customer's email address only when
     the reminder (Decision 9) is enabled (no other contact data until AB#28 defines a
     customer record), and the hash of the selection key (Decision 4), snapshotted when
     the gallery is first published so later default-price changes do not alter it;
   - **the working selection**: the set of selected references and the stable item
     identity for each, a state (`open` / `confirmed`), and the latest confirmed version;
   - **confirmed versions**: one immutable document per confirmation (Decision 5).

   The site's runtime read path and every Studio editor can read these, which is
   intended for the administrator; nothing reaches the public dataset API, the CDN API,
   page HTML or browser payloads beyond the selection holder's own view.

4. **Selecting needs a separate selection key, not just the viewing link.**
   At first publication the server generates a 256-bit random selection key, stores
   its SHA-256 hash in `proofTerms` for verification, and shows the key once to the
   administrator. The key is also stored encrypted from first publication, whether or
   not the reminder is on (Decision 9), so switching reminders on later still has a
   link to send; the hash stays the only thing the selection endpoint checks.
   The share link the administrator sends carries it in the URL fragment
   (`/client-proof/<handle>#select=<key>`): a fragment is not sent in requests, logs or
   `Referer`. The page script sends the key in a request body to a same-origin `POST`
   endpoint, which compares hashes in constant time. A link without the key shows the
   proofs read-only. The administrator can rotate the key, which invalidates the old
   one and replaces its encrypted copy; rotation does not touch existing selections or
   versions.
   The key proves possession of the link the photographer sent, not the customer's
   identity; that limit is stated in the customer-facing copy and the privacy notice.

5. **Writes go through one narrow server path; confirmation is a transaction.**
   - One route (`/api/proof-selection`) and one facade, behind an ESLint import
     restriction exactly as ADR-0018 §8 does for votes. Every document ID, type and
     mutation shape is derived from validated input (gallery identity from the handle,
     references checked against the gallery's own published references); nothing is
     taken from the request as an ID or type. A separate server-only credential
     (`SANITY_PROOF_SELECTION_TOKEN`), refused if exposed as `NEXT_PUBLIC_*`, so it can
     be revoked independently of the poll token.
   - Toggling a proof patches the working selection with `ifRevisionID`, so two tabs
     cannot silently overwrite each other; a conflict returns the current state.
   - **Confirm** is one transaction: `create` the next `…v<n>` version document (a
     `create` fails if it already exists, so a retried request cannot write a second
     version) and patch the working selection to `confirmed` under `ifRevisionID`. The
     version stores the confirmation time, the terms snapshot, the counts and extra
     total, and for each selected proof its reference, complete filename and stable
     item identity. Versions are never patched. The same transaction also creates the
     version's notification record in state `pending` (Decision 6), so a confirmation
     can never exist without a visible notification obligation.
   - **Reopen** is administrator-only (a Studio document action on the working
     selection, run with the editor's own Studio session): it sets the state back to
     `open` and keeps every version. Customers cannot reopen.
   - Abuse controls: same-origin and header checks shared with the contact endpoint,
     the per-instance limiter keyed per client and per gallery, a bounded request body,
     at most the gallery's own item count per request, `no-store` responses, and
     uniform refusals that do not reveal whether a handle or key exists.

6. **The notification follows the record, never replaces it.**
   The confirmation transaction creates a private `proofNotice.<galleryId>.v<n>`
   document in state `pending`. After the commit the route sends one photographer email
   through the existing mail adapter: gallery and job reference, version, confirmation
   time, included / selected / extra counts, unit price, currency, extra total, and each
   selected proof's reference and filename. It then records `sent` or `failed` with the
   attempt time on that notice, guarded by `ifRevisionID`. If the process stops between
   the commit and that update, the notice stays `pending`, and Studio lists every
   notice that has been `pending` longer than a few minutes or `failed` as needing
   action, so the obligation is never silently lost. Every send for one version uses
   the same idempotency key derived from the gallery and version; whether the mail
   provider deduplicates on it must be verified before implementation, and until then
   a resend is documented as possibly delivering a duplicate. A failed or lost email
   never undoes the confirmation. Resend is an administrator action that sends the same
   content again without creating a version; it is deferred, with no resend path for the
   first activation (Owner answers 2). Logs carry only correlation IDs and closed outcome classes, never filenames,
   references, keys or job data.

7. **Expiry and retention are explicit, and different for pages and records.**
   The proof page follows the gallery's availability fields like delivery; after the
   deadline, selection writes are refused even with a valid key. Confirmed versions are
   business records and are kept until the administrator deletes them, with a
   retention the owner set on 2026-10-22: kept until the proof gallery is deleted (Owner answers 3). Deleting a proof gallery deletes
   its private terms, selection and versions in the same transaction, after checking
   shared-asset use before any image asset is removed (ADR-0034 action items). Public
   proof images remain reachable by URL wherever already copied or cached, as for
   delivery images.

8. **The displayed total is a summary, not a charge.**
   Prices are shown and stored as given terms. No checkout, invoice, receipt or payment
   state is created; those remain AB#28 / AB#95.

9. **An automatic reminder to the customer (owner request 2026-10-22).**
   - **Setting.** Each proof gallery has a reminder delay in whole days, 7 by default,
     which the administrator can change per gallery or switch off. It is stored with
     the private terms, together with the customer's email address the administrator
     enters. No address is ever taken from a request.
   - **When.** The delay counts from the gallery's first publication. A reminder is due
     when the delay has passed, no confirmed version exists, the gallery is available,
     not past its deadline and not replaced by a delivery gallery (Owner answers 5).
   - **Cadence (Owner answers R2).** The first reminder is due when the delay has
     passed; after it, one reminder every 30 days while the conditions above still
     hold. Reminders stop for good once a version is confirmed, the gallery expires or
     is replaced, or the administrator switches them off; switching them back on
     resumes from the next 30-day step. Reminder *n* is due at first publication +
     delay + (n − 1) × 30 days.
   - **At most once each.** Sending reminder *n* first `create`s a private
     `proofReminder.<galleryId>.<n>` record (a `create` fails if it already exists, so a
     repeated or overlapping run cannot send the same reminder twice), then records
     `sent` or `failed` like Decision 6's notice; Studio lists failed reminders. A run
     that finds several missed steps sends only the latest one.
   - **Schedule.** A scheduled function runs once a day and sends every reminder that is
     due, so a reminder goes out on the first run after the delay, up to about a day
     later; a day is the setting's own unit, so a more frequent run buys nothing. The
     reference deployment is on Vercel Pro (ADR-0004 amendment 2026-10-09), which
     allows per-minute schedules; a daily schedule also fits Hobby's once-per-day limit
     and its start anywhere within the configured hour (Vercel cron documentation), so
     a clone on either plan works unchanged. The route accepts only the platform's
     `CRON_SECRET` bearer token and answers `no-store`.
   - **Message.** Sent through the existing mail adapter in the gallery's locale
     (Finnish or English): the gallery name, that no selection has been confirmed yet,
     the full selection link, and the photographer's contact, with a line telling the
     customer to reply if they want no further reminders.
   - **Recoverable key (Owner answers R1).** The selection key is stored encrypted with
     AES-256-GCM (Node's built-in `crypto`, no new dependency) in the private terms,
     under a separate server-only secret used for nothing else (refused as
     `NEXT_PUBLIC_*`). Only the reminder route decrypts it, in memory, to build the link;
     it is never logged. Accepted consequence: anyone holding both read access to the
     private documents (every project member, Owner answers 1) and that secret could
     select on the customer's behalf. Rotating the secret requires re-encrypting the
     stored keys; until then reminders for those galleries fail visibly in Studio
     rather than send a broken link.
   - **Privacy.** The customer's address is personal data: it lives only on the private
     path, is never logged (correlation IDs only), is deleted with the gallery, and the
     privacy notice names the reminder before activation.

## Options Considered

| Option | Assessment |
| --- | --- |
| **Private ID paths in the existing public dataset** (this proposal) | No new service or plan; records stay in the owner's project and backups; not publicly readable by Sanity's fixed rule. Readable by every project member and by the site's runtime read credential. |
| A second, private Sanity dataset for selections | Keeps selections out of the public dataset, which private ID paths already do. It does **not** hide them from project members: Sanity's built-in roles (Administrator, Viewer, Editor, Developer, Contributor) have access to all datasets in a project, and dataset-scoped custom roles are an Enterprise feature ([Sanity: roles](https://www.sanity.io/docs/content-lake/roles-concepts), read 2026-10-21). On this plan it adds provisioning and backups without adding isolation. |
| Selection documents at the dataset root (public) | Rejected: anyone could enumerate which images each customer chose, with prices. Violates AB#130's "no publication of selection contents". |
| Email as the record (the form only sends mail) | Rejected by AB#130: email alone is not a durable, versioned record and cannot be reopened or verified. |
| The earlier protected store (S3 + PostgreSQL, ADR-0014/0015) | Rejected for this deployment by ADR-0034. |
| A new hosted database or key-value service | Rejected: a new provider is outside ADR-0034 and AB#130 ("no new service or plan upgrade is implied"). |
| Viewing link alone authorizes selection | Rejected by AB#130: an unlisted, forwardable, enumerable handle does not prove authority to edit. |
| Customer email one-time codes instead of a selection key | Stronger proof of a mailbox, but needs the customer's address stored privately, a code store and expiry, and a mail round trip per session. Possible later on top of this design; not needed to meet AB#130. |

## Trade-off Analysis

The selection key adds one step for the photographer (send the full link, not a
shortened one) and gives a real, revocable authority boundary for writes without
accounts. Keeping it in the fragment keeps it out of server logs and `Referer`, but a
customer can still forward the whole link; that is the same trust model as sending a
contract by email, and is documented rather than hidden.

Private ID paths avoid every new service but are only as private as the project's
member list and read credentials. That is acceptable for a single photographer whose
editors are themselves. Hiding selections from some project members is not achievable
with built-in roles on any dataset layout; it would need Enterprise custom roles or a
separate project, and is out of scope here.

A dataset-wide write token behind a public endpoint is the same accepted risk as poll
votes. Narrow, structurally enforced code is the boundary; this ADR adds a second such
endpoint, so the import restriction and a credential-scope review become required
action items, not suggestions.

No server-side watermarking keeps the image pipeline unchanged. The cost is that the
photographer must export watermarked proofs, and an unwatermarked upload would be
public; publish validation can check dimensions and the ≤2048 px bound but cannot prove
a watermark exists.

## Consequences

- A new public route family (`/client-proof/<handle>`) with the client-gallery
  response policies and listing exclusions, and one new write endpoint.
- New Studio document types and actions (publish-with-numbering, rotate key, reopen,
  resend), and new private ID-path document shapes the schema tests must cover.
- A new long-lived runtime credential, documented in `docs/sanity-setup.md` and the
  security review like `SANITY_POLL_VOTE_TOKEN`.
- `docs/private-gallery-data-flow.md` (or a new proof data-flow page) and the privacy
  notice must describe what is stored, who can read it, how long it is kept and how it
  is deleted, before activation.
- `/client-proof` joins the reserved route namespaces next to `/client-gallery`
  (ADR-0003's root-reservation list), so no content slug can claim it.
- The inactive protected implementation (AB#313) stays off; nothing here reuses it.
- Decision 9 adds a daily scheduled route protected by `CRON_SECRET`, customer email
  addresses and encrypted selection keys on the private path, a key-encryption secret,
  and an outbound customer email every 30 days until a selection is confirmed, all of which the
  security review, `docs/sanity-setup.md` and the privacy notice must cover.

## Owner answers — 2026-10-22

The owner answered the five open questions and accepted the record as a whole on the
same day.

1. **Visibility: accepted.** Every member of the Sanity project may see selections and
   prices. No separate project or custom roles.
2. **Resend path: none for the first activation.** Neither a Studio-session route nor
   the inactive administrator sign-in is built. A `failed` or long-`pending` notice is
   listed in Studio (Decision 6), and the confirmed version itself is readable there,
   so the photographer can act on it without an email. Decision 6's resend action and
   action item 4's resend path are deferred.
3. **Retention: no deletion schedule or reminder.** Confirmed versions are kept; the
   delivery gallery replaces the proof gallery once the images are finished (answer
   5). Decision 7's owner-set retention period is therefore "kept until the
   administrator deletes the proof gallery", with no automatic deletion.
4. **Default availability: indefinite.** A new proof gallery has no deadline unless the
   administrator sets one.
5. **The delivery gallery replaces the proof gallery, and the two must be linked.**
   Accepted mechanism: the proof gallery carries an optional
   reference to its delivery gallery. While the reference is set and that delivery
   gallery is available, the proof link answers with a temporary redirect to the
   delivery link, and selection writes are refused as for an expired gallery. Removing
   the reference or the delivery gallery's availability shows the proofs again. The
   delivery gallery's own availability rules are unchanged; the redirect reveals the
   delivery link only to holders of the proof link, who are the same customer.

Reminder questions (Decision 9), answered by the owner on 2026-10-22:

- **R1. Link in the reminder: (b), the full selection link.** The key is also stored
  encrypted under a separate server secret, with the consequence stated in Decision 9.
- **R2. Cadence: one reminder after the delay, then monthly.** The owner noted a
  gallery that has waited about two years; a 30-day cadence after the first reminder
  keeps such a gallery from being forgotten without daily noise. Existing galleries get
  reminders only once they exist as proof galleries under this record.

## Action Items

As small reviewable slices, now that the record is accepted:

1. Schemas and Studio: `clientProofGallery`, reference numbering at first publication
   with its validation and natural-order tests, private terms snapshot, key generation
   and rotation.
2. Read path: `/client-proof/<handle>` with full-frame proofs, references, read-only
   view without the key, availability enforcement, and listing/search/sitemap exclusion.
3. Write path: facade, import restriction, credential, `ifRevisionID` toggles,
   transactional confirmation, abuse controls, and journey tests for conflicting tabs,
   retried confirmation and expired galleries.
4. Notification record created in the confirmation transaction, Studio list of
   pending/failed notices, no resend path for the first activation (Owner answers 2), the mail
   provider's idempotency behaviour verified, and a test for the window between the
   confirmation commit and the notice update.
5. Reminder (Decision 9): per-gallery delay and address in the private terms, the
   daily `CRON_SECRET` route, the create-once record per reminder step, the 30-day
   cadence, the encrypted key and its secret, localized message, and tests for a
   repeated run, missed steps, reminders switched on after publication, a confirmed or
   replaced gallery, a rotated secret and a failed send.
6. Data-flow and privacy documentation, retention and deletion procedure, then an owner
   activation decision. Production activation is not part of this ADR.

## Amendment — 2026-10-22: publication path (owner decision)

**Decision.** The owner chose the Studio publish action calling a site server route that
verifies the editor's Sanity session ("option 1", over a shared Studio secret or an
owner-run script), to be done safely. This amendment records how; it changes no other
decision.

**Verified facts it rests on.** Sanity Studio 6.18.0's `auth.loginMethod` is `dual` by
default (an HTTP-only cookie where possible), so a document action cannot read the
editor's token unless the Studio uses `loginMethod: 'token'` (token in `localStorage`).
`/users/me` accepts only user sessions, not robot tokens. Documents on a dotted ID path
need authentication with read permission, and writes need a member with write access.
Mutation transactions are atomic; `ifRevisionID` and `create` fail with a conflict when the
document changed or already exists.

**Design.**

1. `POST /api/proof-gallery/publish` (and its preflight), off unless
   `PROOF_PUBLICATION=enabled` with exact Studio origins and a 32-byte
   `PROOF_SELECTION_KEY_SECRET`; incomplete configuration answers 503.
2. CORS only for an exact configured Studio origin, without credentials; any other origin
   is refused before work. Then: JSON content type, a per-client limit, a bounded bearer
   token and an exact `{galleryId, operation}` body (`publish` or `rotate-key`).
3. The route proves the token is a user session with `/users/me`, spends the per-gallery
   allowance only then, and makes every read and the transaction **with the editor's own
   token**. Sanity therefore enforces membership and publish permission; the route holds no
   write credential. The token goes only to this project's API host and is never logged.
4. The server validates the draft independently (closed shape, handle immutability and
   uniqueness, asset metadata, `privateOnly`, a published proof keeping its image) and
   derives numbers from the published state with a restated copy of the numbering rules
   pinned to the Studio's by a parity test.
5. One atomic transaction: a revision-guarded draft patch, then on first publication
   `create` of the gallery and of `proofTerms.<id>` (key hash, AES-256-GCM copy bound to
   the gallery ID, `firstPublishedAt`, `keyIssuedAt`), or on a later publication one
   revision-guarded patch of the published gallery; then the draft is deleted.
   `rotate-key` patches the private record together with a revision-guarded rewrite of the
   published gallery's own high-water value, so a rotation needs the same publish
   permission as a publication. A selection key is returned only after
   the transaction committed; if that answer is lost, the administrator rotates the key.
6. Gallery IDs are limited to 96 characters so `proofTerms.` and later private IDs fit
   Sanity's 128.
7. Logs carry a correlation ID and a closed outcome class only.

**Consequences.**

- The Studio switches to `loginMethod: 'token'` with the publish action: the editor's
  token is then readable by scripts running on the Studio origin, which runs only the
  Studio's own bundle and renders no user HTML. This is accepted as the price of option 1.
- Activation stays off until the private terms can be authored and snapshotted in the same
  first-publication transaction (ADR-0038 decision 3), the Studio action exists, and an
  owner-run check on the hosted Studio confirms `/users/me` and the cross-origin call.
- No reveal-by-decryption is added: decryption stays reserved for the reminder (decision 9).

**Sections affected:** Decision 3 (the private record now also carries `firstPublishedAt`
and is created by this route), Decision 4 (key creation and rotation run here), Action
Items 1 and 4.

## Amendment — 2026-10-22: Studio publish action

**Context.** The publication-path amendment above left the Studio side open. A plan review
found four gaps before implementation: the route could publish a draft other than the one
the editor saw validated; native deletion would orphan the private record; enabling
creation alone would leave the required handle missing; and an answer lost after the commit
would hide the only copy of the selection key.

**Decision.**

1. Proof galleries appear in the Studio, can be created and are published only when the
   Studio sets `SANITY_STUDIO_PROOF_GALLERIES=enabled` together with
   `SANITY_STUDIO_SITE_ORIGIN`. Only that Studio uses `auth.loginMethod: 'token'`; a
   Studio without proof galleries keeps Sanity's default sign-in. This narrows the
   publication-path consequence ("the Studio switches") to the Studios that need it.
2. The custom **Publish proof gallery** action replaces native publish. Native unpublish
   and delete are removed: the published document holds the fixed numbers, `available`
   pauses the page, and deletion waits for a cleanup that also removes `proofTerms.<id>`.
   Only discarding a draft remains.
3. The action is enabled only when the draft's validation finished for exactly its current
   revision with no errors and the document is not synchronising, as native publish
   requires. The request carries that revision as `expectedDraftRevision`; the route
   refuses with `stale-draft` (nothing written) when the draft has moved on.
4. The first publication collects the decision-3 terms in the dialog: included images,
   additional-image price, currency, job reference and the reminder. Currencies are a
   closed list with their minor-unit digits (EUR, USD, GBP, SEK, NOK, DKK, CHF, JPY); the
   price is parsed as text into integer minor units, never through floating point. The
   reminder defaults to on after 7 days (decision 9); the customer's address is required
   and stored only when it is on. Later publications send no terms, and the route refuses
   terms it did not ask for.
5. New documents start with a generated handle, paused, indefinite availability and
   high-water 0. A draft's reference validation checks only what the editor controls (a
   published proof keeps its image; any number present is canonical); the route assigns
   numbers, and a published document must still carry exactly the derived ones.
6. The request is sent once, without cookies or caching, with a 30-second limit and no
   automatic retry. Only the route's own 4xx rejections count as "nothing was published".
   A lost connection, a timeout, a 5xx (a store failure can follow the commit), an answer
   without the route's CORS headers or a malformed success is an **unknown outcome**: the
   dialog tells the editor to reload instead of publishing again, and after a first
   publication to create a new selection link, since none was shown.
7. A selection link is shown once, as `/client-proof/<handle>#select=<key>` with an
   optional configured `?locale=`, with copy and manual-selection fallbacks. **Create a
   new selection link** asks for confirmation that the old link stops working.

**Not established here.** Reminder sending (decision 9) is a later slice: the setting is
stored now and the dialog says so. The customer page, the selection route and an
owner-run check on the hosted Studio still gate activation.

**Sections affected:** Decision 3 (terms are collected in the first-publication dialog),
Decision 9 (reminder default and address storage), the publication-path amendment's
design item 2 (the body also carries `expectedDraftRevision` and first-publication terms)
and its first consequence.

## Implementation note — 2026-10-23: selection write path (action item 3, server side)

Records how decision 5 is implemented; it changes no decision. `POST /api/proof-selection`
(default off) with `SANITY_PROOF_SELECTION_TOKEN`, behind `proof-selection-access`.

- **Order.** Handle discovery (published-perspective query), then the gallery, its terms
  and the working selection read fresh by ID through the Doc API, because the query
  index is eventually consistent and a stale terms record could accept a rotated key.
  A paused, expired or replaced gallery (owner answer 5) is refused before any private
  read; a wrong key is the same 404. The per-gallery allowance is spent only after the
  key matched.
- **Saving** sends the full selected set rather than one toggle: equivalent under
  decision 5's `ifRevisionID` guard and simpler to retry. `expectedRevision: null`
  creates the working selection only if none exists. A conflict answers with the fresh
  state after re-authorizing; the client reconciles deliberately rather than replaying.
  Every save also patches the terms (`lastSelectedAt`) under the revision whose key was
  checked, so a link revoked by rotation cannot save in between; an editor's rotation
  that races a customer save fails as a conflict and is simply retried.
- **Confirming** creates `…v<n>` and its `pending` notice, patches the selection under
  the revision the customer saw and patches the terms (`lastConfirmedAt`) under the
  revision whose key was checked, in one transaction: a retried request, another tab or a
  key rotation or publication in between fails the whole transaction, because every later
  publication also patches the terms record. The version records the gallery
  revision it was validated against. An empty selection cannot be confirmed; saved proofs
  that left the gallery are reported as a stale selection that must be saved again.
- **Outcomes.** A transaction sent without a complete answer (timeout, 5xx, a body that
  breaks off) is an unknown outcome, and a committed transaction whose result could not
  be read back is reported as committed: in both cases the client reads before acting
  again; nothing is retried automatically.
- **Residual race, accepted by the owner on 2026-10-23.** The replacing delivery
  gallery is checked fresh before the write but is not part of the transaction: a
  delivery gallery made available in the same instant can let one save or confirmation
  through. Guarding it would mean writing to the public delivery document on every
  customer save. The consequence is only a selection recorded moments before the
  delivery gallery replaces the proofs; no files or content change.
- **Not yet:** the selection page (3b), the photographer email and Studio notice list
  (action item 4), the administrator's reopen action and reminders.

## Implementation note — 2026-10-23: selection page (action item 3, slice 3b)

Records how decision 4's page script is implemented; it changes no decision. The proof
page reads `#select=<key>` in the browser (only the canonical 43-character encoding),
leaves the fragment in place so a reload keeps working, and sends the key only in
same-origin `POST /api/proof-selection` bodies. The server's answer is the only state
shown; writes are serialized; an answer that is lost, unknown or committed-but-unread is
recovered by one read, never by replaying the write, and changes stay blocked until a
read succeeds. The confirmation step is bound to the revision it was opened on. A new
key in the fragment starts a fresh session. The restricted language switch keeps a
validated key on the same gallery. Forwarding the complete link grants selecting, which
the page states.

## Implementation note — 2026-10-23: photographer notice (action item 4)

Records how decision 6 is implemented; it changes no decision.

- **Mailbox.** The notice goes to the site owner's existing contact mailbox and sender
  (`CONTACT_DELIVERY_*`, Resend or the non-production sink), with its own subject, text
  and idempotency namespace; no separate recipient setting.
- **Content and idempotency.** Built only from the immutable version, validated in full
  (nothing partial is sent), and deterministic per version and locale: the confirmation
  time, never the send time. Resend's documentation (checked 2026-10-23) confirms that the
  same key and payload within 24 hours return the original response without sending
  again; the same key with a different payload, or a concurrent request, is refused and
  recorded as failed, never as sent. A configuration or template change between attempts
  can change the payload, so no replay stability beyond that is promised.
- **When.** Inline, after the confirmation is known committed — also when its result
  could not be read back — and before anything else can fail. An unknown commit sends
  nothing. Sending and recording are bounded and never change the customer's answer.
- **Record.** The notice becomes `sent` or `failed` (with the closed failure class) under
  the revision read; if that write fails or the process stops, it stays `pending`. The
  notice carries a weak reference to its version so Studio opens the details from it.
- **Studio.** Read-only `clientProofSelectionVersion` and `clientProofNotice` types, no
  templates or actions, and a list of notices failed or pending for more than five
  minutes. Resend stays deferred (owner answer 2).

## Implementation note — 2026-10-23: reopening a selection (decision 5)

Records how the administrator's reopen is implemented; it changes no decision. A Studio
document action on the read-only `clientProofSelection` record, with the editor's own
session, patches the working selection's `state` back to `open` under the revision
captured when its confirmation dialog opened, so a newer confirmation the editor never saw
is never reopened. Items, `latestVersion`, versions, notices and the terms are untouched,
so the customer's next confirmation creates `v<n+1>`. A conflict or an unknown result
tells the editor to reload; nothing is retried. At the 999-version limit reopening is not
offered, since the selection could never be confirmed again. An open customer page shows
the change after a reload; nothing polls.

## Amendment — 2026-10-23: reminder language, settings and stopping (owner decisions)

**Context.** Planning the reminder sender (action item 5) found three gaps in decision 9:
galleries have no language for the reminder, settings could only be given at first
publication, and "stop for good" on expiry or replacement cannot be observed reliably by
a daily job that sees only the current state.

**Decisions (owner, 2026-10-23).**

1. **Customer language.** Each gallery's reminder settings hold the customer's language,
   one of the site's configured locales, chosen in the first-publication dialog beside
   the other reminder fields (default: the site's default locale). The reminder's text,
   the gallery title and the link's `?locale=` use it, and the selection link shown at
   publication starts in the same language. The publication route and the Studio
   settings action both refuse a language the site does not offer.
2. **Changing reminders after publication.** A Studio **Reminder settings** action on a
   published proof gallery switches reminders on or off and changes the delay, address
   and language, with the editor's own session and one patch guarded by the revision it
   loaded; prices and keys are never read or written. Switching off removes the address
   and language and records `reminderStoppedAt` / `reminderStoppedBy`. Switching on, or
   changing the delay, records `reminderResumeAfter`: a step is sent only if its due time
   is strictly after it, so the first reminder after the change is the next 30-day step
   (or the first step, if still in the future); step numbers and their records stay.
   Re-enabling clears the stop marker. **Every reminder email also carries a link with
   which the customer can cancel reminders themselves.**
3. **Expiry and replacement pause reminders.** They continue when the gallery is
   available, before its deadline and not replaced again. Reminders stop for good only
   once a version has been confirmed — whether or not the selection was later reopened,
   and an administrator re-enabling does not override it — or when the administrator or
   the customer switches them off (an administrator can switch them back on).

**Design of the customer's stop (implemented with the sender).** The link opens the proof
page with the selection key in the fragment and a stop request; the page asks for an
explicit confirmation, and only that button sends a same-origin POST authenticated by
the key. Opening the link changes nothing, because mail clients and scanners fetch links
on their own. Stopping must work while reminders are paused — after expiry or
replacement — without showing expired proofs. It sets the reminder off and deletes the
customer's address and language.

**Sections affected:** Decision 9 (setting, cadence wording "stop for good", message
language) and action item 5.

## Implementation note — 2026-10-23: the customer's reminder stop

Records how the amendment's self-service stop is implemented; it changes no decision.
`/client-proof/<handle>/reminders` reads no gallery and shows only generic FI/EN text and
a **Stop reminders** button; opening or reloading it sends nothing. The button sends the
key from the fragment in a same-origin `POST /api/proof-selection` with the operation
`stop-reminders`. That branch checks only the gallery's identity and the key against the
fresh terms — not availability, replacement, images, prices or the selection — so a
paused, expired or replaced gallery can still be stopped, and it answers nothing about
the selection. It patches the terms under the checked revision (`reminderDelayDays: null`,
the address and language removed, `reminderStoppedBy: "customer"`), re-plans once after a
conflicting change, and reports a stop only when reminders are off. An unknown handle and
a wrong or rotated key are the same refusal; reminders already off answer stopped without
writing. The reminder sender links to this page.

## Implementation note — 2026-10-23: the daily reminder run (action item 5)

Records how decision 9 and its amendment are implemented; it changes no decision.
`GET /api/proof-reminders` (default off, `CRON_SECRET`, daily Vercel cron) walks the
galleries with reminders on in `_id` order from a private cursor, in batches of 50,
wrapping around, and starts no new gallery after 15 seconds of its 200-second limit
(valid on Hobby and Pro with Fluid compute); before claiming it also requires a 130-second
reserve for the claim, fresh reads including replacement delivery checks, send, outcome
read/patch and cursor write to fit within the 185-second hard deadline (15-second safety
margin), otherwise counting it as skipped without writing the step so a later run can
claim it; claimed work is always finished, so every gallery is reached on a later day.
Per gallery it reads the terms first, then the
selection and the gallery (and a replacing delivery gallery), so the claim — `create` of
`proofReminder.<id>.<n>` with a guard on that terms revision — fails if a confirmation,
rotation, settings change, stop or publication came in between. It prepares the message
before claiming, then reads everything again and records the step `cancelled` if the
settings, selection or availability changed; a message already handed to Resend cannot
be withdrawn by a later write. A key that does not decrypt to its hash is recorded
`failed` (`key-unavailable`) rather than sent as a broken link. An ambiguous claim sends
nothing and its step is never reclaimed. The message is in the customer's language, with
the selection link (`?locale=` before `#select=`), the stop link and Reply-To the owner
mailbox; the idempotency key is `proof-reminder/<id>/<n>`. Reminders on but not sendable
(no language, address or publication time) are skipped and listed in Studio; nothing is
guessed.

