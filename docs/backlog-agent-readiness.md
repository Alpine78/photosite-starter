# Backlog: decision and agent-readiness map

**Last reviewed:** 2026-09-04  
**Authoritative source:** Azure Boards. This document is an operational map only: the
work item supplies current scope, acceptance criteria, discussion, relations, and state.

## How to use this map

1. Resolve items in **Owner action or decision** before delegating dependent work.
2. Before implementation or review, read the current Azure Boards work item in full.
3. Give an agent an isolated worktree and a work item whose stated dependencies are
   closed or otherwise explicitly satisfied.
4. Treat this map as stale after a Board change; update its date and affected row when
   the order or readiness changes.

## Owner action or decision

| Work item | Current state | Required owner action or decision | Unblocks |
| --- | --- | --- | --- |
| AB#136 — Stable protected Preview alias | Active | Choose an unused machine-only `*.vercel.app` host and set it as `PREVIEW_STABLE_ALIAS` in Azure DevOps variable group `photosite-starter-vercel-preview`; or set `PREVIEW_DEPLOYMENT_ENABLED=false` until Preview is wanted. | A healthy Preview pipeline and durable Sanity webhook URL. |
| AB#150 — Authored event date / scheduled end | Active | Record whether cache staleness after `endDate` is accepted within the existing cache TTL or needs a scheduled revalidation trigger. | Completion of the shared content-date/cursor change; then AB#151. |
| AB#132 — Semantic 404 HTML | Active | Decide whether the Proxy may read enough content state to rewrite a request to an unmatched route, trading its current O(1) boundary for initial semantic 404 HTML; otherwise retain the documented JavaScript-dependent limitation. | A bounded implementation decision for all matched-route 404s. |
| AB#141 — Physical-device lightbox check | New | Run the specified tap, double-tap, pinch, pan, and close checks on a real touch device and record device/browser/results in ADR-0001. | The remaining manual lightbox verification. |
| AB#19 — Legacy URL redirects | Active | Review the attached Joomla URL inventory and choose a canonical target or justified 410 for every important source URL. | A machine-checkable deployment mapping and its production-build tests. |
| AB#137 — Production Sanity dataset | Active | Approve launch content, use the customer-owned Production Sanity project, provide a temporary write credential for the operator run, approve audit evidence, then revoke the credential. | AB#117. |
| AB#117 — Production security and privacy review | Active | Review and accept the production evidence after AB#137, including any residual risks. | AB#18. |
| AB#18 — Production promotion | New | Perform owner-controlled domain, DNS, production secret, rollback, and smoke-test actions only after predecessors pass. | AB#118 handoff and rollback exercise. |

## Dependency order

```text
AB#136 ──> stable Preview and webhook verification

AB#19 + AB#137 ──> AB#117 ──> AB#18 ──> AB#118

AB#150 ──> AB#151

AB#54 ──> AB#55 ──> keyword schema / ingest / query work
```

## Post-MVP private-gallery branch

The governing private-gallery boundary is already decided by AB#122 and
[ADR-0014](adr/0014-private-gallery-security-delivery-retention-boundary.md):
single-site, intentionally shareable capability access, six-month expiry, uncropped
web derivatives, and one protected full-gallery ZIP for delivery. This is not SaaS and
is not MVP work.

| Work item | Readiness | Notes |
| --- | --- | --- |
| AB#29 — Customer-facing delivery gallery | Blocked for deployment | Requires the owner-provisioned private S3-compatible object store and PostgreSQL-family metadata store. It owns viewing, protected ZIP access, and the expiry/deletion lifecycle. |
| AB#145 — Administer delivery galleries | Blocked for deployment | Requires the same stores and a Resend account. It owns admin authentication, publication, notification, resend, revoke, and replace. |
| AB#130 — Private proof selection | Not ready | Builds on the private-gallery boundary but is separate from delivery; no checkout or automatic payment is in scope. |
| AB#60 — Enquiry about a public gallery item | Candidate after dependency check | It is enquiry-only, reuses the contact path, and keeps archive locators server-only. Re-read the item and its contact/media dependencies before delegation. |

## Keyword and commerce discovery branches

| Work item | Readiness | Required next step |
| --- | --- | --- |
| AB#54 — Keyword extraction spike | Owner-run evidence gathering | Export the three specified Lightroom control JPEGs and upload them through the real non-production Sanity path; record exact Lightroom/export settings and observed metadata. |
| AB#55 — Keyword taxonomy ADR | Blocked on AB#54 and AB#65 evidence | Decide the taxonomy, ingest, privacy, hierarchy, and article-tag boundary before implementation. |
| AB#95 — Sales / checkout / fulfilment ADR | Product discovery | Decide first sales use case and product/provider/privacy boundary. Do not implement checkout, cart, payments, or fulfilment in this item. |

## First agent-ready implementation candidate

**AB#151 — Per-article author byline** becomes a good isolated implementation task only
after AB#150 is merged and the article hero's final metadata-line layout is decided. It
has a bounded article-only model change, a SiteSettings fallback, a Sanity projection,
fixtures, tests, and no gallery-scope expansion.

## Handoff checklist for another machine or agent

- Pull the repository and read this file plus the current `AGENTS.md`.
- Check `git status` before editing. On 2026-09-04 the primary worktree had uncommitted
  AB#150 changes; do not overwrite or reset another worker's changes.
- Read the current Azure Boards item, including description, acceptance criteria,
  discussion, and relations, before changing or reviewing it.
- Move an implementation item to `Active` before the first file change; close it only
  after merge and user acceptance, following `AGENTS.md`.
