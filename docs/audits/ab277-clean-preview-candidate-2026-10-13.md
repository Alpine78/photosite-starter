# AB#277 — clean main Preview candidate evidence, 2026-10-13

Main CI build **941** succeeded at 18:16:13 UTC for source
`c32d1e8f4ba41d63028052fd51f8528394f6f3da`. The new candidate is the first readback
in this continuation to pass the merged source-identity gate with affirmative clean
source metadata. It remains an access-protected Preview, not the final integrated
release or a Production/rollback approval.

## Exact source and CI provenance

This pipeline publishes the URL through a task summary, not a downloadable pipeline
artifact. The build's authoritative successful deployment log 37 supplies the URL;
verification log 38 supplies immutable deployment ID
`dpl_7RcgpqJvVEKC28QUcGtyGqTLDoPE`. These fixed inputs were then independently
resolved through Vercel and bound to the owner's expected project and team.

The deployment API readback is READY and its source metadata matches exactly; it
records `gitDirty=0`. The existing AB#268 verifier returned
`providerSourceIdentityVerified: true` with no refusal reasons. CI's before/after
checkout attestation is from merged #382. Neither that metadata nor this readback
establishes artifact byte-level provenance; `artifactContentsVerified` remains false.
The historical Production `14b1af0` dirty receipt and old Preview unknown-cleanliness
receipt are not retroactively accepted.

The Production environment file's token returned 403 for this Preview metadata read.
The owner's existing Vercel CLI authentication performed the successful read; no new
token, permission, environment setting or protection configuration was created.
Raw provider responses and authentication remain private and are excluded from this PR.

## Current protection and served route observations

Ownership and immutable ID were verified before the existing automation bypass was
sent to the exact deployment origin. A request without bypass returned **302** to
Vercel protection. The authorized response returned **200** and `X-Robots-Tag: noindex`.
The existing protection/noindex verifier passed. The checked candidate URL is:

[Protected Preview candidate](https://photosite-starter-b2hg0dtp4-ilkka-rytkonens-projects.vercel.app/).

Header-only authorized probes on that exact candidate observed:

| Route | Status | Robots header |
| --- | --- | --- |
| `/en/services/funeral-photography` | 200 | noindex |
| `/en/services/property-photography` | 200 | noindex |
| `/en/stories/blog` | 404 | noindex |

These establish response availability, not complete rendered wording, live adapter
freshness or image correctness. The Blog observation agrees with the still-unpublished
article drafts. Full current-source local category/service rendering and FI/EN prices
were independently checked in [#386](https://github.com/Alpine78/photosite-starter/pull/386).

The private candidate receipt, recorded at 18:32:01 UTC, has SHA-256
`dbdd82f3b63b89382f69dc0893fa1ed89e2f400daf486ee7eae26267275f7fb9`.
It binds CI deploy/verification log hashes, provider receipt hash, exact expected
deployment/source/project/team and these protection/route observations. The raw API
response is retained mode 0600 within the ignored mode-0700 evidence directory.

## Remaining release boundaries

Open #387's five exact service aliases and later article publication are not included
in this source's acceptance. After integration, freeze the final source and require
its own CI, clean owned candidate and complete canonical/locale/legacy/media checks.
Contact delivery, native CMS webhook/cache behavior, a compatible known-good recovery
target, actual rollback exercise and final security/privacy/operational acceptance
remain separate. No deployment creation, promotion, alias mutation, DNS change, CMS
write or credential change occurred in this task.

The existing source and Preview verifiers were exercised without changing runtime
code or dependencies. AB#277 is Active pending evidence PR review/merge; AB#18 and
the final rollback/handoff stories remain open.
