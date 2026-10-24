# Client gallery expiry and file cleanup

Owner direction, 2026-10-24: when an unlisted client gallery expires, automatically
remove its online customer images and its one whole delivery ZIP. The delivery
default is six months. This fills a gap in the Sanity workflow rather than restarting
the rejected protected S3/PostgreSQL implementation. Work: **AB#392**, under AB#63;
related AB#29, AB#145 and AB#130.

## What exists

**AB#393** sets the creation defaults for new `clientDeliveryGallery` documents in
Studio: paused, `availabilityMode: until`, and an editable UTC `expiryInstant` six
calendar months from creation. The day clamps to the last day of the target month:
31 August 2026 becomes 28 February 2027. Hours, minutes, seconds and milliseconds
remain the same in UTC. The Studio displays local time, which can differ across DST.

The editor's browser clock supplies this suggestion. Check the actual deadline
before publication, especially for an old draft or a device with an incorrect clock.
Publication and later edits do not restart the clock. Scripts/API creates get no
default. An editor can set a different finite date or deliberately choose indefinite
availability and clear the deadline; the existing validator enforces that pairing.
Native duplication is already disabled; identity validation also rejects copied handles.
Invalid clocks or unavailable secure randomness throw without a fallback. Whether the
hosted Studio presents that failure correctly remains an editor acceptance check.

The customer reader already closes a finite page at `now >= expiryInstant`, using
fresh publication/availability checks. A pause and unpublication affect page access.
**None of these operations currently deletes files automatically.** Existing records
are never patched by an initial-value resolver.

