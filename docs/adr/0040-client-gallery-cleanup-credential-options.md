# ADR-0040: Client-gallery cleanup credential options

**Status:** Accepted — option B for the reference deployment (2026-10-25)
**Date:** 2026-10-25
**Deciders:** Project owner
**Work item:** AB#405; parent AB#395, AB#392

## Context

The owner requires automatic removal of expired delivery images and, once supported,
one whole ZIP. The selected services remain existing Sanity and Vercel
([ADR-0034](0034-ongoing-unlisted-client-delivery.md)). The
[source worker](../client-gallery-cleanup.md) is built and disabled. Before option B,
the activation policy required full dataset READ and restricted WRITE, plus
separate provider, writer and hosted acceptance. The scoped option B decision below
replaces the reference deployment's credential restriction. Page expiry already
closes the page; it does not delete files.

[AB#401's rehearsal](../audits/client-gallery-lifecycle-rehearsal-2026-10-24.md)
showed that a built-in Editor robot could dry-run a forbidden proof-type write.
The independent read found no committed document. This disproves that credential's
required narrowness; it does not establish every permission of every token.

Official documentation checked on **2026-10-25** describes built-in Editor content
access across project datasets and reserves custom roles for Enterprise.
[Roles and permissions](https://www.sanity.io/docs/content-lake/roles-concepts),
[roles guide](https://www.sanity.io/docs/user-guides/roles).
Actual commercial entitlement, pricing, backup coverage and recovery were not verified.

## Decision

On 2026-10-25 the owner explicitly chose **B**, answering “Hyväksyn erillisen
Editor-tunnuksen laajat oikeudet ja kuvatun riskin”. The reference deployment may
use a dedicated server-only Editor robot for delivery cleanup, accepting content
read/write rights across project datasets and the risk that a leaked token bypasses
application checks. This supersedes its earlier narrow-token prerequisite, not the
independent enrollment, inventory, revision, atomicity or shared-reference checks.

The exception is for this reference cleanup deployment only. It grants no broader
credential policy to other clones, proof-selection/reminder writers or human
publication sessions. A personal CLI session must not be installed in hosting.

**Both cleanup flags remain off.** Token provisioning, actual grant verification,
synthetic operational rehearsal, deployment and Production activation remain separate
steps. No paid plan is selected. Merging this record documents the already accepted
policy; it is not an activation command.

## Options Considered

| Option | Credential boundary | Required owner decision | Effect on automatic cleanup |
| --- | --- | --- | --- |
| **A — Custom role after provider verification (not selected)** | Full READ of the required dataset; WRITE limited to cleanup controls/cursor, new deliveries and image assets, subject to actual grant tests | Approve the provider capability/quote and the exact demonstrated grants and residual asset scope | Possible only after entitlement, role and hosted verification; current project observations do not establish feasibility |
| **B — Dedicated broad Editor exception (accepted)** | A dedicated robot token with the built-in Editor content rights; the configured worker uses only its selected dataset and approved deletion units | Owner accepted the broad-content risk and scoped policy exception on 2026-10-25 | Policy accepted for the reference deployment; actual provisioning and source/provider/hosted gates remain |
| **C — Retain the previous credential policy (not selected)** | No cleanup write credential installed in hosting | Decline a broader hosting credential and continue reviewed manual removal | Does **not** complete the requested automatic expiry deletion; page expiry continues independently |

No option introduces S3, PostgreSQL, a separate storage service or an embedded personal
CLI token. No option changes legacy enrollment, proof replacement or ZIP eligibility.

## Trade-off Analysis

A can reduce content-type and private-record exposure, but it does not automatically
express image ownership. Sanity documents that role filters cannot perform joins or
reference traversal. **Inference:** a general image-asset delete grant cannot establish
that an image belongs only to an enrolled delivery. Other unreferenced images may
remain within that grant. Independent inventory, shared-use checks and strong-reference
rejection remain necessary, and the owner must review the actual residual scope.
[Custom-role limits](https://www.sanity.io/docs/content-lake/roles-concepts).

B changes the credential boundary substantially. A leaked Editor token could read or
modify content across project datasets, including ordinary site content and dotted
private proof records. The dataset configured in the application does not downscope
the credential. The worker's exact enrollment, fresh inventory, revision guards,
transaction limits, shared-asset retention and uncertainty reconciliation constrain
its normal actions **in application code**; a stolen token bypasses them. No dataset
backup or recovery guarantee is established here. No project-settings or token-management
permission is inferred from the AB#401 dry run.

A dedicated token supports attribution and manual revocation; it is not process
isolation. A compromised server process may also reach other deployment credentials.
A separate hosted security boundary would require a further design, not merely a new
token name. Existing cron authentication and secret handling remain required.

C avoids installing that writer but leaves online assets until separately reviewed
removal. Customer-facing retention wording must continue to distinguish page expiry
from file deletion while cleanup is off. For manual removal, use the
[read-only impact inventory](../gallery-removal-impact.md), review current references
including drafts/releases, remove the approved page/references and delete only explicitly
approved unused assets through authenticated CMS administration. The inventory itself
never writes; do not replay an uncertain deletion or infer that all assets are unused.
Provider history/backups, CDN copies and downloaded files retain their documented limits.

## Read-only project evidence

At **2026-10-25 07:02:22 UTC**, an existing **owner personal Sanity CLI session** read
project features and the complete project role list. It found eight built-in roles,
zero custom roles and no listed `advancedRolesManagement` feature. This establishes
what those responses showed then, not a runtime robot's grant matrix, full READ
coverage, plan entitlement or a promise that a capability cannot be enabled later.

The reproducible GET procedure, using the configured project ID privately:

1. Read `https://api.sanity.io/v2021-06-07/projects/<projectId>?includeMembers=false&includeFeatures=true&includeOrganization=false`.
   Check the project identity and its documented string-array `features`.
2. Read `https://api.sanity.io/v2025-07-11/access/project/<projectId>/roles`.
   Read the documented `data` array and account for `nextCursor`; absence claims require
   the complete list. Custom-role creation requires `advancedRolesManagement`.
   [Projects API](https://www.sanity.io/docs/http-reference/projects-api),
   [Access API](https://www.sanity.io/docs/http-reference/access-api).

Three passes issued six GETs total. The first two stopped while diagnosing the role
response's `data`/`nextCursor` envelope; the final two-GET pass completed. No mutation,
role/token provisioning, plan change, email, upload, deletion or deployment occurred.

The closed report, provenance and exact reader are retained outside disposable
worktrees in the primary checkout's ignored `temp/ab405-review/` (directory 0700,
files 0600). No raw project/member records or credential values were retained there.
The personal session used for this observation must not be installed in hosting.

| Private artifact | SHA-256 |
| --- | --- |
| Final successful pass report | `1f7c680d1251f3ae6323fd56c8dc9e6c15548c1bd96f2aeef21c961f54d54cd9` |
| Probe provenance, including all passes | `9d5773adc7ee535e1117fa0c7201e175811c4260e359e3e8097f5ef0a3e356a4` |
| Subsequent owner decisions | `df2faf31f40346033c864f6fa2cddcb231310b03fa8c2b62930727771242c9f5` |

## Consequences

The credential policy and pending architecture labels now record the accepted
reference-deployment exception; the implementation remains default off. AB#405
records this decision; its eventual closure does not close AB#395 or enable cleanup.
Independent identity and proof-image revision corrections are AB#402/404;
their source fixtures do not establish hosted human Editor or deletion acceptance.
Proof replacement AB#396 retains its separate permissions/concurrency acceptance.
The owner separately accepted the [ADR-0035 ZIP media contract](0035-unlisted-delivery-zip-proposal.md)
on the same date. AB#407 subsequently merged in PR #626. The separate
[AB#408 hosted evidence](../audits/client-gallery-hosted-rehearsal-2026-10-28.md)
records temporary built-in Editor grant/expiry/revocation and actual scoped
retention/deletion, including native cron. Its four robots were retired; it supplies
no persistent Production credential or original-site activation. Non-admin human
Editor/Studio, remaining race/privacy and supported future transport gates stay
open. This credential record supplies no ZIP implementation or narrower provider grant.

## Action Items

- **For A:** obtain the provider capability/quote and owner approval before any purchase;
  review exact grants and image-asset breadth; separately authorize a dedicated robot
  and synthetic full-READ/allowed-WRITE/forbidden-WRITE rehearsal, including cursor
  create/update, proof/legacy/unrelated records and manual revocation.
- **For B (selected):** the owner acceptance is recorded above and in AB#392/395/405;
  maintained credential policy now carries this exact exception. Separately
  authorize provisioning one dedicated robot, distinct from human/selection/reminder
  credentials. Document how the owner identifies and manually revokes/replaces that
  exact token and safely updates the server-only Production setting; rehearse with
  synthetic data. No automatic key rotation or provisioning is implemented here.
- **While activation is pending:** keep cleanup flags and its hosting writer absent;
  use the reviewed manual procedure above. Verify retention copy describes actual
  deployment behavior, even though option B is now selected.
- **For every enabled option:** complete the remaining controlled strong-writer/no-release,
  role, provider/race/uncertain-result, hosted Studio/privacy and function/cron capacity
  checks in the [runbook](../client-gallery-cleanup.md#remaining-hosted-rehearsal).
  Schedule approval and deployment separately; neither an option choice nor its PR
  merge is an instruction to activate.

The owner response establishes the stated policy choice. No additional confirmation
of that same risk acceptance is needed. It is not permission to provision a token,
mutate customer content or enable flags in this source-work batch.
