# Synthetic client-gallery lifecycle rehearsal — 2026-10-24 (AB#401)

**Result: the rehearsal completed with failed editor-identity and mail-acceptance
checks; activation remains blocked.**
This was a separately owner-authorized operational test, not a customer migration,
hosted Studio acceptance or Production activation. AB#401 is Active pending review
and merge; AB#395, AB#392 and AB#130 remain Active.

## Source, target and containment

- Tested application/Studio source: `42a462b141c5c199949e52e2866b7bdd00561733`
  (main after PR #616). This did not test PR #617's subsequently merged browser focus change.
- Target: the existing configured public Sanity dataset, with its identity checked
  against the local Studio/Production configuration. Target fingerprint:
  `968733d05f96d0774e26a52f090ab2117e9c6ad0c1f80e87418c3456e6983e72`.
  The synthetic published documents and image bytes were publicly readable during
  the test, just like other unlisted Sanity galleries. Dotted private records
  required authentication; the anonymous private-canary read was withheld.
- One isolated Next.js production build served only on loopback. Actual Sanity
  reads, writes, asset upload and deletion ran against the provider. HTTP assertions
  exercised the application routes; no browser screenshots, traces or raw exports
  were retained. Actual credentials were supplied only to the guarded runtime.
- Four uniquely named read canaries and three fresh 256 × 160 full-frame WebP
  images (56,210 bytes total), visibly marked as synthetic test material. Asset
  content hashes, dimensions, prior absence and new creation times were checked.
  No customer photograph, camera master, customer address or pre-existing customer
  gallery changed.
- Two temporary project robots, Viewer and Editor, with a lifetime below three
  hours. The owner's existing personal Sanity CLI session performed proof
  publication, the independent read-only postflight and the creation/revocation of
  the robots; this was not the temporary Editor grant. It was also **not** a
  separate non-admin Editor-role human session: publication identity and
  permission behavior for that intended user class remain **untested and
  unverified** before activation. The plan review's suggested Editor-robot publication was declined because
  the accepted design required an editor user session. The later unexpected robot
  identity result did not lead to a robot publication attempt.
  Built-in Editor was used only inside the synthetic allowlist; it is **not** an
  acceptable narrow cleanup write credential.
- A lowest-level fetch guard in the operator and server processes restricted
  hosts, paths, exact document IDs, asset bytes, revisions and recipient. An fsynced
  write-ahead journal recorded intentions before writes, without secrets or bodies.
  Offline guard tests included an independent child process. No native release
  action, query deletion, paid plan change, persistent role change or deployment
  promotion was performed.
- The complete dataset snapshot was used unchanged by the cleanup runner: no
  filtering or cursor-ID remapping. Before invoking it, fresh reads established
  that no foreign new-delivery/proof galleries or active cleanup controls existed.
  Its real global cursor was absent, explicitly added to the test allowlist,
  created with the run's ownership marker and removed during cleanup.

**Scope deviation for owner review:** AB#401 says "no global sweep". The test
used the ordinary dataset-wide runner after the isolation checks above, rather
than an exact-ID iterator. This was broader discovery than that wording describes,
even though only the synthetic control was eligible and the independent write
guard allowed only exact synthetic IDs. No pre-existing cursor was touched. This record
does not silently treat that deviation as accepted.

Existing webhooks were inspected before writes: the two enabled document hooks
were revalidation hooks whose filters excluded these synthetic types and assets.
No webhook configuration changed. Temporary-robot creation can itself generate
Sanity account notifications; this was not a silent account operation.

## Observed results

| Check | Actual result |
| --- | --- |
| AB#399 bounded export/Doc transport | Passed known-copy reads of published, dotted private, draft and raw version canaries, plus one explicit missing-ID omission |
| Export size/time | 24,079,826 bytes; 21,237 documents; 24,270 references; largest line 126,812 bytes; 10,406.18 ms including transfer/parsing |
| Anonymous private read | Private canary withheld |
| Viewer write probe | HTTP 403 |
| Editor forbidden-type probe | HTTP 200 in **dry-run**; independent read proved no document was committed. Editor is broader than the required cleanup write grant |
| Stale revision / strong-reference deletion | Actual provider rejection and atomic rollback in both synthetic cases |
| Proof publication | Actual publication endpoint committed the gallery and private terms; FI and EN proof HTML returned successfully |
| Selection authorization | Incorrect selection key returned 404 |
| Durable selection | Two selected proofs, one included, EUR 1.00 extra; immutable v1 and confirmed working state read back successfully |
| Photographer notice | Failed; Resend returned HTTP 400. Confirmation stayed committed and notice state became `failed`. See the credential limitation below |
| Replacement publication | Real Studio review/publication modules published delivery and removed the proof/private unit plus its unused proof image atomically; old proof page 404, delivery page 200 |
| Deadline / renewed enrollment | Ordinary reviewed publication changed the synthetic deadline into the past with renewed cleanup consent; page returned 404 |
| Open draft at run start | A draft created before the pass blocked cleanup: one blocked result, zero destructive attempts. This did not exercise a concurrently arriving draft |
| Expiry cleanup | After guarded removal of that draft: examined 1, attempts 1, completed 1, deleted assets 1, shared assets 1; skipped/blocked/conflict/refused/uncertain all 0; pass completed and cursor write acknowledged |
| Post-delete evidence | Gallery and unshared image absent; shared image retained; exact completion receipt matched; duplicate pass made zero destructive attempts |
| Robot/user-session assumption | **Failed:** the Editor robot passed the current `verifyEditorSession` check against the project API's `/users/me` |

The replacement-publication transport prepended operator-only revision assertions
for every asset deletion. The real Studio review and publication logic ran, but
this stronger transport is a test deviation: it does not establish that ordinary
hosted Studio publication has identical asset-revision protection.

The version canary was a raw `versions.…` document. No Content Release metadata,
scheduling or release publication was created or exercised. These results do not
establish native-release workflow acceptance.

## Findings and checks still required

1. **Narrow credentials:** Viewer could read the named canaries and could not write;
   Editor could dry-run a forbidden proof-type write. Neither result proves the
   complete grant matrix. No custom role was observed and the inspected project
   features did not list `advancedRolesManagement`; feasibility on the current plan is
   unproven. Meeting this requirement may need a provider capability/plan change
   or a separate owner-approved revision of the credential boundary. Neither a
   paid upgrade nor accepting a broad token is authorized by this rehearsal.
   Establish an accepted actual role and
   complete private/all-version READ plus restricted WRITE before activation;
   do not substitute the tested Editor credential.
2. **Editor identity:** the current nonempty-ID `/users/me` check accepted a real
   robot. The source comment and earlier documentation claiming that this alone
   proves a human user session are disproved by this test. Reconcile the endpoint
   and identity contract with Sanity and add a regression before relying on that
   boundary. Follow-up **AB#402 — New**, under AB#130 and Related to AB#401, tracks the supported
   identity contract, regression coverage and misleading source comments. This
   test did not attempt robot publication or establish a new
   unauthorized-write path; provider permissions still govern writes.
3. **Mail:** the cached local `RESEND_API_KEY` was subsequently verified to be
   a Vercel Sensitive placeholder, not a usable Resend credential. The
   configured Production key is Sensitive/Secret; it was not read back or changed.
   [Vercel documents Secret values as write-only](https://vercel.com/docs/environment-variables/sensitive-environment-variables).
   The provider response body was not retained, so its exact error code is unknown.
   HTTP 400 establishes failed-notice handling, **not** a Resend outage
   or successful delivery. A real local test credential and a new explicitly
   synthetic confirmation are needed for provider acceptance, followed by mailbox
   verification. No resend of the failed immutable version was attempted.
4. **Hosted boundaries:** no hosted Studio sign-in/CORS/FI/EN keyboard workflow,
   browser selection interaction, native scheduled publication, hosted 200-second
   function allowance, scheduled cron invocation or reminder email was tested.
   Controlled writers, genuinely concurrent publication/deletion and draft arrival,
   late weak-reference races, all-version ACL coverage and
   lost-response reconciliation retain their separate acceptance requirements.
   No new-gallery ZIP was created: authoring/transport remains ADR-0035.

The readiness report remains `readyToActivate: false`, `readyToDelete: false`,
`fullReadGrantProven: false` and `writeGrantsVerified: false`. Its seven remaining
check categories were not programmatically cleared by the later scoped tests.
The lifecycle report's `completed: true` means the rehearsal finished, not that
all activation criteria passed.

## Cleanup and retained evidence

Lifecycle operations already removed the proof and expired delivery units and two
unshared images. Final operator cleanup removed the remaining eight synthetic
documents and shared image, revoked both temporary robots and independently
verified zero remaining allowlisted documents/assets/robots. No cleanup error or
retained test asset remained. The loopback server stopped and the temporary-token
lease file was removed. Sanity history/backups, CDN caches and copies already
delivered are outside this deletion claim.

The original cleanup report re-read documents and robots; its image-deletion
result alone was an acknowledgement. A separately retained **read-only postflight
at 18:14:39 UTC** subsequently checked all 23 allowlisted IDs, including all three
image assets, through raw Doc API requests independent of the adapter under test:
23 explicit existence omissions, zero documents/assets remaining. A complete robot
inventory also found zero test robots; the token lease and server PID were absent.

This run issued no Production environment-variable or deployment command. A
retained read-only postflight at **18:23:53 UTC** observed the same Production
deployment and source `90543d55a7f22680c7c48e13bd4895422f2d5a36` as before the run,
predating these gallery features; new-gallery/proof/cleanup runtime keys were
still absent. This comparison does not attest every unrelated environment value.
The local real-provider exercise must not be described as hosted activation.

Private operator evidence is retained outside the disposable worktree under the
primary checkout's ignored `temp/client-gallery-rehearsal/` directory (directories
0700, files 0600). It includes the exact executed harness, allowlist, fsynced
journal, generated image bytes and closed reports. It contains no saved raw
dataset export or remaining temporary-token lease. It is **not** a shipped command
or a CI test. A new run needs a new review, allowlist and recovery plan.

SHA-256 identities of the retained evidence:

| Artifact | SHA-256 |
| --- | --- |
| Executed-harness manifest | `d5c0ad5659097704937eb76d6b49a58d992265338888069e2ffa27efbaa264f4` |
| Phase 1 report | `11d848995bc2baea0d61dbe70c75cb3c9d8ec93e4263f8cfeeb0e445d73c8d1e` |
| Lifecycle report | `c6834f4aa149632d0bfeb5d2b651e3c7b22e6a7b8b5657e1aa7f3c362fdfd0e0` |
| Cleanup report | `72793f69395b8e049e0f20cc2eb46d19fa14d0238c0509f0aaa4a3f35a651e7e` |
| Independent read-only postflight | `574b303708bfcbd100fbc9ead5541e99fe8757ccc22a5e7e12f2386c4a65805a` |
| Production metadata postflight | `ddcc09c86e893154416382432659dd4070069620797deba93cbe1b4ab5027a7b` |

The offline guard and both operational Vitest phases each passed their one test;
the isolated production build also passed. Their assertions intentionally record
negative readiness observations rather than requiring activation readiness.
This evidence-only change does not replace the existing application CI gates.
