# October 8 launch readiness checkpoint (AB#239)

Engineering merges and protected Preview verification are complete for the observed
main revision. Public renderer activation, remaining content import and domain launch
are still open. This checkpoint records the October 8 review inputs; it does not issue
a GO decision, extend a risk acceptance, or close AB#137, AB#19, AB#117, AB#132 or AB#18.

The legacy web hotel ends on **2026-10-15**, seven calendar days after this checkpoint
(AB#131). The previously agreed October 8 go/no-go remains due. If AB#117 is not Closed
at that decision, AB#18's recorded October 15 fallback is a deliberately dark web site
by removing the web A/www records while preserving mail and unrelated records. That
fallback is an existing owner decision, not a DNS operation performed here.

## Verified merged source and CI

Observed `origin/main` is `bbfa04728abe29b78dc70b55b2dc2d52489e04b0`.
This is the **pre-documentation revision**; a later commit containing this checkpoint
is a different revision and needs its own CI. All eleven PRs were merged sequentially
only after successful checks, with conflicts resolved and pushed for the current PR
before beginning the next one. The final merge completed at 07:10:21 UTC.

| Merged PR | Integrated commit | Successful PR CI | Work item after merge |
| --- | --- | --- | --- |
| [#283](https://github.com/Alpine78/photosite-starter/pull/283) | `8661146d41a022b1b5351f766b735a1df6ec9b7c` | [662](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=662) | Launch parents stay Active |
| [#284](https://github.com/Alpine78/photosite-starter/pull/284) | `53513bc2ae4ac2b8b172d6a0459930094776740c` | [663](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=663) | AB#220 Closed |
| [#285](https://github.com/Alpine78/photosite-starter/pull/285) | `d12d55a517f991946fab7a77363c1dbd85fb4dd1` | [675](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=675) | AB#221 Closed |
| [#286](https://github.com/Alpine78/photosite-starter/pull/286) | `0acf31a1e1d9b425d42b82d2c8bf7ac6d4d7b1d0` | [677](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=677) | AB#222 Closed |
| [#287](https://github.com/Alpine78/photosite-starter/pull/287) | `5cdc288ec9320f1aebf609c38a6e9b2b39f04d85` | [679](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=679) | AB#223 Closed |
| [#288](https://github.com/Alpine78/photosite-starter/pull/288) | `d8492a48eb82587ca36e4b61507f275b5ed18c58` | [682](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=682) | AB#224 Closed |
| [#289](https://github.com/Alpine78/photosite-starter/pull/289) | `5b3d8eb502407e5bcedd0ef2d0e2a8bd3ac3b2c1` | [684](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=684) | AB#225 Closed |
| [#290](https://github.com/Alpine78/photosite-starter/pull/290) | `a0119aa53ebabd8a67fee4ef21858fb0ada96a9e` | [686](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=686) | AB#226 Closed |
| [#291](https://github.com/Alpine78/photosite-starter/pull/291) | `45b0e28058a1e42bb80117f54d042e347c75bbde` | [688](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=688) | AB#227 Closed |
| [#292](https://github.com/Alpine78/photosite-starter/pull/292) | `28299fee06094f368e5ef1280233b1e9c3dd165c` | [690](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=690) | AB#228 Closed |
| [#293](https://github.com/Alpine78/photosite-starter/pull/293) | `bbfa04728abe29b78dc70b55b2dc2d52489e04b0` | [692](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=692) | AB#229 Closed |

Final main CI [#693](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=693)
ran on that exact revision from **07:10:29 to 07:21:06 UTC**. A fresh read at
**07:52:32 UTC** confirmed `completed / succeeded`; the timeline independently
confirmed successful **Quality gates** and **Preview release candidate** stages,
including the actual build/deploy/verify Preview job. The scheduled dependency-audit
stage was skipped in this main run; its result is not substituted for Quality.

## Fresh read-only deployment observations

Authenticated Vercel metadata GETs at 07:39:03–07:39:07 UTC confirmed the expected
project and team ownership before protected requests. The existing automation bypass
was used by the pinned CLI's explicit-deployment, unlinked-checkout no-create path.
No bypass credential was created, rotated, printed or placed in a URL. The initial
CLI invocation refused an unsupported forwarded option and obtained no HTTP evidence;
the successful observations below come from the corrected read-only invocation.

| Surface | Exact deployment / source | Observation on 2026-10-08 (UTC) |
| --- | --- | --- |
| Stable protected Preview | `dpl_5LQzQVxmT32iLr7tp6Pqt4Njqiy6`, source `bbfa04728abe29b78dc70b55b2dc2d52489e04b0`, READY | Metadata 07:39:03; immutable authorized root GET 07:52:04: HTTP 200, `X-Robots-Tag: noindex`; anonymous immutable GET 07:52:17: HTTP 302 to HTTPS `vercel.com/sso-api`, no body read. |
| Current public Vercel Production alias | `dpl_6PCmpGqTX6MaYLaEMnSrjrmnrRjF`, source `110dd006832da155141401d06d0c742e43a7fd0b`, READY, Production target | Alias metadata 07:39:05; immutable root GET 07:52:09: HTTP 200. It still resolves to the September 24 source, not the new main renderer. |
| Earlier protected Production candidate | `dpl_3JgRg6FUMcVVmnsJQjtWFmi1BubP`, READY, Production target | Metadata 07:39:07; API returns no source commit for this prebuilt upload. The [October 7 source/artifact evidence](ab137-renderer-readiness-2026-10-07.md) binds it to `49812f639d3e575235cfc7076e356be7abdc4306`; it is not a build of today's main. |

The stable Preview's identity was resolved through the API; HTTP protection/noindex
was checked against its immutable deployment hostname. The root GET confirms serving
HTML, not the Production dataset, all route formats, contact delivery or future imports.
Preview uses its separately scoped configuration; its successful response is not proof
that a Production-configured candidate can read the fourteen approved page formats.
The old Production deployment's immutable response carried `noindex`; this does not
establish the public alias's final indexability. No alias or project target changed.

Private metadata projections, raw HTTP bodies/headers, body hashes, CLI receipts and
CI timeline projections are retained in ignored `temp/day-20261008/` evidence. Secret
header values, personal message contents and the private migration sheet are excluded
from this tracked checkpoint. Earlier operator evidence was preserved before its
completed worktree was retired.

## October 8 AB#132 residual review

Two GETs against the exact earlier protected Production candidate reproduced the
scriptless limitation at **07:52:14 and 07:52:16 UTC**: an unknown public URL and a
refused gallery cursor each returned HTTP 404, with **zero rendered `main`, `h1` and
anchor elements**. JavaScript was not executed. The HTML parser counted markup,
not strings embedded in RSC scripts. These are **two expected semantic failures and
zero semantic passes**; HTTP 404 alone does not make the visitor journey pass.

Fresh primary-repository reads on October 8 show upstream
[issue #62228](https://github.com/vercel/next.js/issues/62228) still Open and both
[PR #98455](https://github.com/vercel/next.js/pull/98455) and
[PR #98583](https://github.com/vercel/next.js/pull/98583) Open/unmerged. That is an
observation, not a promised upstream repair or evidence of a supported local fix.

The owner [accepted the bounded temporary residual on October 7](../adr/0007-proxy-request-path-boundary.md#2026-10-07-owner-accepted-temporary-residual-risk-ab132),
with review today before go/no-go or earlier promotion. Today's recheck records the
continuing defect and upstream status. It does not renew that acceptance or repair
it; AB#132 remains Active for the fix. Retest whichever exact candidate is selected
for activation, and record the existing decision's applicability at the launch review.

## Carried-forward owner confirmations

These statements are provenance from the merged October 7 documentation and Boards,
**not fresh independent account, mailbox or CMS verification today**.

| Statement | Recorded authority / remaining boundary |
| --- | --- |
| Remaining content approved: 72 page versions, 3,512 photographs, eight categories | AB#137 and the October 7 migration checkpoint. Content approval is unchanged and must not be requested again; freshness and write/audit gates still apply. |
| Resend and Infomaniak two-factor login enabled | AB#117 comment `59470`; [security/privacy record](../security-privacy-review.md#2026-10-07-email-account-mfa-confirmation-ab117). No dashboard inspection today. |
| Existing Resend key is Sending access, domain-restricted; click/open tracking disabled; Resend Free | AB#117 comment `59471`; [email settings record](../security-privacy-review.md#2026-10-07-email-settings-confirmation-ab117). No key replacement or scope/settings readback today. |
| Owner-described Infomaniak Free suite, inferred to be kSuite Free from the description and official comparison, not read from the account; enquiries and own copies deleted within twelve months of the last contact, retaining necessary contract/legal material separately | AB#117 comment `59472`. Product identification is an inference, and deletion is an owner policy, not an observed deletion or automatic job. Confirm the account's actual product before applying product-specific backup terms; provider backup erasure and account-specific processor/terms review remain open. |
| Keep Hobby for now, reconsider later | AB#18 comment `59467`; [ADR-0004 amendment](../adr/0004-reference-production-host-and-ownership-boundary.md#amendment-2026-10-07-ab18-ab117--current-hobby-preference). This preference does not establish suitability for the paid photography content or a provider exception; resolve suitability before public activation. No upgrade is authorized by this checkpoint. |
| Mail now uses Infomaniak; old mail and Joomla/content backups retained | Owner's earlier session confirmation and AB#131 history. Neither a fresh mailbox audit nor restore test was performed today. Preserve current Infomaniak and Resend DNS records during any web cutover. |

## Ordered remaining operations

1. **Owner/provider launch gates:** resolve hosting suitability and remaining AB#117
   processor/terms/backup-erasure/Production-log boundaries. Record today's go/no-go
   against the unchanged October 15 deadline and the accepted AB#132 residual.
   Publish no new release merely because engineering PRs merged.
2. **Recovery before the first CMS change:** verify a complete recoverable baseline,
   raw-state and asset freshness for the actual Production dataset. Reconcile operator,
   read-only audit and temporary write principals; verify region/ownership handoff
   rather than assuming missing metadata proves it. No October 7 manifest is called
   fresh today.
3. **Contact privacy notice:** review the existing FI/EN proposal's actual fields
   (name, email, photography type, optional phone/date and message), processors and
   twelve-month practice; make the explicit scoped notice update. The local proposal
   is not a published CMS notice. After that change, capture a **new complete baseline**
   before bulk import because the old comparison is no longer current.
4. **Compatible serving renderer:** build or deliberately select the exact
   Production-configured compatible candidate and freeze its source, public inputs,
   artifact manifest and rollback target. Recheck ownership/protection, current aliases,
   route formats, noindex boundaries, contact delivery/Reply-To and AB#132 on that
   artifact. Complete applicable activation gates before publishing it to the existing
   public Vercel address; the September 24 renderer cannot read fourteen approved
   versions. If selecting today's source, the October 7 prebuilt upload is insufficient.
5. **Approved import:** repeat collision/quota/derivative/shared-asset guards against
   the post-notice baseline immediately before the write; import the approved categories
   and content in dependency order with a temporary least-privilege credential. Do not
   rerun the demo seeder. If using an already allowed phased manifest instead, identify
   its exact approved set and each deferred legacy path; no silent scope reduction or
   blanket redirect is allowed.
6. **Post-write verification and credential disposal:** retain write receipts and
   preserve old/shared IDs and assets for receipt-bounded rollback. Revoke the temporary
   write credential when the write operation ends; audit published/draft/release states,
   assets, filenames/private metadata and actual public derivatives with a separate
   read credential that can see those states. Verify imported route-facing adapters,
   galleries and pagination; verify revocation and runtime read access. An old-renderer
   alias restore alone is insufficient after the new-format import.
7. **Final public journeys:** finish AB#19's accepted legacy mappings and exact live
   targets, AB#141's physical-device checks, SEO/cache/robots/sitemap/canonical checks,
   final contact delivery and the tested compatible rollback/handoff. AB#137's content
   evidence and AB#19 feed AB#117; AB#117 must close before AB#18 promotion.
8. **Domain cutover:** export the current authoritative zones, preserve Infomaniak,
   Resend and all unrelated records, and change only intended web records after the
   launch gates. Verify TLS/canonical redirects and inbound/outbound mail afterward.
   Use the recorded DNS-dark fallback if the deadline decision requires it; do not
   assume Joomla remains available after October 15.

**NOT PERFORMED today:** Production promotion, CMS notice/bulk mutation, complete live
CMS/asset freshness audit or restore exercise, contact POST/mailbox delivery, credential
revocation, billing change, domain/DNS change, physical-device check or post-import
legacy verification. They remain operations with their own evidence and acceptance.

## Ten new independent review branches

These are a separate set from the eleven merged PRs above. Every new branch starts
from the observed main revision, is published with its same-named upstream, and keeps
its file changes uncommitted for the owner's editor review. AB#230–239 remain Active.
This table records scopes, not merged completion or a release verdict. Each gets the
requested one-time Claude plan review and bounded diff review; final local gate and
review receipts are handed off separately after all ten finish.

| Item | Branch | Independent boundary |
| --- | --- | --- |
| AB#230 | `fix/230-revalidation-response-boundary` | Strict cache-recovery acknowledgement bytes/UUID and safe operator errors; no invalidation. |
| AB#231 | `fix/231-intro-recovery-file-integrity` | Reject damaged/dangling recovery records without overwriting them; no CMS write. |
| AB#232 | `fix/232-curated-plan-input-integrity` | Strict input and owner-approval JSON before offline output. |
| AB#233 | `fix/233-sanity-query-response-integrity` | Fixed-origin query reads and strict response decoding; finite cache contract retained. |
| AB#234 | `fix/234-gallery-slice-response-integrity` | Browser gallery continuation byte/redirect refusal before slice validation. |
| AB#235 | `fix/235-resend-fixed-origin-delivery` | Refuse redirected contact/gallery notification POSTs; no live email. |
| AB#236 | `fix/236-preview-verifier-error-redaction` | Header-only verifier diagnostics and import safety; no protection change. |
| AB#237 | `fix/237-preview-alias-error-redaction` | Fixed unknown alias reconciliation errors; no alias mutation. |
| AB#238 | `fix/238-legacy-target-failure-memoization` | One exact target probe promise per run, including failure; source rows remain independent. |
| AB#239 | `chore/239-oct8-launch-checkpoint` | This documentation checkpoint itself; owner review/merge still pending. |

The worktrees are under ignored `temp/worktrees/<branch-with-slashes-replaced-by-hyphens>/`.
Earlier retired worktree data is preserved separately in ignored local storage; no
private migration artifacts are included in these PRs. The owner's next review can
start with the ten branch diffs and their supplied commit/PR texts, then the ordered
launch gates above. None of these small branch fixes alone authorizes domain launch.
