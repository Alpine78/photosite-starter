# ADR-0018: Article poll voting — storage, dedup, and close-date boundary

**Status:** Accepted
**Date:** 2026-09-18
**Deciders:** Project owner (Ilkka Rytkönen)
**Work item:** AB#162

**Current implementation:** the dated amendment below supersedes the original
receipt/tally transaction, cookie, and UI details. The original decisions are
preserved to make the correction reviewable.

## Context

AB#137's migration inventory surfaced 20 legacy articles carrying a Joomla
`{CONTENTPOLL}` marker (recorded on AB#26's Azure Boards comment, with every poll's real
historical question, options, and vote counts). AB#26 itself ("Article comments, ratings,
and polls") is a rough, unrefined story bundling three unrelated features. On 2026-09-18
the owner asked for the poll-voting slice specifically, split out and built now, ahead of
comments and star ratings — split into AB#162 — and added one requirement beyond a static
historical display: a new poll must carry an authored close date, after which it stops
accepting votes.

That single requirement turns this from "render some frozen numbers" into a live,
public, anonymous-write feature, and it has to sit inside constraints this project
already has no exception to:

- **No application database exists.** Sanity is the CMS (ADR-0004), read through the
  boundary ADR-0006 establishes — a runtime **read** connection, one read token, no write
  path from a browser request. The private-gallery feature's PostgreSQL-family store
  (ADR-0014) is designed but not provisioned, and has nothing to do with polls.
- **Every write credential this project has minted so far is owner-controlled and
  temporary** — `SANITY_SEED_TOKEN` for the demo seeder, `SANITY_MIGRATION_TOKEN` for
  AB#137's importer (`docs/sanity-seeding.md`). Neither is ever reachable from a public
  request. A poll vote is the first feature where an anonymous visitor's own request has
  to cause a write.
- **Minimal dependencies (AGENTS.md).** The project already reaches its email provider
  over plain HTTP rather than an SDK for exactly this reason; a new backend service is
  not a default answer here either.
- **Privacy by default (AGENTS.md): "no tracking cookies… goal: no cookie banner."** Private-gallery and administrator sessions already have functional cookies.
- **Sanity's own publish model.** A Studio "Publish" writes the **whole** published
  document from the current draft. Nothing partially merges. Any field that a live
  process also writes between two Studio publishes is at risk of being silently reverted
  the next time an editor publishes an unrelated change.
- **ADR-0003 decision 2** fixed the article body as a closed six-kind block set,
  since amended to eight (AB#22, AB#24). A poll needs to be a body placement like an
  image or a table, not a parallel content model bolted onto the article boundary from
  outside.
- **ADR-0017** already established the shape "an authored instant, checked at read time
  with a `now() >= X` gate, folds into the content's effective public state" for
  `endDate`. A poll's `closeDate` is the same shape, one level down (per-poll, not
  per-page) — reusing the *pattern*, not the code.

## Decision

### 1. A poll is a ninth shared content-block kind

`contentPollBlock` joins the ADR-0003 decision 2 body-block set, alongside
`contentGalleryBlock`/`contentTableBlock`. It references a `poll` document rather than
embedding poll data inline, the same relationship `contentMediaBlock` has to a `media`
document. No second, parallel "poll page" or "poll section" model is introduced — a poll
lives exactly where an editor placed it in an article's body, like every other block.

### 2. Three document kinds, three different visibility and mutation rules

- **`poll`** — Studio-authored, language-keyed (ADR-0008): `pollId` (stable, ADR-0002 §1
  identity pattern — minted once, never derived from the question text), `question`,
  2+ `options` (each a stable `optionId` + label), and `closeDate`. This is the only one
  of the three an editor ever sees or edits, and Studio's ordinary publish/draft lifecycle
  governs it exactly like an article.
- **`pollTally`** — one document per poll, deterministic `_id` (`pollTally-<pollId>`),
  holding `pollId` and a `counts` map keyed by `optionId`. **No Studio schema is defined
  for this type at all.** Sanity does not require a document's `_type` to have a matching
  schema to accept a write through the mutate API (`sanity-seed-fixtures.mts` already
  relies on the same fact for its own document set) — the type simply never appears in
  Studio's document list or edit forms. This is what makes decision 2's "Studio publish
  can never touch live counts" true by construction rather than by editor discipline: the
  document a poll's own publish action writes and the document a vote increments are two
  different `_id`s, full stop.
