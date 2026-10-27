# Expiry cleanup candidate planner (AB#394)

`src/lib/client-gallery-retention.ts` is a pure, server-only decision module for
AB#392, consumed by the default-off cleanup worker. It performs no I/O and returns **candidates**,
never executable mutations; every result has `readyToDelete: false` and
`readyToWrite: false`. Automatic deletion is **not implemented by this slice**.
AB#395 owns the executor, authenticated scheduling, enrollment storage and activation.
No credential, provider, schema field, cron or public journey changes here.

## Classification

`classifyClientGalleryExpiry(gallery, enrollment, now)` requires a valid clock and a
published new-delivery identity/revision first. Legacy/proof/other types are refused.
Missing enrollment skips before parsing further content or requiring asset evidence.
Enrollment is the provisional `{galleryId, revision}` evidence for this planning pass;
a mismatch **blocks for re-planning**, rather than silently skipping a gallery forever.
It is not a proposed persistent enrollment schema or permission check.

An enrolled record uses `parseClientGallery`, the public reader's current closed
document and web-derivative contract. Future fields therefore block conservatively
until both contracts change deliberately. Indefinite availability skips; a leftover
deadline in indefinite mode or a malformed finite deadline blocks, as it does in the
reader. Future deadlines skip. At `now >= expiryInstant`, the gallery qualifies even
when paused: pause affects access, not retention. Titles and handles never enter the
result. The caller must supply a trustworthy **server** clock; this pure function
cannot establish time, authentication or read freshness.

## Planning evidence

`planClientGalleryCleanup({gallery, enrollment, now, evidence, zipReference?})` runs
the same classification before examining evidence. An eligible gallery requires:

```text
evidence = {
  galleryId, revision,
  variants: { complete: true, ids: [the exact published gallery ID] },
  assetsComplete: true,
  assets: [{
    id, revision, type,
    complete: true, referenceCount,
    referrers: [{ id, revision }, ...]
  }, ...]
}
```

This is a **provisional normalized input contract**, not a Sanity HTTP response or
CMS schema. Completeness flags mean the caller claims exhaustive coverage, including
drafts/releases; the planner cannot prove that claim. An adapter must not set them from
a lagging query index alone. Known draft/release variants block this first slice.
The executor must resolve the race where a variant appears after an absence check.

Every owned image asset and optional whole ZIP must occur exactly once in evidence with its current revision
and matching asset type. Repeated gallery uses deduplicate, preserving their item keys
in `references`. A missing or unreadable asset blocks; absence is never guessed.
Each asset's referrer list must include the exact gallery ID and revision. All other
full IDs count as shared uses, including `drafts.<id>`, `versions.<release>.<id>`,
portfolio and proof documents, and weak references. Shared assets go into `shared`,
never `candidates`. A referrer count mismatch, duplicate referrer, incomplete flag,
or a list reaching 100 entries blocks; adapters must paginate to exhaustion or refuse.
Up to 256 gallery images and 257 unique assets (including a whole ZIP) are admitted.
Evidence arrays must be dense; extra fields, non-plain objects and accessors are refused.

AB#407 binds the optional ZIP to the gallery's actual native `deliveryZip` field,
shaped as `{_type: "file", asset: {_type: "reference", _ref: "file-<sha1>-zip"}}`.
The optional `zipReference` argument, if supplied, must match that field; it cannot
nominate an additional asset. Both paths require the same complete typed file evidence.
The worker checks fresh technical ZIP metadata independently before planning; the
planner neither proves the private attachment audit was used nor authorizes upload.
Legacy ZIPs still need their own manifest/batch adapter.

Candidate output contains exact gallery/asset revisions, recognized item keys, one
optional ZIP location, deterministic candidate/shared ordering and counts. It omits
authored text, filenames, URLs, handles, customer data and referrer identities. Identity
fields remain internal evidence; only `counts` and closed reason codes are suitable for
routine logs. No ID is a permission credential, and no result belongs in a public API.

## Executor requirements still open (AB#395)

- Store enrollment separately from this pass's revision guard; an unrelated edit must
  cause re-planning, not silently defeat automatic retention. Receiving a deadline
  default alone does not enroll an existing gallery.
- Read current documents and complete variants/references with authenticated adapters,
  then guard the gallery and assets at their observed revisions. Queries are eventually
  consistent; an attested list is insufficient authority for deletion.
- Remove owned references before deleting files, in a guarded operation. Select whether
  the gallery itself is deleted or reduced to an inert record, and define an already-clean
  reconciliation state; this planner intentionally accepts only today's valid galleries.
- Keep shared assets. Strong references can reject a racing asset deletion atomically;
  concurrent weak uses need their own resolved safety boundary before activation.
- Make bounded progress past blocked galleries, expose failures, reconcile uncertain
  commits without blind retries, and verify roles/synthetic deletion in the hosted system.
- Keep legacy/indefinite galleries and proof private-record retention outside this
  adapter. A redirected proof does not acquire a new deletion rule by implication.
- Document scheduling and customer privacy wording before deliberate activation.
  Provider caches, downloaded copies, document history, backups and sent mail are not
  erased by ordinary deletion.

No instruction here authorizes a live write, file deletion, upload or activation.
The separate creation-default slice is AB#393; this branch does not depend on it.

## Executor integration — 2026-10-24 (AB#397–398)

The [default-off worker](client-gallery-cleanup.md) now consumes this planner.
Private persistent approval binds the reviewed retention policy; each attempt
independently validates the full fresh gallery and constructs this module's
`{galleryId, revision}` evidence at the **current** source revision. Text-only
edits do not silently withdraw consent. A changed policy requires Studio review.
The executor deletes the complete expired gallery, asserts draft absence and
guards current assets in one transaction with its private completion receipt.
It never executes this module's output without that fresh evidence and control
revision fence. The pure API remains decision evidence, not deletion authority;
AB#407 separately supplies the actual schema/reader ZIP field and worker binding.
All hosted provider/role/concurrency checks and deliberate activation remain open.

## Whole-ZIP integration — 2026-10-26 (AB#407)

The current worker includes the actual optional ZIP in the approved asset set,
checks its fresh file identity/revision and uses this planner in the same atomic
gallery/image/ZIP deletion. Shared ZIPs are retained, with typed receipt evidence
and closed `sharedZips` counts. Missing evidence blocks the entire unit; no old
image-only approval can authorize deletion while leaving a new ZIP behind. Existing
image-only v1 serialization remains compatible. See the [current protocol](client-gallery-cleanup.md)
and [verified attachment procedure](client-gallery-zip.md). Source fixtures do not
replace role/provider/race/hosted acceptance or activate cleanup.
