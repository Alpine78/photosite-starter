# Backlog: decision and agent-readiness map

**Last reviewed:** 2026-10-22, against an Azure Boards query of every `New` and
`Active` user story, task and bug.

**Authoritative source:** Azure Boards. This document is an operational map only: the
work item supplies current scope, acceptance criteria, discussion, relations, and state.
The running history is in [`feature-status.md`](feature-status.md); this map does not
repeat it.

## How to use this map

1. Resolve items in **Owner action or decision** before delegating dependent work.
2. Before implementation or review, read the current Azure Boards work item in full.
3. Give an agent an isolated worktree and a work item whose stated dependencies are
   closed or otherwise explicitly satisfied.
4. Treat this map as stale after a Board change; update its date and affected row when
   the order or readiness changes.

## Launch path

```text
AB#19 ──> AB#137 ──> AB#117 ──> AB#18 ──> AB#118
```

The reference site is already served from its production domain; these items record
the launch *acceptance*, not whether the site is up. Every row below is gated on owner
actions, approvals or accounts; an agent can prepare evidence but cannot close them.

| Work item | State | Recorded status | Who moves it next |
| --- | --- | --- | --- |
| AB#19 — Legacy URL redirects | Active | 415-row canonical-host report verified on Production 2026-10-18; waits on AB#137's gate and owner acceptance. | Owner |
| AB#137 — Production dataset | Active | Approved content imported and audited in batches; remaining approvals and post-write evidence are listed in feature-status. 2026-10-21: two dead Movescount links on the Polar M600 quick-test article (FI/EN) need an owner content decision. | Owner |
| AB#117 — Security and privacy review | Active | 2026-10-21 Production audits: headers match ADR-0011, 166/166 reciprocal hreflang, 451/451 internal links answer 200, no reflow overflow after AB#382. 2026-10-22: per-request script nonce merged (AB#390, Closed), live with the next manual release; the next header check must expect it. Residual findings and acceptance remain. | Owner |
| AB#18 — Production promotion | Active | Production serves main `90543d5` (manual release 2026-10-21, deployment `dpl_ARuiTPxfvhAsn7D4foP2ajzfchVE`); provider alias/artifact verification and acceptance remain. | Owner |
| AB#118 — Rollback and handoff | New | Starts after AB#18; [rollback exercise record](rollback-exercise-record.md) defines the evidence. | Owner, then agent for inventories |
| AB#131 — Two-domain email migration | Active | Owner-run DNS/mailbox work; [mail recovery evidence](mail-recovery-evidence.md). | Owner |
| AB#158 — Availability monitoring | Active | Monitor options merged (PR #561); the owner chooses and controls the monitor account. | Owner |
| AB#159 — Production failure triage | Active | [Runbook](production-failure-triage.md) prepared; the live controlled-failure exercise remains. | Owner with agent |
| AB#132 / AB#370 — Scriptless 404 HTML | Active | Blocked upstream: [vercel/next.js#62228](https://github.com/vercel/next.js/issues/62228) and its fix PR #98455 were both still open on 2026-10-22, and 16.4.2 is the latest release. Risk acceptance re-review due 2026-12-19 (AB#370). | Upstream |
| AB#250 — Retained legacy galleries | Active | 21 galleries served from Sanity; whole-ZIP exception accepted 2026-10-14 (ADR-0028 amendment). Acceptance remains. | Owner |
| AB#255 — FI/EN coverage | Active | Remaining gaps are authored content and owner approvals; see [bilingual page coverage](bilingual-page-coverage.md). | Owner |

## Implemented, awaiting owner review or acceptance

