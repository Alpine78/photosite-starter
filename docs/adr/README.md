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

Expected further entries:

| Work item | Decision |
| --- | --- |
| AB#41 | Customer customization and upstream update boundaries |
| AB#42 | Free Core vs. Premium product boundary |

Add a row here when an ADR lands.
