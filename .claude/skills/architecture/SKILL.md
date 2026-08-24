---
name: architecture
description: Create or evaluate PhotoSite Starter architecture decision records (ADRs). Use for hard-to-reverse dependency, data-model, hosting, CMS, security-boundary, URL-contract, or product-boundary decisions; do not use for routine implementation choices.
---

# PhotoSite Starter architecture decisions

Create or review an ADR that preserves the evidence, alternatives, and consequences behind
a hard-to-reverse project decision. Keep the decision generic enough for a photographer to
clone and rebrand the repository.

## Establish authority and context

- If the request names an Azure Boards item, follow the work-item gate in `AGENTS.md`
  before drafting or reviewing anything. The item supplies the authoritative scope and
  acceptance criteria.
- Read `docs/adr/README.md`, the relevant existing ADRs, and the affected code or
  configuration. Repository prose is supporting evidence, not a substitute for current
  implementation or the work item.
- Read the relevant D2 sources in `docs/architecture/` when the decision affects a system
  boundary, layer, external dependency, or deployment flow.
- Verify version-sensitive framework or provider claims against current official
  documentation. Separate verified facts, explicit assumptions, and recommendations.

## Decide whether an ADR belongs

Write an ADR when reversing the choice later would be expensive, such as a dependency the
UI is built around, a public URL or data contract, a security or privacy boundary, a
hosting or CMS commitment, or a product boundary. Do not create one for routine code
organization, an easily reversible implementation detail, or a choice already governed by
an accepted ADR.

If the request does not meet that threshold, explain briefly and recommend ordinary code
or documentation instead.

## Create or amend a record

1. Select the next unused zero-padded number from `docs/adr/`; never reuse or renumber an
   existing record. Name the file `NNNN-short-kebab-title.md`.
2. Use the repository structure below. Include only credible alternatives; do not pad the
   record with artificial options.
3. Default a genuinely new proposal to `Proposed`. Use another status only when the user,
   work item, or existing project authority establishes it. Do not invent deciders.
4. Link the governing item as `AB#<id>` when one exists.
5. Update the index in `docs/adr/README.md` in the same change.
6. If a boundary or deployment flow changes, edit the authoritative `.d2` source and run
   `npm run diagrams`; never edit a generated SVG directly.

```markdown
# ADR-NNNN: Title

**Status:** Proposed | Accepted | Deprecated | Superseded
**Date:** YYYY-MM-DD
**Deciders:** Established decision owner(s)
**Work item:** AB#<id>

## Context

## Decision

## Options Considered

## Trade-off Analysis

## Consequences

## Action Items
```

Add measured evidence, migration triggers, limitations, or unresolved questions when they
materially support the decision. State what the ADR does not establish when that prevents a
later reader from treating a bounded conclusion as a broader fact.

An accepted record is history. Never silently rewrite it to describe a newer decision:

- supersede it with a new ADR when the decision no longer holds as a whole; or
- add a dated, scoped amendment when one clause changes and the broader record remains
  valid.

Preserve the old rule, the evidence for changing it, the replacement, and the affected
sections.

## Evaluate a proposal or existing ADR

Check the proposal against the governing work item, project hard rules, accepted ADRs,
code, tests, and diagrams. Report concrete conflicts or missing evidence first, ordered by
impact, with file and section references. Distinguish:

- a decision defect that must be resolved before acceptance;
- an implementation gap that belongs in action items; and
- a documented trade-off or limitation that is acceptable but should remain visible.

Do not approve or reject an Azure Boards-scoped decision without reading the item. Do not
treat an unimplemented diagram element or roadmap statement as deployed fact.

## Provenance

Adapted for PhotoSite Starter on 2026-08-24 from Anthropic's Apache-2.0-licensed
`architecture` skill. See `NOTICE` and `licenses/Apache-2.0.txt`.
