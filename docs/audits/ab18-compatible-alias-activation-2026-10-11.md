# AB#18 — Compatible Vercel-alias refresh, 2026-10-11

Status: compatible activation verified on both existing Vercel aliases at
2026-10-11 19:26 UTC (22:26 Europe/Helsinki). Canonical launch remains open.

PR #334 was merged first by the Studio operator, followed by #335 after its green
CI. The completed operation reuses the tested Production artifact from `14b1af0`,
whose application source remains identical through `a9baefe` and main `770a0dc`.
It does not rebuild or promote a Preview artifact. The owner already authorized
compatible renderer activation in AB#18 discussion 60483. This bounded refresh
does not establish the full canonical launch or close any launch story.

The operation resolved the existing Vercel-alias indexing gate: both serving
aliases now return the new noindex rule. The activated candidate also includes
the merged branding, latest-story/service-image presentation, gallery continuity and legacy
redirect updates. Their difference from the previously served artifact is
recorded separately from the unchanged contact delivery and webhook receiver
code. Current-content candidate tests and prior alias-move observations support
compatibility; identical receiver code alone would not establish it.

Private preparation binds the two READY Production releases to the intended
owner-controlled Pro project, existing aliases, domain inventory, configuration
metadata, current raw CMS revisions and recoverable asset coverage. Concurrent
Studio drafts are preserved. Raw revisions must match before the first write;
later CMS drift is recorded for inspection rather than undoing a healthy renderer
activation solely because an editor saved a draft. A later main update or
independent latest-story query mismatch likewise requires inspection rather
than automatic reversal of otherwise verified aliases. No content, writer
credential or DNS mutation is part of this operation. The retained customer-gallery adapter remains off.

Promotion and the generated protected alias are checked separately. A project
promotion must not be assumed to move an alias previously assigned by hand.
The operator allows the short intermediate state only between those two known
releases and verifies both final alias destinations, the project target, noindex,
protection, content routes and browser behavior. CI deploys Preview and its alias
operator refuses an existing Production target; it does not authorize a
concurrent Production change. Fresh target/configuration and CMS revision checks
remain necessary around this operation.

The already completed protected-alias move and exact restore prove that alias
restoration path. They do not prove project rollback. A bounded emergency action
can restore only the two known aliases without overwriting an unrelated target;
it does not restore the project Production pointer, CMS, assets, caches,
credentials or sent mail. Ambiguous command acknowledgement and incomplete
readback remain failures even if a subsequent lookup happens to show a desired
target. The CLI waits for promotion completion; pending or unknown provider jobs
prevent emergency alias writes. Each eligible alias restore is attempted and
recorded separately. Any partial recovery is recorded as partial, with actual
destinations.

The separate project rollback/undo exercise is deferred to its appropriate
recovery scope. AB#118's monitoring, recovery and owner handoff criteria are not
completed here. Full canonical launch still requires the remaining AB#117,
AB#19, AB#131, AB#141 and customer-continuity gates. The known AB#132 scriptless
404 failure and pending route decisions are retained. The October 8 residual
review was performed; the exact `14b1af0` candidate was retested on October 11
and both an unknown URL and a refused gallery cursor returned HTTP 404 with
zero rendered `main`, `h1` and anchor elements. These are two known failures,
not semantic passes or a renewed risk acceptance. The final launch review must
still record the existing bounded decision's applicability. No custom web DNS is
changed and Infomaniak mail routing is preserved.

A fresh root dependency audit reports zero vulnerabilities. A separate Studio
audit identifies the `sprintf-js` advisory GHSA-hp3w-g68c-fv3c: eight moderate
dependency-chain findings, corresponding to one advisory. Studio is absent from
this prebuilt web artifact. This is a newly recorded follow-up, not a dependency
fix or a clean Studio audit.

Private operator modules, raw CMS data and provider/browser receipts remain
outside Git. Independent review explicitly included all seven ignored modules
and ended with a clean round 7 after the owner-authorized extension and explicit
reassessment of the concurrent documentation-only main merge. The observed
routing changes are recorded below. Final public alias verification passed;
fresh mail delivery and genuine webhook delivery remain pending.
AB#18/117/137/250 remain Active; AB#118 remains New.

Refs AB#18 AB#117 AB#137 AB#250

## Observed first activation attempt

