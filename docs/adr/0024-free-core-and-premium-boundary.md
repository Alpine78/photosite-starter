# ADR-0024: Free Core and Premium product boundary

**Status:** Proposed
**Date:** 2026-09-27
**Work item:** AB#42

## Context

The repository is already published under MIT. Its application, schemas, tests, and documentation form a working, clonable photography site. A later commercial offer must not imply that published MIT code can be recalled, or reduce the Free Core to a nonfunctional trial. AB#45 is still gathering evidence about what photographers would pay for; this record defines a proposed boundary, not a validated price or demand.

## Decision

Keep this repository's current and future generic site functionality as a complete MIT-licensed Free Core: public pages, content and gallery rendering, accessible navigation, the existing authoring contracts, build/test tooling, and deployable source. Do not add runtime license checks, site-count limits, locked features, or required calls to a vendor service.

A possible paid offer may contain separately authored themes or design assets, guided setup and migration, deployment/handoff work, and an optional maintenance service. Ship paid source or assets through a separately licensed repository or delivery artifact with its own terms and inventory. A paid theme may consume documented Free Core design tokens; Free Core must continue to work with its included preset. Paid services change who performs work, not what the customer is allowed to run from this MIT repository.

Each customer owns its site repository, CMS content, domain, host account, and provider accounts. Any site-count, modification, redistribution, updates, support, refund, or exit terms for a paid artifact require explicit written terms before sale. This ADR grants none by implication. A customer who stops buying a service retains its MIT Free Core and customer-owned data; continued use of separately licensed assets follows their actual license.

External contributions to this repository remain under its published license. Do not copy proprietary customer code, paid assets, or third-party assets into Free Core without rights to redistribute them. Changing the license of future contributions or combining a proprietary deliverable with existing MIT code requires a separate legal and owner decision; existing MIT grants remain available.

## Options Considered

1. **Complete MIT core plus separate paid artifacts/services (proposed):** preserves the current promise and makes the paid scope explicit.
2. **Feature-locked core:** could create an upgrade lever, but conflicts with the complete-clone promise and adds license enforcement.
3. **Convert the whole repository to proprietary:** cannot withdraw already distributed MIT versions and would change the project's public boundary.

## Trade-off Analysis

The proposed split has simple runtime behavior and a clear exit path. Commercial differentiation relies on design quality, implementation help, and maintenance, which AB#45 must validate. Separate paid artifacts require their own licensing, version compatibility, asset provenance, and distribution process. No price or demand claim follows from this technical boundary.

## Consequences

- Free Core continues to receive security and correctness fixes without a purchase gate.
- A premium theme cannot be required for a deployable or accessible site.
- Paid artifact terms must identify source access, modification, number of deployments, updates, refund handling, and end-of-service use before the first sale.
- The first paid offering should be tested against the AB#45 interview evidence and revised if customers value a different boundary.

## Action Items

1. Owner accepts or revises the product boundary after AB#45 evidence.
2. Draft actual paid-artifact and service terms with appropriate review before offering them.
3. Keep release/update promises consistent with AB#41 and AB#46.
4. Audit assets and notices for each separately distributed artifact (AB#43).