- **`pollVoteReceipt`** — one document per `(pollId, visitorToken)` pair, deterministic
  `_id` (`pollVote-<pollId>-<visitorToken>`), Studio-invisible for the same reason as
  `pollTally`. Its only job is to exist or not exist; nothing reads its fields back.

### 3. Every tally mutation is a single atomic `inc()`, addressed by id

The vote endpoint never reads a count and writes a new one. It always issues
`client.patch(tallyId).setIfMissing({counts: {}}).inc({[\`counts.${optionId}\`]: 1}).commit()`
(or the mutate-API equivalent), which Sanity applies as one atomic operation against the
current stored value regardless of how many other requests race it. This closes the
classic lost-update race a read-modify-write counter would have under concurrent votes.

### 4. Dedup is a plain `create` receipt, refused on conflict — not `createIfNotExists`

An atomic counter prevents a *lost* update; it does not prevent counting the *same* vote
twice. A resubmitted request (client retry, double form submit, a replayed request) and
two genuinely concurrent requests from the same visitor are both real cases an atomic
counter alone does not stop, because "increment" has no memory of who already
incremented it.

**Correction (2026-09-18, before implementation): `createIfNotExists` is the wrong
primitive for this**, verified directly against Sanity's own mutation API reference
rather than assumed from its name: `createIfNotExists` succeeds identically whether it
created a document or found one already there — it reports no create/no-op distinction
at all, so a caller cannot use it to tell a genuine first vote from a duplicate. The
mutation that does distinguish them is the plain `create`, which **fails the whole
mutation with an HTTP 409 Conflict specifically when a document with that `_id` already
exists** (confirmed against Sanity's documented behavior for `create`, separately from
its documented use for optimistic-concurrency conflicts on a revision-guarded patch —
the two share one status code for a different reason each, and this vote endpoint never
sends a revision-guarded patch, so a 409 here can only mean the receipt id already
existed).

The vote endpoint therefore performs, in order:

1. Reject if the poll is unknown, the option is unknown, or `now() >= poll.closeDate`.
2. Attempt a plain `create` for `{_id: "pollVote-<pollId>-<visitorToken>", _type: "pollVoteReceipt", pollId, optionId, votedAt}`, sent as its own isolated mutation request (not batched with the tally increment, so its own success/conflict status is unambiguous).
3. **A 2xx response means this request created the receipt — proceed to the atomic `inc()`.** A 409 response means the receipt already existed — the request is a duplicate by definition; skip the increment and answer exactly as if the vote had just succeeded, so a client cannot distinguish a genuine first vote from a harmless retry of one it already made. Any other non-2xx status is a genuine failure and the vote is refused, not silently treated as a duplicate.

A plain `create` is atomic at the document-id level: of two concurrent requests naming
the same `_id`, Sanity's transaction guarantees exactly one succeeds and the other
receives the 409 — which is precisely the "first request wins, everyone else is told so"
signal dedup needs, with no separate lock, queue, or read-then-decide step.

**What is verified and what is not:** the `create`-fails-with-409-on-existing-id behavior
is Sanity's own documented contract, not this project's assumption. What is *not* yet
verified is this exact deployment's live provider behavior end to end (the same posture
ADR-0014 §8a's presigner already states for its own primitive) — an owner-run check
against a real dataset, alongside `docs/sanity-setup.md`'s existing live-verification
tooling, is recorded as an Action Item below rather than assumed passing.

### 5. The cookie is a UX convenience, not the dedup mechanism

A functional, per-poll cookie (its value is the `visitorToken` the receipt id is built
from) lets a fresh page load tell the server which state to render — the vote form for a
first-time visitor, or the results for one who already voted — without the client having
to remember and resubmit anything. It is not what stops a double vote — the receipt is.
Losing the cookie (a new browser, clearing site data) only means the visitor sees the
form again; the receipt still refuses to double-count if they vote again with the *same*
token, and a genuinely new token from a genuinely different browser is treated as a new
voter, which is the accepted, stated limitation, not a defect: anonymous, un-authenticated
dedup has no stronger answer available at all without login or fingerprinting, both
explicitly out of scope.