PR #609 implements **manual proof-gallery deletion** with its private records and
unshared images. It is not an expiry worker. The accepted ADR-0038 proof default stays
indefinite before replacement. The owner clarified on 2026-10-24 that proofs must be
deleted when their linked replacement delivery is published, rather than acquiring a
six-month timer. The [accepted ADR-0038 amendment](adr/0038-proof-selection-in-existing-sanity.md#replacement-deletion-amendment-2026-10-24)
records the deletion unit and consequences, including removal of confirmed versions.
**AB#396 implements this publication-triggered deletion in source** through the guarded
Studio delivery action, reusing the complete manual-deletion unit. It preserves target
and shared images; the old proof URL becomes unknown/404 with no retained mapping.
Hosted acceptance and activation remain separate. Legacy links retain their earlier
redirect behavior until that proof is deleted.
See [proof data flow](proof-selection-data-flow.md).

## Remaining implementation

- **AB#393 / AB#394 — Closed:** creation defaults and the
  [pure, non-executing planner](client-gallery-retention-planner.md) merged in PRs #610
  and #611. A candidate result never authorizes deletion.
- **AB#395 — Active:** delivery-only expiry executor, enrollment, reconciliation,
  operational controls, hosted tests and deliberate activation.
- **AB#396 — Closed:** guarded Studio proof deletion together with linked replacement publication,
  merged in PR #613; hosted acceptance remains separate. This is a publication
  operation, not part of the delivery expiry sweep.
- **AB#397 — Active:** source implementation of reviewed Studio cleanup enrollment and
  the private control contract; owner review/merge and hosted verification remain.
- **AB#398 — Active:** separate source worker/scheduler slice, followed by hosted gates.

**No automatic cleanup is deployed or configured by AB#393.** No gallery is enrolled
by receiving a creation default. AB#397 implements enrollment in the separately enabled
Studio publication workflow; the server worker is separate and remains default-off.
An execution-time revision mismatch requires fresh planning rather than silently losing
approval after a text edit. Existing new-delivery records require a reviewed enrollment
decision. Legacy enrollment remains outside this contract. Do not
convert an indefinite gallery to finite access or bulk-enroll the 21 legacy galleries.

The new-ZIP authoring/transport decision remains [ADR-0035](adr/0035-unlisted-delivery-zip-proposal.md)
(Proposed). A cleanup requirement grants no new file eligibility or upload permission.
Legacy galleries have their own image records, manifests and batch constraints; a
new-delivery planner does not establish their removal safety. AB#396
replacement publication removes proofs permanently; they do not return if delivery later
closes. Send the customer the new delivery link: the old proof URL becomes unknown/404.
The existing delivery clock still starts at draft creation: check the actual deadline
at handoff, because publication does not grant a fresh six months.

## Reviewed enrollment and private control (AB#397)

The Studio flag `SANITY_STUDIO_CLIENT_GALLERY_CLEANUP=enabled` exposes an explicit
FI/EN cleanup checkbox, deadline, image count, current state and latest closed result.
Blank/`off` does no cleanup IO; invalid values fail configuration. The flag does not
start the server worker. Every unenrolled delivery is initially unchecked and requires
explicit consent, including a new finite delivery. Current absence cannot prove it was
never published: native unpublish can leave the same draft shape. Existing enrolled/pending state
persists by default across text edits. Disabled/completed approval needs deliberate
re-enrollment. Indefinite, proof and legacy galleries cannot enroll. An expired ordinary
publication warns that enabled cleanup may begin immediately; no grace period is added.

One private deterministic `clientGalleryCleanup.<SHA256(published ID)>` record holds
version 1, gallery ID, approved handle/deadline/sorted image IDs, reviewed source document
ID/revision, unique publication identity, enrollment time and latest state. Pending
stores only operation ID/time, never an executable plan. Completed receipt stores the
actual deleted/shared image IDs, revisions and counts, partitioning the approved set.
Only one latest result/receipt is kept; it remains until re-enrollment or separately
authorized removal, with no added purge timer. Customer/contact data, authored titles,
filenames, URLs and raw CMS payloads are excluded. No public gallery field or editable
control schema/template is added. [Sanity IDs and paths](https://www.sanity.io/docs/content-lake/ids)
describe authenticated access to dotted IDs; verify actual project roles before use.

Every enabled publication creates or CAS-patches the control in the same transaction
as publication and any selected proof deletion. Renewing or withdrawing consent changes
the control revision and fences an old pending worker. Deadline/image changes are shown
for renewed review; the creation deadline is never reset. Flag-off publication leaves
an existing control unchanged: fresh worker policy/revision checks still have to reject
changed policy. Dataset writers can forge controls, so stored approval never replaces
the worker's independent current-gallery validation. The source revision audits the
reviewed draft/published source, not the new server-assigned publication revision.

Unknown publication results are read back without retries. Exact publication/source
identity and policy must match, including worker advance to pending/completed. A matching
completion receipt can prove publication after immediate expired-gallery removal;
other mixed or unreadable states remain uncertain. See the
[Studio workflow](../studio/README.md#review-automatic-delivery-cleanup-enrollment-ab397).

Open drafts and incoming gallery references, including a retained proof link, block
cleanup until an operator resolves them. Shared images stay online with no later sweep
by this worker. A latest blocked result is visible in Studio; do not treat page expiry
as evidence that file deletion succeeded. This source PR performs no live enrollment,
CMS write, deletion, deployment or activation. Hosted role/anonymous-read checks,
synthetic atomic-transaction/race rehearsal and FI/EN keyboard/assistive-technology
acceptance remain required under AB#395.

## Required safeguards before an executor is enabled

These are implementation requirements to verify in AB#395, not evidence of a running
service or a final provider-read contract:

1. Off by default; a narrowly scoped server-only Sanity credential and authenticated
   scheduler. No customer-triggered deletion, public write permission or new provider.
2. Fresh authoritative reads of the gallery, enrollment and complete relevant
   draft/release/private records. Refuse malformed, unreadable, truncated, incomplete
   or concurrently changed evidence. A query index alone cannot prove absence.
3. One revision-guarded gallery operation removes its owned references before asset
   deletion. Decide and document whether an expired gallery is removed or reduced to
   an inert record, and how already-clean records reconcile. Keep all shared assets,
   including uses in drafts/releases and weak references. Strong-reference conflicts
   must fail the complete transaction; they cannot protect concurrent weak uses.
   The final design must resolve that limitation before claiming safe automation.
4. Images and the one intact ZIP are inventoried together; no partial ZIP, splitting,
   unrelated asset sweeping or deletion by filename. A shared file stays and is reported.
   Proofs are outside this expiry sweep. AB#396 must reuse their terms guard and
   complete private-record inventory for deletion on replacement publication.
5. Bounded batches and time budgets with progress past blocked galleries, closed reason
   codes and counts, no customer values/links in logs. An uncertain commit is reconciled
   from current state, never blindly retried. A failed deletion must be visible.
6. No invented grace period: expiry makes an enrolled finite gallery eligible for the
   next successful scheduled run. Cadence and delay are documented when implemented;
   neither instant deletion nor a guaranteed deadline is claimed today.
7. Deterministic race/failure tests, a separately authorized hosted role/deletion rehearsal
   with synthetic files, customer privacy wording matching actual behavior, then owner
   activation. A source PR, merge or passing fixture is not activation.

## Limits of deletion

Deleting an unused Sanity asset removes the stored file, but cannot withdraw downloaded,
forwarded or separately copied bytes. Provider caches may continue serving it for a
while. Document history and backups follow their own retention and are not purged by
ordinary deletion. Already sent mail cannot be withdrawn. Shared assets remain online.
Page noindex, a random link, expiry and URL parameters provide no confidentiality or
revocation. The photographer's offline archive is outside this website's cleanup scope.

Provider references checked 2026-10-24: [initial values](https://www.sanity.io/docs/studio/initial-value-templates),
[transactions and query consistency](https://www.sanity.io/docs/content-lake/transactions),
[asset deletion and strong/weak references](https://www.sanity.io/docs/apis-and-sdks/js-client-assets),
[deleted-document history](https://www.sanity.io/docs/developer-guides/find-and-restore-deleted-documents).
