# AB#137 — protected renderer readiness, 2026-10-07

This is a verified preparation checkpoint. Production content import and public
activation remain open; AB#137, AB#117, AB#132 and AB#18 stay Active.

## Merged source and dependency gate

PR #281 merged at `751de98bef1afe9b5fd3a212dea24f1f498449a6`.
Azure main CI [#655](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=655)
passed both quality gates and a real protected Preview deployment with the patched,
locked Vercel CLI tree. AB#186 was explicitly moved from Active to Closed after
those results. This closes the dependency story, not the launch security review.

PR #282 merged at `49812f639d3e575235cfc7076e356be7abdc4306` after PR CI #656
passed and an independent Claude review found no issues in its documentation slice.
Exact-source main CI [#657](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=657)
also passed quality gates and the protected Preview stage. The three files changed
between these main revisions are documentation only. AB#132 remains Active: PR #282
records the defect rather than repairing or accepting it.

## Fresh protected Production candidate

A manual public-settings-only prebuilt candidate from exact main revision
`49812f639d3e575235cfc7076e356be7abdc4306` is READY. It is a Production-target
candidate, built locally rather than by an Azure Production release job. Node
24.20.0, Next.js 16.3.8 and Vercel CLI 61.0.0 were verified. All 729 tracked source
files were hashed before and after the build; the source and public settings stayed
unchanged through upload.

Only 15 explicitly allowed public settings entered the build. The three Sensitive
runtime keys and the two contact addresses were excluded; no secret-setting values
were downloaded. Production contact setting names and the `resend` adapter are
present, but a metadata inventory does not prove key scope or mail delivery.

The artifact audit covered 221 physical file/link entries, including 70 directory
aliases, and 390 additional CLI `filePathMap` inputs. Five physical function
configurations use `nodejs24.x` and contain empty embedded environments. The provider's
original uploaded prebuilt archive matched **all 611 members**, with no additional,
missing or mismatched members. Private environment files and migration directories
were absent; the public `.env.example` is the one allowed environment example.
Conservative credential-pattern checks found no credential-shaped matches; one
framework `.env.local` loader reference was reviewed. These checks do not claim to
recognize every possible unknown credential.

The candidate requires Vercel authentication for an anonymous GET (HTTP 302), and
its authorized GET responses carry `X-Robots-Tag: noindex`. Thirty current-content
GET cases pass: thirteen FI/EN routes plus two gallery continuations, on each of the
old and new deployments. Checks cover status, heading, canonical URL, language,
remote image sources and bounded gallery figures. Image-source assertions have
actual image witnesses in 16 cases; 14 cases legitimately contain no images
and do not establish image delivery. The new contact page exposes all
six fields. JavaScript was not executed, and new imported pages do not exist yet.
No contact POST or email delivery test was performed on this candidate. The pinned
CLI implementation was checked for the explicit-deployment no-create bypass path;
the project inventory contains four automation bypass entries both before and after
the refreshed GET checks. Unchanged counts do not prove unchanged secret values.
The stored alias restore plan is a contingency, not an executed restoration.

Two additional GET probes reproduce the known scriptless 404 defect on the live
candidate: an unknown URL and a refused gallery cursor both return HTTP 404 without
the required visible heading and return-link semantics. They are **expected semantic
failures**, not successful visitor journeys. Owner risk acceptance is pending.

Both existing aliases and the project's Production target stayed on the old
September 24 deployment. No alias restoration was needed. No public promotion,
CMS write, DNS change, credential revocation or billing change occurred. The public
alias still serves the renderer that cannot read fourteen approved page versions.
The frozen candidate and build-input hashes remain evidence for this source revision;
a later docs commit must not be described as the same commit.

## Content and recovery preflight

The complete baseline archive's SHA-256 was recomputed and matched its recorded
value. A fresh full-read-only credentialed raw manifest contains **3,593 documents**;
all IDs, revisions and types equal the baseline, with zero additions, removals or
changes. The count includes 12 provider-owned system records; the ordinary
non-system inventory has 3,581 documents. The baseline is structurally and
cryptographically verified, not live restore-tested.

The existing-content audit traversed eighteen pages: no drafts, release versions,
release records or `webhook-test-1` document; 1,748 image assets all have dimensions
and no `originalFilename`; no audited media archive-locator or capture-time fields. The 1,749 media documents
reference 1,748 distinct image assets: two documents share one asset. This explains
the count difference without implying every media identity must own a unique asset.
Binary EXIF/IPTC/XMP inspection was not repeated in this metadata audit. Type/ID
inventory does not establish approval of every current document or resolve demo and
abandoned-content traceability by itself.

Both current-main writer dry runs passed without network requests: 9,918 content
documents, all 3,512 source photographs and seven required category identities; eight
category documents in two dependency waves. Fresh raw-read collision checks found
zero planned content or category ID collisions. Four live Production adapter tests
passed, including representative queries and bounded pagination. Their refreshed
receipt records the explicit Production env-file override, file hash, selected
target, command and matching target banner. These tests cover
existing content, not the future post-import state.

The owner-approved batch remains **72 page versions, 3,512 photographs and eight
categories**. Its content approval is unchanged and need not be repeated. Immediately
before writing, repeat the complete baseline/asset freshness, collision, quota and
actual derivative overlap checks. Preserve baseline IDs and the seven previously
identified shared assets; future write receipts determine actual new-only rollback
IDs. Any earlier privacy-notice write invalidates the current manifest comparison
and requires a new complete baseline before the bulk import.

## Acceptance boundaries and next operations

| AB#137 criterion | Current evidence and remaining work |
| --- | --- |
| AC1: ownership, visibility, region, operator | Public dataset and current operator's Administrator membership verified. Region is not returned by the queried metadata; ownership handoff remains open. |
| AC2: recoverable baseline before change | Full existing baseline verified and raw freshness matches. Repeat immediately before the first write; no live restoration claimed. |
| AC3: approved content and no stray content | Unchanged approved batch validates locally. Actual import and complete launch-content traceability remain open. |
| AC4: adapters and bounded pagination | Current Production adapter tests and protected candidate GETs pass. Repeat against the imported final content before promotion to the domain. |
| AC5: all states/assets/public boundary | Existing credentialed metadata audit completed. Exact post-import documents, derivative dimensions/bytes, filenames and private-field audit remain open. |
| AC6: revoke write credential; runtime/rollback/retry/handoff | Four project-managed tokens remain, three write-capable; one temporary Editor has no expiry. Principal reconciliation, revocation after the operation, retry/rollback verification and handoff remain open. No token revoked. |
| AC7: evidence for AB#117 and closure before launch | Preparation evidence recorded; AB#137 is not complete and cannot close AB#117 or AB#18. |

Before public renderer activation, resolve AB#132's explicit temporary-risk decision
or supported fix, the unresolved Production hosting-tier decision (ADR-0004 Pro,
or Hobby only with the recorded operating constraint and Support confirmation),
and the AB#117 processor/key/retention/tracking checks. No billing-plan observation
was refreshed in this checkpoint. The published contact privacy notice
still omits the photography type and optional phone/date fields and names delivery
generically. A private correction proposal is prepared, not applied; the mailbox's
existing twelve-month promise still needs an operational deletion check.

After compatible public code is verified, write the already approved categories and
content with a temporary least-privilege credential; audit the final content/routes/
galleries and revoke that credential. Complete AB#19, the real-device check in AB#141
and AB#117 before the domain launch under AB#18. Immediately before any activation,
recheck the frozen source, provider configuration, protection and current aliases.

Before import, the old public renderer can be restored to its exact alias snapshot.
After import, it cannot read the new body format: rollback needs a compatible
renderer or a receipt-bounded content rollback preserving old/shared assets. An alias
restore alone does not restore the project's Production target or release policy.

The agreed **October 8 go/no-go** remains. If AB#117 has not closed then, AB#18's
recorded October 15 fallback removes web A/www records for a deliberately dark web
site while retaining Infomaniak and Resend mail records. Joomla is unavailable after
the old hosting ends on October 15; the first domain launch's fallback is the agreed
DNS-dark state until a separate known-good Vercel rollback exists.

Full content, account identifiers, candidate details, operator helpers, source and
artifact manifests, API receipts and proposed CMS edits remain in ignored local
evidence. The new worktree's evidence directory is `temp/renderer-20261007/`, indexed by
`evidence-index.json`. It includes the copied baseline manifests, fresh archive hash
and collision receipts, the live adapter test output and current audit/smoke receipts.
The audit helper reads the copied manifest there and does not require `/tmp` to
survive. Operator helpers are frozen one-off operations; preserve their receipts
and choose fresh output files before a deliberate repeat. Earlier
approval and complete backup evidence remain in the ignored migration audit directory.