**Correction (2026-09-18, UI slice): voting requires JavaScript, matching
`ContactForm`/`EnquiryForm`'s own accepted trade-off, not "progressive enhancement over a
no-JS baseline."** An earlier draft of this record claimed the opposite — that a
scriptless visitor could still submit a vote — copied from this project's stated pattern
for the *gallery continuation link* (a real `<a href>`, genuinely no-JS) without checking
that `SubmissionForm` (the shared machinery `ContactForm`/`EnquiryForm` are built on)
actually disables its submit control until hydration (`src/components/submission-form.tsx`),
because both endpoints accept only `application/json`, a content type a native HTML form
cannot produce. The poll-vote endpoint has the identical constraint for the identical
reason, so `PollBlock` follows `SubmissionForm`'s exact pattern rather than inventing a
second one: the vote button is `disabled` until the client has hydrated, and `method`/
`action` on the form exist only so an unexpected native submit still lands on the same
JSON-only endpoint (answering `415`) rather than leaking fields into a GET query string.
This is also what closes the double-click gap the Consequences section below names:
`SubmissionForm`'s own `submitting`-state re-entry guard means a second click before the
first request resolves is a no-op, not a second request.

**Why this does not need a cookie banner:** the EU ePrivacy rule (and GDPR's
consent basis for cookies) exempts a cookie "strictly necessary" for a service the visitor
explicitly requested — the canonical example given in regulatory guidance is exactly
"remembering that a user has already voted in a poll." This cookie carries no identity,
no cross-site or cross-poll value, no analytics or advertising purpose, and is read only
by the one endpoint that set it. AGENTS.md's "no tracking cookies… goal: no cookie banner"
rule is a rule about *tracking* cookies; this is the first cookie the project ships, and
it is deliberately the kind that rule was never written to forbid. `docs/contact-data-flow.md`'s
sibling document for this feature (see Action Items) states this reasoning where a visitor
or a future privacy review will actually look for it, rather than leaving it implicit here.

### 6. Migrated legacy polls are ordinary closed polls, not a special case

An AB#137-migrated poll is a `poll` document with `closeDate` in the past and a
`pollTally` pre-populated from the real historical counts already recorded on AB#26.
Nothing downstream needs to know a poll is "historical" — the same `now() >= closeDate`
read gate that closes a brand-new poll the day after it launches also closes one that was
already closed the day it was written. This is the same economy of mechanism ADR-0017's
`endDate` already banked: one gate, checked once, with no second code path for "this one
was always closed."

### 7. A new write credential, honestly scoped

`POST /api/poll-vote` needs to write to Sanity from a public, anonymous request — a
capability ADR-0006's boundary was never built for (it is a **read** boundary) and no
existing credential grants (`SANITY_SEED_TOKEN`/`SANITY_MIGRATION_TOKEN` are both
owner-run and temporary; `SANITY_READ_TOKEN` cannot write at all). A new
`SANITY_POLL_VOTE_TOKEN` is minted for exactly this.

