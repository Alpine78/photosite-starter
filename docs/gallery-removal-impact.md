# Inventory gallery removal impact without deleting anything

AB#326 provides a local observed-reference inventory before a separately
reviewed removal operation. It performs no CMS request or mutation. Every report
always has `readyToDelete: false` and `readyToWrite: false`, including a report
that observes no other referrers.

Supply three owner-private files. The snapshot is raw document NDJSON containing
all documents, including drafts, release versions and asset documents. Every
record needs its exact `_id`, `_rev` and `_type`. The evidence file binds the
exact raw snapshot bytes and record count:

```json
{
  "version": 1,
  "snapshotSha256": "<SHA256 of the exact raw snapshot file>",
  "documentCount": 123,
  "scope": "all-documents-including-drafts-and-releases",
  "collection": "owner-attested-unfiltered",
  "capturedAt": "2026-10-17T00:00:00.000Z"
}
```

This is an **owner attestation**, not an independent proof that a provider export
is complete or atomically consistent. A filtered export cannot become complete
merely by changing this declaration. A later actual removal needs fresh live
revision/reference checks and separate authorization. Absence from this snapshot
never proves an asset is unused.

The private intent file selects one exact published gallery revision:

```json
{
  "version": 1,
  "galleryId": "gallery-example",
  "expectedRevision": "exactCurrentRevision"
}
```

Only `clientDeliveryGallery` and `legacyDeliveryGallery` are inventory targets.
A missing published record, a changed revision or invalid evidence is refused.
The intent file keeps identifiers out of command arguments and shell history:

```bash
node scripts/inventory-gallery-removal.mts \
  --snapshot /private/work/raw-documents.ndjson \
  --evidence /private/work/snapshot-evidence.json \
  --intent /private/work/removal-intent.json \
  --out /private/work/removal-inventory
```

Inputs must be owner-owned `0600` regular single-link files in `0700` private
directories, without symlink path components. In a Git checkout they must be
ignored and untracked. The output parent must already be private and the output
directory must not exist. A held descriptor/current-path check binds each input
through report completion. Local reads/writes are at most 64 KiB per operation.

The private `impact.json` contains a hash-covered report and `reportSha256`:

- Selected published/draft/release gallery record identities and revisions.
- For legacy galleries, image-record variants whose actual `gallery` reference
  belongs to this gallery. Both image and original-file asset references count.
- Image/file asset identities and every structured inbound reference observed
  anywhere in the snapshot, including weak refs, other types, drafts and releases.
- Missing/malformed references, asset-kind disagreement, cross-dataset refs,
  possible unstructured asset mentions and untraversed non-gallery links.
- Explicit completeness, cache, known-URL, downloaded-copy and no-write notices.

The inventory expands only gallery-owned record types. It does not follow a
category/navigation/content link through the whole site. Records with unknown
relationships remain limitations. String mentions of asset IDs or Sanity CDN
URLs are counted as possible unstructured references; they are not a complete
scanner for every URL encoding, external system or reference convention.

Output preserves exact private document IDs/revisions but omits authored titles,
metadata and arbitrary field values. IDs themselves may encode a customer or
unlisted link: treat the report as sensitive. Console output contains only fixed
status, counts, hashes and false readiness flags. Error messages use closed codes.
Exit zero means the inventory was written, even when it lists blockers; it never
means deletion is approved. `verifyRemovalInventory` is a library-only helper
that regenerates and compares the exact hash-bound report; it is no live check.

Limits are 128 MiB raw input, 100,000 records, 8 MiB per record, five million JSON
nodes, depth 64 and 64 MiB report. Duplicate decoded JSON keys/record IDs, invalid
UTF-8, BOM and interior blank lines are refused; LF/CRLF and one final newline
are supported. Parsed authored bodies are discarded after minimal reference
summaries are collected. The raw bytes and bounded record lines remain local.

Handled failures/interrupts clean only identity-matching output created by this
invocation; unrelated or replaced files/directories are retained. SIGKILL can
leave incomplete evidence. Filesystem check/unlink calls are not transactional,
so use a private workspace without concurrent writers.

Unpublishing/removing a page does not revoke public image/ZIP URLs, provider
caches or downloaded copies. Legacy deadlines/links, privateOnly/sales boundaries
and all source bytes stay unchanged. No deletion plan, live credentials, service,
provider guarantee, new public-file exception or parent-story closure is implied.

The report also lists exact inbound references to the selected gallery page and
its draft/release variants, including missing variants and weak/custom-document
references. References from other records raise a blocker; the selected legacy
image records are identified separately. An asset document's native top-level
`url` is its own storage locator and is excluded from the unstructured-use count.
Authored URLs elsewhere and nested metadata strings remain possible mentions.
