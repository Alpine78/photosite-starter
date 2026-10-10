# ADR-0028: Legacy unlisted gallery continuity in the existing CMS

**Status:** Accepted
**Date:** 2026-10-10
**Deciders:** Project owner (Ilkka Rytkönen)
**Work item:** AB#18; security/privacy gate AB#117

The access/storage direction is accepted; ZIP transport remains unresolved.

## Context

The owner rejected the proposed UpCloud object-store and managed PostgreSQL
provisioning cost and explicitly requires these customer images alongside the
existing images in Sanity. The owner accepts shareable gallery pages omitted
from ordinary site listings and search indexing, with the existing expiry dates,
and direct image and delivery-file URLs that work without authentication.

This is a launch-prioritized continuity exception for the **21 retained legacy
galleries** in the private, owner-approved migration overlay. Seven have an end
date; fourteen intentionally have none. Excluded galleries stay excluded.
The website is not the offline archive. Customer identities and source paths
remain outside the public repository.

This owner decision explicitly overrides ADR-0014 §2's Sanity isolation and
§3/§5's authorization requirements **for this retained set only**. It also
overrides its uniform six-month retention/deletion policy for the existing
indefinite galleries. ADR-0005's protected-delivery restriction has the same
limited exception. These are unlisted public deliveries, not `privateOnly`
media or a successful implementation of AB#29's protected ZIP criteria.
AB#29/145 and their existing acceptance criteria remain unchanged; their
protected delivery and administration routes remain disabled in Production.

## Decision

1. Use the owner's existing Sanity project and dataset for owner-supplied processed
   JPEGs and unlisted-gallery metadata. No UpCloud account, PostgreSQL
   service, additional dataset or paid Media Library is ordered for this path.
2. Give this content a separate document type and read facade. Ordinary content
   trees, categories, search, keyword galleries, home feeds and sitemaps must
   exclude it by construction. Do not reclassify `privateOnly` media or relax
   public projections globally. Public components receive only validated
   processed-JPEG URLs, actual dimensions and bounded display fields.
3. The browse images are the owner's already-prepared JPEGs, confirmed by the
   owner as suitable for **10 × 15 cm prints**. This is an owner statement, not
   an independently verified print-quality or pixel-density specification.
   Preserve these browse JPEGs **byte for byte**, at their existing resolution
   and with embedded EXIF and other metadata intact. The owner
   explicitly rejected pre-upload downsizing and metadata removal. Do not
   re-encode, rotate or strip the source files. Their public source URLs expose
   individual JPEGs at that resolution, including embedded metadata; omitting an
   individual download control does not prevent downloading them. Add no customer
   contact/job records, legacy passwords or archive locators to CMS display
   fields. Camera masters and archive locators remain excluded. This scoped
   exception does not alter ADR-0014 protected previews or ordinary public media.
4. The ZIP contains the separate **full-size processed JPEGs** supplied for
   delivery; do not populate browse-image records from those ZIP members or
   substitute them for the prepared browse JPEGs. The owner accepts public
   delivery ZIP URLs containing these processed JPEGs and
   explicitly requires **one complete ZIP per gallery**, rejecting several
   independently opened packages. **Transport remains unresolved**; this decision
   does not prove existing ZIPs can be uploaded intact or authorize splitting,
   recompression or dropping downloads. Opening a delivered ZIP naturally
   exposes its individual JPEGs. A supported whole-package upload method must
   be verified before package import. Do not proxy ZIP bytes through Vercel
   Functions. Nine retained items have no source ZIP reference; do not invent
   packages or promise that all 21 have one.
5. Preserve original finite deadlines and explicitly indefinite access. Recheck
   whether each finite gallery is still in date immediately before import and
   publication. Do not restart six months at migration or apply ADR-0014's
   275-day object-age backstop to indefinite legacy deliveries. The one supplied
   date-only override has no confirmed timezone/time: settle its exact boundary
   before a runtime import, rather than silently inventing an instant.
6. Resolve gallery page availability with a fresh server-side check and no-store
   responses. An expired or unpublished page returns a generic unavailable
   response, not a blanket redirect. Page expiry does **not** revoke known
   asset URLs, erase downloaded copies, or establish provider-cache deletion.
