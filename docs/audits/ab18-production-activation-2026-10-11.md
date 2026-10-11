# AB#18 — Current-source Production activation preparation, 2026-10-11

Status: protected candidate prepared and checked; public activation remains open.
One nonsecret Production setting was added and a protected alias move/restore
was exercised. No public activation, CMS write or DNS change was performed. AB#18, AB#117, AB#137, AB#250,
AB#132, AB#19, AB#131 and AB#141 remain Active.

The release source is main `14b1af09da443ee52248b94535c286be31f8fd10`.
Exact main CI #789 succeeded. This is the source for a separately built
Production artifact, not a claim that CI built that artifact.

The intended owner-controlled project is `prj_0vIoxeCmUwHIISWdih69dh9vTQA0`,
team `team_gcO5cgAyzs6vBuKqYgLNa69A`. Both existing Vercel aliases initially
serve `dpl_44SDGwpPtrcZDTFDAHLTBLvHBneU` from source
`8e3efe625d03726ff5db04e57da3b8a6b9e83bc7`. The custom domain remains on
Joomla; Infomaniak email routing is outside this operation.

The first provider change created only the nonsecret, Production-scoped
`PRODUCTION_NOINDEX_ALIASES` setting for the two current Vercel aliases.
An existing setting, unexpected attached domain, concurrent configuration
change or target change stops that operation. It does not alter an existing
artifact. Build inputs remain explicitly allowlisted public settings; runtime
credentials are not decrypted into the build.

The staged artifact must be built for Production and verified against every
uploaded prebuilt archive member. The pinned CLI's resolved tracing and
Turbopack roots must equal the clean worktree, and every mapped runtime input
must remain inside it. A fresh lockfile installation avoids parent dependency
resolution. Source, settings and artifact manifests bind the staged output.

Any test of moving the protected generated alias and restoring its exact prior
UID proves only that alias restoration path. The default public alias and
project Production target stay unchanged during it. It does not prove project
rollback, CMS recovery, credential restoration or customer handoff. Public
activation needs a separate, concrete assessment of that distinction, current
content compatibility and the old artifact's missing alias noindex behavior.

Legacy customer galleries must remain disabled. Their supported whole-ZIP
transport, actual import, notice/usage/recovery evidence and continuity remain
open. The prepared wedding-overview listing change remains deferred until the
public renderer is compatible and a fresh recoverable CMS baseline and reviewed
revision-guarded two-document operation are available.

Private operator code, credentials, source receipts and browser artifacts remain
outside Git. Independent operator review precedes provider mutations. The operator scope received a clean third-round independent review before
provider writes. The evidence additions below were self-checked against completed
receipts afterwards; the earlier review is not attributed to these later observations.

The exact-candidate AB#132 recheck is now recorded below; its accepted residual
still requires final release reconciliation. Fresh contact delivery and genuine
webhook delivery, AB#117 final finding closure, and rollback evidence appropriate
to the actual activation operation remain open. The protected-alias exercise
must not be substituted for project promotion/rollback evidence. Pending AB#19
route decisions remain a full-launch gate. The exact source main CI is green
and the fresh full dependency audit reports zero vulnerabilities. Full launch also
requires DNS and customer continuity; none is implied by this preparation.

This preparation is scoped separately from the full canonical launch. The full
canonical launch remains gated by Active AB#131 (mail and DNS retirement and
recovery: its final account, backup, contract, retirement and runbook criteria
remain open) and by Active AB#141 (real-device lightbox evidence completion).
For AB#141, the owner already reported extensive physical iPhone testing on the
earlier Production deployment `dpl_6PCmpGqTX6MaYLaEMnSrjrmnrRjF`; this record does
not imply that testing was absent, and it does not claim any physical test of
this candidate. The Infomaniak mail routing named above is unchanged by this
operation and is not a new missing migration; AB#131 continues to govern it.

The Vercel hosting tier was upgraded to Pro, as confirmed in AB#18 comment 60483.

Refs AB#18 AB#117 AB#137 AB#250 AB#132 AB#19 AB#131 AB#141


## Completed observations

The READY Production-target candidate is `dpl_6e4xtTvbq7Zd39g3mmp9AVNL7KYF`
at `photosite-starter-wez1iydhj-ilkka-rytkonens-projects.vercel.app`. It is
protected by the existing project policy. Its manually built source is the exact
CI #789 main revision above. The 330 output entries and 405 mapped runtime
inputs match all 735 uploaded archive members, with no extra, missing or changed
member. The build used Node 24.20.0, Next 16.3.8 and CLI 61.0.0; tracing,
Turbopack and repository roots all remained inside the dedicated worktree.

Thirteen current-content GET cases passed. Each owner-requested price was
verified in its named service card, and the actual two latest-story cards matched
an independent published query. Desktop Chromium and mobile-viewport WebKit
passed branding, language choice and lightbox open/navigate/close/reopen checks,
with no horizontal overflow. This is automated browser evidence, not a new
physical iPhone test. The wedding overview is still listed pending its separate
CMS change.

The 415 legacy registry cases and 131 target probes passed their decided
expectations. The 48 pending decisions returned 47 HTTP 404 responses and one
HTTP 308; these observations do not decide their mappings. Invalid contact and
webhook POSTs returned 403 and 400 before delivery; no email was sent and no
genuine webhook delivery was tested. Two scriptless requests returned HTTP 404
with zero main, h1 and anchor elements, reproducing the AB#132 semantic failure.
The previously accepted risk and upstream follow-up remain separately recorded;
this is not a new accessibility pass or a complete launch approval.

The protected team alias was assigned to this exact candidate, ten route cases
were inspected, and the alias was restored to its prior exact UID. Both CLI
assignments succeeded and each settled target was observed twice. Its tested
candidate responses carried noindex, including robots and sitemap; the disabled
synthetic client-gallery route also carried nofollow, no-referrer and no-store.
The public default alias, project Production target and runtime metadata stayed
unchanged. Final readback at 17:10 UTC confirms both assigned aliases again point
to `dpl_44SDGwpPtrcZDTFDAHLTBLvHBneU`. The default public alias still serves the
old artifact without the new noindex header; adding a build-time setting does
not change that existing artifact.

A stable read-only raw Production baseline captured 16,947 documents and 5,158
assets. Asset recovery coverage includes the verified prior archive and unchanged
original copies for the newly added derivatives. Compared with the earlier
16,945-document preparation it includes a Studio schema document and an owner's
site-settings draft, plus two changed published documents. The draft is preserved;
it is not overwritten or deleted. This baseline is preparation evidence, not a
substitute for another freshness check immediately before a mutation or an
exercised restore. No write credential was minted. The two revision-bound
wedding-overview patches remain non-writable and unapplied.

Supported intact ZIP transport is still unestablished. Previous large-file
upload/download observations are retained, but they do not establish the provider
contract. No customer assets or documents were imported, no legacy-gallery flag
was enabled, and the canonical domain and Infomaniak routing were not changed.
All named Active work items remain Active; no state transition occurred here.
