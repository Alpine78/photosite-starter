# AB#274 — approved category/service publication, 2026-10-13

The owner-approved category/service operation completed against the first site's
Production dataset at 18:09:37 UTC. The provider accepted one atomic batch of eleven
mutations; exact authored readback and a complete raw-dataset comparison passed.
This publishes English Blog category fields and five English services, and appends
the requested Finnish funeral prices while preserving the existing pricing row.
The English funeral service contains the same new options and amounts.

| Finnish option | English option | Price |
| --- | --- | --- |
| Siunaustilaisuus | Funeral service | 200 € |
| Siunaustilaisuus + hautaan lasku | Funeral service and burial | 250 € |

## Reviewed source and authorization

PR [#383](https://github.com/Alpine78/photosite-starter/pull/383) passed CI build 939
at head `b0d792d29f80c6496d6e1a121019fcf9003bf363` and merged as
`c32d1e8f4ba41d63028052fd51f8528394f6f3da` before publication. Both application and
standalone Studio CI jobs passed. AB#270 is verified Closed. The separately reviewed
release-evidence PR [#385](https://github.com/Alpine78/photosite-starter/pull/385)
passed CI 935 and merged as `ea99a378c4e8afa17e37982a7a22b1188781d047`;
AB#273 was explicitly moved from Active to Closed and verified after merge.

The approved operation description has SHA-256
`95d74fe0bbdaa0d0c0f24de240a153ab5ef09fc66df9b235ce6d003d637177f4`.
The accepted copy workbook has SHA-256
`8b933436af828518e1c11499508df5900fe7f7b823689cb74d049db01db46c3a`.
The exact target and transactions, including all eleven mutations and six original
source revisions, retained authored scope digest
`ab322fc00f066e12e193b5dcfa318b3e156b8ae7e62539ecef04c76eaddbe487`.
Only the explicitly permitted credential-related system metadata rebound the
complete snapshot and final plan digest. Final plan digest:
`46817074a4464859c8ad6df340609bbdfde94a2a10489e9dfbf979e0a74786ac`.

## Recovery, execution and credential cleanup

The pre-write complete raw capture covered 17,609 documents and 5,158 assets.
Before the provider dry run, local recovery restored and rehashed all 5,158 asset
files, totalling 2,436,624,774 bytes, and the current document sidecar. Recovery
included the thirteen preserved additions outside the original archive. The
independent before/after raw manifests establish capture completeness; the recovery
tool establishes local byte recovery. No provider restore or deployment rollback
was performed. Pre-write raw SHA-256:
`65e90620276a045321c6017e4d490d55663d6a1a7dfb5a576c3b1ec2389bb475`.

Two earlier attempts stopped before any content mutation request. The first private
operator mishandled an empty HTTP 204 cleanup response; independent reconciliation
confirmed robot absence and a rejected key. The second correctly revoked its key
but refused a project-scoped principal absent from robot creation metadata. The
private operator was corrected to read the new credential's authenticated GROQ
`identity()` and permit only that exact principal in system-group additions, as
described by [Sanity's function reference](https://www.sanity.io/docs/specifications/groq-functions).
All other group fields, existing memberships and authored documents remained guarded.
Unstable raw scans during permission propagation were retried as bounded read-only
captures. Content mutation requests were never automatically retried.

Three temporary Editor credentials were therefore created sequentially; only one
was active at a time. All three were deleted and returned HTTP 401 when reused.
The successful attempt performed one provider dry run and one actual content batch.
Exact source/target readback passed. A complete post-write audit found precisely five
new service documents, the approved category/source deltas, and no changes to any
unrelated authored document, editing draft or asset document. After cleanup, every
original system-group membership was restored, other robot identities were unchanged,
and the existing read-only Viewer still read the expected document.

Final stable raw capture: 17,614 documents, 5,158 assets; SHA-256
`b89a2115b928439071759c89912879436aabe810702d25d52846c510e4628590`.

Private receipts stay in the ignored `chore-274-approved-locale-publication/temp/`
worktree directory. No credentials, source documents or customer files are published
with this record. Receipt hashes bind the preserved evidence:

| Receipt | SHA-256 |
| --- | --- |
| Publication | `9149a6cc64812a298b98afc09ee970bfa8bb52f711753ec78152e316276d2a98` |
| Full dataset audit | `ba2f3a4b2689c2ace3e70bcf8cd80986436d04bed717416559c3defa5558c78c` |
| Writer revocation | `9e6a577de54082426299e5b96e26c1e229e5c50d18968a1fee991f23ecb39301` |
| Completion | `01c5e839bcef72837e6a02bfb6cf296a33cfdece497282dd2341ceaedf93b8f0` |
| Local recovery | `01c905371ffd433b5136519a0d092907f8eac2fb12718f7f712fb0ed2d87bb77` |
| Public route verification | `38091e8b5858dc32cdc5a86c52e1b6498aa93e3122f05aeaa1a2157f3ba1c733` |

## Visible route checks and remaining gates

A local production build of merged source `c32d1e8` read the real Production content.
Browser checks verified status, page heading, configured FI/EN language, canonical
path and both funeral pricing options. Third-party browser requests were blocked.

| Path | Result |
| --- | --- |
| `/palvelut/hautajaiskuvaus` | 200; Finnish price additions rendered |
| `/en/services/funeral-photography` | 200; English price additions rendered |
| `/en/services/property-photography` | 200; reviewed service and canonical |
| `/en/services/wedding-photography/ceremony` | 200; reviewed nested service |
| `/en/services/wedding-photography/full-day` | 200; reviewed nested service |
| `/en/services/wedding-photography/half-day` | 200; reviewed nested service |
| `/tarinat/blogi` | 200; existing Finnish category |
| `/en/stories/blog` | 404; English category has no published entries yet |

The English Blog fields are published and now satisfy the category prerequisite for
planning the eighteen article publications. The public tree intentionally omits
empty leaf categories; its 404 is not English article publication. All eighteen
English article drafts and 644 placement drafts remain drafts. Their publication
requires its own concrete approved operation and current source/recovery checks.

These checks prove rendering on a local production build, not the final deployed
release. No deployment promotion, DNS change, ZIP import, billing change, provider
rollback, new contact delivery test or final security/privacy acceptance occurred.
Whole-ZIP support confirmation and the final release-source/rollback/acceptance
evidence remain open. AB#274 is Active pending evidence PR review/merge; parent
AB#137 and the broader launch/language stories remain open.
