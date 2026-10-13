# AB#250 — retained delivery release verification, 2026-10-12

Status: byte-verification tooling implemented; real import and publication blocked.
AB#250 remains Active. The owner requested this continuation and confirmed that
no Sanity Support assurance for the large ZIP workflow has been obtained.

The preserved offline packet contains 21 retained galleries, 1,792 original JPEGs,
12 intact ZIP packages and seven exclusions. There are 1,804 unique declared asset
bindings and 1,813 unpublished document candidates. Package sizes range from
128,872,189 to 2,032,617,616 bytes. Nine galleries have no source package; none is
invented. Deadlines, source bytes, metadata and complete image frames are preserved
by the existing source/document planners; this continuation changes neither.

The new `verify:legacy-delivery-assets` command recompiles that exact source and
binding contract before issuing any request. Default operation is offline only.
`--live` performs serial anonymous GETs to fixed, project/dataset-bound CDN URLs,
with no credentials or redirects. It hashes SHA-1 and SHA-256 in one bounded stream,
checks declared and actual lengths, rejects compression or incorrect media types,
and checks attachment delivery for the same whole-ZIP URL used by the runtime.
The deadline includes headers and body; stalled cleanup cannot extend it. A failure
stops subsequent downloads. Reports distinguish a missing asset from altered bytes.

```bash
npm run verify:legacy-delivery-assets -- --plan <private-source-plan.json> --bindings <private-bindings.json> --approved-digest <source-review-digest> --out <new-private-receipt.json>
# Add --live only for the separately intended anonymous CDN verification.
```

Inputs must be owner-only files; the output directory must be owner-only, and an
output within a repository must be ignored. Existing receipts cannot be overwritten.
Stdout contains aggregate counts only. Candidate bindings remain declarations, never
proof that assets have been uploaded, approved, or published.

## Actual observations

The real retained packet passed offline recompilation. Anonymous published queries
observed zero legacy gallery documents, zero legacy image documents and zero ZIP
asset documents. The first exact CDN asset probe returned 404, so live verification
stopped with `unverified` after one asset; no byte-verification success is claimed.
An authenticated complete raw-content audit in the separate AB#117 continuation
likewise counted no legacy types. No customer file was uploaded or transformed,
no CMS document was written, and the runtime remains disabled.

[Sanity's current technical limits](https://www.sanity.io/docs/content-lake/technical-limits)
state a 100 MB HTTP request-body limit and a five-minute dataset-asset upload limit.
The [Assets API](https://www.sanity.io/docs/http-reference/assets) documents ordinary
file uploads but does not establish a larger-file exception for this workflow.
The earlier complete synthetic 2.03 GB transfer is retained as measured feasibility;
it is not a provider support contract. All twelve real packages exceed 100 MB.

## Concrete provider question

Ask Sanity to confirm whether this existing Growth project's Content Lake dataset
supports unchanged ZIP uploads through POST /assets/files/{dataset}, including a
2,032,617,616-byte package; how that support relates to the documented 100 MB request
limit and five-minute upload limit; whether any supported alternate protocol is
required; and whether the original bytes can be delivered as one attachment through
the documented asset CDN download parameter. The source ZIPs must not be split,
recompressed, omitted or proxied through Vercel. This text is a prepared question;
no support request was sent.

Provider support, current source/backup byte verification and ZIP CRC checks,
current complete recoverable baseline, usage/capacity, metadata/notice reconciliation,
exact mutation approval, collision rechecks, actual import and deployed gallery/whole-ZIP
verification remain necessary before publication. The retained public-file exposure
and non-revocation limitations in ADR-0028 remain owner-accepted, not eliminated.

## Validation

Deterministic byte-verifier and document-planner tests passed, including incomplete,
oversized, altered, compressed, redirected and stalled responses, credential-free
GETs, late response cleanup and fixed error diagnostics. The full browser-free suite,
lint and a synthetic production build passed after correcting test-only TypeScript
inference and the CLI owner check. Production CDN absence is a recorded operational
blocker, not a unit-test failure or a supported-upload decision. Review details are
recorded with the PR; no full AB#250 acceptance or launch approval is implied.
