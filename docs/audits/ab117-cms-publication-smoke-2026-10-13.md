# AB#117 — CMS publication and one-field restoration, 2026-10-13

Status: owner-approved live publication, visible update and exact one-field
restoration verified on the existing Production alias. AB#117 remains Active.

This branch starts at main `f58be98` and incorporates merged #376/#371/#377
through `f657891`. Git merge-tree checks found no conflict with the concurrent
Studio/bilingual patches. The change adds an operator; it changes no application
route, Studio schema, alias settings or cache boundary.

## Guarded operator

The [publication command](../cache-revalidation.md#approved-one-field-publication-check-ab117)
binds one existing home translation in `intro` or explicitly selected
`photographerIntroduction.text` to the complete source, revision, recovery
material and owner approval digest. It preserves all other fields, translations
and asset references. A separate immutable prepared receipt, fsynced with its
directory, precedes one revision-guarded patch. Complete-content readback checks
the result. Restoration requires the observed post-write revision; subsequent
editor changes refuse it. Uncertain outcomes have read-only reconciliation and
no automatic second write. CLI receipts alone never claim external delivery.

## Recovery material and preflight

The stable authenticated raw capture contains 17,609 documents and 5,158 assets;
identity/revision/type manifests matched before, after and following verification.
Asset documents match the preserved inventory. The existing archive covering
5,145 assets was rehashed to its verified digest. Thirteen later original additions
were rehashed, copied into this worktree's private packet and reverified. Snapshot
and asset-manifest hashes are bound to the plan. This verifies material coverage;
a full dataset restore and independent off-machine recovery were not exercised.

The initial approved intro plan failed browser preflight: the current home layout
shows the photographer introduction instead. No credential or CMS write occurred.
The owner then approved the replacement visible-field digest and restoration;
the prior temporary-writer authorization remained valid. Both plans and the failed
preflight are retained. No content selection or translation was inferred.

Two credential-creation calls returned 403 and created no robot; the captured
second refusal states `Cannot skip token notification`. Existing token IDs and
source revisions were unchanged. Normal creation succeeded with the provider's
mandatory owner notification. Exactly one temporary Editor credential was created,
with a one-hour expiry; its secret stayed in process memory and child environment.
No existing credential was rotated or deleted.

## Live result (UTC)

- **13:17:36:** one guarded update appended the synthetic marker to the existing FI
  photographer-introduction text. Raw readback matched every proposed content field.
- **13:17:45:** Chromium observed the marker as visible on the public home page.
  Fresh genuine Production and Preview hook messages each had an accepted HTTP 200
  attempt for the exact home identity and update operation.
- **13:17:48:** one guarded restoration used the observed apply revision and restored
  the original localized text. No concurrent revision or content drift occurred.
- **13:17:49:** Chromium observed the original text with the marker absent. Separate
  genuine Production and Preview hook messages each had an accepted HTTP 200 attempt.

| Event | Production acknowledgement correlation | Preview acknowledgement correlation |
| --- | --- | --- |
| Apply | `2760f0d6-3168-441e-a749-83f981adfaba` | `1212cb17-cfe8-4242-82ba-e78e4b2b9424` |
| Restore | `e0c1836e-908f-4c97-a85a-3cd8a443f91f` | `f28fadfc-f5d4-4ae1-881a-69d6c22466d4` |

The temporary credential was deleted, absent from the token list, and its key
returned HTTP 401. All six preceding token IDs remained. Post-exercise raw audit
at 13:19:08 confirms the same 17,609 identities/types and 5,158 assets. The home
content is exactly original; only its revision/update time changed. Eleven system
groups also changed revision/update time through credential lifecycle, with every
content/permission/member field restored. All other document revisions are
unchanged, and the final manifest recheck is stable.

Private immutable plans, approvals, prepared/final receipts, genuine hook
messages/attempts, browser screenshots and post-audit evidence remain in the
ignored owner-only packet. No fabricated webhook or manual cache recovery was
used. The same provider deployment/project/team/source served before and after.

## Limits and remaining launch gates

This proves the current serving chain. Its existing provider source is `14b1af0`
with `gitDirty: 1`; it is not a newly accepted immutable launch artifact. The final
release candidate and canonical-domain behavior still need their own verification.
No deployment promotion or DNS change occurred. Full backup restoration, ownership
handoff, retained customer ZIP transport/import and final security/privacy
acceptance remain separate. AB#117/18/137/250 remain Active.

## Validation

After integrating #376/#371/#377 and the visible-field correction: lint,
TypeScript, all 250 browser-free files / 5,939 tests (34 new focused cases),
synthetic mock production build, three diagrams, documentation links and diff
checks passed. Studio dependencies were installed before rerunning its added tests;
the earlier missing-dependency failure is retained. Public journeys are unchanged
and were not rerun locally; full CI remains required. No security finding remains
in the changed operator; older credential disposition, the existing moderate
Studio advisory and the broader launch acceptance are not resolved by this probe.
