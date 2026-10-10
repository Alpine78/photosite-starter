# AB#18 — intact legacy ZIP transfer diagnostic

PR #321 merged after Azure CI #758 passed at reviewed head
`5f9cd7c654a06befec1a2ed23a51a5f293b88d4e`; merge commit
`b0299f45ae73cb560d22f4569cd6fd34ec85ab20` records the owner-approved
[ADR-0028](../adr/0028-legacy-unlisted-gallery-continuity.md) direction.
AB#18 and AB#117 descriptions, acceptance criteria, discussions and relations
were reread before this follow-up; both remain **Active**.

## Scope and current evidence

The owner requires one intact ZIP per gallery and preservation of supplied
browse JPEG bytes, resolution and EXIF. The existing twelve referenced packages
all exceed the documented upload-body limit. No customer files may be uploaded
by this diagnostic.

[Sanity technical limits](https://www.sanity.io/docs/content-lake/technical-limits)
document a 100 MB HTTP request-body limit and five-minute dataset upload timeout.
The [asset API reference](https://www.sanity.io/docs/http-reference/assets)
describes ordinary file uploads; no supported multipart or larger-file exception
has been established. A successful experiment would demonstrate behavior of
this project at the recorded time, not a provider support guarantee.
The current limits page explicitly defines standard SI units: 1 MB is
1,000,000 bytes. The 101,000,000-byte trial therefore exceeds the documented
general HTTP-body limit. Its acceptance is observed project behavior, not a
documented asset-upload exception or a provider support guarantee.

The prepared, local-only operator diagnostic targets the existing **preview**
dataset, never Production. Its initial synthetic ZIP is 101,000,000 bytes. A
separate 2,032,617,616-byte trial is permitted only after persisted evidence of
the first upload, full anonymous download/hash verification and successful
cleanup in that same target. A 413 response stops the larger experiment;
timeouts, authentication failures and connection errors do not prove a size limit.

The helper streams the request, keeps its credential out of arguments and CDN
requests, journals the deterministic asset identity before uploading, refuses
preexisting assets and a nonempty asset baseline, and deletes only its own
verified, newly created, unreferenced synthetic asset. It refuses an output
directory with prior receipts and exclusively reserves each new run, preserving
older evidence and preventing concurrent runs from replacing it. Its creation-time guard
uses the project API response's server clock, rather than trusting a local clock.
Uncertain upload outcomes
use an extended late-arrival polling window; the journal also supports explicit
recovery. Deleting an asset document does not promise purging cached CDN bytes,
as documented in [asset management](https://www.sanity.io/docs/content-lake/manage-assets).
Only synthetic content is exposed by the trial.

Seventeen deterministic offline tests pass, including request refusal, partial
outcomes, download failure, late arrival, cleanup guards and the second-trial
gate. The default invocation is plan-only. The operator helper and receipts
remain ignored local evidence; they are outside the application and CI suite.
The first live trial returned HTTP 200 after sending all 101,000,000 bytes in
4.379 seconds. The subsequent verification raised a `ValueError` without a
recorded operation stage, so its exact failing check is unknown. Asset cleanup
succeeded and the Preview asset count and identifier-set hash returned to the
empty baseline. This proves upload acceptance, **not complete delivery**.
The upload response also contains matching size, SHA-1 and file identity.
A corrected small trial added safe stage telemetry, upload-response validation
and a bounded asset-query poll. It has now completed successfully: HTTP 200,
all 101,000,000 bytes sent in 9.647 seconds, matching upload response and
complete anonymous CDN download size/SHA-256 and upload-response SHA-1. Its own asset was deleted
and the empty Preview baseline restored.

The permitted largest synthetic trial then completed successfully: HTTP 200,
all 2,032,617,616 bytes sent in 75.394 seconds, matching upload response and
complete anonymous CDN download size/SHA-256 and upload-response SHA-1. Asset readback and
anonymous enumeration succeeded in both corrected trials. Each cleanup
confirmed the newly created asset was deleted and absent, and the before/after
asset identifier-set hashes matched the empty baseline. These are synthetic
project-specific transfer results, not customer uploads or a documented
large-upload support guarantee.
An absent query result cannot prevent downloading a validated response's fixed
CDN URL. Readback delay is a possible cause, not an established diagnosis.

The initial hook readback used the global API hostname and returned an empty
list; it was not authoritative evidence of absent project hooks. Corrected
readback from the [documented project API](https://www.sanity.io/docs/http-reference/webhooks)
finds two enabled document hooks. Both target `production` and their explicit
type filters exclude asset documents. The helper rereads hook configuration
before each upload and refuses an enabled hook targeting Preview or an unknown
dataset. Neither hook is modified.

The diagnostic uses the owner's existing Sanity CLI session credential, whose
permissions are broader than this helper's Preview-only target. This is an
operator-credential residual, not proof of dataset-scoped least privilege or
AB#117 completion. The credential stays local, is read only for an explicitly
live invocation, and is sent only to the fixed project API without redirects.
Anonymous asset listing is checked separately from transfer/hash success; a
listing failure cannot erase byte-verification evidence.

The owner's existing Growth subscription has 100 GB asset storage and 100 GB
monthly bandwidth in the [current pricing](https://www.sanity.io/pricing).
The current Production asset-document total is about 2.43 GB and Preview was
empty before and after each trial. These are storage-document measurements,
not a current monthly bandwidth or invoice readback. One largest trial entails
about 2.03 GB in each direction; its anonymous CDN download can contribute to
bandwidth usage. No unused-quota or zero-overage guarantee is made. The trial's
320-second upload or download bound can give an inconclusive outcome on a slow connection;
that is never treated as a provider size refusal. Synthetic local ZIPs are
deliberately retained with private receipts. This orders no new service or plan.

## Review checkpoint

The one-time Claude plan review completed. Round 1 identified telemetry,
hook-readback, clock and enumeration gaps; Codex corrected the verified gaps.
Round 2 independently read both complete work items and discussions, checked
the scope hashes and found no blocker to the first small synthetic trial.
It recorded quota and bounded-timeout observations, now documented above.

Round 3 inspected later corrections but omitted the work-item discussions, so
its verdict is not accepted under the repository gate. The single corrected
retry failed at the session limit. After the October 10 14:40 Helsinki reset,
round 4 independently read both full discussions and reviewed the current
helper. It found a low-severity receipt-overwrite gap: a reused output directory
could replace earlier journal/response/result evidence. Codex added a pre-run
refusal and exclusive run reservation; all seventeen offline tests pass.
Round 5 independently reread both complete work items and discussions and
found no remaining implementation findings in the frozen helper and
documentation scope. That bounded implementation loop ended clean at round 5
before either corrected live trial ran. The helper remained byte-identical to
the reviewed bundle during both trials. Their later receipts are new evidence;
this updated evidence documentation is reviewed separately. No customer
publication or PR approval is inferred from a clean diagnostic review.

## Remaining launch work

The gallery schema, unlisted runtime, import, old-link mapping, expiration tests,
provider attachment behavior, customer one-ZIP delivery, notice reconciliation
and public cutover remain open. The two complete synthetic downloads establish
transport feasibility at the measured sizes; reconciling the documented general
limit with the intended supported production workflow remains a release gate. No
customer publication, source transformation, production mutation, DNS change,
new paid service or work-item closure is claimed.

An owner's finite-date clarification is recorded privately: the specified
January 7 deadline includes the whole day in `Europe/Helsinki`, so access ends
at January 8, 2027 00:00 local time (`2027-01-07T22:00:00Z`). This is an import
instruction, not evidence of an implemented or published expiration rule.
