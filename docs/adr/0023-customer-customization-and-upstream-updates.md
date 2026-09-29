# ADR-0023: Customer customization and upstream updates

**Status:** Proposed
**Date:** 2026-09-27
**Work item:** AB#41

## Context

PhotoSite Starter is a clonable, single-customer codebase. A customer must own the running site and be able to change it, while the maintained starter can still receive fixes. The existing contracts already separate site settings and CMS content from application code, and ADR-0004 places hosting accounts with the customer. A promise of automatic updates would be misleading once a customer edits shared application code.

## Decision

Define five change layers, in order of increasing merge responsibility:

| Layer | Owner and change path | Upstream update effect |
| --- | --- | --- |
| Shared core: routes, adapters, components, tests, deployment contract | Starter maintainer; customer may fork | Merge and test upstream changes; local edits here are customer-maintained patches |
| Theme preset: documented design tokens and reusable styling | Starter supplies examples; customer selects/edits in its fork | Upstream may add tokens; customer checks its preset against the theme contract |
| Site configuration: deployment settings and site settings | Customer | Preserve customer values; review newly required fields |
| CMS content and media | Customer, in customer-owned resources | Never replaced by a repository update |
| Provider configuration and credentials | Customer, in its own accounts | Reconcile documented changes manually; never copy credentials from upstream |

An exceptional customer-specific code change stays in the customer's fork, with a short record of purpose, affected paths, and upstream files it touches. It is not silently promoted into the generic starter. A generally useful change can be proposed upstream separately, without customer data or branding.

Upstream delivery is a versioned source change, not remote mutation of a customer's site. A customer chooses when to merge a release, reviews migrations and configuration changes, runs the repository checks, then deploys through its own pipeline. A conflicting core edit is resolved in the customer fork; the maintainer can advise through an agreed service but does not own the customer's repository.

For a handoff or exit, the customer receives its source fork, documented deployment configuration, account ownership, CMS export route, and a list of customer-specific patches. The customer can keep running the last deployed version or move to another maintainer. Rollback uses the customer's deployment history and data backup procedure, not a reversal of CMS content by Git.

## Options Considered

1. **Repository fork with documented layers (proposed):** clear source ownership and ordinary Git merges.
2. **Generated site with automatic upstream overwrite:** simpler initial distribution, but risks overwriting customer code and requires a privileged update channel.
3. **Separate core package with extension API:** could reduce merge conflicts, but creates an API and release burden before repeated customer evidence warrants it.

## Trade-off Analysis

The fork preserves full customer control and the project's minimal-dependency rule. Updates require human review, and core customization can produce merge conflicts. That cost must be disclosed in the service offer rather than hidden behind an unsupported compatibility promise. A future package split needs evidence from actual repeated forks and its own decision.

Example: a customer changes the shared header component while upstream adds an accessibility fix to that component. The customer merges the release, resolves that file manually, runs accessibility and build checks, and deploys. Customer-owned CMS text and credentials are outside that merge.

## Consequences

- A template release cannot claim every customized clone is automatically compatible.
- New configuration requirements need migration notes and safe defaults where possible.
- Customer-specific branding, licensed assets, and private data stay outside the generic repository.
- This record sets the source/update boundary; it does not establish a support SLA or a commercial license.

## Action Items

1. Have the owner accept or revise the layer and update responsibility.
2. Align the release policy (AB#46) and support specification (AB#47) with this boundary.
3. For the first customer handoff, record actual fork-specific patches and perform one upstream update rehearsal.
