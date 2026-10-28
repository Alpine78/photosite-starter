# Sanity cleanup fault rehearsal — 2026-10-28 (AB#410)

The owner authorized the real provider run after merging PR #628. The unchanged
tool at `82b1b2fbd98cb5d9fbc0334928f83cf28493ff99` passed all nine scenarios against
the existing Sanity `preview` dataset. This is **local operator → real Content Lake**
evidence, without a hosted function, scheduler, signed-in Studio or Production activation.
The [runbook](../client-gallery-cleanup-rehearsal.md) defines the finite scope and limits.

## Scope and credential

The source checkout stayed clean for preparation and execution. A metadata GET
confirmed the exact configured project, one current robot and the built-in Editor
role. The owner-provided API Editor token was used only locally, not deployed.
The response provided no token-expiry metadata; no short-lived lease is claimed.
No token, member, role, service, deployment or CORS entry was created. The
token-creation notification path was not invoked. The original `0600` owner file
stayed unchanged and unrevoked. The
agent-created `0600` plaintext copy was removed after independent postflight.

Only the exact `preview` paths and frozen test targets were admitted. No Production
dataset request, original-project flag/domain operation or customer record was part
of the run. There was no Production export comparison in this experiment: it does
not make a fresh all-record Production-unchanged claim or supersede AB#408's evidence.
The existing Growth service was used within the bounds below; no plan upgrade or
zero-incremental-cost assertion follows.

Preparation made one export GET and found **12 provider records only**: 11
`system.group` and one `system.retention`. Their exact IDs/types/revisions were frozen,
not admitted by prefix. The complete export was not filtered. The manifest reserved
**55 exact IDs**, including the real fixed cleanup cursor; every owned target was
independently absent before setup. Reserved IDs include variants/referrers that
were not all persisted, so “55 absent” is not a claim that 55 records were created.

## Files and bounded execution

Each of nine cases had its own newly generated test-card pixels, a complete
256 × 192 WebP preview, a complete 512 × 384 JPEG and one whole ZIP with the neutral
member `image-0001.jpg`. No customer image, camera master, contact/job detail or
individual full-resolution JPEG asset was used. All JPEG/WebP decodes, metadata
screens, ZIP CRC/hash/member-byte checks and manifest asset hashes passed. One
representative full-frame JPEG was also visually inspected. Case and nonce affected
the bytes, preventing cross-case content-addressed sharing.

| Measurement | Observed |
| --- | ---: |
| Asset uploads | 18: nine previews and nine whole ZIPs |
| Total approved upload bytes | 78,661 |
| Rehearsal requests | 242 |
| Wire write intents / requests | 77 |
| Application test duration | 83.72 seconds |
| Separate postflight GETs | 3 |
| Private journal records | 92, including 77 write intents |

These are below the reviewed 18-upload, 2 MiB, 500-request, 150-write and ten-minute
limits. The metadata checks and preparation read are separate from the 242 rehearsal
requests. No large transfer or anonymous CDN download was repeated. This establishes
no larger-file supported-upload contract or future monthly quota assurance.

## Actual provider outcomes

The unchanged application transport/runner produced its original mutation bytes.
Before every wire write, the private intent and directory entries were fsynced.
The operator's approved manifest hash bound the exact synthetic bytes and target
under the owner's run authorization; it is not an owner review of individual images.

| Case | Observed outcome |
| --- | --- |
| Gallery revision changed after inventory | One provider conflict; the reviewed gallery/image/ZIP deletion and receipt rolled back. |
| Image revision changed after inventory | One conflict; gallery and both assets retained at the independently observed competing-write revisions. |
| ZIP revision changed after inventory | Same complete-unit rollback. |
| Late strong ZIP referrer | The competing create finished first; provider deletion conflicted and retained the complete unit. |
| Late gallery draft | The exact draft existed before original deletion bytes were sent; the complete unit rolled back. |
| Committed claim result hidden locally | The runner recognized its exact pending operation and completed once, without replay. |
| Committed deletion result hidden locally | The runner recognized the exact completion receipt through fresh reads and completed once, without replay. |
| Old deletion held before sending | The runner reported one intentional uncertain result and established a newer control fence. Releasing the exact original bytes once then conflicted; gallery and assets remained until scoped teardown. |
| Duplicate runners | Both read the same enrolled revision behind a barrier. One completed and one conflicted; exactly one deletion request reached the provider. |

Every case had exactly **one application-cleanup logical deletion call and one
application-cleanup wire deletion request**; scoped teardown requests are separate.
The two hidden-result cases each first received an actual acknowledged commit;
their later `uncertain` result was injected locally. They are not real Internet
outages. The held old request was never sent by its first logical call and was not
a retry of an ambiguous wire write. Its identical body hash was recorded at hold
and release. No unresolved provider outcome remained at the end.

Three cases actually completed application cleanup, each deleting the gallery,
one image and one ZIP. Expected conflicts retained the other units until the
tool's normal exact-owned teardown. In the duplicate case the winning deletion
runner lost the independent cursor CAS (`cursorWritten: false`); the other runner
acknowledged it (`true`). One cursor creation and later guarded updates were
therefore exercised without interpreting that expected race as a missing grant.

## Independent final verification

After the successful tool result, a separate GET-only reader made one ordinary
preview export and two all-version Doc API batches. It confirmed:

- exactly the original 12 baseline IDs, types and revisions;
- zero test content/assets left in that snapshot;
- all **55** requested owned IDs reported as explicit **existence** omissions,
  with no documents or permission omissions;
- all 18 upload intents matched the approved asset body hashes;
- all 77 write intents used exact preview paths and manifest-owned targets;
- the original owner credential file bytes and mode were unchanged.

This is current Content Lake document/asset absence, not instantaneous CDN, downloaded
copy, provider-history or backup erasure. No manual recovery, dataset reset, prefix
delete, unknown-outcome replay or additional provider write was needed after the run.
Private inputs, exact manifests, journals and local logs remain outside Git/CI.

| Private receipt | SHA-256 |
| --- | --- |
| Approved synthetic manifest | `c0dec38816ab0447e1b6febd70999f768dc05ed754ae6a7c733195efc19f930e` |
| File decode/metadata/ZIP review | `bdfb439d19de31ad5ccea4560e163a06eb57993f36c4dfc15f3ad27dcc16dfea` |
| Tool result | `9f756a5a323ad35cd7fcf02fecab0eeef4f30cc2cdca3a97476d083c8fe1374e` |
| Separate postflight | `d3845569b7145662320e20faf5ef86da3928bc66753496d6e5a707e4fa31106e` |

## Acceptance limits

AB#410 is evidence for this existing-tool execution, not a new application change
or complete AB#395/392 acceptance. The actual known synthetic gallery/draft/dotted
control/cursor and image/file paths were read with the existing Editor robot; that
is not a full role/grant matrix or a human-session test. The owner has reported a
human Editor available; its signed-in Studio acceptance is still untested here.

Remaining work includes HTTPS Studio FI/EN/keyboard/assistive-technology checks,
publication/withdrawal versus deletion orderings, the controlled strong-writer and
no-release operational boundary, privacy/operations acceptance, supported future
large-upload transport and a separately approved Production activation. The local
fault matrix does not establish those hosted/browser/deployment properties.
