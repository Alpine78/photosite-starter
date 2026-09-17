# Backlog: decision and agent-readiness map

**Last reviewed:** 2026-09-16

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
| AB#141 — Physical-device lightbox check | New | Run the specified tap, double-tap, pinch, pan, and close checks on a real touch device and record device/browser/results in ADR-0001. | The remaining manual lightbox verification. |
| AB#137 — Production Sanity dataset | Active | Run `npm run convert:joomla` in review mode over the selected inventory to produce the conversion findings, resolve the exception rows and supply alternative text, approve the launch manifest, verify a recoverable baseline, then run and audit the Production migration with a temporary write credential as described in [the migration handoff](sanity-seeding.md#migrating-approved-content-from-an-existing-site-ab137). Its AB#161 prerequisite is closed, so the 48 source-gallery article imports it was blocking are unblocked. | AB#117. |
| AB#117 — Production security and privacy review | Active | Review and accept the production evidence after AB#137, including any residual risks. | AB#18. |
| AB#18 — Production promotion | New | Perform owner-controlled domain, DNS, production secret, rollback, and smoke-test actions only after predecessors pass. | AB#118 handoff and rollback exercise. |
| AB#144 — Preview alias revision gate | Active | Confirm whether the acceptance criteria are met and the item can close. Its implementation merged as PR #99 (`0c4e42c`, 2026-08-31), but its final criterion — updating or removing the AB#136 known-limitation notes — depended on AB#136, which only closed 2026-09-10. Verify those notes, then close or state what remains. | Nothing else; it is a bookkeeping decision on already-merged work. |

## Dependency order

```text
AB#137 ──> AB#117 ──> AB#18 ──> AB#118   (AB#19 closed 2026-09-13, AB#161 closed 2026-09-16)

AB#54 ──> AB#55 ──> AB#58 ──> AB#71   (AB#65 spike closed 2026-08-27)
```

AB#150 and AB#151 both closed (merged 2026-09-04); their chain is done.
AB#136 closed on the board 2026-09-10: its fix merged as PR #141 (2026-09-07), and its
owner-run AC5 "exercise against Preview" completed 2026-09-07–09, with the evidence
recorded on the work item by PR #146.

AB#132's owner decision is now made (2026-09-11, PR #151, recorded in ADR-0007): retain
the Proxy's O(1) boundary rather than let it read content state to trade for initial
semantic 404 HTML. It is no longer awaiting an owner call — the underlying defect turned
out to be a known, already-tracked upstream Next.js bug
([vercel/next.js#62228](https://github.com/vercel/next.js/issues/62228), open since
February 2024), and this item now stays `Active` and blocked on an upstream fix landing
(a first attempt, `#88491`, was closed unmerged 2026-09-04; a second, `#98455`, opened
2026-09-09 and is still open) rather than on anything this project's owner or an agent
here can move. Re-check before AB#18's production promotion if the upstream issue is
still open by then.

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

## Current launch preparation

AB#19, AB#21, and AB#22 are `Closed` on Azure Boards as checked 2026-09-14.
The former AB#21 implementation recommendation was stale; its
three-level heading work has shipped. AB#22's shared table block also shipped.

The immediate launch path is AB#137, already `Active`. Its existing Preview
verification tooling is ready, and the customer-owned Production project and
public dataset exist. A local, ignored source inventory and image reconciliation
have begun, but no public launch manifest has been approved, no Production
content has been written, and AB#137's live acceptance criteria remain open.
The selected source content also exposed one implementation prerequisite,
recorded as **AB#161**: an `article` must be able to carry a large gallery at
the end of its body, on the same page and in one continuous image order. The
current 1–12-image mini-gallery cannot represent that case, and reclassifying
an editorial article as a gallery would change its primary content identity.
**AB#161 closed 2026-09-16** (PR #164, merged `f0247a1`) with the scoped
ADR-0003 amendment and the bounded article end-gallery result described in
`AGENTS.md`'s feature-status section, so the 48 source-gallery article imports
it was blocking are unblocked; AB#137 remains `Active` and is now the sole
predecessor on the launch chain.
The [migration handoff](sanity-seeding.md#migrating-approved-content-from-an-existing-site-ab137)
sets the approval, baseline, private-content exclusion, audit, and revocation
sequence. The source inventory is private and is not part of this repository.

AB#24 shipped in PR #154 and closed on 2026-09-12. Inline mini-galleries are now
the seventh shared body block, bounded to 12 images, uncropped, unpaginated,
and isolated into their own lightbox sequences.

Other work still needs an owner decision, credential, physical device,
infrastructure, or an evidence run before dependent implementation can proceed:

- The **Owner action or decision** table above (AB#141, then the
  AB#137 → AB#117 → AB#18 launch chain).
- **AB#132** is decided and blocked externally; re-check the upstream Next.js
  fix before Production promotion.
- The **private-gallery branch** (AB#29, AB#145, AB#130) needs its own
  private stores and is separate from the Joomla source inventory.
- **AB#60** needs a dynamic-result entry point or an owner amendment to its
  acceptance criteria.
- **AB#54 → AB#55** and **AB#95** need owner-run evidence or product decisions.

**Next step:** the whole importer now exists — the conversion half
(`npm run convert:joomla`, `scripts/joomla-*.mts`), which converts an exported
article set into the shared content blocks, gates on the owner's approval
manifest, and reports every refusal and lossy transformation while writing
nothing anywhere; and the write half (`npm run write:joomla`,
`scripts/write-joomla-content.mts`, `scripts/joomla-image-derivative.mts`),
which turns an approved plan into real Sanity documents — dry-run by default,
never trusting the plan file blindly, generating and uploading each
photograph's public derivative, resolving category references against the
target dataset, and running a target-dataset collision preflight before
writing anything. What remains is entirely owner-run — the review pass over
the real inventory, the exception-row resolutions and alternative text it will
call for, the manifest approval, minting the temporary `SANITY_MIGRATION_TOKEN`,
running the write against the real Production dataset, and then the audit,
credential revocation, and handoff evidence. Keep AB#137 `Active` until all of
that is done. Then proceed to AB#117.

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
