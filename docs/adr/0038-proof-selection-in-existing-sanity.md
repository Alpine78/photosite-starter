# ADR-0038: Proof selection for unlisted client galleries in the existing Sanity project

**Status:** Proposed
**Date:** 2026-10-21
**Deciders:** Project owner (acceptance pending)
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

Proposed. Nothing below is accepted until the owner says so, and no implementation
starts before that.

1. **Proofs are a separate unlisted gallery type in the public dataset.**
   A `clientProofGallery` document reuses the client-gallery shape: random handle,
   explicit availability and deadline, ordered items. Each item holds a public,
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
     opaque administrator-entered job reference (no contact data until AB#28 defines a
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
   only its SHA-256 hash in `proofTerms`, and shows the key once to the administrator.
   The share link the administrator sends carries it in the URL fragment
   (`/client-proof/<handle>#select=<key>`): a fragment is not sent in requests, logs or
   `Referer`. The page script sends the key in a request body to a same-origin `POST`
   endpoint, which compares hashes in constant time. A link without the key shows the
   proofs read-only. The administrator can rotate the key, which invalidates the old
   one; rotation does not touch existing selections or versions.
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
   content again without creating a version (its authenticated path is Open question
   2). Logs carry only correlation IDs and closed outcome classes, never filenames,
   references, keys or job data.

7. **Expiry and retention are explicit, and different for pages and records.**
   The proof page follows the gallery's availability fields like delivery; after the
   deadline, selection writes are refused even with a valid key. Confirmed versions are
   business records and are kept until the administrator deletes them, with a
   retention period the owner sets (Open question 3). Deleting a proof gallery deletes
   its private terms, selection and versions in the same transaction, after checking
   shared-asset use before any image asset is removed (ADR-0034 action items). Public
   proof images remain reachable by URL wherever already copied or cached, as for
   delivery images.

8. **The displayed total is a summary, not a charge.**
   Prices are shown and stored as given terms. No checkout, invoice, receipt or payment
   state is created; those remain AB#28 / AB#95.

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

## Open questions for the owner

1. Is "every project member can see selections and prices" acceptable? (A second
   dataset would not change that on this plan; only a separate Sanity project or
   Enterprise custom roles would.)
2. Resend path for a failed notification: a Studio action needs an authenticated server
   call to use the mail credential. Options are a small authenticated route that
   verifies the editor's Sanity session, or the existing administrator sign-in
   (ADR-0015 code, currently off). Which, if any, before the first activation?
3. How long are confirmed selection versions kept after a gallery's deadline, and is a
   deletion reminder needed?
4. Default availability for a new proof gallery (a deadline or explicitly indefinite)?
5. Should a proof gallery link to its later delivery gallery, or stay independent?

## Action Items

Only after acceptance, as small reviewable slices:

1. Schemas and Studio: `clientProofGallery`, reference numbering at first publication
   with its validation and natural-order tests, private terms snapshot, key generation
   and rotation.
2. Read path: `/client-proof/<handle>` with full-frame proofs, references, read-only
   view without the key, availability enforcement, and listing/search/sitemap exclusion.
3. Write path: facade, import restriction, credential, `ifRevisionID` toggles,
   transactional confirmation, abuse controls, and journey tests for conflicting tabs,
   retried confirmation and expired galleries.
4. Notification record created in the confirmation transaction, Studio list of
   pending/failed notices, the resend path chosen in Open question 2, the mail
   provider's idempotency behaviour verified, and a test for the window between the
   confirmation commit and the notice update.
5. Data-flow and privacy documentation, retention and deletion procedure, then an owner
   activation decision. Production activation is not part of this ADR.
