# Backlog: decision and agent-readiness map

**Last reviewed:** 2026-09-12  
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

## First agent-ready implementation candidate

**AB#24 — inline mini-galleries within the article body.** Groomed 2026-09-12: the
*(rough)* marker is gone from its title, its description carries the scope and the
inherited boundary, and it has acceptance criteria AC1–AC9. Every prerequisite is closed
(AB#106, AB#67, AB#15, AB#147), so an agent can start with the implementation defaults
below, without another owner decision, credential, device, or external evidence run.
The item remains `New`: grooming does not start implementation. It is a bounded extension of the existing
content-body-block and lightbox boundary — a seventh `ContentBlock` kind with its own
lightbox sequence, no pagination, and an ADR-0003 amendment in the same PR.

The implementation defaults are a two-column cap, at most 12 images per block, and an
optional block title. The owner may revise them during review. Untitled lists get a
localized name containing their ordinal within the body; repeated titles and collisions
with fallback names must also be disambiguated. Focus returns to the thumbnail for the
occurrence displayed when the viewer closes, matching the existing wrapper, including
after navigation and when a photograph appears more than once.

No pagination is a simplicity decision for a small, bounded array. ADR-0003's sitemap
rule does not prohibit cursor continuations, and pagination would not inherently couple
the block to the curated result. The seventh-block ADR amendment belongs in the future
implementation PR.

Verify nested providers against a production build before building the rest. This is an
integration check, not an established PhotoSwipe nesting defect: the wrapper passes an
explicit slide list, and installed PhotoSwipe 5.4.4 mounts its dialog under `document.body`
by default and guards against concurrent open viewers. Exercise opening, navigating,
closing, and reopening each sequence, including focus return. Loose body images before
and after a mini-gallery must remain one body-wide sequence; one provider per contiguous
run is not an equivalent fallback because it could split that sequence.

Everything else on the board still needs an owner decision, credential, physical device,
infra step, or evidence run before dependent implementation work exists:

- The **Owner action or decision** table above (AB#141, AB#19, then the
  AB#137 → AB#117 → AB#18 launch chain).
- **AB#132** is decided and blocked externally, not awaiting an owner call — see the
  dependency-order section above. Nothing to delegate here until the upstream Next.js
  fix (`vercel/next.js#98455`, currently open) lands.
- The **private-gallery branch** (AB#29, AB#145, AB#130) is blocked on the
  owner-provisioned object and metadata stores.
- **AB#60** is functionally complete through PR3 and AB#123; it stays open only for a
  dynamic-result entry point (AB#58/AB#71, not built) or an acceptance-criteria
  amendment — an owner call, not implementation.
- **AB#21** (article table of contents) cannot be groomed the way AB#24 just was until
  one decision is made: it calls for a three-level nested table of contents, while
  `ContentBlock` models an authored heading as `level: 2 | 3`
  (`src/lib/content-page.ts`) because the page title owns the `h1`. Raising that cap is
  a body-model decision the story's own description already flags, and it has to be
  made before AB#21 has an implementable scope at all.
- **AB#54 → AB#55** and **AB#95** are owner-run evidence and product-discovery work.

**Fastest path to the next implementation slice:** delegate AB#24 — it is groomed,
unblocked, and needs nothing from the owner to start. The next grooming target after it
is AB#21, once the heading-level decision above is settled.

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
