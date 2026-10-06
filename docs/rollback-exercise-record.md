# Rollback exercise record (AB#208)

Copy into ignored private evidence and fill after AB#18 promotion. This blank record
prepares AB#118; no rollback or successful recovery is claimed. Use the existing
[promotion and rollback commands](deployment.md#promotion-and-rollback).
Never record credentials, customer data, signed links or raw provider responses.

| Field | Recorded value / evidence |
| --- | --- |
| Date UTC, authorized operator, incident or controlled exercise | Pending |
| Candidate: immutable source SHA, deployment ID, artifact digest | Pending |
| Known-good: immutable source SHA, deployment ID, artifact digest | Pending |
| Known-good deployment still available and usable with actual hosting tier | Pending |
| Read credential valid for the intended dataset; no secret values | Pending |
| Code/CMS compatibility for each planned page version and media shape | Pending |
| Full current content baseline, export digest, asset inventory, freshness | Pending |
| Chosen recovery path and bounded abort criteria | Pending |
| Pre-recovery route, gallery and content observations | Pending |
| Action time, target identity and result | Pending |
| Post-recovery routes, galleries, content and cache observations | Pending |
| Contact/enquiry delivery, mailbox arrival and Reply-To verification | Pending |
| Availability and failure-triage evidence references | Pending |
| Failed steps, residual impact, responsible operator and next action | Pending |

## State boundaries to verify independently

| Boundary | Required recovery evidence |
| --- | --- |
| Public alias / web DNS | Actual destination and TLS/canonical behavior; preserve mail records |
| Application code | Exact known-good deployment and source/artifact identity |
| CMS documents | Backup freshness, approved mutations, actual receipts, post-restore audit |
| Shared assets | Pre-existing versus newly written IDs; do not delete shared baseline assets |
| Cached pages | Current content and pagination after invalidation/reconciliation |
| Credentials | Working read access; revoke temporary writer separately and verify revocation |
| Outgoing mail | Already accepted/sent messages cannot be undone by alias rollback |

A previous renderer can be incompatible with newly imported content. The reference
migration has fourteen accepted page versions the old public renderer cannot read.
Record exact compatibility and recovery ordering before choosing that deployment;
code rollback alone restores neither content, assets, cache nor credentials.

Before a custom-domain cutover, removing newly added **web-only** records can restore
the pre-cutover routing situation. It is a different recovery path from selecting a
previous Vercel deployment, and does not imply the retired legacy host is available.
Do not assume a hosting tier or any deployment/log/backup retention duration.

## Handoff after the exercised recovery

| Control / access | Owner-controlled proof | Implementer access removed or expiry |
| --- | --- | --- |
| Hosting, CMS, repository and deployment controls | Pending | Pending |
| Domain, DNS, email delivery and independent mail accounts | Pending | Pending |
| Backups, isolated restore and recovery access | Pending | Pending |
| Availability failure/recovery notifications (AB#158) | Pending | Pending |
| Production failure trace and response (AB#159) | Pending | Pending |

Record actual failures as failures. AB#118 remains open until the recovery and transfer
are exercised and accepted; this template cannot establish acceptance.
