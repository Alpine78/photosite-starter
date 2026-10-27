# Attach an approved whole-gallery ZIP

`npm run client-gallery:zip` is an owner-run controlled writer for one existing
`clientDeliveryGallery` draft. It verifies an independently uploaded, existing
public Sanity file asset and can attach, replace or detach its `deliveryZip`.
It uploads nothing, changes no asset metadata, creates no draft, publishes
nothing and enables no runtime or cleanup flag. Actual customer runs require
separate authorization; source tests use synthetic local files and a fake provider.

The accepted [future-delivery contract](adr/0035-unlisted-delivery-zip-proposal.md)
permits one intact public ZIP containing explicitly approved processed JPEG
exports and their reviewed embedded metadata. Full-resolution JPEGs stay inside
that package. Separate web previews retain the full frame and are at most 2048 px
on the longest edge. Camera masters, RAW, archive/privateOnly/sales media,
individual full-resolution image assets and public approval manifests remain
excluded. A public ZIP URL is forwardable; page expiry does not revoke its bytes,
provider caches or downloaded copies. The policy decision does not approve a
customer batch or prove supported hundreds-of-megabytes upload transport or
account capacity. Do not split a package to bypass those outstanding gates.

## Prepare the exact private inputs

Use pinned Node 24 on Linux or macOS. All input/evidence files must be untracked
and Git-ignored, or outside Git. Each input file must be a regular file owned by
the current user, mode `600`, with one link; its immediate parent must be owned by
the current user, mode `700`. Every path ancestor must be free of symlinks.
The exports root and each selected file's parent must also be private `700`
directories. Keep sources unchanged throughout each run. The command retains
file descriptors and rechecks file/directory identity, permissions and timestamps
before applying. It refuses reused evidence directories and source/output aliases.

Prepare one closed UTF-8 JSON input file; duplicate keys, unknown keys, BOM,
prototype keys and relative or non-normalized source paths are rejected. This is
a synthetic format example, not permission to upload or publish it:

```json
{
  "target": {
    "projectId": "fixture1",
    "dataset": "production",
    "apiVersion": "v2026-01-01"
  },
  "galleryId": "synthetic-gallery",
  "expectedDraftRevision": "exact-current-draft-revision",
  "expectedExistingZip": null,
  "assetId": "file-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-zip",
  "classification": "processed-jpeg-exports",
  "exportsDirectory": "/private/batch/exports",
  "selectionFile": "/private/batch/selection.tsv",
  "archiveFile": "/private/batch/delivery.zip"
}
```

