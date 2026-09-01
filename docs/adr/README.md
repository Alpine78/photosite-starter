# Architecture decision records

Significant technical decisions are recorded here, one file per decision, so the
reasoning survives the decision. A decision belongs in an ADR when reversing it later
would be expensive — a dependency the UI is built around, a data model boundary, a
hosting or CMS commitment, a product boundary.

Routine choices do not need an ADR. Prefer no record over a record nobody trusts.

For the boundaries these decisions produced, drawn rather than described, see
[`docs/architecture/`](../architecture/README.md). Those diagrams show *what* the
boundaries are; these records are *why*, what else was considered, and what it cost.

## Naming

```
docs/adr/NNNN-short-kebab-title.md
```

`NNNN` is a zero-padded sequence number in decision order (`0001`, `0002`, …). Numbers
are never reused, and a file is never deleted. A record that no longer holds as a whole
gets its status changed to `Superseded` with a link to the ADR that replaced it. When one
scoped clause of a broader, still-accepted record changes, it may instead receive a dated
partial amendment that preserves the old rule, states the evidence and replacement, and
names every affected section. Never silently rewrite accepted history: the history is the
point.

## Format

Use the `/architecture` skill (`.claude/skills/architecture/`, mirrored in
`.agents/skills/`), which defines the full template: Status, Date, Deciders, Context,
Decision, Options Considered, Trade-off Analysis, Consequences, Action Items.

Two conventions on top of the template:

- **Status** is one of `Proposed`, `Accepted`, `Deprecated`, `Superseded`.
- Reference the Azure Boards work item as `AB#<id>` so the decision links back to the
  story that prompted it.

## Index

| ADR | Work item | Decision | Status |
| --- | --- | --- | --- |
| [0001](0001-lightbox-library.md) | AB#13 | Lightbox library: PhotoSwipe over react-photo-view | Accepted |
| [0002](0002-media-identity-and-placement-boundary.md) | AB#64 | Shared media identity and placement metadata boundary | Accepted |
| [0003](0003-public-content-tree-and-url-structure.md) | AB#102 | Public content tree, category taxonomy, and localized URL structure | Accepted |
| [0004](0004-reference-production-host-and-ownership-boundary.md) | AB#109 | Reference production host and ownership boundary | Accepted |
| [0005](0005-public-image-rendition-boundary.md) | AB#108 | Public image rendition boundary | Accepted |
| [0006](0006-sanity-data-access-boundary.md) | AB#39 | Sanity data-access boundary and client transport | Proposed |
| [0007](0007-proxy-request-path-boundary.md) | AB#72 | A Proxy request boundary carrying the requested path | Proposed |
| [0008](0008-localized-authored-text.md) | AB#82 | Localized authored text in content schemas | Accepted |
| [0009](0009-seeded-random-gallery-ordering.md) | AB#66 (ordering clauses only) | Seeded random gallery ordering contract | Accepted |
| [0010](0010-lightbox-preload-window.md) | AB#79 | Bounded adjacent-image lightbox preload window | Accepted |
| [0011](0011-security-response-headers.md) | AB#117 | Security response headers and the CSP inline-content trade-off | Accepted |
| [0012](0012-dynamic-keyword-gallery-query-contract.md) | AB#66 (remainder, after ADR-0009 split off ordering) | Dynamic keyword-gallery query contract | Accepted |
| [0013](0013-category-listing-continuation-cursor.md) | AB#140 | Category-listing continuation cursor contract (keyset over `(publishedAt, contentId)`, shared signing secret, self-canonical indexable pages) | Accepted |
| [0014](0014-private-gallery-security-delivery-retention-boundary.md) | AB#122 | Private client gallery security, delivery, proof selection, and retention boundary (fragment-capability access + server session, structural public/private isolation, S3-compatible object store + PostgreSQL-family private store, worker-authoritative six-month retention) | Proposed |

Expected further entries:

| Work item | Decision |
| --- | --- |
| AB#95 | Image sales, checkout, and fulfilment boundary |
| AB#41 | Customer customization and upstream update boundaries |
| AB#42 | Free Core vs. Premium product boundary |

Add a row here when an ADR lands.
