# ADR-0034: Ongoing unlisted client delivery in the existing Sanity project

**Status:** Accepted
**Date:** 2026-10-16
**Deciders:** Project owner (Ilkka Rytkönen)
**Work item:** AB#29 (delivery); AB#145 (administration); related AB#130 (proof selection)

## Context

The owner states that S3 will never be adopted for their occasional customer
images and selects unlisted galleries for their own client work as the final
direction. This supersedes the earlier interpretation that the owner's
prioritization of client galleries also prioritized the protected-storage model.

[ADR-0028](0028-legacy-unlisted-gallery-continuity.md) accepted existing Sanity
storage only for 21 retained migration galleries. Consequently AB#29/145 still
required the separate S3-compatible object store, PostgreSQL and capability
access in [ADR-0014](0014-private-gallery-security-delivery-retention-boundary.md).
That parallel development target no longer represents this owner's deployment.

The [2026-10-15 availability readback](../audits/ab250-release-verification-2026-10-12.md#production-readback--2026-10-15)
records 21 published galleries, 1,792 image placements and 12 ZIP assets. It proves
page availability, not complete file integrity or a future-gallery authoring flow.
This decision does not claim a fresh inspection of cloud resources.

## Decision

1. The reference deployment uses the existing Sanity project/dataset and media
   delivery for ongoing client delivery, including future work. Customer galleries
   are unlisted: omit them from ordinary navigation, categories, feeds, site search,
   keyword galleries and sitemaps; retain page noindex, no-store and no-referrer policies.
   A direct link opens the gallery without a customer account or capability session.
2. No S3-compatible store or separate PostgreSQL service is required or to be
   provisioned for this workflow. Protected development remains disabled. This
   deployment choice imposes no infrastructure choice on other template clones.
3. Unlisted means reduced discovery, not confidentiality. In the current public
   Sanity dataset, documents/references can be enumerated without a gallery link.
   Image and ZIP URLs are public and forwardable. Page expiry, unpublishing or
   replacing a page link cannot revoke known asset URLs, downloaded copies or
   cached bytes. No promise of protected ZIPs or instant remote erasure applies.
4. Keep customer contact/job records, credentials, private-only assets, camera
   masters and archive locators outside public CMS fields and browser payloads.
   New content uses the ordinary approved public-media boundary until its own
   delivery-file contract is reviewed. ADR-0028's byte-preserved legacy JPEG and
   whole-ZIP operational exceptions remain limited to their original retained set.
5. Preserve existing finite deadlines and deliberately indefinite legacy galleries.
   For new work, authoring, explicit availability and one whole processed-JPEG ZIP
   where supplied are delivery goals. New expiry defaults, file eligibility, quota
   and whole-package feasibility need implementation evidence before publication.
   This decision grants no batch upload, CMS mutation or production activation.
6. AB#29/145 now track unlisted delivery and its administration. Remove protected
   authorization, capability revocation, mandatory six-month deletion and private
   storage provisioning from their active acceptance criteria. Preserve the former
   scope in history. Proof selection (AB#130) is deferred pending a compatible
   design; it is not silently converted into public writable selections.
7. Close PRs #446–#451 without merging their protected-model implementation.
   Retain source branches and worktrees. Previously merged inactive protected code
   stays in place until a separate dependency/regression audit establishes removal
   scope. Working code is not evidence that the owner wants its product model.

For this reference deployment, this is a scoped supersession of ADR-0014's
storage/access/lifecycle target, ADR-0015's required custom administrator path,
and ADR-0028's restriction of the *chosen unlisted direction* to legacy galleries.
It explicitly supersedes AB#122's earlier prohibition on public Sanity client
assets and the October 16 prioritization comments on AB#29/130/145 that retained
ADR-0014/0015 as the implementation target. Historical protected contracts remain
valid descriptions of that alternative, not prerequisites for this owner's work.

## Options Considered

- Existing Sanity with unlisted delivery: the owner's final choice.
- Separate protected object storage and metadata store: rejected for this
  deployment because their operating cost is unjustified for occasional work.

## Trade-off Analysis

Reusing existing services removes separate provisioning and operations. It does
not establish zero additional Sanity storage/bandwidth charges. Public delivery
accepts enumeration, copying and persistent direct file access. Noindex is a
crawler instruction, not authorization. Making a dataset private alone would
not establish protected asset delivery and is not a decision taken here.

## Consequences

The 21 existing galleries stay on their current path. The code is migration-bound:
`legacy-gallery-deployment.ts` requires an approved batch and a deployed handle
allowlist; `legacy-gallery-sanity.ts` validates the bound manifest and current
publication/deadline; the Studio legacy gallery fields are read-only. A general
new-gallery editor is therefore not completed by selecting the same storage.
The existing custom `/admin` manages the inactive protected model, not these
Sanity documents. Administration must remain authenticated even when customer
viewing requires no login.

## Action Items

- AB#29: audit and implement ongoing unlisted delivery separately from the legacy
  importer, preserving full-frame display, listing/search/sitemap exclusion,
  page response policies, explicit availability and existing links.
- AB#145: choose and implement authenticated Sanity-backed creation/publication
  and management, with current revision/manifest checks and deliberate page
  unpublishing. Do not reuse capability-revocation promises for public files.
- Before new publication: define eligible processed images and whole ZIPs,
  filename/metadata exposure, non-customer-derived link generation, availability
  defaults, current Sanity quota/file-size feasibility and usage monitoring.
- Define removal handling: remove page/references first, check shared asset usage
  before asset deletion, and document provider-cache and downloaded-copy limits.
- AB#130: redesign selection authorization and data storage without requiring the
  rejected S3/Postgres deployment. Selection writes and customer data need a
  separate explicit boundary; no automatic public-write permission follows.
- Audit inactive protected routes, fixtures, adapters, tests and documentation
  before proposing removal; keep the production feature off meanwhile.
