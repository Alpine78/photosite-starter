# Feature implementation status

Older entries are also kept verbatim in [the October 2026 archive](feature-status-archive-2026-10.md); search both files.

Cleanup read-readiness source, 2026-10-24 — AB#399 **Active** (owner review/merge pending):
an explicit owner-run probe uses the real bounded export/Doc transport with synthetic
fixture coverage, private target/canary manifest and GET-only egress. It reports
capacity/known-copy measurements, always withholding deletion/activation readiness.
Default tests/CI exclude the live suite. No actual probe, canary creation, role change,
provider write or activation was performed; full-role/hosted acceptance remains
AB#395 / AB#392 **Active**. See [the probe runbook](client-gallery-cleanup.md#read-only-capacity-and-known-canary-probe-ab399).

Scheduled delivery cleanup, 2026-10-24 — AB#398 **Closed** (PR #615 merged),
parent AB#395 / AB#392 **Active**, dependency AB#397 (PR #614): default-off Production-only
authenticated daily worker now uses one full-readable non-cursor snapshot and strict
Doc reads to replan at fresh source/asset revisions. One private control arbitrates
publication, pending fencing and atomic source/unshared-image deletion plus receipt.
Observed shared/weak uses remain; drafts/releases, incoming gallery refs, malformed
evidence and changed policies block visibly. Bounded active cursor progress, hard
deadlines and uncertain-outcome reconciliation are fixture-tested. No proof timer,
legacy enrollment, new ZIP support, live write or activation. Full-read/image-role
breadth, controlled strong writers and hosted provider/race/capacity acceptance remain
open under AB#395. See [the runbook](client-gallery-cleanup.md).

Delivery cleanup enrollment, 2026-10-24 — AB#397 **Closed** (PR #614 merged),
parent AB#395 / AB#392 **Active**: default-off FI/EN Studio publication now reviews
finite-delivery cleanup consent, exact deadline/image set and latest private result.
Publication creates/CAS-updates or withdraws one deterministic private control atomically;
text edits preserve consent, policy edits require renewed review, all unenrolled
galleries (including new deliveries) require deliberate opt-in. Pending attempts are fenced by control revisions;
unknown results reconcile exact source/publication identity, including matching completion
receipts after immediate expired deletion. No customer/contact fields, editable control
schema, legacy/proof enrollment, new ZIP eligibility or live operation. The separate
worker is source-built in AB#398; hosted role/race/activation checks remain AB#395. See
[retention](client-gallery-retention.md#reviewed-enrollment-and-private-control-ab397).

Proof replacement publication, 2026-10-24 — AB#396 **Closed** (PR #613 merged):
the FI/EN Studio delivery action requires an explicit ordinary/replacement choice;
replacement publishes the revision-reviewed delivery and deletes the exact selected
proof gallery, draft, terms, selection, confirmed versions, notices, reminders and unused
images atomically. Target/shared images stay. The target must be available with a reviewed
deadline; unknown outcomes use read-only reconciliation, never automatic retries.
Native publication/scheduling is constrained for client/proof types; public story/gallery
scheduling stays. No new persisted mapping: the old proof link becomes unknown/404.
[ADR-0038 implementation](adr/0038-proof-selection-in-existing-sanity.md#replacement-deletion-amendment-2026-10-24)
records the concurrency and hosted activation limits. Proof creation stays indefinite.
AB#130 / AB#392 / delivery-only expiry work AB#395 remain **Active**.
PRs #610/#611 are merged; AB#393 / AB#394 are **Closed**. No live deletion or activation.

Delivery expiry defaults and cleanup requirement, 2026-10-24 — AB#392 **Active**, AB#393 **Closed**:
new Studio delivery drafts suggest an editable six-calendar-month UTC deadline from
creation, clamping the day to month-end, and stay paused. Existing/legacy documents and
indefinite proof defaults are unchanged. [Retention](client-gallery-retention.md) records
the owner-requested automatic image/whole-ZIP deletion after expiry and its safeguards.
AB#394 is the separate planner slice; the executor/enrollment/activation remain AB#395
**Active**. No files are deleted automatically. Hosted editor acceptance remains.

Proof gallery deletion and data flow, 2026-10-23 — AB#130 **Active** (ADR-0038 action
item 6): the Studio action **Delete proof gallery and its records** removes the gallery,
its draft and every private record in one transaction guarded by the terms revision, from
an inventory read fresh by deterministic IDs; it refuses unreadable, malformed, copied
(draft or release) or referenced records. Its image assets are deleted in the same
transaction unless another document uses one (owner decision 2026-10-24).
[proof-selection-data-flow.md](proof-selection-data-flow.md) records what is stored,
processors, logs and retention. Not yet: the owner's activation decision and the hosted,
live and privacy-notice checks.

Proof reminder customer stop, 2026-10-23 — AB#130 **Active** (ADR-0038 amendment
2026-10-23): `/client-proof/<handle>/reminders` shows no gallery data and a Stop reminders
button; the POST with the fragment key turns reminders off and deletes the address and
language, also while the gallery is paused, expired or replaced; opening the page changes
nothing. Not yet: the daily reminder sender (next slice), data-flow documentation and the
hosted check.

Proof reminder daily run, 2026-10-23 — AB#130 **Active** (ADR-0038 action item 5):
default-off `GET /api/proof-reminders` on a daily Vercel cron (`CRON_SECRET`) sends each
gallery's latest due reminder once — terms read first, a create-once claim guarded by
that terms revision, a final re-read that records `cancelled` on any change, a key that
must match its hash — in the customer's language with the selection and stop links and
Reply-To the owner mailbox. Fair progress via a private cursor and a 15 s start budget.
Studio lists failed or long-pending reminders and galleries with incomplete settings.
Not yet: the privacy notice naming the reminder, data-flow and retention documentation
(action item 6), the owner-run hosted check and activation.

Proof reminder language and settings, 2026-10-23 — AB#130 **Active** (owner decisions
2026-10-23, ADR-0038 amendment): the first-publication dialog records the customer's
language with the reminder (validated against the site's locales by the route) and starts
the selection link in it; a Studio **Reminder settings** action on a published proof
gallery switches reminders on or off and changes delay, address and language under the
loaded terms revision, recording `reminderResumeAfter` so a change waits for the next step.
Expiry and replacement only pause reminders. Not yet: the daily sender and the customer's
own stop link (next slice), data-flow documentation and the hosted check.

Proof selection reopen, 2026-10-23 — AB#130 **Active** (ADR-0038 decision 5): Studio
shows working selections read-only, and a confirmed one offers **Reopen selection**,
which patches the state back to `open` under the revision reviewed in its confirmation
dialog; versions and notices stay, the next confirmation becomes `v<n+1>`, and the
999-version limit disables it. Not yet: reminders, the data-flow and retention
documentation (action item 6) and the owner-run hosted check.

Proof selection photographer notice, 2026-10-23 — AB#130 **Active** (ADR-0038 action
item 4): after a committed confirmation the route emails the owner's contact mailbox from
the immutable version (job reference, totals, proof numbers and filenames) with the
idempotency key `proof-notice/<id>/v<n>`, then records the notice `sent` or `failed`; a
failed, unconfigured or lost email leaves it `failed` or `pending` and never undoes the
confirmation. Studio shows confirmed versions and notices read-only, with a list of
notices failed or pending over five minutes. No resend (owner answer 2). Not yet: the
reopen action, reminders, the data-flow and retention documentation (action item 6) and
the owner-run hosted check.
Proof selection page, 2026-10-23 — AB#130 **Active** (ADR-0038 action item 3, slice 3b):
with a `#select=` key in the proof link, the proof page shows per-proof select toggles
(`aria-pressed`, keyboard), the counts and extra-image total, a two-step confirmation
bound to the reviewed revision and the confirmed record with its proof list. Server state
only; lost, unknown or committed-but-unread writes are read back, never replayed, and
block changes until a read succeeds; a new key starts a fresh session; the language
switch keeps the key. FI/EN copy. `PROOF_SELECTION=fixture` gives the harness one
synthetic selection per key. Not yet: the photographer email and Studio notice list,
reopen and reminders.
Proof selection write route, 2026-10-23 — AB#130 **Active** (ADR-0038 action item 3,
server side): default-off `POST /api/proof-selection` with its own
`SANITY_PROOF_SELECTION_TOKEN` reads, saves (full set under `ifRevisionID`) and confirms a
selection for the holder of the selection key. Fresh Doc API reads for the gallery,
terms and selection; closed, replaced, unknown and wrong-key requests are one 404 before
any private read; confirmation creates the immutable version and its `pending` notice and
guards the selection and terms revisions in one transaction; a lost transaction answer is
reported as unknown. Recorded in the ADR-0038 implementation note. Not yet: the selection
page (3b), the photographer email and Studio notice list, reopen and reminders.
Proof replacement by the delivery gallery, 2026-10-23 — AB#130 **Active** (ADR-0038
owner answer 5): a proof gallery's optional `replacedBy` weak reference (Studio offers
only published client galleries, so no `_strengthenOnPublish` reaches the custom
publication route; clearing it unsets it on publication) makes the proof link answer
`307` to the referenced client gallery while exactly that document is available through
the delivery reader — also for paused or expired proofs. The redirect keeps one
configured `?locale=` and ends in an empty fragment, so the selection key does not follow
the customer to the delivery URL. A deleted target is ignored; legacy handles, a disabled
delivery adapter or another document owning the handle never redirect. Selection writes
will refuse a replaced gallery when the write path lands.
Proof page read path, 2026-10-23 — AB#130 **Active** (ADR-0038 action item 2):
default-off `PROOF_GALLERY_ADAPTER` serves `/client-proof/<handle>` read-only —
complete, uncropped proofs in authored order with their permanent numbers in the grid
and as the lightbox caption, FI/EN notices, exact UTC deadline. The reader mirrors the
delivery reader (proof-type discovery, fresh published Doc read, normalized snapshot
equality, measured assets, `privateOnly` refusal, short negative cache) and refuses
unnumbered or repeated numbers. The namespace gets the reserved-path hygiene, is
reserved against locale prefixes and excluded from analytics; the shared unlisted
slash redirect now uses the platform URL, fixing a self-redirect it could produce for
`/client-gallery/<handle>/` too. Not yet: selection (the `#select=` fragment is
ignored), the delivery-gallery replacement redirect (owner answer 5, needs a schema
link), notifications and reminders.

Proof gallery Studio publish action, 2026-10-22 — AB#130 **Active**: with
`SANITY_STUDIO_PROOF_GALLERIES=enabled` (off by default) the Studio lists and creates
proof galleries (generated handle, paused, indefinite) and replaces native publish with
**Publish proof gallery**, which sends the validated draft revision and, on the first
publication, the terms (closed currency list in minor units, reminder default 7 days,
address stored only with a reminder) to the publication route with the editor's token.
The route refuses a moved draft (`stale-draft`) and unrequested or missing terms; drafts
are validated without numbers. The selection link is shown once; **Create a new
selection link** rotates the key after a confirmation; a lost or 5xx answer is reported
as an unknown outcome with no automatic retry. Unpublish and delete are removed for proof
galleries. Only that Studio signs in with `loginMethod: 'token'`. Recorded in the second
[ADR-0038 amendment](adr/0038-proof-selection-in-existing-sanity.md). Not active: the
customer page, the selection route, reminder sending and an owner-run hosted check.

Proof publication route, 2026-10-22 — AB#130 **Active** (owner decision: option 1):
`/api/proof-gallery/publish`, off by default, publishes a proof gallery and rotates its
selection key with the **editor's own Sanity token** — `/users/me` proves a user session
and Sanity enforces permissions on every read and the one atomic transaction, so the
route holds no write credential. Exact-origin CORS for the Studio only, per-client limit
before the session check, per-gallery limit after it, independent server-side validation,
numbering from the published state (restated, with a parity test), AES-256-GCM key copy
bound to the gallery, key returned only after commit, closed-class logs. Recorded in the
[ADR-0038 amendment](adr/0038-proof-selection-in-existing-sanity.md). Not active: the
terms authoring, the Studio action (with `loginMethod: 'token'`) and an owner-run hosted
check come first.



Import path inventory and backlog map, 2026-10-22 — AB#391 **New**, AB#130, AB#377:
[the import path inventory](audits/ab391-import-path-inventory-2026-10-22.md) finds that
all four owner-photograph upload paths (Joomla migration, rally import and conversion,
client web images) go through `generatePublicDerivative`, which re-encodes every image
and strips all metadata; demo fixtures and ADR-0028's legacy delivery files upload bytes
unchanged. It lists what AB#391 has to change and leaves EXIF orientation and non-JPEG
sources as open implementation questions. The backlog map now records AB#390 closed,
AB#130's next owner decision (how the Studio publish action reaches a server route that
creates the encrypted selection key), AB#391 and the current AB#377/AB#160 items.

Vitest advisory fix, 2026-10-22 — AB#160 **Active**: scheduled audit run 1430 flagged
GHSA-qxg6-89mg-rqv8 and GHSA-xp26-3454-mjgp in the development-only `@vitest/mocker`.
Vitest moves to 4.1.12 (range `^4.1.12`); the lockfile refresh stays inside Vitest's own
toolchain, and the root's full and production-only audits are 0. See
[dependency security](dependency-security.md#2026-10-22-vitest-advisories-ab160).

Gallery section pointer hydration race, 2026-10-22 — AB#377 **Active**: CI run 1442
(mobile WebKit) failed `gallery-section-pointer` "dragging away cancels the link…"
waiting for the section row to hide. The reveal hook takes the scroll position at
mount as its baseline and hides only on a later downward scroll; the trace shows the
test scrolled about 170 ms after `load`, before hydration, so no scroll was seen. The
helper now repeats a downward scroll from the top until the row hides; assertions are
unchanged. 70/70 first-attempt runs (×5, every project; 10 project-specific skips).
CI run 1445's aborted `goBack` in `private-gallery-link` (inactive protected gallery,
AB#313 removal candidate) is recorded on AB#377 without a fix.

Per-request script nonce, 2026-10-22 — AB#390 **Active**: public page, retained
unlisted gallery and file-path responses carry `script-src 'self' 'nonce-…'
'strict-dynamic'` without `'unsafe-inline'`, generated per request in `src/proxy.ts`
from `src/lib/content-security-policy.ts`; the theme bootstrap reads the nonce, and
Next.js tags its own scripts. `next.config.ts` keeps the static policy as the fallback
for redirects, API, maintenance and the inactive private namespaces. A fixture-level
guard fails every journey on a reported CSP violation, and
`e2e/content-security-policy.spec.ts` checks the policy, the script nonces and a fresh
nonce per response on eleven page families. Production changes with the next manual
release.

Proof gallery schema, 2026-10-22 — AB#130 **Active** (ADR-0038 action item 1, first
part): `clientProofGallery` / `clientProofItem` with complete original filenames and
permanent proof numbers. `sanity/schemas/proof-references.ts` assigns numbers in natural
filename order from the published state only (additions above the high-water mark,
removed numbers never reused, a published proof keeps its image), and publication
validation requires exactly those numbers; handles stay unique across client, legacy
and proof galleries. Shared closed-shape checks moved to `closed-document.ts`. Studio
cannot create the type yet and never unpublishes it. Next: the publish action with the
private terms snapshot and selection key (server-side route), then the page.

Article-end keyboard filter hydration race, 2026-10-21 — AB#377 **Active**: the
desktop WebKit "keyboard filters preserve … current reading hash" flake recurred on main
run 1406 after #576. Its trace shows the URL hash empty for the whole 10 s wait with a
stable layout: only a reader gesture unlocks the reading-address tracker, and the
ArrowDown arrived before its listeners existed. The journey now repeats placement plus
one real key until the tracker answers, as `content-reading-address` already does; the
filter assertions are unchanged. 220/220 first-attempt runs (×5, every project).
Still open: run 1398's desktop WebKit `article-reading-position` locale case (heading
54 px off after reload). The hypothesis that the in-page language fallback hiding after
restoration caused it was tested by deferring the header marker and did not reproduce,
so no application change was made.

CSP nonce decision, 2026-10-22 — AB#390 **New**: the owner accepted the
[ADR-0011 amendment](adr/0011-security-response-headers.md) for a per-request script
nonce on public HTML. Production keeps `script-src 'unsafe-inline'` until AB#390 ships.

Keyword taxonomy proposal, 2026-10-21 — AB#55 **Active**:
[ADR-0039](adr/0039-keyword-taxonomy-and-ingest-boundary.md) (Proposed) decides the
taxonomy ADR-0012 treats as a black box: `keyword` and configurable `keywordCategory`
documents with an immutable ASCII `keywordId` of at most 40 characters (five ids fit
ADR-0012's cursor scope, so no digest is needed); Lightroom terms as Studio-only audit
data with a deterministic re-import and editor tombstones; the ancestor closure
materialized on the medium per AB#65's benchmark, with a resumable re-sync for moves;
rename, merge, retire and delete rules; article tags kept separate (AB#25); and a
public/internal boundary for named people. Questions that need AB#54's Lightroom evidence
are left open. No schema or code change; AB#56/57 wait for acceptance.

Owner decisions, 2026-10-22 — AB#130, AB#389, AB#390: the owner answered
[ADR-0038](adr/0038-proof-selection-in-existing-sanity.md)'s five questions (all
project members may see selections and prices; no resend path at first activation;
no deletion schedule; proof galleries indefinite by default; the delivery gallery
replaces the proof gallery through a link-and-redirect) and added an automatic customer
reminder (default 7 days, full selection link from an encrypted key copy, then every
30 days). The owner **accepted ADR-0038** the same day; implementation is next, in the
action items' slices, and production activation remains a separate decision. AB#389 (load-time shift from the in-page language
fallback) is **Closed** as kept by design. The CSP nonce work is AB#390 (**New**) with a
Proposed [ADR-0011 amendment](adr/0011-security-response-headers.md); no code changes
before its acceptance.

Mobile performance and CSP nonce study, 2026-10-21 —
[record](audits/performance-and-csp-2026-10-21.md): under a slow mobile profile (1.6
Mbit/s, 150 ms, 4× CPU) TTFB stays under 0.11 s and FCP about 1 s; LCP is 2.1–3.9 s on
image-led pages and 6.4 s on a gallery page, the case #577 and #580 change (remeasure
after release). Dropping `'unsafe-inline'` from `script-src` with per-request nonces is
now feasible because public HTML already renders per request; it needs a work item and
an ADR-0011 amendment, `style-src` keeps `'unsafe-inline'` for markup style
attributes, and nothing was changed.

Proof selection design, 2026-10-21 — AB#130 **Active** (design only): the
owner-reviewable design its acceptance criteria require is
[ADR-0038 (Proposed)](adr/0038-proof-selection-in-existing-sanity.md). Public,
externally watermarked proofs with permanent references in a separate unlisted
gallery type; terms, working selections and immutable confirmed versions under
private ID paths in the existing dataset (verified: Sanity never serves `_id`s
containing a dot to unauthenticated requests); a separate selection key carried in
the link's fragment and stored only as a hash; one narrow write path with
`ifRevisionID` toggles and a transactional, retry-safe confirmation; a photographer
notification recorded separately from the selection. No S3, PostgreSQL or new
service. Five owner questions are listed in the ADR; nothing is implemented, and
implementation waits for acceptance.

HTML validity, 2026-10-21 — AB#388 **Active**: html-validate 11.17.0 (standard
preset) over all 166 Production pages found three invalid patterns besides the
AB#384 description lists. The hero credit `figcaption` now comes last in its
`figure` (a figcaption must be first or last), with `z-10` on the text overlay so it
still paints above the caption. The article reading contents' no-script layout moved
from a `<noscript><style>` in the body to `@media (scripting: none)` in
`content-reading-layout.css` (verified to match with script disabled in Playwright's
Chromium and WebKit; supported from Chrome 120, Safari 17 and Firefox 113, so an
older browser with script disabled shows the inert bar). Poll results are a
`role="group"` with their existing name instead of a generic `div` with
`aria-label`. New structural assertions cover each fix, including the no-script
layout at 390 px.

Evening Production checks, 2026-10-21 — evidence for AB#86, AB#117, AB#132 and
ADR-0003 ([record](audits/production-checks-2026-10-21-evening.md)): axe in the dark
theme over 166 pages finds only the already-fixed AB#384 list structure; axe on
interactive states finds one search-count contrast issue (AB#387, #584); `Article`
structured data lacks `author` pending its separate decision; error pages still show
the known AB#132 empty shell; reduced motion, caching and variant-URL indexing match
their decisions; the PhotoSwipe launcher costs about 7 kB compressed per page and was
left as is.

Search count contrast, 2026-10-21 — AB#387 **Active**: an axe run over interactive
states on Production (lightbox open, menu open, contact errors, search results; light
and dark, desktop and Pixel 7) found one issue: the search result group's `(n)` count
was `text-muted` plus `opacity-80`, 4.07:1 in the light theme. The extra opacity is
removed, so the count uses the heading's contract-tested `text-muted`.
`e2e/site-search.spec.ts` now computes the rendered contrast of every count in both
themes (canvas-normalized colours, inherited opacity composited over the background)
and failed at 4.09:1 before the fix.

Lightbox reopen race and CI trace download, 2026-10-21 — AB#377 **Active**: the
remaining mobile WebKit "selected source, append, viewer…" failure (CI run 1372) is
explained by its trace: after Escape the previous PhotoSwipe viewer was still closing
and in the DOM, so the shared `openLightbox` helper saw "a dialog exists", never ran the
next activation, and waited out its focus check on the closing viewer. The helper now
waits for no dialog before opening. All 24 specs that use it pass on every project
(613 passed). `docs/deployment.md` records how to download a run's Playwright report
through the REST API's signed URL, since `az pipelines runs artifact download` needs
an interactive sign-in. Still open: the WebKit `content-reading-address` Back/Forward
case, now inspectable with the same download once it recurs.

Earlier automatic gallery continuation after scrolling, 2026-10-21 — AB#386
**Active**: owner decision after the afternoon Production checks, where a realistic
~1000 px/s read of a desktop justified gallery measured 0.12 CLS from appends that
re-flowed the open last row while in view. Automatic continuation keeps its one
viewport lookahead for a page that is only opened, and uses two viewports once the
document has scrolled (any scroll, recorded independently of loading state). Single
flight, the page limit, failure/retry and focus are unchanged.
`e2e/gallery-continuation-lookahead.spec.ts` sets the viewport from the measured
sentinel position and proves both distances, including no request in the 2–3
viewport band without scrolling and none beyond three after scrolling; it fails
against the previous rule. The CLS reduction itself is expected, not yet remeasured
on Production (manual deploys).

Afternoon Production checks, 2026-10-21 — evidence for AB#19, AB#117, AB#132,
AB#159, AB#160 and AB#255 ([record](audits/production-checks-2026-10-21-afternoon.md)):
415/415 legacy redirect rows pass; no third-party request, cookie or storage on 332
anonymous page loads; no load-time layout shift, one 0.12 desktop shift from a
justified gallery's open last row during continuation (left for an owner decision);
every keyboard focus stop on nine page types visible; no untranslated built-in
Finnish copy; the Studio `sprintf-js` exception still has no upstream fix before its
2026-11-19 review; the Next.js 404 issue is still open upstream. The
[failure-triage runbook](production-failure-triage.md) now covers `poll.vote` and the
event-less poll results read. Nothing in the CMS, configuration or deployment changed.

Bounded curated gallery image sizes, 2026-10-21 — AB#385 **Active**: owner
decision after a Production measurement (three 24-image pages: 3.4–3.9 MB of
gallery images at 1280@1x, 4.7–5.6 MB at 1440@2x, because every thumbnail
requested a full-viewport candidate). Curated gallery pages and the home
portfolio now declare `50vw` for masonry from 1280 px and, for justified, each
image's own `ratio × 512 px` bound (the 16rem row cap at 200% text); article-end
galleries keep `100vw`. The plan review moved the masonry threshold from 1152 to
1280 px (the page padding doubles at a 32px root) and replaced a panorama
fallback that would have declared more than its bound. The enlarged-root e2e
matrix (32px root, 375–2000 px, Chromium and WebKit) now measures all 24 images
and still finds no candidate narrower than its image; a new desktop check
confirms no column-sized image requests the 1536 px candidate any more. See
[gallery presentation](gallery-presentation.md#responsive-images-per-layout).

E2E flake root causes, 2026-10-21 — AB#377 **Active**: two full local suites
(CI settings, 4 workers, no retries) and isolated repeats produced traces for four
test races, all fixed in the specs without application changes.
`article-end-sections` "keyboard filters…" read the reading hash before focusing
the filter; focusing scrolls the filter into view, and the reading-address tracker
publishes the new chapter up to 500 ms later (`-1` read, `-5` after the filter
change). WebKit also animates the preceding ArrowDown scroll, and a focus during
that animation was scrolled back, leaving the filter off-screen. The test now
waits for the tracker to publish the arrow scroll's chapter, focuses, asserts the
filter is in the viewport, and snapshots only once the URL and the filter link
carry the chapter `currentReadingChapter` computes for the settled geometry (on a phone the filter sits below the narrative, the rule reports "outside" and the tracker keeps the address, which the test accepts; CI run 1397 failed on mobile WebKit before that).
`image-comparison` measured the image and slider boxes in two calls that straddled
a 54 px page movement; it now waits for the image to load and measures both in one
frame. Repeats: 48/48 and 72/72 across the affected projects.
`content-reading-address` "a reading fragment composes with an App Router section
change…" (desktop WebKit, 1/8 in isolation) turned the wheel right after `load`,
before hydration on the gallery page, so the observer never saw it and the hash
stayed empty; its helper now repeats placement plus one real wheel until the
observer answers (280/280 across three projects, 8×).
`gallery-masonry` "without JavaScript reads in result order…" (desktop Chromium,
about 7% in isolation: 1 column at 944/1280 px, or the first image outside its
item) measured after `domcontentloaded`, which without JavaScript can precede the
head stylesheets, so it measured the unstyled layout no visitor sees painted
(Production links every stylesheet in `<head>`). It now waits for `load`
(320/320, desktop Chromium + mobile WebKit, 10×).
Still open, not reproduced in isolation: the WebKit `content-reading-address`
Back/Forward case. Timeouts and an aborted
`goBack` in the second run coincided with other local builds on the same machine
and are not counted as evidence of a race. AB#377 stays Active.

WCAG findings from an axe audit, 2026-10-21 — AB#384 **Active**: axe-core 4.10.3
(WCAG 2.0/2.1 A and AA rules) over all 166 sitemap pages on Production, desktop
Chromium, found two issues and nothing else. Gallery captions below an image used
`text-subtle` on the figure's `--surface-muted` fill (4.43:1; 30 pages); they now
use `text-muted`, and the theme contract tests that pairing in every palette (it
fails for `text-subtle`). The service price list nested `dt`/`dd` two `div`s deep
with the note as a `p` (14 service pages); each package is now one `div` of `dt`,
price `dd` and note `dd`, laid out as before. A local axe run on the services
listing, two service pages and two below-caption galleries reports no violations in
desktop Chromium and mobile WebKit; `e2e/services.spec.ts` asserts the list
structure. No other visual change.

Above-the-fold image loading, 2026-10-21 — AB#383 **Active**: a read-only
Production check (Chromium, desktop 1280 px and Pixel 7) found the Largest
Contentful Paint element lazy-loaded on gallery pages without a hero, on the
service listing and on the mobile home page. A gallery page whose grid is its
first picture (no hero, no body, not a continuation page) now loads its first
four images eagerly, capped at the initial slice, so appended items stay lazy;
article-end and home galleries are unchanged. The first row of each service
listing (three on the default route, two on the localized one) and the home
introduction portrait load eagerly. Only the hero keeps the explicit `preload`;
React may add its own preload hints for these eager images, which the plan review
accepted as the intended early discovery. `sizes`, renditions and layouts are
unchanged; the deliberate `100vw` masonry/justified bound (AB#157/AB#373), which
makes desktop thumbnails request ~1536 px sources, is recorded here as an observed
trade-off, not changed. `e2e/eager-images.spec.ts` checks the hydrated attributes,
an in-place append, a continuation page, both listings and the portrait.
React's hints were measured in WebKit: no duplicate download for a single eager
image; a photograph repeated among the eager items (a fixture artifact) is fetched
twice while requests are held, so `gallery-layouts`' no-refetch check now picks an
item whose photograph no other eager image repeats.

Long one-word titles, 2026-10-21 (AB#382, Active): the Production reflow audit (320/375 px, 166 pages) found `/palvelut/haakuvaus/miljoomuotokuvaus` 11 px too wide at 320 px — its h1 is one 17-letter compound. About twenty h1 styles exist, so the fix is an inherited base rule (`body { overflow-wrap: break-word }` in `globals.css`), which only affects a word that cannot fit its line and leaves min-content sizes unchanged. A first version set it on `h1`–`h4`; CI showed that overrode the home page's inherited `overflow-wrap: anywhere` and widened its flex/grid parents at 320 px with 32 px text, so it moved to `body`. Also `min-w-0` on the two service-detail `<article>` grid items that otherwise grow to their longest word. `e2e/page-title-reflow.spec.ts` replaces the server-rendered title with a long single word (no JavaScript) and requires no horizontal overflow at 320 px on contact, services, a service, the story root, search, an article and a gallery; it fails without the fix.

Cookieless site analytics, 2026-10-19 — AB#371 **Active**: ADR-0037 is Accepted
([PR #534](https://github.com/Alpine78/photosite-starter/pull/534)) and the first
slice is implemented on `feature/371-site-analytics`: an opt-in
`SITE_ANALYTICS=vercel` adapter honored only on a production stage, loaded by
`SiteRoot` alone, with private/administrator/legacy namespaces excluded and event
URLs reduced to the pathname (`src/lib/site-analytics.ts`). **Off on every
deployment**: nothing is collecting until the owner sets the variable and enables
Web Analytics in the Vercel dashboard. Verification on a deployed site (CSP,
Proxy, storage, namespace exclusion) is recorded in
[the data-flow record](analytics-data-flow.md) once it has been done.

Production refresh, 2026-10-18 — AB#18/117/137 remain **Active**:
[the site and Studio publication audit](audits/ab18-production-refresh-2026-10-18.md)
records accepted main `33cb41a` deployed to the existing production site and
Studio after full exact-source CI #1230 passed. Provider aliases, artifact bytes,
FI/EN HTTP/security/cache checks and desktop/phone-size browser smoke passed.
This supersedes earlier notes that the hosted Studio was still on October 11.
Authenticated Studio editing, a physical iPhone check and broader launch and
recovery acceptance remain. The new client-gallery reader stays default-off;
no S3 service or legacy-gallery content change was introduced.

Merged integration checkpoint, 2026-10-17 — AB#302–312 **Closed**: the owner
accepted PRs [#453](https://github.com/Alpine78/photosite-starter/pull/453),
[#454](https://github.com/Alpine78/photosite-starter/pull/454),
[#455](https://github.com/Alpine78/photosite-starter/pull/455),
[#457](https://github.com/Alpine78/photosite-starter/pull/457),
[#456](https://github.com/Alpine78/photosite-starter/pull/456),
[#458](https://github.com/Alpine78/photosite-starter/pull/458),
[#462](https://github.com/Alpine78/photosite-starter/pull/462),
[#459](https://github.com/Alpine78/photosite-starter/pull/459),
[#460](https://github.com/Alpine78/photosite-starter/pull/460),
[#461](https://github.com/Alpine78/photosite-starter/pull/461),
[#463](https://github.com/Alpine78/photosite-starter/pull/463) and
[#464](https://github.com/Alpine78/photosite-starter/pull/464), merged in that order
with successful current-source CI checks. Main
[6389a92](https://github.com/Alpine78/photosite-starter/commit/6389a9293a331142e7c71ed54c51b23eab4e5f3a)
has exactly the tracked tree of previously verified integration source
[f218aaf](https://github.com/Alpine78/photosite-starter/commit/f218aaf437100879d670a8b219dd5703df09d97f).
The final source passed **7,150 tests in 315 files**, lint, production build and
diagram checks; the unchanged runtime retained the **84 FI/EN Chromium/WebKit
journeys**, four named established HTTP/Secure-cookie WebKit skips, and Studio
schema/type/build evidence from AB#311. PR#463 required a normal merge-base
refresh with no file changes; PR#464 then merged without another refresh.

AB#29/63/145 remain **Active**, AB#130 **New**. Historical per-slice Active and
pending-merge notes below describe preparation checkpoints, not their current
board state. The selected path needs no S3 or separate PostgreSQL service.
Merging the Proposed ADR-0035 does not accept its new-file exception or prove
whole-upload support. New-gallery ZIP delivery, account capacity/transport
verification, hosted Studio roles/editor verification and deliberate production
activation remain open. Existing legacy bytes, deadlines and public-file limits
are unchanged.

AB#316 / AB#29 remote whole-ZIP integrity, 2026-10-17 (**Active**, source only):
`verify:delivery-zip-remote` streams one canonical anonymous Sanity file GET,
checks the exact supplied byte count, SHA256 and asset SHA1, and never buffers
or saves the package. Its separate **1 GB local verification bound** covers
hundreds-of-MB objects without splitting and is no provider upload guarantee.
A closed declaration digest binds the technical result without echoing target
identities. The shared HTTP core preserves the existing legacy compiler,
receipts, 330-second deadline and **3 GB legacy declaration ceiling**. New CLI
results always state `readyToPublish: false`; ZIP format, eligible JPEG exports,
metadata suitability and manifest authority remain unproven. See the
[operator contract](deployment.md#read-only-whole-zip-cdn-byte-check-ab316).
This task awaits owner review and merge; it performs no upload or activation.

AB#304 / AB#145 optional offline availability planning, 2026-10-17 (partial, Active):
a new Node command creates private revision/digest-bound plans and verifies them
against supplied snapshots. Only three availability fields can enter its fixed
patch; ordered image membership and all other source content are hash-bound.
Canonical dates, strict bounded JSON, no-op/refusal cases, native schema/runtime
parity, private filesystem rules and actual Node CLI redaction are tested.
No authentication, live freshness claim, image-eligibility approval or remote
writer is implemented. Native Studio remains the ordinary editing workflow.
The [operator contract](deployment.md#optional-offline-availability-plans-ab304)
records explicit times and mandatory future-writer draft/revision checks.
AB#304 remains Active pending accepted merge; no CMS/production change.

AB#303 / AB#29 Sanity customer reads, 2026-10-17 (partial, Active): a separate,
default-off `CLIENT_GALLERY_ADAPTER` now serves native client-delivery documents
on `/client-gallery/<handle>`. Bounded strict non-CDN discovery plus a fresh Doc
API authority enforce publication, pause, deadline, web-image metadata and
schema parity, with one revision retry and no positive state cache. A bounded
10-second public-dataset miss cache reduces repeated absent lookups. Existing
legacy handles retain their own adapter/outcome and ZIP contract. New customer
pages reuse FI/EN labels, complete-frame images and keyboard lightbox controls;
new ZIP delivery remains unimplemented. No S3/Postgres, new dependency, live CMS
write, hosted deployment or production activation. See the [runtime contract](deployment.md#ongoing-unlisted-client-galleries-adr-0034).
AB#29/63/145/302/303 remain Active pending accepted merges/live follow-ups;
AB#130 remains New; optional availability planner AB#304 is Active.


AB#302 / AB#145 Sanity authoring, 2026-10-16 (partial, Active): a separate
client-delivery document and ordered image-item schema now support native
Studio editing with FI/EN labels, generated immutable 128-bit link identifiers,
explicit page availability and bounded localized text. Validation checks current
asset metadata, web-derivative dimensions/formats, neutral crop values and link
collisions across new/legacy records. Legacy importer fields and actions remain
read-only. The pause flag starts false and takes effect only through native
publication. Studio validation does not enforce direct API writes; the AB#303 runtime
revalidates on fresh reads. No ZIP field, new service, production/CMS change or
hosted Studio deployment. [Authoring instructions and remaining verification](../studio/README.md#ongoing-client-galleries-ab302--ab145).
AB#314 adds an offline one-image preparation command with the existing Sharp encoder: complete static JPEG/PNG/WebP/AVIF exports become metadata-stripped web copies at most 2048 pixels, without enlargement or cropping. A new private local directory contains only a neutral filename and technical receipt; source bytes are unchanged. Animation, malformed input, unsafe/Git-visible paths and local 25 MB/100 MP input bounds fail closed. This neither approves source eligibility nor uploads/publishes anything; AB#314 is Active awaiting review/merge.

AB#336 adds native Studio selection of already uploaded eligible web images:
one bounded query, ordered explicit choices and one native append preserve
existing editing/reordering and owner-authored alternative texts. The shared
publication predicate, fresh selected-asset checks and current-scope guard
refuse stale, read-only, restricted or changed additions. FI/EN native controls
have synthetic controller/schema/SSR and Chromium/WebKit keyboard-fixture
coverage; hosted roles, controlled React state and close focus remain unverified.
No uploader, new service, private-only reclassification, publication or runtime
activation is added. AB#336 is Active pending owner review/merge; see the
[Studio workflow](../studio/README.md#choose-several-existing-web-images-ab336).

AB#343 extends the existing Studio chooser with an optional exclusive UTC
upload-time cutoff and explicit Search action. Older already uploaded eligible
web images can be selected as an ordered batch without uploading duplicates.
Cutoff edits clear the previous result/selection, abort pending reads and await
another deliberate search; invalid or incomplete dates cannot query. Fresh asset,
scope and capacity checks still precede the single native append. The same
257-row query / 256-image retention limit applies, with native-editor fallback
for crowded same-minute uploads. No upload, new media policy, service or publication
is added. AB#343 is Active; hosted role/hydration/live-query acceptance remains
outside fixture evidence. See the [Studio instructions](../studio/README.md#choose-several-existing-web-images-ab336).

AB#145 and its parent feature AB#63 are Active; AB#302 is Closed after its accepted merge. The customer runtime is AB#303 above; optional offline availability tooling
remains AB#304. Earlier protected
work remains disabled under ADR-0034.

AB#308 / AB#29 actual-query contracts, 2026-10-17 (partial, Active): synthetic
fixtures now execute both the exported runtime GROQ and native schema-validation
queries with Sanity's official GROQ 1 interpreter. They verify dereference scope,
private-only exclusions (including other assets/malformed flags), optional-field
projection, bounded rows/items, repeated sources, raw draft/release identities,
legacy collisions and fresh pause/expiry precedence. The existing locked
`groq-js@2.0.0` is declared Studio dev-only; all 940 resolved package entries are
unchanged. Network access is blocked. These are local semantics checks, not live
perspective/permission/performance or CDN verification. No runtime service,
asset upload, new media exception or production activation. AB#308 stays Active pending accepted merge; its final source review is complete.

Current owner decision, 2026-10-16: [ADR-0034](adr/0034-ongoing-unlisted-client-delivery.md)
selects existing Sanity/unlisted delivery for ongoing client work, including
future galleries. Protected S3/Postgres work is no longer the deployment target;
PRs #446–#451 were closed unmerged, with branches retained. AB#29 remains
Active for the revised delivery scope; at that checkpoint AB#145 and AB#130
returned to New for the Sanity administration audit and a compatible
proof-selection design (later authoring progress is recorded above). Existing
protected code stays disabled pending a separate removal audit. New-gallery
creation/publication is not implemented by this decision. Earlier entries below
record history under the superseded protected target.

Expiry cleanup candidate planner, 2026-10-24 — AB#394 **Closed** (PR #611 merged), parent AB#392:
a pure, server-only module classifies enrolled new-delivery expiry using the existing
reader's validator and plans revision-bound image/optional whole-ZIP candidates from
complete caller-supplied evidence. Shared uses stay; copied, malformed, truncated or
stale evidence blocks. [Planner contract](client-gallery-retention-planner.md).
The planner itself adds no runtime IO, enrollment storage, mutation or schedule; every
result says `readyToDelete: false`. Its default-off runtime caller now lives in AB#398,
with enrollment in AB#397 and hosted acceptance/activation still **Active** under AB#395.

AB#306 / AB#29 finite page deadlines, 2026-10-17 (partial, Active): new
web-delivery pages now show their already validated deadline as a semantic
FI/EN UTC timestamp, preserving seconds and nonzero milliseconds. Host/browser
timezones do not change the cutoff. Indefinite and legacy pages gain no invented
date; fresh availability checks and the existing public-file notice are unchanged.
No CMS fields, provider service, upload, timer or retention worker are added.
This source slice remains Active pending accepted merge; no live activation.

AB#319 / AB#29 explicit whole-package preparation, 2026-10-17 (Active): a
local owner CLI builds one ZIP32 STORE package from an explicit ordered private
processed-JPEG selection. Original JPEG/metadata bytes stay unchanged and entries
receive neutral names. Bounded IO, exact overhead limits, private source/output
identity checks and a final receipt keep this separate from upload/publication.
The local 1 GB bound is not a provider/product limit. JPEG decoding, classification,
metadata approval and supported whole-file transport remain unproven; no legacy
package is invented and `readyToUpload` stays false. This source slice awaits
owner review. See the [local builder](deployment.md#build-one-whole-delivery-zip-offline-ab319).

AB#307 / AB#29 maximum-viewer verification, 2026-10-17 (partial, Active): a
development-only 256-occurrence fixture reuses two complete local web images
with distinct item identities and stable shared-source aliases. FI/EN journeys
exercise native-ratio rendering, middle/last-frame viewing, occurrence-specific
focus return, stop-at-end and scriptless output. This verifies the bounded viewer,
not 256 unique CDN files, provider latency/bandwidth or quota suitability. The
supported maximum and real/legacy readers stay unchanged; no asset is uploaded.
This source slice remains Active pending accepted merge; final source review is complete.

AB#29 offline source revalidation, 2026-10-16 (partial, Active): the owner tool
revalidates a selected saved upload-source report and its digest before reading
source files, then compares current JPEG/ZIP bytes and metadata with that plan.
It reuses unchanged bounded inspection, streams ZIP hashes and produces only a
redacted summary. It writes no files or remote objects and grants no upload lease;
watermarks and ZIP contents retain their explicit existing verification limits.

AB#310 / AB#29 offline whole-package integrity, 2026-10-17 (AB#310 merged;
parent AB#29 Active):
a read-only owner CLI verifies a bounded ZIP32 entry set, local/central headers,
STORE/DEFLATE data, CRC32 and exact ordered expected byte/SHA-256 manifest.
Private inputs, constant diagnostics and no extraction/network keep this separate
from any upload. JPEG eligibility/metadata, manifest authority, provider capacity,
new-file approval and remote verification remain open; `readyToUpload` stays false.
AB#315 adds a separate streaming CLI for whole packages up to a local engineering
bound of 1,000,000,000 archive/expanded bytes, with 64 KiB reads, bounded DEFLATE
processing and exact same-pass archive SHA-256. The original 100 MB buffered API
stays unchanged. An actual whole 105 MB synthetic archive and a high-ratio
expansion refusal exercise the larger path; packages are never split. This source
slice is merged (AB#315 Closed), not evidence of supported Sanity upload.
Per-read cancellation listeners are removed on settlement; a separate-process
probe checks retained buffers during a whole 105 MB audit, before it returns.
AB#332 (Active, awaiting review) makes its baseline and paused-read measurement
use one fixed GC → event-loop turn → GC sequence. The 8 MiB assertion and audit
runtime are unchanged. Current code retains 196,608 bytes in four concurrent
loaded controls; the pre-AB#315 runtime retains 100,253,470 bytes and still fails
the actual assertion. This corrects measurement timing, not a newly found runtime
leak; a committed Azure run remains to verify the CI correction.
See the [supported profiles](deployment.md#offline-whole-package-integrity-checks-ab310--ab315).

AB#301 Studio identity presentation, 2026-10-16 (partial, Active): the actual
Studio configuration now groups permanent technical identifiers at the end of
the form using native, initially expanded FI/EN-labelled controls. Shared-media
previews use authored captions/alternative text and show the actual language,
with explicit missing-description fallbacks and complete-frame thumbnails.
Canonical field names, validators, references and stored IDs are unchanged.
The application registry's active deployment is dated 2026-10-11, older than
PR #339's 2026-10-12 readable-preview merge. Hosted publication and authenticated
editor verification remain separate. Accepted AB#257/260 identity retirement still
needs current source reconciliation and the remaining alias/read/write/maintenance
and rehearsal integration; existing helper modules are inventoried in the
[Studio guide](../studio/README.md#editing-content). This partial change does not
close the stored-identity retirement outcome or modify the CMS.

AB#309 / AB#29 new ZIP contract, 2026-10-17 (proposal, Active):
[ADR-0035](adr/0035-unlisted-delivery-zip-proposal.md) proposes one complete,
public processed-JPEG ZIP in the existing Sanity dataset, separate from bounded
web previews. It records metadata/filename exposure, local and remote integrity
checks, shared-reference removal and verified provider limits. Owner acceptance
of the new-file exception, account capacity and supported upload evidence remain
open; no accepted hard rule, schema, runtime, legacy file or live service changes.

AB#250 Production availability readback, 2026-10-15: all 21 retained legacy
customer galleries are now observed published and reachable. An anonymous
published-perspective Production dataset query returned 21 `legacyDeliveryGallery`
documents (all `published == true`), 1,792 `legacyDeliveryImage` placements and
12 ZIP assets. Anonymous GETs to all 21 canonical `/client-gallery/<handle>`
routes returned HTTP 200 with image markup and Sanity asset URLs. Customers use
these direct links without `/admin` authentication. This supersedes earlier
not-yet-imported/not-yet-activated statements as current status; those dated
entries remain historical checkpoints. Image/ZIP byte integrity, attachment
delivery, old-link redirects, browser interactions, response-policy headers and
the remaining launch/privacy/recovery gates were not reverified by this pass.
No CMS, deployment or configuration mutation occurred. AB#250 was read as Active
and remains Active; page availability alone does not close the story. See the
[dated readback and its limits](audits/ab250-release-verification-2026-10-12.md#production-readback--2026-10-15).

AB#290 localized menu follow-up, 2026-10-15: the owner-approved two revision-bound Production SiteSettings navigation patches are published and verified against a complete post-revocation dataset snapshot; the temporary Editor was removed and rejected. The staged release renders the requested Portfolio, Palvelut, Tarinat, Blogi order in Finnish. Its English Stories entry instead appeared after Blog because the menu resolver recognized only the default-locale story-root path, while the Sanity projection supplied the current locale's path. This branch corrects that resolver contract and tests the Sanity projection through menu composition in both languages. AB#290 remains Active until the correction is merged, deployed and its desktop/mobile FI/EN destinations and controls pass the final browser check.

AB#290 navigation preparation, 2026-10-14: navigation can select a public category by stable identity, resolving its canonical destination independently for each locale. This supports the owner-requested Portfolio, Services, Stories, Blog order through SiteSettings while preserving the generated Stories submenu. Studio and adapter validation reject duplicate identities, invalid IDs and authored category paths. A revision-bound Production navigation plan is prepared separately; no CMS publication or hosted activation is implied. Validation passed: lint, 6,230 unit tests, production build and 23 Chromium/WebKit navigation journeys (three existing viewport-specific skips). The four destinations and keyboard activation were checked in FI/EN on desktop and mobile. AB#290 remains Active pending review, merge and approved configuration publication.

AB#250 whole-ZIP decision, 2026-10-14: the owner explicitly accepts using the observed Sanity upload path for the twelve unchanged retained ZIPs without written provider support so the site can launch today. [ADR-0028’s dated amendment](adr/0028-legacy-unlisted-gallery-continuity.md#scoped-amendment--2026-10-14-whole-zip-support-exception) preserves the original support prerequisite as history and limits its replacement to the approved source set. Complete source/CDN length and SHA-1/SHA-256 checks, intact attachment delivery and all other import/privacy/recovery gates remain. Fresh local rehashing and ZIP/backup CRC checks pass for 21 galleries, 1,792 JPEGs and 12 ZIPs; no customer upload or gallery publication has occurred at this decision checkpoint. AB#250/117/18 remain Active.

AB#279 approved article publication, 2026-10-13: [Eighteen actual provider batches, complete recovery/readback and public route evidence](audits/ab279-approved-article-publication-2026-10-13.md) confirm publication of 18 EN articles and 644 placements with removal of their 662 drafts. The immutable owner-approved scope passed all dry runs before writes and was submitted once per article; Finnish authored content, all 5,158 asset documents, polls/votes and unrelated documents/revisions were unchanged. One temporary Editor was deleted, metadata 404/token 401 verified, memberships restored and Viewer access retained. Published articles are now 28 FI/28 EN. All eighteen local production routes, actual FI alternates, sitemap and all 644 placements across 39 bounded pages passed; EN Blog is 200 locally and 200/noindex on the independently verified owned Preview. Preparation #388–#390 merged and AB#276–278 are verified Closed. AB#279 remains Active pending evidence PR merge; AB#280 separately updates the old Blog alias. Final deployed-source, ZIP/customer continuity, rollback and security/privacy acceptance remain open. Earlier preparation/publication entries below retain their historical pre-article state.

AB#274 approved CMS publication, 2026-10-13: [Provider execution, recovery, complete dataset audit and route evidence](audits/ab274-approved-locale-publication-2026-10-13.md) confirm publication of English Blog fields, five English services and the owner-requested FI/EN funeral prices. The exact eleven-mutation scope and six source revisions were preserved; one actual batch passed dry run and authored readback. All assets/unrelated content and article drafts were unchanged. Three sequential temporary writers (two pre-write failures) were revoked and refused with 401; original memberships and Viewer reads were restored. Seven real-content local production routes return 200; English Blog remains 404 until its article drafts are published. Reviewed #383/#385 passed CI and merged; AB#270/AB#273 are verified Closed. AB#274 stays Active pending evidence PR merge. Final deployed-source, article publication, whole-ZIP support and launch acceptance remain open; no promotion or DNS change. Earlier preparation entries below are historical.

AB#255 authenticated check, 2026-10-13: [Windows/WSL Studio FI/EN verification](audits/ab255-authenticated-studio-locales-2026-10-13.md) verifies ten editorial form families, native select keyboard operation and preference persistence. A disabled upstream language menu and boolean-input help were corrected in the two Studio worktrees. Root schema-header text, list preview localization/full-frame thumbnails and array screen-reader instructions still require work; both PRs remain Draft. Main 27d7252 integration and these corrections are published sequentially under the owner-confirmed PR repair exception; final-head CI is required. AB#255 remains Active; no CMS write or deployment.

AB#273 current release evidence, 2026-10-13: [Fresh recovery, provider and dependency observations](audits/ab273-current-launch-acceptance-evidence-2026-10-13.md) confirm the raw dataset still matches the preserved complete local recovery baseline. Current Production remains source `14b1af0` with dirty metadata; the prior exact Preview remains available with unknown cleanliness. Both source gates refuse. Root npm audit reports zero; Studio reports eight moderate dependency nodes for the unpatched sprintf-js advisory, with exposure/residual-risk acceptance still unresolved. Four independent release follow-ups prepare source attestation, guarded copy publication, all 415 legacy classifications and final acceptance ordering. No promotion, rollback, DNS/CMS mutation or final security/privacy acceptance. AB#273 and parent AB#18 remain Active.

AB#321 pagination-core preparation, 2026-10-18 (AB#363, Active): the owner accepted [ADR-0036 in PR#516](https://github.com/Alpine78/photosite-starter/pull/516) as the implementation basis. Optional resolved generic section identity now scopes the provider-neutral article-end continuation with SHA-256 of the end-gallery/section tuple, preserving the exact existing All scope and HMAC wire contract. A selected source must acknowledge its predicate, and every returned candidate/boundary must belong to it; a legacy source cannot silently widen selection to All. Synthetic 41-item reference tests filter before the bounded window and cover exact group sizes, cursor isolation, stale boundaries, empty/unassigned items and a literal existing All token. They prove the core contract, not production database filtering. Current Sanity/mock/route callers remain unfiltered. Catalog/schema/editor validation, database predicates, slug resolution, API/routes, localized accessible controls, browser journeys and an explicitly approved CMS change plan remain separate work. ADR acceptance must land before this dependent slice merges; AB#321 and AB#27 remain Active. No CMS, media, public query or deployment changed.
AB#19 canonical-host follow-up, 2026-10-18: [current Production verification](audits/ab19-canonical-production-verification-2026-10-18.md) binds the passing 415-row canonical-host report to before/after provider source-identity guards for `33cb41a` and four JavaScript-free FI/EN Chromium/WebKit fallback-notice checks. The complete report is attached to AB#19 and read back as equivalent JSON. This later pass completes the canonical-host/report steps left open by the earlier October 18 status correction; it does not claim artifact-byte verification or launch approval. AB#137's predecessor gate and owner acceptance remain open, so AB#19 remains Active. No mapping, CMS, DNS, configuration or deployment changed.

AB#20 storage foundation, 2026-10-18 (AB#362, Active): owner accepted 90-day browser-local article/locale/chapter/time retention, direct-anchor/native-history precedence and clear/disable controls. The [reading-position policy](article-reading-position.md) now records the accepted boundary. A deterministic injected storage module implements validation, expiry, bounded eviction, clear/disable and failure handling with Node-only tests. No browser call site uses it yet: restoration, localized controls, disclosure and production-build journeys remain under AB#20. No content, CMS, URL behavior or server storage changed.

AB#20 article continuity integration, 2026-10-18 (AB#364, Active): the owner-accepted local reading-position policy now connects the storage foundation to article-only deliberate chapter tracking, a bounded navigation-aware restore and localized clear/disable controls. Direct fragments, native history and new reader input retain priority; restoring adds no URL/history/focus change. [The policy](article-reading-position.md) and [privacy review](security-privacy-review.md#browser-local-article-continuity--2026-10-18-ab20--ab362--ab364) document device-local fields, retention/denial limits and the browser verification boundary. Gallery bodies remain nonpersistent. Owner acceptance/merge and deployment are separate; AB#20 remains Active.

AB#20 reading-position UI refresh, 2026-10-19 (AB#372, Active): following the owner's Claude Design "Tarina hi-fi" frames 01–05, the article contents list becomes the reading-position surface. On a wide screen the sticky side column shows percent read, a timeline of read/current/upcoming sections, the current chapter's expanded sub-headings with a "reading now" marker, and the remember switch with clear in its footer. Below 64rem a sticky bar under the site header names the current chapter, its section index and percent, and opens the same single navigation landmark as a modal bottom sheet. An automatic restore now announces itself with a bottom status offering the start of the story; it closes after eight seconds unless hovered or focused. Articles without headings keep the previous settings disclosure. Storage, restoration rules and gallery bodies are unchanged. The design's gallery frames (06–09) are a separate follow-up; their 4:5 portrait crop and 3:2 cover thumbnails are not adopted because they conflict with the no-crop rule.

Article galleries on phones, 2026-10-20 (AB#373, Active): following the owner's "Tarina hi-fi" frames 06–09 and design comments, a justified mini or end gallery below the first band shows one image per row at the full column width and native ratio (portraits bounded to 80svh) instead of a 12rem-high strip, and below 40rem an article's galleries run edge to edge. Landscape phones keep the existing equal-height justified rows. The design's 4:5 portrait crop and 3:2 cover thumbnails are not adopted (no-crop rule). The contents list's current-section dot no longer clips at the pane edge.

Selectable gallery continuation, 2026-10-20 (AB#374, Active): the owner asked for galleries to keep loading while scrolling. A third presentation field, `galleryContinuation`, is authored site-wide with a per-gallery override, like layout and caption placement: `endless` (default when nothing is authored) appends one bounded page at a time as the visitor nears the end until the gallery is complete, `automatic-then-button` stops after three pages and shows the control, and `button` keeps the previous behaviour. The real `?cursor=` link remains for no-script visitors and becomes a retry after a failure, which also stops automatic loading. Article end galleries inherit the site value. Studio shows the field after its next deployment; existing content needs no migration. See [gallery presentation](gallery-presentation.md#loading-more-images-ab374).

Speed Insights adapter, 2026-10-20 (AB#376, Active): `@vercel/speed-insights` 2.0.0 is wired as an off-by-default, production-only opt-in (`SITE_SPEED_INSIGHTS=vercel`) beside the AB#371 analytics adapter, rendered by the public shell only and reusing its URL scrubbing and namespace exclusion. The owner chose the free tier and recorded the decision as an [ADR-0037 amendment](adr/0037-cookieless-site-analytics.md#2026-10-20--speed-insights-as-a-second-independent-opt-in-ab376). It is not enabled anywhere: runtime storage/intake checks and the owner's no-banner assessment come first, and a banner requirement means removal. **Enabled on the reference Production deployment on 2026-10-20** after the runtime checks passed (no cookies or web storage, same-origin intake, scrubbed payloads, excluded namespaces silent) and the owner accepted the same residual consent position as Web Analytics; see [the record](analytics-data-flow.md#speed-insights-ab376).

E2E stabilization, 2026-10-20 (AB#377 / AB#375, Active): an inventory of the last 38 CI runs with an e2e step found a failure or flaky marker in 22. The dominant one, `gallery-layouts.spec.ts` "justified-below never selects a candidate narrower than the rendered image" (mobile WebKit 14 runs, desktop Chromium 9), raced hydration: a below-caption photograph's lightbox trigger renders as a passive `<div data-item-id>` until enhancement and as a `<button>` afterwards (so no inert control exists without script), and React recreates that subtree's `<img>`. The test scrolled the image during the swap; it now waits for the first trigger's enhanced form. The delayed-hydration journey is unchanged. 40/40 first-attempt passes (both layouts, desktop Chromium and mobile WebKit, 10 repeats, retries off). Remaining inventory under AB#377: `content-tab-fragment` delayed-hydration position (desktop WebKit), `content-reading-address` App Router section change (desktop WebKit), `gallery-section-pointer` (mobile WebKit) and `site-header-scroll` disclosure Escape (desktop Chromium).

Scheduled audit exceptions, 2026-10-20 (AB#380, Active): the daily dependency audit was red on the owner-accepted Studio `sprintf-js` chain (AB#160). `sanity` 6.20.0 keeps the chain, so the acceptance became a committed, dated exception (`scripts/npm-audit-accepted-advisories.json`, pure decision in `scripts/npm-audit-acceptance.mts`) bound to the advisory, the reviewed install paths and a severity ceiling, expiring 2026-11-19 00:00 UTC. Covered findings report `accepted` with gate 0 and stay in the redacted evidence; anything new or expired fails as before, and a malformed exceptions file is a tool error. See [dependency security](dependency-security.md).

E2E flake diagnosis, 2026-10-20 (AB#377, Active): `content-tab-fragment` "newer keyboard and programmatic position win before delayed hydration" (desktop WebKit) waited for `scrollY` to be exactly 0 after Home, but WebKit animates keyboard scrolling and can settle a few pixels short (reproduced 3/80, logged 5636 → 4902 → 2389 → 9 → 6). The journey now waits for the keyboard scroll to settle and checks it left the target before the programmatic position it actually asserts; 160/160 first-attempt passes. Three rarer flakes (`content-reading-address` App Router section change, `gallery-section-pointer` delayed press, `site-header-scroll` Escape-then-hide; 0/240 locally) have no failure evidence because CI published traces only for failed jobs and these passed on retry. CI now also publishes the report when a test was flaky, so their next occurrence keeps a trace; they stay open under AB#377 until then. A browser-free flake also turned up: `studio/existing-client-web-images.test.ts` "selects an older alreadyexisting set" evaluates the real GROQ query over 302 documents (~3 s alone) and hit Vitest's 5 s default under the full parallel suite; it now has an explicit 20 s limit with that reason, and the full suite passed 3/3.

E2E header root cause, 2026-10-20 (AB#377, Active): the `site-header-scroll` "an open disclosure stays visible with body focus and Escape closes it" flake was an application bug. Escape returns focus to the submenu (or compact menu) toggle in the sticky header, and when focus was elsewhere — `document.body` after a WebKit pointer activation — a plain `focus()` scrolled the page up by the header's scroll padding (~360–400 px at 1280×720, reproduced on production). That upward jump could reverse the direction of the journey's next scroll, so the header stayed shown. The submenu and compact-menu Escape handlers, and the search dialog's return focus, now use `focusInPlace` (`src/lib/focus-in-place.ts`): `preventScroll` when the control is already fully on screen, and a plain `focus()` otherwise, because the short-screen fallback makes the header static and an enlarged compact menu can scroll its toggle out of view (`header-reflow` keeps asserting that it comes back). The journey now also asserts that the main content's viewport position is unchanged across Escape (it failed every run without the fix; an in-flow compact panel legitimately changes `scrollY` as it closes, so the position is the invariant), 30/30 first-attempt passes on desktop Chromium and mobile WebKit. `content-reading-address` and `gallery-section-pointer` remain open under AB#377.

E2E admin sign-in root cause, 2026-10-21 (AB#377, Active): PR run 1348 (a README-only change) failed `restricted-page-locales` "authenticated server UI fi" on both attempts — `POST /admin/login` answered 401 with server log `errorClass: rate-limited`. The administrator sign-in has a deliberately global counter of 30 attempts per 15 minutes; the journey suite makes about 28 sign-ins per run, and since AB#378's four workers finish a run in ~13 minutes instead of ~20, those attempts now land in one window. Reproduced locally in one server process (admin + locale specs, two projects, repeated, four workers: 6 valid sign-ins refused, `rate-limited` logged). Fix: only the development-only `memory` fixture — published credential, refused outside the `development` stage — supplies a 1 000-attempt global cap (`PRIVATE_GALLERY_FIXTURE_ADMIN_LOGIN_RATE_CONFIG`) through the existing `rateConfig` seam; the default 30/15 min policy for real deployments and the per-address limiter are unchanged. A new route test signs in successfully after 35 failed attempts from distinct addresses (it fails without the fix), and the same reproduction passes 124/124 with no `rate-limited` line. Separately, flaky-but-green runs 1327/1332/1333/1336 each had one different mobile-WebKit retry (gallery-layouts masonry continuation, site-header-scroll pointer link, gallery-section-pointer automatic-scroll press, gallery-lightbox chrome surfaces); their published reports need an owner download (the artifact API refused this session's credentials).

E2E article-end hash race, 2026-10-21 (AB#377, Active): a local full-suite run with CI settings (four workers, no retries) caught `article-end-sections` "fi: keyboard filters preserve unrelated query, current reading hash and viewport" (desktop WebKit) with a trace. The journey snapshotted the URL hash as soon as it became non-empty after ArrowDown (`#…-1`); after the filter change it read `#…-5`. Screencast frames show the viewport unchanged across the filter change, with the table of contents only then marking chapter 5 as current, so the first hash was an intermediate value of the reading-chapter tracker, not a filter side effect. The journey now synchronizes on application state instead of time — it snapshots only once the reading contents mark a current chapter (`aria-current="location"`) and the URL hash equals that chapter's link (the address writer runs at most every 500 ms, so a time window alone could still accept an intermediate value); the filter assertions are unchanged. The whole spec passed 220/220 first-attempt runs (×5, every project). A second full-suite run passed 1 743/1 743.

CI quality-gate speed, 2026-10-20 (AB#378, Closed 2026-10-21): measured before changing anything (see [deployment.md](deployment.md#the-verify-stage-runs-on-a-self-hosted-agent)). End-to-end is ~85 % of the Verify stage and is bounded by worker parallelism; the second build costs ~6 s and stays. Playwright now runs with its own `ciE2eWorkers: "4"` (local CI-settings run: 805 s vs 1 183 s, 0 failed/flaky; six workers failed 9 tests), Vitest is unchanged, and main CI runs are batched. Coverage, retries, timeouts and every gate are unchanged. **After, 2026-10-21:** 18 comparable four-worker CI runs (1327, 1330, 1332–1336, 1338–1340, 1342–1347, 1349, 1350; 1328/1329 excluded because their PR merge refs predate the change and ran two workers) give a Verify median of ~981 s (−29 % from 1 391 s) and an end-to-end median of ~770 s (−35 % from 1 178 s); unit tests stay at ~75 s. All 18 succeeded; fourteen with no retry, and four needed one retry each of a different mobile-WebKit test. One other run (1348) failed because the faster suite packed its ~28 administrator sign-ins into one window of the fixture's global sign-in cap; that root cause is fixed separately under AB#377 (PR #562). **Batching, 2026-10-21:** 13 merges that landed during main run 1363 (#552–#563) were built as one run (1364) of the newest commit. **Vitest, 2026-10-21:** measured on the agent with CI settings, three runs each, all 8 527 tests passing — 2 workers 73.8 s, 4 workers 41.6 s, 6 workers 31.0 s; `ciTestWorkers` is now 4 (about 32 s per run), leaving headroom for the timing-sensitive suites.

Task bootstrap, 2026-10-20 (AB#381, Active): `npm run task:start -- <branch> [--no-install]` creates a new linked task worktree the way AGENTS.md "Branch publication and VS Code worktrees" describes: it validates the branch name, refuses an existing local branch, directory or checkout before changing anything, fetches, refuses an existing remote branch (and an unreadable remote state), applies the four repository-local defaults, adds the worktree with `--no-track` from `origin/main`, refuses a push URL that differs from the fetch URL, publishes create-only with the explicit same-name refspec (`--force-with-lease=<ref>:` with an empty expectation, so a branch that appeared on origin since the check is refused rather than advanced), confirms the remote ref is the start commit, and verifies top level, branch, upstream and that every ref update a plain `git push --dry-run` would make is that branch. It then runs `npm ci` for the root and Studio and reports what the primary checkout's local VS Code settings can and cannot show. A failed publication keeps the worktree with no upstream; a failed install reports how to resume in place. Decisions are in `scripts/task-worktree.mts`; tests include real-git cases against an isolated local bare origin. The command never touches Azure Boards. Found while building it: AGENTS.md calls `.vscode/settings.json` tracked, but `.vscode` is gitignored and the file exists only in the primary checkout; that wording is left for the owner (see the AGENTS.md slimming proposal).

Scripted production release, 2026-10-20 (AB#379, Active): `npm run release:production -- stage` / `promote --receipt … --confirm <dpl_id>` replaces the ~15 manual commands with the staged sequence in [deployment.md](deployment.md#scripted-release-ab379): clean exact `origin/main` with a passed main CI run, a complete alias baseline (split routing refused), rollback target recorded before deploy, `--skip-domain` prebuilt deploy with source metadata, strict candidate readback, alias comparison, 200-only sitemap-sampled smoke, and a promote step that requires the passed receipt of exactly the confirmed candidate, reads back routing and public domains, and always prints the rollback command. Decisions in `scripts/production-release.mts` (unit tests plus a fake-command harness for step order); IO in `scripts/release-production.mts`. Read-only parts were checked against the live alias inventory and sitemap; the first real staged release is the acceptance run.

AGENTS.md slimming, 2026-10-20 (AB#381, Active; owner approved the proposal on 2026-10-20): AGENTS.md loads into every agent session, so three rarely needed blocks move verbatim into referenced files — the documentation map table (`docs/documentation-map.md`), the operational and owner-run command catalog (`docs/owner-run-commands.md`) and the worktree retirement procedure (`docs/worktree-retirement.md`). AGENTS.md keeps a mandatory read-before trigger for each (before finishing any change; before running or changing an operational command; before removing a worktree), so no rule or condition is removed. 44.0 kB → about 32.5 kB. Hard-rule exceptions stay in AGENTS.md unchanged: they define when an action is permissible.

AB#321 article-end Sanity sections, 2026-10-18 (AB#365, Active): the optional generic catalog/heading and placement membership now have Studio publication guards, explicit bounded public projections and selected predicates before candidate/boundary windows. Offline actual-GROQ fixtures cover complete collection groups, locale membership, removal and legacy All tokens. Existing uncatalogued routes keep their old behavior. Public controls/URL/API integration and an owner-approved content batch remain separate; no CMS write, automatic translation or production filter activation. See [Sanity setup](sanity-setup.md#optional-article-end-sections-ab365). AB#27/321 remain Active.

AB#321 public article-end sections, 2026-10-18 (AB#367, Active): optional declared article catalogs now resolve localized section slugs before bounded pagination, canonical normalization and the strict append API. Reused real gallery filter links and viewer/grid guards carry unrelated query/current hydrated fragment, reset selected results and preserve controls through initial/continuation replacement. A single polite result state names the selection and loaded count without a collection total, with visible server-rendered copy before JavaScript. Selected first pages/continuations are noindex with parameter-free article canonical and no hreflang; legacy uncatalogued articles retain incidental query behavior. A separate bilingual interleaved mock collection supports 27 selected items over 24 + 3, short/empty/unassigned groups and independent body viewers; it does not classify live content. Article filter interaction overrides automatic local reading restoration without new stored fields. Local production-build verification passes 44 new Chromium/WebKit desktop/mobile filter journeys and the related regression matrix (294 passed, 24 pre-existing intentional skips). The interrupted Claude loop resumed on October 19. A stale catalog race now maps to HTTP 404 in the article page, metadata and append API, with three reproduced regression cases; single-image result copy is count-neutral in FI/EN. Final source-review and gate evidence are tracked in PR#523; this implementation remains Active until owner acceptance and merge. Owner acceptance/merge and concrete content activation remain separate; AB#321/27 are not closed. Concrete retained-content approval/write and rendered parity remain open.

AB#367 review follow-up, 2026-10-19: selected-section empty and completion messages name the section in both languages, including the grid footer, with sentence punctuation preserved. Hydrated selector links serialize their query without depending on `URLSearchParams.size`; regressions remove that getter and check selected/All links, repeated carried values and fragments. These corrections do not classify or publish CMS content. Current review, test and CI evidence remains with PR#523.

AB#368 adds an offline, first-adoption article-end section planner on the reviewed AB#365 contract. It pins supplied raw snapshot bytes/counts, checks selected identities, variants, public eligibility and reference closure, and emits private non-executable evidence only. The task remains Active pending review/merge; actual classification, owner approval, CMS activation and AB#321/27 acceptance remain separate.

AB#369 adds offline pre-write revalidation of an article-end adoption proposal against a second supplied manifest and capture. The baseline digest must match; only snapshot pins and a nondecreasing supplied observation time may differ. Complete scoped records, including advisory references, and all proposed changes must remain identical. Unrelated records may change. The private evidence is not approval, a capture, a writer or proof of live state. Task remains Active pending review and accepted merge; AB#321/27 remain open.

This is a running implementation history and a starting point for finding relevant
code and decisions. Read the part relevant to the task; the current code and the
Azure Boards work item are authoritative for scope, acceptance criteria and state.
The always-applicable agent rules remain in [`AGENTS.md`](../AGENTS.md).

AB#270 owner continuation, 2026-10-13: the owner accepted the category/five-service copy workbook with two requested funeral pricing additions in FI/EN. [The updated preparation record](audits/ab270-locale-publication-preparation-2026-10-13.md) binds that acceptance and the exact private additions. Additive source pricing now preserves existing entries and requires English key/price correspondence and revision-bound readback. A fresh full raw scan still matches the recoverable baseline. Copy acceptance is complete; concrete mutation-plan approval, provider validation, actual publication and writer revocation remain outstanding. No CMS write. AB#270 remains Active.

AB#270 locale publication preparation, 2026-10-13: [Guarded English publication operator](audits/ab270-locale-publication-preparation-2026-10-13.md) plans the reviewed category/service slice and existing approved article drafts against a complete raw baseline. Strict creates, revision guards, atomic article/placement sets, private receipts and exact digest approval precede writes. The eighteen article drafts and 644 placement drafts still match; actual article planning refuses the missing English category. Six-item copy approval, provider validation, publication, whole-dataset readback and writer revocation remain pending. No CMS mutation or deployment. AB#270 and parent AB#255 remain Active.

AB#255 release preparation, 2026-10-13: [Fresh language inventory and ordered release gates](audits/ab255-bilingual-release-readiness-2026-10-13.md) record #375 merged at f58be98, 18 existing EN article drafts, five still-missing service counterparts and one missing category EN pair. Two matching read-only metadata scans confirm published counts unchanged and all 18 drafts pending review; all six category/service proposal source revisions still match. #372/#373 are merged source, while Studio #371/#370 completion remains in separate prepared PRs. The private category/service review workbook is available in this release worktree. Final-head CI/review, copy acceptance, editorial/category review and separate hosting/publication authorization remain; no CMS write or deployment occurred. AB#255 remains Active.

AB#255 continuation, 2026-10-12: [Public bilingual editing proposals completed](audits/ab255-public-copy-completion-2026-10-12.md). This work is prepared on a separate branch; the story remains Active. General album-image captions and alt authoring are deferred until after MVP by the owner's explicit scope decision. Existing image text is preserved. Pending CMS copy acceptance, authenticated Studio checks and production activation must not be inferred from source validation.

AB#255 continuation, 2026-10-12: [Restricted page UI locale implementation](audits/ab255-restricted-page-locales-2026-10-12.md). This work is prepared on a separate branch; the story remains Active. General album-image captions and alt authoring are deferred until after MVP by the owner's explicit scope decision. Existing image text is preserved. Pending CMS copy acceptance, authenticated Studio checks and production activation must not be inferred from source validation.
AB#286 locale census correction, 2026-10-13: [Explicit story-root placement](audits/ab286-root-content-locale-census-2026-10-13.md) no longer produces false missing-category blockers in the offline publication census. Only boolean root=true with no category gets the existing routing exception; malformed flags, root/category conflicts, ordinary category prerequisites and editing/duplicate guards remain blocked. No CMS or routing change. Claude is unavailable until October 15; no external review or full AB#255 acceptance is claimed. AB#286 remains Active for review/merge.

AB#19 owner decision, 2026-10-13: the two inventoried `/sivustokartta/…` aliases now have explicit HTTP 410 rows in `fix/19-retire-sitemap-aliases`. The former hääportfolio redirect is removed; canonical content and ordinary blog redirects remain. Integration with merged PR #367 removes its earlier Fuji category fallback in favor of the owner's later explicit 410 decision, while retaining its Komento retirements, other route decisions and numeric-query tests. This is prepared source, not a production activation. Updated integration validation: lint, all 5828 unit tests, production build and 52 legacy/fallback Chromium/WebKit cases passed. Exact registry comparison preserves every non-sitemap decision from main `1e63b7e`. AB#19 remains Active.

AB#255 continuation, 2026-10-12: [Studio schema interface localization](audits/ab255-studio-schema-locales-2026-10-12.md). This work is prepared on a separate branch; the story remains Active. CI installation fix, 2026-10-13: the root test job installs locked Studio dependencies before the SDK contract tests. General album-image captions and alt authoring are deferred until after MVP by the owner's explicit scope decision. Existing image text is preserved. Pending CMS copy acceptance, authenticated Studio checks and production activation must not be inferred from source validation.

AB#255 continuation, 2026-10-12: [Default service aliases expose actual language siblings](audits/ab255-default-service-language-links-2026-10-12.md). This work is prepared on a separate branch; the story remains Active. General album-image captions and alt authoring are deferred until after MVP by the owner's explicit scope decision. Existing image text is preserved. Pending CMS copy acceptance, authenticated Studio checks and production activation must not be inferred from source validation.

AB#255 owner approval and CMS authoring, 2026-10-13: the owner accepted the complete 18-article FI/EN workbook and English editing-draft creation, then explicitly chose to omit historical FI polls only from the EN drafts. All 18 EN article drafts and 644 linked end-gallery placement drafts were created and verified against hash-bound plans. The 23 removed target poll blocks belonged to 16 articles; FI sources, placements, polls/votes, shared media, categories, asset counts and published articles remain unchanged. No publication occurred. A published EN canonical category and editor/media review remain publication dependencies; general album-image alt/caption authoring remains deferred. [The authoring receipt](audits/ab255-approved-article-draft-authoring-2026-10-13.md) also records an AB#125 planner correction for temporary draft-parent references. The accepted workbook and original receipts remain private in the preserved public-copy archive; write plans and verification remain private in the authoring worktree. AB#255 and AB#125 remain Active.

AB#255 Studio presentation completion, 2026-10-13: [Compiled type headings/help, localized document lists and full-frame list media](audits/ab255-studio-presentation-completion-2026-10-13.md) close the three authenticated #370 presentation findings. The pinned internal source/workspace bridge projects immutable display metadata; preview.prepare returns supported React media for list paths that bypass schema preview components. Actual FI/EN article headings, unchanged editor values, 31 localized placement labels in each language and 31 fit=max/zero fit=crop images were verified. The exact combined #371/#370 source passes all 5919 tests, lint, Studio typecheck/zero-error schema/build and Next production build. Merge #371 first; its current-main dd0732c source is included here with the configuration conflict resolved. Final-head CI and PR review remain; no content publication or hosted activation. General album-image caption/alt authoring stays deferred. AB#255 remains Active.

Current state: **MVP in progress.** Built: site settings mock layer, typed deployment
configuration, responsive header and footer, home page, services listing and detail
pages, a semantic design-token layer (AB#36) — the brand-sensitive colours, text
roles, borders, accent, focus indicator, type families, and corner scale defined once
in `src/app/globals.css`, consumed by shared components through static Tailwind
utilities, with explicit light/dark (`prefers-color-scheme` plus a `data-theme` pin,
`color-scheme` set), a documented override contract (`docs/theme-contract.md`), and AA
text/focus contrast enforced by `src/lib/theme-contract.test.ts` and `e2e/theme.spec.ts`.
That contract has since been **proved against a second preset** (AB#37): `editorial` is an
internal validation asset — deliberately unlike the default in ground, ink, accent, type
family and corner scale, selected by nothing the product ships — that exists so a claim
which was never true would fail rather than sit unread. Two did. The documented selector
`:root[data-theme="<name>"]` could not work, because `data-theme` already carries the
light/dark pin and one attribute cannot hold both an identity and a mode; presets are now
selected by **`data-preset`**, which is what lets one carry a dark palette at all. And the
derived text roles (`--body`/`--muted`/`--subtle`, fixed 80/70/60 % mixes of
`--foreground`) are not re-weightable by a preset, so its **weakest** role — not its body
text — is what a palette must be chosen against: the first warm-paper attempt cleared AA
for body and muted and missed it for `--subtle` at 4.41:1, and the ink had to darken. That
constraint is recorded rather than turned into an extension point, since making the
percentages overridable would let a preset weaken contrast as easily as strengthen it. Both
presets are now held to AA by the same parsing test, and the browser suite verifies every
claimed override point — including the radius scale, which lives in Tailwind's `@theme`
rather than on `:root` and was the one claim that could plausibly have been wrong; the shared generic media model, the public
image rendition boundary, the shared bounded gallery
result contract, the fullscreen lightbox behind a project-owned PhotoSwipe wrapper
(open, close, navigate, trapped focus, focus return keyed by `itemId`, and the caption
and credit of the active item, associated with it for assistive technology),
its zoom and pan behaviour (AB#78): the one-click/tap/`z`-key magnification and the
gesture pan are the library's own, bounded by ADR-0005's zoom cap, and the wrapper adds
only the two things the library omits — `aria-pressed` on the library's zoom button,
synced from a cached `zoomPanUpdate` handler through the browser-free `isLightboxZoomed`
predicate (`src/lib/lightbox-zoom-state.ts`), and the caption stepping out of the way
while zoomed (AB#16's dormant `data-visually-hidden` hook, now also dropping the region's
`pointer-events` and `tabindex` so it neither eats a pan gesture nor holds a keyboard
stop) while its text and the image's `aria-describedby` link stay intact; zoom, pan, and
caption state reset with the slide and on close because the library resets the
magnification and rebuilds the dialog. `e2e/gallery-lightbox-zoom.spec.ts` covers mouse,
synthesized tap/double-tap, keyboard, and pointer-drag paths — including a drag that
starts over the hidden caption, proving the region's dropped `pointer-events` lets the
gesture through — and the vertical pan-bound clamp (the axis that does not double as
slide navigation); the one physical-device pinch/pan check (AC6) is documented as
outstanding in ADR-0001. AB#78 itself is closed; that one manual check is tracked
separately by the open **AB#141**, whose acceptance criteria require a real touch device
and the result recorded back into ADR-0001. Zoom _animation and level
tuning_ stay a later slice.
There is also
a bounded adjacent-image preload window (`LIGHTBOX_PRELOAD_WINDOW`, `image-delivery.ts`,
ADR-0010) that replaces the library's own unstated default with one slide back and two
forward, structurally unable to cross a gallery's page cursor because it only ever
addresses slides already in the viewer's loaded array, with its own failure/retry
behaviour and bounded network/memory footprint measured against a real browser and
recorded in the ADR,
the public content category domain model with its canonical placement
contract, settings-driven page metadata with canonical URLs and Open Graph values, and
the locale route contract — configured locale route spaces, root prefix reservation,
locale-space namespace reservation, redundant default-prefix normalization,
route-specific document and Open Graph locale selection, and tested helpers for
identity-based language switching and alternate metadata. The public category branch
routes are in place on top of that: the story-namespace root and every public category
path in each configured locale space, with breadcrumbs following canonical ancestry, a
deterministically ordered listing of child categories and content (secondary listings
included, each linking to the one canonical detail route) read through a bounded query
that pushes the order and row limit to the adapter. That branch listing aggregates every
canonically and secondarily placed page in the category's whole descendant subtree, not
only its direct placements (ADR-0003, 2026-08-27 amendment, AB#140): a parent surfaces a
deep branch's galleries with no per-item secondary placement, aggregation flows downward
only, and the query is scoped by the in-scope subtree category ids so a store-backed
adapter pages it with a category-scoped `references()` query rather than an unbounded
per-content-id list — the story root keeps its own explicit routed-content id list. There
is also a bounded recent-content overview on
the story root, uncropped cover media with a defined
missing-cover state, single-hop permanent redirects for casing variants and for the
recorded previous paths a move or rename retired, `hreflang`/`x-default` alternates, and
a visible identity-based language switch. Page metadata omits the site description in
any locale it was not authored in rather than publishing it under a translated title.
Application-owned UI labels are per-locale (English and Finnish sets ship).
The site menu is driven by that tree: `buildSiteNavigation` composes the configured
static links with the public categories, dropping any configured link into the story
namespace so no two entries own one route space, and it carries the first two category
levels — deeper branches are reached from the landing page above them. Both layouts
render it as a disclosure, not a menu widget: every entry is a link, one submenu is open
at a time, a pointer or focus landing outside closes it, and the compact panel keeps its
own scroll boundary rather than covering or locking the page. Escape is heard on the
document, not on the menu, because WebKit leaves focus on `document.body` after a pointer
activates a button; the submenu takes it in the capture phase and the compact panel in
the bubble phase, so the menu unwinds one level per key and returns focus to the control
that owned each.
The shared site header now uses the gallery section controls' extracted scroll-reveal
hook (AB#253, implemented on the work branch; owner acceptance and merge pending):
downward scrolling hides it without reflow, and the first upward movement brings it
back at the viewport top. Keyboard focus reveals and pins it; a pointer-focused link
alone does not pin it, while an open displayed disclosure does. Header and gallery
controls retain independent focus pins. The measured visible header height offsets
the gallery controls, so both bars remain usable when revealed together. Their full
measured heights reserve room for browser focus scrolling and anchor jumps. Resize
observers and event listeners are removed on unmount; reduced motion skips the slide.
The header stays in its original document flow before hydration and without JavaScript.
Both menu layouts cap an open panel to the viewport space below the measured brand
bar, so the panel's own scrolling can reach its final links even on a short screen.
Service pricing sidebars also use the visible header offset, preserving their existing
spacing without letting the revealed header cover the top of a pinned pricing box.
Articles have moved into that tree: the shared project-owned content-page boundary
(`src/lib/content-page.ts`) carries the variant, the six ADR-0003 body blocks, the cover,
the publication date, and tags, and the `article` variant renders at its one canonical
detail route in every configured locale space, with breadcrumbs following canonical
ancestry, the ADR-required table of contents derived from the body's level-2 headings,
sibling navigation read through a bounded two-row neighbour query over the global article
publication order, self-referencing canonical metadata, `hreflang`/`x-default` alternates, an
Open Graph article, and the identity-based language switch.
Curated galleries render there too: the `gallery` variant has its canonical detail route
in every locale space, reading its result through `src/lib/gallery.ts` — route components
import that contract and no mock or provider type. A gallery larger than one page now continues rather than being refused: it issues an
opaque cursor signed with the deployment's own `GALLERY_CURSOR_SIGNING_KEY` — a
server-only runtime secret resolved lazily, so a deployment whose galleries all fit inside
one page never reads it — and serves the next bounded slice at its own indexable,
self-canonical `?cursor=` URL, which names no `hreflang` alternates because no other
locale holds an equivalent slice. The control that reaches it is a real link, so a large
gallery pages through with no JavaScript at all (ADR-0003 decision 8), and script
progressively enhances that same link into an in-place append: the next slice arrives in
the page a visitor is already on, read from a bounded `GET /api/gallery` route handler
addressed by canonical path and opaque token. One projection (`gallery-slice-server.ts`)
serves both the server render and that endpoint, so an appended item carries the same
identities, captions, and delivery sources as one that was there from the start, and
`appendGallerySlice` de-duplicates by result identity without reordering what is already
loaded. The grid had no scroll-driven loading or eager archive prefetch until AB#374
made automatic loading an authored mode (see below). The control announces
loading, failure, and completion, keeps focus on itself across an append, and retries in
place; the open lightbox asks for one bounded slice within a small lookahead window before
the last loaded item (AB#251), and a failed
continuation neither closes it nor loses the photograph on screen. The address bar is
deliberately left alone, because every slice already has its own honest address through the
unenhanced link. The continuation
page is deliberately thinner than the first, per decision 3: a compact `h1` naming the
gallery and the continuation, the identity-based language switch (which deliberately
drops the cursor and opens the other locale's first page), then the grid — no lead, date,
or tags, so editorial content is not republished under several URLs. It also carries the
way back a cursor cannot, because tokens point forward only and the URL is indexable. A token that is
malformed, tampered with, scoped to another gallery, or stale is a 404 rather than a quiet
return to the first page, and so is a repeated `?cursor=` — and a token arriving at a
non-canonical spelling (casing, redundant prefix, retired path, or trailing slash) is
validated before normalization: a good token redirects once to the canonical address and
keeps its exact value, while an invalid one 404s without creating a redirect. The cursor is scoped to
the gallery _and the full route locale_, so a slice cannot cross between `en-GB` and
`en-US`. The key enters at the
`gallery.ts` seam rather than in the fixture, ESLint keeps `src/app` and `src/components`
away from it, and rotating it retires every continuation URL already issued and indexed.
The 404 for an invalid cursor carries the link back to that gallery decision 8 requires,
following at most one canonical normalization and verifying that both the content page and
the parameter-free gallery result are served, so an unknown or broken address gets no
invented one. It reaches the boundary through `src/proxy.ts` (ADR-0007), which copies the
bounded requested pathname and cursor presence — never its value — into project-owned
request headers and overwrites any client-supplied values. The Proxy also owns
trailing-slash normalization so the adapter can validate a cursor before a 308. App Router
renders a not-found boundary with no params, and renders it before the page, so nothing
in-tree can tell it. One site-wide limitation bounds that link and predates this work: a
404 response carries its semantic UI only in the RSC payload, so no heading or link renders
without JavaScript.
ADR-0007 records the minimal reproduction's matched-route split and upstream
[Next.js#62228](https://github.com/vercel/next.js/issues/62228). First seen on
Next.js 16.2.11 and **still reproducing on 16.3.8 (2026-10-03)**: production-build
Chromium and WebKit probes with JavaScript disabled inspect actual heading/link
nodes for an unknown gallery slug under an existing parent and a refused gallery
continuation. Both paths match the catch-all. The response
is HTTP 404 with an empty `__next_error__` shell. Four explicit expected-failure
probes retain the semantic requirement and become unexpected passes when it is
fixed; they do not record owner acceptance. The [fresh main-branch audit](audits/ab132-2026-10-03-scriptless.json)
records the commit/build provenance and 36 passing gallery/category journeys plus
four expected failures. Both upstream candidates (#98455 and #98583) remain
unmerged; [ADR-0007's decision proposal](adr/0007-proxy-request-path-boundary.md#2026-10-03-main-branch-recheck-and-decision-proposal-ab132)
awaited explicit owner acceptance or withheld promotion before AB#18 (true at the
2026-10-03 checkpoint; superseded by the owner-accepted temporary residual recorded
further below, 2026-10-07).
**Checkpoint, 2026-10-06 (AB#201, Active):** the merged source retains all four
scriptless semantic failures across Chromium/WebKit. The
[redacted audit](audits/ab132-2026-10-06-scriptless.json) records exact build/harness
identities and current upstream states. No AB#132 risk acceptance was recorded at
that checkpoint; the later owner acceptance (2026-10-07) is recorded below.

**Release-candidate check, 2026-10-07 (AB#132, Active):** PR #281's exact source
was rebuilt and tested with mock content. The runner reports 40 passed across
the gallery/category suites, including four expected semantic failures; 36
journeys genuinely pass. The four JavaScript-disabled probes still return
HTTP 404 without a rendered heading or return link. A fresh isolated App Router
reproduction also fails on the current npm latest, Next.js 16.4.0, while its
unmatched-URL control renders correctly. This does not upgrade the application.
The [redacted audit](audits/ab132-2026-10-07-scriptless.json) includes both
measurements and scaffold provenance. Both upstream fix candidates remain
open/unmerged. At this checkpoint the October 8 owner decision was pending; the
owner later accepted the temporary residual risk (see the 2026-10-07 owner-accepted
entry below), but the October 8 review, the verified semantic fix and the
exact-candidate retest remain pending, and green CI does not close the launch gate.

**AB#132 owns this**, and was reopened to
`Active` on 2026-09-03 because it had been closed while none of its own "Done when"
conditions held: the semantic 404 HTML above, the removal of the `javaScriptEnabled: true`
exception the 404 cases in `e2e/gallery-continuation.spec.ts` and
`e2e/category-continuation.spec.ts` still carry, and an updated or retired Known limitation
in ADR-0007.
One authoritative order governs the source, the DOM, keyboard focus, and the
lightbox sequence, and the grid is row-major (one, two, three columns, top-aligned, native
ratios, never cropped) precisely so the visual reading order cannot contradict it; the
column-major CSS masonry it replaced did. That order is manual (the administrator's
authored `order`) unless a gallery opts into the **seeded-random rule** (AB#129,
ADR-0009): a deterministic shuffle whose per-placement sort key
(`computeShuffledOrder` in `src/lib/gallery-shuffle.ts` — HMAC-SHA256 of `placementId`
keyed by `orderingSeed`, fixed-width hex) is _materialized_ once by whoever produces the
rows, never recomputed on the read path, with pinned lead placements kept in their exact
manual positions ahead of the shuffled rest (ADR-0009 §3). `gallery-pagination.ts`'s
boundary key is the tiered `(pinnedTier, key, placementId)` triple
(`GalleryOrderingBoundary`), with the tier recoverable from `key`'s type so
`keyset-cursor.ts`'s wire format is unchanged and a pre-AB#129 `manual` cursor still
decodes. `GalleryOrdering` (`{kind:"manual"}` | `{kind:"seeded-random", seed}`) is the
one structured value a caller supplies; `orderingScopeString` derives the
`GalleryCursorScope.ordering` value centrally (`seeded-random-v1:<seed>`), so the seed is
part of the cursor digest and a reseed retires an in-flight cursor as `wrong-scope`, not
`stale`. Both sources serve it: the mock fixture's `content-shuffled-showcase` (34
placements, 3 pinned), and (AB#129 PR2) a `SITE_CONTENT_SOURCE=sanity` deployment —
`galleryPlacement` stores `shuffledOrder` (raw 64-hex) + a `shuffledOrderSeed` marker,
`sanity-gallery.ts` serves the tiered order as two keyset lanes (pinned by `order`, then
by `shuffledOrder`) in one round trip, and the Studio publish block on `seeded-random` is
lifted. Rotation is two steps (ADR-0009 2026-08-28 amendment): edit `orderingSeed` in
Studio, then `npm run recompute:shuffled-order -- --gallery <id> --language <lang>`
(owner-run, `ifRevisionID`-guarded, refuses to run while an unpublished draft of the
gallery or a placement exists, re-checks the gallery rev/rule/seed before and after the
patches, ends with an authoritative consistency query that runs even for an empty plan).
Between the two the `basics` query's bounded `staleShuffledOrderCount` aggregate makes the
adapter raise `ordering-stale` (re-raised at the `@/lib/gallery` seam as
`GalleryOrderingStaleError`) — _after_ the cursor/section validation, so a bad token still
404s mid-rotation. The detail route renders an accessible "being reordered" notice
(**HTTP 200 + `noindex`** — an App Router page render cannot set 503; a named limitation
that no open work item tracks, and a different one from AB#132's 404 initial-HTML gap),
and the `/api/gallery` continuation endpoint (a Route
Handler, which can) returns a real **503 + `Retry-After`**. Recovery is automatic once the
recompute's placement patches invalidate the `sanity:galleries` cache tag; the command's
final check gates only its own exit code.
A gallery's listing card takes its explicit
cover or the deterministic first public item in the active order
(`selectCuratedGalleryCover`), a published
gallery with no items renders an accessible empty state (the mock publishes one, so it is
a state the site serves rather than one only a test has seen). Category listings still answer `?cursor=` with a 404, because none issues one.
`?section=` is a recognized gallery parameter (AB#115, below). The continuation link is progressively enhanced in the browser to
append one bounded slice in place, with loading, failure, retry, and completion states;
the open lightbox grows from the same result and offers its own reachable retry without
closing or losing the current item. Focus stays on the continuation control while it
exists and moves to the completion notice when the final slice removes it. No slice is
loaded until the visitor activates the control or browses within the lightbox's bounded
lookahead window.
A ~400-placement fixture gallery exercises the boundary.
Gallery sections (AB#105) sit on top of that same boundary: a gallery-local named subset
of a curated gallery's placements (ADR-0003 decision 8), with a stable id, a
gallery-unique lowercase-hyphenated slug, a label, an explicit manual order, and an
optional short intro restricted to paragraphs, ordered or unordered lists, and inline
links or emphasis — a dedicated inline-span model (`src/lib/gallery-sections.ts`), since
the shared `ContentBlock` union's `paragraph`/`list` kinds carry only plain-string text
with no inline structure to reuse. Membership is placement-owned, never media-owned:
`sectionId` lives on the placement, so assigning or moving an item never touches the
underlying photograph or its use elsewhere. `readCuratedGallerySectionPage` composes the
request: a raw `?section=` slug resolves to `{kind: "all"}` or a matched section (absent,
empty, and the reserved `all` token all mean unfiltered; an unmatched slug throws
`UnknownGallerySectionError`, which is also the whole of "rename, delete, and stale URL"
behaviour, since a retired or renamed-away slug simply matches nothing and no redirect
history is kept for sections, unlike category or content renames); the resolved filter —
never a raw slug — reaches a `CuratedGallerySectionSource` before any placement row is
read, and folds into `GalleryCursorScope.normalizedFilter` so the existing HMAC
scope-matching a cursor already goes through is what makes selecting a different section
invalidate a stale one, with no new cursor logic. A named section's own label and intro
appear only on that section's first, uncursored slice; the full section catalog is
exposed on every page for a future control; `All` never concatenates a section's intro,
and a continuation never repeats one. A valid section with no placements answers a
successful empty page rather than a 404; an unknown section, like an unrecognized cursor,
is the same 404-class failure. The mock fixture extends the large archive with two
150-placement sections spanning more than one 24-item page each, plus a third declared
section with none, so both cross-page section continuation and the empty-section state are
exercised, not just asserted. Controls, browser history, and the grid/lightbox wiring that
consumes this query were deliberately out of AB#105's scope, as was the catch-all page
ever reading `?section=` from a real request; **AB#115 has since delivered all of it**
(`src/components/gallery-section-controls.tsx`, the catch-all page's own `sectionSlug`
resolution, and `e2e/gallery-sections.spec.ts`), inheriting AB#105's unknown- and
empty-section behaviour by construction rather than redefining it. AB#105's own
review surfaced a real gap it did not close on its own: `source` received neither the
requested cursor nor the page size, so nothing let a store-backed adapter answer a large
section with a bounded keyset query instead of fetching the whole section on every
continuation — the same limitation the pre-existing unfiltered `All` view already had,
inherited from `buildCuratedGalleryPage` (AB#67/AB#104). AB#134 closes it: `buildCuratedGalleryPage`
now takes a caller-supplied `GalleryWindowResult` (the current boundary item, found by
identity, plus up to `pageSize + 1` items strictly after it) instead of the full ordered
set it used to derive both the slice and `hasNextPage` from, and `CuratedGallerySectionSource`
is now asynchronous and receives that bounded `GalleryWindowRequest` — `candidateLimit` plus
an optional `after` boundary key — rather than "every placement matching this filter."
`resolveGalleryWindowRequest` decodes a cursor into that boundary key before a source is ever
called, so cursor decoding moved from inside `buildCuratedGalleryPage` to just ahead of the
source call it now has to inform; `selectGalleryWindow` is the shared in-memory reference
implementation `mock-gallery.ts`'s fixture source composes, and the one a store-backed
adapter (AB#114) replaces with two real queries — an id lookup for the boundary and a keyset
range query for the rest — whose ordering must agree exactly with the file's own JS
string-comparison tie-break, not a database's default collation. The redesign also narrowed
cursor staleness from "any change anywhere in the gallery that shifts an array offset" to
"the boundary item itself was reordered, hidden, or removed" — the accepted, standard
behaviour of keyset over offset pagination, deliberately chosen over preserving the old,
broader trigger. What AB#105 already made bounded and tested before AB#134, and remains true
now, is the axis it always owned: a section-scoped read is never required to load a
_different_ section's placements, or the rest of an unsectioned gallery, to answer correctly.
AB#195 prepares AB#27's [author-rated catalog worksheet](review-catalog.md).
Rating scale, content identity, detail surface and filtering decisions remain open;
no catalog variant or rating filter is implemented.

A gallery's optional lead and long-form body (AB#106) are ordinary `ContentPage` fields,
not a gallery-specific type: the short lead already rendered from AB#104's own
`page.summary`, and the long body reuses the exact `ContentBlock` set and `ContentBody`
renderer an article's body already reads through, so a gallery gains no article-specific
model of its own. `ContentPageJumpNav`, extracted from the article variant's own
heading-only navigation, gives the gallery variant its content-derived page-jump
navigation (ADR-0003 decision 3): present only when a long body exists, always offering a
link to the grid (`#gallery`, an in-page anchor rather than a route) ahead of any level-2
headings the body carries, and reusing the same `listContentHeadings`/`buildHeadingIds` an
article's own table of contents is built from, so a heading's anchor and the link that
names it cannot drift between the two variants. Both the navigation and the body are
omitted on a continuation slice, along with the rest of the page's editorial framing
(decision 3), and a gallery with no body renders neither wrapper. Body media renders
through the same `MediaFigure`/`ContentBody` boundary as an article's, so it carries the
same public-rendition, native-dimension, no-crop, lazy-loading guarantees and stays
separate from the gallery's own curated result set, grid, lightbox, sections, and
pagination (decision 2) — a body photograph is a content placement, never a gallery item.
An **image** body placement now opens the fullscreen lightbox (AB#147, ADR-0003
2026-09-04 amendment): the same ADR-0001 PhotoSwipe wrapper, reused with no new
dependency, mounted as a second, entirely separate `GalleryLightbox` instance whose
sequence is the body's own image blocks in authored source order and nothing else — so
on a gallery variant page the body viewer and the curated grid viewer share no slide
list, and a video body block still renders nothing rather than a broken slide. Slide
identity is per occurrence (`src/lib/content-body-media.ts`: a CMS block's stable key, or
its image ordinal), so a photograph placed twice returns focus to the figure that opened
it. The body viewer carries no `enquiryBasePath` — a body photograph is not a curated
placement, so it shows no enquiry control — and the in-flow figure is enhanced into a
trigger only after hydration (`ContentBodyFigure`), so a scriptless visitor keeps the
plain image. The article **cover** has since become a full-bleed overlaid hero rather than
a static image — AB#149, described below, alongside AB#148's own home hero.

AB#323 (2026-10-17) applies the owner's explicit all-article decision: every
loose article-body photograph now mounts a one-image viewer, with no navigation
to other photographs. Gallery-body grouping remains as described above; inline
mini-galleries and article-end galleries retain their own independent groups and
continuation. Occurrence identities, captions, zoom, focus/reading-position return,
public derivatives and scriptless plain figures remain. The dated ADR-0003 amendment
supersedes only the article sequence clauses of AB#147/24. AB#323 stays Active
pending owner review/merge; the rest of parent AB#321 is separate.

AB#356 owner refinement, 2026-10-18: standalone article-body image viewers omit
the redundant “Last image” status in both interface languages. The shared
viewer's default sequence-end message and continuation loading/failure/retry
states remain available to grouped body, mini- and end-gallery viewers. Captions,
zoom and focus return keep their existing behavior. AB#323 is Closed; this small
follow-up remains Active pending review and merge under parent AB#321. Lint,
TypeScript and all 7,984 browser-free tests pass, together with a fresh
production build and 99 Chromium/WebKit journeys (desktop/mobile, FI/EN).

Before/after image comparisons (AB#23, ADR-0019) are the tenth shared body-block
kind, available in both article and gallery bodies: two public images and authored
side labels, native range interaction after hydration and successful image loads,
a complete-image toggle, and stacked full-frame fallback for incompatible ratios,
image failures, and visitors without JavaScript. They join no viewer sequence.
Sanity schema/projection and approval-bound Joomla comparison-module conversion
ship together; conversion policy v3 retires earlier conversion approvals.

AB#291 (2026-10-14) moves the native comparison slider onto the photograph: a
48-pixel circular thumb with opposing arrows follows the full-height divider at
the image's vertical midpoint. The narrow transparent track preserves native
mouse/touch and keyboard operation, localized labels/value text and visible
focus. Native ratios, full-frame/complete-image and scriptless/error/unequal-ratio
fallbacks, captions and credits remain intact. ADR-0019 records the scoped
placement amendment. The isolated branch adds production journeys for on-image
geometry, native Chromium touch dragging and a 320-pixel viewport alongside the
existing FI/EN article/gallery, WebKit touch, keyboard and fallback coverage.
Validation: lint, all 6,159 deterministic tests and a fresh production build passed;
all 33 comparison journeys passed without retries in desktop Chromium, mobile
WebKit and mobile Chromium. AB#291 remains Active pending PR review and merge;
no production activation is claimed by this source change.

Inline mini-galleries (AB#24) are the seventh shared body-block kind: 1–12 public images,
an optional title, a one/two-column uncropped row-major list, and a separate lightbox
sequence per block. They enter neither the curated result nor the body's loose-image
sequence. Localized ordinal fallback names and collision disambiguation keep lists
identifiable, while per-occurrence slide keys restore focus to the image displayed at
close. Studio and the public reader enforce the bound; the reader projects only public
media and rejects invalid entries. No pagination, enquiry control, or video delivery is
added. `e2e/content-mini-gallery.spec.ts` covers nested-provider integration and the
public journey. The ADR-0003 amendment records the boundary.
A data table (AB#22) is the eighth: 1–8 non-empty column headers, 1–20 rows carrying
exactly one cell each per header, and an optional caption, all plain text. An empty
*cell* is authored content; a short *row* is a defect, because it would shift every
later cell under the wrong header. It renders as a real `<table>` (`<caption>`,
`<th scope="col">`, `<td>`) inside its own horizontally scrollable region, so a wide
table never makes the page scroll sideways. That region is unconditionally focusable and
named by the caption — or by a localized built-in label without one — so the keyboard
path needs no JavaScript, which `e2e/content-table.spec.ts` proves with scripting
disabled in both engines. Rectangularity is enforced on the Studio object itself, since a
field-level rule cannot see a sibling field, and again independently at the read
boundary; the query reads one row and column past the bound so overflow arrives as
overflow rather than silently truncated. Render-only: no sorting, filtering, or column
resizing. The ADR-0003 2026-09-13 amendment records the boundary.
A three-level nested table of contents (AB#21) shipped in PR #156.
AB#337 (Active, awaiting review) corrects cold-fragment TOC navigation.
A fresh H4 address followed by a TOC selection reproduced an initial-plus-new
fragment in all four production browser projects with pinned Next.js 16.4.2;
its route-cache URL concatenation retained the initial fragment. Plain native
anchors alone exposed a second framework limit: a null-state fragment entry
could restore the correct URL but leave the wrong page after client-route Back.
The shared fragment anchor now registers a changed fragment through Next's
[documented History API integration](https://nextjs.org/docs/app/getting-started/linking-and-navigating#native-history-api)
before leaving the native anchor action unprevented. The existing history state
passes through opaquely, without reading or writing framework fields; the
browser owns scrolling and focus progression. Repeating the same hash adds no
entry. If history registration fails, ordinary navigation remains available.
Both nested heading links and the gallery's leading link retain their IDs,
hierarchy, labels and focus styling; the type enforces a fragment href.
Native WebKit Back can restore the saved TOC scroll position rather than force
the old hash target into view; an independent offline HTTP control reproduces
that behavior. This adds no automatic reading tracking, stored restoration,
dependency, cross-route link or CMS policy change.
The home hero's overlaid site name, tagline, and call to action are now fold-safe
(AB#148, [ADR-0016](adr/0016-hero-fold-safe-overlay.md)): the photograph itself
still renders full native size, uncapped and never cropped, exactly as the hero
convention already required, but the overlay is no longer anchored to the image's own
bottom edge — a mechanism that pushed it further off-screen as the window widened,
independent of the window's height, since a wider full-native-width image is also a
*taller* one. The overlay band is instead anchored to the top of the hero and clamped to
`min(the image's own rendered height, 100dvh - HERO_CHROME_RESERVE_PX)`, a pure CSS
`min()` expression computed server-side from the media's real intrinsic dimensions, with
no client-side measurement and no JavaScript dependency for the guarantee to hold; the
text stack stays bottom-aligned within that band via flex, and the reserve constant
(`image-delivery.ts`, 96px) is a deliberately generous upper bound on the header's real
rendered height (~61px today) rather than a pin on it, chosen over both a client-measured
header height (would make fold-safety JavaScript-dependent) and giving the shared header
component a fixed height (a larger change than a hero-only story asked for). A wireframe
pass that instead capped the *image's* own height (72dvh, contained) was drawn and
rejected first: it kept the overlay on screen too, but left visible page-surface margins
beside the photograph on desktop, which the site owner explicitly rejected in favour of
true full-bleed — so the photograph is genuinely edge to edge at every desktop target
size, and instead runs some way past the fold (200–305px, measured, at the four AC1
desktop sizes with the current demo asset), reached by scrolling rather than visible on
load. `e2e/home-hero-fold-safety.spec.ts` proves this against a real production build at
every AC1 target viewport plus a common mobile size, asserting laid-out bounding boxes
rather than DOM presence — the regression it exists to catch is "in the DOM but not on
screen" — and separately proves the band is sized with `dvh`, never a bare `vh`. What it
cannot prove, because a headless browser has no collapsing toolbar to begin with, is the
live transition as a real mobile browser's chrome collapses on scroll; that gap is
recorded in the ADR rather than assumed closed, the same shape as ADR-0001's own
outstanding pinch/pan check. This is one shared mechanism, not a hero-specific one:
AB#149 (the content-page hero for the article and gallery variants, below) reuses it
unchanged rather than inventing a second solution, per that story's own acceptance
criteria.
An article's or curated gallery's own cover, when explicitly authored, now renders as
that same full-bleed hero (AB#149, ADR-0003's 2026-09-04 amendment): the photograph and
title (plus, for a gallery, the lead description, per its AC2) are extracted into one
shared component (`src/components/hero-overlay.tsx`) three call sites now use — the
home hero, and, via this story, both content-page variants — so a future change to the
mechanism has one place to make it rather than three. `page.cover` is now explicit-only
for **both** variants: the deterministic first-item fallback (`selectCuratedGalleryCover`)
stays exactly where it always was, the listing card's own read path (AB#114), and never
reaches the page a detail route renders. A gallery with no authored cover therefore
renders no hero at all — the default — rather than a fallback-derived one duplicating
the grid's own opening item, which was the whole reason `ContentGallery` had previously
never rendered a cover at the head of the page. Closing that gap surfaced a real, if
dormant, gap of its own: the mock fixture layer's detail-page composition
(`mock-content-pages.ts#compose`) was, until this story, building `ContentPage.cover`
from the *same* post-fallback record the listing card reads (`mockContentListingRecords`)
— harmless only because nothing had ever read a gallery's `page.cover` before, so the
first component to read it would have opened with the grid's own first item by default.
`compose` now reads a second, pre-fallback map (`mockAuthoredContentRecords`) for
`cover` specifically, mirroring the Sanity adapter's own explicit-only projection
(`sanity-gallery.ts#projectGalleryContentPage`), which never had this gap. An author who
explicitly picks a cover that also happens to be the gallery's first grid item has made
that adjacency their own visible choice, not a default nobody chose: it is allowed, not
refused, surfaced by a non-blocking Studio warning on the `cover` field
(`gallery.ts#warnsAboutDuplicatingGridOpening`) — the same allowed-but-flagged shape
ADR-0002 §2 already gives a photograph repeated within one gallery. AB#156 corrects both
checks to register through `custom(check).warning()`; the placement's required media
reference remains a separate blocking rule. Shared test builders preserve Sanity's
immutable rule chains and severity semantics. That warning is a
deliberately approximate, advisory check (documented in its own doc comment): it orders
by a placement's `order` field and `visible` flag only, matching a `manual` gallery's
public read, and does not replicate a `seeded-random` gallery's pinned-then-shuffled
tiered order or dereference into a placement's media for `publiclyRenderable`/
`privateOnly` — one Content Lake round trip for a non-blocking hint, not the whole public
ordering pipeline restated in a Studio validator. The hero belongs to the first,
uncursored slice only (ADR-0003 decision 3's already-thinner continuation shape): a
continuation never shows one, whatever the gallery's cover, and the curated result set,
grid, lightbox sequence, section filter, cursor scope, and `hasNextPage` are all
untouched — the hero is presentation over an existing field, not a change to the bounded
query contract. `HeroOverlay` also closed a real regression its own extraction would
otherwise have caused: the pre-existing cover figure (`MediaFigure`, shared with body
media) carried an image's caption/credit as an in-flow `<figcaption>`, and a full-bleed
hero has no in-flow position directly under the image the way a body figure does — the
component instead renders as a `<figure>` with a small corner-label `<figcaption>`
overlaid on the photograph itself, so a credited photograph's attribution survives the
move to a hero exactly as `MediaFigure`'s own doc comment requires ("a surface that
quietly drops it is publishing uncredited work"). `e2e/content-hero.spec.ts` proves the
mechanism against a real production build: the title (article) or title-plus-description
(gallery) inside the fold and the photograph edge to edge at every AC1 target viewport;
a page with no authored cover rendering the unchanged constrained title block, with no
hero `<figure>` at all; a multi-page gallery's continuation carrying no hero even though
its first page does; and the band's own `dvh`, never a bare `vh`. Building it surfaced
one more finding worth recording: the large 400-placement archive fixture
(`content-large-archive`) that AB#79's own bounded-preload measurement already depends on
turned out to be the wrong gallery to also give an authored cover — a full-bleed hero
image measurably perturbed that unrelated test's network-request count on
`desktop-chromium` specifically. The cover proving AB#149's own multi-page/continuation
case lives on `content-shuffled-showcase` instead (34 placements, already long enough to
continue), leaving the archive fixture exactly as AB#79 needs it.
The shared hero now also handles long mobile editorial text (AB#155,
ADR-0016's 2026-09-07 amendment): a grid overlays the image and an automatically
sized text band whose minimum retains the viewport formula. A taller text stack
extends the figure downward, keeping following content below it. A uniform
contrast surface covers every text line, including date and byline, instead of
relying on a gradient's darkest stop. Image dimensions and native ratio are unchanged;
very long copy can require scrolling. `e2e/hero-text-overflow.spec.ts` exercises
long title/lead/metadata over pale 16:9 and wider frames in both browser engines
with JavaScript disabled, checking text geometry against the contrast surface.
AB#171 (ADR-0016's 2026-09-26 amendment) lightened that surface from 80% to 60%
black and feathered its top and bottom edges into transparent fades, because the
hard-edged panel read as a bar under the photograph rather than text over it;
metadata moved to 90% white so every line, the CTA included, still clears AA over
a pure-white frame, and the same spec samples real pixels to prove both fades.
An authored `eventDate` now replaces `publishedAt` as the public ordering key everywhere
the site orders content chronologically (AB#150, [ADR-0017](adr/0017-authored-event-date-ordering-key.md)):
category branch listing order, the story root's recent overview,
article sibling navigation, and the ADR-0013 continuation cursor's keyset sort field all
read the **effective event date** — `eventDate ?? publishedAt`, resolved once through
`content-page.ts#effectiveEventDate` and carried on `ContentListingRecord.eventDate` (which
replaces that record's own `publishedAt` field, since nothing downstream needs the raw
value any more) — never the raw `publishedAt`, which stays on the model as unchanged
technical "went live" bookkeeping and Open Graph's `article:published_time`, but drives no
visible order or display. `CONTENT_LISTING_ORDERING` is now `event-date-desc-v1`; since
that value is already bound into the ADR-0013 cursor's signed scope via
`KeysetCursorScope.ordering`, a continuation cursor issued before this shipped decodes as
`wrong-scope` rather than a silently valid position under the new order — the identical
mechanism ADR-0009 §4 uses for a gallery reseed, with no new scope field. An optional
`endDate` auto-hides a page once the current time reaches it, with the identical posture an
unpublished page already has (absent from every listing and the sitemap, 404 at its own
route): the gate is a read-time `now() >= endDate` check folded into a placement's
*effective* `published` boolean at the adapter boundary — for the mock,
`content.ts#applyMockEndDateGate` transforms the tree input before `buildContentTree` ever
sees it, and `getContentPage`'s mock branch repeats the check as its own belt-and-suspenders
gate — so routing, listing membership, sibling-nav candidacy, and `listPublicRoutePaths` all
exclude an ended page with no `endDate`-aware code anywhere downstream. `endDate` is
deliberately not a content-tree input field, to avoid the tree needing two independent
"is this public" signals. AB#191 also rejects impossible ISO calendar days in
`isContentEnded` before V8 can normalize them into a later expiry instant. This
uses the existing adapter-defect `TypeError` posture, so malformed content can
fail the enclosing read rather than merely hide one page. Valid leap dates,
offsets and date-only values keep their parsed expiry instant. This is a local
seam check; it does not change GROQ's source-side date parsing or the accepted
cache window. Non-ISO formats remain the existing parser's separate residual.
The mock fixture layer
carries both proving cases the story requires: `content-reading-coastal-light` (article) and
`content-polar-night-sessions` (gallery) each author an `eventDate` that reorders them
relative to their own `publishedAt`, and `content-ended-article`/`content-ended-gallery`
each carry a permanently-past `endDate`, so the auto-hidden state is one the site actually
serves. `HeroOverlay` gains an optional `meta` date slot — the in-flow `<time>` the article
and gallery headers used to render moves onto the hero band, above the title, reading the
effective date (AB#151's author byline is expected to share this same line rather than add
a second one); a page with no cover keeps the date in its constrained in-flow header exactly
as before. `e2e/content-event-date.spec.ts` proves an out-of-publish-order page's real
listing position, a pre-migration-ordering cursor's 404, and an ended page's 404 route,
absent listing, and absent sitemap entry, against a real production build.
The `article` and `gallery` Sanity schemas carry the same two optional `datetime` fields,
with Studio help text stating the default-to-`publishedAt` and auto-hide behaviour in plain
language, and `sanity-article.ts`/`sanity-gallery.ts` are fully wired onto the same
contract: both listing readers project `eventDate` and resolve it through
`effectiveEventDate`, `ARTICLE_LISTING_ORDER`/`GALLERY_LISTING_ORDER` and both keyset
filters compare `coalesce(eventDate, publishedAt)`, and `projectArticlePlacementInput`/
`projectGalleryPlacementInput` fold the `endDate` gate into a placement's effective
`published` exactly like the mock's `applyMockEndDateGate`. A shared `NOT_ENDED_FILTER`
GROQ fragment additionally excludes an ended document from every listing, detail, and
article-adjacent read — required, not merely defensive, for the category-subtree listing
query specifically, since that query is scoped by category reference rather than an
already-gated contentId list and would otherwise still surface an ended document through
its own category reference. For a Sanity deployment, an ended page can go on serving a
cache `HIT` for up to `SANITY_PUBLIC_CACHE_TTL_SECONDS` after its `endDate` passes
(ADR-0017 decision 6's accepted, documented bound — `docs/cache-revalidation.md`) rather
than adding a scheduled revalidation trigger, since `endDate` is an editorial control, not
a legal or security embargo. Every new code path is covered against a fake transport
(the placement gate's four states, the listing record's eventDate-overrides-publishedAt
case, the `NOT_ENDED_FILTER` on every affected query, and the adjacent-query's
`coalesce()` ordering) — what remains unverified, by design and matching this codebase's
existing posture for a new adapter path, is a live Content Lake dataset, the way
`verify:sanity-live` separately proves other adapters against one.
AB#154 keeps the expiry clock inside GROQ (`dateTime(now())`) instead of a per-request
`$now` URL parameter, so equivalent reads reuse Next's tagged cache entry. The transport
regression exercises the installed Next cache-key implementation for listing, detail,
and sibling reads; the one-hour TTL and invalidation map are unchanged.
A per-article author byline is in place (AB#151): `author?: string` on `ArticleContentPage`
only — a curated gallery is credited to the site's photographer by construction, so
`GalleryContentPage` carries no equivalent field — with the effective byline
(`author ?? SiteSettings.photographerName`) resolved by one shared seam,
`content-page.ts#effectiveArticleAuthor`, the same "authored override, sensible existing
default" shape `effectiveEventDate` already gives AB#150's own field. The route (not the
Sanity adapter, which has no business reading site settings) resolves it: the catch-all
page reads `getSiteSettings()` alongside `getAdjacentContent()`, deduped against
`SiteRoot`'s own read of the same singleton by React's `cache()` rather than issuing a
second one. Display is coordinated with AB#150 into one meta line rather than two
independently-shipped hero additions: `HeroOverlay`'s `meta` prop gains an optional
`byline`, a fully pre-translated, pre-composed string (`labels.article.byline`, `{author}`
replaced) rendered as a plain-text line above the `<time>` element, never inside it, so the
date's own machine-readable value stays exactly what it names. A page with no cover shows
the same byline in its existing constrained header, immediately above the date. The
`article` Sanity schema gained a matching optional `author` string field, and
`sanity-article.ts`'s detail projection carries it through unresolved (the raw override,
never the fallback — resolving `SiteSettings` is the route's job) via the same
`readString` blank-treated-as-absent rule every other optional text field already uses.
The mock fixture layer proves both paths on the same footing AB#150's own fixtures do:
`content-choosing-a-telephoto-lens` authors an explicit `"Alex Rivers"` override, and every
other article relies on the fallback, so "no author authored" is the normal, zero-extra-
effort state a single-photographer clone never has to think about. No structured-data
(JSON-LD) `author` property is added to the `Article` entity `buildArticleJsonLd` (AB#86)
already emits — a deliberate, separate decision this story's own scope excludes, left for
a future story now that the field exists. ADR-0003 needed no amendment: decision 2 (the
shared body-block set) and the rest of that record say nothing about a per-variant field
like this one, so nothing it states changes.
AB#193 prepares AB#20's [reading-position worksheet](article-reading-position.md).
Browser-local persistence and restoration decisions remain open; no reading-position
restoration feature is implemented.

**Desktop contents, 2026-10-18 (AB#354, parent AB#321):** the existing
three-level article/gallery contents list gains a sticky sidebar when the actual
reading row fits a 48rem body, 14rem navigation and 2rem gap. The article
introduction retains its centered reading measure. Narrow containers and
enlarged text retain one inline list in its original document order; very short
windows retain natural page flow. Sticky enhancement follows the existing
header enhancement; scriptless navigation stays in natural flow with native
anchors. The sidebar uses the header's measured visible offset and bounds an
overflowing list to the remaining viewport with room for keyboard focus
outlines. Gallery controls, full-frame images and the fullscreen
viewer remain outside this reading layout. No mobile disclosure, storage,
restoration, rating filters, new URLs or screenshot-based design are introduced.
A separate generic long article exercises the real overflowing three-level list.
AB#354 is Active during validation/review; parent AB#321 remains open.

**Reading address, 2026-10-17 (AB#330, parent AB#321):** deliberate reading scroll
can follow the existing shared H2–H4 body anchors in the address bar, using one
bounded timer and `replaceState` with the current history state and raw path/query
preserved. Direct links, same-fragment clicks, Back/Forward, modal viewing and
native restoration take priority; URL updates do not fetch, scroll, move focus or
add history entries. Original heading ids and scriptless table-of-contents links
remain unchanged. The scoped ADR-0003 amendment records in-memory ownership and
the short-tail/unrecognized-input limitations. No browser storage, restart restore,
sidebar/mobile design or complete AB#321 acceptance is inferred. Owner review and
real-content acceptance remain pending; AB#330 is Active until its PR is merged.
Production verification separately exposed an existing tab-group hydration shift
for cold direct article fragments after that block, tracked by AB#335; this
non-scrolling address enhancement does not claim to correct that layout shift.
The pre-tree `/portfolio` route was removed rather than
redirected, per ADR-0003's 2026-08-10 amendment. Site settings name the featured
gallery once, as `featuredGalleryId`; header, footer, and home entries only mark where it
belongs and what to call it, so no two surfaces can feature different galleries. Each
resolves that identity to the locale's canonical route through the tree
(`getPublicContentRoute`, which also checks the variant), so no deployment-specific
content path is written down, and an unpublished target — or one naming an article — drops
the entry instead of putting a working link behind a label describing something else. The pre-launch `/blog` and
`/blog/<slug>` scaffold routes were removed rather than redirected — they were never
deployed or indexed, and only AB#19's verified production inventory earns redirects.
The privacy-respecting contact form is in place: an accessible `/contact` page in the
unprefixed default-locale route space, a fixed `POST /api/contact` handler accepting
only same-origin JSON within a bounded body and a closed field whitelist, shared
normalization and validation rules the form and the endpoint both run, honeypot and
per-instance throttling, a replaceable `ContactDeliveryAdapter` boundary with a Resend
HTTP adapter and a sink adapter that a production deployment refuses to build, and
operational events limited to a random correlation identifier, a state, and a redacted
error class. No form content is stored anywhere; the processing record is
`docs/contact-data-flow.md`. Deployments declare themselves through
`SITE_DEPLOYMENT_STAGE`, which defaults to production so a safeguard fails closed.
The customer-owned Sanity connection is bootstrapped: a declared content source
(`SITE_CONTENT_SOURCE`) that `loadDeploymentConfig` validates, so an unset value or
`mock` in a production deployment fails the build rather than a later read; connection
settings validated against Sanity's own project-id and dataset rules, carrying an
optional server-only read token; and a project-owned query client over the Content Lake
HTTP API that always asks for the published perspective, bounds and classifies its
failures, never falls back to another source, and adds no CMS library. Sanity's HTTP
surface lives in `src/lib/sanity-config.ts` and `src/lib/sanity-client.ts`; ESLint stops
`src/app` and `src/components` from importing either, and the `server-only` marker
catches the indirect case ESLint cannot see (ADR-0006, `docs/sanity-setup.md`).
AB#320 follow-up, 2026-10-17 (Active, awaiting review): query and fresh-document
reads cancel unused error bodies without waiting for cleanup. The original
10-second attempt deadline and caller abort also bound uncooperative fetch/body
waits; late responses are cancelled and settled stream listeners are removed.
Declared and streamed overflow retain the existing bounds and error classes;
ordinary unbounded queries retain native decoding. Synthetic regressions cover
cleanup failures, timeout races and listener lifetime. Cache policy, published
perspective, response envelopes and provider settings are unchanged; no live CMS
request or deployment operation was performed.
The first schema and adapter sit on top of that connection: the shared media document
(`sanity/schemas/`, plain objects a customer Studio consumes, no `sanity` package) and
the server-only adapter (`src/lib/sanity-media.ts`) that projects it into the same
`ImageMedia` the fixtures produce. One photograph is one document — placement fields stay
on whatever places it (ADR-0002) — and the adapter reads an allow-list rather than a
document, so the archive locator, the provider ids, and the capture date used for
ordering cannot reach a payload. The rendition's delivery URL is validated against the asset's own stored
`path` rather than reconstructed: Sanity's documented upload response has an `assetId`
that is only part of the path's filename, so nothing infers an identifier from a name.
Only the trailing `-<width>x<height>.<format>` is parsed, and the version is the opaque
name to its left, which Sanity derives partly from the file's content.
The export policy is enforced twice, because a read-time refusal is late: the schema
measures an upload against `MAX_PUBLIC_DELIVERY_DIMENSION` (2048px, the same number as
the optimizer's widest candidate, pinned by a test) and its format, and blocks the
publish; the adapter checks again, because the Studio binds an editor and not the HTTP
API. Neither un-uploads a file — an asset is public on the CDN before anyone presses
publish — so `docs/sanity-setup.md` carries a deletion procedure. Dataset visibility is
declared twice and must agree: in the Studio schema, where a world-readable dataset is
offered no archive-location field at all, because a field the adapter never projects is
still published by a public dataset; and as `SANITY_DATASET_VISIBILITY`, where declaring
`private` makes the read token required — an unauthenticated read of a private dataset
answers 200 with an empty result, so without that guard a misconfigured site renders as
though nothing had been authored and the connectivity probe agrees with it. The image
field also stops Sanity storing the uploaded filename, which its own documentation warns
may carry sensitive information. `mediaId` is checked in the Studio
for uniqueness across the dataset — with an explicit `raw` perspective, because a
client's default would not see another document's unpublished draft, and comparing on
published identity so a document does not collide with its own draft or release version —
and for not having changed since the last publish, and again at the boundary — its syntax, one document per identity by id, and no repeated
identity within a page. A malformed answer from the store is a classified failure, never
an empty result. Authored text is language-keyed (ADR-0008): alternative text falls back
to the site's own language, a caption is dropped rather than shown in the wrong one. A
video raises rather than half-publishing; the model stays image/video capable but the
public video projection is deliberately a later story with its own delivery ADR (recorded
on AB#82). `next.config.ts` allows the optimizer exactly this deployment's own asset path
prefix, with the project id and dataset validated before they are interpolated into it,
and nothing at all when the content source is the fixtures.
The category schema and adapter sit beside it: the public content tree's node
(`sanity/schemas/category.ts`) and the server-only adapter (`src/lib/sanity-content-tree.ts`)
that projects it into `content-tree.ts`'s own `ContentCategoryInput`. One document is one
category in every published language — `label`, `slug`, and an optional bounded landing-page
description are language-keyed arrays, the same shape ADR-0008 gives media's `alt` and
`caption`, because a category has no
per-language publication lifecycle to preserve the way a gallery or article will; a
category missing an entry in the requested language is simply absent from that language's
tree rather than a defect. A missing description renders nothing in that language; the
initial category landing places it below the sole `h1`, while cursor continuation pages
omit it. `categoryId` is checked in the Studio the same way `mediaId`
is — syntax, dataset-wide uniqueness with the same `raw`-perspective query, and
immutability after first publish. Its document-level validation reads the published tree,
overlays the document being edited, and blocks self-parenting, indirect cycles, orphaned
parents, sibling-slug collisions, and excess depth before the standard Publish action.
`content-tree.ts` remains ADR-0003 decision 4's authoritative backstop because API writes
bypass Studio validation: the adapter resolves a `parent` reference against every category
id it fetched rather than trusting a GROQ dereference, so an unresolved reference is
reported as a missing parent instead of silently becoming a top-level category. Published
parents and existing localized slugs are immutable in the ordinary form; a customer
Studio's warned URL-change workflow must feed before/after snapshots through
`diffPublicCategorySnapshots`, show the affected categories and content, and persist the
accepted path history before publishing. Canonical and secondary category placement stays off this
schema entirely — ADR-0003 decision 5 makes it a property of the gallery or article being
placed, not of the category receiving it — so `readPublicContentTree` accepts placements as
plain input from whatever adapter reads that content once AB#113 and AB#81 exist, and
composes them with the fetched categories through the same `buildContentTree` call the mock
layer already uses.

**Foundation plan input integrity, 2026-10-07 (AB#216):** `write:foundation`
refuses malformed UTF-8 before singleton validation or credential resolution. Valid
Unicode and its approval digest remain unchanged. Existing JSON BOM rejection,
dry-run, reference checks and create-only singleton rules are preserved;
AB#137 still requires the live content operation and audit.

The global settings and home-page schemas and adapters sit beside those boundaries too.
Each is a published singleton: none is a fallback to fixtures, and a missing or duplicate
published document raises as a classified content defect. Authored prose is language-keyed,
and since AB#187 so is the site name; other brand identities stay language-neutral. Static navigation stores only validated root-relative
application paths, while the story root and featured gallery are semantic targets resolved
from deployment routing and the one `featuredGalleryId`, so settings contain neither a second
category tree nor a generated content path. The Studio schema receives every configured
locale's generated story-root path as configuration and refuses a static link duplicating
any of them; the runtime adapter repeats the check against validated route configuration.
The home hero dereferences the shared media
document through `PUBLIC_MEDIA_PROJECTION` and `projectPublicMedia`, retaining its public
derivative and true dimensions. These adapters return the existing `SiteSettings` and
`HomeContent` contracts, and AB#135 wires both into their route-facing seams
(`src/lib/site-settings.ts`, `src/lib/home-content.ts`) alongside every other content adapter,
so a deployment never mixes a mock and a Sanity source on one page.
The shared rich-content body-block schema and the article and service schemas and
adapters sit beside those boundaries too. `sanity/schemas/content-block.ts` gives both
public content variants the six ADR-0003 decision 2 body blocks — paragraph, heading,
list, quote, media placement, and click-to-load YouTube — as Sanity object types named
`content<Kind>Block` rather than the bare discriminant, because `media.ts` already claims
`media` in the one namespace Sanity type names share; `defineContentBodyField` builds a
body field restricted to a caller-chosen allow-list of these kinds, every kind by default,
so a narrower context such as a future gallery section introduction reuses the same six
types instead of a second body schema. `src/lib/sanity-content-blocks.ts` is the read
half, projecting a query result back onto `content-page.ts`'s `ContentBlock` union; a
media block reuses `projectPublicMedia` unchanged, so a photograph placed in a body is
validated by exactly the boundary ADR-0005 established for every other public rendition.
The article schema (`sanity/schemas/article.ts`) is the `article` variant of the shared
content-page boundary, and — unlike a category's one document for every language — is one
document _per_ language: ADR-0003 decision 7 lets a page's languages be authored and
published independently, so `language` plus the immutable `contentId` together identify
one version, and two documents may share a `contentId` (one per published language) but
never both `contentId` and `language`. `canonicalCategory` is required, so a standard
Studio publish cannot leave an article unplaced — Sanity's own validation model blocks
publishing, not saving a draft, which is exactly ADR-0003 decision 5's allowance for
unplaced draft content. Field-level requirement is not the whole guard, though:
`sanity/schemas/article-validation.ts` fetches every category and every other published
article in this language, overlays the document being edited, and restates
`content-tree.ts`'s own public-category propagation and local-slug-namespace computation —
not just a check against other articles in the same category, which would still miss a
sibling _category_'s slug, or a collision only exposed because this very publish turns a
previously private canonical- or secondary-placement ancestor category public for the
first time. So a routine "Publish"
click cannot be the moment a colliding local slug (ADR-0003 decision 6) or a canonical
category with no published version in the article's own language reaches the public tree —
both states are otherwise only caught when a route reads the whole tree, which rejects it
outright. Gallery placements are not fetched yet, since no gallery schema exists before
AB#113; that story extends the same query. The same validator freezes `language`, `slug`,
and `canonicalCategory` once a document has
been published at all, the same way `category-validation.ts` freezes a category's `parent`
and path segments, so an ordinary edit cannot silently discard a live canonical URL or —
since `language` plus `contentId` together are the whole identity — turn one language's
published page into a different language's version by editing the field, rather than
starting the new language as its own linked document the way AB#125's workflow requires.
`content-tree.ts` remains the authoritative backstop for a document an API import wrote
without going through any of this Studio validation. Tags stay a separate free-text
field, unrelated to categories and consuming no tree depth. `src/lib/sanity-article.ts`
reads three separate projections rather than one, matching `content-listing.ts`'s rule
that a listing card must never load an article body: `readPublicArticlePlacements` feeds
`content-tree.ts`'s placement contract, resolving `canonicalCategory`/`secondaryCategories`
references the same way `sanity-content-tree.ts` resolves a category's own `parent` —
raw, then looked up locally through the newly exported `readCategoryDocumentIndex`, so an
unresolved reference reports as a missing category rather than collapsing into "unplaced";
`readPublicArticleListingRecords` answers a bounded `ContentListingQuery`; and
`readPublicArticlePage` reads one full page by locale and stable identity, returning
`undefined` for a language with no published version — the normal bilingual state, not an
error — throwing a classified `SanityArticleError` when two published documents collide on
one identity, and, because the schema's own `min(1)` body requirement binds only the
ordinary Studio editor and not an API import, refusing to project an article whose body
came back missing or empty rather than silently publishing a page with nothing in it. Each
body block also carries Sanity's own stable per-item `_key` through to
`content-page.ts`'s `ContentBlock` as an optional `key`, which `ContentBody` prefers over
array position for its React key — the mock fixture layer has no such concept and simply
omits it, falling back to position, which is safe there because fixture content is never
live-reordered the way Studio content is. The service schema (`sanity/schemas/service.ts`)
and adapter (`src/lib/sanity-services.ts`) model `src/lib/services.ts`'s existing `Service`
contract directly: no language field, matching the still-unlocalized `/services` route, and
no category placement, tags, or redirect history, because a service is not part of the
ADR-0003 public content tree. Its `slug` is checked for syntax and uniqueness the same
asynchronous way `media.ts` and `category.ts` check theirs at publish time, without the
immutability half those two also enforce, because a service has no redirect-history concept
requiring it; `readPublicServices` repeats the uniqueness check across a whole listing read
too, since Studio's rule does not bind an API import and a silently duplicated slug would
otherwise hand a visitor two cards for one URL while `readPublicServiceBySlug` throws for
the same state. Several rounds of independent review hardened these adapters and the article
publication guard further: content-block and service Studio schemas reject a blank list item
or description paragraph, matching the adapters' own read-time rule, so an ordinary publish
cannot create content the read boundary refuses; every place a Sanity document reference
resolves against a `categoryId` index marks an unresolved reference with a value the identity
pattern can never produce (`unresolved-ref:<ref>`), so a coincidental string collision with an
unrelated category's real id can never silently alias to it; `publishedAt` is checked as a real
ISO calendar date via a `Date.UTC` round trip, not merely `Date.parse`, which is lenient enough
to normalize `2026-02-31` into March 3 rather than reject it; a category listing's candidate id
list is chunked to the Sanity GET URL's byte budget — measured the same way
`buildSanityQueryUrl` measures the real request, not approximated — so a category with a few
hundred articles cannot make the query itself fail, and a single pathologically large id is
rejected outright rather than silently emitted as an oversized chunk; and `readContentBlocks`
rejects two body blocks sharing one stable key, since a duplicate breaks the render-time React
identity the key exists to provide. AB#135 wires the article and service adapters into their
route-facing seams (`src/lib/content.ts`, `src/lib/services.ts`); the shared content-block
schema and adapter were already reached transitively through every content page that renders
a body.

**Service plan input integrity, 2026-10-07 (AB#214):** `write:services` rejects
malformed UTF-8 before plan validation and credential resolution. Valid accented text,
emoji and deliberately encoded replacement characters retain their approval digest.
JSON BOM rejection, dry-run and create-only preflight/read-back rules are unchanged;
this does not complete AB#137's live migration.

The gallery schema and adapter (AB#113) sit beside the article ones, sharing their
identity/URL-freeze/local-slug-namespace guard through a new `content-placement-
validation.ts` rather than duplicating it: a `contentId` can no longer be claimed by both
an article and a gallery, and a local slug collision between the two types is caught the
same way a collision between two articles already was. `gallery.ts` is one document per
language, like `article.ts` and unlike `category.ts`, because its placement overrides and
section labels are plain per-language text, matching `GalleryContentPage`'s own shape. Its
named sections (AB#105) stay a gallery-local object array on the document itself —
`sections`, bounded to `MAX_GALLERY_SECTIONS` (20) — but its curated items do not: AB#114
found, verified against Sanity's own technical-limits documentation, that an embedded
`placements` array cannot be read as a bounded, keyset-paginated window without the query
engine loading the whole document (Content Lake filters and projects whole documents; a
single one is capped at 1,000 attributes on the Free/Growth plan, a ceiling a few hundred
placements already approaches), so each placement is now its own `galleryPlacement`
document (`sanity/schemas/gallery-placement.ts`), referencing its `gallery`. `order` is
therefore an authored field rather than array position — a real authoring-experience cost
(no more drag-to-reorder) accepted for the bounded-query property. Its own document-level
Studio guard (`validateGalleryPlacementPublication`, one round trip per placement) enforces
what ADR-0002 leaves to be decided for a gallery specifically: every `placementId` is
public and site-wide unique with an immutable media/gallery binding, except that the same
occurrence may legitimately share one `placementId` across a gallery's own language
versions; repeating a photograph within one gallery is allowed but flagged with Sanity's
non-blocking `rule.custom(check).warning()` rather than refused (ADR-0002 §2, closing that ADR's own
deferred action item); and a section's slug is immutable once published, restating
`gallery-sections.ts#assertGallerySectionsSlugStable`. A section's optional intro reuses
the same restricted paragraph/list/emphasis/link model `gallery-sections.ts` already
defines, through dedicated object types (`gallery-section-intro.ts`) rather than the
six-kind shared body blocks, whose plain-string paragraphs and lists carry no inline
structure. `orderingRule`/`orderingSeed` let a gallery declare a seeded-random ordering,
and (AB#129 PR2) `galleryPlacement` also stores the materialized key: `shuffledOrder`
(read-only, raw 64-hex `computeShuffledOrder(orderingSeed, placementId)`) and a
`shuffledOrderSeed` marker, absent on a pinned lead and on a `manual` gallery.
[ADR-0009](adr/0009-seeded-random-gallery-ordering.md) decides that rule's contract
— a materialized, precomputed sort key recomputed on rotation, because GROQ has no hash
function to compute one live and keyset pagination needs a stored, sortable field —
narrowly split off AB#66's broader dynamic/keyword-gallery contract, which stays open.
Placement-level Studio validation (folded into the existing one-round-trip publication
query) blocks only the one _structurally impossible_ generated value — a `shuffledOrder`
present but not a 64-char hex string. Absent, now-stale, leftover-after-a-rule-switch, and
just-re-pinned states all publish fine, because those are transient and the recompute step
(which reads only published placements) resolves them — blocking would deadlock the
author. What that same validator now _does_ freeze once published is `placementId` itself
(alongside the media/gallery binding it already froze): it is an identity (ADR-0002 §1)
and the HMAC input for `shuffledOrder`, so renaming it in place would leave a read-only
key pointing at the old id with no `ordering-stale` signal — a re-identification is a new
placement. The `gallery`
document's publish block on `seeded-random` is lifted; `orderingSeed` gains the pagination
boundary's length ceiling and is rejected if it has surrounding whitespace (it is used
verbatim by `orderingScopeString`, the recompute step, and the stale-count query — an
inconsistent trim anywhere would strand the gallery `ordering-stale`). `src/lib/sanity-gallery.ts`'s
`readSanityCuratedGalleryPage` (AB#114) is the bounded, windowed read: two HTTP round trips
per page (this gallery's ordering rule, section catalog with intro, and a conservative
`visibilityVersion` derived from the most recently updated matching placement's
`_updatedAt`, then the placement window itself), composing `gallery-sections.ts`'s shared
`CuratedGallerySectionSource` contract — an id lookup for a named cursor boundary plus a
keyset range query for the rest, following Sanity's own documented `order > $after ||
(order == $after && placementId > $afterId)` idiom rather than array-slice offset
pagination — over `galleryPlacement` documents, filtered by `visible` and
`media->publiclyRenderable` in GROQ itself so a returned row is already within
`CuratedGallerySectionSource`'s contract and nothing here can silently shrink a page by
dropping a row after the fetch. For a `seeded-random` gallery (AB#129 PR2) the same read
adds `orderingSeed` and a bounded `staleShuffledOrderCount` aggregate to the basics query
(non-zero => `SanityGalleryError "ordering-stale"`, the two-step-rotation window), serves
the tiered order as two keyset lanes in one round trip — `pinned` (by `order`) then
non-pinned (by `shuffledOrder`), using `coalesce(pinned, false)` so a null/absent
`pinned` still counts as non-pinned — concatenated and sliced, because ADR-0009 §3's
tiered key cannot be one GROQ `order()` clause without a `select()` a fake-store test
cannot pin; and passes the scope string as an always-true `$orderingScope` param so the
window fetch-cache key varies by seed. `projectGalleryPlacement` never rejects a whole gallery
over one placement whose media is not publicly renderable (ADR-0002 §3's AND-composition):
it resolves to no candidate row for that placement, distinct from throwing for a genuinely
malformed one — though the GROQ-side filter means this call site never actually exercises
that branch, since every row it sees already passed the same check server-side. A
~400-placement fixture, exercised against a fake Content Lake that answers the adapter's own
two query shapes rather than a general GROQ interpreter, walks the whole archive and a
150-item section spanning several pages with no duplicate or missing item.
AB#135 wires every content adapter above into its route-facing seam: `src/lib/gallery.ts`'s
`getGalleryPage`, `src/lib/content.ts`'s tree/redirects/listing/detail-page/sibling-navigation
reads, `src/lib/site-settings.ts`, `src/lib/home-content.ts`, and `src/lib/services.ts` all
dispatch on `SITE_CONTENT_SOURCE` — `mock` continues to read the fixture layer unchanged, and
`sanity` now reads every one of these adapters, never a mixed mock/Sanity page. Closing that
wiring surfaced two gaps the adapters themselves had not: `sanity-gallery.ts` gained a bounded
gallery listing-record read (`readPublicGalleryListingRecords`, mirroring the article
adapter's own chunked, byte-budgeted multi-id query, since a category branch can list
galleries and articles side by side) and `sanity-article.ts` gained a bounded two-row sibling
query (`readPublicArticleAdjacentRecords`, one HTTP round trip via a `^`-referenced keyset
comparison) — gallery sibling navigation stays unbuilt because no current route requests it.
A locale with no published categories, articles, or galleries is omitted from the
Sanity-backed tree entirely, matching the mock's own "unauthored locale is absent, not empty"
contract; a placement without its localized category still reaches the tree validator and
fails instead of being hidden as an empty locale. No adapter yet
records previously published path history (ADR-0003 decision 7's URL-change workflow remains
unbuilt), so a Sanity deployment's redirect map is honestly empty rather than borrowed from
the mock. `/services`' optional listing intro gained a matching optional `servicesIntro`
field on the `siteSettings` singleton (schema, adapter, and seed fixture), read through
`getSiteSettings()` rather than its own separate source, so the page never mixes an authored
catalog with fixture-only intro copy. `content.ts`'s Sanity tree build is wrapped in React's
`cache()` so the several seams one request touches (`resolveRequest`'s trees and redirects,
`getCategoryListing`, `getAdjacentContent`) share one per-locale read instead of repeating it,
without reintroducing the cross-request module cache AB#83's revalidation cannot reach.
The public-journey harness is
in place too — a production-build Playwright suite with an external-request guard, gated
in Azure Pipelines — carrying the home/navigation smoke test,
the content-tree journey (branches, the canonical detail route, redirects, and
404s), the curated gallery journey (each chrome surface's identity-resolved link
checked separately, the grid's reading order against DOM and lightbox order at one, two,
and three columns, the lightbox, canonical and `hreflang`/`x-default` metadata, the empty
gallery's accessible state, and the 404s for a cursor, an unknown slug, and the removed
`/portfolio` route), the gallery continuation journey (run with JavaScript disabled: four
pages walked through the real link with no duplicates or gaps, the continuation page's
compact heading and absent lead, its self-canonical metadata and absent alternates, its
link back to the first page, and the 404s for an unminted token, a token
issued by another gallery, and a repeated parameter), the gallery append journey (the
in-place append with its order and de-duplication, focus staying on the control until
completion moves it to the notice, a failed
continuation that keeps what is loaded and retries, the lightbox reading the grown list,
continuing past the last loaded item from inside the open viewer, and a failure that
neither closes it nor loses the item), the services journey (the listing, one service detail with its cover, price list,
and breadcrumb, the navigation between them and into the story section, and an unknown
slug's 404), the site-menu journey (its composition, the disclosure opened by pointer and
by keyboard and dismissed either way with focus return, the level-at-a-time Escape
unwind, ancestry marking, a branch below the menu reached from its landing page, and the
compact panel's viewport behavior), and the contact journey (a labelled form,
required-field and invalid-address reporting against the field that caused it, a
successful submission, a delivery failure that may pass later — announced,
referenced, and retried — and one a retry cannot fix, pointing at the direct
address). Those failure states are the endpoint's own answers rather than a
stubbed response: the sink adapter reports a chosen failure class for a reply-to
address on the reserved `delivery-failure.test` domain, which RFC 6761 makes
unreachable for a real enquiry and which a production deployment never builds.
Each test also arrives from its own synthetic address, so the endpoint's
per-client throttle bounds a client rather than the whole browser matrix.
Route-specific journey suites are separate stories that join the gate as their
features land.
The repository half of the customer-owned Preview environment is in place on top of it:
the function region and the Node major are pinned in `vercel.json` and `package.json`
rather than inherited from the platform, and a test fails the gate if the pipeline's pin
and the deployment's drift apart; the pipeline runs a second stage that deploys a
release candidate to Vercel only after every gate passes, only from `main`, never from a
pull request, and only once the pipeline-authorized Preview variable group's explicit
enable flag is true — so provisioning can remain incomplete without reddening the branch.
It builds and deploys the prebuilt output, binds the generated URL and immutable
deployment ID to the expected Vercel project and team through the authenticated API,
then asserts both access protection and an unscoped `noindex` before it publishes the
URL, because none of those properties implies the others. Failed or cancelled
verification deletes only that verified deployment ID.
On top of that, once a deployment is verified the stage repoints a stable
`*.vercel.app` **integration alias** (`PREVIEW_STABLE_ALIAS`, AB#136) at it, so a
Sanity webhook configured once with `https://<alias>/api/revalidate` keeps working
across ordinary redeploys instead of going stale. The repoint is a transaction
(`scripts/repoint-preview-alias.mts`, decision logic in `scripts/preview-alias.mts`):
it refuses the project's default production domain and any alias currently resolving to a
production deployment; a **revision gate** (AB#144) resolves `main`'s tip live
(`git ls-remote`) immediately before the assignment and, if this deployment's commit
(`$(Build.SourceVersion)`) is no longer that tip, leaves the alias untouched
(`superseded`, a pipeline warning, not a failure) — fail-closed if the tip can't be
resolved; the monotonic `createdAt` guard runs earlier and is retained as defence in depth
(including for an owner-run invocation of the same repoint script outside CI; a direct
`vercel alias` command bypasses it); the alias host is re-verified for the
same SSO challenge + exact `noindex`; and a failed re-verification restores the previous
target (or removes a first assignment) only while the alias still points at what that run
assigned. Concurrent `DeployPreview` runs are serialized by a stage-level exclusive lock
(`lockBehavior: sequential` + an Exclusive lock check on the variable group) — execution,
not commit order, which is why the revision gate exists. The alias is constrained to
`*.vercel.app` because only that inherits Standard Protection; a custom domain is refused.
Vercel omits its automatic `X-Robots-Tag: noindex` for an assigned alias (AC5's first live
run proved it, 2026-09-06), so `next.config.ts` supplies it for requests whose Host is
`PREVIEW_STABLE_ALIAS` — gated to `VERCEL_ENV === "preview"`, host-scoped so the generated
URL is untouched (`src/lib/preview-noindex-alias.ts`, ADR-0004 §3 2026-09-06 amendment) —
which makes `PREVIEW_STABLE_ALIAS` also a build-time input on the `vercel build` step.
`PREVIEW_STABLE_ALIAS` is required once the deploy stage is enabled.
`npm run verify:preview-alias` is the read-only check for handoff/rollback. The revision
gate never initiates an assignment for a candidate already known to be superseded; the
residual is that the alias may remain on its last verified `main` target after `main`
advances if the current-tip run has not itself succeeded. That target is stale relative
to the tip but remains verified and protected. A declined older run emits the
`superseded` warning. The tip is resolved through
the checkout's `origin`; a private-repo clone must enable `persistCredentials`. The live
AC5 "exercise against Preview" was owner-run and completed 2026-09-07–09 (first
assignment, ordinary redeploy with the webhook surviving, signed delivery, rollback and
roll-forward, alias-name rotation, bypass-secret rotation, and the handoff dry-run) —
evidence recorded on AB#136. ADR-0004 §3
has a 2026-08-31 amendment for the "generated URL, not a custom preview domain" clause.
The provisioning runbook, the Preview/Production environment split, and the recorded
promotion and rollback commands are `docs/deployment.md`.
Sample content seeding (AB#84) sits on top of every schema and adapter above: an
owner-run script (`npm run seed:sanity`, `scripts/seed-sanity-content.mts`) that writes
474 sample documents — a 3-level category tree, one published settings and home
singleton, 3 services, 3 article documents (one page authored in both `fi` and `en`,
one `fi`-only, exercising ADR-0003 decision 7's independent per-language publication),
3 galleries, and 451 gallery placements — into a real Content Lake over the plain
mutate/asset-upload HTTP API, never through a Studio and never wired into the
application or CI. Every seeded document's own six real, already-vetted demo
photographs (`public/gallery/*.webp`) back all 6 minted `media` documents — never more
identities than there are photographs, per ADR-0002 — reused across hundreds of
placements, including one photograph placed in both galleries under two different
`placementId`s to prove identity survives reuse. One gallery (`featured`) has two named
sections and a body; `archive` has neither and carries the 400 placements that exercise
AB#114's keyset-paginated read across several pages; `shuffled` (AB#129 PR2) is a
`seeded-random` gallery of 25 placements — 3 pinned leads, 22 with pre-computed
`shuffledOrder` keys — so the seed run writes a gallery that is already a consistent
generation and `verify:sanity-live` can walk its materialized tiered order. Every document's
`_id` is a public, root-level, dot-free `seed--` id: Sanity restricts dot-path ids to
authenticated reads even in a public dataset, so the fixture cannot use `path()` as its
namespace without becoming invisible to the application's tokenless public reads.
Cleanup normalizes published, draft, and release ids and recognizes the reserved prefix
locally; the legacy private `seed.…` ids from the first implementation are recognized
for deletion but never written. The write is fully self-policed: because Sanity's mutate API
does not run a Studio's async validation rules, `sanity-seed-fixtures.mts`'s own
`validateSeedFixtures` re-derives every invariant an API import could otherwise violate
(unique identities, every reference resolving to the right document type, an acyclic
category tree, deterministic `_key`s on every array item so a later hand-edit in
Studio is safe) before a byte is sent, and a preflight query refuses to run at all if a
another `siteSettings`/`homePage` document already exists, rather than silently
creating a second published singleton. `--yes` ends with a live verification step:
hand-written GROQ existence/shape checks run against the dataset just written, so a
future owner-run external write can prove the "representative content queries pass"
acceptance criterion against that real project rather than a fake one. PR #62 did not
run this write-enabled path against an external dataset. The command also reports (or,
with `--prune-stale`, deletes) any
previously seeded document a shrunk fixture no longer includes. `docs/sanity-seeding.md`
is the full runbook: the write-token story (a separate, write-scoped
`SANITY_SEED_TOKEN`, never the runtime app's read-only `SANITY_READ_TOKEN`), the
go-live checklist that empties and verifies every seed-owned document and the six
uploaded assets (which mint their own non-`seed--` ids and need a manual Studio
deletion, disclosed rather than automated at six files), and export/recovery through
Sanity's own `dataset export`/`import` CLI. Seeding a dataset did not, on its own, change
what any route reads — every page rendered from the mock layer until AB#135's route-facing
switch landed (below), so a seeded project and the live site were two separate, unconnected
facts until that story shipped. A deployment declaring `SITE_CONTENT_SOURCE=sanity` now
renders this seeded content for real.
`/sitemap.xml` and `/robots.txt` (AB#85) sit on top of the public content tree,
locale route configuration, and services boundary: fixed, language-neutral root
routes per ADR-0003, generated from `src/lib/sitemap.ts`'s `buildSitemapPaths`, a
pure function over exactly the seams route pages already read — `content.ts`'s
`getContentTrees`, `services.ts`'s `getServices`, and deployment-owned locale route
config — rather than a second query of its own, so a route not public, renderable,
and indexable there is not public, renderable, and indexable here either. Category
and content paths come from `content-tree.ts`'s `listPublicRoutePaths`, generalized
from that module's own pre-existing private path index rather than a duplicated
walk; a configured locale with no published tree yet, and a published tree with no
public category yet, are both omitted the same way `resolveStoryRoute` 404s them,
rather than emitting a URL that does not resolve. A gallery or category's `?cursor=`
continuation and a gallery's `?section=` filter never enter the list, because they
are not category-tree or static-page identities the walk ever reaches, matching
ADR-0003 decision 8's parameter-free-only sitemap-eligibility rule exactly. A
duplicate generated path is treated as a defect and throws rather than being
silently deduplicated, the same posture `content-tree.ts` already takes toward its
own structural invariants. `src/app/sitemap.ts` declares `force-dynamic`, because
Next.js caches a metadata-route file like this one at build time by default —
confirmed against the framework's own documentation — which would freeze the list
against every later publish, unpublish, or slug change the AB#83 freshness target
requires; `robots.txt` needs no such override, because it depends only on
deployment settings — a production build prerenders it as a static file (`○
/robots.txt`), so a settings change reaches it with the next deployment. `robots.txt`
expresses crawl guidance only, never access control:
`src/lib/robots.ts`'s `buildRobotsPolicy` disallows everything for a non-production
`SITE_DEPLOYMENT_STAGE` as defense in depth, while a Preview deployment's actual
protection remains the platform's own access control plus its `X-Robots-Tag:
noindex` header, per `docs/deployment.md`. A production deployment may also name
crawlers to keep off the whole site (AB#181, `SITE_ROBOTS_DISALLOWED_AGENTS`, empty by
default): they get their own `Disallow: /` group ahead of `*`, for SEO-tool crawlers that
spend the hosting plan's allowances and bring no visitors. Two scope boundaries were considered and
deliberately left alone rather than built speculatively: verifying that a
tree-canonical placement's underlying detail record still exists would mean loading
a full page body (or gallery page) per candidate during sitemap generation, the
exact "a listing loads a body" pattern `content-listing.ts` and
`mock-content-pages.ts` already reject elsewhere, so this boundary trusts the
tree's `published` and canonical-placement state the same way `content.ts`'s own
listing-record query does; and ADR-0002 §4's reserved, route-owned `indexable` field
— letting an author keep one public gallery or article out of the sitemap without
unpublishing it — is not implemented anywhere in `content-tree.ts`, the article or
gallery Sanity schemas, or the mock fixtures yet, so there is no such state for the
sitemap to consult today. Both are documented as deliberate, not silently dropped.
AB#19's legacy-URL redirect registry (`src/lib/legacy-redirects.ts`) is partially
built: a generic pure validated lookup wired into `src/proxy.ts` emits literal `301`
redirects and justified `410 Gone` responses. First-site deployment configuration stays
in `legacy-redirects-data.ts`; the crawl projection and completeness classifications
stay beside it, outside the request-time bundle. Every distinct inventory path belongs
to exactly one decided, pending, excluded, or already-live bucket. Direct canonical
same-language targets and explicit category-ancestry/home fallback policy follow
ADR-0003 decision 9; unknown URLs retain ordinary not-found behavior.

**Imported-content redirect preparation, 2026-10-09 (AB#19, Active):**
138 further direct rows preserve verified Joomla article/gallery/category identities,
including Finnish `/fi` aliases and differently spelled English slugs. All 98 distinct
new targets returned anonymous direct 200 HTML with the expected main heading,
configured language and exact canonical on the activated Production renderer. This
branch now includes the twelve service rows merged in PR #318 and accounts for 189
redirects, 174 tag-page 410s, 48 pending paths, three excluded error pages and one live
root. The content/category and service sources are disjoint. These rows are committed
for PR #319 but not deployed to the public Production alias; the mock journey verifies
301 locations, while target availability comes from the dated live GET evidence. Full inventory acceptance remains blocked by
pending decisions. The clone scaffold 404 journey applies only without an explicit legacy decision for that source; decided 301s are covered by the separate legacy journey. [Scope and evidence](audits/ab19-content-redirects-2026-10-09.md).

**Legacy target semantics, 2026-10-07 (AB#211):** the owner-run verification
requires genuine HTML metadata and nonempty HTML status text outside hidden or inert
subtrees. Foreign canonical/alternate lookalikes, comments and hidden-child-only notices
are excluded. Computed CSS visibility and exact localized copy still need browser checks;
no mapping decision or AB#19 live-target acceptance is implied.

**Legacy review export, 2026-10-06 (AB#209, Active):** optional `report --csv`
exports pending exact paths/statuses with blank owner decisions. Formula-safe
semicolon CSV leaves JSON/check behavior and the redirect registry unchanged.
AB#19 accepted mapping and post-import target verification remain open.

**Published service redirect preparation, 2026-10-09 (AB#19, Active):**
ADR-0021's seven owner-approved service mappings and their five redundant Finnish aliases
now have direct `301` rows prepared in this branch. The fresh Joomla backup proves exact
published source-menu identities; all seven targets answered `200` with matching language
and canonical metadata on the activated renderer. The registry now accounts for **51
redirects, 174 justified tag-page `410`s, 186 pending paths, three excluded error paths,
and one already-live root**. The mock production-build journey verifies every new service
row's target and query policy without depending on first-site CMS content. Runtime rows
have not yet been deployed; pending package URLs and post-import content decisions remain
open. [Audit and limits](audits/ab19-service-redirects-2026-10-09.md).

**Published package follow-up, 2026-10-09 (AB#19, Active):**
Two additional owner-requested FI wedding services were separately published and verified on the activated renderer after the original import audits and a fresh complete baseline. Four matching legacy source rows, including their redundant Finnish aliases, are now prepared as direct permanent redirects. Source menu/article identities and an independent literal pair guard keep the two offerings distinct; canonical/language, prices, listing, sitemap and contact prefills were verified separately from the generic test harness. The prepared registry has 51 redirects and 186 pending paths among the same 415. These rows are not yet deployed; AB#19 and the wider AB#137 launch remain Active. The original 9,918-document / 3,512-image import passed independent byte/data verification and 494 public route/gallery GET cases before the separate service operation. The temporary migration writer has been revoked with a confirmed 401 denial. All old service content and timestamps stayed unchanged; the createIfNotExists parent wave changed only that one parent revision, recorded separately in the private audit.

### AB#275 — published English service replacements (2026-10-13)

**AB#280 continuation, 2026-10-13:** [The old English Blog path](audits/ab280-published-blog-alias-2026-10-13.md) now resolves directly to `/en/stories/blog` after the explicitly approved eighteen-article publication made that category public. Only `/en/blog` changes; all other mapping bytes, query policies and 415 classifications remain. Lint, 6,061 tests, production build and 132 Chromium/WebKit cases pass (four data-dependent skips); actual-CMS local probes verify direct 301/200 and canonical agreement. AB#280 remains Active pending PR review/merge; parent AB#19 and final deployed/launch checks remain open. No CMS, DNS or deployment mutation in this branch.

[Five direct service replacements](audits/ab275-published-service-aliases-2026-10-13.md) promote the funeral, property, ceremony, half-day and full-day English legacy aliases from ancestry fallbacks to now-published canonical service targets. All other source bytes and 415 classifications are preserved; the English Blog and distinct over-twelve-hour package fallbacks remain. Actual-CMS local production probes verify five direct 301/200 pairs and canonicals; lint, 6,061 tests, production build and 132 Chromium/WebKit redirect/notice cases pass (four data-dependent skips). AB#275 remains Active pending PR review/merge; merged AB#271 is verified Closed and parent AB#19 remains Active. Final deployed verification and remaining launch gates are open; no CMS, DNS or deployment mutation in this branch.

### AB#271 — remaining legacy decisions and service fallback notices (2026-10-13)

[Source-bound decisions](audits/ab271-remaining-legacy-decisions-2026-10-13.md) resolve the final 37 inventory paths: ten published equivalents and 27 explicit same-language ancestry/home fallbacks with a fixed accessible noindex notice. Service ancestors/listings now render that existing notice contract. The wedding portfolio and over-twelve-hour packages retain their distinct identities; service-listing aliases target the configured Finnish canonical. All 415 classifications pass against the real-CMS local production build: 232 redirects, 179 Gone, zero pending, three excluded and one live. English copy publication can promote six fallback targets to exact replacements; a fallback is not a translated missing page. Final deployed-source/canonical verification remains outstanding. AB#271 and parent AB#19 remain Active; no CMS, DNS or deployment mutation.

### AB#19 — eleven verified final decisions and raw-query correction (2026-10-12)

The owner-requested continuation resolves one numeric camera-review alias, seven
explicit Common-category article fallbacks and three justified Komento-profile
410s from fresh backup/menu/category and current target evidence. All 415 sources
remain accounted for: 197 redirect / 177 gone / 37 pending / three excluded / one
live. Production's previous 367 decided rows all passed live expectations; new
rows are not claimed deployed. `pending <origin>` observes unresolved responses
without making decisions or approving omissions. A production-build regression
exposed Next's reconstruction of a bare numeric query flag; the documented
`skipProxyUrlNormalize` setting preserves the original URL, with the complete
895-pass / 38-skip journey matrix after the boundary correction. Final row-specific
checks accompany the PR. [The decision receipt](audits/ab19-final-decisions-2026-10-12.md)
records all 37 remaining paths, source identity distinctions and deployment limits.
AB#19 stays Active; no CMS, DNS or alias write and no complete launch acceptance.

**Protected candidate legacy verification, 2026-10-13 (AB#283, Active):**
[The separate source-bound check](audits/ab283-protected-legacy-verification-2026-10-13.md)
reuses the full registry/target verifier after ownership, clean-source, protection
and noindex checks. The bypass is resolved only after identity/source acceptance
and remains on the exact HTTPS origin with manual redirects and bounded reads.
Mapping/engine bytes must match the frozen Git source; private receipts reserve
final Production and owner acceptance. No mapping or provider mutation.

**Mapping verification tooling, 2026-10-02 (AB#19, still Active):** the full Boards
attachment contains 442 URL records; the committed inventory projects them to 415
path/status observations. That checkpoint had **39 redirects** (three structural,
36 imported-content/category rows), **174 justified tag-page `410`s**, **198 pending**
paths, three excluded Joomla error routes, and one already-live root. The 36 content rows
cover the ten migrated rally galleries and their category landings in Finnish, redundant
`/fi` aliases, and English; AB#19's 2026-09-25 discussion records deployed spot checks.
`component/komento/*` (unresolved profile intent), `sivustokartta/*` (content aliases), remaining
galleries/articles/static routes, and the two owner-confirmed Monza 2008 timeout paths
remain pending reviewed targets or fallbacks. The real Joomla `/portfolio` page is also
pending; removing the template's never-deployed scaffold at that spelling never disposed
of the production legacy URL.

`npm run verify:legacy-redirects -- report` now exports every path and its decision,
original projected status, query/fallback policy, and calculated counts. Invalid raw
mapping entries or incomplete/overlapping bookkeeping fail generation independently of
the runtime fail-open wrapper. `check <origin> [<canonical-origin>]` probes each decided
response and each distinct target without following redirects, requires the expected
status and exact parameter-free canonical, and checks fallback noindex/status markup.
It sends anonymous GETs only, accepts no credentials, and retains no response HTML or
raw provider errors in the report. Any failed probe or pending decision prevents a pass.
See `docs/deployment.md` for usage and limits. The existing CI target allowlists remain
static guards; owner-run checks establish liveness on the intended production build.
The mock browser suite verifies published-content `301` locations but cannot prove those
first-site targets, because it deliberately has different locales and generic content.
New production-build journeys exercise the existing fixed, accessible fallback notice
on the home and both locales' category pages, its noindex/parameter-free canonical,
invalid/repeated parameter behavior, and operation without JavaScript.

The numeric lightbox query policy is already decided: bare `?4738` and other unrelated
query state are preserved byte-for-byte; explicit per-row `cursor`/`section` handling
remains separate. The registry's structural `301` and tag `410` journeys exercise the
existing HTTP mechanics. **Final first-site content-target verification still depends
on AB#137's Production migration** and reviewed decisions for the remaining pending paths.
No phased launch manifest or completion of AB#19 is implied by the new tooling.
The category branch listing continuation is now built (AB#140 PR 2, ADR-0013): a branch
whose aggregated subtree exceeds `MAX_CONTENT_LISTING_PAGE_SIZE` pages through a keyset
`?cursor=` over `(publishedAt, contentId)`, signed with the shared
`GALLERY_CURSOR_SIGNING_KEY` (one HMAC primitive extracted to `keyset-cursor.ts`, one
secret for both cursor families). The cursor scope carries a conservative
`visibilityVersion` — a digest of the in-scope subtree category ids plus, for a store, the
most recent in-scope content `_updatedAt` (`readPublicCategoryListingContentVersion`); for
the mock, an in-memory `(contentId, publishedAt)` digest — so an authored-date edit or a
category re-parent invalidates an in-flight token with `stale`. `cursorDisposition` now
`carry`s a `?cursor=` at a `category` route (the story root still `reject`s one, having no
continuation contract); a token at a non-canonical spelling is validated by an injected
`categoryListingCursorNamesASlice` before a redirect. A continuation page is compact —
branch title marked "continued", a link back to the first page, the child-category
navigation, the language switch (which drops the cursor), then the grid — self-canonical
with its `?cursor=` and naming no `hreflang` alternates, and its control is a real `<a>`
so it pages through with no JavaScript (progressive in-place append is deliberately not
built). The invalid-cursor 404 offers the branch's own parameter-free page
(`not-found-return.ts`). Only the parameter-free URL enters the sitemap. Story-root listing
continuation is deliberately out of AB#140's scope.
The gallery-item enquiry (AB#60) is partially built — its server-only identity and
authorization seam (PR1) and its `POST /api/enquiry` endpoint (PR2); the lightbox entry
point and the e2e journey (PR3 / AB#123) remain. `src/lib/enquiry-media.ts`
(`import "server-only"`) takes a
**discriminated** request — `{kind:"curated", locale, contentId, itemId}` where
`itemId === placementId`, or `{kind:"dynamic", locale, itemId}` where `itemId === mediaId`
(ADR-0002 §1); the caller states the kind because the two identity spaces share one syntax
and inferring it would let a stale or wrong-container curated reference resolve as dynamic.
It validates the route locale against the configured locales and the identities against
the shared `MAX_ITEM_ID_LENGTH` bound, authorizes a curated request's container through the
public content tree (`getPublicContentRoute(..., "gallery")` — a published Sanity gallery
document alone does not establish a supported public route, and this check runs before the
content source is touched), then dispatches to a mock or Sanity resolver that composes
`publiclyRenderable && enquiryEligible && !privateOnly` (ADR-0002 §3/§4, plus
`dynamicallyDiscoverable` for a dynamic request per ADR-0012 §2, every flag compared strict
`=== true` so a pre-field document fails closed) and returns the stable `mediaId`, the
resolved caption/credit, and — from the private dataset only — the `archiveLocator`, as a
discriminated union whose dynamic arm cannot carry a `placementId`. `enquiryEligible` is a
new opt-in media field (both dataset visibilities); `archiveLocator` gains a 512-char
schema bound restated and pinned in the resolver, which raises `malformed-source` on a
value past it rather than passing it to a later email. The resolved target is
server-consumer-facing — the public gallery result contract carries none of these fields
and a serialization test proves the projection cannot start leaking them. The Sanity
**curated** path is a two-round-trip read (gallery `_id` for `contentId`+`language`, then
`galleryPlacement` scoped by `gallery._ref` so a sibling-language placement sharing the
`placementId` is never picked), explicitly projected, `[0...2]` ambiguity-detected; the
Sanity **dynamic** path fails closed (`dynamic-unsupported`, no query) until AB#58 (the
dynamic query and its result context) and AB#68 (`dynamicallyDiscoverable` in the model)
exist — the mock dynamic path is fully implemented and unit-tested. A classified
content-store failure during resolution surfaces through `classifyEnquiryFailure`: a
`SanityQueryError` (transport) keeps its own retry decision — `source-unavailable`
(retryable) or `source-error` (not) — while any other `Sanity…Error` (a read that
completed and returned a document the adapter refused to trust — content tree, article,
gallery, settings, media) becomes `malformed-source`. `resolveEnquiryTarget` wraps its
whole tree+source operation, and the route re-runs the same classifier over
`getSiteSettings()`/email composition, so a route never answers a raw provider error with
a bare 500 or an `accepted` event with no terminal.
`POST /api/enquiry` (PR2) reuses the contact path rather than restating it: the same
`checkContactRequestHeaders` ahead of the throttle, `readContactSubmission` (now taking an
optional `extraFields` whitelist — the contact route passes none, so its result shape is
unchanged) widened by exactly `kind`/`locale`/`contentId`/`itemId`, the same honeypot rule,
`buildEnquiryEmail` beside `buildContactEmail` in one delivery module, the shared
`jsonNoStore` + `DELIVERY_FAILURE_STATUS`, and one private `writeSubmissionLine` under two
separately-closed wrappers (`logContactEvent` / `logEnquiryEvent`, `event:"enquiry.submission"`).
Its own rate-limiter instance, so an enquiry and a contact message never spend each other's
allowance; its idempotency key is namespaced `enquiry:<submissionId>`. Every resolver
rejection collapses to one generic browser answer — `malformed-request` → 400, the five
identity/authorization rejections → one `404 {reason:"item-unavailable"}` that discloses
nothing, `source-unavailable` → 503 retryable, `source-error`/`malformed-source` → 500 —
while the operational log keeps the specific class. After the `accepted` event, every path
(resolution, settings read, email composition, delivery, an unclassifiable defect →
`internal`) writes exactly one terminal event. `archiveLocator` and the resolved
`mediaId`/caption/credit reach only the owner's email — never a response, never a log line
(route tests assert both).
PR3 adds the visitor-facing surface. The lightbox carries an "Enquire about this
photograph" control — a real `<a>` in the PhotoSwipe top bar whose `href` is the gallery's
own parameter-free path plus `?enquire=<itemId>` for the slide on screen (a stable string
prop, not a callback, so it does not churn the open viewer). ADR-0003 §8's 2026-08-30
amendment makes `?enquire=` a recognized gallery _action state_: a single value in the
shared public-identity grammar (`src/lib/public-identity.ts`, used by both the route parser
and `enquiry-media.ts` so they cannot drift), recognized only on a gallery route and only
with neither `cursor` nor `section` — `enquire` plus either is a 404 with no redirect,
resolved in `resolveLocalePrefixRequest` before the cursor/section refusal checks; an
unrecognized `enquire` is preserved through normalization and otherwise ignored. The view
is a `200` `noindex, follow` server form (`GalleryItemEnquiry`) whose canonical points at
the parameter-free gallery, with no `hreflang` and no sitemap entry; its metadata
short-circuits before any gallery-result read, so a gallery being reordered does not block
it. The form is `EnquiryForm` over a shared `SubmissionForm` extracted from `ContactForm`
(the status machine, honeypot, hydration guard, and error summary are now shared, not
duplicated; the idempotency `submissionId` is bound to message + endpoint + a discriminated
enquiry context, and the server page keys the form by `itemId` so a new `?enquire=` URL
starts fresh). It reuses the deployment-authored `SiteSettings.contact.privacyNotice` and
adds one generic line (`labels.enquiry.itemContextNotice`) that a reference to the
photograph travels with the message. `e2e/gallery-enquiry.spec.ts` walks the journey
(lightbox → second slide → Enter-key and click activation → the `?enquire=` form →
delivery, a `delivery-failure.test` failure + retry, a not-`enquiryEligible` item's
accessible refusal, a malformed `?enquire=` ignored, and `?enquire=`+`cursor=` → 404) and
asserts the `noindex`/gallery-canonical/absent-`hreflang` metadata.
No dynamic-result entry point (AB#58/AB#71 own the dynamic query and its UI); AB#60 stays
open until a real dynamic result can be wired in or its acceptance criteria are amended.
The identity/origin smoke is built (AB#123): `e2e/enquiry-identity.spec.ts` is a
production-build Playwright suite that proves the whole chain is _wired and enforced_ when
the app really runs — the browser-driven curated journey sends exactly the public context
(`kind`/`locale`/`contentId`/`itemId`, nothing resolved or private) and gets back only the
generic receipt, the enquiry view reuses the contact privacy notice, and a direct request
to the running endpoint covers the dynamic origin that has no UI (a dynamic reference
resolves; a dynamic request carrying a container is a `malformed-body`; an unknown
occurrence collapses to the one generic `404 item-unavailable`; the reused cross-origin and
content-type guards still hold). The resolution _semantics_ it complements — which trusted
`mediaId` a reference resolves to, context preservation, no invented placement, every
tampered/unknown/private/unpublished/non-enquirable class — are already proven against the
real mock content source by `src/lib/enquiry-media.test.ts`, the route's generic-answer
collapse and no-leak posture by `route.test.ts`, and `buildEnquiryEmail`'s private
`archiveLocator` handling by `contact-delivery.test.ts`, so the smoke asserts wiring and
the browser-only properties rather than re-deriving the matrix. It joins the Azure
Pipelines gate through `testMatch: "**/*.spec.ts"` — no pipeline change.
Not yet built:
localized static routes and localized authored settings — the contact route is
unprefixed-only for now — story-root listing continuation and progressive in-place append
for category listings (both deferred by ADR-0013) — a **true HTTP 503** for
the seeded gallery `ordering-stale` state _on the detail route_ — the `/api/gallery`
endpoint already returns a real 503, but PR2 serves the detail page as an accessible HTTP
200 + `noindex` because an App Router page render cannot set an arbitrary status (a
follow-up would route the gallery detail through a handler; **no open work item tracks
it** — AB#132 owns the related but distinct 404 initial-HTML limitation) — and its
`shuffledOrderGeneration` atomic-flip alternative to the brief recompute refusal window
(a documented ADR-0009 migration trigger, not built), the dynamic keyword-driven gallery
and archive search itself (ADR-0012 decides the query/cursor/route contract; AB#58/AB#71
build it), lightbox zoom tuning, and the dynamic-result enquiry entry point (AB#58/AB#71).
**AB#29 retention workflow, 2026-10-16:** provider-free bounded orchestration now
reuses the existing lifecycle policy, claims cleanup through revision/lease CAS,
resumes manifest slices and verifies whole-prefix absence before completion.
Expired-session reaping and backstop-policy checks have independent ports. No
production adapter, scheduler, object deletion or enablement is introduced.

Private client galleries are **partially built**: a link can be opened and exchanged for a
session, an authorized customer sees their gallery's frames, an operator can sign in to the
administrator boundary, and the delivery path is composed end to end — but all of it only
against a development fixture store. **A real deployment still serves nothing**, because
neither private store has been provisioned. Their security,
delivery, proof-selection, and retention boundary is
[ADR-0014](adr/0014-private-gallery-security-delivery-retention-boundary.md)
(AB#122, **Accepted**): a structural public/private isolation boundary, a
fragment-capability link exchanged for a server session, two-stage per-asset
authorization with direct short-lived signed object-store URLs (never a private byte
through a Function), an S3-compatible object store plus a separate PostgreSQL-family
private store, and a worker-authoritative six-month retention lifecycle. The one
canonical-rule change it makes is a scoped exception to "Public derivatives only" above,
for an authorized gallery-link/session holder — restoring the `private or
sales/fulfilment` clause that exception must not weaken. AB#29 (delivery + ZIP) builds on
it in slices and stays **Active**; **AB#145** (administration and customer notification,
split out of AB#29 on 2026-09-02) remains Active. AB#130 (proof selection)
is Active with server-only domain rules: pricing in integer minor units, natural
complete-filename reference assignment with a persisted high-water mark contract,
draft revision checks, versioned confirmation planning, and a first-ready transition
from verified watermarked objects. A separate first-publication plan now refuses
an expired or malformed upload preparation, missing or changed proof objects,
invalid frozen pricing, prior publication metadata, or a wrong state; on success
it supplies guarded `ready` → `published` fields and the six-calendar-month
access expiry. The development proof fixture runs both plans before seeding its
published gallery. No deployed store commits that publication yet, and the
administrator create/publish route, sealed customer link and notification are
still missing. The upload plan retains complete filename,
stable media identity and opaque placement identity, and a verified-object join
forms the initial placement rows. A pure confirmation-email projection includes
the required references, filenames, counts and amounts, using shared exact
currency formatting. A server-only gallery notification transport now validates
one recipient per attempt and reuses the existing Resend HTTP provider core;
the contact path keeps its fixed configured recipient. A server-only
proof-selection store contract and a development-only, single-process reference
implementation now exercise conditional draft edits, atomic confirmation
snapshot plus initial pending outbox insertion, administrator reopen, and unique
resend attempts. Each pending proof attempt now holds the exact validated
photographer email built from its confirmation and business references; its
recipient, wording, and image list are frozen with the attempt, while an
administrator status read returns only outbox metadata. A deliberate resend
copies that message under a new key. A server-only one-attempt dispatcher now
claims the queued message, sends its frozen request through an injected gallery
transport, and records sent or redacted failed status. The memory reference
allows three bounded claims per row, with a 30-second lease and 60-second
retry delay; an abandoned final claim becomes `worker-interrupted`. Automatic
retry keeps the same key, while a deliberate resend gets a separate row.
A bounded server-only batch runner now discovers at most 100 due proof attempts
through the store seam and dispatches them sequentially. It skips active
leases, includes expired leases and due retries, and reports only aggregate
counts; if a store call fails mid-batch, its redacted error retains the known
completed counts. The development store implements discovery for its one
fixture gallery. A future PostgreSQL adapter must query due rows with a
limit and indexes, and ensure repeated runs cannot starve another gallery.
`gallery-notification-transport.ts` now selects and validates this path's own
`resend` or development-only `sink` transport — no default, `sink` refused
outright in production, mirroring `buildContactDeliveryAdapter` exactly — but
no scheduler calls the batch runner: the durable worker runtime is still
unbuilt, the same open action item as the six-month
retention worker. The memory implementation is not durable across processes
or restarts and is not wired into a runtime route.
A server-only customer read facade now rechecks the session and live gallery
before fetching proof state by the authorized gallery id. Its browser-safe
projection returns at most 100 current proof cards per page and the draft
selection and pricing summary; confirmed review data comes from the immutable
snapshot, so a later placement removal cannot rewrite the accepted selection.
Malformed rows refuse the whole view. The development store reads draft and
current confirmation together in-process; a database adapter still needs a
consistent read and bounded page and selected-row queries. A server-only
customer mutation facade now checks JSON request provenance, method and streamed
64 KiB body limit, freshly authorizes the session, then edits or confirms by
draft revision. The store also compares the session capability generation with
the published gallery in the same write, so a replaced link cannot submit a
stale selection after the view lookup. The edit result includes the quote
calculated atomically from the frozen pricing; confirmation returns only safe
version and summary fields. A stale draft or locked selection is a conflict
only after authorization; expired or superseded access has one generic refusal.
A development-only proof fixture now joins the existing delivery fixture
under `PRIVATE_GALLERY_STORE=memory`: it has a distinct shareable link, two
watermarked proof placements with permanent references, frozen pricing and its
own process-local proof store. The new `/<private-prefix>/<handle>/proof` API
reads a session-authorized, browser-safe proof page and accepts revisioned
selection edits and confirmations; it responds with `no-store`, one generic
unauthorized refusal, and a conflict only for an authorized stale or locked
draft. A confirmation queues one pending photographer message in memory; no
transport dispatches it at request time. The development fixture serves no
object bytes and cannot run in Production or Preview.
The gallery page now renders a real customer proof selection / review /
confirm panel (`PrivateGalleryProofPanel`) for `kind === "proof"` instead of a
placeholder sentence: the first page is server-rendered (so a no-JavaScript
visitor still sees the current draft and price). Each visible card now mints a
short-lived preview URL through the authorized `/asset` route and renders its
native-ratio watermarked proof directly in an `<img>` with no referrer; image
failure remints once, then offers a manual retry. The per-page queue admits
four concurrent mints and 50 starts per rolling minute under the server's
per-session limit. Viewing the images, turning a page, editing checkboxes and
confirming all require JavaScript, stated on the page. A toggle
saves immediately as one whole-selection edit against the draft's
`expectedRevision`, and a confirmed gallery renders only the frozen
confirmation snapshot with no further edit control. `e2e/private-gallery-proof-flow.spec.ts`
exercises this against a real browser: the server-rendered first page,
the reserved frames' native ratios, the signed-preview mint and image-error
remint with intercepted object bytes, and — through a `page.route`
interception rather than the shared development fixture, which the whole
suite's "tests share no state" contract forbids one spec from mutating — the
full select/confirm interaction and its confirmed-review rendering. The
fixture still has no object store, so it cannot serve real signed proof bytes.
An administrator can now look up one proof gallery by its handle from the
signed-in administrator page (`PrivateGalleryProofAdminPanel`) and see its
draft/confirmation state, pricing, current selection summary, and — once
confirmed — the queued notification's delivery status: pending, sent, or
failed with its error class and next-retry time, read through
`readPrivateGalleryProofAdminStatus` and the store's latest-attempt outbox
projection, which already excludes every filename, selected image and
customer identity from this narrower "is the notification stuck" view. Two
administrator-only actions, `reopenPrivateGalleryProofAsAdmin` and
`resendPrivateGalleryProofNotificationAsAdmin`, reuse the store's existing
`reopen` and `queueResend` methods — a reopen unlocks the draft for a new
round of edits without touching any prior confirmation or outbox row, and a
resend queues a fresh delivery attempt under the same confirmation version,
repeatably, never a new one. `initialProofOutboxIdempotencyKey` is a shared helper for the
confirmation planner and memory store's resend lookup. The administrator
status instead selects the latest attempt for the current confirmation, so a
queued or failed resend cannot be masked by a previously sent attempt. `src/app/private-gallery-admin/proof/[handle]/route.ts` exposes this
as `GET`/`POST` JSON, re-authorizing the administrator session on every call;
`e2e/private-gallery-proof-admin.spec.ts` exercises a real administrator
sign-in against a `page.route`-mocked status/action surface, for the same
shared-fixture-mutation reason the customer flow spec mocks its mutations.
A separate AB#145 development-memory flow now creates private delivery drafts and
lists the latest 100, with an explicit more-results indicator and a bounded total
store capacity. Every call rechecks administrator authorization; the create path
validates same-origin JSON before authorization and reads at most 1 KiB after it.
Optional bounded customer/job references do not create AB#28 records. The FI/EN
form creates no capability, notification or customer access, and the list omits
internal IDs and storage keys. Production persistence, uploads/readiness,
publication/outbox, notification/resend and revoke/replace remain unfinished;
this non-destructive creation slice does not exercise the re-authentication gate.
Delivery drafts also support revision-guarded replacement of external customer/job
references through administrator-only `PATCH` and a FI/EN inline editor. Omitted
references in the replacement object clear the previous value. A stale edit returns
409 and preserves the entered text until the operator explicitly refreshes the list.
Each successful save advances the revision once, including an identical replacement.
This reversible development-memory operation does not publish or grant customer access.
A server-only AB#29 first-delivery workflow now commits the complete preview/ZIP
plan with `draft → preparing`, then verifies its exact metadata set before one
revision-guarded `preparing → ready` mutation. That commit stores native-ratio
preview placements, verified metadata and the active immutable ZIP pointer together.
The first plan requires previews and exactly one ZIP; its 1,000-object bound includes
the ZIP. Missing/mismatched objects, stale revisions and expired preparations leave
the whole setup unchanged. A returned plan or row cannot mutate the stored snapshot.
The shared bounded evidence copier also serves the existing proof completion path.
This is development-memory coordination only: no HTTP/CLI upload, object write,
capability, publication or email is added. Dimensions and ZIP membership remain
owner-attested; live checksum/version semantics and immutable-write guarantees still
need the approved provider gate. Expired preparations follow retention rather than an
unapproved `preparing → draft` transition. Both AB#29 and AB#145 remain Active.

A server-only FI/EN delivery-notification builder now creates customer access
instructions from a currently published delivery record and its encrypted capability.
The envelope is authenticated against gallery, handle and current generation before
a fragment-only HTTPS link is rendered. The message includes shareability, one ZIP
and an explicit UTC expiry; invalid, expired or retired-generation material is refused.
This is a transient message builder only: no publication, outbox activation, provider
send or production enablement is added. A future dispatcher must re-read live metadata
and keep only encrypted capability material at rest, never the rendered email body.
AB#145 was verified Active before edits and remains Active pending acceptance.
CI #1047 exposed a shared test login budget: gallery-management journeys now
reuse a real administrator session per Playwright worker. Each test retains its
own browser context, client address and gallery state. Sign-in/sign-out journeys
still exercise the actual authentication flow, and the application retains its
unchanged 30-attempt deployment limit and per-client limit.
A separate development-memory administrator flow now creates and lists
prepublication proof drafts. It accepts validated, nonnegative pricing and
optional bounded customer/job external references, mints an internal gallery
identity and handle, and exposes no capability or customer access link. The
`GET` list is capped at 100 and reports whether more rows exist. Each call
reauthorizes the administrator; `POST` checks same-origin JSON and a streamed
1 KiB body bound before parsing. The draft store is separate from the
published fixture's customer exchange, view, and proof stores, so creating a
draft cannot give a customer access. The development proof store now caps its own
lifetime at 1,000 setup rows before generating a new identity. Concurrent final
creates cannot exceed it, and a full store refuses creation with the existing
redacted 503 response without evicting drafts or blocking preparation/completion.
Reset/restart releases these process-local rows; this is a memory guard, not a
production retention policy or the separate per-gallery file ceiling.
This is not yet relational customer/job
association: no customer or job domain records exist (AB#28).
AB#196 adds a [single-photographer operations worksheet](photographer-operations.md)
for AB#28. It maps the parent criteria into decisions and unapproved slices;
customer, contract and billing functionality remains disabled and unimplemented.
A separate
administrator-only `PATCH` now replaces a prepublication draft's complete
pricing candidate through a revision-guarded memory-store update; stale tabs
receive a conflict and refresh the bounded list. The candidate remains mutable
until the first ready transaction freezes it. Abandoned-draft
cleanup, publication and production persistence remain.
The development proof draft store now has a server-only first-upload preparation
operation. It validates a complete watermarked-proof manifest with the existing bounded
planner, assigns opaque object keys and placement identities, and commits that plan with
`draft → preparing` and a revision bump in one process-local synchronous mutation.
Stale or repeated opens fail without a partial plan. The plan holds no pricing; the
candidate remains editable while `preparing`. A server-only completion operation now
reconciles bounded server-side metadata observations against that exact stored plan,
checks its preparation deadline and revision, and commits `preparing → ready` with the
current pricing snapshot, permanent filename-ordered references, reference high-water mark
and verified metadata in one process-local mutation. Missing/mismatched objects leave the
whole row unchanged; stale or repeated completion conflicts without refreezing references.
The stored prefix cannot be broadened at completion. Receipts alone establish nothing;
checksum comparison applies only when both receipt and provider metadata name the same
algorithm, so live provider checksum/version semantics remain a separate verification gate.
A shared server-only metadata collector now reads only the committed preparation's
exact object keys through a read-only `head` port. It snapshots and scopes the plan,
binds observations to requested keys, runs at most eight reads concurrently, and
bounds each read and the entire pass. Abort, transport uncertainty, malformed data
or expiry refuses the whole pass; only definitive not-found is omitted, leaving
store completion unready. Late uncooperative responses cannot admit further reads
or become unhandled rejections. Results are detached/frozen and remain internal;
store completion still rechecks revision and deadline. No S3 adapter or live provider
is connected, and HEAD does not prove immutable bytes, ZIP membership or pixels.
The existing admin JSON projection excludes the plan, keys and frozen internal records.

Administrator proof drafts now support complete replacement or clearing of their
external customer/job references through an authenticated, bounded PUT (AB#130).
Draft and preparing rows remain editable; ready rows are frozen. FI/EN editors
share a per-row mutation lock with pricing, keep typed references through a
pricing save, and preserve conflicting text until an explicit list refresh.
This uses the existing external identifiers, not customer/job domain records.
The CI follow-up preserves the conflict response when the process-wide memory
store throws an error from another route bundle's module instance. A module-reload
regression and explicit browser HTTP-409 assertions cover this boundary.

Administrator proof and delivery draft lists now continue beyond the first 100 rows
with authenticated, uncached cursor pages and FI/EN load-older controls (AB#130,
AB#145). Each response is bounded to 100 rows. The shared browser loader ignores
canceled reads, deduplicates overlaps and preserves acknowledged edits/creations;
refresh deliberately returns to the first page. Handles in cursors are non-secret
identifiers; they grant no customer access. This is a development-memory slice;
neither story is complete.
Creation before the first successful list read also recovers older drafts without
discarding acknowledged rows. Pagination keeps keyboard focus on a stable control
and announces the loaded count in Finnish and English. Overlapping pages keep
already-visible fields and their original revision; an explicit refresh loads remote
changes without silently discarding an unfinished edit.

The administrator projection now adds only the prepublication state and a bounded
upload summary (object count, opening time, deadline and expiry at response time).
The FI/EN list distinguishes draft, preparing and prepared-but-unshared proofs;
prepared terms have no pricing editor. The absolute UTC deadline remains visible,
including after ready: first publication must still precede it. The displayed expiry
is explicitly a response snapshot; server-side operations recheck the deadline.
A malformed privileged record refuses the whole list with the existing unavailable
response. The existing admin JSON projection excludes the plan, keys and frozen internal records.
This has no HTTP or owner-CLI upload path, no object writes and no customer access.
`preparing → draft` is not an ADR-0014 transition; the story's reopen operation applies
to a confirmed customer selection after publication. An incorrect/abandoned preparation
must follow the deletion and recreation path when durable storage exists.
A separate first-delivery publication planner now checks the ready gallery's entire
private placement/object set, active ZIP, preparation window and first-publication
metadata before proposing its publication time and six-calendar-month expiry. It
returns only a redacted first blocker or a server-only metadata plan. Preview order
values must be positive and unique; gaps do not imply a missing object because every
placement must join the complete verified preparation set. The future adapter must
lock/re-read that full set in its publication transaction with the sealed capability
and unique initial outbox insert; state/generation alone are insufficient. This pure
planner adds no administrator route, state write, notification or customer access.
AB#145 and AB#29 remain Active.
No PostgreSQL proof store, durable outbox worker, runtime mail wiring or
production customer workflow exists yet.

Built so far, all of it behind `PRIVATE_GALLERY_STORE=off` (the default) with **no production store
adapter and no provisioned infrastructure**, so an `enabled` deployment throws on the
first request that needs a store rather than half-serving: the
isolation boundary and validated two-phase configuration, the domain model and its
nine-state machine, and the `privateOnly` fail-closed guard on every public projection
(#101); the reserved route namespace's response hygiene in `src/proxy.ts` — `no-store`,
`noindex, nofollow`, `Referrer-Policy: no-referrer` — plus `robots.txt`'s `Disallow` (#102);
the AES-256-GCM capability envelope with its canonical associated data and rotation
primitives (#103); the session model and its per-gallery-path `__Secure-` cookie contract
(#104); and the capability exchange's two rate-limiting layers, its gallery/capability
lookup, and the constant-time verification of a submitted capability, behind
`src/lib/private-gallery-access.ts` — the one facade a route may import, since it owns an
ordering a route must not reassemble (#105).
An owner-run offline upload-source planner now reads bounded local JPEG exports and
streams the complete delivery ZIP to prepare a private source manifest and byte
hash report. It preserves bytes, true dimensions, proof filenames/stable media IDs
and declared order; the output is contract-tested against the server upload planner.
Filesystem/path/alias checks and owner-private exclusive artifacts keep source data
out of Git and public payloads. Watermarks remain owner-attested; ZIP signature is
not archive/CRC/membership verification. It assigns no object keys, uploads nothing
and grants no customer access. Direct Node execution shares the existing policy and
field validators without a build step. AB#29 and AB#130 remain Active.

The link and its exchange are now routes: the Proxy rewrites the deployment-configured
prefix onto a reserved internal segment (`/private-gallery`, `request-path.ts`) so a
file-system route can serve a configurable public path, and refuses a direct request to
that segment. **Next.js runs the Proxy again on the path it rewrote to** — measured
against a production build, not assumed — so the internal branch tells its own second pass
apart from a stranger by the request path the first pass carried, and answers it with a
`next()` rather than a second rewrite, because only a `next()` response's headers replace
`next.config.ts`'s site-wide `Referrer-Policy` (a `rewrite()`'s do not, which silently cost
§6's `no-referrer` until `e2e/private-route-hygiene.spec.ts` caught it). That header check
is namespace hygiene, not authorization: it keeps a second URL shape away from crawlers and
links, and a forged header reaches only a page that looks nothing up and an exchange that
still demands the real capability. The bootstrap document renders identically for every
well-formed handle and **looks nothing up**, because the capability is in the fragment and
a browser never sends one; `public/private-gallery-bootstrap.js` (an external same-origin
file loaded before router initialization through the private root layout) reads it,
strips it from the address bar with
`replaceState`, and posts it to `POST <prefix>/<handle>/exchange`, which answers a session
cookie or **one indistinguishable 403** for every failure class — same status, same body,
no `Retry-After` — so nothing separates an unknown handle from a throttled known one.
AB#199 corrects the proved startup race in which Next 16.3.8 could restore a fragment
already scrubbed by the former deferred script. `beforeInteractive` keeps that
credential out of the router's initial URL; a local pending capture waits for parsed
bootstrap markup, and an authorized document starts no exchange. Next's inline startup
queue contains only the fixed script path under ADR-0011's existing CSP residual.
History traversal, generic refusal, original history state and production limits remain
in force; VM startup regressions supplement the production-build browser journeys.
`PRIVATE_GALLERY_STORE=memory` is a development-only fixture store (accepted only where
`SITE_DEPLOYMENT_STAGE` is `development` — preview is refused as well as production, since
it is a shared environment standing in for production) whose published, non-secret link is what the
Playwright journey and a local `npm run dev` actually exercise; it seals that fixture under
an ephemeral per-process key and never reads the deployment keyring.
That same address then serves a second document: with a session cookie that currently
authorizes _this_ gallery it renders the gallery itself, and ADR-0014 §5 Stage 1 is
re-derived on **every** request from the cookie plus a fresh gallery read, so a revoke or a
closed access window takes effect on the next navigation rather than whenever the session
would have run out. The gallery is read by the **session's own `galleryId`**, never by the
handle in the URL: a `findGalleryByHandle` would be an unauthenticated lookup primitive
over a caller-supplied string, so the requested handle is instead compared against what the
session already named. Every unauthorized outcome — no session, an expired one, a
superseded capability generation, a session belonging to another gallery — renders the same
bootstrap document, so the page is no more of an existence oracle than the exchange is. The
authorized view is deliberately thin: it names the access window and says the photographs
are not viewable yet, because §5 Stage 2's per-asset signed URLs need the object store that
does not exist; an empty grid would claim the gallery had been delivered and found empty.
Building it surfaced a defect in the fixture store that a single-process assumption had
hidden: **Next.js compiles each route into its own server bundle, so a module imported by
both the exchange Route Handler and the page is instantiated twice under one `next start`**
— measured with a construction probe against a production build — which gave the two routes
two different fixtures and made a session minted by one invisible to the other. The
singleton is now pinned to `globalThis`, the pattern Next.js documents for a
development-only client; the Postgres adapter keeps its state in Postgres and never had the
problem.
The six-month lifecycle's _rules_ are built too, as pure policy over the state machine
(`src/lib/private-gallery-retention.ts`), the same split the exchange rate limiter already
uses: `computePrivateGalleryAccessExpiry` adds six to the **UTC** month and clamps to the
target month's last day with the time of day preserved — calendar months rather than 180
days, because "six months" is what a photographer tells a customer, and the ADR's own
worked examples are golden vectors; `evaluatePrivateGalleryRetention` decides what one
scheduled run does with one gallery (an abandoned preparation, a reached access expiry, a
revoked gallery never replaced, cleanup due, a failed deletion retried until a human
acknowledges it), refusing to treat a **missing** retention timestamp as an unreached
deadline, because one corrupt row would otherwise keep private objects alive indefinitely.
Every proposed transition is checked against the state machine, so this module cannot
invent an edge; nothing here ever proposes a way back to `published` (§7's deletion guard).
The 275-day backstop bucket age is pinned to the parts it is derived from — preparation +
the longest six-calendar-month span (184 days) + suspension + deletion grace + a day — so
lowering a window without revisiting the rule fails a test, and
`assertPrivateGalleryRetentionWindows` makes "a deployment may lower a window but never
raise one" executable rather than advisory. The development fixture publishes through the
real clock rather than an approximation. **The worker that performs the IO is not built** —
ADR-0014 names it as its own action item and it needs both stores; its schedule (at least
every 24 hours) and the backstop lifecycle policy are in `docs/deployment.md` so they can
be provisioned with everything else.
ADR-0014 §5 **Stage 2's decision** is built as pure policy too
(`src/lib/private-gallery-delivery.ts`) — everything that happens before a signature,
which is where the security is: a signer handed the wrong key or an unbounded expiry is
correct and useless. `PrivateGalleryMintRequest` has **no object-key field**, so a caller
names a `placementId` this deployment minted or nothing at all for the gallery's one ZIP,
and the key comes back from the store row — the type is what stops the endpoint being an
IDOR probe or a signing oracle, rather than a validation someone must remember. Stage 1's
state and generation are re-checked rather than inherited, because minting is the step
that hands out bytes and a gallery can leave `published` between a page render and a click
on the download control; a placement or ZIP row belonging to another gallery is refused,
and a ZIP is only ever signed against `activeZipObjectKey` (§8c makes the pointer the sole
answer to "which version is current"). `computePrivateGallerySignedUrlTtlSeconds` is
`min(configuredTTL, accessExpiresAt − now)` floored to seconds, with per-kind ceilings —
single-digit minutes for a preview, six hours for the ZIP — that a deployment may shorten
and never lengthen, since the TTL is exactly what a leaked URL is worth. §8e's per-gallery
access budget (10× the gallery's own bytes, charged at full nominal size on every mint,
keyed by gallery **and** capability generation so re-exchanging does not reset it) is a
counter evaluator of the same shape as the exchange's, consulted only after every free
check has passed so an unauthorized request cannot spend a gallery's allowance; a corrupt
row throws rather than resetting, the one direction a budget must not fail. The window is
**fixed rather than rolling**, which ADR-0014 §8e's 2026-09-02 amendment now says outright
after this slice found the table and the design disagreeing: one persisted counter row
cannot express a rolling window (that needs every mint's timestamp — a thousand rows per
browse of a 1 000-file gallery, summed on every image load), so up to twice the allowance
can be spent across a boundary. Accepted because the budget counts _authorizations, not
delivered bytes_ — a replayed URL costs nothing and `Range` is invisible — so precision was
never available where it would matter; a two-counter sliding approximation (~1.1×) is the
recorded upgrade path if Fair Transfer pressure ever makes the burst shape matter.
What a private item may _be_, once it crosses into a browser payload, is fixed too
(`src/lib/private-gallery-item.ts`) — the private counterpart of `projectPublicMedia`, for
the same reason: a store row carries more than a page may render, and the safe subset is
produced by one function rather than remembered at each call site. A `PrivateGalleryItem`
has **no `objectKey`** (a page holding one could ask for a signature by naming it, the
exact request shape the delivery boundary refuses), no `galleryId`, and no `nominalBytes`;
it is built field by field rather than by spreading the row, so a column added later
cannot reach a payload by merely existing. The placement gained its **true intrinsic
`width`/`height`**, which the model lacked entirely — without them `AGENTS.md`'s no-crop
rule is not expressible at all, since a layout that does not know a photograph's shape can
only guess it, and guessing is cropping. §8e's derivative ceilings (2 048 px longest edge,
tied to `MAX_PUBLIC_DELIVERY_DIMENSION` so a private preview cannot quietly out-resolve a
public one, and 8 MB) are enforced again at read time rather than trusted from the upload
tool, and an oversized derivative is **refused, never downscaled on the fly** — that would
be a crop-shaped decision made by the wrong layer. A malformed row throws rather than
being skipped, because a skipped item silently shortens a customer's gallery and nobody
would know a delivered photograph is missing; a page over the 100-item bound is refused
rather than truncated, and two placements sharing an identifier are a defect.
The authorized delivery view now renders complete native-ratio previews through a shared
lazy signed-preview component (`src/components/private-gallery-preview-image.tsx`), also
used by the proof wrapper without changing its reference/filename contract. One queue per
page admits at most four concurrent and fifty preview mints per minute. A failed image
remints once, then offers an explicit retry; unmount aborts outstanding work. The image
uses `object-contain` inside its reserved frame, so even a mismatched derivative ratio
letterboxes rather than crops. Delivery fallback labels say “Photograph 1” in the selected
UI language; they do not invent filenames. No private image uses the public optimizer.
The whole-gallery ZIP control authorizes only on an explicit click, then uses a native
signed attachment navigation with no referrer, object-byte fetch, proxy or individual
full-resolution link. Concurrent clicks share one mint; a short cooldown prevents an
accidental second large download. Failure remains generic, and a later deliberate click
reauthorizes. No signed URL is rendered in the server response or saved in application
storage/history; the no-JavaScript document explains the requirement and leaves the
button disabled. The shared reply validator rejects malformed dates and unsafe URLs,
using the server HTTP Date when available to avoid visitor-clock skew.
Production-build journeys cover FI/EN desktop/mobile, uncropped mismatched-ratio images,
expiry retry and native ZIP attachment using isolated local asset stubs. Their independent
development gallery does not spend the link/bootstrap fixture's exchange allowance.
Authorized WebKit navigation still needs hosted HTTPS: the HTTP harness refuses its
Secure session cookie; the authorized no-JavaScript SSR markup is checked separately in
both engines. This advances the client delivery flow only. Real private objects, ZIPs,
provider headers/Range/expiry, durable persistence and Production activation remain
unverified and disabled. The item read happens strictly **after** authorization —
an unauthorized request never reaches a placement row — and a projection or store defect
falls back to the unauthorized document rather than rendering a gallery quietly missing
photographs.
AB#29 delivery pagination (2026-10-16): the authorized delivery document now reads a
bounded page with its total count instead of silently stopping at the first 100 items.
A separate session-authorized `/items?page=N` API returns at most 100 safe item DTOs;
the development memory adapter includes a separate 205-item synthetic gallery. Native
FI/EN controls keep keyboard focus while loading and at the first/last page, and a
failed or malformed response retains the current photographs for retry. The document
URL stays unchanged: reload and language switching return to the first page, with no
page history or shareable page selector (ADR-0032). JavaScript is required for later
pages. The store remains memory-only; production storage and AB#29's remaining
workflow still need their own accepted implementation. AB#29 remains Active.

Objects now have an assigned shape (`src/lib/private-gallery-object-key.ts`):
`<keyPrefix>/g/<galleryId>/<preview|proof|zip>/<128-bit CSPRNG token>`. The token is not a
counter, which is what makes the runtime credential's deliberate _absence_ of `ListBucket`
meaningful — sequential keys would make reading one object imply reading the gallery. A key
carries nothing about the customer or the photograph (no name, no filename, no capture
date, no gallery handle): it is not browser-facing, but it is visible to anyone who can
list the bucket and to the provider's own tooling. Every part is validated before it is
joined, so an "opaque" gallery id carrying a separator or a dot cannot place an object
outside the prefix that all three credentials and the backstop lifecycle rule are scoped
to, and `isPrivateGalleryObjectKeyInPrefix` checks a stored key segment-wise on the way
back out, so `photos-private/…` never passes as being inside `photos`. The key layout is
now in `docs/deployment.md`'s runbook, because the IAM policies cannot be written against a
guess.
The bounded **upload preparation** (`src/lib/private-gallery-upload.ts`) is §8c's answer to
an object store and a database that cannot share a transaction: the database always knows
first. `openPrivateGalleryUploadPreparation` validates a declared manifest against §8e's
ceilings — file count, per-derivative pixels and bytes, one ZIP at most, and the gallery
total — assigns one immutable key per entry, and returns a plan with the 30-day deadline;
the administrator boundary commits it and moves the gallery to `preparing` **before** the
CLI writes a byte, so the retention worker always has an enclosing preparation to reconcile.
An object written without one would be invisible to cleanup and would survive until the
275-day backstop. A bad entry refuses the _whole_ manifest, since a partial plan would put
keys in the database for objects the CLI was never told to write. Sizes here are
_declared_, not measured: the completion step re-checks the real object with a metadata
read, because a declaration is a claim and the bucket is the fact — checking only at
completion would mean writing gigabytes before refusing, and checking only at planning
would trust the client.
**Completion** closes that loop (`src/lib/private-gallery-upload-completion.ts`): it
reconciles three independent accounts of the same objects — the plan the server assigned,
the receipts the CLI reports, and metadata-only reads of those exact keys — and **only the
third is evidence**. A receipt is a claim, carried solely so a checksum the store cannot
compute for us has somewhere to travel; it never proves an object exists or is the right
size. An object at a key the plan never assigned fails the completion, because nothing
vouches for it and it would sit in the bucket uncovered by any manifest. One bad object
fails the whole thing: a half-verified gallery is one a customer could be shown with
photographs missing, and the failure list is bounded so a bad run cannot flood an
administrator's status. **An ETag is never accepted as a content hash** — §8c says so, and
it is the one plausible shortcut that would be wrong, since a multipart ETag is a digest of
part digests, so comparing it against a hash of the file fails for correct data and
_sometimes passes_, which is worse than always failing. Which checksum algorithm a
deployment uses stays the provisioning-time decision §8c defers: the comparison is
algorithm-agnostic and refuses two differently-named digests rather than guessing. On
success the outcome names the ZIP pointer swap and, when it supersedes one, how long the
predecessor must be retained — the longest a ZIP URL can live plus a clock-skew margin
(this slice's hour, not an ADR number), because without it a regeneration would break an
in-flight download or `Range` resume minted against the old immutable key.
**Readiness is per gallery kind** (§8c), which the model could not express until now: a
`PrivateGalleryKind` discriminant joins the gallery, and
`src/lib/private-gallery-readiness.ts` decides whether the _verified_ objects satisfy it —
evidence from the completion step, not what a plan intended. A **delivery** gallery is not
ready without both a derivative and a verified ZIP that `activeZipObjectKey` actually
names; publishing one without it hands a customer a gallery whose whole promise is missing,
indistinguishable to them from one that had not finished loading. The kind is stored rather
than inferred from `activeZipObjectKey`, because a delivery gallery _before_ its ZIP is
verified and a proof gallery that will never have one look identical by that field, and
guessing would publish the first as the second. **Proof readiness is evaluated from complete verified evidence**: the first-ready planner
requires every placement to be unnumbered and every watermarked object verified, then
returns one transaction plan for the pricing snapshot, permanent references, high-water
mark, and ready state. Re-running it after ready refuses rather than renumbering. The
readiness evaluator requires an exact match between the stored-shaped placements and
verified proof objects, a valid pricing snapshot, and the initial natural reference order;
its blocker codes carry no private data. The private store that would persist this plan
does not yet exist. Every blocker is reported at once, because an administrator told
about one missing thing at a time is how a publication takes four attempts.
The **presigner** is built (`src/lib/private-gallery-signed-url.ts`): hand-written SigV4
query-string signing over `node:crypto`, which is what ADR-0014 §8a's "a small, justified
dependency; a full cloud-vendor SDK is not required and is avoided" asks for — presigning
is four HMACs and a string concatenation, while an SDK would bring a credential-provider
chain, a retry layer, and a request pipeline this path wants none of. It decides nothing:
handed the wrong key or an unbounded expiry it would faithfully sign both, which is why
`private-gallery-delivery.ts` owns that. `uriEncode` is written out rather than delegated
to `encodeURIComponent`, which leaves `!'()*` unencoded — AWS's own guidance is that a
platform encoder "might not work", and one differing byte changes the canonical request and
so the signature. Only `GET` is ever produced: a presigner that took a method would be one
mistake from handing out a write URL for a bucket whose whole model assumes the browser
never writes to it. Response-header overrides are signed like any other parameter, so
`Content-Disposition: attachment` and `Cache-Control: no-store` hold for a given URL
whatever metadata the upload set.
**How far that is verified matters and is stated rather than blurred.** The core —
canonical-request hashing, the string to sign, the four-step key derivation, the final HMAC
— is pinned against **AWS's own published worked example**, reproduced exactly from its
documented inputs to its documented signature: a real known-answer test, not the
implementation agreeing with itself. Three other documentation sources yielded no usable
vector, and AWS's _second_ example on the same page is deliberately not pinned because its
published signature cannot be reproduced from its published canonical request — a vector
that does not reproduce is not a vector, and the test file records why so nobody adds it
back believing it was overlooked. What no vector can establish is whether _this_ provider
accepts the result: §8a's provisioning gate owns that ("a presigned `GET` minted with the
verifier credential succeeds", plus `Range` on a large object). Verified against the
specification, unverified against the provider — different claims, and only the first is
made. Path-style addressing is used because `PRIVATE_GALLERY_S3_ENDPOINT` is a bare origin
rather than a bucket host; virtual-host style is a small change the live gate would settle.
The private routes now carry their own **`img-src` grant** for the object-store origin
(ADR-0011 action item 4), which had been outstanding since the routes landed and would
have blocked every private preview in the browser the moment an object store existed. It
is emitted **only** for `PRIVATE_GALLERY_STORE=enabled`, applies to the private routes and
nowhere else, and adds **no `connect-src`** — a preview is an `<img>`, never a script
fetch, which is also why the bucket needs no CORS policy. Two `next.config.ts` behaviours
were measured against a production build rather than assumed, and both had been guessed
wrongly earlier in this story: a `headers()` rule matches the original request path **and**
the path the Proxy rewrote to, and among matching rules the **last** one wins for a given
header name. The rule is therefore sourced at the internal rewrite target — a build-time
constant, unlike the configurable prefix — and placed after the site-wide entry. This makes
`PRIVATE_GALLERY_S3_ENDPOINT` a **build-time** input for an `enabled` deployment: an origin
rather than a credential, on the same footing as the Sanity ids `next.config.ts` already
reads at build for the optimizer allow-list, and it fails the build if missing rather than
shipping a gallery whose every photograph the browser blocks with no error to explain it.
The value is validated as a bare `https://` origin before interpolation, because a stray
space or semicolon in a CSP source widens the whole policy.
**ADR-0014's action list is now closed except for the two items that need the services to
exist** (its own item 1, and AB#130). The administrator-authentication boundary it left
open is decided in [ADR-0015](adr/0015-administrator-authentication-boundary.md),
accepted 2026-09-02 — own reserved namespace, a `__Host-` session sharing nothing with the
customer path, a persisted login rate limit, and a **generated** single-operator secret
verified with `scrypt`, because §4 requires the boundary to be _stronger_ than a 256-bit
customer capability and a human-chosen passphrase is not; a passkey is the recorded upgrade
path, deferred for its dependency and its lost-device recovery converging back on a
configuration secret. Implementation is **AB#145's**, and its first slice is built: ADR-0015
§1's **reserved administrator namespace**, and nothing else. `PRIVATE_GALLERY_ADMIN_ROUTE_PREFIX`
(default `admin`) is validated as one lowercase segment and reserved as a root segment
whether the feature is on or off, exactly as the customer prefix is — against locale
prefixes, the redundant default prefix, story namespaces, application-owned segments, and
legacy-redirect roots — and additionally **refused if it equals the customer prefix**,
because that prefix is what the customer session cookie's `Path` is scoped beneath, so a
shared root would put an administrator route inside the scope of a customer credential.
The Proxy stamps the same `no-store` / `noindex, nofollow` / `no-referrer` hygiene on every
response in it and skips the legacy-redirect lookup for it (a match would otherwise return
a cacheable 410 from inside the namespace), production `robots.txt` disallows it, and one
constant now serves both namespaces so the two cannot drift. There is **no rewrite**: the
customer namespace needs one to reconcile a configurable prefix with a fixed file-system
route, while administration owns no route at all, so every path under the prefix is a 404 —
which is the point of doing this first, since a namespace has to behave privately before it
has content or the deployment that adds the first route is also the first one crawled.
`PRIVATE_GALLERY_ADMIN_SECRET_HASH` is already in the `NEXT_PUBLIC_` refusal list, though
nothing reads it yet.
**§2's session is built too**: `src/lib/private-gallery-admin-session.ts` carries the
operator's session model, its `__Host-pg_admin_session` cookie contract, and the two checks
every administrator route and mutation re-derives per request. It shares the _shape_ of the
customer session and none of its state — a separate store contract over its own rows, a
different cookie name, no `galleryId` and no `capabilityGeneration`, and no operator
identity field at all, because this deployment has one operator and nobody to enumerate.
The shape it does share is extracted rather than copied: `private-gallery-session-token.ts`
now owns identifier minting, the canonical-encoding check (a round trip, since several
43-character strings decode to one 32-byte value), the unsalted SHA-256 the store keeps,
and the single-cookie read that refuses a duplicate — so the two models cannot drift in the
one place a silent divergence would matter. `__Host-` is browser-enforced (`Secure`,
`Path=/`, no `Domain`), which is what the customer cookie could not use because it needs a
per-gallery `Path`; the cost is that this cookie travels on public requests too, accepted
for a cookie no sibling subdomain can set. `SameSite=Strict`, two hours by default against
a twelve-hour ceiling a deployment may lower and never raise, absolute with no sliding
renewal. Each row carries an opaque digest of the credential it was minted against and every
request compares it, so **rotating the administrator secret revokes every live session by
itself** — ADR-0015 §2's central revocation with no operator action; the digest is supplied
by the caller rather than read here, so §4's mechanism stays replaceable. `reauthenticatedAt`
gates irreversible operations (delete, revoke) to a five-minute window, refusing a
future-dated value rather than reading it as "very recent". A stored row with a malformed
credential digest classifies as `invalid-session`, not `invalid-parameter`, because the
reason reaches the operational log and a corrupt row must not point an operator at their own
call site. **§3 is built too**: `src/lib/private-gallery-admin-login.ts` carries the login's request
boundary and its two throttling layers, everything that must happen _before_ a credential
is ever verified. The request boundary is reused rather than reinvented — a thin wrapper
over the same `checkContactRequestHeaders` the contact and enquiry endpoints already pass
through, so the administrator path cannot drift from a boundary reviewed twice. Layer 1 is
an in-process per-IP limiter in its own instance (a login never spends the contact, enquiry,
or exchange allowance); layer 2 is the persisted counter ADR-0015 §3 calls "the actual
defence", with the same saturating fixed-window semantics
`evaluatePrivateGalleryExchangeRate` already established, throwing on a corrupt row rather
than resetting — this is the one counter whose failing open would make an expensive
operation free. Two things about it are deliberate and stated rather than implied. It is
**keyed globally**, one row for the whole deployment: administration has no gallery row to
own a counter and no account to key on, so a global key is both the honest shape and
trivially bounded storage, where a per-client persisted counter would reintroduce exactly
the unbounded key space ADR-0014 §3 avoided. And what it actually bounds is **`scrypt` CPU
cost**, not guessing — §4 requires a generated 256-bit secret, so no rate on a human
timescale affects that search space, while thirty attempts per fifteen minutes caps the
endpoint at roughly two seconds of CPU per window and also bounds the case the rule cannot
enforce, an operator who configures a passphrase anyway. The accepted cost is availability:
a global counter means sustained attempts can deny the operator a login until the window
rolls over. ADR-0015 does not discuss it; `docs/deployment.md` now does, together with the
platform-level mitigation, because the application-level alternatives are worse. A
throttled attempt and a wrong credential must answer identically — same status, same body,
**no `Retry-After`** — so the refusal reason is operational-log-only. **§4 completes the boundary**: `private-gallery-admin-credential-format.ts` owns the
encoding — `scrypt$1$<N>$<r>$<p>$<salt>$<hash>`, self-describing so raising the cost later
cannot silently invalidate a configured value — with its parsing, bounds, constant-time
verification, and the session generation digest; `private-gallery-admin-credential.ts` is
the server-only half that resolves `PRIVATE_GALLERY_ADMIN_SECRET_HASH` lazily, refuses a
`NEXT_PUBLIC_` mirror, and reports a missing value distinctly from a malformed one. The
split exists because `scripts/generate-admin-secret.mts` (`npm run admin:secret`) runs under
plain Node, where `server-only`'s CommonJS entry throws by design — and a security format
with two implementations is exactly the drift avoided elsewhere. That command generates the
secret rather than letting an operator choose one, which is how §4's "a memorable passphrase
is not an acceptable value" becomes executable rather than advisory; it verifies its own
output before printing and writes nothing to disk. One measured detail would otherwise have
broken every login: §4's own parameters need `128·N·r` = exactly 33 554 432 bytes and Node's
default `maxmem` is exactly that, with OpenSSL rejecting at `>=`, so **the ADR's parameters
throw with the default** — `maxmem` is always passed explicitly, and the parameter ceilings
exist so that derived value can never ask for a gigabyte from a typo. The generation digest
is SHA-256 over the _encoded credential_, never the stored hash: it lives in the session
table and every backup, and the scrypt hash is the offline-attack target.
With §4 present the ordering is complete, so administration finally joins the
`private-gallery-access.ts` facade: `attemptPrivateGalleryAdminLogin` (throttle, _then_
resolve the credential, _then_ verify, _then_ mint — a route that verified first would be
offering unmetered CPU, and every individual piece would still pass its own tests) and
`authorizePrivateGalleryAdminRequestSession`, which re-resolves the credential on every
request so rotation is revocation. Both never throw, and every refusal — throttled, wrong
secret, unprovisioned, malformed credential, stale session — is one indistinguishable answer
with the class kept for the operational log. Building it also refined §2: a corrupt session
row now classifies as `malformed-record` rather than `invalid-session`, because the facade
needed to tell "a browser left open" from "your table is corrupt" and was otherwise reduced
to matching an error message. **The routes now exist too, so ADR-0015's boundary is complete.** The Proxy rewrites the
configured administrator prefix onto its own internal segment (`private-gallery-admin`,
deliberately _not_ a subtree of the customer one — the isolation has to hold for the route
tree behind the URL, not only for the URL) and 404s a direct request to it, exactly as the
customer namespace does. One address serves both states: with a session that currently
authorizes it renders the signed-in surface, without one the sign-in form, so a stranger and
an operator whose session ran out see the same page. Sign-in and sign-out both post JSON,
because §3 fixes one content type for the login and every mutation — the cost is that
administration needs JavaScript, the opposite of the trade the customer gallery makes and
deliberately so. AB#153 disables the secret field and submit button until hydration,
omits the field's HTML submission name, and gives native submission an explicit POST
target at the JSON-only login endpoint. Disabled JavaScript, blocked/delayed hydration,
and a forced native submission are covered with a synthetic URL-leak canary.
Sign-out deletes the session row as well as clearing the cookie, and
authorizes before deleting so the endpoint cannot be pointed at a row named by an arbitrary
identifier. The development fixture supplies its own published administrator secret and
**never reads `PRIVATE_GALLERY_ADMIN_SECRET_HASH`**, the same rule its ephemeral keyring
already follows. `e2e/private-gallery-admin.spec.ts` walks the journey against a production
build — the accessible form, one refusal message for a wrong secret, sign-in surviving a
navigation, sign-out ending the session, the `__Host-` cookie's real browser-stored
attributes and its invisibility to script, the namespace hygiene, the internal segment's
404, and the endpoint's own boundary including a request with no `Origin`.
**What remains of AB#145 is the administration itself** — creating, publishing, notifying,
revoking — which is blocked on the same unprovisioned private stores AB#29 is. The
re-authentication gate for irreversible operations is built and tested but has no caller,
because the operations it guards do not exist yet.
`docs/private-gallery-data-flow.md`
is the processing record behind any privacy notice, and `docs/deployment.md` now carries
the whole operational runbook: provisioning and the live gate, the object-key layout the
IAM policies are scoped to, the worker's at-least-daily schedule and backstop policy, the
backup rules for both stores with §7's **worker-runs-first restore gate** (a backup taken
before an expiry and restored after it brings a closed gallery back accessible), drift
monitoring, owner-run repair, and the exit path. **None of that has been exercised** — no
deployment has provisioned either service, and every one of those documents says so rather
than reading as though it had.
The delivery path is finally **composed** rather than only implemented:
`mintPrivateGalleryAssetUrl` is the one call a route makes, and it exists because the
pieces must not be assembled by a route. The mint decision and the signer are both behind
`eslint.config.mjs`'s import ban, so until now there was no legal way for a route to reach
either — the security ordering was written and unreachable. That ordering is the point:
every **free** check first (state, generation, the resolved row's ownership, the TTL), so a
request that was never going to be authorized cannot spend a gallery's allowance; then the
**atomic** budget consume, which the store owns because a read-decide-write would race a
concurrent mint; then, and only then, the signature. A route doing this itself could get
the order wrong in a way no test of the individual pieces would catch. The object store's
configuration is read _first_, so a deployment that has none (`off`, `memory`) refuses
before charging a gallery for a URL nobody receives, and the response's `no-store` — plus
`Content-Disposition: attachment` for the ZIP — is **signed** rather than left to upload
metadata. `planPrivateGalleryMint` was split out of `authorizePrivateGalleryMint` for this,
leaving the pure reference evaluator intact and its tests unchanged.
The bounded per-asset mint route is now wired to this facade. It checks the
request boundary and a fresh session before reading a preview placement id or
ZIP request, and answers every refusal identically. Every request with a
fresh, authorized session and a valid request shape consumes the per-session
rolling 60-per-minute allowance before the asset lookup runs, including one
that names an unknown or cross-gallery placement — that lookup is itself real
store work a session holder must not get to repeat for free. The separate
gallery byte budget is charged only for a request that resolves to an
eligible mint; an invalid asset, a rate refusal, or a failed free check never
spends it, though the budget is consumed before signing, so a later signing
failure can still produce a refusal after the charge. The store seam requires the
rate-limit update to be atomic and persisted. Its success path is tested
with a development-only fixture and a fake object-store origin; no private bytes
are served in any real deployment until the store adapters and owner-run live
gate exist. The customer image/download controls remain unbuilt.
Everything else is unbuilt: the ZIP generation, the owner-run upload
CLI, the retention worker's IO, and the concrete object-store/Postgres providers with their
live provisioning gate (the owner-run runbook for those two services
is in `docs/deployment.md`). **Administration — creating a gallery, publishing it, the
customer notification with its delivery state and resend, and revoking or replacing
access — split out of AB#29 into AB#145 on 2026-09-02** and has not started.
Validated JSON-LD structured data (AB#86) is built: `src/lib/structured-data.ts` is a pure
builder + `</script>`-safe serializer (`<`, `>`, `&`, U+2028, U+2029 escaped — `JSON.stringify`
alone does not, per Next.js's own guidance) rendered through the `<JsonLd>` server component.
The supported set is core only, owner-decided at refinement: `WebSite` + `Organization` on the
home/site root, `Service` on a service detail route, `Article` on the `article` content variant's
canonical detail route. Nothing is emitted on a gallery detail, a category branch, the story
root, the `/services` listing, `/contact`, or any `?cursor=` / `?section=` continuation. Every
value is an explicitly modelled `SiteSettings`, `Service`, or `ContentPage` field or a
deployment-config value: `Organization.name` is `siteName` and `sameAs` is the configured social
links, but no `logo`, `contactPoint`, `provider`, `author`, `publisher`, `offers`, or address
entity is synthesized, and an absent optional field omits its property rather than emitting a
placeholder. Route URLs and asset URLs share `page-metadata.ts`'s rules through the new
`canonical-url.ts` (`canonicalRouteUrl` applies ADR-0003's no-trailing-slash shape and must be
origin-absolute against the canonical base; `absoluteAssetUrl` resolves a relative rendition and
preserves an already-absolute public CDN derivative). The AC5 external-validator check is manual
(CI reaches no external service); the representative builder outputs are the snapshot fixtures in
`structured-data.test.ts`, and `e2e/structured-data.spec.ts` proves the per-route inclusion and
exclusion wiring against a production build.
The AB#65 spike that informs the keyword-taxonomy ADR (AB#55) and ADR-0012's own open
questions has its **tooling** built — a deterministic ~8000-media synthetic fixture corpus
(`scripts/keyword-benchmark-fixtures.mts`, entirely non-personal, validated), the three
ancestor-strategy GROQ builders and an in-memory equivalence oracle
(`scripts/keyword-benchmark-queries.mts`), the analytical models for ADR-0012 §3's
selection-collapse, §6's cache cardinality (collapse-aware antichain count, not just
`Σ C(V,k)`) and invalidation fan-out, and hierarchy-move write amplification
(`scripts/keyword-benchmark-model.mts`), a measurement-capable read-only transport that the
shipped one could not provide — endpoint (API vs API-CDN) selection, server `ms`, payload
bytes, cache headers (`scripts/keyword-benchmark-http.mts`) — the full measurement matrix and
its Markdown renderer (`scripts/keyword-benchmark-plan.mts`), and an owner-run orchestrator
(`npm run benchmark:keywords -- plan|seed|run|move|clean`, `scripts/keyword-benchmark.mts`)
that seeds a **dedicated disposable** dataset, runs a strategy × shape × endpoint matrix with
a GROQ-vs-JS ordering correctness gate (ADR-0012 §9), and performs one reverting hierarchy
move with query-visibility-lag timing (AC7). **The live measurement was run** (2026-08-27,
against a throwaway Sanity project seeded and torn down; results and reasoning in
`docs/keyword-query-benchmark.md`). It **reversed the pre-run hypothesis**: `media-expansion`
(ancestor closure materialized on the medium) is the fastest read at every shape (~1.7–2.4×
faster than the keyword-side join strategies, and the only one whose paginated walk is one
request per page), so the recommendation to AB#55 is **strategy B**, accepting the
expensive-but-rare hierarchy move (moving the broad root rewrote 3541 media docs: ~15 s to
re-sync, ~45 s to revert) rather than paying a join on every visitor request. The
GROQ-vs-JS keyset ordering agreed on every walk including the sub-second `capturedAt` pairs,
so ADR-0012 §9's risk did not materialise. 3 of 4 hierarchy-move cells were measured live;
`deep`×strategyB is modelled (its re-sync probe needed a fix, landed after the run).
**AB#65 is closed.**
Tagged caching and webhook revalidation (AB#83) are built — see the large paragraph earlier
in this file and `docs/cache-revalidation.md`. Its previously outstanding "Deployed
verification gate" is now complete: on 2026-08-26 a revision-guarded Preview publish and
its revision-guarded restoration each produced an accepted signed webhook, a
`REVALIDATED` response with a new ETag on the current route-wired Preview deployment, and
seven further `HIT` responses that all carried the one current value. The webhook ran on
an older Preview deployment while the reads ran against the newer one, directly proving
that invalidation was not confined to one warm process or deployment. A raw-perspective
audit confirmed the original seed value was restored and no draft or test marker remained.
**AB#83 is closed.**

**Redacted failure summary preparation, 2026-10-06 (AB#205, Active):** an
offline emitter-NDJSON tool counts fixed state/class outcomes, deduplicates terminal
events and reports invalid/incomplete evidence. It neither reads live logs nor
configures notifications; AB#159 live exercise remains open.

**Availability late-response cleanup, 2026-10-17 (AB#317, Active):** the existing
AB#158 probe now cancels responses that arrive after its total deadline, including
the allowed canonical request, without reading their bytes or following a late
redirect. Redirect ownership is released before the second request, preventing a
second cancellation of the first body on timeout. Cleanup failures cannot replace
the redacted result or stall completion; the original shared deadline remains.
Deterministic synthetic regressions first reproduced seven failures in the old
implementation; all 65 focused tests, 7,165 unit tests in 315 files, lint and the
fixture-configured production build now pass. AB#317 moved New → Active before
edits; owner review/merge and AB#158's real monitor/notification exercise remain open. No live check, account,
alert, deployment or dependency changed.

**Production failure triage preparation, 2026-10-02 (AB#159, Active):** the
[runbook](production-failure-triage.md) now gives concrete Production log filters,
separate Sanity query/revalidation and contact/enquiry diagnosis, expected-refusal
exclusions, request-counting rules, and rollback limitations. The alert-threshold
decision is **Proposed**: availability probes alone cannot establish delivery health;
native anomaly notifications need actual tier, payload, low-traffic coverage and cost
verification. No alert path is configured/tested by this preparation. AB#318 bounds
shared Resend error-body reading to 16 KiB under one fetch/read deadline and
requests cancellation of unused responses. Existing contact/gallery outcomes and
redaction contracts remain. Synthetic resource/caller regressions verify this
runtime correction; it configures no alert and exercises no live delivery.
AB#318 is Active pending accepted merge. AC2's owner
decision/notification evidence and AC3's controlled Production failure trace remain
open **after AB#18**, before **AB#118** rollback rehearsal and customer handoff.

**Probe host classification, 2026-10-07 (AB#210):** terminal DNS dots no longer
bypass internal/private suffix checks. Classification leaves the requested public URL
unchanged and keeps the exact existing loopback exception. This guards operator
configuration; it does not establish DNS resolution safety or enable AB#158 monitoring.
A public URL keeps its terminal dot; its TLS and exact URL comparisons still use that
requested spelling.

**Availability probe preparation, 2026-10-06 (AB#206, Active):** a configurable
owner-run public GET probe enforces total timeout/body limits and semantic markers.
Synthetic fetch tests need no live service. AB#158 monitoring/notification setup stays
open; cached content success does not prove live CMS reads or mail delivery.

**AB#359 follow-up, 2026-10-18:** the availability CLI validates its opened
configuration descriptor before parsing or probing. Nonregular and oversized
inputs are refused; POSIX nonblocking open avoids waiting for a FIFO writer.
Regular files/symlinks, the 64 KiB/UTF-8 bounds and existing probe decisions stay
intact. Actual CLI regressions use only an owned loopback HTTP fixture and verify
zero GETs for refused inputs. This correction remains Active pending review/merge;
AB#158's live monitor and notification acceptance remain separate.

**Clean Preview readback, 2026-10-13 (AB#277, Active):** [Build 941's exact candidate](audits/ab277-clean-preview-candidate-2026-10-13.md) passes current provider source identity for merged `c32d1e8` with `gitDirty=0`, expected project/team and READY status. Independent protection/noindex checks pass (unauthorized 302, authorized 200/noindex); two newly published service routes return 200 and still-empty English Blog returns 404. CI task logs bind the immutable deployment ID/URL. Artifact bytes, complete rendered route behavior, future #387/article integration, Production promotion and actual rollback/acceptance remain unverified. No provider mutation. AB#277 remains Active pending PR merge; AB#18 stays open. AB#268/AB#272 are verified Closed; entries below describe their original preparation.

**Clean checkout release source, 2026-10-13 (AB#272, Active):** CI now validates
expected commit/tree and a clean checkout before building and before upload,
then supplies affirmative source metadata. Existing release protections and
cleanup remain mandatory; artifact provenance and final launch approval remain
separate. [Evidence](audits/ab272-release-source-attestation-2026-10-13.md).

**Frozen release-source gate, 2026-10-13 (AB#268, Active):** an offline, private
receipt verifier binds source SHA, deployment/project/team and readiness. Dirty
Production and unknown-cleanliness Preview receipts are refused. Artifact,
protection, canonical and launch gates remain independent; no provider mutation
occurred. [Evidence](audits/ab268-release-source-verification-2026-10-13.md).

The deployment itself: AB#116 is **closed** — the Preview environment is fully provisioned
and proven working by a real, verified, fully-automated pipeline run (build 144, `main`,
2026-08-24). `DeployPreview` built, deployed to Preview, bound the deployment identity to
the expected project/team, and verified both access protection (a 302 redirect to
`vercel.com/sso-api`) and non-indexability (`X-Robots-Tag: noindex`) against a live URL.
Three root causes were found and fixed only by actually running this, not by code review:
`vercel deploy`/`vercel build` needed an explicit `--target=preview`, since a project's
first-ever deployment is otherwise assigned to production regardless of the omitted
`--prod` flag; a TypeScript parameter-property in `scripts/vercel-preview-api.mts` crashed
under Node's native type stripping (vitest's transpiler tolerated it, so this was invisible
until the script ran for real); and the Vercel project's own Framework Preset was "Other"
instead of "Next.js," which made every deployment serve only a fallback 404 regardless of
the two code fixes — corrected directly on the Vercel project, no code involved. The
verification script's access-protection check was also wrong in its own right (assumed a
bare `401`; Vercel Authentication actually redirects) and is fixed to bind to the specific
redirect target rather than accepting any redirect status, preserving the original
deliberate refusal to treat an ambiguous redirect as proof. Production promotion (AB#18)
and exercised rollback and handoff (AB#118) are later stories, now unblocked rather than
waiting on provisioning. Legacy URL redirects (AB#19) are partially built —
see above — with 48 of 415 distinct crawled paths still pending reviewed targets after
content migration (including `component/komento/*` and `sivustokartta/*`).

**Rollback readiness preflight, 2026-10-13 (AB#282, Active):**
[Offline evidence binding](audits/ab282-rollback-readiness-2026-10-13.md) checks two
frozen clean Production builds, fresh source-bound CMS/media compatibility, matching
recoverable snapshot, runtime access, plan eligibility and alias/cache preparation.
It emits only hashes, expected identities and fixed refusals; it performs or authorizes
no recovery and grants no launch acceptance. AB#118 still needs the actual exercise.

**Local CMS recovery exercised, 2026-10-13 (AB#267, Active):** a bounded offline
operator restored 17,609 raw documents and all 5,158 current original assets
(2,436,624,774 bytes), then rehashed every written file from disk. The retained
archive and thirteen preserved additions were verified; private bytes remain ignored.
No provider restore or launch rollback is claimed.
[Evidence](audits/ab267-cms-recovery-rehearsal-2026-10-13.md).

**Rollback record preparation, 2026-10-06 (AB#208, Active):** the
[blank exercise record](rollback-exercise-record.md) separates code, CMS, shared assets,
cache, credentials and mail. AB#118 still needs actual post-promotion recovery and
owner handoff; no Production mutation was performed.

**Dependabot alert #67, 2026-10-20 (AB#160, Active):** a new medium advisory,
GHSA-698v-4r3x-3vcv (`launch-editor` `escapeCmdArgs()` omits `%` escaping on Windows),
affected `vite` 8.2.0–8.2.3, which only the development tree uses (through Vitest). A
lockfile-only `npm update vite` within Vitest's existing range moved vite 8.2.2 → 8.3.4 and
its bundled rolldown packages 1.2.8 → 1.2.14; no direct dependency was added and nothing
shipped changes. Afterwards `npm audit` reports 0 vulnerabilities for the root tree and the
full unit suite passes (8 527 tests). Alert #66 (Studio `sprintf-js`) remains the dated
owner-accepted exception from AB#380.

**Next maintenance candidate, 2026-10-16 (AB#160, Active):** Next.js and its
ESLint configuration are pinned to 16.4.2 for the upstream Turbopack fixes.
The updated Hooks rules prompted small corrections: gallery focus requests no
longer clear state from an effect, proof-list state updates run in settled
request callbacks, and the Studio language action updates its imperative guards
from committed props in a layout effect. The original Studio action PR is not
rewritten. `next dev` also refreshed its generated AGENTS heading.
Clean lockfile installation, lint, 6,384 unit tests, production builds, Studio
typecheck/static build, diagrams and synthetic dev smoke passed; root audit stayed
at zero findings. The full upgrade browser matrix completed with 1,113 passes,
46 existing skips and one WebKit section-navigation case passing on retry.
After component corrections, 138 focused journeys passed (five existing
WebKit Secure-cookie harness skips); 18 additional zero-retry probes passed,
including six repeats of the section check. The AB#132 probes remain explicitly
expected failures: 16.4.2 still returns the empty initial 404 shell.
This is maintenance, not a claimed security remediation. CI/Preview deployment,
maintainer notification receipt and the broader monitoring acceptance remain
separate gates; AB#160 stays Active and no Production setting was changed.

**Ongoing dependency monitoring, 2026-10-02 (AB#160, still Active):** the
existing daily audit and Dependabot settings were checked without replacing
their configuration. Scheduled run #497 audited the same source revision as
earlier main CI #494 and failed visibly on npm advisories; Verify and
DeployPreview were skipped. The audit uses the self-hosted `Default` pool and
does not consume Microsoft-hosted minutes. Dependabot's Next.js security-fix
PR #229 passed PR CI #496, was merged by the owner, and its exact merge revision
passed main CI and protected Preview deployment in #501. That is dated Preview
evidence, not verification of the later PR #230 revision or Production promotion.
Receipt of Dependabot and failed-audit notifications is still unverified, so
the story's end-to-end notification demonstration remains open.
[Evidence and remaining live check](dependency-security.md#live-evidence-checked-on-2026-10-02)
include the run/PR links and the response policy for runtime exposure, severity,
fix availability and Node.js/Next.js security releases.

### AB#329 — offline lockfile-bound vulnerability triage (2026-10-17)

A saved npm audit v2 envelope can now be paired with exact v3 lockfile bytes by
an operator-recorded SHA-256. The offline CLI joins affected nodes to recorded
versions and declared install flags, keeps advisory/entry counts separate and
labels registry fix suggestions as unverified. It projects no raw provider
prose or resolved URLs, bounds files and graph/output work, and refuses mismatched
pairings. The digest does not attest audit freshness or capture provenance;
install flags do not prove deployed code or exploitability. AB#329 moved New →
Active before edits and awaits owner review/merge. No dependency update,
registry operation, CI or notification configuration is performed by the tool;
AB#160's operational acceptance remains open.

### AB#331 and older entries — archived

The AB#331 entry (2026-10-17) and the older entries that followed it here are kept verbatim in
[feature-status-archive-2026-10.md](feature-status-archive-2026-10.md).

### AB#220 — static inert availability markers

The availability probe now excludes elements with the boolean `inert` attribute and
their descendants from both marker traversal and marker text. Independent visible
markers still pass. This checks fetched HTML only; computed CSS and JavaScript changes
are not evaluated. AB#158 live monitoring and its failure/recovery exercise remain open.

### AB#221 — HTTPS SSO redirect proof

The preview verifier now accepts the provider SSO challenge only over HTTPS, with
no credentials and the default port, at its existing exact host and path. Redirect
status and fixed diagnostic contracts are unchanged; Location values are not logged.
This is deterministic classifier coverage, not a fresh live deployment verification.

### AB#222 — rally planner input integrity

The offline planner rejects malformed UTF-8 and unreadable identity maps instead of
silently replacing bytes or starting new identities. It checks the identity map before
writing reports. Existing ID minting and the file-BOM policy are unchanged; writes are
not made transactional by this slice. No real rally plan or CMS write was performed.

### AB#223 — conversion artifact read failures

The conversion planner now stops on unreadable or corrupt lowercase `.json` files,
including malformed UTF-8, with a fixed operator error. Valid non-artifact JSON is
still ignored; the existing file-BOM and requirement-collection policies remain.
Real artifact-directory verification and any approved conversion write remain open.

### AB#224 — bounded legacy HTTP verification

The legacy redirect probe now shares one 20-second deadline across headers and HTML
body reads, including injected IO that ignores abort. Cleanup is observed without
waiting; late responses are cancelled. A four-MiB response-byte cap remains, and
malformed UTF-8 now gives the existing fixed `probe-failed` verification result.
Mapping decisions, pending paths and live AB#19 launch checks remain unchanged.
Repeated failed targets are still probed per row; failure caching is a separate follow-up.

### AB#225 — keys inside mixed CMS arrays

Pre-write key validation now checks object elements even when an array also contains
primitives or null, and traverses nested containers with independent sibling-key sets.
Malformed keys use index paths without coercing their values. This is a generic key
check, not schema validation: accepting a nested container does not make arrays of
arrays valid Sanity content. No Production dataset or launch gate was verified here.

### AB#226 — benchmark response integrity

The keyword benchmark transport now checks HTTP failure before reading the body,
redacts body-read errors, and rejects malformed UTF-8. Payload size counts received
post-decompression bytes, including a BOM; wall time ends before decode/JSON parsing.
Query strategy and cache measurements are unchanged. This covers only the benchmark
transport with synthetic responses; no live measurement or launch gate was completed.

### AB#227 — shared Sanity response UTF-8

`readSanityJsonResponse` now rejects malformed UTF-8 before JSON parsing, preserving
its fixed errors, status handling and transport-BOM acceptance. This also covers its
shared query/upload callers; the mutate path does not read its response body.
Stream failures retain the existing non-JSON class.
It does not change the runtime app, exact-byte plan files or live verification.
No real CMS request or write was performed for this slice.

### AB#345 — bounded shared Sanity CLI responses (Active)

The owner-run read/seed HTTP transport now enforces a local 16 MiB JSON-response
budget and one original 20-second deadline through headers and body reads,
including abort-ignoring injected transports. It retains fatal UTF-8 decoding,
query perspectives and redacted errors. Unused, oversized, timed-out and late
responses receive observed nonblocking cleanup; seed mutation status and batch
order remain unchanged. Cleanup grants no retry or certainty about a submitted
write/upload. This is separate from AB#320's runtime client correction.
Synthetic fixtures cover the boundary and existing audit/writer contracts;
arbitrary production response capacity, live audits, guard-record policy and
AB#137's operational acceptance remain unproven. No CMS operation was performed.

### AB#228 — Vercel metadata UTF-8

Deployment lookup, alias lookup and alias-assignment confirmation reject malformed
UTF-8 before parsing JSON, with their existing fixed errors and ownership checks.
A failed lookup cannot proceed to deletion. Assignment has already issued its POST
when its response is read: a corrupt response leaves remote state unknown and calls
for manual alias verification. Coverage uses synthetic responses, not provider changes.

### AB#347 — bounded Vercel release API responses (Active)

The provider-specific release client owns each fetch and required JSON read under
one original 20-second monotonic deadline and a local 16 MiB decoded-byte budget.
Unused HTTP404/error/alias-deletion bodies and late responses receive observed,
nonblocking cleanup. Alias-mismatch diagnostics contain static text rather than
provider prose. Ownership, generated URLs, exact deployment-deletion receipts,
current-main and monotonic guards, and existing conditional alias recovery remain
unchanged; an unverified mutation acknowledgement grants no resubmission or claim
that nothing happened. Tests use synthetic responses only. Arbitrary metadata
capacity and live release/security acceptance remain unproven; no provider request,
deployment, alias change or deletion was performed for this slice.

### AB#229 — early calendar years and public-reader bounds

Generic calendar checks now validate written years 0000–0099 without Date.UTC's
1900 remapping. Canonical projection retains the current public reader's UTC-year
range 0100–9999, including offset crossings; migration and seed document guards use
that compatible projection. This deliberately accepts real early calendar dates
while keeping unsupported instants out of public document plans. The runtime reader
is unchanged and its own early-year behavior remains a separate follow-up.

### AB#230 — Bound and redact the public-cache recovery response (2026-10-08)

The recovery CLI decodes response bytes as strict UTF-8 (a response BOM is tolerated) and prints a correlation reference only when a successful HTTP response contains `status: accepted` and a canonical lowercase UUID v4. An unusable acknowledgement leaves the purge outcome unverified; it does not prove the purge was refused. Arbitrary transport exceptions are withheld, including native header-validation errors that can echo a bypass value. Fixed project-owned Vercel errors remain actionable. This validates retained output; it adds no response-size cap or live invalidation proof.

The work item is Closed after its owner-approved sequential PR merge on 2026-10-08; the launch parent remains open.

### AB#231 — Reject damaged or dangling Joomla intro recovery records (2026-10-08)

Intro-summary recovery records are read as strict UTF-8 JSON with the existing no-BOM policy. Valid Unicode and a literal U+FFFD remain valid; damaged bytes are refused before digest checks. Only a genuinely absent directory entry counts as missing: a dangling link, directory or unreadable record refuses recovery. A symlink to an intact regular file retains its existing behavior. Exclusive creation remains mandatory; an existing record is checked through the same reader and never overwritten. This local-file guard does not perform the owner-run correction.

The work item is Closed after its owner-approved sequential PR merge on 2026-10-08; the launch parent remains open.

### AB#232 — Refuse invalid UTF-8 curated-gallery input and approval files (2026-10-08)

The curated-gallery offline planner reads both the content input and owner-approval file as strict UTF-8 JSON before opening its output. Damaged bytes, a leading BOM and malformed JSON receive fixed role-specific diagnostics; their contents are not echoed. Valid Unicode and literal U+FFFD preserve the existing review-digest computation and approval binding. An invalid input or approval leaves any existing output untouched. This parser check is not a new content approval or CMS write.

The work item is Closed after its owner-approved sequential PR merge on 2026-10-08; the launch parent remains open.

### AB#233 — Fail closed on malformed UTF-8 and redirects from Sanity queries (2026-10-08)

Runtime published queries keep their fixed Content Lake origin and use manual redirects. Successful JSON is decoded as strict UTF-8; a response BOM, valid Unicode and literal U+FFFD remain supported. Damaged bytes and body-read failures keep the existing non-retryable `malformed-response` classification with redacted events. Published perspective, parameters, timeout and finite Next cache tags/TTL remain unchanged. The pinned Next fetch implementation caches response bytes before application-level JSON validation: a malformed cached 200 can therefore keep failing until the existing TTL expires or approved webhook/recovery invalidation clears it. This change adds no live propagation proof.

The work item is Closed after its owner-approved sequential PR merge on 2026-10-08; the launch parent remains open.

### AB#234 — Reject corrupt JSON bytes in browser gallery continuation responses (2026-10-08)

Gallery continuation requests stay on their application endpoint with manual redirects; browser opaque redirect responses fail the existing HTTP-success check. Successful JSON must be valid UTF-8 before item/slide identity and metadata validation. Parser and body-read failures expose only a fixed unusable-slice message. Valid Unicode, literal U+FFFD and a response BOM remain supported; layout, image dimensions, full-frame rendering and cursor semantics are unchanged.

The work item is Closed after its owner-approved sequential PR merge on 2026-10-08; the launch parent remains open.

### AB#235 — Prevent email delivery POSTs from following provider redirects (2026-10-08)

The shared plain-text Resend transport uses `redirect: manual` for its fixed `https://api.resend.com/emails` endpoint. A 3xx is a non-retryable provider rejection; its Location and error-name body cannot cause forwarding, a false delivered outcome or a retry override. Contact Reply-To, recipients, idempotency, timeout and genuine provider failure classification remain unchanged. The same transport guard covers existing private-gallery notifications without introducing a new processor or a live email test.

The work item is Closed after its owner-approved sequential PR merge on 2026-10-08; the launch parent remains open.

### AB#236 — Keep arbitrary transport causes out of Preview verification logs (2026-10-08)

Preview verification no longer prints arbitrary identity/probe exception messages, which can include malformed secret header values. The injectable header-only probe preserves manual redirects, no-store, the twenty-second signal and response metadata. The CLI verifies deployment ownership before supplying the bypass, uses fixed unknown-cause diagnostics and has an import-safe main guard. Known project-owned VercelApiError diagnostics remain available.

This independent work item is Closed after its owner-approved sequential PR merge on 2026-10-08; the launch parent remains open.

### AB#350 — Bound header-only Preview probes (2026-10-18)

Header-only generated-deployment and stable-alias GETs use one
original monotonic twenty-second deadline per request. Unused bodies are cancelled
without reading or awaiting cancellation, including responses arriving after a timed-out
injected fetch. Fast completion removes the owned timer; an owned timeout has the fixed
`Preview probe timed out` diagnostic, while ordinary transport causes stay withheld.
Empty or already-locked bodies receive best-effort cleanup without taking another
reader. The two alias requests retain their separate budgets and existing retry/recovery
policy; this is not a transaction-wide deadline or live protection/ownership proof.
AB#350 is Active pending its reviewed PR and owner acceptance; the production parent
AB#18 remains open.

### AB#237 — Redact arbitrary failures during stable Preview alias reconciliation (2026-10-08)

Stable Preview alias assignment and reconciliation outcomes now withhold arbitrary transport exceptions rather than echoing their message or serializing thrown values. Known project-owned VercelApiError diagnostics remain available. Probe retry errors were already fixed messages; those retries, revision/ownership gates and post-assignment restore outcomes remain unchanged. These are local injected-transport checks, not a live alias mutation.

This independent work item is Closed after its owner-approved sequential PR merge on 2026-10-08; the launch parent remains open.

### AB#351 — redact standalone alias verifier exceptions (2026-10-18)

The standalone read-only alias verifier now shares the existing safe failure formatter. Real Node child tests first reproduced token, bypass, provider-identity and malformed-alias disclosure, then verify fixed diagnostics, import safety and relative/symlink entry execution. Synthetic transport tests retain ownership-before-bypass, production/unassigned refusals, exact success output, ordered GET probes and trusted HTTP diagnostics. No shared transport, alias mutation or live provider operation changed. AB#351 remains Active pending review/merge; AB#117 and AB#18 retain their launch gates.

### AB#238 — Probe each declared legacy redirect target once per verification run (2026-10-08)

The legacy verifier probes each exact declared target URL once per invocation, retaining both successful and failed attempts. Source requests remain independent and every affected row keeps its source status and fixed probe-failed result. Failed target timeouts therefore accumulate per distinct target rather than per alias row; source timeouts still apply separately. A fresh invocation retries naturally. Pending paths remain blockers, and a timeout remains an operational failure, never a new 410 or missing-content decision.

This independent work item is Closed after its owner-approved sequential PR merge on 2026-10-08; the launch parent remains open.

### AB#239 — October 8 launch checkpoint

The [dated post-merge checkpoint](audits/launch-readiness-2026-10-08.md) records exact main CI, protected Preview and unchanged old Production evidence, today's continuing scriptless 404 residual, and ordered remaining launch operations; launch parents stay Active. The checkpoint and its nine companion implementation items are now Closed after the owner-approved merges #294–303.

### AB#137 — fresh Production preparation after PRs #295–303 (2026-10-08)

The [afternoon checkpoint](audits/ab137-production-preparation-2026-10-08.md) binds full main CI #719, a protected Production prebuilt candidate and all 611 uploaded artifact members to exact merged source `8e3efe625d03726ff5db04e57da3b8a6b9e83bc7`. Thirty current-content GETs, four live Production adapter tests and the exact fourteen-version rich-block compatibility check passed. The new complete baseline preserves 3,593 raw documents and all 1,748 asset binaries; binary headers and all 3,512 approved derivatives passed their bounded privacy/dimension checks. Both writer dry runs and zero-collision/shared-asset guards are current.

At the afternoon pre-write checkpoint, the old public renderer remained active and the refreshed FI/EN notice was a private revision-bound single-field proposal. The subsequent approved notice publication is recorded below. Actual Hobby hosting/DPA applicability, approved import, post-write audit/revocation, legacy verification and physical-device evidence remain launch work. AB#137, AB#117, AB#132 and AB#18 remain Active. Existing content/risk/account approvals are preserved; no new ten-task batch or roadmap expansion was started.

### AB#117/137 — approved contact notice published (2026-10-08)

The owner approved the exact FI/EN privacy notice. Its single revision-guarded
settings patch passed independent raw/published verification with every other
dataset revision unchanged. A new complete post-notice baseline preserves all
3,593 documents and 1,748 unchanged asset binaries; the previous baseline remains
available. Both current Production renderers show all four approved Finnish
paragraphs after accepted signed cache recovery. No bulk import or alias activation
occurred during that notice-publication step. Subsequent signing maintenance is
recorded below; AB#117/137 remain Active for the residual findings and launch gates.

### AB#141 — owner reports successful physical-phone gallery/zoom test (2026-10-08)

The owner reports successful gallery/zoom testing on iPhone 16 Pro Max, Safari,
iOS 26.7.1, at existing Production deployment `dpl_6PCmpGqTX6MaYLaEMnSrjrmnrRjF`
(`photosite-starter-2yvrqechj-ilkka-rytkonens-projects.vercel.app`). Switching images,
moving a magnified image and closing/reopening were tried. The [ADR observation](adr/0001-lightbox-library.md#2026-10-08-owner-reported-physical-phone-check-ab141)
records the confirmed environment and checks separately from the remaining
acceptance observations. This does not verify the protected candidate. AB#141
remains Active following its earlier New → Active transition; it is not Closed.

### AB#141 — owner confirms remaining physical-device checks (2026-10-19)

The owner reports that all AB#141 lightbox behaviours (tap, double-tap, pinch within
the ADR-0005 cap, bounded pan, caption out of the way, reset on close) worked on
iPhone 16 Pro Max, Safari, iOS 26.7.1. The deployment and gallery path were not
supplied. The [ADR record](adr/0001-lightbox-library.md#2026-10-19-owner-confirmation-of-the-remaining-physical-checks-ab141)
closes the pending maximum-pinch confirmation. No defect or code change. AB#141 stays
Active until this record is merged and accepted.

### AB#117 — authorized webhook-signing maintenance and scoped retirement (2026-10-08)

The owner approved replacing the two signing keys, current-runtime maintenance and
three named old-deployment deletions. Distinct environment keys and the existing
Preview-hook secret are updated. Current runtimes reject both exposed values;
source-archive checks, direct reconciliation, protected/noindex checks, current
routes and rendered notice passed. Production still runs its old application
source. CI's newer stable Preview from merged PR #304 was preserved. All three
approved old URLs now return provider `404 DEPLOYMENT_NOT_FOUND`; two active local
credential files were synchronized and the complete post-notice raw CMS manifest
remains unchanged.

[Current identities and residuals](audits/ab137-production-preparation-2026-10-08.md#owner-approved-signing-maintenance--current-identities)
are recorded explicitly. Eighty additional protected historical runtimes still
accept an exposed key and were not authorized for deletion. On October 9, the owner
separately approved aligning the existing Preview hook to its receiver's actual
`production` dataset. Only that setting changed; readback verified the remaining
configuration. Direct signed update/duplicate requests returned 200, with wrong
dataset/signature controls returning 403/401. The alias and all 3,593 raw document
IDs/revisions/types were unchanged. These probes do not establish automatic Sanity
delivery; that requires a genuine CMS event. Full revocation and CMS-triggered
delivery remain unverified. AB#117 stays Active; no
compatible-renderer activation, content import, billing or DNS change is claimed.

### AB#117 — one real contact attempt and current launch evidence (2026-10-12)

The new `verify:contact-delivery` command defaults to plan-only and requires `--send`
for one bounded synthetic application POST, with a durable pre-send identity, no
automatic retry and a non-overwriting private receipt. One authorized test on the
verified Production deployment tagged with base `14b1af0` and `gitDirty=1`
returned a valid delivered acknowledgement; the full deployed source delta is unverified;
its correlation has accepted/delivered log events. On October 13 the owner's mailbox
screenshot matched the exact synthetic submission identity and expected reply address,
confirming mailbox arrival and displayed Reply-To for that attempt. A fresh
authenticated raw audit and complete revision-rechecked raw snapshot cover
16,947 records / 5,158 assets, preserving the existing settings draft; the root
audit is clean and Studio's separate moderate chain remains. Configured genuine
hook history predates this artifact, so fresh visible publication is not claimed.
[The dated release checks](audits/ab117-final-release-checks-2026-10-12.md) record
the exact source, evidence limits, private one-field publication proposal and
separate recovery gates. AB#117/18/137/250 remain Active; no DNS, CMS, alias,
rollback, customer import, full approval or handoff was performed.

**CMS publication and one-field restoration, 2026-10-13 (AB#117, Active):**
the offline-by-default operator binds `intro` or the explicitly selected
`photographerIntroduction.text` translation to complete source/recovery/approval
hashes. Separate durable preparation, one CAS patch, exact-content readback,
observed-revision restoration and read-only uncertainty reconciliation are tested.
Browser preflight caught the initially hidden intro field before any write; the
owner approved the corrected visible field and exact restoration. On the existing
Production alias the marker became visible, then the original FI text returned.
Both phases have fresh genuine Production and Preview hook HTTP 200 acknowledgements.
The one temporary Editor key was deleted, absent and rejected with 401; all six
prior token IDs remained. Post-audit confirms 17,609 identities / 5,158 assets,
exact original home content, eleven system groups with only revision/update-time
deltas, and unchanged revisions everywhere else. Current local recovery coverage
includes the rehashed archive and 13 preserved/copied original additions.
[The dated record](audits/ab117-cms-publication-smoke-2026-10-13.md) preserves
failed preflights/credential calls, approvals, source limits and remaining gates.
The serving artifact retains `gitDirty: 1`; final immutable/canonical verification,
full restore, customer continuity and launch acceptance remain open. No DNS or
promotion change occurred, and AB#117/18/137/250 remain Active.

### AB#240 — validate image upload metadata

The owner-run Sanity image uploader rejects malformed acknowledgement objects, blank IDs and dimensions that are not positive safe integers before the filename-clearing mutation. Format and public-size guards retain their policy and use fixed diagnostics rather than echoing provider fields. Synthetic malformed-response tests verify that no follow-up mutation runs; the existing valid upload/filename-removal test remains. A refused acknowledgement can still mean the provider stored an asset: reconcile its identity and filename in the live import audit rather than assuming the upload was rolled back. This local repair does not perform a CMS write or complete AB#137.

### AB#241 — planned categories identity preflight

The categories writer's raw query includes planned published and draft IDs regardless of the stored type, retaining the existing type inventory. An occupied ID of another type, malformed identity row or repeated raw ID refuses preflight before the write loop. Pure query and injected-query tests cover the widened lookup and refusal. Digests, createIfNotExists, normal readback and reference rules are unchanged. Foreign-type release-version IDs and concurrent edits after preflight are outside this bounded check; it performs no live import and does not close AB#137.

### AB#242 — planned foundation identity preflight

The foundation writer's raw query includes planned published and draft IDs regardless of the stored type, retaining the existing type inventory. An occupied ID of another type, malformed identity row or repeated raw ID refuses preflight before the write loop. Pure query and injected-query tests cover the widened lookup and refusal. Digests, createIfNotExists, normal readback and reference rules are unchanged. Foreign-type release-version IDs and concurrent edits after preflight are outside this bounded check; it performs no live import and does not close AB#137.

### AB#243 — service preflight row integrity

The service writer refuses malformed or repeated identity rows instead of dropping them from its route collision graph. Foreign service route identity fields must be bounded nonblank strings without control characters; a malformed optional parent is not treated as a root service. The raw query also includes services lacking language so they cannot disappear at that filter. Synthetic tests retain normal reruns and draft/type collisions. This guards returned rows and absent languages, not all unrelated-locale data or concurrent edits, and performs no live import.

### AB#244 — opaque writer plan parser failures

Service, category and foundation writer CLIs use fixed role-specific errors for invalid UTF-8, BOM and JSON without preserving native parser excerpts or causes. Pure byte-parser tests preserve valid Unicode; guarded --yes subprocess tests prove malformed input stops before credentials or network work. Existing filesystem errors, plan validation and digest computation are unchanged. This parser-only repair does not redact every authored validation issue or perform a live import.

### AB#245 — content audit response diagnostics

Malformed audit pages, rows, field values and pagination cursor IDs are no longer serialized into errors. Fixed field/page diagnostics retain useful locations. Counts require nonnegative safe integers and every non-null projected dimension requires a positive safe integer, including metadata on non-asset rows; null still represents absent dimensions. Synthetic response/cursor redaction and numeric-boundary tests retain the successful presence-only report. Operator configuration diagnostics and the existing count-only consistency limitation remain outside this response-only repair. No live audit or CMS change was performed.

### AB#246 — delivery summary completeness

**AB#357 follow-up, 2026-10-18:** the offline failure-summary CLI inspects the
opened file descriptor and rejects nonregular targets before reading. POSIX
nonblocking open prevents waiting for a FIFO writer. Ordinary snapshots retain
their byte/UTF-8 bounds, redacted aggregates and complete/failure/incomplete exit
statuses; symlinks to ordinary files remain supported. Actual subprocess tests
cover writerless and populated FIFOs, symlink targets and invalid inputs. This
operator-only correction remains Active pending review/merge; parent AB#159's
live notification and controlled-failure acceptance remain separate.

The offline contact/enquiry summary flags both missing delivery terminal events and delivery terminals missing their accepted event. The actual contact and enquiry emitters were read to verify that delivery paths emit accepted first. Out-of-order complete logs and rejection-only refusals remain valid; duplicate/invalid precedence and redacted counts remain. An orphan delivery failure now returns incomplete evidence (CLI exit 2) while retaining its failure count. This is log-window evidence, not a live delivery or alert verification.

### AB#247 — private curated-plan output

The offline curated planner applies mode 0600 through the output file handle before truncating or writing, so overwriting a permissive existing regular file no longer leaves private locators readable. Private permissions and truncation apply to regular output files only (including symlinks that resolve to one); non-regular targets such as FIFOs and devices like `/dev/null` keep the previous write behavior, with no chmod or truncate and their mode unchanged. Input and approval parsing remain ahead of output opening; error-bearing validly parsed plans retain their existing written-report behavior. Existing symlinks still target the same file, whose permissions are tightened. Synthetic filesystem tests cover new/overwritten output, parser refusal preserving bytes/mode, symlink behavior, Linux FIFO output with retained mode and non-root `/dev/null` output with unchanged device mode; mode assertions are Linux/Unix-only. No content approval, digest or CMS write changes.

### AB#248 — verified deployment deletion acknowledgement

The Preview deployment cleanup client requires a JSON object with state DELETED and uid exactly matching the requested immutable deployment before reporting deletion. Empty/malformed UTF-8/JSON and wrong-object/state/ID responses use fixed errors. This matches the [Vercel DELETE deployment API response](https://vercel.com/docs/rest-api/deployments/delete-a-deployment). Both ID and URL cleanup paths have synthetic refusal tests; ownership prelookup and 404 idempotence remain. A failed acknowledgement is an unverified outcome, not proof the deployment still exists; inspect before retrying. Alias deletion acknowledgements are outside this scope. No live deletion was performed.

### AB#249 — Preview identify/cleanup CLI diagnostics

Identification and cleanup CLIs withhold arbitrary caught exception details with fixed phase-specific diagnostics. Import-safe injectable entry points return exit codes; the CLI guard assigns process.exitCode without immediate process.exit, retaining exact ID-only stdout and removed/already-absent output. Injected synthetic tests cover native/untyped failures, throwing message getters, settings failures and dispatch. Existing API ownership enforcement is untouched and remains covered by its own tests; no live lookup or deletion was performed.

### AB#137 — approved import verified; temporary writer retired (2026-10-09)

The compatible Production renderer is active on the existing Vercel aliases and Pro is confirmed. The approved eight categories and 9,918 content/media/placement documents were imported; separate checks matched all 3,512 derivative references and 494 route/gallery GET cases. A fresh complete baseline before the two owner-priced service additions covers 16,916 raw documents and 5,145 asset binaries; those additions bring the raw count to 16,918. The dedicated migration writer is deleted and rejects authentication with 401; unrelated credentials remain. A later raw check preserves all 16,907 non-group revisions and verifies the exact eleven-group retirement delta. The [completion addendum](audits/ab137-production-launch-2026-10-09.md#completion-addendum-2026-10-09) records count reconciliation, failed evidence, review limits and unresolved gates. Preserved-content approval traceability, dataset region, older Editor disposition, private-customer continuity, legacy verification and final public launch remain open; AB#137 stays Active.

The owner supplied a fresh Joomla backup and the new private K2 gallery's separate files. Archive CRC checks pass; the database contains the new gallery and the exact paths of all 34 JPEGs and its delivery ZIP, which also passes CRC and holds 34 images. Hash receipts cover both the backup and separate files; the Joomla ZIP does not embed these images, and no live restore is claimed. Customer-access continuity still needs a decision before DNS cutover/October 15 retirement. The private gallery is absent from the approved public import. No custom-domain cutover, complete AB#137 acceptance or launch-parent closure is claimed. AB#137, AB#19, AB#117, AB#132 and AB#18 remain Active.


### AB#288 — service price wrapping (2026-10-14)

Service listing prices and both default/prefixed detail-page pricing rows keep
preformatted amounts and currency on one line. Long package names wrap independently
within the remaining space, including unbroken words; approved CMS copy is unchanged.
Production-build geometry checks cover FI/EN at 320 and 1280 px in Chromium and WebKit,
including the 250/450 fixture price shapes, grouped prices, long labels and viewport
bounds. All 38 affected service journeys, five focused rendering tests and lint pass.
No CMS or dependency change. AB#288 moved New → Active and remains Active pending PR
review/merge.

### AB#137 — optional prices in owner-run service plans (2026-10-09)

The service writer now accepts the existing CMS model's optional listing price and keyed pricing entries. Validation, normalized approval digests, exact preflight and readback include these fields; malformed prices and edits to existing documents refuse the create-only run. No-price plan digests are unchanged. Synthetic tests cover malformed fields, duplicate keys, changed prices, both mismatch directions and dropped readback fields. This work adds no owner-specific service fixtures or application model changes and does not perform a live CMS write. Production migration audits, separate owner-content publication and temporary-credential revocation remain operational work; AB#137 stays Active.

### AB#18 — protected finalization candidate and K2 continuity inventory (2026-10-09)

Main CI #756 and a new protected manual Production build bind the merged release
to `f7de04f`; all 641 uploaded artifact members match. The complete 415-path
inventory was probed: 189 decided redirects and 131 distinct targets passed,
alongside the 174 Gone paths; 48 decisions remain open. Nine additional GETs and
two rejected synthetic POSTs passed without sending email or mutating CMS/cache.
The existing Production target and both aliases stayed unchanged. The
[release preparation audit](audits/ab18-launch-finalization-2026-10-09.md) records
the exact scope and retained failed operator check.

The owner requires continued K2 customer-gallery access. The private backup
inventory separates 45 expired and 42 disabled items from 28 published items
needing continuity (six dated and 22 indefinite). Those items reference 2,277
Balbooa image rows; 323 images and three delivery ZIPs are absent locally and
redirect to Joomla's error page on the old host. No missing material was
recovered or customer content published. Durable private-gallery provisioning,
required-material disposition, DNS access and the existing launch gates remain
open. AB#18 was reconfirmed Active; no parent item is closed.

### AB#18 — owner customer-gallery selection (2026-10-10)

The owner excludes seven legacy K2 items from migration and gives one previously
indefinite item an end date. The separate private decision overlay retains
**21 galleries**, seven dated and fourteen indefinite; the October 9 inventory
above remains the historical source baseline. No backup or customer file was
deleted. The date-only override is preserved without inventing a timezone or
runtime expiry instant. The retained source set has 1,831 image references.
The owner confirms that the current 49- and 15-image folders replace two
older lists; 39 obsolete missing references are omitted from the overlay.
The effective 1,792 image references all resolve locally or in the backup.
Hash receipts and ZIP CRC/JPEG-count checks bind the two replacement folders
and packages. Twelve linked ZIPs are available; nine items have no ZIP reference.
No derivative suitability or working customer access is claimed.

At this initial checkpoint the owner requested private-gallery provisioning
and confirmed that an UpCloud account would need to be created. That basis is
replaced for retained legacy continuity by the later decision below. The current customer and administrator store
resolvers explicitly refuse `enabled` until durable adapters exist; changing
environment settings alone cannot serve protected galleries. At that checkpoint,
the proposed protected continuity path required durable storage/adapters,
upload/delivery/retention and recovery, an indefinite-legacy policy and secure
old-link handoff. ADR-0028 supersedes those protected-store prerequisites for
these 21 retained unlisted deliveries; they remain requirements of the separate
protected AB#29/145 workflow. The unlisted route and its own delivery checks
remain to build. The [dated audit follow-up](audits/ab18-launch-finalization-2026-10-09.md#owner-continuity-decisions--october-10-follow-up)
records the unchanged launch boundary. No paid service, promotion, DNS/CMS write
or customer publication occurred. AB#18/29 remain Active; no item was closed.


### AB#18 — accepted unlisted legacy-gallery direction (2026-10-10)

The owner rejected the separate UpCloud/PostgreSQL order and accepts unlisted
pages using existing Sanity storage with public direct image/package URLs.
[ADR-0028](adr/0028-legacy-unlisted-gallery-continuity.md) bounds this exception
to the 21 retained legacy galleries, preserves their finite/indefinite deadlines
and keeps protected AB#29/145 separate and disabled. The public dataset permits
CMS enumeration; page expiry cannot revoke file URLs or cached copies.

Read-only current asset documents total about 2.43 GB. With the retained source
images and referenced ZIPs the estimate is about 12.10 GB before derivative or
repackaging overhead, within the current Growth 100 GB storage allowance; this
is not a billing-usage check or no-overage guarantee. All 12 source ZIPs exceed
the documented HTTP upload-body limit; intact ZIP transport remains unverified,
and the owner explicitly requires one complete ZIP per gallery, rejecting
several independent packages. No format change or paid service was ordered.

The schema, unlisted runtime, importer, legacy link mapping, deadline checks,
source-byte/dimension checks and end-to-end delivery remain to implement and
verify. AB#117 notice/accepted-residual reconciliation and other launch gates
remain open. Documentation and the planned system-context diagram were updated;
no customer upload, private adapter activation, production/DNS mutation or
launch closure occurred. AB#18/117 remain Active.

The owner explicitly rejected pre-upload downsizing and EXIF removal for this
legacy set on October 10. Preserve supplied processed JPEG bytes, existing
resolution and embedded metadata; public source URLs expose those individual
files. The earlier 2,048-pixel scan comparison is diagnostic, not an import
processing requirement. The owner clarifies that prepared browse JPEGs already
have the intended size for 10 × 15 cm prints, while the ZIP contains separate
full-size processed JPEGs. Preserve both roles and supplied files; this is not
an independently verified print-quality specification. No source image has
been changed or uploaded.

### AB#18 — intact ZIP transfer diagnostic (2026-10-10)

PR #321 merged at `b0299f45ae73cb560d22f4569cd6fd34ec85ab20` after CI #758.
The isolated synthetic diagnostic has seventeen passing offline tests. The
original 101 MB upload was accepted but verification was inconclusive; its own
asset was removed. After Claude's bounded helper loop ended clean at round 5,
the corrected 101,000,000-byte and 2,032,617,616-byte trials both returned HTTP
200 and passed complete anonymous CDN size/SHA-256 verification and upload-response SHA-1 validation. Both
created assets were deleted and the empty Preview baseline restored. The
largest upload took 75.394 seconds. This is measured project behavior; Sanity's
general documented 100 MB HTTP-body limit still has no established larger-file
support exception. Attachment behavior, supported production import, notice,
usage and recovery remain release gates. No customer media or Production/DNS
settings changed. The owner's January 7, 2027 finite expiry clarification is
retained privately. [The audit](audits/ab18-sanity-zip-transfer-2026-10-10.md)
records the results, review history and residuals. The helper and receipts stay
ignored local evidence outside application CI. AB#18/117 remain Active.

### AB#250 — legacy delivery runtime preparation (2026-10-10)

A separate default-off `/client-gallery/<opaque-handle>` route, read facade and
import-owned `legacyDeliveryGallery` / `legacyDeliveryImage` schemas implement
ADR-0028's retained legacy exception. Sanity mode requires an approved batch and
deployed handles; unknown handles are rejected before provider IO. Two fresh,
uncached Doc reads fence the bounded placement query. An ordered manifest digest
refuses stale, missing, foreign or independently changed images and ZIPs.
Publication and the exclusive UTC deadline are rechecked after IO. Missing,
unpublished, expired and malformed content is unavailable; provider failures
remain generic server errors. Direct original JPEG/whole-ZIP sources bypass the
public optimizer and ordinary tree/search/sitemap. The existing lightbox supplies
keyboard and touch viewing, with the generic fixture in development only.

All responses under the owned namespace receive no-store/noindex/no-referrer;
this is measured on a local production build, not asserted for a Vercel deploy.
Source JPEG/ZIP transport preservation is a separate import gate: the renderer
performs no resize, crop, re-encoding or metadata removal. Direct asset URLs
remain public after page expiry. Customer upload, old-link mapping, supported
production ZIP import/attachment behavior, baseline/usage/recovery, notice and
public activation remain open. AB#250 moved New → Active before edits and stays
Active; AB#18/117 remain Active. Validation and review scope are recorded in
[the preparation audit](audits/ab250-legacy-gallery-runtime-2026-10-10.md).

### AB#292 — retained-gallery gesture verification (2026-10-14)

CI #983 failed the mobile WebKit retained-gallery drag twice. The journey now
waits for the first photograph, derives the drag from rendered viewer bounds,
and yields an animation frame after each pointer move, matching PhotoSwipe's
frame-driven drag handling. The next-photograph assertion and tap close/reopen
coverage remain. Application behavior is unchanged. AB#292 moved New → Active;
the focused production-build journey passed three times each on desktop Chromium
and mobile WebKit with one Playwright worker (6/6). The interrupted earlier
local reproduction produced no browser result.

### AB#250 — offline retained-source import plan

The separate `plan:legacy-delivery` command produces a private, digest-bound
source review before asset binding or a writer. It verifies exact JPEG/whole-ZIP
and backup bytes, JPEG dimensions/orientation, source order, exclusions and
finite/indefinite availability. It neither transforms assets nor contacts Sanity.
Normalized source tuples bind every reviewed field; stable opaque placement IDs
preserve repeated photographs as separate positions. Expiry is rechecked after
IO, and an existing review result is never overwritten.

All customer input/results stay ignored with owner-only permissions. Synthetic
tests cover malformed input, descriptor collisions, exact expiry, source/backup
mismatches, format/orientation, symlinks, private output and fixed diagnostics.
The operator contract and remaining support/baseline/usage/recovery/notice/approval
gates are documented in [sanity-seeding](sanity-seeding.md#offline-legacy-delivery-plan-ab250).
This is an offline preparation slice: no CMS payload, asset upload, public
activation or old-link mapping is implemented here. AB#250/18/117 remain Active.
AB#353 makes the existing nonprivate-output test independent of the invoking
process's umask by explicitly applying mode 0755 after fixture creation. The same
21 tests pass under isolated child masks 0077 and 0022; production permissions
and the strict rejection assertion are unchanged.
The owner-local run verified all 21 retained galleries, 1,792 browse-image
placements, 12 whole ZIPs and the original backup against the source plan;
seven exclusions and nine absent packages are preserved. Validation: 58 focused
tests, all 217 browser-free test files / 5,147 tests, lint, production build and
three current diagrams. No public journey changed, so E2E was not repeated for
this operator-only slice. These checks establish a local source review, not
customer publication or a supported large-file provider guarantee.

### AB#250 — offline asset-bound document candidates

The pure document compiler rebuilds the retained-source review and validates
complete, exact candidate asset bindings before creating allowlisted legacy
gallery/image documents. It preserves source order, finite/indefinite access,
original dimensions and one unchanged referenced ZIP; it invents no missing
package. Galleries are always unpublished, and their ordered manifest follows
the merged runtime reader's contract. A separate candidate digest binds exact
asset identities and payloads without treating declarations as provider proof.

Synthetic tests cover malformed/contradictory bindings, missing/extra/duplicate
sources, shared assets with distinct placements, canonical ordering, exact expiry,
schema fields, detached frozen results and round trips through the real reader.
No runtime, schema, dependency or customer content changed. The compiler has no
IO or mutation path. Source/CDN verification, supported ZIP transport,
baseline/conflicts/usage/recovery, notice, exact mutation approval and publication
remain separate gates; AB#250/18/117 stay Active. See the
[operator contract](sanity-seeding.md#offline-asset-bindings-and-document-candidates).
Validation: 48 synthetic compiler tests, all 218 browser-free test files / 5,195
tests, lint, production build, strict type checking and three current diagrams.
No public journey changed; local E2E was not repeated for this pure-tooling slice.

**Service landing-page listing visibility, 2026-10-10 (AB#137, Active):**
An optional `service.hideFromListing` boolean omits a card in both default and
localized service listings while retaining the full service catalog for detail
routes, parent breadcrumbs, language links, sitemap and contact choices. Missing
or null flags preserve existing listing behavior; malformed values fail at the CMS
projection boundary. The source change is ready for review, not deployed. The
reference content flag is not set; publish the compatible reader before enabling
that listing-only CMS flag.

The separately approved Production content refresh completed on 2026-10-10:
three missing service documents, four prices across two existing bilingual
services, the two theme-specific logo references and the bilingual photographer
introduction were written. Six creates and six revision-guarded patches ran in
one transaction after a fresh full raw snapshot and verification that every
current asset was covered by the existing full binary archive. The three new
image assets preserve source bytes and native dimensions. The temporary
project-scoped Editor credential was revoked; its old key returned HTTP 401.
Unrelated content revisions were unchanged. No customer-gallery or DNS change
was part of this operation.

Validation: lint, production build, all 219 browser-free test files / 5,205 tests,
20 affected public-journey cases, four live Production adapter tests and the
full read-only post-write content audit. Fourteen public checks across desktop
Chromium and mobile WebKit verified the changed service prices/detail URLs,
logo delivery in both themes, portrait delivery and visible introduction. The
audit found no drafts/releases, missing image dimensions, stored original
filenames or media documents carrying private/internal metadata. Private
source, backup, operator and credential evidence remain outside Git. AB#137
remains Active; this refresh does not complete the wider launch work item.

**Design brand restoration and language choice on every page, 2026-10-11 (AB#137, Active):**
The footer now carries the hi-fi proposal's brand block (`.sfoot .fl`): the same
`siteSettings.logo` / `logoDark` pair as the header at the proposal's 62px height
(shared `brand-mark.tsx`, native ratio, decorative), beside this locale's site name
and the canonical origin's host as the site's address. The proposal's footer row
navigation and copyright are not duplicated; the existing footer columns keep them.
The header language entry is no longer limited to pages that publish their own
links: a page without a translation of its own (home, contact, a 404) offers each
other language's public story root with the visible "opens all stories" note
(`buildFallbackLanguageLinks`). The fallback appears only after hydration, and a
page's published language links take precedence over it;
without JavaScript such a page still has no language entry.

The 2026-10-10 Production refresh had pointed both logo media documents at the old
site's text-and-URL wordmarks. The approved correction replaces them with the
proposal's text-free `logo-mark.png` and `logo-mark-knockout.png` (256×249) and
authors the per-language site name and descriptor ("Valokuvaaja" before the name in
Finnish, "Photography" after it in English).

That separately approved Production correction completed on 2026-10-11. Two
byte-verified 256×249 PNGs replaced only `image.asset` in the two existing logo
media documents; the site settings' localized name and descriptor were patched
in the same three-document revision-guarded transaction. The baseline combined a
fresh full raw snapshot with the verified full asset archive and the three
subsequently added source assets. Unrelated content revisions were unchanged and
the old assets remain available for recovery. The temporary project-scoped Editor
credential was revoked, its old key returned HTTP 401, and the unrelated token
inventory was unchanged.

Eight public browser cases verified the corrected header brand in Finnish and
English, both themes, desktop Chromium and mobile WebKit, including native image
ratio, delivery and horizontal overflow. Existing service prices were preserved.
The footer, general language fallback and listing visibility source changes are
still uncommitted and undeployed; the reference listing flag remains unset.

Validation: lint; 220 browser-free test files / 5,209 tests; the full production
journey matrix (774 passed / 38 skipped, including four expected failures for the
existing AB#132 scriptless 404 limitation); 20 final brand/language cases; a build
against the updated Production read configuration; four live adapter tests; and
the full post-write raw audit (16,929 published documents / 5,150 image assets,
no drafts/releases, missing dimensions, stored original filenames or media
private/internal metadata). The bounded review finished without findings after
operator cleanup corrections and offline failure checks. Private sources,
snapshots, operator scripts and credential evidence remain outside Git. No code
deployment, customer-gallery mutation or DNS change was made. AB#137 stays Active.

PR #326 merged on 2026-10-11 at commit `83afd9d` after Azure Pipelines build #770
succeeded. The footer, language fallback and listing source changes are now on
`main`. AB#137 remains Active because this accepted slice does not complete its
wider launch requirements.

### AB#251 — Continuous lightbox browsing and return to the visible preview (2026-10-11)

Implementation is on `fix/251-lightbox-continuity`, awaiting owner review and
commit; the Bug is Active. The shared viewer disables looping for every gallery,
including article body and inline galleries. A gallery with a continuation asks
for one bounded cursor page when at most `max(1, min(5, floor(firstSliceSize / 4)))`
loaded photographs remain ahead. The existing grid single-flight guard and
adjacent-image preload window stay in use; opening early in a gallery does not
retrieve its archive. Appending preserves the current occurrence, caption and
result order, and makes the formerly empty next holder reachable in place.

At a loaded boundary the dialog announces pending loading or exposes an explicit
retry after failure; failed lookahead does not retry on every slide change.
Navigation stays on that image until the next slice arrives and the visitor
advances. Only an absent continuation cursor exposes the localized last-image
notice. The empty status region stays rendered so later text updates can be
announced. Focus moves inside the dialog before a terminal arrow or retry is hidden.

Closing waits for dialog teardown and the next layout frame, focuses the final
`itemId` trigger without relying on focus-induced scrolling, then brings its
preview into the viewport if needed. One further frame checks for a settling
layout/viewport adjustment without refocusing. Reopening or unmounting cancels
a pending restoration. This applies to appended items and repeated media occurrences in
row and masonry layouts.

The production-build regression suite covers early single-flight loading, a
held response, repeated forward inputs and gesture navigation, explicit retry,
multiple boundaries, exact-multiple and short final slices, a complete named
section, singleton termination, and focus plus viewport restoration. It runs on
desktop Chromium, mobile WebKit and a targeted mobile Chromium project. A
controlled focus-without-scroll case checks the fallback, alongside close-button,
keyboard and supported vertical-drag closing. The owner identified an iPhone 16
Pro Max with Safari and reported the jump after both the close button and a
closing gesture. The iOS version and precise gesture were not supplied. The
physical-mobile jump did not reproduce in the initial WebKit emulation; physical
device reproduction and post-fix verification remain owner-run checks.
Validation: lint, production build, all 220 browser-free test files / 5,209 tests,
and the full 857-case public-journey matrix (819 passed, 38 skipped), including
vertical-drag closing, rendered empty status and next-frame layout settling.
The one-time Claude implementation-plan review is complete; final diff-review
evidence accompanies the owner handoff. Physical Safari verification is pending.

**Home latest stories and service packages, 2026-10-11 (AB#252, Active):**
The home page shows a "Latest stories" section (two cards and an "All stories" link,
design frame 05) between the photographer introduction and the portfolio. It orders
the story root's routed public content by each page document's own `_updatedAt`,
newest first with `contentId` as the tie-break, so an old trip added later or a
revised story surfaces. This is a separate bounded read (`getLatestContent`,
`LATEST_CONTENT_ORDERING = updated-at-desc-v1`; Sanity `article.latest` /
`gallery.latest`, cached under the same families as the listings): the story
listings keep their event-date order, which stored continuation cursors depend on.
Cards come from the shared `StoryCard`, so covers keep their native ratio. The card
still displays the effective event date, not the update time.

Known limit: adding photographs to an existing gallery changes its placement
documents, not the gallery document, so it does not move that gallery up; a new
gallery, or an edit and publish of the gallery document, does.

A service page that has child services lists them under a "Packages" heading as
cards with name and cover at native ratio (`ServiceDetail`, direct children only;
children flagged `hideFromListing` stay listed there). The service cover on cards and
detail pages was already supported in code. On 2026-10-11 the current published
CMS read showed covers on all eleven Finnish/English service documents and
`siteSettings.featuredGalleryId` set to `portfolio`. The protected Production
candidate rendered that content, the two independently checked latest stories,
native-ratio covers, package links and the corrected header/footer brand.
The existing public alias still serves source `8e3efe6`; it has not activated
the `050298c` candidate. AB#252 remains Active pending public release acceptance.

### AB#18 — Protected current-source Production candidate (2026-10-11)

Green main CI #778's source `050298c` was built manually with allowlisted public
Production settings and staged without moving aliases. All 735 uploaded archive
members matched local manifests. Thirteen current-content GET cases, desktop
Chromium/mobile WebKit branding and lightbox checks, and 415 legacy registry
cases passed their decided expectations. Pending redirect decisions and the
AB#132 scriptless 404 semantic failure remain open. The enabled Production
webhook already exists; no hook or secret was changed.

The candidate is protected and noindex. The public default alias's indexing
policy, activation/rollback checks, customer-gallery continuity and custom-domain
cutover remain release gates. No CMS mutation, real contact delivery, alias move
or DNS change was performed. See
[the candidate audit](audits/ab18-production-candidate-2026-10-11.md).
AB#18, AB#117 and AB#137 remain Active.

### AB#18 / AB#117 — Assigned Production alias indexing preparation (2026-10-11)

`fix/18-production-alias-noindex` adds optional build-time
`PRODUCTION_NOINDEX_ALIASES` for explicitly listed noncanonical Vercel hosts.
Only Production-target builds emit exact-host noindex rules; malformed settings
and attempts to include the canonical hostname fail. Unconfigured clones and
Preview's existing header rules remain unchanged. No provider setting or serving
alias was changed. A new Production build and live edge/header checks are needed
before this preparation can resolve the reference alias-indexing gate. Both
items remain Active.

### AB#278 — Studio formatter exposure evidence (2026-10-13)

[The scoped sprintf-js investigation](audits/ab278-studio-sprintf-exposure-2026-10-13.md) reproduces the installed precision RangeError while tracing its CLI/YAML-formatter dependency path. Fresh audit retains eight moderate affected nodes and no patched release. The normal YAML import excludes argparse/sprintf; the actual compiled Studio's 321 maps (2,115 sources) and all four unmapped helper scripts contain no affected-package source. No browser call path was found in this observed build. No dependency was changed, alert dismissed or risk accepted. AB#278 remains Active pending evidence PR merge; AB#117 and final hosted-release/risk acceptance remain open.

### AB#254 — Standalone Sanity Studio (2026-10-11, Closed)

The optional `studio/` package reuses the canonical `sanity/schemas` without copies
and keeps its dependencies, lockfile, type check and static build outside Next.js.
Public configuration supplies the existing project/dataset, actual visibility,
complete localized route table and editor title; no embedded credential is used.
Home and site settings resolve the existing singleton identity, including imported
IDs and draft/release variants. Failed, malformed, excessive or conflicting query
results stop the pane rather than creating replacement documents. Creation
templates and destructive/duplicate actions for these types are excluded.

Editorial navigation covers services, articles, galleries, placements, shared
media, categories, article end galleries and polls. Image previews preserve the
full frame with contained, bounded thumbnails. Legacy-delivery schema types stay
available to their separate approved importer but have no Studio navigation,
creation template or document action. Private-client records, public draft preview,
translation/AI workflows and category URL-change management are outside this slice.
The public site's dependencies, published reads and media boundary are unchanged.

CI adds a separate synthetic Studio schema/type/build job and scheduled lockfile
audit. Root browser-free tests cover routing settings, singleton resolution,
editorial policy drift, preview sources and generated notice policy without a live
CMS or Studio dependency install. Build notices cover the full installed dependency
tree. The remaining moderate-only YAML CLI advisory chain is recorded in the
asset inventory; it is not a clean dependency audit.

The owner-selected Sanity hostname was deployed after the offline gates, including
a required successful schema-store deployment. Chromium reached the hosted
address's redirect to Sanity's account login. It has no authenticated editor
session; a vendor login-page script error was observed, so this is evidence of
the login entry point, not an error-free editor check. CLI read-only queries
confirmed one existing home and one site-settings identity, and the generated
public-dataset schema omits archiveLocator. Authenticated panes, prepared test
content publication and webhook propagation remain owner-run checks. No dataset
was created, CMS content migrated or production document rewritten.
PRs #331–#333 were inspected; their operational/preflight changes do not change
the canonical schemas consumed here. Main through #333 was merged into the Studio
branch, preserving both histories in the feature-status conflict resolution.
[PR #334](https://github.com/Alpine78/photosite-starter/pull/334) merged at
`a9c64b74134d023e2e289e3eded3ced282717d90` after CI #791 passed both jobs for
`1e12ddee46f7a3efe687ad991e6dffc12b82bd21`. The run passed all 5,393 browser-free
tests; Playwright reported 848 passed, one passed on retry and 38 skipped.
AB#254 moved New → Active before the first edit and Active → Closed after the
owner-authorized merge. The live editor checks above remain outstanding.

**Service overview CMS preparation, 2026-10-11 (AB#137, Active):**
The published FI/EN wedding overview still lacks `hideFromListing`; its card
therefore remains on the protected latest-main candidate. A complete stable
16,945-document raw snapshot covers 5,158 assets using unchanged prior recovery
evidence and ten newly preserved original public-derivative byte copies. The
private non-writable plan binds exactly two boolean patches to current revisions
and preserves original documents for a post-write-revision rollback. It cannot
approve or perform an import. Compatible public renderer activation and a new
pre-write freshness check remain prerequisites; no credential was minted or CMS
mutation performed. [Preparation evidence](audits/ab137-service-listing-preparation-2026-10-11.md)
records asset coverage, unexercised restore and remaining gates.

### AB#250 — offline initial-import collision evidence (2026-10-11)

A pure preflight rebuilds the unpublished source/binding candidate and compares it with
a bounded, caller-declared raw baseline. It refuses occupied IDs including draft/release
copies, source-batch and handle claims, and the baseline's single projected reference.
Canonical digests bind every projected revision, target and capture time; malformed,
stale, duplicate and effectful input fails closed. Collision reports contain only codes
and counts. No uploader, writer, resume, replacement, deletion or publication is added.

This is preparation for initial-import review, not authenticated baseline completeness,
source/CDN-byte proof, recovery evidence or full AB#250 acceptance. Supported intact ZIP
transfer, live atomic collision enforcement, usage/notice reconciliation, actual import,
legacy links and deployed customer verification remain open. AB#250/18/117 stay Active.
See [sanity-seeding](sanity-seeding.md#offline-first-import-collision-preflight).


### AB#18 — Current-main alias-indexing release preparation (2026-10-11)

Exact green main CI #789 (`14b1af0`) was built manually with allowlisted public
Production settings and staged as a protected Production-target candidate.
All 735 uploaded archive members match the local output and runtime-input
manifests. Thirteen content GET cases, desktop/mobile browser checks and 415
legacy registry cases passed their decided expectations. A fresh full dependency
audit reports zero vulnerabilities. The AB#132 scriptless semantic failure and
48 pending AB#19 mapping decisions remain open.

The nonsecret `PRODUCTION_NOINDEX_ALIASES` setting now lists both assigned Vercel
aliases in Production only. The protected alias was temporarily moved to the
candidate: ten route cases confirmed noindex and disabled customer-route policy,
then its exact prior UID was restored with settled readback. This tests that
alias path, not project promotion/rollback or customer handoff. Both serving
aliases and the project Production target remain on the prior artifact; the
public default alias therefore still lacks the new noindex header.

The fresh read-only CMS snapshot covers 16,947 documents and 5,158 assets,
preserving concurrent Studio changes and the owner's settings draft. No CMS
write credential, wedding-overview mutation, customer import or DNS change was
performed. Contact and genuine webhook delivery, activation-specific rollback,
full launch prerequisites and supported whole-ZIP customer transport remain
open. AB#18/117/137/250 remain Active. See the
[activation preparation audit](audits/ab18-production-activation-2026-10-11.md).

### AB#18 — Compatible Vercel alias activation verified (2026-10-11)

After ordered merges #334 and #335, both existing Vercel aliases now serve the
tested `14b1af0` Production artifact, `dpl_6e4xtTvbq7Zd39g3mmp9AVNL7KYF`.
The final two alias writes were acknowledged and their destinations verified;
the project pointer targets the same candidate. All 28 public/protected GET
cases and Chromium/mobile WebKit journeys passed, including noindex, seven
service prices, latest-story comparison, both-theme branding and gallery
open/next/close/reopen. Configuration, raw CMS revisions and source guards passed.
The owner's earlier physical iPhone result is not claimed for this candidate.

Earlier failed settling/browser checks caused verified exact-old alias restores.
The job-state detector was corrected by Claude, and the private browser smoke now
waits for actual viewer focus before Escape. A concurrent documentation-only
main merge (#336) correctly stopped the third attempt before provider writes;
its unchanged application delta and explicit main pin were then independently
reviewed. Seven diff rounds, including the round-6 complete-authority retry,
ended clean before final apply. Original receipts remain private and preserved.

The root dependency audit remains clean. The isolated Studio lockfile has one
`sprintf-js` advisory affecting eight dependency-chain entries; Studio is absent
from this prebuilt public application. No application-code, CMS, credential or
DNS change was made. Canonical launch, supported customer ZIP transport, fresh
contact/webhook delivery and genuine recovery/handoff gates remain open.
AB#18/117/137/250 remain Active; AB#118 remains New. See the
[bounded activation audit](audits/ab18-compatible-alias-activation-2026-10-11.md).

**Publication census, 2026-10-13 (AB#269, Active):** a revision-bound offline
metadata tool separates published coverage, drafts/releases, pending editor review
and canonical-category prerequisites. Fresh GET-only evidence records 18 English
article gaps (18 drafts), five service gaps and one category gap. No CMS write or
translation acceptance occurred. [Evidence](audits/ab269-publication-locale-census-2026-10-13.md).

### AB#276 — actual article publication preparation (2026-10-13)

[The actual eighteen-article plan](audits/ab276-actual-article-publication-plan-2026-10-13.md) now builds against the published English Blog category and current stable Production raw state, without simulation or changed copy. Owner workbook/packet provenance matches; eighteen atomic article/placement batches create 662 published documents and delete their 662 editing drafts. Complete current local recovery rehashes all 5,158 assets and the 17,614-document sidecar. The exact private operation request is ready for separate publication approval, with partial-write reconciliation, fresh post-credential recovery and writer cleanup specified. No CMS write, provider dry run or writer creation occurred. AB#276 stays Active pending preparation PR merge; AB#255 and remaining launch gates stay open.

### AB#255 — Finnish and English on every page (2026-10-11, Active)

**AB#352 enquiry privacy locale correction, 2026-10-18:** the gallery-item
enquiry now reuses the contact page's requested-locale settings loader. Previously,
the form labels followed the route language but its four authored privacy
statements came from the deployment default. Both default-language directions
are covered by actual-component rendering tests; the production journey compares
the complete enquiry notice with the same-language contact page without JavaScript.
Missing additional-language settings retain the contact loader's unavailable
policy, so an untranslated notice does not silently appear in another language.
That classified failure is tested at the deterministic seam, not against the
mock production source; an enquiry entry may therefore lead to unavailable
content until that language's notice is authored. Default and unrelated settings
errors still propagate. AB#352 is Active pending review and merge; AB#255/60/289
acceptance and live authored-content verification remain separate.

The owner confirmed coverage includes historical articles/galleries and customer/
administrator pages, and requested home/contact as the first slice. The story
moved New → Active before the first edit. The owner committed the first slice
as `65a0cd9`; PR #338 merged as `2fc58f7` on 2026-10-12 after
the owner's conflict/integration commit authorization, a clean final review and
successful mandatory Azure Pipeline #799.

Shared home/contact Server Components now accept the route locale. Configured
non-default locale bases serve a real home and `/contact`, including native-ratio
media, requested-language copy/privacy/service choices, exact language switching
with a scriptless fallback, canonical/hreflang and availability-driven sitemap.
Missing required non-default language entries withhold only those static versions;
missing default copy, malformed CMS data and provider failures still fail.
Header/footer and home/service calls to
action retain the selected language. The fixed contact endpoint, payload,
validation/throttle and owner-language email are preserved. Shared settings reads
normalize the default locale before React caching. WebSite/Organization JSON-LD
remain on the default home as global entities.

[ADR-0029](adr/0029-localized-home-and-contact-pages.md) records the static URL and
availability contract. [The page-family inventory](bilingual-page-coverage.md)
records the wider work still required and its ownership; no live CMS translation
count or full bilingual completion is claimed. The owner reaffirmed permanent
Claude context-sharing consent; AGENTS.md and existing Claude project memory
record it. No live CMS writes or deployments were performed.

The 2026-10-12 integration retained both appended status sections from main
and the feature branch. Review also isolated the home-link availability read:
a defective home no longer breaks unrelated contact/service/story pages through
their shell. The home render and sitemap remain strict. The ADR index now keeps
0029 inside the table. AB#255 remains Active after this first slice merges.

Validation after 2026-10-12 integration corrections: lint, all 228 unit-test files /
5,420 tests and architecture diagram
freshness passed. The production-build journey matrix passed 867 cases with 38
existing skips; AB#132's marked scriptless-404 failures remain visible rather
than claimed fixed. After self-review and review corrections, a fresh production build and
44 affected home/contact/navigation/sitemap journeys passed. The bounded Claude diff review
is recorded in the local handoff evidence. AB#255 stays Active: this first source
slice does not fulfill the whole story.

**Public-language census, 2026-10-12:** the owner chose published services,
articles and galleries as the next slice. Two identical narrow published reads
and independent counts cover 125 rows: 38 article versions, 64 gallery versions,
11 service versions and 12 shared categories. Stable identities show 28 FI /
10 EN articles (18 missing EN), 32 FI / 32 EN galleries (all paired), and 8 FI /
3 EN services (5 missing EN). No English-only identity lacks its Finnish version.
One category lacks its English label/slug; it is the source canonical category
of all 18 missing English articles, so its localization comes first. Currently
published versions pass the narrow ancestry checks. This is metadata presence,
not accepted body/SEO/media translations or HTTP/deployment verification.
[The dated inventory](audits/ab255-public-language-inventory-2026-10-12.md) records
scope, reproducible queries, receipts and remaining ownership. AB#255 remains
Active; no CMS write, deployment or customer/admin change was made.

**English copy preparation, 2026-10-12:** PR #340 merged as `e91e185` after
#339 and required CI #804, preserving both status-history sections. The owner
selected the missing English category and service copy drafts as the next slice.
Two matching current published source reads still show 8 FI / 3 EN services and
one category missing English label/slug. Local proposals cover that category's
label, first slug and description, and all five missing services' names, slugs,
short descriptions, 14 body paragraphs and pricing wording. They preserve
source prices/durations, stable identities, parents, order, cover references
and price-row keys. The existing pure service-route builder accepts the proposed
English graph; this does not change published coverage. Owner wording/slug and
shared-media text review, FI/EN draft reconciliation and fresh revision checks
remain open. No CMS drafts were created and no copy was published.
Later CMS authoring must coordinate with [ADR-0030](adr/0030-legacy-identity-retirement.md)'s
writer freeze and refresh mapped source identities/revisions after cutover.
[The preparation receipt](audits/ab255-english-copy-drafts-2026-10-12.md) points
to the ignored FI/EN workbook and structured suggestions. AB#255 stays Active;
the 18 article counterparts and other page families remain unfinished.

**English article copy, batch 1, 2026-10-12:** after PR #345 merged as
`883f87b` with required CI #816, the owner selected article drafts and a separate
public-gallery text inventory. Current published counts remain 28 FI / 10 EN,
with 18 missing-English identities. Every candidate has additional block kinds,
so the first local proposal covers the shortest complete article-owned body:
15 paragraphs, five headings and seven per-version media captions, plus title
and first EN slug. All 28 blocks and non-text fields/references remain; the
FI poll is preserved with an explicit English publication gate. Matching raw
article metadata sees no associated EN or unpublished FI variant for this source.
Its category proposal still matches the current revision. Seven shared images
need EN alt; the poll, 41 FI end-gallery occurrences and historical UI instructions
need editorial reconciliation. Seventeen other article proposals remain open.
[The dated copy receipt](audits/ab255-english-article-drafts-batch-1-2026-10-12.md)
points to the ignored full FI/EN workbook and non-writable suggestions. No CMS
draft, publication, deployment or runtime change occurred; AB#255 stays Active.

**Service-cover language inventory, 2026-10-12:** the owner selected FI/EN alt
and caption coverage after PR #342 merged as `26b906b`. Its integration commit
`c7cfe6a` passed full required CI #810; the reviewed, tested and merged trees match.
Two matching scoped published reads find 11 service versions referencing eight
shared covers. All eight have nonempty FI/EN alt; optional captions are absent
in both languages. No current service version needs alt fallback. The direct
published consumer graph has 11 documents, all services; three covers are shared
by FI/EN siblings. Five prior copy proposals retain their source revisions and
cover references. No observed cover-language metadata gap requires new text;
owner review of image meaning/translation quality and pending drafts remains.
[The dated cover inventory](audits/ab255-service-media-language-inventory-2026-10-12.md)
records exact scope, receipts and limits. Local detail stays ignored. No image
bytes, CMS writes, publication or deployment occurred; broader AB#255 stays Active.

**Home/contact copy inventory, 2026-10-12:** PR #343 merged as `d321b70` after
required CI #812; owner commit `3e30bdf`, its tested tree and the merged tree match.
The owner chose published home/contact content and any missing-English drafts.
Two matching narrow reads find FI/EN in all 16 authored shared-settings and nine
home text fields, including all four privacy fields; four referenced media have
both alt languages and no captions. Two equal logo alt pairs are personal-name
branding. Optional address/services intro/CTA blocks remain absent in both languages.
No English copy was missing, so no new text or CMS draft was created. A separate
matching metadata read confirms only three English service identities against
eight default-language identities; five service counterparts remain open.
[The dated content inventory](audits/ab255-home-contact-content-inventory-2026-10-12.md)
links the ignored full FI/EN workbook and receipt. Field presence does not accept
translation/image meaning, prove complete page/destination/form journeys or
authorize Production activation. No CMS write or deployment occurred; AB#255 stays Active.

**Public-gallery document text inventory, 2026-10-12:** PR #345 merged as
`883f87b` after required CI #816; its reviewed/tested and merged trees match.
The owner selected this inventory alongside a separate article-copy batch.
Two matching published graphs contain 32 FI/EN gallery pairs, with matching
presence for all optional summaries (19 pairs) and bodies (30 pairs). Titles
are identical in 12 pairs; slugs in 15. Among 208 section versions, 103 identities
pair across languages: 68 labels are identical and 35 differ. One gallery has
one unmatched section identity per language. No section introductions or tags
are authored. Body structure differences and identical names are review signals,
not automatic translation defects. The narrow slug/category metadata checks
found no missing placement-language field or collision. Shared-media and
placement text, semantic acceptance and live journeys remain open.
[The dated inventory](audits/ab255-gallery-text-language-inventory-2026-10-12.md)
points to the ignored complete FI/EN comparison workbook. No CMS write,
publication, deployment or runtime change occurred; AB#255 stays Active.

**Shared-media language inventory, 2026-10-12:** PR #350 merged as `504f05a`
after full required CI #830. Its exact merged tree matches the tested candidate.
The owner's committed audit and nine private evidence hashes matched the prior
clean review; the integration correction acknowledges AB#260's accepted policy
without inferring CMS-write or freeze approval. Both policy corrections passed
one joint Claude review without findings. The published record inventory covers
5,272 eligible media, with 687 FI-only alt records and 679 one-language captions.
Actual consumers, occurrence overrides, image meaning and draft/release state
remain separate. [The dated inventory](audits/ab255-shared-media-language-inventory-2026-10-12.md)
contains counts, scope and owner-only receipt location. No CMS write occurred.

**Category-description inventory, 2026-10-12:** PR #351 merged as `9fb9631`
after full required CI #831. The candidate and actual merged trees match;
the only addition to its tested tree is PR #350's already reviewed/merged audit,
with all runtime and other tracked files unchanged. No merge conflict occurred.
The 12 categories have 8 both-language, 1 FI-only, 1 EN-only and 2 absent optional
description pairs. The missing category label/slug still blocks dependent EN
articles; optional absence is not automatically a gap. Shared-category changes
require their own authoring path: AB#125 does not update them and the category
writer's `createIfNotExists` does not patch an existing document.
[The dated inventory](audits/ab255-category-description-language-inventory-2026-10-12.md)
keeps real wording, identities and revisions in owner-only local evidence.

**English article copy, batch 2, 2026-10-12:** the next local proposal covers
18 paragraphs, six headings, five quotes and eight per-version captions, plus
title and first EN slug. All 38 blocks and non-text references remain unchanged.
Four model/name captions deliberately match the source pending owner review;
source numeric/fraction literals are retained pending formatting review. Fresh
count-bound published and associated raw-metadata reads match; no associated EN,
draft or release variant was observed for the selected source. Its category
still lacks EN label/slug. Thirty-six referenced public media need EN alt/caption
review; 36 visible end-gallery occurrences and the inherited closed FI poll
remain publication gates. Across batches 1 and 2, two distinct articles have
complete local article-owned proposals and 16 remain unprepared in those packets.
Published counts remain 28 FI / 10 EN, with 18 missing EN versions.
[The dated copy receipt](audits/ab255-english-article-drafts-batch-2-2026-10-12.md)
points to the ignored complete FI/EN workbook, non-writable suggestions and
source/structure/reference/numeric/heading/slug validation. No source metadata,
CMS draft/write/publication, schema/runtime or production deployment changed.
Application gates are not rerun for copy/documentation alone; source observations
do not establish actual route or image-semantic acceptance. AB#255 stays Active.

**Localized-content authoring preflight, 2026-10-12:** both PR #355 and #356
are merged on source baseline `4382537`. PR #356 merged externally as `13d9eab`
before #355; CI #839's tested and merged trees match. PR #355 then merged after
CI #840. This continuation began after both; AB#255 remains Active.

[The bounded offline receipt](audits/ab255-content-authoring-preflight-2026-10-12.md)
joins one category, five services and two article proposals, all owner-pending.
Input hashes and eight non-writable/non-executable/non-publication-ready rows
match. Existing category/service creators use createIfNotExists; the existing
shared category needs a manual accepted edit and service coverMedia is outside
the CLI's closed field set. AB#125 currently rejects any source poll block and
has no target-only override, so batch 2 is not plannable as-is; never change its
FI source to bypass this guard. Current source/draft/release reconciliation,
category/media/placement/poll review and owner copy/publication acceptance remain
gates. AB#260's first three implementation policies are accepted; actual target,
freeze, asset-copy, restore/cutover/write/deploy are still separately gated.

Parallel public-journey, restricted-locale-contract and Studio core-UI branches
own separate work. This source/offline documentation slice creates no writer,
target ID, live CMS request/write, dependency/schema/runtime change or deployment;
application/Studio builds and journeys are not rerun for it.
The owner directed this continuation to proceed without Claude on 2026-10-12;
Codex completed the source review and applicable checks. Earlier reviews remain
history; no session-reset wait remains for this slice.

**Service locale journeys, 2026-10-12:** the services suite adds seven cases
across the configured English and Finnish route spaces, retaining the original
six. It now checks localized pricing/form labels, complete image frames and real
dimensions/alt, stable-ID contact prefill, nested-service breadcrumbs, canonical
and actual alternates, real 404 statuses, and scriptless equivalent nested-service
switching in both directions. The unchanged production-build harness passes all
26 desktop Chromium/mobile WebKit cases without retries; lint and all 5,720 tests
in 239 files pass. [The dated receipt](audits/ab255-service-locale-journeys-2026-10-12.md)
separates fixture assertions from authored translation/deployment acceptance and
records the remaining legacy default-service language-link/metadata parity.
No app runtime, fixture, dependency or CMS data changed; AB#255 remains Active.

PRs #360, #361 and #362 merged externally as `8674d47`, `d347dd0` and `3da712b`
after CI #846–#848; their source bytes match the previous review. They merged in
that order while #358/#359 were still open. This continuation ran no merge
command for those PRs and did not need conflict corrections or new commits.
ADR-0032 remains Proposed. Seven completed AB#255 worktrees were retired with
all 703 ignored local files preserved and verified; branch refs, unfinished
Studio core locale work and other-agent checkouts remain. The two new worktrees
are published with same-name upstreams; the owner directed continuation without
Claude, and source review/applicable checks are complete.

**Standalone Studio language discovery, 2026-10-12:** PR #353 merged as
`f0d3e50` after required CI #835; owner commit `91b3baf`, three reviewed files,
25 private evidence hashes and the tested/candidate/merged trees match. No merge
conflict or source correction was needed. AB#255 stays Active after this partial
slice; copy acceptance and publication dependencies remain pending.

The next independently planned worktree compares core UI, project interface and
authored content. Studio pins Sanity 6.18.0 and configures no Finnish locale.
The candidate `@sanity/locale-fi-fi@1.1.40` declares a compatible peer range, but
runtime compatibility is untested. Exact archives match published integrity;
inert source parsing compares 2,151 English keys in 13 core-package namespaces
against 1,992 matching Finnish literals. Missing: 159, including all 108 keys in
the absent `variants` namespace and 51 elsewhere. Twenty-six paired values match
verbatim; package-key presence and equality are not wording or UI acceptance.

A coarse 39-file project-source inventory finds 321 literal title and 135
description properties, one literal structure-title call, plus 54 literal-return
and 58 template-return candidates. These are source occurrences, not exhaustive
rendered labels or unique validation messages. Core locale resources do not
translate schema, structure, preview or custom validation source strings.
[The dated discovery](audits/ab255-studio-language-inventory-2026-10-12.md)
records bounds, primary sources, private evidence and remaining API/runtime/owner
journey gates. No package/config/schema/CMS/deployment change or application/Studio
gate rerun occurred. This slice establishes no fully bilingual Studio.

**Standalone Studio core locale choice, 2026-10-12:** the separately planned
`feature/255-studio-core-locale` slice registers `@sanity/locale-fi-fi@1.1.40`
next to structureTool, retaining the English core choice and existing project
schemas/editorial/full-frame/auth/content/deployment contracts. One exact
locale dependency is added; all existing lock entries remain unchanged.
Studio typecheck, zero-error schema validation and synthetic static build pass;
the compiled plugin/fi-FI ID and original MIT artifact notice are present among
896 package notices. Audit retains the same eight moderate advisories, adding
none. [The bounded build receipt](audits/ab255-studio-core-locale-build-2026-10-12.md)
records actual proof and pending authenticated switching/persistence/wording,
159 missing keys, and separate project interface/authored text. No live CMS
request/write, login, deployment or public Next.js behavior change. AB#255 stays
Active; this source feature does not complete the Studio/all-pages story.
The owner directed this continuation to proceed without Claude on 2026-10-12;
Codex completed the source review and applicable checks. Earlier reviews remain
history; no session-reset wait remains for this slice.

**Studio structure titles, 2026-10-12:** the project-owned `photosite-editorial`
namespace supplies 11 English/Finnish title resources for the content root,
home/settings singleton entries and document panes, and eight editorial lists
and their child panes. Original English fallback titles, schema types, document
identities, queries, sorting, menus and editorial controls remain. Root lint,
Studio typecheck, zero-error schema validation, static build and all 55 focused
editorial tests pass. An actual pinned-Sanity synthetic builder check verifies
21 localized nodes, matching dictionaries and preserved whole-type counts.
[The dated receipt](audits/ab255-studio-structure-locales-2026-10-12.md) records
exact scope and build/source evidence; no dependency, canonical schema, content,
auth policy, live CMS request/write or deployment changes.

This bundle registration does not enable a Finnish core locale choice: the
separate core-locale branch remains uncommitted at this receipt. Authenticated
rendering/switching/wording and schema/preview/validation text remain pending.
The owner directed continuation without Claude; source review and applicable
checks are complete. AB#255 stays Active after this partial source slice.

### AB#256 — Readable Studio names (2026-10-12, Closed)

The owner reported Joomla-derived category/image-placement titles and apparent
duplicate content in Studio. AB#256 moved New → Active before the first file
change. The Studio adapter now overrides preview metadata only: article and gallery
subtitles show their language and slug; categories show authored
localized labels and language tags; gallery and article-end-gallery occurrences
show a one-based authored image number, container title, language and the shared
media's public web-image thumbnail. Missing draft metadata is explicitly marked.
The existing full-frame preview renderer receives the image instead of the media
document reference. Stored identities, references, canonical schemas/publication
validators, document-list sorting and the public application remain unchanged.

A published-only read on 2026-10-12 confirmed that RaceWKND has 60 distinct media
references and 60 distinct orders per FI/EN version (120 placement documents),
while Austrian Grand Prix 2021 has one gallery document per language. These are
language siblings and separately queried image occurrences, not evidence of
unwanted copies. Equal titles elsewhere still require checking their identities
and references before any duplicate-content conclusion. No CMS data was rewritten
or removed, and no Studio deployment was performed. Authenticated list, document
heading and reference-picker checks remain owner-run after publishing the Studio.

[AB#257](https://dev.azure.com/ilkkarytkonen/photosite-starter/_workitems/edit/257)
was created New to track a separate plan for replacing Joomla-derived persistent
identities after migration/reimport and recovery acceptance. Readable labels can
ship now; identity replacement requires a complete mapping, consumer/reference
inventory, rehearsal, restorable snapshot and reimport/rollback policy. Joomla
names do not introduce a runtime dependency on Joomla. The editor guide records
this distinction; this slice does not implement that migration.

Offline validation passed in `feature/256-readable-studio-names`: lint, all 229
browser-free test files / 5,448 tests, the public production build and Studio
typecheck/schema validation/static build with synthetic CI configuration. The
installed Sanity preview preparer also accepted localized label arrays and a
resolved public-image selection. No public journey changed, so Playwright was
not rerun locally for this presentation-only slice. The owner committed the
reviewed source as `6aed214978e6da5e2d76bcf577a453b0178162f5` and approved the merge.
[PR #339](https://github.com/Alpine78/photosite-starter/pull/339) merged at
`48f8971791a960686ba40bfb2b7508b86cd5e673` after Azure CI #801 passed the complete
Verify and Studio gate. AB#256's Active → Closed transition was confirmed after
merge. Studio deployment and the authenticated editor checks above remain separate.

### AB#349 — Readable body-image previews (2026-10-18, Active)

AB#349 moved New → Active before editing its published worktree. The remaining
ordinary body-image preview used a technical media identity despite an authored
caption. A compiled regression reproduced that failure on the accepted base.
Studio now prefers the placement caption, then existing localized media
captions/alternative text; it preserves the selected description's actual
language without assigning one to an untagged placement caption. Missing
references/descriptions have an explicit FI/EN fallback. The existing full-frame
public-image preview, canonical fields, validators, stored identities, ordering,
public URLs and other preview/plugin behavior stay intact.

Synthetic composed-schema and focused preview tests cover these paths. Local
validation passed: all 7,818 unit tests, 55 focused preview tests, full lint,
root/Studio strict typechecks, zero-error schema validation, Studio static build
and a synthetic Next.js production build. Final-head CI and owner acceptance
remain pending. Hosted preview-store
reference-array loading and authenticated editor acceptance remain separate from
offline hydrated fixtures. This changes no architecture boundary or diagram;
AB#301 stays Active for deployed-editor acceptance and actual identity retirement
under accepted ADR-0030/0031. No CMS write or Studio publication is performed.

### AB#257 — Legacy identity retirement discovery (2026-10-12, Closed)

AB#257 moved New → Active after PR #339 merged and before the first change on
`chore/257-identity-retirement-plan`. [ADR-0030](adr/0030-legacy-identity-retirement.md)
is now Accepted: on 2026-10-12 the owner approved all 1,541 mapped domain IDs,
retaining Sanity document IDs/references. The candidate-file SHA-256 is
`ee799ba63ea453749f2715f7ed6f6e2e65ca4389c47825f3963f5433d0b46e41`.
The original non-writable artifact remains unchanged; a separate private receipt
records the acceptance. Dated amendments to ADR-0002/0003 record the conditional
one-time exception without changing ordinary publication validators.

The authenticated single-request export at 2026-10-12 05:20:51–05:21:00 UTC contains
16,947 documents, including the settings draft and system records. A subsequent
complete raw revision index matches it; all 19,063 references resolve in this
snapshot. Private evidence under the ignored
worktree `temp/identity-retirement/` includes the full snapshot, 99 source/recovery
artifact locations, a complete candidate map and verification summaries. No real
slugs, source paths or full mapping are committed.

The map covers 24 content, 12 category, 20 end-gallery and 1,485 placement
identities: 2,393 proposed fields in 2,368 documents, retaining Sanity `_id`/`_ref`.
It has no collisions, swap chains or unknown old-identity string consumers.
Offline substitution changes only proposed fields. Complete manual occurrence
orders (27 containers), content listings and category sibling groups (five groups)
remain equal. No affected container is seeded. Old/already-new/conflicting state
checks use the same map; no fresh proposal is claimed as a safe resume plan.

The owner accepted both the smaller page/category scope and occurrence renaming.
The ADR records cursor/enquiry compatibility, source freeze, import retirement, transaction
and post-write rollback guards. Existing writers can restore old fields or remint
provider IDs if only a manifest is changed; they need retirement or an accepted
retained-document mapping before cutover.

This is discovery and review evidence. No reusable migration tool, writer, schema
relaxation, CMS rewrite, asset change, deployment or restore rehearsal was performed.
Mapping/scope acceptance (AC2) is recorded in the work-item discussion. The owner
committed the accepted plan as `535006b`; [PR #341](https://github.com/Alpine78/photosite-starter/pull/341)
merged as `53bc148` after required Azure CI #807 passed. AB#257's Active → Closed
transition was confirmed after merge.
Future implementation/live write needs its separately accepted plan, refreshed
inventory and reconciliation against the approved map. Changed mappings require
renewed acceptance. The document export is not a verified asset backup.

### AB#258 — Offline approved identity reconciliation (2026-10-12, Closed)

After PRs #341 and #342 merged, the owner requested continuation. AB#258 was
created and moved New → Active before the first edit on the published
`feature/258-identity-reconciliation` branch. The first implementation slice is
`npm run reconcile:identities`: bounded local IO with an adjacent deterministic
module and synthetic tests. It verifies the original map/baseline/approval
digests and scope, reports old/already-new/conflicting states, revision drift,
new affected variants/fields, collisions, unknown consumers and reference closure.
Inputs remain unchanged and every report is non-writable and not cutover-ready.
No CMS writer, schema relaxation, compatibility alias or dependency was added.

A separate authenticated single-request export at
2026-10-12 08:26:11.456–08:26:19.601 UTC contains 16,947 documents; a subsequent
complete raw revision index matches. Its SHA-256 is byte-identical to AB#257's
baseline. The current dataset therefore introduces no snapshot delta in this
observed window, consistent with AB#255's local-only copy suggestions. The initial
CLI run classified all 2,368 approved documents / 2,393 fields as old, covering
the 1,541 mapped identities with 19,063 resolving references and no blockers.
Private export, revision index, provenance receipt and report stay in the ignored
worktree `temp/identity-reconciliation-evidence/`; original AB#257 artifacts stay
unchanged in their retained worktree. This is read evidence, not a source freeze,
binary backup or migration rehearsal. Actual writing remains a separate phase.

The owner committed the reviewed patch as `1857fad`. [PR #344](https://github.com/Alpine78/photosite-starter/pull/344)
merged as `ad3a29b` after Azure CI #814 passed, including public Playwright and
standalone Studio gates. AB#258's Active → Closed transition was verified.

Local validation passed: lint, all 231 browser-free test files / 5,479 tests
(31 new reconciliation/CLI cases), diagram freshness and the production build
with synthetic CI settings. The final private report retains the same counts
and no blockers. Playwright and standalone Studio gates were not rerun locally:
this slice changes neither public journeys nor Studio code/schemas.

### AB#259 — Offline identity change batches (2026-10-12, Closed)

The owner requested continuation after PR #344. AB#259 moved New → Active before
the first edit on the published `feature/259-identity-change-plan` branch. Its
separate worktree first fast-forwarded to merged PR #344; no other checkout was
changed. `npm run plan:identity-changes` revalidates the immutable map, approval,
baseline and supplied raw snapshot, then prepares deterministic bounded change
data with retained document IDs, original revisions and selected before/after
values. Shared old identities form indivisible groups across language versions
and multi-field documents. Rollback requires future post-write receipt revisions;
none is guessed. Untouched values are hashed, excluding selected fields and
managed update metadata. The existing reconciliation CLI retains its behavior
through shared bounded private-file IO.

The supplied AB#258 snapshot produces 48 batches at the default 50-document limit:
1,521 groups (largest: two documents), all 2,368 approved documents / 2,393 fields
and 1,541 identities, with zero reconciliation blockers. The private 0600 artifact
stays under ignored `temp/identity-change-plan-evidence/` in this worktree; the
16 original private evidence files retain their recorded hashes. The canonical
plan body SHA-256 is
`93dfcedbb97e4e30e9499affee7cf917c5bc9d2c7d6f928bbc69658bdec60c31`.
This is non-executable local planning data, always non-writable and not cutover-ready.
Source freeze, reader/import/writer acceptance, runtime route/order/media checks,
backup/restore/migration/rollback rehearsal and separate Production approval remain
ADR-0030 gates. The owner committed the exact reviewed patch as `c2a1dfa`;
[PR #346](https://github.com/Alpine78/photosite-starter/pull/346) merged as `8427cd1`
after required Azure CI #817 passed, including public journeys and Studio.
PR #345 was left to the other agent and merged first as `883f87b`; integration
had no conflicts. AB#259's Active → Closed transition was verified after merge.

Local validation passed: lint, 233 browser-free files / 5,506 tests (27 new planner
cases), production build with synthetic CI settings and diagram freshness.
The shared-IO refactor preserves the existing private reconciliation report byte
for byte, and a second private planning run matches the first artifact exactly.
Public Playwright and standalone Studio were not rerun locally because this
slice changes neither public journeys nor Studio/schema code.

### AB#260 — Identity migration operational policy (2026-10-12, Closed)

After PRs #345/#346 merged, the owner explicitly approved archival/removal of
eight historical worktrees: PR #329 and #338–344. Each checkout was clean, matched
its merged source branch/head, and had ordinary merge ancestry in current main.
All 194,942 ignored local files were retained in private
`temp/worktree-retirement/20261012T104159Z/` with per-checkout preservation receipts;
the eight branch refs remain. All 16 private AB#259 input/evidence hashes match at
their relocated paths. No ignored file was disposed of, including generated files
and dependencies. PR #345/#346 checkouts and the other agent's new worktrees stayed
registered. The earlier automatic approval rejection was resolved by the owner's
explicit approval of this exact set; no removal occurred before that approval.

AB#260 moved New → Active before source edits on the published
`chore/260-identity-cutover-proposal` branch, based on merged PR #346.
[Accepted ADR-0031](adr/0031-identity-migration-operational-plan.md) records the
concrete reader/import/recovery contract required by ADR-0030. The owner explicitly
accepted its first three implementation policies on 2026-10-12 with “Hyväksyn nämä
toteutuskäytännöt”: a
bounded, digest-pinned CMS alias table with explicit readability acceptance,
permanent forward/reverse compatibility by reader generation, legacy-writer
retirement and a tested maintenance boundary with a provisional 15-minute target.
The owner decision packet separates policy/implementation acceptance from named
isolated-target/asset-copy permission and actual Production approval. Restored
target revisions require a new reviewed operational binding; original map/baseline
and AB#258/259 guards stay immutable. No runtime/schema/IO implementation, CMS write,
restore, credential action or deployment was performed. The owner committed the
exact reviewed patch as `c67129c`; [PR #349](https://github.com/Alpine78/photosite-starter/pull/349)
merged as `046c350` after Azure CI #825 passed lint, tests, build, public journeys
and standalone Studio. Integration with current main was conflict-free, and
AB#260's Active → Closed transition was verified after merge. The ADR is Accepted
for those implementation policies only; the isolated target, asset-copy
accessibility and actual Production operations remain pending separate approval.

Documentation validation passed: 109 relative Markdown links/anchors checked,
diff whitespace check and all three diagram renditions compiled/current. There
are no runtime/dependency/diagram-source changes, so application tests/build,
public journeys and Studio were not rerun for this documentation-only slice.

### AB#341 — Default-disabled application maintenance boundary (2026-10-17, Active)

The optional server-only deployment mode gates page/API/metadata requests before
normal configuration and content reads, with503/no-store/Retry-After60, generic
bilingual scriptless recovery and preserved security hygiene. A bounded Proxy
request marker plus Next's afterFiles routing closes missing static-looking paths
before the catch-all while leaving actual static bytes available. Incoming values
cannot bypass the gate; malformed attempted settings fail closed. The production
journey uses one build across off/on/invalid/off generations, a warmed generated
response, invalid-content positive control and a genuinely prepared mock poll
write. Verification is recorded with the PR; no hosted activation is implied.

[The deployment instructions](deployment.md#application-maintenance-boundary-ab341)
retain exact-host/CDN/content-cache verification, all deployed reader/writer
generations, out-of-band invalidation before reopening and an explicit operator
checkpoint as operational prerequisites. No flag activation, credential/CMS/asset
operation, migration window or AB301 completion follows from this code slice.

### AB#261 — Pinned in-memory identity aliases (2026-10-12, Closed)

After PR #349 merged, AB#261 moved New → Active before source edits on the
published `feature/261-identity-alias-resolver` branch, based on `046c350`.
The Node-only, server-only `identity-aliases.ts` factory validates a closed
JSON-decoded ID-only payload against deployment-owned source/payload SHA-256 and
exact row-count pins. It reuses the public identity grammar, caps canonical bytes
at 256 KiB and rejects duplicate/overlapping old/new identities across all four
domain families. Private lookup closures implement `legacy`, old → new `renamed`
and new → old `restored`; invalid configuration cannot select a silent fallback.
Later caller mutations cannot change a validated generation, and static error
classes disclose no payload. The original private map's 1,541 pairs all pass the
existing grammar; all 28 critical evidence hashes, including that map, are unchanged.

This module is currently used only by synthetic tests. It does not fetch raw CMS
data, detect duplicate raw JSON keys, validate provider metadata, load environment
settings or authorize requests. CMS/schema/loader, cache generation/invalidation,
public reader integration, legacy-write guard, maintenance boundary and operational
writer/receipts remain separate implementation slices. Dynamic/capture-sequence
media identities, cursors, current deployed behavior and accepted ADR history
remain unchanged. No CMS, asset, credential, restore or deployment operation was
performed. The owner committed the reviewed change as `7a265d8`;
[PR #352](https://github.com/Alpine78/photosite-starter/pull/352) merged as `1614e90`
after other-agent PRs #350/#351 and successful CI #829, including journeys and
Studio. Integration was conflict-free and its exact tree was verified; only the
two previously accepted audit documents differed from the CI merge. The push
destination was already up to date, with no correction commit needed.
AB#261's Active → Closed transition was verified. Named rehearsal targets and
actual Production operations remain separately gated.

Local validation passed: 68 new alias cases, all 234 browser-free test files /
5,574 tests, lint, production build with synthetic mock settings and diagram
freshness. The first build hit Turbopack's outside-root dependency symlink limit;
an ignored local dependency copy resolved it without source/config changes or
altering the retained archive. No public journey or Studio/schema change exists,
so their local gates were not rerun; both remain required CI checks.

### AB#263 — Bounded published identity alias loader (2026-10-12, Closed)

After PR #352 merged, six completed worktrees were retired into private archives
`temp/worktree-retirement/20261012T131826Z/` and `20261012T140445Z/`.
All 92,586 ignored files and all six branch refs were preserved; the other
agent's active checkouts were kept. AB#259's three output artifacts moved with
its checkout. The expanded 36-file critical evidence ledger retains every
original hash. These local archives are preservation evidence, not CMS backups.

AB#263 moved New → Active before edits on the published
`feature/263-published-identity-alias-loader` branch from `1614e90`. The mandatory
Claude plan review waited for the owner-reported 17:10 quota reset. Its feedback
made shared request cancellation transport-owned, required an explicit byte
bound for duplicate-key decoding and clarified metadata and generation recovery.
The unconnected Node/server-only loader captures validated configuration and
pins before IO. Default legacy needs no CMS settings; renamed/restored share one
lazy, uncached, parameterized published full-record query capped at 1 MiB.
Closed provider/row metadata validation precedes the core's canonical digest,
count and 256 KiB checks. The opt-in decoder rejects nested escaped-equivalent
duplicate keys and depth/node excess; existing reader defaults remain native.
Each captured generation returns only a private resolver and keeps failed loads
sticky until explicit factory recreation, without automatic retry or fallback.

Local validation passed: 223 focused cases, all 236 browser-free test files /
5,687 tests, lint, synthetic mock production build and diagram freshness.
The first build found an invalid test-only TypeScript cast; the corrected cast
passed the subsequent build. No public journey or Studio/schema behavior changed.
The owner committed the exact reviewed change as `669396d`.
[PR #354](https://github.com/Alpine78/photosite-starter/pull/354) merged as `42bc730`
after waiting for the other agent's PR #353 (`f0d3e50`) and successful CI #836,
including public journeys and standalone Studio. Integration was conflict-free;
its final tree matched the inspected composition, differing from the CI test
merge only by #353's accepted documentation. Push was already up to date, with
no correction commit needed. AB#263's Active → Closed transition was verified.
Only synthetic responses were used: actual provider metadata/wire fit needs the
first separately approved live read. Public reader/environment and coordinated
generation/cache wiring, legacy-write guard, maintenance, operational writer/
receipts and named rehearsal/Production operations remain separate gates.
No CMS, asset, credential, restore or deployment operation was performed.

### AB#360 — Owner decision accepted (2026-10-18, Active pending PR merge)

The owner accepted [ADR-0036](adr/0036-article-end-section-filtering-proposal.md)
as AB#321's implementation basis. ADR-0003 now carries the dated scoped amendment.
The full 41-item source-image hash/current-placement and title/review-text parity
preflight passed; private item-level evidence stays outside Git. This acceptance
permits reviewed implementation slices. It does not authorize a CMS write or
publish classifications, and rendered-layout/content acceptance remains open.
AB#27/321 stay Active. The earlier proposal checkpoint below is historical.

### AB#360 — Historical proposal checkpoint (superseded by owner acceptance above)

[ADR-0036](adr/0036-article-end-section-filtering-proposal.md) proposes a bounded
article-end section extension for AB#321's verified 41-item exact star-filter use
case under AB#27. It stays Proposed: current accepted article-end exclusions
remain in force. Source membership is already evidenced; owner acceptance, exact
source/current placement binding and full image/title/review-text parity remain
gates before dependent implementation. No schema, route, filter, content write or
deployment changed. AB#27/321 remain Active.

### AB#340 — Curated enquiry identity compatibility (2026-10-17, Active)

The existing pinned alias loader now serves the public curated-enquiry backend.
Request grammar and full configured locale are validated first; content aliases
precede public-tree authorization and placement aliases follow authoritative
container-kind identification. Dynamic and capture media identities are unchanged,
and all existing gallery/media permissions remain required. Default legacy performs
no alias IO or CMS-setting read. Each lazy factory/module generation captures its
configuration once and retains failures until explicit internal recreation or
redeployment. Safe existing error classes keep provider details private.

Synthetic integration covers renamed/restored inputs, shared loads and recovery,
unchanged media identities, public/language/container eligibility and the existing
no-result-read enquiry form. The harness pins legacy mode and clears known alias
settings/mirrors for build and serve. No CMS read/write, alias record/pins activation,
public cache cutover or migration operation was performed. AB#340 stays Active until
owner review/merge; AB#301 and AB#60 retain their remaining acceptance criteria.

### AB#264 — Deployment-owned identity alias settings (2026-10-12, Active)

The completed PR #354 checkout was retired after preserving all 30,778 ignored
files and its branch in `temp/worktree-retirement/20261012T162207Z/`.
Other-agent checkouts were kept. All prior 36 critical hashes remain unchanged;
the receipt/index extend the ledger to 38 files. AB#264 moved New → Active before
edits on the published `feature/264-identity-alias-settings` branch from `42bc730`.

The unconnected Node/server-only settings reader validates five deployment-owned
`SITE_IDENTITY_ALIAS_` values and captures a closed frozen mode/document/pins
tuple. Default legacy consults no CMS settings; stale nonblank alias data,
unknown/case-variant names, public mirrors, accessors/proxies, inherited settings
and malformed counts/pins/IDs fail with static errors. Composition captures the
existing validated Sanity source before IO and returns the existing lazy loader.
Each call owns an independent generation; concurrent/repeated loads share its
request, and explicit recreation is needed for recovery. No global process cache,
browser settings, request integration, deployment or operational record was added.

The Claude plan review clarified complete namespace enumeration, whitespace,
fetch defaults, native environment compatibility and independent generations.
Existing AB#263 loader tests stay unchanged after the pure root-ID validator
extraction. The owner requested commit, push and PR publication on 2026-10-13;
AB#264 stays Active until accepted merge. Actual document/source/pins selection,
first approved live read,
public-reader/coordinated-cache wiring, legacy-write guard, maintenance and
operational writer/rehearsal/Production gates remain separate. No live operation
was performed, and accepted ADR history and strict offline evidence are unchanged.

Local validation passed: 73 new synthetic cases, 198 focused tests, all 237
browser-free test files / 5,760 tests, lint, synthetic mock production build and
diagram freshness. Local public journeys and Studio were not rerun because no
deployed caller/default behavior or schema changed; both remain required CI gates.

Publication validation on 2026-10-13 after integrating current main passed:
198 focused cases, all 246 browser-free files / 5,901 tests, lint, synthetic mock
production build, three diagrams and 94 relative documentation file links.
The only merge conflict was the history append in this file; both histories were
preserved. All three source files match the original reviewed patch, and all
38 private evidence hashes remain unchanged. No additional Claude review was run,
as requested by the owner; CI journeys and Studio validation remain pending.

### AB#262 — gallery and story presentation corrections (2026-10-12, Closed)

The owner reviewed and committed the source changes as `787deac` on
`fix/262-gallery-story-presentation`, then opened
[PR #355](https://github.com/Alpine78/photosite-starter/pull/355). The selector is
absent for zero or one **declared**
gallery section on every slice, including scriptless and direct filtered pages.
Two or more declared sections retain the selector even on a filtered or empty
result. The selector's section count disappears with it; the separate photograph
count and an explicitly selected section's introduction remain available.

The shared hero computes its band and attribution position from the figure's
actual inline-size query-container width. The original `100vw` formula reproduced
a 10px black strip on the owner's 3:2 image with a 15px scrollbar gutter; `100cqw`
keeps the complete native frame and the overlay aligned. Dynamic viewport bounds,
long-text growth and contrast, attribution, no-cover and continuation behavior
remain covered. The owner clarified that the cover-overlay story title should
be larger. Article and gallery heroes now share a 2.25rem mobile, 3rem small-screen
and 3.75rem large-screen title scale (previously 1.875rem / 2.25rem), with tight
line spacing and responsive wrapping. The long-title pale-image integration
journeys use this same shared scale to verify contrast and text containment.

Language fallback notes are screen-reader descriptions rather than visible text
beside the language link, in the wide menu, compact menu and scriptless in-page
switch. Destinations and actual translation metadata are unchanged. An article's
terminal authored h2 matching its localized end-gallery label supplies the gallery
region's accessible name, so a second h2 is omitted. The authored heading and its
TOC fragment remain intact; the existing `article-end-gallery` anchor also remains.
Other body headings, distinct terminal text and articles without an end gallery
retain authored content. No CMS data is modified.

The one-time Claude plan review completed after the owner's 17:10 availability
reset. Verified feedback preserved the stable gallery anchor, explicit container
ancestry, declared-section semantics and proper clipping assertions for screen-reader
notes. Codex self-review and the React quality checklist covered hook order and
cleanup, derived visibility, existing server/client boundaries and accessible
labelling. Lint, all 5,515 deterministic tests, the production build and 140
desktop Chromium/mobile WebKit journeys passed with the enlarged titles
(eight desktop-only viewport cases are intentionally skipped on mobile).
The anchor journey awaits the router's hash update rather than reading the URL
immediately after a click. The earlier Claude diff round omitted test/documentation
coverage; the final review covered all 19 changed/new files and reported no
findings. The owner subsequently authorized committing integration corrections,
pushing and merging PR #355 after PRs #353/#354. Integrating their merged main
required only a feature-status conflict resolution; all incoming history and
the reviewed presentation code were preserved. The work item closes after the
authorized merge is verified.

Post-integration validation passed against main after PR #354: lint, all 237
browser-free test files / 5,696 tests, all three diagram renditions, the production
build and the same 140 focused Chromium/WebKit journeys (eight intentional mobile
skips). The required full Azure PR pipeline remains the final merge gate.


PR #355 subsequently merged as `4382537b6be57fa903dfdb39e9e2c4fec87b438e`;
AB#262's Active → Closed transition was verified before the follow-up below.
The other agent's original checkout remains untouched.

### AB#346 — story text at narrow enlarged widths (2026-10-18, Active)

Article, public-gallery and article-end continuation text now wraps inside its
own column, including no-cover titles, prose, headings, tags and adjacent links.
The three existing main elements use Tailwind emergency wrapping; tables retain
normal wrapping and their own keyboard-scroll regions. Controlled existing
poll-result text still overflowed with `break-word` in both browser engines,
which is why this correction also allows intrinsic shrinking with `anywhere`.
Without the table exception, existing normal-size table widths changed.

Complete text, typography, native image frames, hero treatment, independent
viewers, tab behavior and route contracts stay unchanged. Old-source production
negatives and corrected Finnish/English Chromium/WebKit coverage include
320/390/768/1280px, 16/32px root text, scriptless links and continuations.
The two-column adjacent navigation can still break long words into short pieces
at enlarged narrow widths; its accepted layout is preserved. AB#346 remains
Active pending owner review and merge; no CMS or deployment change was made.

### AB#265 — Offline canonical identity alias plan (2026-10-12, Closed)

The owner requested identity and gallery continuation in separate worktrees.
AB#265 moved New → Active before edits on the published
`feature/265-identity-alias-plan` branch from merged PR #355 (`4382537`).
Ready uncommitted AB#264 and the other agent's AB#262 checkout are preserved.
One Claude plan review led to an extracted-payload interop check, one canonical
writer for both hashes, repeated injectivity/disjointness checks and an explicit
supplied-snapshot limitation. No accepted ADR or existing reconciliation/file
helper changed.

The offline `plan:identity-aliases` command produces a private non-executable
`identity-alias-plan-v1` wrapper. Strict approval/coverage/revision reconciliation
precedes allow-listed, map-ordered alias rows. The payload preserves only the
four domain identity families, format and approved source-map digest; emitted
pins work with the existing resolver in renamed/restored modes. Canonical limits
are inclusive 256 KiB for the payload and 1 MiB including LF for the wrapper.
The wrapper records separate input/reconciliation evidence and body hash;
`writable` and `cutoverReady` remain false. No source, record, credential,
mutation, execution flag or deployed reader integration is introduced.

A private read-only archived-input proof produced all 1,541 approved rows at
169,598 canonical bytes, with payload SHA-256
`eb971f432f8cdcfa041eb94ab47771892c16218a7ce9fdb64f595f9ea80226cc`.
The original 38 evidence hashes stayed unchanged. Its baseline-equal historical
snapshot proves only supplied local data; current target/freeze, named record,
provider metadata, restore, cutover and each actual operation remain gates.
The owner committed the reviewed slice as `d2cd187` and PR #357 merged as
`ce43481939438f75136621f30b1aa16b77c05136` after successful full PR run 843.
AB#265's Active → Closed transition was verified after merge. See [the operator contract](sanity-seeding.md#offline-canonical-alias-payload-ab265).


Validation passed: 24 new synthetic planner/CLI cases, 149 focused interop cases,
all 239 browser-free test files / 5,720 tests, lint, the synthetic mock production
build and all three diagram renditions. Test-only imports pin the format, grammar
and real default limits to the application; exact 256 KiB and 256-character
boundaries, wrapper LF/digest, private no-overwrite output and direct pinned-Node
execution are covered. No runtime default, public journey or Studio/schema change
exists, so local journey/Studio gates were not rerun; required CI still applies.


The final Claude diff review attempt hit the session limit before substantive
review. The owner subsequently explicitly waived this review for AB#265 and
AB#266 on 2026-10-12. The one-time plan review and Codex gates are complete;
no final Claude verdict is claimed. This waiver applies to these two changes
only, not future reviews. The accepted PR #357 merge and AB#265 closure are
verified above; no live CMS or deployment operation was performed.


### AB#266 — Terminal gallery headings at every supported level (2026-10-12, Closed)

The owner requested gallery and identity continuation in separate worktrees.
AB#266 moved New → Active before edits on the published
`fix/266-terminal-gallery-heading` branch from merged PR #355 (`4382537`).
The existing end-gallery helper reused only terminal h2 headings even though
the content model, renderer and table of contents support h2/h3/h4. It now reuses
all three supported levels when the existing localized-label normalization
matches. No body block is removed or relevelled; the exact `buildHeadingIds`
fragment names the gallery region and the `article-end-gallery` anchor stays.
H2 reservations in fragment disambiguation remain intact. Nonmatching and
nonterminal headings, including a trailing blank paragraph, keep the existing
generated-heading behavior; unsupported runtime levels are refused.

One Claude plan review preserved Finnish h2 production-journey coverage while
English uses h3; units cover both languages/all supported levels and cross-level
collisions. All 44 focused production-build desktop Chromium/mobile WebKit
journeys passed, including JS/scriptless TOC jumps and server continuation.
Continuation pages retain their existing single h1, article-qualified region
name and six remaining images; returning to the article restores its single
localized gallery heading. The first added continuation assertion incorrectly
expected a repeated gallery heading; inspection of the unchanged component
corrected the test to its actual contract without altering runtime behavior.
All 237 browser-free test files / 5,707 tests, lint and diagram freshness passed.
The journey harness's production build passed. Full required CI still applies.
No CSS, typography, media framing, CMS data, dependency or deployment changed.
The owner committed the reviewed slice as `72e781c` and authorized PR #358
merge after CI, including the documentation conflict correction. AB#264 and
the independent AB#265 branch remained separate during integration.


The final Claude diff review attempt hit the session limit before substantive
review. The owner subsequently explicitly waived this review for AB#265 and
AB#266 on 2026-10-12. The one-time plan review and Codex gates are complete;
no final Claude verdict is claimed. This waiver applies to these two changes
only, not future reviews. The owner reviewed and committed the source and
authorized integration corrections; required CI and accepted merge still apply.


Integrating the accepted PR #357 main into PR #358 required one documentation
conflict resolution. Both complete story sections and their owner-waived review
records remain; all code/test blobs match their original accepted commits.
Combined local validation passed: 239 browser-free files / 5,731 tests, lint,
synthetic mock production build and all three diagram renditions. The original
44 focused browser journeys remain applicable; the updated PR's required full
CI must pass before its accepted merge. All 38 prior evidence hashes and the
separate ready AB#264 source remain unchanged.

PR #358 subsequently merged as `5262def6063beebb4d1fd0e5d6ae60f2a022f89e`
after required Azure CI #850 passed for integration head `5a8bd18`. The source
head ancestry and final merged tree were verified; AB#266's Active → Closed
transition was confirmed. This completion record supersedes the pending-merge
checkpoint above.

### AB#137 — Restore omitted Joomla import guards (2026-10-12, Active)

The owner requested a separate worktree after the remote-branch audit found three
guards still present only in `feature/137-story-root-content` at `bf55aeb`.
`fix/137-restore-import-guards` starts from current main `4382537`; AB#137 was
already Active before edits and remains Active for its wider operational scope.

Document validation requires an article cover to resolve to a public image in
the plan, and each body poll to resolve to an included historical poll with the
page's language or `und`. Gallery rerun preflight reads and refuses editor-owned
`galleryLayout`, `galleryCaptionPlacement` and section `intro` before uploads,
restoring the existing seeding guide's stated behavior. Valid public covers,
historical poll pairs and unchanged gallery reruns remain supported.

Only those guards are restored. AB#185's revision-guarded media patches, current
calendar validation, plan digests and format versions remain intact. Synthetic
regressions demonstrated the omissions before the fix; all 245 focused tests,
all 237 test files / 5,706 browser-free tests, lint, the production build with
mock harness settings, all three diagram renditions and 79 relative documentation
file links pass. Playwright and the Studio build were not rerun locally because
browser and Studio source are unchanged; their required CI gates remain.
The owner committed the reviewed source as `c53e5a8` and authorized integration
with main after PRs #357/#358. The feature-status conflict preserves both
implementation histories; the restored source guards are unchanged. Required
CI remains the final merge gate. No live CMS write or launch acceptance is implied.

Post-integration validation passed against main after PR #358: all 245 focused
import tests, 239 browser-free files / 5,741 tests, lint, the mock production
build, all three diagram renditions and 201 relative documentation file links.
The first sandboxed focused run could not capture child-command output; its
unsandboxed retry and the complete test suite both passed. AB#185's media writer
and all five restored code/test blobs match owner commit `c53e5a8`.


**Sequential PR integration, 2026-10-13 (AB#255, Active):** PR #359 merged as
`6a7d714` after full CI #859; PR #363 as `c29ac72` after CI #855; PR #364 as
`7e47904` after CI #856. Every final merged tree and source-head ancestry was
verified. #363/#364 needed no conflict correction or new commit; their relevant
application/Studio inputs matched the tested trees. AB#137 and AB#255 remain
Active for their wider operational/content acceptance criteria.

The owner requested sequential handling without Claude, authorizing conflict
corrections, commits and pushes. Integrating those three merges into #365
resolved four conflicts: retain both core Finnish plugin registration and the
11-key project-title bundles, both README sections and all implementation/
coverage history. Authenticated UI/wording, hosted Studio publication and
all-pages acceptance remain separate; this integration performs no CMS write.
The earlier structure-only receipt's uncommitted-core checkpoint is superseded
by this combined configuration. Required updated CI remains the merge gate.

Post-integration local checks passed: all 239 browser-free files / 5,741 tests,
root lint and all three diagram renditions; Studio typecheck, zero-error schema
validation and static build with 896 package notices; mock Next.js production
build. Compiled Studio includes the Finnish core plugin and custom-title
namespace/resources, and all main structure files remain byte-identical. Every
existing lock entry is unchanged; the locale package is the only dependency add.
The initial Next.js attempt lacked worktree-local dependencies; existing caches
were preserved and matching dependencies copied locally. A sandboxed retry
stalled during compilation and was stopped; the unrestricted synthetic retry
passed. Full Playwright remains the updated required CI gate.


AB#250 legacy visitor notice, 2026-10-14: retained delivery pages now display FI/EN text describing public unauthenticated gallery/files, public dataset enumeration, sharing, original dimensions/metadata, whole ZIPs and the limits of page expiry/removal. The semantic labelled section appears before the download and photographs. Ordinary public and protected-gallery surfaces retain their existing policy. Customer import and deployment remain gated; AB#250/117/18 remain Active.

### AB#250 — exact CDN byte verification and real release blocker (2026-10-12)

The owner-requested continuation adds an offline-by-default, credential-free CDN
verifier for the existing retained source/document contract. Live reads stream
exact bytes with SHA-1/SHA-256, length/media/attachment checks, no redirects and
a total deadline; absent and mismatched assets remain distinct. The real packet
contains 21 galleries, 1,792 JPEGs and 12 ZIPs. Offline recompilation passed;
Production currently exposes no published legacy types or ZIP assets, and the
first exact CDN asset is absent. The owner confirms no large-ZIP Support assurance.
[The release receipt](audits/ab250-release-verification-2026-10-12.md) gives the
concrete provider question and remaining import/publication gates. Full tests,
lint and the synthetic production build pass. AB#250 stays Active; no import,
publication, adapter activation or full customer continuity is claimed.

AB#255 continuation, 2026-10-12: [Finnish Studio core resource additions](audits/ab255-studio-core-locale-additions-2026-10-12.md). This work is prepared on a separate branch; the story remains Active. CI installation fix, 2026-10-13: the root test job installs locked Studio dependencies before the SDK contract tests. General album-image captions and alt authoring are deferred until after MVP by the owner's explicit scope decision. Existing image text is preserved. Pending CMS copy acceptance, authenticated Studio checks and production activation must not be inferred from source validation.

AB#255 Studio drag accessibility completion, 2026-10-13: [Localized keyboard-drag instructions and announcements](audits/ab255-studio-drag-localization-2026-10-13.md) close the observed English array-instruction gap in #371. A documented Vite alias wraps the pinned DndContext API while retaining handlers and native contexts. All installed versions/integrities remain unchanged. Authenticated FI/EN instructions and browser-event activation/cancellation were checked without moving, dropping or changing content. Full tests/lint/Studio and Next builds pass; final-head CI and PR review remain. Hosted activation and all-page acceptance are separate; AB#255 remains Active.

**Automation bypass rotation execution, 2026-10-14 (AB#287, Active):**
[The redacted execution record](audits/ab287-launch-bypass-rotation-2026-10-14.md)
confirms the owner-approved replacement of the CI/local/Preview-hook consumers,
fresh successful main CI 977, four HTTP-200 revocations without regeneration and
SSO refusal of all four old values. Native readback contains one default replacement;
Preview access/noindex, both hook signing configurations and other protection
settings are preserved. AB#287 remains Active pending review/merge. AB#117's final
security/privacy acceptance and final serving-version evidence remain open.

**Automation bypass rotation preparation, 2026-10-13 (AB#285, Active):**
[Fresh consumer inventory and private operation](audits/ab285-bypass-rotation-readiness-2026-10-13.md)
cover four project entries, one current CI/local value and the enabled native Preview
hook. Three entry consumers still need identification. Replacement, coordinated
consumer changes and per-old-key revocation are planned; none was executed and
AB#117's final security/privacy acceptance remains open.


### AB#250 — Owner-local retained customer source links (2026-10-14)

A bounded deployment-only `LEGACY_GALLERY_REDIRECTS` array maps owner-approved
legacy source paths to the enabled adapter's allowlisted opaque handles. The
cached parser keeps request lookup free of CMS/credential IO, refuses malformed,
duplicate, excessive, reserved and undeclared mappings, and refuses real Sanity
selection in Preview. Actual customer paths remain outside Git and test fixtures.
Reserved namespaces and ordinary legacy mappings keep precedence. GET/HEAD use
one 301 including a single trailing-slash source variant; only a validated
non-default UI locale survives, while historical passwords/cursors/query values
are dropped. Other methods return 405; retained-source responses have no-store,
noindex/nofollow and no-referrer. The 21 actual private sources passed local
parser validation without being printed. 6,159 deterministic tests, lint and
34 production-built Chromium/WebKit journeys pass, with four existing skips.
Customer import, activation and deployed old-link checks remain separate gates;
AB#250/117/18 stay Active.

**AB#295 launch correction, 2026-10-15:** Retained-source GET/HEAD links now
use a non-cacheable temporary 307 while the Production mapping is verified.
The parser still rejects the whole malformed map, but Proxy lets ordinary
public routes continue and logs one path-free warning per process. Invalid
configuration issues no retained-source redirect; it is reparsed only when
the relevant deployment settings change. Reconsider a permanent redirect only
after the actual Production source inventory and destinations are confirmed.

### AB#250 — original JPEG file-delivery correction (2026-10-14)

- A live Production check rejected an ordinary image-CDN response because its
  bytes differed from the unchanged uploaded source; gallery publication stays
  gated. The native asset SHA-1 alone cannot establish delivered metadata or bytes.
- The offline compiler now accepts an explicit JPEG `kind: "file"` binding with
  exact `file-<sha1>-jpg` identity and unchanged source dimensions, hashes and
  byte count. Its read-only `originalFile` reference is exclusive with the
  previous `source` image reference. Historical image-binding digests and the
  ordered manifest contract remain unchanged.
- The legacy reader and byte verifier use the plain file-CDN JPEG URL, validate
  exact MIME/hash/size and bind intrinsic dimensions to the source manifest.
  JPEG files cannot be confused with delivery ZIPs. Public/protected media,
  gallery identities, deadlines, positions and ZIP references keep their contracts.
- CSP permits only the configured project/dataset file path in `img-src`, alongside
  its image path. The public optimizer still rejects file assets; other directives
  and the protected-gallery object-store policy retain their boundaries. ADR-0011
  records this scoped implementation of the already accepted legacy exception.
- The new binding needs fresh concrete CMS approval, anonymous complete CDN byte
  checks and browser evidence before actual customer publication. This change
  performs no provider writes and does not claim the launch or AB#250 complete.
- Validation: 6,216 deterministic tests, lint and the synthetic production build
  pass; 26 Chromium/WebKit journeys pass with four existing cookie-related skips.
  The separate synthetic file-asset experiment preserved all source bytes and
  rendered its full frame in both engines; that fixture was removed and Preview
  restored. Independent source review closed the secondary-object ambiguity and
  confirmed the scoped CSP/optimizer separation. Final deployed customer proof
  remains separate.

### AB#289 — gallery enquiry controls and imported opt-in diagnosis (2026-10-14)

Active, awaiting PR acceptance and the exact Production content operation. Public
galleries gain an FI/EN Studio switch that defaults on; explicit off hides the action,
rejects a direct enquiry page, and is checked again by the server before reading media.
The lightbox also hides actions for photographs without media opt-in, including when
moving between slides. Per-item action hints stay outside the public media projection.
Protected client and retained legacy galleries receive no enquiry entry point.

A read-only Production lookup reproduced the owner's reported capture-sequence context:
the photograph was public and in the correct gallery but its `enquiryEligible` field was
unset. Code deployment alone cannot opt that content in. The private revision-bound plan
covers 40 wedding gallery documents off, 24 ordinary gallery documents on, and 1,927
public ordinary-gallery media with missing opt-ins; explicit media denials are preserved.
The operation requires the exact content approval, recovery/readback, and temporary-key
cleanup. No Production content write or real message was performed for this change.

Validation: 6,169 unit tests across 265 files, lint, production build, and 31
Chromium/WebKit enquiry/customer journeys passed. One pre-existing WebKit private-session
journey is skipped because Secure cookies are not stored on the harness HTTP loopback.
Security review found no remaining issue in the changed request/media boundaries; real
CMS activation and mailbox receipt remain operational checks. AB#289 remains Active.

Follow-up default-on correction: new ordinary Studio media and newly generated public
rally/Joomla plans explicitly initialize media enquiry permission to true. Existing false
or missing permissions remain fail-closed, existing-media write patches leave permission
untouched, and historical approved plans are not rewritten. A Joomla rerun refuses to
erase an authored gallery enquiry setting. Targeted regression tests cover the new
creation defaults, old-plan preservation, malformed permissions and rerun boundaries.
The focused follow-up tests passed 376/376 in eight files with one worker and
serial file execution; targeted ESLint passed. The first sandboxed run could not
execute 19 CLI subprocess cases, and the complete focused rerun passed with
normal process access. The earlier production build and public journeys precede
this follow-up; the PR pipeline will validate the final merged source.

Review follow-up: the home page's featured-gallery lightbox now reads the same
gallery-wide enquiry permission as the gallery page, from the existing bounded
gallery-basics query. A disabled featured gallery shows no enquiry action on
the home page; the server still rejects direct submissions. The mock source
shares its fixture permission across the detail and featured-gallery reads.
The focused source/component regression set passed 202/202 tests in three files
with one worker; targeted ESLint and TypeScript checking passed. The complete
PR pipeline and deployed FI/EN behavior remain to be verified.

CI #997 passed lint, unit tests and build, but its three browser projects found
that an older cursor-boundary journey still expected an enquiry link on every
fixture photograph. The journey now checks each placement's permission across
pagination: allowed items link to the exact selected occurrence, while denied
items keep the action hidden without an href. It also checks the permission
when reopening an appended item. Targeted ESLint and TypeScript checking passed;
the local Playwright build stopped before tests because this environment denied
Turbopack's process/port creation. The updated PR CI remains the browser gate.

### AB#293 — bounded CI test concurrency (2026-10-14)

The shared self-hosted agent runs Vitest and Playwright with one worker each.
All existing gates, test selections and assertion timeouts remain in place.
PR #405's first two CI attempts lost agent contact during browser testing; their
logs did not establish a comparison-component failure. CI #986 passed lint,
unit tests, build and the public journeys with bounded workers. One existing
mobile-WebKit retained-gallery gesture passed only on retry and is tracked
separately by AB#292. The owner merged PR #405 on 2026-10-14; AB#291 and
AB#293 are Closed in Azure Boards.

### AB#333 — existing browser failure diagnostics (2026-10-17, Active)

Main CI #1154 failed its unit gate before Playwright ran, then added a missing
`playwright-report` artifact error. Failure-only Bash discovery now admits the
unchanged publisher only for an existing directory, using the publisher's own
working-directory base. Missing paths and regular files skip with a fixed note;
actual reports and publication errors retain their existing behavior. Quality,
cancellation and stage conditions are unchanged. Local script/wiring fixtures
verify these paths; live Azure validation awaits a committed run and owner merge.

### AB#296 — restore bounded CI parallelism (2026-10-15)

The owner requested faster launch validation after freeing disk space. A
single `ciTestWorkers` pipeline variable raises both Vitest and Playwright
from one to two workers while retaining every gate, timeout and assertion.
The prior one-worker successful run #1007 took 24m06s end to end (unit tests
66.5s; E2E 18m55s). The two-worker PR run #1011 passed without agent loss in
13m42s (unit tests 34.6s; E2E 10m38s), a 10m24s overall improvement. The
documentation follow-up needs its own exact-head CI check before AB#296 can
be merged or closed; an agent disconnect or test failure requires investigation.

### AB#294 — lightbox opening and loaded-slide navigation (2026-10-14)

PhotoSwipe's previous/next controls now wait for the same completed opening
boundary as its keyboard listener. An early activation could otherwise recycle
a still-hidden neighbouring holder into the centre, leaving a blank photograph.
The failed-preload attachment repair now requires an observed error state and
does not rebuild content that is awaiting an ordinary image decode; lazy errors
without an associated slide are recognized when their native retry starts.

The production-build Chromium and mobile-WebKit checks pass six focused journeys:
early activation stays on the first photograph, enabled next plus Enter reaches
the second, previous and ArrowRight return to the expected full image, delayed
decode preserves finite navigation, and a failed adjacent preload recovers.
The existing hosted candidate also navigated successfully after its opening
completed. The exact corrected hosted release candidate remains the final
runtime gate; AB#294 moved New → Active and stays Active pending merge.

### AB#297 — favicon and missing story intros (2026-10-15, Active)

The browser icon now uses the published `SiteSettings.logo` public derivative in
both locale shells. A direct `/favicon.ico` request redirects to that same
versioned image; a brand-free local mark is the fallback. The previous static
favicon was removed so it cannot override the setting.

The existing revision-guarded Joomla intro planner now accepts optional
published category document IDs. Its approved Production plan for Blogi and
Moottoriurheilu's WRC/Muu moottoriurheilu children selects 56 published pages
(36 blog, 20 motorsport), in Finnish and English. It moves each authored first
paragraph into a listing-only summary and removes that duplicate paragraph from
the body. The owner then chose to move the
Finnish and English photographer article from Yleinen/Common into Blogi/Blog.
A revised revision-bound plan covers the category move, a homepage introduction
link that resolves the article's canonical route in each language, the existing
first introductory paragraph as the Blog listing summary, and the correction
of English "Ii" to Kuopio. The earlier Yleinen summary plan is superseded.
The homepage heading becomes the link when the referenced article is public;
the now-empty Common category and former article URLs have direct same-language
redirects. Joomla aliases now target live Blog pages. On 2026-10-15, after the
owner approved both digests, the intro writer applied and verified all 56 pages
(zero pending or unexpected). The five-document writer then applied and read
back both funeral prices, both photographer articles and the home singleton in
one transaction, with zero draft/release conflicts. The configured migration
token returned HTTP 401 before any write; the existing localization token
completed both guarded transactions. Published-perspective reads confirm the
funeral panel now has only the 200 € and 250 € options in both languages, while
the service cards still show `Alkaen 200 €` and `From 200 €` from their
independent `startingPrice` fields. Both articles now belong to Blog and the
English summary says Kuopio; the home story reference is published. The code
deployment remains open. A local production build using the live Sanity data
returned HTTP 200 for both home pages, both new article URLs, both Blog listings
and the Finnish funeral detail; its homepage links and listing summaries were
present in the correct language. The former Finnish/English article and Common
category URLs, plus `/kuvaaja` and `/en/about`, returned direct 301 responses
to the new canonical Blog routes. `/favicon.ico` returned 307 to the published
256×249 logo. The deployed site's HTTP verification remains open.
The CMS write preceded deployment, leaving a short interval when the former
Common URLs may return 404.

### AB#298 — listing card call-to-action (2026-10-15, Active)

Every story/gallery listing card (category branches and the home latest
stories, both through `StoryCard`) now ends in a text call-to-action inside the
single card link: "Katso kuvat →" / "View photos →" for a gallery and "Lue
tarina →" / "Read the story →" for an article, chosen by the entry's `variant`
and localized through `BuiltInLabels.storyCard`. The arrow is `aria-hidden`.
Hover and keyboard focus underline the title, darken the CTA rule and slide the
arrow 4 px; the arrow motion is `motion-safe` only. The design proposal's fixed
3:2 `object-cover` image crop is deliberately not adopted (never-crop rule).

**Image count (slice 2):** a gallery card names its photograph count ("Katso 86
kuvaa →", "View 1 photo →"). `ContentListingRecord.imageCount` is counted in the
store by `GALLERY_LISTING_PROJECTION` beside the card's other fields, with the
same visibility clauses as the gallery's bounded window (`visible`, publicly
renderable, not `privateOnly`) shared through `PUBLIC_PLACEMENT_CLAUSES` /
`PUBLIC_CAPTURE_MEDIA_CLAUSES`; capture-sequence galleries count their media
documents instead of placements. An empty gallery keeps the count-free "Katso
kuvat" wording, and an article never carries a count. The fixture counts the same
way (`getMockGalleryImageCount`). The listing card cover also zooms 1.03× on
hover; AGENTS.md records this as a scoped exception to the never-crop rule.

**Not verified:** the 21 retained legacy-delivery galleries (ADR-0028) keep
their own manifest `imageCount`; whether they appear in category listings, and
so whether their cards get a count, has not been checked against live content.
The listing projection was tested against its GROQ text and a fake client, not a
live Sanity dataset; a published-perspective read should confirm the `count()`
subqueries before release.

### AB#299 — site search, stories and services (merged 2026-10-15, released 2026-10-16)

A header search control opens a native modal `<dialog>` and searches published
stories (articles and galleries) and routable services in the visitor's own
language; the same search is a server-rendered results page at the locale's
search route (`/haku`, `/en/search`), reached by a plain GET form with no
JavaScript. [ADR-0033](adr/0033-unified-site-search.md) (**Proposed**, owner
acceptance pending) records the decisions, including how this shares its
route with ADR-0012's keyword galleries: a non-empty `keywords` selects the
keyword mode (every request is currently the unknown-keyword 404, since no
taxonomy exists), otherwise a usable `q` selects the text mode, otherwise the
empty landing state.

Matching is in memory and pure (`site-search-query.ts`): every query token must
start a word in some searched field (title, free tags, short lead), folded by
case and diacritics, scored title > tag > lead. Eligibility is the public
route's: a story is searchable only when the locale's content tree gives it a
canonical path, and a service when it resolves and is not hidden from listings,
so hits link to exactly the public page. The story candidate set is one tagged
Sanity read per language (`sanity-site-search-index.ts`, cache tag
`site-search.stories`, invalidated by the existing webhook), bounded in bytes by
the client's 1 MiB ceiling. The dialog posts to `POST /api/search` so the term
is never in a URL; the results page uses `?q=`, which
[`search-data-flow.md`](search-data-flow.md) records. Thumbnails render at their
native ratio inside a fixed box (`object-contain`) and the term is highlighted
with text nodes only. Results are `noindex`, with no canonical link, and not in
the sitemap.

The independent Codex review loop (gpt-6.1-sol, medium; four rounds) found and
the branch fixed: `keywords` precedence missing from the route and from the
redundant-prefix redirect (an invalid selection is never redirected), a dialog left
modal after a query-only navigation, and framework prefetch of the query-bearing
"show all" link leaking the term; the last round reported no defects.

**Not built (by decision):** image and keyword search (waits for AB#55 and its
chain; AB#59/AB#58/AB#71 ship the keyword group and its gallery together),
article-body search, categories as results, pagination (50 per group, then a
"narrow your search" notice), the "popular searches" chips from the design
(owner decision, 2026-10-15), and any application rate limit.

**Released 2026-10-16:** merged source `6cdc231` (CI #1023) was staged with
`--skip-domain` as `dpl_2MT9Myy1cXRFTFCVTpGhMdbaLGLo`, smoke-tested on its protected
URL, then promoted; `ilkansivu.net`, `www.ilkansivu.net` and
`photosite-starter.vercel.app` serve it, with `photosite-starter-35iy29v0b` as the
rollback target. Production's `SITE_LOCALE_ROUTES` is now
`fi||tarinat|palvelut|haku,en-GB|en|stories|services|search` (owner-run; see
[deployment](deployment.md)). The staged smoke test read the live Production dataset:
`/haku?q=rally` and `/en/search?q=rally` answered 200 with ten results, `/search` and
`?keywords=` answered 404, a foreign-origin `POST /api/search` answered 403, and the
sitemap names no search page. The `/security-review` is recorded in the
[security/privacy review](security-privacy-review.md).

**Not verified:** the index's **byte size and record count** have not been measured and
there is no load measurement; the only latency evidence is three warm API calls of
0.16–0.26 s through `vercel curl`, which includes the tool's own overhead. ADR-0033's
512 KiB target and 75 % revisit trigger are untested proposals, and ADR-0033 is still
**Proposed**. Manual screen-reader and keyboard checks are not recorded.

### AB#300 — Studio search namespace configuration (2026-10-16, Closed)

Studio now accepts the optional fifth search namespace in the shared locale
routing declaration introduced by #415, while retaining three/four-field input.
It validates provided search segments and same-row story/service collisions;
story roots are unchanged. Empty/malformed extra fields and six-field rows still
refuse. The public route compiler remains responsible for global routing collisions.
The Studio example now uses the complete FI/en-GB declaration. No public route,
CMS content, dependency, authentication or deployment setting was changed.
AB#300 moved New → Active before edits. The owner accepted #424; CI #1038
passed and merge `6be2669` landed on 2026-10-16. The work-item link first moved
the item to Resolved; the accepted, merged bug was then explicitly Closed.

### AB#327 — offline full JPEG decode evidence for whole-package exports

An owner-selected processed-JPEG set can now be fully decoded locally with the
pinned Sharp implementation, unchanged source bytes, orientation-aware technical
dimensions and an ordered neutral byte/SHA256 manifest matching the whole-ZIP
builder. Corrupt/unsupported image data and changed private inputs fail closed.
The result does not authorize metadata exposure, upload or publication; legacy
files and whole packages are unchanged. See [the audit workflow](jpeg-export-audit.md).
AB#327 is Active pending owner review/merge; AB#29's publication/provider gates
and Proposed ADR-0035 remain open.

### AB#344 — private metadata-envelope inventory for selected JPEG exports

An explicit private processed-JPEG set can now be inventoried for fixed
APP/COM header-prefix counts and payload-byte totals, with neutral ordered
byte/SHA256 evidence. It shares the accepted decoder's strict marker walker,
private input verification, TSV format and exclusive private report writer;
original JPEG/metadata bytes and whole packages remain unchanged. Real baseline
and progressive JPEGs, opaque/unknown/repeated segments, scan/entropy boundaries,
private CLI refusals and interruption have synthetic regression coverage.
A prefix match is not validated metadata; zero counts are not privacy clearance.
No metadata values, new public-file policy, upload or publication are added.
AB#344 is Active; parent AB#29 metadata approval and Proposed ADR-0035 gates remain
open. See [the inventory command](jpeg-export-audit.md#inventory-metadata-envelopes-without-reading-their-values-ab344).

### AB#305 — Native Studio customer-link handoff (2026-10-17, Active)

New client-delivery documents now offer an optional published-only URL action.
A public canonical HTTPS Studio setting enables it; existing settings retain
their defaults when omitted. The modal uses exact configured full locale tags,
FI/EN text, a selectable read-only URL and explicit clipboard/manual fallback.
Draft-only/foreign/release/synchronizing state cannot supply a handle. Copying
uses only the URL and performs no CMS mutation, email or automatic remote call;
page availability and surviving public files are explained. Actual hosted
authenticated roles, keyboard focus and native clipboard verification remain
open under AB#145. No production activation, S3/Postgres or dependency change.
AB#305 remains Active pending accepted merge; see the [Studio workflow](../studio/README.md#ongoing-client-galleries-ab302--ab145).

### AB#326 — offline observed gallery-removal impact

A private raw-snapshot inventory now binds a selected gallery revision and
owner-attested complete-snapshot evidence to observed asset/referrer identities,
including draft/release and legacy image records. Shared/missing/ambiguous refs
and public-file/cache limitations are reported without authorizing a mutation:
readyToDelete and readyToWrite always remain false. See
[the inventory workflow](gallery-removal-impact.md). AB#326 is Active pending
owner review/merge; source/operator removal acceptance and AB#29 remain open.

### AB#43 — asset inventory currency check (2026-10-19, Active)

A comparison of direct `package.json` and `studio/package.json` dependencies with
`docs/asset-inventory.md` found six not individually recorded: root `vitest`,
`@playwright/test`, `tailwindcss` and `@tailwindcss/postcss`, and Studio
`@dnd-kit/core` and `groq-js`. All six are now listed with the lockfile version,
declared licence and need. No new dependency was added; no sample-photograph,
contribution-policy or commercial-use finding changed. AB#43 stays Active, and the
package-count tables were not recomputed.

### AB#313 — Inactive protected-gallery removal audit (2026-10-17, Active)

**Slice A1 preparation, 2026-10-19:** the audit now carries a deletion-patch dossier for the
smallest slice (offline private-upload source commands): exact files, dependent
`package.json`/README/runbook edits, gates and recovery, bound to a recorded `origin/main`
revision. Nothing is deleted and every clearance row stays open. AB#313 stays Active;
AB#29/145 are not closed.

The [removal-readiness audit](audits/protected-gallery-removal-2026-10-17.md)
records the merged source tree, reproducible first-party import inventory,
protected routes/CLI/worker/config/test dependencies and shared modules that
must remain. It proposes bounded conditional removal slices and preserves
privateOnly/sales, public/legacy media and URL boundaries. No code or service
was removed or activated. AB#313 moved New → Active before edits; actual
deployment/operator/clone usage and each deletion patch's architecture/security
review remain open. AB#29/145 stay Active and proof selection AB#130 stays New.

**Operational evidence, 2026-10-20:** names-only evidence for the clearance table is now in
the [audit](audits/protected-gallery-removal-2026-10-17.md#operational-evidence-for-the-clearance-table--2026-10-20).
Vercel Production/Preview define no protected-gallery, admin-secret, object-store or retention
setting (store `off`), the protected paths answer 404 in Production, the single pipeline and
its one variable group reference none of them, and this host has no scheduler, shell-history
or local-environment use. Every clearance row still needs its owner's confirmation; clones and
other machines were not checked. Nothing was deleted.

### AB#325 — ordered offline client web-image batches

An explicit owner-selected batch can now prepare up to 256 processed exports
sequentially with the existing complete-frame, metadata-stripping web converter.
Private neutral outputs and a final aggregate hash/dimension receipt are bound
to unchanged selected sources. No CMS/upload, legacy/whole-ZIP mutation, new
service or source/publication approval is included. See
[the local batch workflow](client-web-image-batches.md). AB#325 is Active pending
owner review and merge; parent AB#145's live editor/publication gates remain open.

### AB#324 — gallery section navigation position (2026-10-17)

Hydrated section links retain the current scroll position and, after the selected
server result commits, retain the activated control's focus and viewport position.
A short or empty result uses the nearest achievable native scroll position rather
than adding blank space. A visitor who scrolls or moves focus elsewhere while the
response is pending keeps that choice. A persistent polite region announces the
selected section and available count/empty state. Real links, URL/history, cursor
reset and section-scoped continuation remain. This is a source slice of AB#321;
other layout/reading requirements and owner acceptance remain separate.

### AB#322 — justified fallback and article-end presentation (2026-10-17)

The absent public gallery layout now resolves to justified rows; explicit site and
gallery choices still win independently for layout and caption placement. Article-end
galleries receive the same resolved site settings on initial and direct continuation
pages and retain them during append. Existing geometry, order, native image frames and
public derivative boundaries are unchanged. This implements one source slice of AB#321;
named production VAT overrides, other UI fixes and owner acceptance remain separate.

### AB#328 — bounded keyword benchmark reads (2026-10-17)

The existing AB#65 spike transport now limits successful decompressed replies
to 16 MiB and bounds fetch plus body reads by one 30-second deadline, including
IO that ignores abort. Byte counts retain BOM/Unicode accounting; reader, error
and late-response cleanup is best effort and does not extend the deadline.
Synthetic tests exercise total time, byte boundaries, tiny/empty chunks and
redacted failures. No live benchmark, production taxonomy, schema or dependency
changed; AB#55 acceptance and Feature AB#62 remain separate. AB#328 moved
New → Active before implementation and awaits owner review/merge.


### AB#338 — header reflow with enlarged root text (2026-10-17)

The header now chooses its compact or wide arrangement from its actual
root-relative container width, so a 1280px viewport with 32px root text keeps
the compact controls instead of overflowing. Full brand words and controls
wrap onto separate rows where needed; the original 320px layout was already
painting the brand descriptor under the search control. Ordinary 390px and
768px layouts retain their single row. Native logo dimensions, authored
navigation order, labels, theme and language behavior remain intact.

An unusually tall bar scrolls with the document in short enlarged viewports;
its disclosure retains a usable internal scroll region, and fixed header
scroll offsets are cleared while the bar flows. The search dialog retains its
native modal top-layer behavior. Production journeys cover both locales,
Chromium/WebKit, 16px/32px root text, container boundaries, complete text and
logo bounds, short-screen keyboard access and the script-free search link.
AB#338 moved New → Active before implementation and awaits owner review/merge.
The branch includes the accepted AB#322 and AB#332 main updates; its tests use
the existing synthetic harness rather than any live CMS data. No deployment is
claimed.

### AB#334 — Justified inline mini-gallery inheritance (2026-10-17, Active)

Article and gallery body mini-galleries now reuse the existing justified row
compositor when the site's/page's resolved layout selects it, including articles
without an end gallery. Explicit gallery overrides remain authoritative. Grid and
masonry retain the existing one/two-column inline grid. Complete captions and
credits remain below each picture; small/extreme native frames receive bounded
single-image rows without shrinking their neighbours. SSR retains plain images,
authored order, the 12-image bound and independent viewers. No CMS content was
changed. ADR-0003 records the scoped historical grid-rule amendment. One plan review
and the bounded final reviews are complete; the CI1164 continuity correction keeps
inline triggers outside the curated sequence. Prerequisite PR#475 is now accepted
on main. Current-main integration and its checks are tracked in PR#482; AB#334 stays
Active pending accepted merge. Parent AB#321's actual content/design acceptance
remains open.

### AB#342 — gallery section pointer activation (2026-10-17, Active)

A press on a moving section link holds that row's painted position until the
native gesture ends, so focus/reveal cannot move the link between pointerdown
and pointerup. The row releases on click, cancellation, drag-away, window blur
and teardown; native link modifiers and touch panning remain browser-owned.
The header and shared keyboard/scroll-reveal rules remain independent. Section
position restoration measures layout position without the reveal translation,
preventing an animation from becoming a false scroll correction. The existing
URL, selected state, counts, cursor reset and no-JavaScript links are preserved.
The earlier count-test focus preparation in AB#338 is separate from this runtime
repair. Owner review/merge and deployment acceptance remain pending.

AB#19 status correction, 2026-10-18: the registry has no pending decisions. The report counts 415 distinct paths as 232 redirects, 179 justified `410` responses, three excluded error paths and one already-live root; the final 37 pending decisions were resolved by AB#271 on 2026-10-13 after earlier slices had reduced 48 to 37, so earlier pending counts are historical. An anonymous `verify:legacy-redirects -- check https://photosite-starter.vercel.app https://www.ilkansivu.net` run passed all 415 rows with no issues (first run without the canonical origin reported only `target-canonical-mismatch` on the 232 redirects, because that deployment declares `https://www.ilkansivu.net`). This is the current public deployment, not the launch candidate: The final check on the canonical production host, its attached report and owner acceptance remain open. AB#19 remains Active; no application code, redirect decision, CMS content or deployment changed.

AB#132 recheck, 2026-10-18: a production build of main `0295671` on Next.js 16.4.2 (npm `latest`) still returns the empty `__next_error__` shell without JavaScript for an unknown public URL and a refused gallery cursor in desktop Chromium and mobile WebKit; the two probe definitions × two browsers (four executions) still hit their expected-failure markers. Upstream #62228, #99287, #99793 and the candidate fixes #98455/#98583 are open. The October 7 owner acceptance's review date (October 8) has passed and remains unrenewed, so a new explicit owner decision or a released fix is still required before AB#18. Recorded in [ADR-0007](adr/0007-proxy-request-path-boundary.md#scriptless-404-recheck--2026-10-18-ab132). AB#132 remains Active; no code changed.

AB#132 renewal, 2026-10-19: the owner re-accepted the scriptless-404 residual for two months; the new review date is 2026-12-19, tracked by AB#370. No code, Proxy or test marker changed. AB#132 remains Active. Recorded in [ADR-0007](adr/0007-proxy-request-path-boundary.md#2026-10-19-owner-renewed-temporary-residual-risk-ab132).

README currency check, 2026-10-18: the site-search item is marked done to match AB#299 (Closed, merged 2026-10-15; ADR-0033 is still Proposed), and the two passages that said home and contact still use the default locale now match the localized home/contact routes described in Getting started (AB#255, ADR-0029). AB#255 remains Active for the other page families. The AB#19 redirect figures are corrected on the separate `fix/19-legacy-redirect-status-and-check` branch. No code changed.