| Work item | State | What exists | What is needed |
| --- | --- | --- | --- |
| AB#321 — Gallery layouts, filtering, reading | Active | Every child slice (AB#322–AB#369) is Closed. | Content activation for article-end sections and the mobile contents decision. |
| AB#301 — Studio identity presentation | Active | Readable previews (PR #339) and grouped identity fields, recorded in feature-status. | Studio deployment and authenticated editor check; stored-identity retirement under ADR-0030/0031. |
| AB#289 — Public photo enquiries | Active | Default-on setting implemented. | CMS activation and a mailbox receipt check. |
| AB#252 — Home latest stories, service covers | Active | Implemented. | Public release acceptance. |
| AB#313 — Protected-gallery removal audit | Active | Audit and a slice A1 deletion dossier. | Owner clearance per slice; nothing is deleted until then. |
| AB#371 — Cookieless analytics | Active | Opt-in adapter, off everywhere. | The owner enables it, or not. |

## Agent-ready

| Work item | State | Next step |
| --- | --- | --- |
| AB#377 — e2e flake root causes | Active | Open: the WebKit `article-reading-position` locale case (run 1398) and the aborted `goBack` in the inactive private-gallery spec (run 1445, recorded on the item). The section-pointer race has a PR. |
| AB#160 — Vulnerable dependencies | Active | Continuous. Vitest 4.1.12 fixes run 1430's two moderate advisories (PR open). Studio `sprintf-js` (Dependabot #66) has no patched version and is triaged under AB#278. |
| AB#391 — Import metadata and no re-encoding | New | [Import path inventory](audits/ab391-import-path-inventory-2026-10-22.md) done; implementation waits for AB#54's test files to verify the metadata tool. |

## Post-MVP branches

**Client delivery (ADR-0034, 2026-10-16):** the reference deployment uses existing
Sanity and unlisted galleries for client delivery. Protected S3/PostgreSQL work is not
resumed for this owner (AGENTS.md); AB#313 audits removing that inactive code.

| Work item | State | Readiness |
| --- | --- | --- |
| AB#29 — Unlisted client galleries and whole-gallery ZIPs | Active | Follows ADR-0034 and the ADR-0035 ZIP proposal; owner decisions first. |
| AB#145 — Administer unlisted galleries | Active | Same branch; authoring boundaries need their own implementation. |
| AB#130 — Proof selection without S3 | Active | [ADR-0038](adr/0038-proof-selection-in-existing-sanity.md) accepted 2026-10-22; the schema and permanent numbering are merged (#592). **Owner decision needed before the next slice:** how the Studio publish action reaches a server route that creates and encrypts the selection key (a server secret cannot live in the browser Studio). Production activation is a separate owner decision. |
| AB#60 — Enquiry about a public gallery item | Active | Curated-gallery path is built; a dynamic entry point needs the keyword branch. |

**Keyword and commerce discovery:**

| Work item | State | Readiness |
| --- | --- | --- |
| AB#54 — Keyword extraction spike | Active | Owner-run evidence: Lightroom control exports through the real non-production upload path. |
| AB#55 — Keyword taxonomy ADR | Active | [ADR-0039](adr/0039-keyword-taxonomy-and-ingest-boundary.md) Proposed, owner answers recorded; acceptance after AB#54's test files settle its open import questions. |
| AB#56–59, 68–75, 90 — Keyword features | New | Blocked on AB#55. |
| AB#95 — Sales, checkout and fulfilment boundary | Active | Product discovery; no checkout, cart or payment implementation. |

**Other post-MVP items** (AB#25–28, AB#42–49, AB#125–127) are Active or New for
discovery and owner decisions; read each work item before starting.

## Handoff checklist for another machine or agent

- Pull the repository and read this file plus the current `AGENTS.md`. `origin` is the
  GitHub remote (`git@github.com:Alpine78/photosite-starter.git`) and is the only remote
  configured; an earlier revision of this checklist described `origin` as a dead Azure
  DevOps URL and named a separate `github` remote, which is no longer the case.
- Check `git status` before editing; do not overwrite or reset another worker's
  uncommitted changes. Start new work in a linked worktree with
  `npm run task:start -- <branch>` (AGENTS.md, "Branch publication and VS Code worktrees").
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
