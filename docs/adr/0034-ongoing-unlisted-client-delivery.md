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


## Scoped retention amendment — 2026-10-24 (AB#392)

The owner's request after PR #609 adds automatic removal of customer images and the
whole ZIP when a client gallery expires, with a six-month delivery default. This
amends decisions 5–6 and the removal action item: the historical removal of the
protected model's mandatory six-month worker no longer means the selected Sanity
workflow needs no cleanup. The rest of ADR-0034, including public-file exposure,
shared-use checks, no S3/PostgreSQL and separately authorized activation, remains.

AB#393 supplies an editable Studio creation suggestion of six calendar months from
draft creation, with UTC time preserved and the target day clamped to month-end.
Publication does not restart the clock. Existing/legacy records and indefinite access
are not migrated. ADR-0038's proof default and private-record retention are untouched;
the owner's answer on extending the new default to proofs is still needed.

The requested product behavior is recorded; an automatic executor is **not yet
implemented**. AB#394 covers pure eligibility planning and AB#395 covers enrollment,
execution, scheduling and hosted verification. No new gallery is enrolled merely by
receiving a date default. [Client gallery retention](../client-gallery-retention.md)
records the required safeguards and limits, with the final concurrency/provider
contract still to verify before activation. The amendment does not accept ADR-0035
or authorize a new ZIP upload, real deletion or production activation.

**Owner clarification later on 2026-10-24:** the proof question above is resolved.
The six-month default and expiry worker are delivery-only; proofs must be deleted
when their linked replacement delivery is published. See the accepted
[ADR-0038 amendment](0038-proof-selection-in-existing-sanity.md#replacement-deletion-amendment-2026-10-24).
The publication/deletion implementation is AB#396, distinct from delivery expiry AB#395.

### Enrollment implementation note — 2026-10-24 (AB#397)

The retention amendment now has a source-only Studio enrollment slice: an explicit,
default-off publication choice stores one private deterministic control record in the
existing Sanity dataset. The reviewed source revision and unique publication identity
audit approval separately from the gallery revision used by a fresh worker plan.
Publication and control creation/CAS update are atomic; withdrawal fences old pending
attempts. All unenrolled deliveries require deliberate opt-in, including new finite
deliveries: current publication absence cannot prove a gallery was never published.
Text edits retain consent,
while changed retention policy is displayed for renewed review. Proofs, indefinite
deliveries and legacy records cannot enroll in this contract.

This bounded latest-state record avoids a separate service/history/outbox and excludes
customer/contact data. Stored approval is not an access-control boundary against dataset
writers and never replaces independent gallery validation. Kept shared assets receive no
later sweep; open drafts and incoming gallery references can block cleanup until resolved.
The server worker, hosted provider/role/race rehearsal and activation remain AB#395/398.
This note changes no public-file exposure rule, ZIP eligibility or owner activation gate.

### Executor implementation note — 2026-10-24 (AB#398)

The separate source worker and authenticated daily schedule are now built, default-off.
One non-cursor full-readable dataset snapshot plus strict fresh Doc reads supplies
reference evidence; the planner rebinds the approved policy to the current revision.
The control revision fences pending/uncertain work before fresh attempts. Source,
unshared web images and a matching completion receipt change atomically; shared images
remain without a later sweep. No new ZIP schema/eligibility, legacy enrollment or proof
timer is introduced.

This is implementation evidence, not hosted acceptance or a change to the accepted
activation boundary. Full dataset READ includes transient private proof fields; image
WRITE grants can be broader than enrolled ownership. Late arbitrary weak/release
writers remain outside the protocol. AB#395 retains the controlled-writer, role,
capacity, provider-semantics and synthetic-race rehearsal before deliberate activation.
See [the cleanup runbook](../client-gallery-cleanup.md) for limits and operational evidence.

### Cleanup credential amendment — 2026-10-25 (AB#405)

The owner selected [ADR-0040 option B](0040-client-gallery-cleanup-credential-options.md):
a dedicated server-only Editor robot may perform reference-deployment delivery
cleanup despite its broad content rights across project datasets. A leaked token
bypasses application checks; the owner explicitly accepted that risk. This replaces
the earlier narrow-credential prerequisite for this cleanup deployment only, not for
other clones or writers. Independent enrollment, full inventory, revision guards,
atomic deletion, shared-use retention, controlled writers and uncertain-outcome
reconciliation remain mandatory. Full READ and the actual configured grants still
need verification.

The worker remains disabled. This policy acceptance provisions no token and changes
no Production environment, role, deployment or activation. The separately accepted
[ADR-0035 media contract](0035-unlisted-delivery-zip-proposal.md#accepted-scope--2026-10-25)
permits a reviewed future whole processed-JPEG ZIP; AB#407 implementation and supported
large-file transport/account/publication evidence remain pending.
