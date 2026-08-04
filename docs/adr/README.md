# Architecture decision records

Significant technical decisions are recorded here, one file per decision, so the
reasoning survives the decision. A decision belongs in an ADR when reversing it later
would be expensive — a dependency the UI is built around, a data model boundary, a
hosting or CMS commitment, a product boundary.

Routine choices do not need an ADR. Prefer no record over a record nobody trusts.

## Naming

```
docs/adr/NNNN-short-kebab-title.md
```

`NNNN` is a zero-padded sequence number in decision order (`0001`, `0002`, …). Numbers
are never reused, and a file is never deleted: a decision that no longer holds gets its
status changed to `Superseded` with a link to the ADR that replaced it. The history is
the point.

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
| [0005](0005-public-image-rendition-boundary.md) | AB#108 | Public image rendition boundary | Proposed |

Expected further entries:

| Work item | Decision |
| --- | --- |
| AB#66 | Curated and dynamic gallery query contract |
| AB#95 | Image sales, checkout, and fulfilment boundary |
| AB#122 | Private gallery security, delivery, and retention boundary |
| AB#41 | Customer customization and upstream update boundaries |
| AB#42 | Free Core vs. Premium product boundary |

Add a row here when an ADR lands.