The acknowledged CLI promotion moved the project Production target and both
aliases to the candidate. The operator then rejected the settling read because
the ordinary project API response omitted the promotion job state. It restored
both aliases to the exact previous release; both restore commands were
acknowledged and their destinations verified. The project Production target
remains on the candidate. Configuration, raw CMS revisions and source remained
unchanged. This is partial alias recovery, not a project rollback or completed
public activation.

The installed CLI and an independent read confirm that `rollbackInfo=true`
returns the terminal succeeded promotion job. The recurring detector correction
was delegated to Claude. The prepared resume accepts only the original operation
receipt proving that exact state, the unchanged configuration/raw CMS and the
matching terminal job. It moves only the two verified old aliases to the same
candidate; it does not repeat project promotion or alter project settings. All
original operation and recovery receipts are preserved.

## Subsequent alias-only attempt and browser diagnosis

Both alias moves were acknowledged and verified. All 14 public and 14 protected
GET cases passed, including alias noindex, service prices and independently
compared latest stories. The browser check then timed out while closing a
reopened viewer. Both aliases were restored to the exact previous release, with
acknowledged and verified recovery for each; the project target remains the
candidate. Configuration, CMS revisions and application source stayed unchanged.

Read-only diagnosis against the same protected candidate reproduced the timing
problem in Chromium and mobile WebKit. Reopening succeeded, but keyboard focus
arrived after about 425 ms, later than the test's fixed 400 ms delay; Escape was
sent outside the dialog. Waiting for focus inside the viewer, as the existing
CI lightbox helper does, passed the complete reopen-and-close sequence in both
engines. The corrected private smoke now waits for that observable focus state
and actual dialog removal. No application code changed.

After the original five diff rounds, including a Claude-authored recurring
job-state correction, the later browser-test correction was self-checked but
not yet independently reviewed. The owner then authorized the necessary
additional review rounds. Round 6 completed after a corrected-context retry read all 86
authoritative comments, with no blocking findings. A concurrent main update
from PR #336 then stopped the third attempt before any provider write. That
update records the Studio merge and Closed status only; its complete delta was
checked and contains no application or runtime-configuration change. The
reassessed operator keeps the original HEAD, original receipts and immutable
comparison point, pins the new main `770a0dc` separately and verifies its
application/configuration delta is empty. Round 7 independently reviewed that
correction, the complete authority and all seven exact operator copies with no
findings. A matching seal preceded the
separate fourth attempt; earlier receipts and rejected attempts were preserved.

## Verified final activation

The alias-only operation completed at 19:26 UTC. Both alias commands were
acknowledged and their candidate destinations passed consecutive readbacks:
`photosite-starter.vercel.app` and
`photosite-starter-ilkka-rytkonens-projects.vercel.app` now target
`dpl_6e4xtTvbq7Zd39g3mmp9AVNL7KYF`. The project Production pointer targets the
same release. Its source is `14b1af09da443ee52248b94535c286be31f8fd10`;
its application source remains unchanged through worktree HEAD `a9baefe` and
main `770a0dc`. This final operation made two alias writes, with no new project
promotion or project settings write.

All fourteen public and fourteen authenticated protected-alias GET cases passed.
Every checked alias response returned `noindex`; the disabled synthetic customer
route also retained `nofollow`, `no-referrer` and `no-store`. Seven exact service
prices, the legacy wedding-package redirect and the two latest-story titles
against a separate published CMS query passed. Anonymous access to the generated
alias still redirected to Vercel authentication. Auto-assignment and existing
protection were preserved.

Chromium at 1440×1000 and mobile WebKit at 390×844 passed native-ratio header/footer
logos in both themes, lightbox open/next/close/reopen/close and no horizontal
overflow. These automated observations are distinct from the owner's earlier
physical iPhone test on `dpl_6PCmpGqTX6MaYLaEMnSrjrmnrRjF`; that earlier test is not
inherited as a physical test of this candidate's changed lightbox code.

Final provider configuration, raw CMS revisions, source guards and independent
latest-story comparisons were unchanged or verified. No manual inspection flag
remained. Eleven focused transition tests passed before execution. The approved
operator scope was checked against its clean review hashes immediately before
apply; these final outcome paragraphs were then self-checked against the durable
receipts. Application code, dependencies, CMS documents, writer credentials and
web/mail DNS were not changed. The retained customer-gallery runtime stays off.

Next gates remain the supported whole-ZIP transport decision, fresh contact and
genuine webhook delivery, the distinct recovery/monitoring/handoff exercise,
remaining launch decisions and DigitalOcean access for canonical web cutover.
This audit records completion of the compatible existing-alias stage only.
