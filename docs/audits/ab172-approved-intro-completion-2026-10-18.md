# AB#172 — approved Production intro completion, 2026-10-18

The owner approved the exact remaining 12-article content transfer. It completed
at 08:58 UTC using the unchanged accepted intro writer from main
`33cb41ac44b3a395263fe5710ee78a238fb3e9e9`. All 12 articles now expose their
existing first paragraph as a listing-only summary; the paragraph was removed
from the body. No replacement text was authored.

AB#172 moved from Resolved to Active before the operation. It remains Active
pending acceptance and merge of this evidence. AB#137 remains Active for its
broader operational criteria; this checkpoint does not close a parent or grant
new content, customer-gallery, identity-migration or release approval.

## Approved scope and write

The content approval digest was
`4f1c7d6d1d2236606e3fa53d3ff3869d99e933f7552a15b17a4953ffc1e156da`.
The scope covered four VAT portfolio articles in Finnish and English and four
English travel articles. The owner's existing wording, including the disclosed
studio wording in the Finnish on-location excerpt, was preserved.

Fresh full-document reads, the unchanged digest and zero target draft/release
versions were required before writing. A short editing pause was announced;
other agents performed no concurrent CMS writes. No other user's roles were
changed and no claim is made that their sessions were disabled. The accepted
CLI was invoked with `--yes` exactly once: one transaction containing the 12
revision-guarded patches. Its actual exit code was 0. No content transaction was
retried; an uncertain outcome would require read-only reconciliation before
any separately authorized write. An independent read
confirmed 12 applied, zero pending and zero unexpected changes.

Each target changed only its `summary`, `summaryListingOnly`, first body-block
removal and provider revision/update timestamp. The other 108 article/gallery
documents remained identical. The earlier AB#297 scope still reconciled as
56 applied, zero pending and zero unexpected; it was not repeated. Eight pages
without a separable intro remain excluded; no summary was invented for them.

## Recoverable baseline and complete comparison

The before-write baseline retained all 21,231 raw documents and all 6,962 asset
binaries, totalling 12,105,783,610 asset bytes. A type-unfiltered export and raw
ID/revision/type indexes before and after it matched. Every preserved asset's
SHA-1 and size matched current Sanity metadata; SHA-256 matched the preserved
byte manifest. File identities remained stable while packaging. Every archive
member was read back and verified.

| Private recovery component | SHA-256 |
| --- | --- |
| Complete 12,155,320,320-byte archive | `2b06c8247d42d5f39af414fd9d14cf0ea419828d2a25664335e91b3666091ce1` |
| Credential-metadata supplement | `43c1382255b8ae050fa6c58150593b82bfcb639d6687d478cd7f267adb2c6299` |
| Final complete raw snapshot | `bec652a8aa5b24d21854a9db32984a8c30cca8985d9969ad10bf766f0d3fdd3d` |

The supplement binds a fresh complete raw snapshot to the original archive after
credential creation/removal changed only 11 system groups' provider revisions
and update timestamps. All 21,220 non-group documents and all asset metadata
were identical to the original baseline. This is a complete local equivalent
recovery set, not a standard Sanity importer archive. No isolated or live
provider restore was performed, and no assets were downloaded or uploaded.

The post-operation complete export again contained 21,231 documents with stable
before/export/after indexes. Besides the 12 approved targets, all 21,208 other
non-group documents were identical. The 11 system groups differed only in
provider revision/update timestamps; their members, grants and other content
were unchanged. There were no added/deleted documents or target versions.

## Temporary credential lifecycle

A separate project-scoped Editor writer was used with an explicit short expiry;
no Administrator writer, existing writer or runtime credential was borrowed.
The operation history contains two successful temporary writer creations, not
one: the first was revoked before any content transaction, and the second
performed the single approved transaction. Both were independently absent from
the token inventory afterward and their exact keys returned HTTP 401. All five
pre-existing robots remained unchanged. Writer secrets were never persisted or
printed.

The first creation request used notification suppression outside the documented
five-minute project-creation window and returned 403. No robot was found
for that request and the content CLI did not run. Current grants included token
creation/deletion; no role increase was required. The corrected request used
Sanity's normal administrator security notification, within the approved
credential operation, without sending a custom email or changing notification
settings. The original backend error body was not retained; the unsupported
request condition is verified independently, rather than inferred as a missing
account role.

The first successful writer was revoked when an overly strict operator check
expected immediate system-group membership changes. The corrected check accepts
unchanged groups or only the temporary subject's additions to the existing
Editor/write groups; all other changes fail closed. It also verifies the exact
project/Editor membership, bounded expiry, identity and current group/index
readset. Thirteen offline complete-flow cases passed, including unchanged and
allowed membership cases, rejected unrelated changes and cleanup on every path.
No real provider calls or credentials were used in that rehearsal.

## Published result and automatic invalidation

The site's promoted release used main `33cb41a`; Studio was published separately
by the release operator. Automatic Production webhook logs contained all 12
approved article IDs in the write window. Each had one successful HTTP 200
attempt with zero failures, delivered between 08:58:14 and 08:58:16 UTC.
The existing identity-only before/after envelope matched project, dataset,
operation and type. Its target was the existing `photosite-starter.vercel.app`
Production alias, not the canonical `www` origin. The release operator
independently bound both aliases to `dpl_Hzr1PEYsXPMKMmVXtKJG5KrGo9wv`
(`release/production-served.json` in the private release packet). This is actual
delivery evidence; no webhook was retriggered.

A separately authorized public-cache expiry ran at 08:59 UTC. It was followed
by 22 anonymous Production HTML GET checks, all successful:

- 12 detail pages began with the original second body block and had no separate
  lead or removed intro paragraph. Meta description, Open Graph description,
  Article JSON-LD description and canonical URL matched the approved result.
- Eight Finnish/English category listings included all 12 new excerpt cards;
  the existing Finnish travel excerpt witnesses remained present.
- Both Finnish/English story roots returned HTTP 200.

These checks establish the published server-rendered content, not a new
phone/desktop interaction or visual acceptance. They sent no cookies, executed
no browser JavaScript and posted no forms. No new application code, schema,
dependency, provider policy or service was introduced.

Private source documents, summaries, rollback template, complete backups,
credential records and raw HTML remain outside Git under the ignored
`temp/work-batch-2026-10-18-day/operational-preflight/approved-execution/` packet.
The exact content rollback remains a separately authorized, revision-bound
operation; none was attempted or made automatic.

Sources for the relevant provider behavior:
[Access API](https://www.sanity.io/docs/http-reference/access-api),
[GROQ identity](https://www.sanity.io/docs/specifications/groq-functions) and
[webhook messages](https://www.sanity.io/docs/http-reference/webhooks), checked
2026-10-18. The existing [operator runbook](../sanity-seeding.md#moving-imported-joomla-intros-into-listing-only-leads-ab172)
continues to govern future operations.
