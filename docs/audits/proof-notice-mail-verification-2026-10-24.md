# Synthetic photographer-notice verification — 2026-10-24 (AB#403)

**Resend accepted one synthetic notice with HTTP 200, and its private notice
record became `sent`; the owner subsequently confirmed mailbox receipt.** This resolves the local provider-acceptance gap left by
[AB#401](client-gallery-lifecycle-rehearsal-2026-10-24.md), whose failed HTTP 400
attempt used an unusable cached Sensitive placeholder. It does not change that
historical result or establish the cause of its HTTP 400.

AB#401 is Closed after PR #618. AB#403 is Active pending review/merge; AB#130,
AB#392 and AB#395 stay Active, and the separate identity correction AB#402 is New.
**Gallery activation remains blocked.**

## Exact scope

Tested source: `e5aff4ec79cfa262899fbd3147a490b385996736`, main after PR #618.
The operator invoked the real `planConfirm`, `deliverProofNotice`,
`buildProofNoticeSender` and `sendResendEmail` modules against real Sanity and
Resend. An in-memory, operator-prepared gallery descriptor supplied two synthetic
proof numbers and filenames; it was **not** a published or independently validated
gallery. Fresh provider revisions guarded the actual private confirmation
transaction. Customer HTTP authorization, browser interaction, publication,
Studio, hosted execution and non-admin human Editor permissions were not tested.

Exactly four new, uniquely named dotted private records were created: synthetic
terms, working selection, immutable v1 and its pending notice. No public gallery,
image, reminder address, cursor, export, role or robot was created. The existing
owner personal Sanity CLI session performed the store operations; this is not
evidence for a restricted runtime credential or a non-admin human Editor.

The owner supplied a private local Resend credential. Its file was checked for
current-user ownership, regular-file status, restrictive permissions and a
non-placeholder value. The key remained in memory during the send; it was not put
in process arguments, child environments, builds, reports or commits. The existing
photographer from/to values came from local deployment configuration, without a
CMS settings query. Owner-supplied credential files remain under owner control.

The one-time Claude high plan review preceded live writes. Implemented refinements
included a complete fake-provider rehearsal of the actual modules, independent
FI content assertions, a durable exclusive send-intent file and explicit
revision-patch-plus-delete cleanup transactions. The inspected modules and raw
store transport use the guarded fetch path; no Sanity SDK or CLI ran in the live
test process. A separate low-level socket interception layer was not added.

## Observed results

| Check | Result |
| --- | --- |
| Pre-write provider metadata, 20:18:15 UTC | Two enabled revalidation hooks had exactly the previously reviewed filters, excluding all four test types; Production had no new gallery/proof/cleanup runtime keys |
| Offline guard/module chain | 4 tests passed, including the complete real planner/sender chain with fake services, foreign IO and malformed writes, placeholder refusal, and persistent exclusive-send-intent refusal |
| Existing source tests | 43 tests passed across `proof-notice.test.ts` and `proof-selection.test.ts` |
| Confirmation | Real guarded transaction committed v1 and a pending notice; fresh reads found the confirmed working selection, two selected proofs, one included and EUR 1.00 extra |
| Email content | Independent literal checks covered FI subject, job/version, counts, price and both proof numbers/filenames; the guard bound the exact synthetic payload and configured single recipient |
| Resend, 20:19 UTC | Exactly one POST; HTTP 200; no network uncertainty or live guard refusal |
| Durable outcome | `deliverProofNotice` returned `sent`; a fresh raw Doc read found notice state `sent`; the immutable version remained unchanged |
| Duplicate handling | A second invocation on that sent notice returned `not-pending` and caused no second Resend request |
| Stored privacy | In-memory checks found none of the configured sender/recipient strings in the four raw records |
| Cleanup | Four revision-reviewed records removed in one transaction; four subsequent explicit existence omissions; no uncertain store write |
| Independent postflight, 20:20:49 UTC | A separate GET-only reader found all four IDs absent; the same Production deployment/source and absent gallery/proof/cleanup keys were observed |

The live Vitest invocation completed in 7.18 seconds. Test completion and `sent` mean the
application recorded provider acceptance. **They do not establish mailbox receipt.**
The captured report recorded `mailboxReceiptVerified: false` before the owner
responded and is preserved unchanged. On 2026-10-25 the owner confirmed that the
synthetic message arrived. That confirmation is recorded separately in private
`verification/owner-receipt.json`; receipt is owner-reported, not inferred from
HTTP 200 or independently inspected in the mailbox.

## Containment, cleanup and limits

All store writes required exact allowlisted IDs and revision guards; creates
required prior absence. The guard admitted only those Doc reads, the fixed mutate
endpoint and the single Resend endpoint, with credentials bound to their service.
Redirect following, other origins, query deletion and alternate create operations
were refused. An fsynced journal preceded IO, and an exclusive send-intent file
plus directory fsync prevented another attempt even after process-state reset.
No automatic retry or resend of AB#401's failed notice occurred.

Preflight initially stopped on the API's `rule.filter` response shape; those
attempts were reads only. The corrected check compared the actual filter strings
with the previously reviewed expressions before any test writes or mail.

This run issued no Production env or deployment command. The postflight compares
only the recorded deployment/source and relevant key names, not every unrelated
environment value. The runtime process exited; no new token or server needed
revocation or shutdown. Sanity history/backups and Resend's retained synthetic
message remain subject to their existing retention; removing test records cannot
withdraw an accepted email. The owner's mailbox has its own retention.

The local credential and module-level result do not verify the Production secret,
hosted customer route, platform background work, reminder sender, hosted Studio,
cron or function allowance. Narrow cleanup grants, the AB#402 identity contract,
controlled writers and ZIP authoring/transport remain separate acceptance work.

Private evidence is retained outside the disposable worktree under the primary
checkout's ignored `temp/client-gallery-rehearsal/` directory, in a new AB#403 run
directory (0700; retained files 0600). It includes the exact executed harness,
fsynced intent journal, closed reports and pre/postflight metadata. No credential,
message envelope, raw provider prose or customer dataset export was copied there.
The harness is not a shipped command and is excluded from normal tests/CI.

| Artifact | SHA-256 |
| --- | --- |
| Executed-harness manifest | `693212dc11e0e1f1cc2e25ff68645150a4ac57da81f0cbf01306384b1e5aecfe` |
| Mail report, including cleanup | `5b0ca29a0313a59bc6377cc63f86ae7470f2d86f3ccdec1f332acde4708d7f83` |
| Cleanup report | `1c2e8087f64552db0e98be9d6bf03e07e6ee63d350901ea575e6b9a35e1b1ee2` |
| Independent postflight | `25660142265deb8a0d91e86c6672ad526d016779b1aa52495de68df59c66dbfd` |
| Subsequent owner receipt confirmation | `19fcc1f08c78af83c24079cc9bfc51fb99ae3f0867637ee316dcf23aaf1419db` |
