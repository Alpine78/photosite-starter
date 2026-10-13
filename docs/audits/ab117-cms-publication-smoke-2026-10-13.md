# AB#117 — CMS publication operator preparation, 2026-10-13

Status: guarded operator and private review packet prepared. AB#117 remains Active.
The source branch starts at main `f58be98`, then incorporates merged #376 at
`94c9816`. Open #370/#371 cover Studio wording and #377 covers bilingual release
preparation. This slice changes no Studio, alias
settings, public route, schema or application cache boundary.

The [publication command](../cache-revalidation.md#approved-one-field-publication-check-ab117)
prepares an offline one-field home-intro marker plan, verifies an approved live
source/recovery binding, durably journals before one revision-guarded patch, and
reads back every content field. It separately restores the exact intro using the
observed post-write revision; concurrent edits refuse both phases. Uncertain
writes can be reconciled read-only; no retry or automatic restoration is implied.

## Actual read-only evidence

The current authenticated read finds exactly one raw home source and supplies a
concrete private FI intro proposal. A fresh complete raw dataset capture has
17,609 documents and 5,158 assets. Its identity/revision/type manifest matched the
before scan, after scan and a final recheck after backup verification. Current
asset documents match the preserved complete prior asset inventory.

The existing before-service-price archive covering 5,145 assets was rehashed to
its previously verified digest. All 13 later original additions were found in
the preserved checkout, rehashed against their size/SHA-256 receipts, copied into
this worktree's private recovery packet and reverified. The new raw snapshot and
asset manifest are hash-bound; old receipts and archives are preserved. These
steps establish current local material coverage, not an exercised full dataset
restore, independent provider permission audit or customer handoff.

The CLI compiled the real private plan and its default apply as `plan-only`.
The initial source-only packet retained explicit false recovery flags; the
verified current packet is a separate artifact, never an overwritten receipt.
No CMS write, asset upload, new writer credential or revalidation request occurred.
No new hook attempt or visible publication success is claimed.

## Remaining exact operation

Review the original/proposed intro, target, source revision, baseline evidence,
selected serving deployment and frozen approval digest. The actual one-field
apply/restore and any temporary writer require exact owner approval. Then bind
real hook attempts and visible marker/original-text observations to that deployment
for each operation; preserve failures and revoke/verify any temporary writer.
Current source or broader baseline drift requires reconciliation before a new
approval, and an ambiguous write requires observation before any next mutation.

The operator preserves every asset reference and other language. It does not
publish English drafts, prepare customer ZIPs, remove historical content, promote
an artifact, modify DNS or complete the remaining AB#117/18/118/250 gates.

## Validation

Deterministic tests cover malformed/oversized plans, source/digest changes, recovery
bindings, draft/release collisions, unrelated and concurrent edits, durable-journal
failure (including final-receipt failure after the write), lost acknowledgements,
ambiguous readback, exact restoration, private
inputs/outputs and mocked end-to-end CLI apply/restore/read-only reconciliation.
The private capsule and backup evidence are ignored and cannot enter CI artifacts.
Final lint/unit/build results accompany the PR; live publication remains unperformed.
