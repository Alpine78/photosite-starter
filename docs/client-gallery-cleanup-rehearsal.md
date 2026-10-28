# Synthetic cleanup fault rehearsal (AB#409)

This separately invoked **operator tool** calls the actual cleanup transport and
runner against an isolated
Sanity `preview` dataset. Default discovery excludes its live entry point; an
isolated child regression verifies refusal before IO when started without opt-in.
Neither this tool, its merge nor a passing offline test activates customer galleries.
The later authorized [AB#410 execution](audits/client-gallery-cleanup-fault-rehearsal-2026-10-28.md)
passed all nine scenarios against real Content Lake: 18 uploads / 78,661 bytes,
242 requests / 77 writes, followed by independent baseline/55-ID absence checks.
That is provider-only evidence; future runs still require their own authorization.
The [AB#408 hosted evidence](audits/client-gallery-hosted-rehearsal-2026-10-28.md)
remains a distinct, completed run; no passed large-file transfer is repeated here.

## What it can establish

| Case | Ordering and independent check |
| --- | --- |
| Source revision | Finish a competing gallery patch before forwarding the original deletion; gallery/image/ZIP revisions must remain as observed after that patch. |
| Image / ZIP revision | Finish the respective asset patch first; the complete deletion must roll back, including its receipt. |
| Late strong referrer | Create a synthetic strong ZIP referrer after inventory; verify provider rejection and unchanged gallery/assets. |
| Late draft | Create the gallery's exact draft after inventory; verify rollback of the deletion unit. |
| Claim / deletion response loss | Send one actual request and confirm its committed result, then deliberately return `uncertain` to the runner. Verify reconciliation from its exact operation receipt without replay. |
| Delayed old deletion | Hold the original deletion **before sending it**, let the runner establish a newer control fence, then release those original bytes once. Require revision conflict and retained gallery/assets. |
| Duplicate invocations | Both runners read the same enrolled control revision behind a real barrier before either may claim it. Exactly one completes deletion. |

The response-loss cases are **local fault injections**, not observed Internet outages.
The delayed request is not a retry of an ambiguous wire write: its first logical
call was intentionally never sent. Private evidence distinguishes logical calls,
actual wire requests, injected outcomes, counts, receipts and final Doc API reads.
An unexpected provider response fails the case; it is never converted into a pass.

This is provider-only acceptance. It does not exercise a hosted function, Vercel
scheduler, signed-in Studio, human Editor/Viewer roles, publication/withdrawal
orderings, screen readers, mail or original Production activation. Native Studio
tests remain separate even though the owner has confirmed an available human Editor.

## Containment and prerequisites

An owner must authorize the **actual run**, its credentials, target and bounded
existing-plan usage before either command is used. This implementation performs no
provisioning, membership changes, token creation/revocation or deployment.

Use a clean committed checkout of the reviewed source, the existing `preview`
dataset, and an otherwise empty dataset. Preparation may observe at most 32
provider `system.group` / `system.retention` records without references; it freezes
their **exact IDs, types and revisions** in the private manifest. Run mode accepts
only that frozen inventory plus the finite owned test IDs. It does not treat a
`system.*` prefix as a runtime exemption, remove system records or filter exports.
Any baseline change requires fresh preparation and review, not editing the approval.

Create any separately approved short-lived robot credentials **before** preparation:
token/membership changes can change access-group revisions. The preparation read
can use a Viewer; the write run needs an authorized Editor with full dataset reads.
Keep other writers and scheduled client/proof versions out of this test dataset.
Credential role, provider expiry and the absence of uncontrolled writers are
operational prerequisites; this tool does not attest them. A robot proves no human
Editor acceptance. No personal session or owner-supplied token is deployed or revoked.

The tool permits only the exact project host, dated API, `preview` paths, ordinary
export/Doc reads and guarded mutations/uploads. It refuses queries, actions,
redirects, foreign targets/references, weak references, JSONPath patches, query
deletes and unguarded deletion. Production-only application configuration is
unchanged; the tool directly invokes the source modules, without setting activation flags.

Every upload starts from newly generated test-card pixels: full-frame 256 × 192
WebP preview, 512 × 384 JPEG, and one whole ZIP containing that JPEG. Nonce and case
both affect the image bytes, preventing cross-case deduplication. The ZIP uses the
source's neutral `delivery.zip` asset filename. JPEGs are never uploaded individually.
Inspect the generated local files before approval. Runtime regeneration must match
the exact approved sizes, SHA1/SHA256 and derived asset identities before any IO.

## Preparation: one bounded read, no provider write

Both modes use the same command and require explicit environment values; no local
`.env` file or credential fallback is loaded. `CI` environments are refused.
Keep input/credential files outside tracked files, on a native POSIX filesystem,
owned by the operator, regular, one link, mode `0600`, without symlinks. The token
file contains just the token and an optional final newline, **not an env assignment**.
Never paste a token or session into a command argument, chat, PR or CI variable.

In a private `0700` parent directory, create a `0600` input file:

```json
{
  "version": 1,
  "target": { "projectId": "example123", "dataset": "preview", "apiVersion": "v2026-10-01" }
}
```

Replace the example project with the separately reviewed target. Preparation makes
one authenticated ordinary export GET, checks the empty-content boundary, generates
all nine independent file sets locally, and writes an exclusive private output
directory. Existing output directories are refused as evidence from an earlier attempt.

```bash
CLIENT_GALLERY_REHEARSAL_OPT_IN=synthetic-only \
CLIENT_GALLERY_REHEARSAL_MODE=prepare \
CLIENT_GALLERY_REHEARSAL_INPUT=/absolute/private/target.json \
CLIENT_GALLERY_REHEARSAL_TOKEN_FILE=/absolute/private/reader-token.txt \
CLIENT_GALLERY_REHEARSAL_OUTPUT=/absolute/private/new-preparation \
npm run verify:client-gallery-cleanup-rehearsal
```

Review `manifest.json`, all generated frames/JPEGs/ZIPs, source SHA, current quota
headroom, exact baseline and target. Preparation prints only a closed summary and
manifest SHA256. Approval binds the exact manifest bytes and expires three hours
after preparation. A different checkout, edited source, changed codec output,
changed baseline or stale manifest is refused before the first provider write.

## Separately authorized write run

The manifest includes **55 exact IDs**, including the fixed source cursor
`clientGalleryCleanupCursor.daily`. Every owned target must independently be absent
before setup. Existing cursors, controls or content block the run. No prefix grants
deletion authority. The operator must authorize these uploads and synthetic writes
and have a viable local recovery credential before starting.

```bash
CLIENT_GALLERY_REHEARSAL_OPT_IN=synthetic-only \
CLIENT_GALLERY_REHEARSAL_MODE=run \
CLIENT_GALLERY_REHEARSAL_INPUT=/absolute/private/new-preparation/manifest.json \
CLIENT_GALLERY_REHEARSAL_APPROVED_DIGEST=<reviewed-manifest-sha256> \
CLIENT_GALLERY_REHEARSAL_TOKEN_FILE=/absolute/private/leased-editor-token.txt \
CLIENT_GALLERY_REHEARSAL_OUTPUT=/absolute/private/new-run \
npm run verify:client-gallery-cleanup-rehearsal
```

The shell placeholder `<reviewed-manifest-sha256>` must be replaced with the actual
64-character value before running. At most 18 unique asset uploads, 2 MiB approved
asset bytes, 500 requests, 150 write requests and ten minutes of provider IO are
admitted. Each asset is at most 1 MiB. Reads use the actual parser with a 1 MiB
snapshot, 1,000-document and 2,000-reference cap. There are no upload/mutation retries.
These are rehearsal bounds, not supported large-upload or general account quotas.

Before **each wire write**, a separate private journal file is written exclusively
and fsynced. It records the exact body hash, operation/target/revision metadata and
sequence without tokens or full content. Journal failure blocks that write. Provider
mutation bytes and revision guards pass unchanged through the scope guard. Preparation
and run output stay local; the tool prints only closed counts/status, never raw
exports, records, response bodies, credentials or private filenames.

On success, fresh revision-guarded transactions remove only the exact owned test
records/assets. The final cursor is removed too. A complete fresh snapshot must
equal the frozen provider baseline, and independent all-version Doc reads must find
all 55 owned targets absent. Provider history/backups, cached/downloaded bytes and
credentials are outside this claim. Revoke only separately created temporary
credentials under the reviewed run plan; the tool never revokes anything itself.

## Stop and reconcile

An unexpected result, foreign content, changed baseline, ambiguous provider write,
time/request limit or failed journal stops the run. It does **not** automatically
delete partially set-up data or replay an uncertain operation. The exclusive
private output preserves prior intents and a `stopped.json` readback with exact
remaining ID/type/revision metadata, or marks that readback unavailable. Use the
approved manifest and journals for a separately reviewed recovery action. Never
reset the dataset, delete by prefix, discard an ambiguous control or reuse the run
directory to hide an earlier attempt.

The deterministic suite exercises this orchestration with an offline atomic lake,
including refusal paths and recovery boundaries. That establishes tool behavior,
not real Content Lake semantics. A future authorized run needs its own dated
evidence record; AB#395/392 and other activation gates stay open until accepted.
