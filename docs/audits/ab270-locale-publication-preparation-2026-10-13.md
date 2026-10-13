# AB#270 — guarded locale publication preparation, 2026-10-13

## Owner continuation: copy accepted with two pricing additions

The owner accepted the six-item workbook below with one specific addition: two funeral
service pricing options in Finnish and English. Existing pricing rows, starting price,
descriptions, identifiers, slugs and media remain unchanged. The exact requested additions
and translations are retained in the private packet and updated review workbook. Its
SHA-256 is `8b933436af828518e1c11499508df5900fe7f7b823689cb74d049db01db46c3a`.
The private approval record binds the prior accepted workbook and the owner's requested
delta. This is editorial acceptance, not acceptance of an unreviewed mutation plan.

The planner now accepts only additive source pricing rows and requires their keys/prices
to match the reviewed English target. Source revision guards and exact post-write source
readback remain mandatory; no source text replacement is enabled. A new stable complete
raw scan at 17:12:41 UTC still matches the recoverable snapshot hash below. The resulting
category/service plan preserves the other approved text and remains an offline plan.
No CMS write or temporary credential creation has occurred. The final operator approval,
provider validation, publication, full-dataset audit and writer revocation remain separate.

Validation after integrating merged #382: lint, 6,058 browser-free tests, TypeScript and
synthetic production build. New tests cover append-only preservation, key/price mismatch,
duplicate source keys and rejection of unrelated post-write source edits. AB#270 remains
Active; the earlier preparation notes below retain their original pre-acceptance context.

## Initial preparation

The owner requested remaining launch work in separate published worktrees after merging
#378–#381. AB#270 is Active under AB#255. This change provides the offline planner and
explicitly approved owner-run publication operator; no CMS mutation or launch acceptance
is claimed.

A stable raw Production read at 15:43:02 UTC captured 17,609 documents and 5,158 assets.
Its SHA-256 matches the existing complete local recovery baseline. The eighteen English
article editing drafts still match their accepted proposal text after the previously
accepted poll omission. All 644 translated article end-gallery placement drafts retain
the source placement/media/order/visibility and have no pending text fields. Their eighteen
article batches would create 662 published documents and remove 662 editing drafts.
Those are scenario counts, not a publication receipt: the real article planner correctly
refuses while the English canonical Blog category is missing.

The one category and five missing English service variants remain unpublished. Fresh source
revisions and projected authored fields still match the private six-item proposal packet.
The compact owner review workbook has SHA-256
`9559e28e471cca710c44d4dc2ab4cbb411f6f60665fed058e87485b3ae110b97`.
The owner has been asked to accept its English prose, prices and URL parts; acceptance has
not arrived. Private source documents and proposed copy are not included in this repository.
The real category/service plan contains one guarded category patch and five strict service
creates; it is prepared, not accepted or applied.

[The operation guide](../locale-publication.md) specifies private files, exact input/plan
binding, complete raw baseline and recovery coverage, default provider dry run, revision
guards, atomic article/placement publication, readback and interruption reconciliation.
It also states that no-op Finnish guards can advance provider revisions, a recovery receipt
is not a provider restore rehearsal, and full-dataset audit/writer revocation remain separate.
No new dependency, asset transport, paid service, deployment, email or DNS operation is added.

Security review covered the rebuilt-mutation boundary, token-only environment input,
closed reviewed fields, preexisting targets, stale sources, bounded read/request sizes,
private output and failure evidence. No independent Claude review is claimed. Tests cover
malformed and stale content, unreviewed placements, missing category language, atomic placement
sets, exact approval before IO, CLI tampering/recovery refusal, ambiguous writes, content
readback drift and streamed-response limits. Validation: lint, complete browser-free tests,
TypeScript and the synthetic production build; provider validation/publication awaits the
concrete approved operation. Final-head CI remains authoritative for integration.
