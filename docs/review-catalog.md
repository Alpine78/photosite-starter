# Author-rated review-catalog requirements

Refinement worksheet for AB#195 under rough story AB#27 and Feature AB#92.
No new content variant, URL contract, schema or filter interface is approved here.

## Confirmed scope

AB#27 describes a dedicated collection of rated items: each has a name, short
description, cover image, star rating and optional detail page or modal. Readers
can filter the collection by rating. These are the author's item assessments,
not AB#26's reader voting on an article, and not an ordinary article body alone.
Examples may include photographic equipment comparisons or location guides;
no specific brand, category or photographer is built into the model.

## Decision register

| ID | Open decision | What must be established |
| --- | --- | --- |
| K1 | What owns a collection and item identity? | Decide reuse across collections, editorial ordering and the relationship to existing content identity. A new content variant changes ADR-0003's boundary and needs a decision before schema work. |
| K2 | What does a star rating mean? | Decide scale, precision, unrated items and who can revise a rating. Neither five stars nor whole-star precision is implied by the rough story. |
| K3 | What does filtering mean? | Decide exact versus minimum rating, one versus multiple choices, counts and empty states. Define accessible labels and keyboard operation. |
| K4 | How do filtering, sorting and pagination agree? | Decide tie-breaks, page size and whether rating edits invalidate continuation. Existing chronological keysets are not automatically a rating-order cursor. |
| K5 | Does an item need a detail route, modal, both or neither? | Compare stable URLs and tree depth with modal focus/escape/Back behavior. Define a complete no-JavaScript path for any accepted interaction. |
| K6 | What is a filtered URL's public contract? | Decide query names, reserved parameter conflicts, canonical/noindex and shareability. Reuse the current locale and legacy-notice rules rather than silently creating a second policy. |
| K7 | What is localized? | Decide whether ratings, item identities and cover placements are shared while text or collections differ by locale. Define missing-translation behavior. |
| K8 | What media is allowed? | The accepted public-derivative and full-frame rules already apply; they are not reopened. Decide required versus optional covers and their accessible description within that boundary. |
| K9 | What editorial information is needed? | Decide reviewed/revised date, rating explanation and sponsorship/affiliate disclosure requirements with the owner; make no legal or search-engine claims here. |
| K10 | What belongs to taxonomy instead? | Keep shared keywords/filter vocabulary under its existing work items. A rating predicate neither defines nor replaces a keyword taxonomy. |

## Unapproved candidate slices

1. Establish one owner-authored collection and answer K1–K2/K5–K10; accept an
   ADR for any new durable content or URL boundary.
2. After that decision, render one collection's complete item frames and textual
   ratings with the agreed no-JavaScript behavior before adding interaction.
3. Implement the accepted K3/K4 filter and bounded pagination together, with
   stable tie-break, empty-state, locale and keyboard journeys.

No proposal above is prioritized by this worksheet. Existing public media rules
remain in [AGENTS.md](../AGENTS.md); content routing is recorded in
[ADR-0003](adr/0003-public-content-tree-and-url-structure.md).
