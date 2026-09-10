# Backlog: decision and agent-readiness map

**Last reviewed:** 2026-09-10  
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
| AB#132 — Semantic 404 HTML | Active | Decide whether the Proxy may read enough content state to rewrite a request to an unmatched route, trading its current O(1) boundary for initial semantic 404 HTML; otherwise retain the documented JavaScript-dependent limitation. | A bounded implementation decision for all matched-route 404s. |
| AB#141 — Physical-device lightbox check | New | Run the specified tap, double-tap, pinch, pan, and close checks on a real touch device and record device/browser/results in ADR-0001. | The remaining manual lightbox verification. |
| AB#19 — Legacy URL redirects | Active | Review the attached Joomla URL inventory and choose a canonical target or justified 410 for every important source URL. | A machine-checkable deployment mapping and its production-build tests. |
| AB#137 — Production Sanity dataset | Active | Approve launch content, use the customer-owned Production Sanity project, provide a temporary write credential for the operator run, approve audit evidence, then revoke the credential. | AB#117. |
| AB#117 — Production security and privacy review | Active | Review and accept the production evidence after AB#137, including any residual risks. | AB#18. |
| AB#18 — Production promotion | New | Perform owner-controlled domain, DNS, production secret, rollback, and smoke-test actions only after predecessors pass. | AB#118 handoff and rollback exercise. |
| AB#144 — Preview alias revision gate | Active | Confirm whether the acceptance criteria are met and the item can close. Its implementation merged as PR #99 (`0c4e42c`, 2026-08-31), but its final criterion — updating or removing the AB#136 known-limitation notes — depended on AB#136, which only closed 2026-09-10. Verify those notes, then close or state what remains. | Nothing else; it is a bookkeeping decision on already-merged work. |

## Dependency order

```text
AB#19 + AB#137 ──> AB#117 ──> AB#18 ──> AB#118

AB#54 ──> AB#55 ──> AB#58 ──> AB#71   (AB#65 spike closed 2026-08-27)
```

AB#150 and AB#151 both closed (merged 2026-09-04); their chain is done.
AB#136 closed on the board 2026-09-10: its fix merged as PR #141 (2026-09-07), and its
owner-run AC5 "exercise against Preview" completed 2026-09-07–09, with the evidence
recorded on the work item by PR #146.

