# Scheduled delivery cleanup (AB#397–399)

Source implementation, **default off; hosted acceptance and activation pending**.
This implements the accepted delivery-expiry direction in ADR-0034/AB#392 using
existing Sanity and Vercel. Merge and the committed cron schedule do not enable it.
The Studio enrollment slice is AB#397; the executor is AB#398 under AB#395.
Both source slices merged in PR #614/#615. AB#399 adds the separately invoked
read-only readiness probe below. The separately authorized **AB#401 rehearsal on
2026-10-24** measured the real dataset and exercised synthetic publication,
replacement and expiry deletion through an isolated local production build.
Narrow write grants, editor identity and hosted checks
remain open; **activation is still blocked**. See the
[dated results and limitations](audits/client-gallery-lifecycle-rehearsal-2026-10-24.md).
The later [AB#403 mail-only test](audits/proof-notice-mail-verification-2026-10-24.md)
verified local provider acceptance; it adds no cleanup activation evidence.

Only explicitly enrolled, finite new `clientDeliveryGallery` records qualify.
Legacy deliveries and proof galleries cannot enroll. Proof deletion happens in
the reviewed delivery-publication workflow (AB#396), without a six-month timer.
The current new-delivery schema has no ZIP: this worker deletes no ZIP and grants
no new ZIP/file exception. ADR-0035 remains separate.

## Approval and ordering

One private dotted `clientGalleryCleanup.<sha256(published-gallery-id)>` record
stores approved handle, expiry and sorted unique image identities, the exact
reviewed source identity, and a unique publication identity. Studio commits it
atomically with publication. Text/alt/order edits can retain consent; changes to
the deadline, handle or image set need a new reviewed policy. Indefinite mode
cannot enroll. Every unenrolled delivery requires deliberate opt-in: an absent
published record cannot prove that a gallery has never been published before.

The worker revalidates the complete current gallery with the real server parser
and compares its policy to the approval. It constructs AB#394 evidence bound to
the **current** gallery revision. The reviewed source revision is an audit field,
not a claim that publication returned the new server-assigned revision.

The exact control revision is the ordering fence shared with Studio. A pending
attempt stores only a random operation ID and time, never an executable plan.
Before replacing a pending attempt, the worker conditionally changes that exact
control revision; a late earlier deletion then loses its first revision guard.
If the earlier deletion won first, its matching completion receipt establishes
the outcome. A network timeout alone establishes neither success nor failure.

Each deletion is one atomic transaction: update the exact pending control to its
completion receipt, assert the current gallery revision and delete the gallery,
assert absence of its draft by create/delete, assert each candidate asset's
existence/revision, then delete those assets. There is no split batch or query
delete. Any guard or strong-reference failure rolls back the transaction.
Provider failure responses are classified conservatively; uncertain writes are
read back and never blindly replayed. A completion receipt contains actual
deleted/kept image identities and counts, with no customer text or address.

Shared assets remain online, including an observed weak reference, draft,
release, public use or private media use. They have **no later sweep** in this
slice, even if the other use ends. Content-addressed deduplication can make an
upload shared. An incoming reference to the gallery itself blocks removal;
keeping an old proof with a replacement link can therefore block delivery
cleanup. An open delivery draft also blocks cleanup until resolved. No grace
period, automatic draft discard or reference breaking is invented.

## Fresh evidence and remaining provider boundary

A small advisory GROQ due query avoids a dataset export when no work is due.
Query-index lag may delay pickup; the query never authorizes deletion.
Each active run obtains one ordinary authenticated, non-cursor
[Export API snapshot](https://www.sanity.io/docs/http-reference/export), including
all token-readable drafts, releases, assets and dotted private records. Cursor
exports would span snapshots and are refused. Export errors, cursor markers,
stream failures, malformed/duplicate JSON and IDs, invalid UTF-8 and exceeded
bounds refuse the whole snapshot. A normal HTTP stream completion is the provider
completeness boundary; the response has no independent dataset checksum.

Each bounded NDJSON document is parsed transiently. The retained in-memory index
contains only ID, revision, type and reference identities/weakness. Other fields
are discarded. The export can transiently include proof terms with addresses,
prices and encrypted keys: the worker therefore broadens this server function's
READ access to existing private records. The raw export is never saved, returned
or logged. Sanity and Vercel remain the processors; no additional service is added.

Fresh [Doc API](https://www.sanity.io/docs/http-reference/doc) batches account for
every requested ID as a document or an explicit existence omission. Permission
omissions and unreported IDs are failures. All-version reads block current
draft/release counterparts of the gallery/control/cursor. Assets not observed in
the snapshot defer deletion. Known other uses are retained conservatively even
if that use disappears after the snapshot. Provider `Date` headers are required
and must be within 60 seconds of the local clock. Eligibility uses the earlier of
local time and the snapshot's provider time, avoiding early expiry from local skew.

A strong reference introduced after the snapshot makes the provider reject asset
deletion. **A late weak reference or arbitrary direct API release writer is not
closed by this protocol.** Studio validation is an editorial control, not an ACL.
Activation requires all relevant writers to use the controlled workflow and
strong asset references, and no pre-existing scheduled client/proof versions.
If those conditions cannot be established, activation remains blocked.

The export lists only documents the token can read; it cannot prove that nothing
was hidden. Full dataset READ, including private IDs and all versions, must be
verified separately. WRITE should be restricted to the cleanup control/cursor
prefixes, new delivery documents and image assets. An asset grant cannot in
general express “only images currently owned by an enrolled delivery”; it may
allow deletion of other unreferenced image assets. The worker's independent
policy/inventory checks and Content Lake's strong-reference rejection supply
that narrower operational boundary. A dataset writer can forge a control; it is
not a cryptographic consent receipt or a defense against a malicious writer.

## Bounds, progress and operation

The daily GET `/api/client-gallery-cleanup` is scheduled at `0 7 * * *` UTC.
The platform's invocation time need not be exact and duplicate invocations are
safe through revision arbitration. Constant-time `Bearer <CRON_SECRET>`
authentication precedes provider traffic. HEAD and other methods return 405.
All responses are `no-store`; disabled is 404, invalid configuration or a failed
primary read/export is 503, missing authentication is 401. Responses and logs
contain closed counts/error codes and a random correlation ID only.
The existing application maintenance gate preempts this route too: while active,
the cron receives the generic 503 before configuration, authentication or store IO.

Per run: at most 50 examined active controls and five destructive attempts.
Snapshot-complete/disabled controls remain reference evidence but do not consume
the work cursor; later re-enrollment is picked up by a future snapshot. IDs strictly
after the private cursor are visited first, then the remaining IDs; deleting the
cursor's previous target cannot strand progress. Classified blocked, refused,
conflicting and uncertain items advance progress. The cursor is conditionally
written at the end; a race may lose progress but cannot authorize deletion.
The closed `cursorWritten` response/log field confirms an acknowledged cursor
commit. False also covers an unattempted or uncertain write. When work was
examined, investigate false results: a missing cursor grant can otherwise repeat
the first bounded window indefinitely. Completed deletion receipts remain valid.
No new gallery starts after 30 seconds **after the snapshot**, and no claim starts
without 35 seconds remaining in the 185-second hard budget. Every headers/body
read shares the abort deadline. The route reserves `maxDuration = 200`; the
deployment's actual function allowance must support this before activation.

Default snapshot caps are 64 MiB, 100,000 documents, 1 MiB per line and 500,000
references. Exceeding a cap is `snapshot_limit_exceeded` and stops cleanup;
there is no silent partial fallback. Validated server overrides:

| Setting | Default | Allowed |
| --- | --- | --- |
| `CLIENT_GALLERY_CLEANUP_MAX_EXPORT_BYTES` | 67108864 | 1048576–268435456 |
| `CLIENT_GALLERY_CLEANUP_MAX_DOCUMENTS` | 100000 | 100–200000 |
| `CLIENT_GALLERY_CLEANUP_EXPORT_TIMEOUT_MS` | 30000 | 5000–60000 |

The one-line parser and reference caps remain fixed in production. The export
deadline includes transfer and parsing. Fixture tests measure a multi-MiB
synthetic export; actual capacity must be measured privately before activation.
Raising bounds requires reviewing memory/time capacity, not assuming growth is
free. A dataset that outgrows the maximum needs a separately reviewed inventory
strategy. Until then, deletion remains blocked.

An operator must inspect scheduled-run logs and aggregate `blocked` counts and
open the affected gallery's Studio publication dialog for its latest reason.
This source adds no automatic alerting. If provider permissions prevent a status
write, only the aggregate outcome can be recorded; inspect failed runs as well
as Studio status. Resolve a draft or incoming reference
through its normal reviewed workflow; re-review changed policies; fix role or
snapshot failures before the next run. Do not manually replay a captured mutation
or delete an ambiguous pending record to “retry.” The next run fences it safely.
Missing gallery without a matching completion receipt is blocked, not reported
as successful deletion. A malformed control is not rewritten to hide the defect.

One bounded current control/result/receipt and one cursor have no automatic
metadata expiry. Re-enrollment/withdrawal replaces current state and clears the
previous attempt/receipt; the private control remains until authorized operator
removal. There is no separate attempt-history store or metadata-purge timer.
Ordinary provider history/backups, CDN copies and already downloaded files remain
outside this deletion. Page expiry still takes effect independently of cleanup.

## Separately authorized activation evidence

### Read-only capacity and known-canary probe (AB#399)

This is the first evidence step, not an activation check or a write rehearsal.
Run only with the owner's explicit authorization for the actual dataset read.
It uses the worker's bounded non-cursor export and strict all-version Doc API,
with an additional exact-URL GET-only guard. It cannot invoke a mutation, query,
cron, role change or deployment, and does not create its own canaries.

Before the authorized run, separately prepare synthetic, non-customer records:
a published record, its draft and one release copy, a dotted private record,
and an unused flat ID. Use unique random suffixes and the **actual** IDs/types;
the following is an example, not a command to create these records. Keep this
manifest outside Git on the native Linux/POSIX filesystem (WSL: not `/mnt/c`),
owned by the current user, regular, mode `0600`, with one link and no symlinks:

```json
{
  "version": 1,
  "target": { "projectId": "example", "dataset": "production", "apiVersion": "v2026-10-01" },
  "canaries": {
    "published": { "id": "cleanupProbe-random", "type": "cleanupCanary" },
    "private": { "id": "cleanupProbe.private-random", "type": "cleanupCanary" },
    "draft": { "id": "drafts.cleanupProbe-random", "type": "cleanupCanary" },
    "release": { "id": "versions.release-random.cleanupProbe-random", "type": "cleanupCanary" }
  },
  "missingDocumentId": "cleanupProbe-missing-random"
}
```

The strict manifest (maximum 32 KiB) is the **only target source**. Missing fields,
unknown fields, duplicate JSON keys, invalid UTF-8/BOM, invalid IDs/types or
inconsistent copies are refused. The API must be a real date from `v2025-02-19`
through today. Canary IDs under `clientGalleryCleanup.` and the
`clientGalleryCleanup` type are reserved for the worker and refused. Selecting
genuinely synthetic records remains the operator's responsibility. Optional `limits`
may contain only `maxSnapshotBytes`, `maxDocuments` and `exportTimeoutMs`, with the
production bounds above. All other caps stay fixed. The declared target says
nothing about actual dataset visibility.

In a private, mode `0600` env file outside Git, set just these operator inputs:

```dotenv
CLIENT_GALLERY_CLEANUP_READINESS=enabled
CLIENT_GALLERY_CLEANUP_READINESS_MANIFEST=/absolute/private/cleanup-readiness.json
SANITY_CLIENT_GALLERY_CLEANUP_TOKEN=<dedicated-cleanup-token>
```

Never use a browser-prefixed token. The file guard applies to the manifest, not
to Node's env file: the operator must protect the latter. Node's `--env-file`
preserves existing shell variables, so remove any ambient copies of **these three
settings** before running in the repository with the pinned Node 24:

```bash
env -u CLIENT_GALLERY_CLEANUP_READINESS -u CLIENT_GALLERY_CLEANUP_READINESS_MANIFEST -u SANITY_CLIENT_GALLERY_CLEANUP_TOKEN \
  node --env-file="/absolute/private/cleanup-readiness.env" \
  node_modules/vitest/vitest.mjs run --config vitest.cleanup-readiness.config.mts
```

Alternatively, `npm run verify:client-gallery-cleanup-readiness` uses settings
already resolved in the environment. Neither command implicitly loads `.env.local`.
The probe does not require or change the runtime/Studio cleanup flags or
`CRON_SECRET`. Ordinary `SANITY_*` target/read-token settings are ignored.
Missing opt-in, token or absolute manifest path fails before file/provider IO.
The dedicated config discovers only this live test; default `npm test`, existing
live-verification configs and CI exclude it. Never run it in CI or publish its logs
as pipeline artifacts. Run with a synchronized local clock.

The report is a closed JSON object inside Vitest's console output (the whole
stdout is not a JSON file). It contains target/manifest SHA-256 fingerprints,
timestamp, known-canary/copy/absence counts, export bytes/documents/references,
largest NDJSON line and export elapsed milliseconds including transfer/parsing,
plus effective limits. One outer 75-second abort covers provider reads and their
setup; each export/Doc operation also retains its own deadline. Vitest allows
90 seconds for teardown. No raw export, token, canary ID/type, target names or
authored field is saved or printed. As with the worker, complete readable records,
including private proof terms, pass through memory on the operator's machine;
only the normalized reference inventory is retained during the probe.

All four named canaries must occur in the export. Fresh Doc reads must then match
**every observed copy** of both base IDs by identity/type/revision, and explicitly
omit the unused ID for `existence`. Missing canaries report a fixed kind-specific
`canary_*_not_observed`; a changed/new/disappeared copy reports `canary_changed`.
A new canary not yet visible to export, or concurrent edits between reads, can
cause a refusal: inspect the synthetic records, wait for the expected state to
settle, then request/re-run the authorized probe. There is no automatic retry.
`provider_refused` covers HTTP 4xx; `provider_invalid` covers malformed/permission
omissions; clock, deadline, snapshot limits and unavailable provider have separate
closed codes. Diagnostics retain no original provider error/cause or input path.

Even `read-checks-passed` always reports `readyToDelete: false`,
`readyToActivate: false`, `fullReadGrantProven: false` and
`writeGrantsVerified: false`. A broad administrator token could also pass this
probe: independently record the token's intended role/identity, full READ grant
policy, restricted WRITE, atomic deletion/races, writer controls, actual function
allowance and hosted Studio/privacy acceptance. Named reads cannot prove that no
other document is hidden; local capacity is not Vercel capacity. The fingerprints
bind the report to inputs, not to a grant, source commit or approval. Keep a private
run record with the source commit and operator-reviewed limits. This source task
uses only mocked provider responses; all actual hosted evidence remains pending.

### Cleanup credential decision (AB#405)

[Proposed ADR-0040](adr/0040-client-gallery-cleanup-credential-options.md) records
the 2026-10-25 read-only role observation and concrete custom-role, broad-Editor
and disabled-cleanup options. No option is accepted; the existing restricted-WRITE
requirement and activation block remain. A dedicated Editor token is not approved
by this proposal or by the synthetic rehearsal.

### Remaining hosted rehearsal

Before enabling either flag, record a synthetic hosted rehearsal, with no real
customer deletion and no credentials/raw exports in CI or public artifacts:

1. Confirm owner approval, actual function allowance and Production-only scope;
   keep Preview off. Confirm server dedicated-token and Studio editor grants.
2. Verify full READ with known public, private dotted, draft and release canaries,
   and restricted WRITE by attempting forbidden proof/legacy/unrelated non-image writes.
   Explicitly verify both create and revision-guarded update on the cleanup cursor
   prefix, and confirm `cursorWritten: true` after a handled synthetic batch.
   Record the residual image-asset grant breadth explicitly.
3. Measure export bytes/documents/largest line/reference count/duration privately
   and compare them with the configured bounds. Confirm normal completion and
   failure envelopes against the pinned API.
4. Verify all-version Doc omissions and copies, create-then-delete absence
   assertion, patch revision then delete of an asset, deletion of a source and
   its strongly referenced image in one transaction, and reference-integrity
   status/response shapes. A fake Content Lake cannot establish provider behavior.
5. Exercise both publication/withdrawal and deletion orderings, a late strong
   referrer/draft, duplicate invocations, lost claim/deletion responses and a late
   old request losing its control fence. Check completion receipts and rollback.
6. Establish the controlled strong-writer/no-release boundary, operator log review
   and actual privacy-notice wording. Verify FI/EN Studio/assistive-technology
   behavior. Keep activation blocked if any required evidence is missing.

`CLIENT_GALLERY_CLEANUP=enabled` additionally requires the real Production Sanity
delivery adapter, a dedicated `SANITY_CLIENT_GALLERY_CLEANUP_TOKEN`, a dated API
at least `v2025-02-19` and `CRON_SECRET` of at least 16 characters. Browser-prefixed
copies of either secret are refused. `SANITY_STUDIO_CLIENT_GALLERY_CLEANUP=enabled`
controls Studio enrollment separately. Neither is set by this implementation.
