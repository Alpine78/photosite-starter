# AB#273 — current launch acceptance evidence, 2026-10-13

AB#273 moved New → Active before file changes, under AB#18. This is a read-only
follow-up after #378–#381 merged. It refreshes evidence and orders the remaining
steps; it performs no promotion, rollback, DNS change, CMS write or risk acceptance.

## Recovery baseline after worktree retirement

A fresh raw Production scan completed at **16:50:47 UTC**. The complete before/after
revision manifests matched the paged documents: 17,609 documents and 5,158 assets.
The raw snapshot SHA-256 remains
`379ff9e99232bd8ad73475b0bff62e5616b10b4aebfdd50a8de26140e9a879cc`.

The preserved local recovery receipt completed at 14:44:22 UTC has that same snapshot
hash, 5,158 asset identities and 2,436,624,774 asset bytes. It records actual local
byte recovery/readback and 13 additions. Its archive SHA-256 is
`5550b8fd50f115f51ea9a8ce8102929753c3322ffd102a7b667296b6ba32ea70`.
The receipt explicitly says provider restore was not performed and does not itself
assert snapshot completeness; the separate stable full raw scan supplies current
capture evidence. Matching hashes establish that this local baseline still corresponds
to the current dataset, not that a Content Lake restore or deployment rollback succeeded.
Any subsequent write invalidates that freshness claim and requires a new baseline.

Six unused, clean, exact-head merged worktrees were retired after inspecting ignored
files and active processes. Their 20,814 operational/private/source files were moved
under ignored `temp/retired-worktrees-20261013-launch-followup/`, with before/after file
hashes, modes and timestamps verified. Each retained `retirement.json` maps historical
paths to their new locations. Historical receipts are unchanged. New operations must
rebase input locations in new plans instead of rewriting old receipts. Branch refs remain.
Two older checkouts remain: one is used by live Studio/browser processes; the other has
a post-PR local merge commit not proven integrated into main. No force deletion occurred.

## Provider source and rollback boundaries

Fresh GETs of the Vercel project and deployments confirm the current Production target:

| Evidence | Current observation | Result |
| --- | --- | --- |
| Project Production target | `dpl_6e4xtTvbq7Zd39g3mmp9AVNL7KYF`, READY | Available, not final-source approval |
| Production source metadata | `14b1af09da443ee52248b94535c286be31f8fd10`, `gitDirty=1` | AB#268 gate refuses `SOURCE_DIRTY` |
| Previously inspected Preview | `dpl_Fhf384pq5MZLqsBk2EW75bMn6pMy`, READY, source `5b4f64d062483d20f8ecb5a043b65caa72444741` | Gate refuses `SOURCE_CLEANLINESS_UNKNOWN` |

The Preview GET proves that exact deployment is available, not that it is the current
alias, a compatible known-good version, or an accepted rollback target. Both source-gate
receipts leave artifact provenance, protection and canonical launch verification false.
READY availability is not an exercised recovery or a retention guarantee.

AB#272 / [PR #382](https://github.com/Alpine78/photosite-starter/pull/382) attests the clean
checkout before Vercel build and upload and sends explicit source/cleanliness metadata.
Its final-head CI passed at commit `2fb6f646527076809829fa65cfe8a13e8390cddd`.
After integration, inspect the newly created candidate with AB#268 again; existing provider
metadata is not retroactively certified. Even an affirmative source gate is not byte-level
artifact provenance or compatibility proof. Fill the existing
[rollback exercise record](../rollback-exercise-record.md) with an actual accepted exercise
against the final source and published content. Application rollback does not restore CMS,
assets, caches, credentials, DNS or already sent mail. A retired Joomla host is not a
recovery target; record the chosen web-only fallback and preserve mail records.

## Fresh dependency evidence

Current network-backed npm audits on the checked-in lockfiles show:

| Package root | Audit result | Interpretation |
| --- | --- | --- |
| Public application root | Zero reported vulnerabilities | Dependency-audit result, not whole-system approval |
| Studio | Eight moderate affected dependency nodes, zero high/critical | The same `sprintf-js` advisory propagates through the dependency graph |

The installed path includes `sanity@6.18.0 → @sanity/cli@8.16.0 →
@vercel/frameworks@3.29.0 → js-yaml@3.15.2 → argparse@1.0.10 → sprintf-js@1.0.3`.
The [reviewed advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) describes a
format-string precision denial of service, affects versions through 1.1.3 and lists no
patched release. [Dependabot alert #66](https://github.com/Alpine78/photosite-starter/security/dependabot/66)
remains open against `studio/package-lock.json`. The root application lockfile does not
contain this dependency, but that does not establish the full Studio exposure boundary.
This follow-up did not trace every Studio input to the affected call or approve the risk.

npm's proposed fix changes Sanity to 5.14.1, a major downgrade from the pinned Studio 6
line. It was not applied. A safe reviewed upstream change, validated scoped mitigation,
or explicit accepted residual risk is still required for the final security decision.
No advisory was dismissed and no vulnerable version was described as patched.

## Ordered continuation on the final candidate

1. Integrate the reviewed clean-source attestation, publication operator and legacy
   decisions. The worktrees start independently from merged `15918b9`; their local
   results do not approve an arbitrary later combination.
2. Accept the six private English copy items, publish the category/service slice and
   then the previously approved article drafts using concrete revision-bound plans,
   current recoverable baselines and a dedicated temporary writer. Prove full-dataset
   readback, public locale coverage and writer revocation separately.
3. After actual English publication, promote the six specifically identified legacy
   fallbacks to exact published counterparts and rerun all 415 mapping checks. AB#271
   already passes all 415 against a local real-CMS production build; it does not claim
   the old Production artifact passes or that fallback constitutes translation.
4. Freeze the integrated source SHA, require its full CI, build a clean owned candidate,
   read back provider identity and verify protection/noindex, final canonical route
   behavior, contact delivery and CMS publication/cache behavior on that exact version.
   Existing real delivery/publication tests remain historical evidence for their own
   source versions; a source change is not silently accepted by an earlier receipt.
5. Select and verify a compatible known-good recovery target using actual account
   entitlements and current CMS/media representations. Perform and record the chosen
   rollback/restore exercise, including cache reconciliation and independent read/write
   credential cleanup. Obtain the final owner security/privacy and operational acceptance.
6. Keep AB#250 blocked on a durable Sanity staff confirmation of supported unchanged
   whole-ZIP ingestion/delivery under the existing subscription. Discord has no answer.
   The successful synthetic Preview upload does not close that gate. No real customer
   ZIP was uploaded, split, recompressed, omitted or moved to a new paid provider.

Provider bodies, current raw content, dependency packets and recovery receipts stay in
mode-0600 files under mode-0700 ignored directories. No credentials, personal contact
details or customer source content are published. Documentation links, exact counts and
receipt hashes were checked against the private artifacts. This documentation-only
change requires no new runtime tests; final-head CI remains the integration gate.
AB#18, AB#19, AB#117, AB#137, AB#250, AB#255 and the new review tasks remain unaccepted
until their own remaining conditions are met. AB#118 remains open for the actual exercise.
