# AB#137 — Production activation and approved migration, 2026-10-09

The owner authorized the compatible renderer activation, the previously approved
public import and a later web DNS cutover preserving Infomaniak. The owner upgraded
the existing Vercel team to Pro; an authenticated provider read confirms `pro`,
`active`, on October 9. No additional subscription was provisioned by the operator.
AB#137, AB#19, AB#117, AB#132 and AB#18 remain Active. This checkpoint does not declare
the custom-domain launch complete or close their acceptance criteria.

## Exact serving version

Production aliases now serve `dpl_44SDGwpPtrcZDTFDAHLTBLvHBneU`, source
`8e3efe625d03726ff5db04e57da3b8a6b9e83bc7`. Promotion reused the exact staged
Production artifact without rebuilding it. Its provider archive matches all **611**
reviewed output/runtime members; private environment files are absent. This is a
manual prebuilt release, not an Azure Production release job. The current green
main revision `c11740f93a370e04d71a55adea0a8b79904f347c` (CI #745) changes only
operator scripts/documentation after that candidate's source; runtime inputs match.

The previous alias target was `dpl_6mhVWnBUHLgxAkMuj5chRLEnckKP`, source
`110dd006832da155141401d06d0c742e43a7fd0b`. Its incompatible renderer is usable as a
rollback target only **before** the new content import. After import, keep the
compatible current artifact as the serving baseline; an old-renderer rollback needs
a separately verified content rollback and must not expose unreadable page formats.

Thirty protected GET cases passed before activation: **15 on the previous renderer
and 15 on the compatible candidate**, including FI/EN routes and bounded gallery
continuation. Five anonymous GET cases passed on the stable public
Vercel alias after activation. Canonicals still point to `https://www.ilkansivu.net`.
The immutable candidate remains anonymously SSO-protected; project protection and
the automation-bypass inventory are unchanged. The stable alias
`photosite-starter.vercel.app` is anonymously accessible and the activation receipt
records `noindex:false` on all five anonymous GETs, which attributes only the absence
of a general noindex header to those requests; the activation check does not inspect
HTML meta. A separate receipt from one anonymous GET of the stable home URL at
2026-10-09T11:17:02Z recorded status 200, no `X-Robots-Tag`, no meta robots or
googlebot entries, the canonical above and an HTML hash. That meta result covers
that one page at that time, not other pages. Preview's noindex rule and the immutable
candidate's protection are separate and do not cover the alias. No decision to accept or mitigate pre-DNS alias indexing is recorded; the
canonical site's indexing is a separate post-DNS check. No new contact
POST or email delivery is claimed by these GET/receiver checks.

## Sanity baseline and first write

A complete fresh Production baseline was captured and verified on October 9:
**3,593 raw documents**, **1,748 asset binaries**, **916,811,028 asset bytes**.
The archive SHA-256 is
`d31903f9fa7b74c8815b425ff31085b26d6b76104cecdee839553055ea94629d`.
All raw revisions, normal-export/asset metadata and asset bytes match; drafts and
release versions were explicitly counted. No live restore or independent off-machine
backup test was performed. A stale completion-report filename refused an exclusive
write after the new archive was published; an independent completion verified the
published archive and unchanged live revisions without replacing earlier evidence.

Both approved writer dry runs passed, and all **3,512** derivatives passed native
ratio, no upscale, at most 2,048 px longest edge and metadata-removal checks.
The approved content digest remains
`b90fa5eb1618555b891f84490a6f87d877afb878ba0a5947e15579fa51ee524c`;
the eight-category digest remains
`bc12a39f828ed3f257e01753b781242123ad627ca1aee794bb3ff46395b5398c`.
No repeated content approval was requested.

Eight approved category documents were created in two dependency waves. Independent
canonical readback matches their approved contents; every pre-existing raw revision
is unchanged. The raw count became 3,601. The content writer then rechecked the
baseline with only that approved category delta, collisions, media merging, target
and credential identity before starting the approved 9,918-document / 3,512-image
batch. **The full content write and its independent post-write audit are in progress
at this checkpoint.** Counts alone will not certify the payloads or upload privacy. Exact approval
traceability of all preserved pre-existing content/assets is still an AB#137 AC3 gate;
an unchanged baseline is not proof that every retained object is approved. No new
private, demo or abandoned-content cleanup is claimed.

The dedicated migration robot has the built-in Editor role, verified by token
identity and effective `publish` permission. It is temporary and is **not** a
custom role narrowed to this dataset. Revoke it only after complete import/audit and
prove the revoked token cannot authenticate. A separate old `webhook test` robot
still has Editor access; its actual use/removal is pending owner clarification.

## Production cache receiver

Production webhook `QRP4a90fEuUGZguQ` was created before the first approved category
write. Its temporary URL is
`https://photosite-starter.vercel.app/api/revalidate`, which is anonymously reachable;
no Production automation-bypass header is needed. It targets only `production`,
POSTs the identity-only schema-v1 projection, excludes drafts/releases, and filters
the receiver's nine maintained public document types, including
`articleEndGalleryPlacement`. Its signing key is distinct from Preview's.

Current-key validation, retired-key rejection and wrong-dataset rejection passed.
A signed reconciliation was accepted after promotion. More importantly, the actual
approved category creations triggered successful deliveries to **both** Production
and the unchanged Preview hook. No synthetic CMS test document was created.
Retarget Production to the canonical domain only after DNS/TLS and receiver probes
pass; verify its actual automatic delivery again. Historical deployments which still
accept old signing keys remain a separately tracked AB#117 residual; no global key
revocation or blanket deployment deletion is claimed. A fresh October 9 scan found
80 retained deployments still accepting the historical key on a signed invalid request.
All 80 remain anonymously SSO-protected, are not current project targets and have no
current project alias. No successful invalidation, deletion or old-key disablement
is claimed by this scan.

## Remaining launch gates

The owner supplied a fresh **Joomla K2** backup on October 9 and the new private
customer gallery's separate files. The ZIP's **26,239 members** pass CRC and archive
path checks; its **142 SQL parts** contain the new K2 gallery row and exact paths to
all **34 JPEGs and one delivery ZIP**. The separate delivery ZIP also passes CRC and
contains 34 images. All 34 separate JPEGs also fully decoded without warnings;
SHA-256 receipts cover the backup and every separate file.
The Joomla ZIP does **not** embed those gallery images: retain the archive **and**
the separate files together. No live restore or off-machine copy is claimed.

This resolves the observed missing backup material; the customer's continuing
access after web DNS moves or the old host ends on **2026-10-15** still needs an
explicit decision. A recoverable backup does not preserve the old gallery link's
availability. The private gallery is absent from the approved public import and
must not be uploaded into the public Sanity dataset. Public Joomla content is
unchanged on the owner's confirmation, so its existing public approval remains valid.

DigitalOcean nameservers and old web destinations were observed through DNS queries;
these samples are not a full zone snapshot. DNS API access is pending the owner's
local credential file. Before any DNS mutation, capture the complete zone with
record identities and compare all mail/Resend/unrelated records before and after.
Obtain the project's current recommended web destinations from Vercel; preserve
Infomaniak MX/SPF/DKIM/DMARC, Resend's sending subdomain and delegation.

The exact promoted candidate again returns two expected scriptless semantic 404
failures, with real HTTP404/noindex and no rendered heading or return link. This is
the October 7 accepted temporary residual, not a semantic pass or a permanent
waiver; AB#132 remains Active for the supported fix. The October 8 reassessment and
October 9 candidate recheck preserve that decision.

The owner has supplied additional physical-phone observations for VAT-portfolio on
the earlier Production version. These are recorded in ADR-0001 with the remaining
zoom-cap/ratio clarification, without claiming a physical test on the new candidate.
Complete AB#19's legacy mappings/target checks, the full import privacy and runtime
audit, credential revocation and AB#117/18's actual go/no-go before custom-domain
cutover. The October 15 dark-web fallback remains until a successful new-site launch.

## Validation and private evidence

Focused writer/HTTP/DNS/deployment tests: **239 passed**. Live Production adapter
checks: **4 passed**, including genuine pagination. A fresh npm audit reports **zero
vulnerabilities**. Application code and dependencies are unchanged in this branch.

Owner-only logs, raw snapshots, provider metadata, credentials and helper scripts are
under `temp/launch-20261009/` in the launch worktree; the full archive remains in the
ignored migration audit directory. None belongs in the public commit. The one-time
Claude plan review is complete. The checkpoint diff-review scope explicitly includes
the four prepared read-only operator sources: `ops-readonly.mjs`,
`verify-imported-content.mjs`, `verify-imported-runtime.mjs` and
`continue-import-audit.mjs`. Exact scope fingerprints, round reports and finding
dispositions are retained privately; other operator helpers are not claimed reviewed
line by line. The supervisor has seven passing offline synthetic sequencing, error
and evidence-preservation cases. It waits for a successful writer exit before auditing
all approved payloads/asset bytes and anonymous route windows. If the writer wrapper
dies without a completion receipt, it waits up to six hours and fails closed; inspect
the original writer session and preserve partial evidence before any separately
reviewed retry. No helper restarts the writer or revokes credentials. These prepared
checks do not certify an import which has not yet finished.


## Completion addendum, 2026-10-09

This addendum supersedes the earlier in-progress write/audit/revocation status above.
AB#137 remains **Active** for the residual acceptance criteria; it does not declare
AB#19, AB#117 or AB#18 complete. No repeated approval was requested for the accepted
72 page versions, 3,512 image references or eight new categories.

### Completed import and recovery evidence

The approved content writer exited successfully at 12:18:01 UTC. Separate post-write
verification completed at 14:21:21 UTC and checked all **9,918 planned document
payloads**, all **3,512 derivative references**, their original byte hashes and
anonymous public-response dimensions/privacy. The 9,918 excludes the eight categories
written first. Seven existing shared image assets changed only `_rev`, `_updatedAt`
and `uploadId`; their creation times and all other fields remained unchanged.

The count relationships are explicit: 3,593 baseline documents + 8 categories +
9,918 content/media/placement documents + 3,397 new image-asset documents = **16,916**.
The 3,512 references use **3,404 unique asset IDs**, including seven pre-existing
assets and 108 repeated references. The original 1,748 assets + 3,397 new assets =
**5,145 image assets**. The complete authenticated raw snapshot contains zero draft,
release-version or file-asset documents. New IDs match only the approved payloads
and verified image-asset set. Approval traceability of every preserved pre-existing
object remains a separate unresolved gate.

Checks of the approved image references reject original filenames and compare true
intrinsic dimensions, derivative bytes and anonymous responses without private
metadata. Coverage is **3,506 JPEG + 6 PNG references**, not a new blanket privacy
certification of every historical asset. Failed retry evidence is retained. The final
private PNG-format correction was self-verified after the configured Claude round
limit; it has no additional clean Claude operator-review verdict. The successful
verification run is not an independent security certification of that correction.

At 14:23:56 UTC, **494 anonymous GET cases across 119 distinct routes** passed on the
compatible activated renderer. This includes 102 content-page routes, category
landings, bounded gallery windows, section and multi-page continuation witnesses,
canonical/language/robots checks and a stable raw revision manifest. It is not a
JavaScript interaction test, physical-device test or traversal of every gallery image.

A separate full baseline was then captured **before the additional priced services**:
16,916 raw documents, 5,145 asset binaries and 2,432,677,495 asset bytes. Its archive
SHA-256 is `5550b8fd50f115f51ea9a8ce8102929753c3322ffd102a7b667296b6ba32ea70`.
Both complete baseline receipts explicitly bind to the same customer Production
project, `production` dataset and API version, rather than inferring environment from
counts. Official export, raw manifest, metadata, binaries and archive members were
verified; revisions remained stable through publication. A restore, off-machine copy
and accepted retry/rollback exercise have not been performed.

### Additional services and credential closure

The owner's separate 900 EUR / 1,400 EUR confirmation was used for the two Finnish
half-day/full-day wedding services. Three exact service readbacks passed after the
create-only write, including the existing parent; only two documents were new. The
existing parent's `createIfNotExists` wave changed only `_rev`, with content and all
timestamps unchanged; every other 16,915 existing document and revision was unchanged.
The raw count became **16,918**, with no new assets, drafts or release versions.
At 14:34:12 UTC, seven anonymous GET cases verified prices, listing, sitemap,
canonical/language and the correct contact prefills. No English versions were invented
and no contact POST was performed.

The categories, content import and service writer used the same dedicated temporary
migration Editor. Production-hook provisioning used the existing owner session,
not another temporary writer. At 14:35:28 UTC, deletion of exactly that migration
credential was confirmed by the management API, absence from the token list and a
**401** authentication rejection. All other previously listed credentials were
preserved. This is not revocation of the old `webhook test` Editor or certification
that every historical write credential is retired; their usage/disposition remains
unverified.

A read-only raw check at 2026-10-09T15:29:22.315Z confirms all **16,907 non-group document
identities, revisions and types** still match the final service audit. An initial
strict whole-manifest comparison failed and is retained: all eleven `system.group`
revisions/update timestamps changed at 14:35:29 UTC. Full group-payload comparison
verifies that only the revoked robot disappeared from the Editor and write groups;
all other members, permissions and payload fields are unchanged. The timing and
exact member identity are consistent with the recorded credential retirement.
This narrowly recorded system delta is not treated as a content mutation or a new
binary/payload audit. No additional CMS write or token mutation occurred in this check.

### Remaining launch work

Preserved-content approval traceability, actual dataset-region evidence and the
older Editor credential's disposition remain AB#137 gates. Keep the compatible
renderer as the serving baseline; reverting to the old renderer needs a separately
verified content rollback. The complete baseline is recoverable material, not an
exercised restore or off-machine backup.

AB#19 still needs the remaining exact legacy decisions and deployed source/target
verification. The private K2 customer's continuing access after DNS cutover and
October 15 retirement is unresolved; that gallery remains outside public Sanity.
The expected DigitalOcean credential file was absent during this follow-up. DNS,
Infomaniak/Resend mail records and webhook destination are unchanged. Canonical-host
DNS/TLS/receiver verification and actual post-cutover webhook delivery remain open.

AB#117 also retains the 80 protected historical receivers accepting an old signing
key, pre-DNS alias-indexing disposition and the other final privacy/security gates.
The accepted temporary scriptless-404 risk remains an Active AB#132 follow-up;
physical-device observations do not certify the newly promoted candidate. Final
AB#18 go/no-go and exercised recovery remain incomplete.