**Correction (2026-09-18, security review before merge): the type-scoped grant this
section originally described may not be obtainable.** Sanity's document-type-scoped
custom roles — the mechanism that would let a token create/patch only `pollTally` and
`pollVoteReceipt` and nothing else — are a **Growth-plan-and-above** feature (verified
against Sanity's own role documentation), not available on the Free plan. This project's
Sanity plan tier is not recorded anywhere in this repository (ADR-0004 fixes the Vercel
tier, not Sanity's), so whether that grant is achievable is presently unknown, not
assumed true. If it is not, `SANITY_POLL_VOTE_TOKEN` must in practice be a full
dataset-wide **Editor** token — the same power as `SANITY_MIGRATION_TOKEN` — except that
token is owner-run and temporary, while this one is a **long-lived runtime credential
sitting behind a public, unauthenticated, anonymous-write endpoint**. That is a
materially larger blast radius than "create/patch two document types," and this record
must say so rather than repeat the narrower claim as settled.

**The actual safety boundary, if a scoped role is unavailable, is the application code,
not the credential.** `poll-vote-sanity.ts` never takes a document id, type, or mutation
shape from the request — `pollTallyDocumentId`/`pollVoteReceiptDocumentId` derive every
id from a validated `pollId` and the visitor token's own canonical-encoding check
(§4 above), and the two mutation bodies it ever sends are hardcoded to exactly the
`pollTally`/`pollVoteReceipt` shapes. A malicious request cannot redirect a write to an
arbitrary `_id` or `_type` regardless of what the credential itself is permitted to
touch — so even with a full Editor token, *this code path* stays narrow. This is why
§8's action item below moves the ESLint import restriction from "recommended" to
required: the code being narrow only holds while it stays the *only* code that can reach
this credential, which the restriction enforces rather than assumes.

It is a long-lived **runtime** credential (unlike the seed/migration tokens), which
raises its stakes rather than lowering them: `docs/sanity-setup.md` documents it with the
same care as every other credential in that file, and it is added to the
`NEXT_PUBLIC_` refusal list this project already enforces for every server-only secret.

### 8. The write path stays behind an import boundary, not just a `server-only` marker

Added at the same 2026-09-18 review that produced the correction above. `server-only`
stops a Client Component from reaching `poll-vote-sanity.ts`; it does nothing to stop a
future **Server** Component or another route from importing `createPollVoteReceipt`/
`incrementPollTally` directly and calling them without the rate limiter, the origin
check, or the eligibility decision `/api/poll-vote` wraps around them — precisely the
"a route doing this itself could get the order wrong" risk ADR-0014's private-gallery
mint path was built to make structurally impossible, missing here until this correction.
`src/lib/poll-vote-access.ts` is the one facade a route may import — mirroring
`private-gallery-access.ts`'s role exactly — and `eslint.config.mjs`'s
`no-restricted-imports` rule now names `@/lib/poll-vote-sanity` so nothing under
`src/app/**`/`src/components/**` can reach the raw writes any other way. This is what
makes Decision 7's "the code path is narrow" claim an enforced property rather than a
convention a later change could quietly break.

## Options Considered

| Option | Verdict |
| --- | --- |
| Vote counts as a field on the `poll` document itself | Rejected — a Studio publish of an unrelated edit (fixing a typo in the question) would silently overwrite the draft's stale copy of live counts over the published counts, or vice versa, the moment an editor published. |
| A new external counter/KV service (Vercel KV, Upstash Redis, …) | Rejected — no stated need strong enough to add infrastructure and cost for one small feature; violates "minimal dependencies." |
| Wait for the private-gallery Postgres store (ADR-0014) to be provisioned | Rejected — ties an unrelated feature's launch to infrastructure with no schedule of its own, for no shared benefit (a poll tally has nothing in common with a private gallery's access model). |
| Dedup by cookie alone | Rejected — not atomic; a retried request or two concurrent requests before the cookie round-trips back to the server both double-count. |
| Dedup by IP address | Not chosen — the owner's stated decision was a cookie; IP is also a weaker signal behind shared/NAT'd connections and carries its own privacy weight this project has consistently avoided elsewhere. |
| A read-modify-write counter (`get` then `set`) | Rejected — loses updates under concurrent votes, the exact failure mode `inc()` exists to prevent. |

## Trade-off Analysis

Choosing Sanity itself as the vote store costs a small amount of write latency and puts
poll traffic through the same Content Lake every other read already depends on, but it
buys zero new infrastructure, zero new operational surface, and reuses a credential
pattern (a purpose-scoped token, documented in `docs/sanity-setup.md`) the project already
has three working examples of. The atomic-`inc()` + create-and-check-409-receipt pair
costs two Sanity round trips per vote (one create attempt, one conditional increment)
instead of one, in exchange for correctness under concurrency that a single write cannot
offer. The cookie costs nothing infrastructurally and is the weakest link in the whole
chain by design — accepted because a stronger anti-abuse mechanism (login, fingerprinting)
costs far more in user friction and privacy posture than this project's own stated
priorities (MVP simplicity, privacy by default) are willing to spend on a hobby-blog poll.

## Consequences

- This is the first public, anonymous-write path into the Sanity dataset. Every future
  reviewer of `docs/sanity-setup.md` or ADR-0006 needs to know a second, narrower write
  boundary now exists alongside the owner-run ones — this ADR is that record.
- `pollVoteReceipt` documents accumulate forever, one per distinct voter per poll, with
  no stated retention or deletion policy. This is a real, open gap this ADR does not
  resolve — flagged in Action Items rather than silently left undocumented.
- A vote cast in the instant before `closeDate` is honored; there is no retroactive
  tie-break or grace window. `closeDate` is a simple, one-sided gate, matching ADR-0017's
  own `endDate` precedent exactly.
- A visitor who clears cookies or switches browsers can vote again. This is accepted and
  documented, not a defect to be fixed later by a stronger identity mechanism — doing so
  would conflict with this project's privacy-by-default posture. **This has a sharper
  edge than "casual double-voting" alone (added 2026-09-18): the same mechanism lets a
  single motivated actor inflate a *publicly displayed* result at whatever volume the
  shared rate limiter permits, since nothing ties a token to a real person.** Displayed
  poll counts are informal and indicative, not tamper-resistant, and nothing in this
  feature should be read as claiming otherwise — see also `docs/poll-data-flow.md`.
- **A double-click, or any near-simultaneous duplicate submission, from a browser with no
  `poll_voter` cookie yet, could double-count if nothing else prevented it (found
  2026-09-18).** Two concurrent requests each mint their *own* fresh random token —
  nothing ties them together before the first response's `Set-Cookie` reaches the browser
  — so both would create distinct receipts and both increment the tally. The atomic
  409-dedup in Decision 4 only protects reuse of the *same* token; it does nothing for
  this ordinary UX case on its own. **Resolved by Decision 5's correction, not by this
  route**: `PollBlock` reuses `SubmissionForm`'s existing `submitting`-state guard, which
  already makes a second click before the first request resolves a no-op — the same
  mechanism that already protects the contact and enquiry forms from the identical class
  of double-submit.
- **A receipt created but its tally increment failing leaves the two counts silently out
  of step, with no reconciliation path (added 2026-09-18).** `attemptPollVote`
  (`poll-vote-access.ts`) performs the receipt create and the tally increment as two
  separate Sanity requests, not one transaction spanning both. If the first succeeds and
  the second then throws, the route answers a generic retryable `failed` with no cookie
  set (the response never reaches the cookie-setting code), so a client retry mints a
  *new* token and creates an entirely separate receipt. The original voter still ends up
  counted exactly once via that successful retry — this is an accounting-integrity gap,
  not a way to gain extra votes — but the first, orphaned receipt has no matching tally
  entry, and total receipts can drift ahead of the tally sum forever. No repair job
  exists; this ADR accepts the gap rather than building reconciliation for what is
  expected to be a rare failure mode.
- `docs/security-privacy-review.md` (AB#117) will need to account for the new credential
  and the new cookie the next time it runs, since both post-date its last review.

## Action Items

- Add `SANITY_POLL_VOTE_TOKEN` to `docs/sanity-setup.md` and the `NEXT_PUBLIC_` refusal
  list, scoped as narrowly as Sanity's role model permits at token creation. **Done
  2026-09-18**, honestly: `docs/sanity-setup.md` now states the Growth-plan dependency
  from Decision 7's correction rather than assuming a scoped role is available.
- **Done 2026-09-18**: `@/lib/poll-vote-sanity` added to `eslint.config.mjs`'s
  `no-restricted-imports`, reached only through the new `src/lib/poll-vote-access.ts`
  facade (Decision 8).
- **Done 2026-09-18**: `readPollSnapshot` fetches `[0...2]` and throws on two published
  documents claiming one `pollId`, mirroring `sanity-article.ts`/`sanity-gallery.ts`'s
  own identity-ambiguity guard.
- **Done 2026-09-18**: the vote body reader enforces a closed field allow-list
  (`pollId`/`optionId` only), matching `readContactSubmission`'s own whitelist rule
  instead of silently ignoring an unrecognized field.
- **Done 2026-09-18**: the route's cookie parser unwraps an RFC 6265 quoted value, so a
  quoting proxy or client no longer silently mints a fresh token on every request.
- **Done (UI slice)**: `PollBlock` mitigates the double-click double-count gap from
  Consequences above by reusing `SubmissionForm`'s existing hydration/submitting guard
  (Decision 5's correction) rather than inventing a poll-specific mechanism.
- Owner-run, at provisioning time: determine whether this project's actual Sanity plan
  supports document-type-scoped custom roles, and mint `SANITY_POLL_VOTE_TOKEN`
  accordingly — a scoped role if available, a plain Editor token with the risk from
  Decision 7 accepted if not. Record which one was actually minted in
  `docs/sanity-setup.md`.
- Owner-run: verify the receipt `create`'s documented 409-on-existing-id behavior against
  a real dataset with the actual write token, the way ADR-0014 §8a's presigner names its
  own live-provider gate — this ADR verifies the mutation's specification, not yet this
  deployment's live behavior.
- Write a `docs/poll-data-flow.md` processing record (mirroring
  `docs/contact-data-flow.md`) stating the cookie's name, purpose, duration, and the
  "strictly necessary" basis from Decision 5, plus what `pollVoteReceipt` stores and for
  how long.
- Decide and implement a retention or cleanup policy for `pollVoteReceipt` documents —
  unresolved as of this ADR. Until decided, receipts are kept indefinitely.
- Update `docs/adr/README.md`'s index with this record.
- AB#117's next re-run should evaluate the new credential and cookie against its existing
  acceptance criteria.


## Amendment 2026-09-18 — implementation completion and review

This scoped amendment supersedes Decision 2's receipt-ID/field shape, Decision
3's count initialization, Decision 4's two-request sequence, Decision 5's shared
cookie/UI implementation detail, and their matching Consequences/Action Items.
Sanity storage, separate authored content and tally, anonymous informal voting,
and the close-date gate remain accepted.

**Original rules preserved above:** create the receipt alone, then increment;
embed the raw token in its ID; share one `poll_voter` token across every poll;
rely on a submitting-state UI check; accept receipt/tally drift on partial failure.

**Evidence and replacement:**

1. Sanity `inc` fails for a missing bucket. The single vote transaction now
   contains receipt `create`, tally `createIfNotExists`, then one patch with
   `setIfMissing` for the **selected bucket** and `inc`. The bucket uses quoted
   bracket notation, so `24-mp` and other valid option IDs work. Counts are
   never read and rewritten. [Sanity patch reference](https://www.sanity.io/docs/content-lake/http-patches).
2. The receipt and increment belong to **one transaction**. A 409 duplicate
   aborts all mutations; a failed increment cannot leave an orphaned receipt.
   This closes the previously accepted accounting gap without a repair job.
   [Sanity transaction reference](https://www.sanity.io/docs/content-lake/transactions).
3. A fresh token minted only inside POST cannot survive a lost first response.
   The UI first prepares a cookie with protected
   `GET /api/poll-vote?pollId=…&prepare=1`, then sends the unchanged two-field
   POST. Preparation requires `X-Poll-Prepare: 1`, with no permissive CORS.
   An ordinary GET does not set cookies; an unprepared POST returns 409 and
   writes nothing. Successful POST refreshes the established cookie.
4. Every poll now has its **own cookie and independent token**. Its name is
   `poll_voter_<32-hex poll-id digest>`; its path is `/api/poll-vote`, lifetime
   one year, `HttpOnly`, `Secure`, `SameSite=Lax`, host-only. This replaces the
   shared-token detail and meets the original no-cross-poll-tracking requirement.
5. Receipt ID is `pollVote-<SHA-256 of JSON [pollId, token]>`, below Sanity's
   128-character document-ID limit and carrying no raw browser token. Its sole
   field beyond ID/type is `pollId`; option choice and timestamp are unnecessary
   for dedup. This matters because a public dataset exposes its documents even
   without a Studio schema. Poll and option identities are bounded at 64 chars;
   question/label at 500; options at 2–10. Date, ID, uniqueness and nonnegative
   integer counts are validated at runtime, independently of Studio.
6. `PollBlock` renders public results on the server. The client refreshes
   cookie-specific state using fresh GET, retains a successful acknowledgement
   if a subsequent read fails, and offers retry. All application labels ship in
   English/Finnish. Voting requires JavaScript. `useSubmissionGuard`, extracted
   from the message form's hydration/submitting convention and strengthened
   with a synchronous ref lock, is shared by `SubmissionForm` and poll UI.
   Focus moves to user-initiated outcome feedback, not on the initial read.
7. `convert:joomla --poll-results <legacy-poll-results.tsv>` resolves the original
   `{CONTENTPOLL id=N}` marker in source order and includes the closed poll/tally
   pair in the approved plan. The imported `1970-01-01T00:00:00Z` close date is an
   **already-closed sentinel**, not an invented historical closing date. Source
   counts and totals are checked, and poll/tally content enters the resolved
   approval digest. Conversion policy is now v2 and import plan v3; earlier
   approvals/plans must be regenerated and reviewed. The writer permits only
   matched historical pairs and writes them before article references.

**Remaining limits:** a visitor can clear/expire cookies or change browsers;
independent first-time preparations in different forms or tabs can race. One form's
concurrent submissions and retries with an established token are deduplicated,
not a person's identity. The process-local throttle is best-effort only.
Receipts currently have no automatic cleanup. Actual credential provisioning,
provider verification and production migration remain owner-run launch checks.
Eligibility is checked before the transaction; concurrent editorial changes
between the poll read and the write are not protected by a revision guard.
WebKit cookie-based journeys use a documented test-only HTTP transport
adaptation: the real `Secure` wire attribute is asserted, then its actual token is installed
as a test-only HTTP cookie so WebKit can use the harness's plain-HTTP loopback origin.
No application cookie security is relaxed.

The processing record is [poll-data-flow.md](../poll-data-flow.md). Sanity is an
external processor even when its account is owned by the photographer; a random
browser token is pseudonymous, and its functional purpose alone does not prove
an exemption from consent. The record states the narrow necessity basis.
