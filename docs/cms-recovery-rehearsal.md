# Local CMS and original-asset recovery (AB#267)

`npm run rehearse:cms-recovery` streams an existing official Sanity export (plain
or the retained wrapped backup) and separately preserved additions into a **new
owner-private directory**. It performs no network request or CMS/provider write.
It never uses archive extraction: member names are validated lookup keys and output
filenames are derived solely from validated asset identities.

Prepare a complete raw snapshot with stable full revision manifests before/after
capture. The private manifest shape is:

```json
{
  "archivePath": "/private/backup.tar.gz",
  "archiveSha256": "<64-character-sha256>",
  "assetDocuments": ["<complete current asset document objects>"],
  "originalAdditions": [
    {"assetId": "<asset-document-id>", "path": "/private/original", "bytes": 123, "sha256": "<64-character-sha256>"}
  ]
}
```

The example placeholders must be replaced by real asset objects and frozen hashes.
Include all current raw asset documents, without projecting away identity, `size`,
`sha1hash` or `extension`. Additional originals must be absent from the archive;
archive/addition overlap is rejected. A stale snapshot can still be restored offline,
but does not prove current production state or complete dataset capture.

```sh
mkdir -m 700 temp/recovery
# Snapshot and manifest are regular, nonlinked, single-link mode-600 files.
npm run rehearse:cms-recovery -- \
  --manifest temp/recovery/assets.json --snapshot temp/recovery/raw.ndjson \
  --snapshot-sha256 <frozen-snapshot-sha256> --out temp/recovery/run-1
```

The output parent must be owned and not writable by others, and the new directory
must be ignored by Git. Output directories use 700, files 600 and exclusive creation;
existing evidence is never overwritten. Inputs remain unchanged. The command needs
Unix ownership/mode support, the pinned Node major and enough disk for all assets.
Metadata/snapshot input is bounded to 256 MiB, each raw line to 4 MiB, raw documents
and archive entries to 100,000, assets to 50,000, each asset to 8 GiB and aggregate
asset/archive payload to 256 GiB. PAX metadata and decompression ratio are bounded.
Symlinks, hardlinks, devices, traversal, duplicate or unexpected members, mismatched
sizes/hashes and missing coverage refuse the run. A plain export has one root,
`data.ndjson`, `assets.json`, and `images`/`files`; the wrapped form has exactly the
recognized backup metadata plus `sanity-export.tar.gz`. The archived old document
snapshot is preserved in the input archive; recovery writes the separately supplied
current snapshot, retaining every document and revision byte for byte.

Archive SHA-256 is checked before recovery and again while reading its same opened
file. Asset size and SHA-1 must match the raw snapshot and manifest identity;
separate originals also match their frozen SHA-256. Every output asset and snapshot
is then rehashed from disk. The private completed receipt binds archive, manifest
and snapshot SHA-256 and lists output asset hashes. Stdout contains aggregates only.
Failure leaves partial private output for inspection and creates no completed receipt;
inspect it before owner-authorized cleanup. Never reuse the failed output directory.

The restored directory is an offline byte recovery set, **not an executable Sanity
import package or evidence that a provider restore succeeded**. It cannot recreate
accounts, permissions, webhooks, environment settings, DNS or lost credentials.
A complete capture manifest, owner inventory, controlled provider restore and
post-promotion rollback/handoff remain separate gates in
[the rollback record](rollback-exercise-record.md).

`tar@7.5.22` is explicitly declared as a development dependency because correct
streaming TAR/PAX/gzip parsing is required for multi-gigabyte nested archives. It was
already present transitively at this exact version; no application imports it.
Only `Parser` is used, never `Unpack` or extraction. Asset member naming is checked
against the pinned `@sanity/export` `AssetHandler.generateFilename` implementation.
See [the real local exercise](audits/ab267-cms-recovery-rehearsal-2026-10-13.md).
