# ADR-0035: Whole-gallery ZIP delivery using the existing Sanity dataset

**Status:** Proposed
**Date:** 2026-10-17
**Deciders:** Project owner (acceptance pending)
**Work item:** AB#309; parent AB#29

## Context

[ADR-0034](0034-ongoing-unlisted-client-delivery.md) selects ongoing unlisted
Sanity delivery and rejects separate S3/PostgreSQL provisioning. New authoring
and customer reading currently permit public web derivatives only (longest edge
at most 2048 pixels); neither exposes a new full-resolution ZIP. The accepted
[ADR-0028](0028-legacy-unlisted-gallery-continuity.md) exception covers only the
21 retained migration galleries. It cannot authorize new original-resolution
image uploads or establish a generally supported future ZIP transport.

The owner wants one whole processed-JPEG package where supplied. This proposal
makes that goal reviewable without introducing another service. Acceptance of
this record and implementation verification remain separate from the already
effective choice to use Sanity.

## Decision

Propose the following contract for **future** unlisted delivery:

1. Keep existing bounded, complete-frame web previews in Sanity image assets.
   Offer at most one complete ZIP of owner-exported, processed JPEGs through a
   Sanity dataset file asset. Full-resolution JPEGs stay inside that ZIP; do not
   upload them as individual Sanity image assets. Camera masters, RAW files,
   archive locators, private-only media and AB#95 sales assets remain excluded.
2. The owner reviews the exact export set, ZIP entries and embedded metadata
   before upload. Use neutral package/entry names without customer or job data.
   Do not silently strip metadata, recompress, crop, split or drop photographs.
   An integrity tool cannot decide whether a picture or its metadata is suitable
   for public distribution; that remains an explicit owner export decision.
3. Treat the ZIP, its contents and asset metadata as public and forwardable.
   Keep credentials, job/contact records and local source paths out of public
   documents. Do not put an approval manifest or local inspection report in the
   dataset. A random gallery handle and page noindex do not protect a file.
4. Before any new upload, bind the whole package and intended JPEG set to local
   byte counts and strong hashes; verify ZIP entries/CRC and that there are no
   extra, missing, encrypted, path-bearing or unsupported entries. Preserve the
   inspected evidence privately. Revalidate unchanged bytes immediately before
   a separately authorized upload. After upload, verify the complete remote
   package against the local strong hash before referencing it in a gallery.
5. Use a conservative initial candidate ceiling of **100,000,000 ZIP bytes**.
   This is a proposed workflow bound informed by the documented generic HTTP
   request-body limit, **not proof that this size uploads successfully**. Check
   actual account capacity, the supported dataset upload method and duration
   before customer publication. A larger package remains a whole-package blocker
   until supported transport evidence and an explicit scope adjustment exist;
   never solve it by silently splitting it or dropping the download.
6. Page pause, expiry and unpublishing affect only the page. For requested file
   removal, first remove page/references through authenticated administration,
   inspect all shared references (including drafts/releases), then separately
   authorize asset deletion if unused. Retain the limits around provider caches,
   known URLs and downloaded copies; do not promise revocation or remote erasure.

This record is **Proposed**. It does not amend the accepted media hard rules,
add a ZIP schema field, grant a new full-resolution exception, authorize live
uploads, select a paid plan or activate production features. Existing legacy
files, URLs, metadata and deadlines are unchanged.

## Owner follow-up — 2026-10-17

The owner reports that the largest delivery packages have been **hundreds of
megabytes** and requires each package to remain one complete ZIP. The original
100,000,000-byte candidate in decision 5 is retained above as proposal history;
it is **not a product size ceiling** and does not satisfy the owner's larger-file
requirement. Do not split packages, omit photographs or silently drop downloads
as a workaround. Supported whole-file transport must still be established.

AB#315 supplies a separate bounded **offline** audit profile up to
1,000,000,000 archive and expanded bytes, keeping the original 100 MB audit API
unchanged. That local engineering ceiling neither raises a Sanity upload limit
nor proves an accepted upload method, account capacity or provider compatibility.
This clarification records the existing owner constraint; this ADR remains
**Proposed**, with no new public-file exception, upload or publication approval.

## Options Considered

- **Existing dataset, one processed-JPEG ZIP:** proposed; uses the owner's chosen
  service and keeps individual full-resolution JPEGs out of image-asset delivery.
- **Web previews only:** current working implementation; useful for viewing but
  leaves the required whole-gallery download incomplete where a package exists.
- **Continue a manual whole-package handoff:** a temporary operational fallback
  pending verified dataset transport; it does not complete website ZIP delivery.

Separate S3/PostgreSQL and a Media Library purchase are outside the owner's
chosen direction, not hidden prerequisites of the proposed option.

## Trade-off Analysis

Verified on 2026-10-17: Sanity documents a generic HTTP request-body limit of
100 MB (SI units) and a five-minute dataset asset upload duration. Project plans
can impose additional limits. A CDN serving limit, Media Library limit or the
observed legacy ZIP uploads does not establish a supported new dataset upload
method. [Sanity technical limits](https://www.sanity.io/docs/content-lake/technical-limits).

Dataset assets remain public even in a private dataset. Signed/per-asset
visibility belongs to a different product; it is not part of this proposal.
[Sanity dataset asset management](https://www.sanity.io/docs/content-lake/manage-assets).

Sanity measures stored assets, outgoing bandwidth and API usage. Reusing the
existing service removes separate infrastructure, not those resource costs.
The current account plan, spare capacity, expected downloads and upload
throughput have **not** been inspected for this proposal.
[Sanity plans and payments](https://www.sanity.io/docs/platform-management/plans-and-payments).

## Consequences

If accepted and implemented, customers receive one public package without new
storage infrastructure. Owner review must accept public full-resolution JPEGs
inside it and their metadata. Bounded web previews remain separate from delivery
bytes and never enter an optimizer as camera masters or private assets.

The current runtime and diagrams continue to describe the implemented web-only
new-gallery path. AB#29 remains incomplete for new ZIP delivery. No new upload
or operational acceptance follows from an offline inspection succeeding.

## Action Items

- Owner: accept or revise the proposed new-file exception in normal PR review.
- Before implementation: amend the exact accepted hard-rule clauses explicitly;
  keep ADR-0028's retained-gallery exception separate.
- Implement bounded offline package/set integrity inspection with synthetic
  corruption, expansion, entry-identity and path tests. Report its format and
  eligibility limitations rather than treating a ZIP signature as verification.
- Verify actual account capacity and supported whole-file transport, including
  unsuccessful/partial upload handling, without changing services or plans.
- After acceptance: add bounded native Studio file validation, fresh runtime
  eligibility, a complete-package link, FI/EN journeys and strong-hash readback.
- Update authoritative architecture diagrams when those boundaries actually
  change; keep removal/shared-reference and provider-cache verification open.
