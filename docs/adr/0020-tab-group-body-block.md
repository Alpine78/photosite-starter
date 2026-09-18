# ADR-0020: Tab-group body block

**Status:** Proposed
**Date:** 2026-09-18
**Deciders:** Project owner (Ilkka Rytkönen)
**Work item:** AB#163

## Context

AB#137's review-mode conversion pass over the real legacy archive found one
construct with no equivalent shared body block: article 370 (fi-FI, "Fujifilm
X-Pro2 -järjestelmäkamera laajassa kokeilussa") carries a Bootstrap 2/3-style
tab widget — a `<ul class="nav-tabs">` of triggers, each `data-toggle="tab"`,
paired with a `<div class="tab-content">` of panes. This was the sole
remaining `behavioural-attribute` refusal class the converter could not
resolve after AB#137's earlier figcaption and `rel`-attribute fixes: the
trigger's `data-toggle` attribute has no equivalent on the new site, so every
occurrence refused conversion.

The real shape is narrow and fully measured against the source: four named
tabs ("Testi 1"–"Testi 4"), each pane holding exactly one data table (a
memory-card burst-write-speed comparison) and nothing else — no images, no
paragraphs, no nested markers. This is the only tab-widget occurrence across
the 102 articles selected for the Production migration.

## Decision

### Shared content and public model

Add `tab-group`, the eleventh shared `ContentBlock` kind (ADR-0003 decision
2). It carries a bounded, ordered list of 2–8 tabs, each with a required
non-blank label (≤80 characters) and exactly one nested table — the same
shape and bounds `table` (AB#22) already has. A tab is deliberately **not** a
generic rich sub-body: only a table, matching the one real legacy shape this
decision exists to migrate, and matching this project's own "don't design for
hypothetical future requirements" rule. Widening a tab to hold the full
shared block set is a credible future extension if real content ever needs
it, not something to build speculatively now.

The Sanity schema (`contentTabGroupBlock`) reuses `contentTableBlock` by name
for each tab's `table` field rather than restating headers/rows/caption a
second time, so the two can never drift and a tab's table gets the existing
rectangularity validator for free. The read-side adapter
(`sanity-content-blocks.ts`) factors the table-field validation into one
`projectTableFields` helper shared by the standalone table block and a tab's
own nested one, for the same reason.

### Accessible interaction and no-JavaScript fallback

The public component follows the WAI-ARIA Tabs authoring-practice pattern:
`tablist`/`tab`/`tabpanel` roles, one active tab at a time, a roving
`tabIndex` (`0` on the active tab, `-1` on the rest), automatic activation on
`ArrowLeft`/`ArrowRight` (wrapping) and `Home`/`End`, and each tabpanel named
by `aria-labelledby` pointing at its own tab. The inactive panel is hidden
with the native `hidden` attribute, which — correctly — removes it from the
accessibility tree entirely, rather than a CSS-only visual hide that would
leave it reachable by assistive technology while invisible.

Without JavaScript, no tab control renders at all: every tab's table renders
stacked, in authored order, each preceded by a plain-text label naming it —
matching `ContentImageComparison`'s own no-controls-without-JS posture
(ADR-0019) rather than a disabled-looking, inert set of buttons. This is the
same hydration-guard mechanism (`useSyncExternalStore` against a
never-notifying store) every other client-hydrated body block already uses.

### Joomla conversion

The converter recognizes the pairing at the sibling level, not on either
element alone: a `<ul class="nav-tabs">` immediately followed (only blank
text may separate the two) by a `<div class="tab-content">` is consumed as
one tab-group block. Recognition is strict rather than permissive — any
deviation from the evidenced shape refuses rather than guesses:

- A trigger must carry exactly `data-toggle="tab"` and `href="#fragment"`,
  nothing else.
- A pane must resolve, through the ordinary conversion path, to *exactly one*
  table and nothing else; a pane's own specific refusal (an unresolved image,
  for instance) surfaces as itself rather than being papered over by a
  generic shape refusal.
- Every trigger fragment must match exactly one pane, and no pane may go
  unreferenced.
- Tab count is bounded to the same 2–8 range the schema enforces.

The one shared sibling-walk this required (`visitSiblings`, replacing the
previous flat `convert`/`convertChildren` loops) is backward compatible by
construction: it changes nothing for a body with no adjacent
`nav-tabs`/`tab-content` pair, verified by the full pre-existing suite passing
unchanged. `convertPaneToSingleTable` mirrors `captureFlatText`'s own
save/restore technique for isolating a sub-walk, extended to also detect an
oversized `{gallery}` marker inside a pane — a state `captureFlatText`'s own
`emittedBlocks` check already guards against for a quote or list item, and
which this method would otherwise silently discard with no finding at all.
The conversion policy advances to `joomla-conversion-v5` (already advanced to
`v4` by AB#137's own figcaption fix in the same story), retiring stale
conversion approvals — this decision changes what the converter accepts, so
an already-reviewed body must be re-reviewed.

Measured against the real 102-article selection: this closes the last 4 of
the archive's original 474 `unsupported-element`/`behavioural-attribute`
refusals the two prior AB#137 fixes had not already closed, converting
article 370's tab widget correctly end to end (verified against the real,
unmodified source, aside from one unrelated, separately-tracked gap: a
`<h6>` nested inside a table's own `<caption>`, which refuses independently
of this decision and predates it).

## Options Considered

| Option | Documentation checked | Outcome |
| --- | --- | --- |
| A tab holding only a table (selected) | The real archive's own markup: every pane, in the only occurrence, holds exactly one table. | Matches the evidenced need exactly; no speculative generality. |
| A tab holding the full shared body-block set | ADR-0003 decision 2's existing six-block set. | Rejected for now: no real content needs it, and it would let a tab group recursively contain another tab group, a mini-gallery, or a second-level rich body with no evidenced use and real added complexity (nested lightbox sequences, nested heading order, …). Left as a credible future widening if real content ever calls for it. |
| Manual tab activation (focus moves, selection does not, until Enter/Space) | [WAI-ARIA Authoring Practices, Tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) documents both automatic and manual activation as valid. | Automatic activation selected: simpler to implement correctly, matches the common expectation for a small, non-costly tab switch (unlike the pattern's own example of tabs that trigger an expensive fetch), and is the more widely deployed default. |
| CSS-only `display:none`/`aria-hidden` for the inactive panel | [MDN: the `hidden` global attribute](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/hidden) documents that a `hidden` element is removed from the accessibility tree. | Native `hidden` selected over a hand-rolled `aria-hidden` + `display:none` pair: one attribute gives the same guarantee with less surface for the two to drift apart. |

Sources checked on 2026-09-18:

- [WAI-ARIA Authoring Practices Guide, Tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/).
- [MDN: `hidden` global attribute](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/hidden).

## Trade-off Analysis

Scoping a tab to one table costs generality: a future legacy article whose
tabs hold something other than a table (an image, a paragraph) will not
convert until this decision is revisited. That cost is accepted because the
evidenced need is exactly this narrow, and widening the model speculatively
would mean designing (and then maintaining, and then migrating) an
unevidenced shape.

The strict, refuse-rather-than-guess recognizer costs some legacy content
that a looser pattern-matcher might have squeezed through — an unrecognized
`rel` value, an extra attribute, a pane holding two tables — but that is the
same trade-off every other refusal in this converter already makes, and the
one this codebase has repeatedly found correct in review: a silent, wrong
guess is worse than a refusal a human resolves once.

## Consequences

- Articles and gallery bodies share one tab-group schema and renderer, the
  same way every other shared body block already does.
- No new dependency, external origin, cookie, credential, or response-policy
  relaxation is introduced — the interaction is native HTML/ARIA and
  `node:crypto`-free.
- A tab's table inherits every existing table-block guarantee (rectangularity,
  bounded columns/rows, scrollable keyboard-reachable region) rather than
  a second, parallel implementation.
- Production import still follows AB#137's owner-reviewed manifest and writer
  flow; shipping converter support alone does not accept or import article
  370.
- The unrelated `<h6>`-in-`<caption>` conversion gap article 370 also exposed
  is closed (2026-09-18, same day, a separate follow-up fix): a table
  caption whose *entire* content is one heading element now flattens to
  plain caption text with a `caption-heading-flattened` lossy note instead
  of refusing on the heading's level — the caption is not part of the body's
  heading outline, so the level carries nothing worth preserving. Scoped
  narrowly, matching this decision's own posture: a heading alongside other
  caption text, or more than one heading, still refuses exactly as before.
- Verifying the fix above against the real, full article — not the isolated
  tab-widget extract this decision's own measurement used — surfaced a
  second, genuinely different, unrelated defect the isolated extract could
  not have shown: parse5 (the same standards-based parser a real browser
  uses) reports **no closing tag at all** for the article's own
  `<div class="tab-content">` — confirmed via its source-location info,
  whose recorded end offset is the exact byte length of the article body,
  i.e. implicitly closed only at end-of-input. The whole remainder of the
  article's content is therefore, per real HTML5 parsing rules, nested
  *inside* the tab-content container, which is why the tab-group recognizer
  correctly refuses it (`tab-group-unsupported-shape`, "holds something
  other than a tab-pane") rather than silently absorbing unrelated content
  into the tab group or guessing where the missing tag belongs. This is a
  genuine defect in the source content itself, not a gap in this decision's
  recognizer, and is not something a converter should paper over by
  inferring a missing tag's position — see Action Items.

## Action Items

- Validate the implementation with unit tests (schema, adapter, converter),
  the production build, lint, and public browser journeys covering both
  content variants, the no-JavaScript stacked fallback with each table region
  reachable by keyboard, the hydrated `tablist`/`tab`/`tabpanel` roles, click
  switching, and arrow-key navigation with wrapping and no focus trap.
- Confirm the decision's acceptance during PR review.
- The `<h6>`-inside-`<table><caption>` conversion gap is closed (see
  Consequences).
- The article's own missing `</div>` for `tab-content` is an **owner
  decision, not a code fix**: either correct the exported source HTML before
  the real migration run (the least ambiguous option, since it fixes the
  defect at its origin), or extend `prepare-selected-source.mts`'s existing
  surgical-normalization precedent (it already corrected 9 other tables and
  removed stray navigation markers) to insert the one missing closing tag —
  a decision to make deliberately, with the corrected body re-approved
  through the same source-digest mechanism every other edit already goes
  through, not something this converter should infer silently.
- Prepare the private resolution and manifest row for article 370 before it
  enters AB#137's launch manifest.