7. Apply page `noindex` and `Referrer-Policy: no-referrer`; exclude galleries
   from ordinary internal navigation and sitemaps. Do not block the gallery page
   in robots.txt in a way that prevents a crawler reading its noindex response.
   App headers cannot impose noindex on Sanity CDN responses. These are discovery
   controls, not access protection or a promise that search engines never index
   a shared link or file.
8. Preserve customer link continuity through an explicit owner-local legacy map.
   Avoid customer-derived or sequential names for replacement links, but do not
   describe opaque paths as authorization: the current dataset is public and
   its documents, references and assets can be enumerated directly through the
   CMS API. Existing legacy URLs may already be guessable. Import no legacy
   passwords. Public assets and cached responses may survive page removal.

## Options Considered

- **Existing Sanity with unlisted pages:** the owner's accepted direction;
  reuses current storage and gallery presentation with the exposure above.
- **ADR-0014 protected delivery:** stronger authorization and controlled expiry,
  but requires durable stores/adapters and operational costs the owner rejected
  for this migration. It remains the separate protected-feature roadmap.

## Trade-off Analysis

Verified on **2026-10-10**: Growth includes 100 GB of assets and 100 GB/month
bandwidth. Current listed overages are $0.50/GB of assets and $0.30/GB of
bandwidth. This is reuse of an existing paid subscription, not a guarantee of
zero extra charges. Public ZIP URLs can be shared or hotlinked; usage and
billing alerts must be checked before publication.

Read-only asset-document queries across both current datasets found 5,145 assets
in Production totaling **2,432,677,495 bytes**, and zero in Preview. Available
retained source images total **883,977,887 bytes** and referenced ZIPs
**8,785,180,949 bytes**. Their sum with current assets is **12,101,836,331 bytes**
(about 12.10 GB), before generated derivatives or repackaging overhead. This
asset-document estimate is not the provider's billing ledger or an upload test.

All **12 referenced ZIPs exceed 100,000,000 bytes**; the largest is
**2,032,617,616 bytes**. The technical limits document gives a 100 MB HTTP
request-body limit and five-minute dataset upload duration. The Assets API
describes binary upload and a from-URL path limited to 50 MiB; no supported
large-ZIP workaround has been verified. Storage allowance therefore does not
establish package-upload feasibility. Enterprise Media Library capabilities
do not establish capabilities of this existing Content Lake setup.

Official evidence: [pricing](https://www.sanity.io/pricing),
[technical limits](https://www.sanity.io/docs/content-lake/technical-limits),
[Assets API](https://www.sanity.io/docs/http-reference/assets),
[dataset asset visibility](https://www.sanity.io/docs/content-lake/keeping-your-data-safe),
and [asset CDN/cache behavior](https://www.sanity.io/docs/apis-and-sdks/asset-cdn).

## Consequences

The separate private-store provisioning is no longer a prerequisite for this
limited continuity route. The route, importer and delivery are still unbuilt;
customer continuity and AB#18/117 launch acceptance remain open. This decision
does not accept an October 15 outage or replace the existing launch fallback.

Sanity asset deletion does not clear responses already in CDN caches. Removal
requests require taking down the page/references, deleting unshared source
assets, and assessing cached copies and provider purge/support options; there
is no promise of retroactive secrecy or immediate erasure. The visitor notice
and operational data flow must describe the actual public-delivery model before
customer publication. Keep real customer content out of Preview and test traces.

## Action Items

1. Verify supported upload of one complete gallery ZIP. The owner rejected
   multiple independently opened packages; do not split, omit or recompress
   the delivery, or order a new paid service as a default workaround.
2. Scope the lightweight implementation separately from AB#29/145: CMS type,
   validated reader, unlisted page, deadline checks and explicit legacy mapping.
3. Verify source hashes, preservation of embedded metadata and true presentation
   dimensions accounting for EXIF orientation. Interpret orientation for display
   without rewriting the source JPEG; recheck finite dates,
   bind the approved import plan to fresh backup and capacity evidence, and test
   gallery navigation, downloads, exclusions and expiry before customer import.
4. Reconcile this accepted exception with AB#117's current AC5 and the applicable
   visitor notice before closing the launch gate. Record region, billing/usage
   alerts, cleanup limitations and an exercised recovery path.
5. Review implementation/continuity readiness before the **2026-10-15** legacy
   host retirement. This is a checkpoint, not a new end date for indefinite
   galleries. Future customer galleries require a separate scope decision.
