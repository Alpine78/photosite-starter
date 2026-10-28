# Hosted client-gallery rehearsal — 2026-10-28 (AB#408)

A separately authorized synthetic run exercised the merged gallery source at
`4dfa19a9f6d435cc1b3362aea666a68838d0976f` (PR #626), including AB#402/404/407.
The customer selection, whole-ZIP download, proof replacement and scheduled expiry
checks below passed. This is scoped operational evidence, **not Production activation
or complete AB#130/395 acceptance**. The original serving deployment and its absent
gallery activation settings were independently checked unchanged after teardown.

## Authority and isolation

The owner authorized the rehearsal, commits/push/PR, the accepted ADR-0035 ZIP
contract and ADR-0040 B Editor breadth. The owner additionally approved four
separate temporary robots and Sanity's automatic administrator security notices.
Each successful robot had a provider-echoed three-hour expiry: Viewer, proof writer,
cleanup Editor and local-only recovery Editor. The owner-supplied API Editor token
stayed local and was neither deployed nor revoked. A robot is not a human Editor.

The one-time Claude Sonnet 5.5 HIGH plan review preceded provider mutations. Its
verified findings added a private Production restore point, exact request-side
fences, separate credentials, build/entry checks, protection-before-keys, and
separate manual-worker and native-scheduler evidence. No second plan review ran.

Only the existing Sanity `preview` dataset and one new nonce-named Vercel project
were used for test writes. No third dataset, paid seat, plan upgrade, S3/PostgreSQL
resource, real customer batch or original-project deployment/alias change occurred.
The Vercel team was Pro; the owner reported Sanity Growth and daily/rounded usage:
12.1 GB assets, 57.2 GB bandwidth, about 146k API requests, 24 API CDN requests,
14.3k documents and two datasets. Those observations gave room for this bounded
run; they are not realtime quotas or a promise about another month's capacity.
[Current included quotas](https://www.sanity.io/pricing) were checked separately.

The initial authenticated raw dataset contained **12 provider system records**:
11 `system.group` and one `system.retention`, with no content or assets. The first
count-zero check stopped before any POST. The corrected operator admitted only
that exact frozen ID/type/revision inventory, checked again before the first upload;
no prefix-based deletion or exclusion was used. The application received ordinary,
unfiltered provider snapshots. Every mutation target/reference was separately
limited to the finite test catalog; system records were never mutation targets.

## Synthetic files and actual transfer

All JPEGs were newly generated complete 4:3 frames, with synthetic corner markers
and a synthetic COM marker only: no customer, GPS, EXIF/IPTC/XMP or camera-master
material. Separate 512 × 384 WebP delivery/proof previews preserved full frames;
proof previews visibly carried a watermark. Full-resolution JPEGs were uploaded
only inside one whole ZIP per set, never as individual image assets.

| Set | Processed JPEGs | Full dimensions | Whole ZIP bytes |
| --- | ---: | --- | ---: |
| Baseline | 2 | 1024 × 768 | 1,038,353 |
| Large | 24 | 4096 × 3072 | 209,004,421 |

Both sets passed the actual decode, metadata, builder and streaming-container
audits, with matching member manifests. Exactly 52 WebPs and two ZIPs were uploaded
once each. Upload bodies were streamed and hashed; fresh Doc API reads matched
expected asset IDs, MIME, dimensions and size. The large direct binary POST returned
HTTP 200 in **7.822 seconds**, with all 209,004,421 body bytes consumed and matching
readback. This measures this client/route/run, not a universal limit or SLA.

For each ZIP, the actual `client-gallery:zip` dry run and digest-bound apply each
repeated the local audits and a **complete anonymous remote SHA-1/SHA-256/byte check**.
Both draft-only CAS writes were accepted and independently observed. Nothing was
split or partially approved. The large package's third and final full CDN read was
the actual browser download: 209,004,421 bytes and both hashes matched the source.
Thus large full reads totalled **627,013,263 bytes**, without a fourth CDN probe.
The baseline used two full checks. Precise ZIP attempt counts were durably recorded;
there was no unified wire/billing meter for all other HTML/API/build traffic.

**Supported future transport remains unresolved.** The current
[technical limits](https://www.sanity.io/docs/content-lake/technical-limits) still
state a generic 100 MB request-body limit and five-minute dataset-asset upload
duration; the [asset reference](https://www.sanity.io/docs/http-reference/assets)
does not supply a verified resumable/multipart hundreds-of-megabytes route here.
One successful larger direct POST does not settle that contract. It neither
approves a real customer batch nor changes ADR-0035's boundary.

## Observed workflow results

| Check | Observation |
| --- | --- |
| Protection before arming keys | Empty deployment and its alias redirected anonymous requests to Vercel login; authenticated access reached the exact marker. Later deployment URLs were also protected. |
| Build and runtime fencing | Viewer-only Next build; all six physical Node 24 function entries installed the fence before their launcher. Every new entry refused `SANITY_DATASET=production` before launcher/network execution. |
| Actual publication identity | Hosted robot request returned HTTP 401 `unauthenticated`; owner's human Administrator request returned HTTP 200 `published`. The personal token travelled only in that request, not deployment env. |
| Customer proof selection | Actual Chromium used the fragment capability, selected proof `001` with Enter, reviewed and confirmed deliberately in English, then read the confirmed state in Finnish. No unexpected external origin was requested. |
| Durable confirmation | Fresh Doc reads found confirmed working state and immutable v1; notice remained `pending`. No Resend credential or customer/reminder mail was configured or sent. |
| Replacement publication | Actual Studio publication modules with fenced provider callbacks committed delivery + reviewed finite enrollment + deletion of the proof, terms, selection/version/notice and unused proof images. Readback reconciled `published`; the old proof URL returned 404. This was not a signed-in Studio UI test. |
| Delivery and ZIP | Both FI and EN customer views rendered the 24-preview delivery and canonical whole-ZIP link; the native browser download matched the complete package. Customer routes used their existing `?locale=fi` / `?locale=en-GB` contract. |
| Manual hosted cleanup | A separately armed Production-target test deployment, without cron definitions, returned HTTP 200: examined 2, attempted/completed 1, skipped 1, blocked/conflict/refused/uncertain 0. It deleted one exclusive image; one shared image and the separately referenced ZIP stayed. |
| Independent retention readback | Expired gallery and exclusive image absent; shared image/ZIP present; complete receipt and cursor present. The source remained responsible for its original revision assertions. |
| Native Vercel schedule | Only the large test delivery was eligible. Provider cron metadata named the Current test deployment; no manual cleanup call followed arming. The worker log reported completed 1, deleted assets 25, deleted ZIPs 1, shared 0, cursor written. Fresh Doc reads found the gallery, ZIP and all 24 delivery previews absent. |

The Studio six-month creation default was not verified through its UI in this run.
The rehearsal deliberately published finite future dates and later past dates
through the real enrollment workflow. Publication does not restart the creation-based
clock, and proof replacement does not require a proof expiry timer.

## Instrumentation and gaps

These were **instrumented** artifacts, not an unchanged release candidate. Source
was frozen; private compiled entry wrappers, a global-fetch/transport fence and
Studio static routing/basepath instrumentation were added. Native Studio browser
writes would be outside the Node fence. Only the owner-human HTTP publication
and source-module delivery action were exercised; the separately built Studio
bundle does not establish its signed-in UI, private-notice list or editor rights.

Provider request logs also contained `redirect_refused` fence counters on `/`,
`/en` and `/contact`; their cause was not isolated. HTTP 200 there is not a whole-page
parity claim. The successful cleanup request's guard counters had no denials.
Process counters are cumulative and were not summed as independent events.
No whole-site, pristine-artifact or general Next cache-equivalence verdict follows.

Setup failures remained separate from application findings: an unset framework
initially selected Vercel's static builder; a detached output copy first lacked
traced root dependencies. Both stopped before a B deployment and were corrected
with preserved local artifacts and exact project/readback checks. The first fixed
cron minute elapsed before Current promotion; a later bounded every-minute run
established native dispatch, then its credential and project were removed. A
post-revocation cron log's `provider_refused` is shutdown evidence, not a failed
successful-run receipt. No unknown mutation outcome was blindly replayed.

Still unverified in this hosted run:

- An actual **non-admin human Editor** identity/publication and human Viewer denial.
  An API Editor robot and the owner's Administrator are distinct observations.
- Signed-in Studio FI/EN/action/notice-list and assistive-technology acceptance,
  customer privacy wording and the controlled-writer/no-release operational boundary.
- Hosted late-reference/revision races, withdrawal/deletion orderings and deliberately
  lost-response/duplicate fault injections. Existing source/local evidence is retained;
  no new hosted proof of those cases is claimed.
- Hosted email delivery, real customer-batch authorization, supported large upload
  transport, and deliberate activation on the original Production project.

## Teardown and Production comparison

All four new robots were independently inventory-absent and their saved credentials
received authentication refusals after revocation; six pre-existing robots remained.
The earlier uncertain notification-suppressed attempt's exact label was absent too.
The test Vercel project was independently absent from the complete project list;
its deployment URL returned 404. All deployments, aliases, cron and project env
belonged to that removed project. Original serving deployment and absent gallery
activation keys were independently unchanged. No original key was rotated/revoked.

Normal workflow deletion removed the proof unit and both expired deliveries' owned
unshared assets. After hosted writers stopped, one final revision-bound teardown
removed **33** remaining test records/assets, including deliberately retained shared
assets and orphan synthetic previews. Every catalog target was checked absent via
Doc API; only the original 12 system records remained in `preview`. This final
operator teardown is **not** an application orphan sweep or a later shared-asset sweep.

Production before/after exports each contained **21,233** records and **24,078,787**
bytes. The complete revision fingerprint differed: **11 reserved `system.group`
revisions/timestamps changed** during token grant/revoke. Investigation found their
payloads identical after excluding `_rev` and `_updatedAt`; all other **21,222**
ID/revision pairs were unchanged, with zero additions/deletions. No restore was
attempted, and no real customer/content record changed. Private raw exports were
kept out of source, CI, chat and reviewer context.

Local fixtures, private journals/audits, revoked credentials and restore points remain
in the ignored task worktree with private permissions. The existing owner token file
was preserved. Deleting active asset documents does not prove immediate CDN/history
or downloaded-copy erasure; no extra large-file fetch was made to claim that.

Validation comprised 83 focused offline harness/source-contract tests, the actual
GET-only identity refusal, the frozen-source Viewer-only build and all-entry negative
controls, plus the real provider/HTTP/browser/worker/scheduler/readback observations
above. These private operational runs are separate from deterministic CI tests. The
application source did not change in this evidence PR. AB#130/395 activation gates
remain open; AB#408 stays Active until its evidence PR is accepted/merged.

Selected private receipt fingerprints (SHA-256); only aggregates and synthetic IDs
are in these receipts, not credentials or raw Production records:

| Receipt | SHA-256 |
| --- | --- |
| Large upload receipt | `efd42eb8b5c030e32a26883d6b11a215a3129eda456230ef423b6df8d5d63358` |
| Large ZIP attachment result | `7d5c2e9c58a202574ff35d07453f2b66e67032f3ab5ab36d11d78721b5b96fd5` |
| Customer browser confirmation | `568cb1e8bfce5e8630a0bfb637674c05e1b6b2f36e95424e6134a2367efe3371` |
| Native browser download | `f39be879285be0b8d2890c93c208c8dd776179723cacfbee73be0cef1d922747` |
| Native scheduled deletion readback | `77ebb0ee7b29a536d3c5764a6236a6be56ef3887c3ee4a044e5688f21d5703d5` |
| Final exact-target data absence | `fb8748e912f6d6e41d9df272a060b4b5fae3759ca7e4304a08d83894dafc31a9` |
| Final robot inventory | `11dd3ccb54c14fdb976bdfb0f8b874abec2122727f088615e2a5b1cf12e27e24` |
| Production access-group assessment | `1c7ca23ec5accd57c6ca49ca046c3270d781be1fcbc7e95255e25e0b5d27f79d` |
