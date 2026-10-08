# AB#137 — Production preparation after ordered merges, 2026-10-08

The approved batch is ready for its next operational gates: a new complete baseline,
current collision/derivative checks, and a source-bound protected Production candidate
are verified. Public activation and the actual import remain open. AB#137, AB#117,
AB#132 and AB#18 remain Active; this record issues no GO decision.

This afternoon checkpoint supersedes the current-state observations in the
[morning checkpoint](launch-readiness-2026-10-08.md), while preserving its history.
The legacy-host removal date remains **2026-10-15**.

## Ordered integration and exact source

PRs #295–303 merged one at a time. Each branch was reconciled only after the preceding
merge, then committed, pushed and given a new successful PR CI. Conflict corrections
preserved the reviewed application/tooling patch; overlapping documentation additions
were retained. The nine work items were verified Closed. AB#235 and AB#237 required
explicit Active → Closed updates; the other seven were already Closed after merging.

| PR | Merge commit | Successful PR CI | Item |
| --- | --- | --- | --- |
| [#295](https://github.com/Alpine78/photosite-starter/pull/295) | `28e3dfd3b9f44cbd25267d182c7653c14e7d63f8` | [702](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=702) | AB#231 Closed |
| [#296](https://github.com/Alpine78/photosite-starter/pull/296) | `004cc3c64bfdaf8465f64460bb1b3c37bbc67190` | [704](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=704) | AB#232 Closed |
| [#297](https://github.com/Alpine78/photosite-starter/pull/297) | `f885afc0143bf420addb941e36fef565de384e7c` | [706](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=706) | AB#233 Closed |
| [#298](https://github.com/Alpine78/photosite-starter/pull/298) | `697318327fd8183d6a199594064cf3c85f529929` | [708](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=708) | AB#234 Closed |
| [#299](https://github.com/Alpine78/photosite-starter/pull/299) | `cb35ed4047238ddea05e90a41ff5a715a54ac593` | [710](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=710) | AB#235 Closed |
| [#300](https://github.com/Alpine78/photosite-starter/pull/300) | `ebc1d51fb60e654dde8ddca432c8785b83233567` | [712](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=712) | AB#236 Closed |
| [#301](https://github.com/Alpine78/photosite-starter/pull/301) | `14337f4e275e226c129d55834929229fe94700cf` | [714](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=714) | AB#237 Closed |
| [#302](https://github.com/Alpine78/photosite-starter/pull/302) | `a54bc1b1ecf5c06186b3dd6df66ce9c56a2fdfb2` | [716](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=716) | AB#238 Closed |
| [#303](https://github.com/Alpine78/photosite-starter/pull/303) | `8e3efe625d03726ff5db04e57da3b8a6b9e83bc7` | [718](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=718) | AB#239 Closed |

Final main is `8e3efe625d03726ff5db04e57da3b8a6b9e83bc7`. Main CI
[#719](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=719)
completed successfully with both actual **Verify** and **DeployPreview** stages.
Intermediate duplicate main jobs were cancelled only after verifying tree equality
with a successful full PR Quality run and that Preview had not started; the final
main job ran in full. Its scheduled dependency-audit stage was skipped. A separate
fresh `npm audit` returned zero reported vulnerabilities; the audited package and
lockfile hashes match this source. That audit does not independently certify vendored
patches or close the entire launch security review.

Eleven completed worktrees were removed after exact-head/ancestry, status, ignored-file
and active-process checks. Their 370 non-generated local files were copied and
hash-verified in owner-only ignored preservation storage. Branch refs were retained.
The owner's primary checkout was preserved. The temporary merge coordinator was also retired after the protected checks,
preserving its 97 local files separately: twelve retired worktrees, 467 preserved files. VS Code's repository UI was not inspected.

## Protected Production candidate

A manual prebuilt candidate from that exact main revision is READY. The build used
15 allow-listed public Production settings, Node 24.20.0, Next.js 16.3.8 and Vercel
CLI 61.0.0. The 744 tracked source files and public inputs were unchanged
through the build/upload; npm configuration and cache were isolated. Sensitive keys
and the two contact address values were excluded from the build environment. The
runtime provider still supplies its existing server-only settings.

All **611 provider archive members** matched the frozen local manifests: 221
physical file/link entries and 390 mapped runtime inputs. Five physical functions
use Node 24 with empty embedded environments. Private environment files and migration
files were absent from the uploaded archive; the public `.env.example` is allowed.
This is a manual Production-configured build, not an Azure Production release job.
A later commit containing this checkpoint is a different source revision.

**30 current-content GET cases passed** across the old and candidate deployments:
thirteen FI/EN routes and two gallery continuations on each. Checks cover status,
rendered main/heading, language, canonical URL, public image origins and bounded
pagination. The new contact page exposes all six fields. Candidate responses carry
noindex; an anonymous immutable request receives HTTP 302 to Vercel protection.
Explicit immutable-deployment CLI calls used the existing bypass from an unlinked
caller; the bypass inventory count remained unchanged. No bypass was created or
rotated, and unchanged counts are not proof of unchanged secret values.

The exact plan's fourteen affected page versions also passed an offline check of
the actual body projector: 21 linked paragraphs and one rich list retain every inline
link. This demonstrates source compatibility, not live post-import routes. Four
Production adapter tests passed tokenlessly, including genuine multi-page pagination.
They use a per-run signing key and do not prove the deployed signing key; the live
candidate continuation GETs separately exercise that deployment's continuation path.
An additional curated-gallery GET passed and a precise physical-device checklist
is prepared; no real-device gestures were exercised.

Both existing aliases and the project's Production target stayed on the old
September 24 deployment; no restoration was needed. The public alias still cannot
read fourteen approved versions. No contact POST or delivery was tested on this
candidate. Earlier owner-confirmed mail/Reply-To evidence remains historical.

The October 8 AB#132 recheck produced **2 expected semantic failures** and
**0 semantic passes**: unknown URL and refused cursor return 404 without rendered
main/heading/return links when JavaScript is unavailable. The owner's
[October 7 acceptance](../adr/0007-proxy-request-path-boundary.md#2026-10-07-owner-accepted-temporary-residual-risk-ab132)
is preserved; this check records no new acceptance or GO decision. AB#132 stays Active.

## Fresh Production baseline and approved import guards

A new exclusive, owner-only complete baseline was captured on October 8 using a
credential whose effective permissions allow only read/history. It contains **3,593
raw documents**, all IDs/revisions/types, provider-owned system records and a normal
importable export with **1,748 asset binaries**. Every binary's SHA-1/size agrees with
its asset ID/metadata; normal export references and metadata agree with the raw snapshot.
The bundle's ten members and final SHA-256 were verified before atomic publication.
The full revision manifest remained equal at capture, after verification, and at
2026-10-08T16:35:56 UTC. Repeat this comparison immediately before any write.
The archive is structurally/cryptographically verified; no live restore was exercised
and no independent-machine backup copy is claimed.

The audit traversed eighteen raw pages: twelve internal system records, zero drafts,
release versions, release records or webhook-test documents. All 1,748 image assets
have public dimensions and no originalFilename; no audited media archive/capture
metadata was found. A new Sharp header inspection of every archived public image
found no EXIF/IPTC/XMP/Photoshop/comment payload and no longest edge above 2048 pixels.
This header inspection is not a full pixel decode, rights review or approval-traceability
verdict. Exact approval traceability of all pre-existing launch content remains open.

The approved batch is unchanged: **72 page versions, 3,512 photographs and eight
categories**. Both writer dry runs passed with no network requests. The content plan
has 9,918 documents and seven required category identities; the eight category documents
form two dependency waves. Raw collision and category checks found zero issues.
Every new derivative passed source hash, native-aspect, no-upscale, 2048-pixel ceiling
and EXIF/IPTC/XMP checks. Total new derivative bytes are 1,568,998,364.

Fresh actual byte-hash comparison identifies seven pre-existing shared assets to
preserve. All baseline IDs/assets are listed for preservation in the private rollback preparation;
future successful write receipts must identify new-only deletion IDs. An alias restore
to the old renderer alone is insufficient after importing new formats. The 1,749
current media records reference 1,748 distinct assets because two media records share
one asset; this is not a missing binary.

Production's countable-document upper bound after the full batch is **11,759**.
[Sanity's document-quota policy](https://www.sanity.io/docs/platform-management/plans-and-payments)
excludes image/file asset and internal system documents; drafts and release versions
count separately. Production's twelve internal records are therefore excluded. Both returned project datasets were counted with the raw-read credential: Preview
contains twelve internal system records and zero countable documents, so the
all-dataset upper bound is also 11,759. This is below Growth's documented 50,000
document cap and above Free's 10,000 cap. These counts are not a read of billing/API/
bandwidth usage or a guarantee against charges. Growth is owner-confirmed;
its plan was not independently returned by the inspected metadata. Sanity region was
also not returned and has not been guessed from a hostname or community answer.

## Next launch operations

1. Resolve the actual hosting contract. An authenticated October 8 team read still
   returns Hobby. The owner keeps that subscription for now; this does not authorize
   a paid upgrade or establish a commercial-use exception. Current
   [fair-use terms](https://vercel.com/docs/limits/fair-use-guidelines) reserve Hobby
   for personal non-commercial use, and the published
   [DPA](https://vercel.com/legal/dpa) expressly addresses Pro/Enterprise customers.
   The planned paid-photography site needs a supported hosting resolution before
   public activation. Provider-question drafts are prepared but not sent.
2. Publish the exact reviewed FI/EN contact notice through a revision-guarded,
   single-field patch once its publication is authorized. The refreshed private
   proposal names photography type, optional phone/date, email-subject visibility,
   actual processors, transfer safeguards and the owner's twelve-month policy.
   No CMS write is implied by drafting. Re-read the revision before patching, then
   capture and verify another complete baseline before bulk import.
3. Activate the verified compatible renderer on the existing public Vercel address
   after applicable gates. Repeat baseline, collision, category, quota and shared-asset
   guards immediately before the already approved import. Existing approval is not
   requested again. Use a temporary least-privilege write credential.
4. Audit actual imported routes, galleries, all raw states and asset bytes; reconcile
   existing-content approval and writer principals, revoke temporary writers and
   prove revocation/runtime access. Finalize AB#19 mappings and AB#141's physical
   touch-device check. Close AB#137/19 and then AB#117 only on actual evidence.
5. Complete AB#18's go/no-go, compatible rollback/handoff and domain cutover,
   preserving Infomaniak, Resend and unrelated DNS records. The October 15 legacy-host
   deadline and recorded dark-web fallback remain in force. No DNS operation is
   performed by this checkpoint.

Resend's [published policy](https://resend.com/security/gdpr) states that its DPA
becomes effective for every account on signup; obtaining a separate signed copy is
not a prerequisite for effectiveness. It documents US message/log storage, 30-day
Free email/log retention, seven-day backups and transfer safeguards; Ireland is a
sending region, not an EU storage guarantee. The owner's MFA, key scope, tracking-off
and deletion confirmations remain accepted. Infomaniak's exact Free backup-erasure
interval remains unverified: upgrade recovery availability is not proof of physical
erasure. No further account changes or repeated confirmations are assumed.

**Not performed:** public promotion, CMS notice/bulk mutation, live restore,
contact delivery, writer revocation, physical-device testing, post-import legacy
verification, billing change or DNS cutover. Private operator evidence and the notice
proposal remain ignored local files. This checkpoint does not certify the full
AB#117 security/privacy review or an independent review of each private helper line.
