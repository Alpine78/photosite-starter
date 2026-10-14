# AB#279 — approved English article publication, 2026-10-13

The approved eighteen-article operation completed at **22:26:11 EEST**
(19:26:11 UTC). All eighteen atomic article/placement batches passed provider dry run,
were submitted once and passed exact readback. They created eighteen published English
articles and 644 English end-gallery placements and deleted their 662 editing drafts.
Published article counts now match: **28 Finnish and 28 English**.

## Immutable authorization and execution

The owner explicitly accepted the concrete private operation description SHA-256
`ccc9857ade1e5559d51aedd153f0f9294a60535b937af54012d5f0bc55a90b3f`.
It follows [the actual preparation](ab276-actual-article-publication-plan-2026-10-13.md),
not the earlier copy/draft-creation acceptance alone. The exact target and all eighteen
transactions retained scope SHA-256
`582ad7fd97e81a35f767bf33cac3b02e9519188769db2e44d956f4984922138d`:
2,648 mutations, largest batch 344, with all original source/draft/category bindings
and revisions unchanged. No new translation or image text was generated. The accepted
23 poll-block omissions from sixteen English articles remain omissions; Finnish
articles, polls and votes retain their original authored content.

The frozen pre-credential raw snapshot still matched its reviewed SHA-256. Exactly
one temporary native Editor was created. The authenticated `identity()` matched only
its additions to the existing Editor/write system groups; all other group fields and
memberships were guarded. Only those credential-related system revisions/metadata
rebound the snapshot and full-plan digests. Final execution plan digest:
`4f5790bdc3dee744dfebbd1c166211c0363b90d3aa1bfebffbfeaba09e70868c`.

Before any provider dry run, a new complete raw capture covered 17,614 documents and
5,158 assets. The local recovery operator restored and rehashed all 5,158 asset files
(2,436,624,774 bytes), thirteen preserved additions and the current document sidecar.
Its snapshot SHA-256 was
`89e203033d42567c54dd039291eeed969b8c6a48f1e031efd46e2ebb36b7baf1`.
Independent before/after full revision manifests established capture completeness.
Recovery established local byte recovery, not a provider restore or deployment rollback.

All eighteen dry runs completed before the first actual write; a repeated complete
live revision manifest still matched. Each content submission had a private intent
record before the POST and a per-batch readback receipt. There were eighteen actual
submission attempts, no automatic resend, failure, partial-publication retry or rollback.
The whole operation spans eighteen transactions, not one globally atomic transaction.

## Whole dataset and credential cleanup

A complete post-write comparison found precisely the planned strict creates, draft
deletions and revision-bound Finnish language/order guards. Finnish authored content,
all 5,158 asset documents, shared media, categories, polls/votes and unrelated authored
documents and revisions were unchanged. The document total remains 17,614 because
662 creates replaced 662 removed drafts. This does not imply that every unrelated
editing draft in the dataset was deleted.

The temporary Editor was deleted in `finally`. Its metadata returned **404**, reuse
of its token returned **401**, other robot identities were unchanged, original system
group memberships were restored, and the existing Viewer read still succeeded.
The local secret creation response was removed after those proofs. Final stable raw
snapshot SHA-256:
`c2cd3b61002c1b47af051001a9ca01723ab53087e2eaa995bbf4783415ef9f80`.

Private receipts, raw content, plan, recovered assets and operational helper remain
mode 0600 within ignored mode-0700 directories. Receipt hashes bind the retained evidence:

| Receipt | SHA-256 |
| --- | --- |
| Publication | `7622ac9f9aea4b16519482505a83cc4553bdf838714980edda039107a7a36b51` |
| Whole dataset audit | `df07d0cacea82df53df64ece22118abd1474b7af9e3ea2f7801dfc3ee5d24e57` |
| Writer revocation | `f16ba0d6dfe1dcb46d39efd58e1a0bac4496a99a1b4440d6bc69fe042a0b34f3` |
| Completion | `3ce20fa47204510a371a41be16349dd7723d9d9de6f89100c32966fba5445df8` |
| Current local recovery | `f3474077b76fe9600e9d8826ad283d2f900e9066aca25f31668367d24e66f01f` |
| Local public routes/gallery pagination | `92aef5c04f8ba4788ef2e249d1ea68ccea55dd791f1c3d3687045c303883a386` |
| Current protected Preview observation | `364928a90410413b1d223847435e247acd02a3045fd9d7ca9d7314d458a72a3a` |

## Actual route and adapter verification

A production build of merged `4ba77a1`, reading actual Production content, passed.
Browser checks without JavaScript verified **all eighteen new English article routes**:
HTTP 200, exact accepted heading, requested English language, canonical, real Finnish
hreflang counterpart and sitemap inclusion. Their end galleries were walked through
**39 bounded pages**, covering all **644 placements** with no missing/duplicate placement.
Each continuation retained the first-article canonical, noindex and absence of hreflang.
Third-party browser requests were blocked; this is not an image-download/visual-quality
or final hosted-deployment proof.

`/en/stories/blog` now returns **200**, has the reviewed Blog heading/canonical and
Finnish alternate `/tarinat/blogi`. The existing live adapter smoke suite also passed
all four checks against Production, including representative per-locale route-facing
adapters and bounded gallery cursor continuation.

An independent fresh ownership/source/protection check of CI 941's exact Preview
`dpl_7RcgpqJvVEKC28QUcGtyGqTLDoPE` still passed for clean source `c32d1e8`.
Its authorized `/en/stories/blog` probe now returns **200/noindex**, compared with
the earlier pre-publication **404/noindex**. This establishes current hosted response
availability, not a complete hosted article/body/image audit or a replay of the native
webhook delivery test. Protection remains enabled; no deployment or alias was mutated.

The executed publication/recovery/read modules are byte-identical to main `c32d1e8`,
whose full CI 941 passed. The later #386/#387 integration did not change those modules.
During verification, the owner merged preparation/evidence #388–#390; this branch
fast-forwarded to `8932116`, whose intervening changes are documentation only. Actual
rendering proof remains bound to the tested runtime above, not an arbitrary later source.
Offline helper boundary checks accepted the exact intended delta and rejected unrelated
asset/Finnish-copy changes, missing documents, retained deleted drafts, grant changes,
credential escalation and existing-member removal. No new application code or dependency
is introduced by this evidence PR.

## Status and remaining gates

Merged preparation tasks AB#276, AB#277 and AB#278 are verified Closed. AB#279 remains
Active pending evidence PR review/merge. Parent AB#137, AB#255 and final launch/security
stories stay open. AB#280 separately promotes the old `/en/blog` fallback to this now
available exact canonical; this evidence branch changes no redirect row.

Whole-ZIP support confirmation, retained customer-gallery import/usage proof, the final
integrated candidate and deployed 415-URL verification, contact/cache acceptance on that
exact version, actual rollback/handoff and final security/privacy acceptance remain
separate. No asset upload, ZIP import, DNS change, Production promotion, new contact
delivery or final launch acceptance occurred.
