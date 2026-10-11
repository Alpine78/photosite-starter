# AB#137 — service overview listing preparation, 2026-10-11

The owner requested that the wedding overview leave the service listing while
its package pages remain available. PR #326 implements the optional
`hideFromListing` field; PR #329 preserves service detail/package navigation.
Both changes are in main `050298c28e97a2594d1902144d99108547e2ff17`.

An independent published read and a complete authenticated raw snapshot show
that the Finnish and English overview documents still have no such field.
The new protected Production candidate therefore still shows that card. This
is a pending CMS activation, not a failed boolean projection or a missing package.
The existing public Vercel alias still serves the older renderer at this check.

## Prepared operation and recovery evidence

At `2026-10-11T12:58:40.819Z`, paginated raw reads and full before/after revision
manifests matched for all **16,945 documents**. A recoverable local snapshot
covers **5,158 asset documents**: 5,148 exactly match the previously verified
asset documents and recovery evidence; ten additional original public-derivative
files were downloaded through the authenticated raw-byte path, matched to their
content-addressed SHA-1 identities and preserved with SHA-256 receipts. The
previous binary recovery archive was rehashed and matched its retained receipt.
This verifies coverage at capture time; no restore exercise or fresh mutation
approval is claimed. Private data and files remain in ignored owner-only storage.

The non-writable private plan proposes exactly two revision-guarded
`set: { hideFromListing: true }` patches. Neither document has a draft/release
variant in the snapshot. Both original documents are preserved; a future rollback
must unset the originally absent field using the **post-write** revision. The
plan contains no usable rollback revision and performs no mutation.

Apply remains gated on reviewed compatible renderer activation, reconciled alias
and release checks, a fresh complete baseline immediately before writing, a
temporary least-privilege credential and one atomic transaction. Follow it with
exact document/unrelated-content verification, genuine Production webhook
delivery, route-facing audit and credential retirement with a 401 check.
Detail routes, children, breadcrumbs, sitemap and contact choices stay available;
prices, parent references and image bytes are outside the proposed patch.
Hosted Studio deployment and editor visibility were not inspected.

AB#137 remains **Active**. Region, preserved-content approval traceability, older
credential disposition and exercised recovery remain separate acceptance work.
No write credential was minted, CMS content changed, asset uploaded/deleted,
renderer activated or DNS record changed in this preparation slice.

Validation: complete stable raw snapshot; prior recovery archive hash; exact
asset-document comparison; ten additional original-byte identity/hash checks;
both published/raw overview reads and draft/release absence checks. Existing
listing filters accept absent/null fields and hide only explicit `true`; route,
sitemap and contact consumers remain independent. No application code changed.
