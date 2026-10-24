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
indefinite and its private records stay until gallery deletion. Whether the new default
also applies to proofs is an open owner question; this slice changes no proof lifecycle.
See [proof data flow](proof-selection-data-flow.md).

## Remaining implementation

- **AB#394:** pure, non-executing eligibility/candidate planner. Its result is evidence
  for further checks, never permission or an executable deletion.
- **AB#395:** authenticated scheduled executor, enrollment storage, concurrency and
  reconciliation, operational controls, hosted tests and deliberate activation.

**No automatic cleanup is deployed or configured by AB#393.** No gallery is enrolled
by receiving a creation default. Enrollment storage and how newly published galleries
join the enabled workflow belong to AB#395. They must avoid silently losing enrollment
after an unrelated text edit; an execution-time revision mismatch requires fresh
planning. Existing and legacy records require a reviewed enrollment decision. Do not
convert an indefinite gallery to finite access or bulk-enroll the 21 legacy galleries.

The new-ZIP authoring/transport decision remains [ADR-0035](adr/0035-unlisted-delivery-zip-proposal.md)
(Proposed). A cleanup requirement grants no new file eligibility or upload permission.
Legacy galleries have their own image records, manifests and batch constraints; a
new-delivery planner does not establish their removal safety. A replaced proof may
point at a closed delivery page after expiry; cleanup must not restore the old proofs
or claim that replacement itself deletes them.

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
   If proof expiry is later included, use its terms guard and complete private-record
   inventory, preserving confirmed versions until the gallery's actual deletion.
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