A batch of five bugs closed 2026-09-10, all merged to `main` beforehand: AB#152
(lightbox preload retry, PR #140), AB#153 (admin sign-in secret in the URL before
hydration, PR #142), AB#154 (Sanity cache reuse under scheduled expiry, PR #143),
AB#155 (mobile content-hero overflow, PR #144), and AB#156 (Sanity custom warning
registration, PR #145). None of those PR bodies carried a `Fixes AB#<id>` line, so
nothing closed automatically and each item sat in `Active` or `Resolved` for up to
three days after its fix shipped — the failure mode `AGENTS.md` warns about. Carry the
closing line in the PR body, or close the item explicitly after the merge.

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
| AB#60 — Enquiry about a public gallery item | Open only for a dynamic entry point or an AC amendment | PR1 (identity/authorization seam), PR2 (`POST /api/enquiry`), PR3 (lightbox surface + `e2e/gallery-enquiry.spec.ts`), and AB#123 (identity/origin smoke) are all merged. What remains is not implementation: a dynamic-result entry point needs AB#58/AB#71 (not built), or the owner amends the acceptance criteria to close it as curated-only. |

## Keyword and commerce discovery branches

| Work item | Readiness | Required next step |
| --- | --- | --- |
| AB#54 — Keyword extraction spike | Owner-run evidence gathering | Export the three specified Lightroom control JPEGs and upload them through the real non-production Sanity path; record exact Lightroom/export settings and observed metadata. |
| AB#55 — Keyword taxonomy ADR | Blocked on AB#54 evidence | AB#65 spike closed 2026-08-27 (recommends strategy B — ancestor closure materialized on the medium; see `docs/keyword-query-benchmark.md`). Still needs AB#54's Lightroom evidence, then decide the taxonomy, ingest, privacy, hierarchy, and article-tag boundary before implementation. |
| AB#95 — Sales / checkout / fulfilment ADR | Product discovery | Decide first sales use case and product/provider/privacy boundary. Do not implement checkout, cart, payments, or fulfilment in this item. |

## First agent-ready implementation candidate

**None currently groomed and unblocked.** AB#151 — the previous candidate — shipped in
PR #138 (merged 2026-09-04), closing the last isolated implementation story on the board.
Every remaining open item needs an owner decision, credential, physical device, infra
step, or evidence run before dependent implementation work exists:

- The **Owner action or decision** table above (AB#132, AB#141, AB#19, then the
  AB#137 → AB#117 → AB#18 launch chain).
- The **private-gallery branch** (AB#29, AB#145, AB#130) is blocked on the
  owner-provisioned object and metadata stores.
- **AB#60** is functionally complete through PR3 and AB#123; it stays open only for a
  dynamic-result entry point (AB#58/AB#71, not built) or an acceptance-criteria
  amendment — an owner call, not implementation.
- **AB#24** (inline mini-galleries in the article body), a child of AB#91, is the
  nearest future implementation slice — a bounded extension of the existing
  content-body-block and lightbox boundary — but it is still titled *(rough)* and has
  no acceptance criteria, so it needs grooming before delegation.
- **AB#21** (article table of contents) is *not* interchangeable with AB#24 as a
  grooming target: it calls for a three-level nested table of contents, while
  `ContentBlock` models an authored heading as `level: 2 | 3`
  (`src/lib/content-page.ts`) because the page title owns the `h1`. Raising that cap is
  a body-model decision the story's own description already flags, and it has to be
  made before AB#21 has an implementable scope at all.
- **AB#54 → AB#55** and **AB#95** are owner-run evidence and product-discovery work.

**Fastest path to the next implementation slice:** resolve AB#132 — a bounded,
self-contained decision with a defined implementation task on the other side of it — or
groom AB#24 to implementation-ready. AB#21 is a longer path than either, because the
heading-level decision has to be settled first.

## Handoff checklist for another machine or agent

- Pull the repository and read this file plus the current `AGENTS.md`. `origin` is the
  GitHub remote (`git@github.com:Alpine78/photosite-starter.git`) and is the only remote
  configured; an earlier revision of this checklist described `origin` as a dead Azure
  DevOps URL and named a separate `github` remote, which is no longer the case.
- Check `git status` before editing; do not overwrite or reset another worker's
  uncommitted changes. On 2026-09-10 the primary worktree was clean at `main` (`b060e17`).
- How the board is reached depends on the machine. From the WSL/Linux checkout,
  `az boards` works directly against the configured defaults (`az devops configure
  --list` shows organization `ilkkarytkonen` and project `photosite-starter`), for both
  reads and `--state` transitions; no PAT header was needed on 2026-09-10. From the
  primary Windows machine it currently needs the PAT + REST path (`az devops login`
  fails to authenticate there). A `Work Items (Read & write)` PAT with an
  `Authorization: Basic base64(":<PAT>")` header against
  `https://dev.azure.com/ilkkarytkonen/photosite-starter/_apis/wit/...` is the working
  method there, and the same `PATCH` route performs the required state transitions.
  Note that `az boards` prints a "no Azure DevOps remote was found" warning ahead of its
  output because `origin` is GitHub; the configured defaults still supply the context,
  so the warning is expected rather than a failure — but it does corrupt `--output json`
  for a naive parser, since the warning precedes the JSON document.
- Read the current Azure Boards item, including description, acceptance criteria,
  discussion, and relations, before changing or reviewing it.
- Move an implementation item to `Active` before the first file change; close it only
  after merge and user acceptance, following `AGENTS.md`.