The target has no ambient project/dataset fallback. Pin a real, non-future Sanity
API date at least `v2025-02-19`: the exact Doc reads explicitly set
`includeAllVersions=false`, whose [documented contract](https://www.sanity.io/docs/http-reference/doc)
requires that API version or later. `galleryId` is the existing base document ID, without `drafts.` or
`versions.`; use its exact current draft revision from a separately authorized
exact-document read. No draft is automatically created. For a published-only
gallery, make an ordinary editorial change in Studio to create a native draft
before obtaining its revision and planning attachment. The operator checks the
closed document type/keys, size, ID, revision and old ZIP reference. It allows
incomplete ordinary draft fields and does not establish ordinary draft readiness
or approve publication; the normal Studio publication validator remains required.

For an addition, `expectedExistingZip` must be `null` and the draft must have no
ZIP. For deliberate replacement, give the exact old canonical file ID. A mismatch
refuses the operation. One strong file reference is the only field written.
A matching current reference can be verified as `already-matching` without a write.

`selection.tsv` uses the existing [whole ZIP builder](../scripts/build-delivery-zip.mts)
selection format and order:

```text
processed-jpeg-selection-v1
export-one.jpg
nested/export-two.jpeg
```

Paths are relative to `exportsDirectory`, with no traversal, duplicate selection,
symlink or hard-link aliases. The existing archive must contain that exact byte
set under neutral sequential names `image-0001.jpg`, `image-0002.jpg`, and so on.
The operator regenerates its own entries manifest from actual source bytes; a
caller-supplied audit receipt is never accepted as authority.

The existing file asset must have canonical `file-<40 lowercase SHA1>-zip` identity,
matching SHA1, ZIP extension/MIME, current revision and positive size. Only the
closed native asset keys are accepted. Authored title/description/label/credit/source
and arbitrary metadata are refused. The native `originalFilename` must be absent
or neutral `delivery.zip` / `photographs.zip`; set neutral names at the separately
authorized upload step. This command cannot repair public asset metadata. It
constructs the canonical own-project CDN URL, ignoring provider URL/path values.

The command reads the existing `SANITY_MIGRATION_TOKEN` environment setting and
rejects any `NEXT_PUBLIC_SANITY_MIGRATION_TOKEN` setting. This documents a source
configuration name, not a claim that a credential has been provisioned. Prepare
credentials through the separately authorized private operator workflow; the
command does not auto-load environment files or accept a token argument. The token
is sent only to the exact project API in an authorization header. CDN verification
is anonymous and sends no credential or Range header. The tool does not reduce the
credential's provider permissions.

## Review the dry run, then apply its exact digest

The default performs authenticated exact Doc reads and a complete anonymous CDN
read, but no mutation. Choose a fresh output directory under an existing private
`700` parent, outside the exports tree:

```bash
npm run client-gallery:zip -- --input /private/batch/input.json --output /private/evidence/zip-plan
```

It actually decodes every selected JPEG with Sharp, inventories opaque JPEG
metadata envelopes, generates `entries.tsv`, checks the entire archive and its
entry hashes/CRC32/set, and reads the complete remote archive to verify bytes,
SHA1 and SHA256. All local handles are guarded through the apply boundary.
Private `600` reports are created in an exclusive `700` directory:

- `decoded.json`, `metadata.json`, `entries.tsv`: regenerated selected-source evidence.
- `container.json`, `remote.json`: whole-archive/set and complete remote-byte evidence.
- `plan.json`, `result.json`: bound plan and classified outcome.
- `intent.json`: apply-only, fsynced with its directory before the single patch attempt.

Inspect the actual processed exports and embedded metadata with your chosen
external review tools, as well as the generated bundle. The metadata report
contains category/count information, not parsed metadata values, and does not
establish suitability even if it reports zero counts. JPEG decode does not prove
processed-export provenance. The input classification and approved digest are
owner assertions tied to exact evidence, not software proof of human judgment.
Keep review evidence private; no approval manifest or certificate enters Sanity.

Stdout contains only state, digest, counts and mutation/outcome indicators.
The deterministic digest binds the domain/schema/tool version, normalized input,
generated report digests, complete local archive hash, target draft revision,
old/new ZIP IDs, fresh file revision/document hash and expected complete authored
post-patch hash. No timestamp is part of the plan. After actual owner review,
re-run using a new evidence directory and that exact digest:

```bash
npm run client-gallery:zip -- --input /private/batch/input.json --output /private/evidence/zip-apply --apply --approved-digest <64-lowercase-hex-digest>
```

Apply rebuilds the entire bundle and refuses digest drift. Immediately before the
write it freshly rereads the exact draft and new file metadata, rechecks local
inputs/evidence, and persists the private intent. It sends exactly one
[`ifRevisionID` patch](https://www.sanity.io/docs/http-reference/mutation) to the draft,
setting only `deliveryZip`. There is no query
mutation, publication, source replacement, asset write/delete or automatic retry.
The existing published gallery stays as it was until a separate reviewed publish.
The draft CAS does not lock the asset revision; later publication/runtime checks
independently validate fresh file metadata. Provider reference behavior and the
hosted workflow remain separate verification gates.

Studio displays a read-only technical ZIP field. This workflow and that UI are
not a dataset ACL: a direct writer can forge a reference or bypass the command.
The runtime checks fresh technical compatibility but cannot cryptographically
prove this private approval procedure was used.

## Detach and reconcile

For reversible draft-only detachment, supply only `target`, `galleryId`,
`expectedDraftRevision`, the exact non-null `expectedExistingZip`, and
`"assetId": null`. Omit classification and all source paths. Dry-run and explicit
digest approval work in the same way; apply unsets only `deliveryZip`, without
source audits, CDN reads, asset deletion or publication. A wrong old reference
refuses detachment. A replaced or detached ZIP becomes unlinked only after later
publication; its removal needs a separate manual review of every shared use.
There is no orphan-file sweep.

Every attempted write has one independent exact-draft readback with a fresh short
budget, including after cancellation or a lost response. Outcomes mean:

- `observed`: the complete expected authored draft state was observed.
- `not-observed`: the original revision/content was observed; a late commit can
  still occur. This is not proof that the request stopped.
- `uncertain`: state was missing, unreadable, mixed or concurrently changed.

`not-observed` and `uncertain` exit unsuccessfully. Preserve the intent/result;
inspect a fresh exact document and provider history through a separately
authorized read before preparing any newly reviewed operation. Never resend a
mutation blindly. `observed` establishes draft content, not publication, durable
asset metadata, upload feasibility or a global transaction over the asset.
There is no separate replay/retry command. A changed draft revision requires a
new input, rebuilt plan and approval.

The local engineering profile is at most 256 JPEGs, 25 MB per JPEG, 100 MP per
decoded JPEG, and 1 GB archive/expanded set. These are tool budgets, not product or
provider upload limits. Audit phases and the anonymous remote phase are bounded
by the existing 330-second caps. The operation checks a 20-minute monotonic
deadline cooperatively between bounded operations and each file guard; a running
filesystem/git check finishes before observing cancellation. This is not a
hard-killable filesystem deadline. API attempts have 20 seconds, and post-write
readback a separate 20-second budget. Actual
production-scale decode/transport throughput is not established by tiny source
fixtures. Timeout never grants permission to split, omit, upload or publish.

After a later reviewed publication, ZIP addition/change/removal requires renewed
[cleanup enrollment consent](client-gallery-cleanup.md). An old image-only
approval must not remove images/gallery while stranding its new ZIP. Keep the
existing runtime/cleanup flags off until the separate operational acceptance.
