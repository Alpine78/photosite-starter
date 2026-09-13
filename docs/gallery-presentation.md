# Gallery presentation (AB#157)

Audience: whoever authors a deployment's gallery presentation defaults in
Sanity, restyles a clone's gallery grid, or debugs why a photograph moved on a
continuation. Update this file when the placement rule, a responsive
threshold, the caption-access mechanism, or the inheritance model changes —
see the Documentation table in `AGENTS.md`.

## What is authored, and where

Two independent, optional fields:

- **Layout** — `grid` (the default), `masonry`, or `justified`.
- **Caption placement** — `below` (the default) or `overlay`.

Both are authored site-wide on `SiteSettings` and may be overridden per
gallery. Clearing a gallery's override restores inheritance for that field
alone — the two fields never travel together. An absent site-wide value falls
back to `grid` / `below`. All six combinations are offered; nothing about the
resolution is layout-specific, so a future seventh layout only has to extend
`GALLERY_LAYOUTS`.

`src/lib/gallery-presentation.ts` is the one resolution seam:
`effectiveGalleryPresentation(gallery, settings)` composes the two
`GalleryPresentationFields` (`gallery.galleryLayout ?? settings.galleryLayout
?? "grid"`, and the same shape for caption placement) so the mock fixture
layer and the Sanity adapters read one identical rule. An unknown stored
value is rejected as malformed content at the adapter boundary
(`readGalleryPresentationFields`'s `reject` callback), never silently
downgraded to a default or passed through as an unrecognized CSS class —
that would hide a real authoring mistake or a schema/runtime drift as if the
gallery had simply been left unstyled.

Presentation is **purely a rendering choice** over an existing, unchanged
result: it never enters the curated result set, a cursor's scope, a section
filter, or the lightbox's ordering rule. A gallery's items, order, and
pagination are identical across all six presentations; only how they are
laid out and captioned differs.

## The one order every layout keeps

`src/components/gallery-grid.tsx` dispatches on the resolved layout to one of
three renderers, and all three keep DOM order, keyboard tab order, and the
lightbox's slide order identical to the result order:

- **`grid`** (`GalleryGrid`'s own inline list) and **`justified`**
  (`GalleryJustifiedList`) read left-to-right, top row to bottom row — the
  same row-major order the grid has always used.
- **`masonry`** (`GalleryMasonryList`) has no uniform rows, so "row-major"
  does not by itself define an order in it. Its progression rule, precisely:
  *items read by top edge, top to bottom; items whose top edges are within
  one CSS pixel of each other read left to right.* `src/lib/gallery-masonry.ts`
  places every item to satisfy exactly this rule, never a column-at-a-time
  reading — the CSS multi-column masonry a much earlier version of this grid
  used was removed for exactly the opposite reason (its top row reads as
  items one, three, five instead of one, two, three), and this rule is what a
  reintroduced masonry had to satisfy to be acceptable at all.

## Placing masonry with no viewport measurement

The server renders the first slice without knowing the browser's width. It
does not need to: every length in a masonry item's top edge is either a
multiple of the column width (an image's own height, `columnWidth / ratio`)
or a multiple of `rem` (the gap, and a reserved caption box) — so a top edge
is `a·columnWidth + b·rem`, and dividing by `columnWidth` gives `a + ρ·b` with
`ρ = rem / columnWidth`, which is **linear in ρ**. Each column count
(`MASONRY_BANDS`) only ever renders inside one closed `rem` interval of
container width, which bounds ρ to a closed interval too — and a linear
inequality that holds at both ends of an interval holds everywhere inside it,
so `placeMasonry` proves the progression rule by checking only the two
interval endpoints, for any root font size a visitor has set.

Plain shortest-column placement satisfies the rule at one exact width, not
across a whole interval, and simply refusing a column that would break the
rule is worse: a refused column's bottom stops growing while later top edges
keep rising, so it can never be chosen again and the masonry collapses into
fewer columns over a long enough sequence. Instead, a candidate column's
start is raised to the smallest *linear* position at or above both its own
bottom and the rule's floor at both interval ends — the chord through their
pointwise maximum, which lies above that maximum everywhere between — so
every column stays available for the rest of the sequence, at the cost of a
little whitespace where the band's width range left a column's relative
height ambiguous. `src/lib/gallery-masonry.test.ts` proves the rule
numerically at sampled points across each band's interval, including a
sequence that would strand a column under plain refusal, and checks packing
density stays within a few percent of unconstrained shortest-column
placement.

## Continuation stability

At an **unchanged viewport width**, appending a slice never moves a
photograph already on screen:

- **`grid`** and **`masonry`** keep every already-placed item at its exact
  position and size. Placement only ever depends on the items before it
  (`placeMasonry` is prefix-stable, and both layout engines resume their
  prior placement rather than recomputing the whole list from scratch on an
  append), so appending cannot move anything placed earlier.
- **`justified`** (`groupJustifiedRows`) may re-flow only its **last,
  still-open row** — a row already closed never reopens, by the same
  prefix-stability argument, but the open tail can still acquire more
  photographs and change shape until it closes.

When the **viewport width or column count changes**, photographs may change
place — column and row assignment is not locked across screen sizes, only
within one. `e2e/gallery-layouts.spec.ts` measures this directly: it records
every item's laid-out box before and after image loading/hydration, before
and after an append at four fixed widths, and asserts unmoved items stay
within 0.1–0.5px (float rounding), while an open lightbox's current slide and
the focus-return-by-identity contract survive a continuation underneath it.

## Captions

Every layout supports a caption below the image or overlaid on it, with one
exception: an image too low (wider than `GALLERY_CAPTION_OVERLAY_MAX_RATIO`,
4:1 — a very wide panorama) cannot hold two readable lines over itself, so
its caption always renders below regardless of the authored placement.
`resolvesToBelowCaption` (`src/lib/gallery-presentation.ts`) is the one
predicate both `GalleryFigure` (which decides where to render the caption)
and `GalleryMasonryList` (which decides how much vertical space
`placeMasonry` must reserve for it) call, so the two decisions cannot drift
apart.

A resting caption is clamped to two lines. The full text is never dropped:
every `GalleryFigure` with a caption carries a same-origin, scriptless,
dismissible native `popover` (`gallery-figure.tsx`'s `captionPopoverId`) that
opens on activating the image trigger — Enter/Space, a tap, or a click — and
shows the complete, untruncated caption, reachable with JavaScript disabled.
`e2e/gallery-layouts.spec.ts`'s "full captions without script" case proves
this at an enlarged (32px root) text size specifically, including the low
panorama that always renders `below`.

Overlay captions are a documented photographic exception to the semantic
token contract (`docs/theme-contract.md`'s "Four surfaces" table): white text
on 72%-opacity black, measured at ~9.2:1 against a blown-white photograph —
comfortably above WCAG AA. That figure lives once in `theme-contract.md`;
`gallery-figure.css`'s own comment points there rather than restating a
second, independently-rounded number.

## Responsive images per layout

`grid` keeps its existing three-equal-column `sizes` profile
(`imageRenderProfiles.galleryGrid`). `masonry` and `justified` share one
different profile (`boundedRemContainerSizes`, used by both
`imageRenderProfiles.galleryMasonry` and `.galleryJustified`):
`calc(100vw - 32px)`, unconditionally, no viewport-breakpoint branches at
all.

That looks like it gives up the per-column sizing the grid profile has, and
it does, deliberately. A `sizes` media condition's length — `px` or `rem`
alike — is resolved against the browser's *default* root font-size, never a
page's own CSS-overridden one, so nothing written into `sizes` can see a
visitor's enlarged text the way `MASONRY_BANDS`'/`JUSTIFIED_BANDS`' real,
rem-based container queries do. A per-column-count branch was tried,
measured wrong in a real browser — a masonry thumbnail came back visibly
soft at a 32px root (200% zoom, WCAG's own bound) — and revised once more
after a second, more careful measurement caught the revision *also* wrong at
the exact viewport its own "two columns is now safe" branch was meant to
start at (container-query boundaries carry sub-pixel/scrollbar slop a hand
computation does not). The bound that actually holds, proven across a
viewport × root-font-size matrix in both engines
(`e2e/gallery-layouts.spec.ts`), is simpler than either attempt: assume the
layout could always have collapsed to one full-width column. A column is
never wider than its container, so this is always a safe upper bound,
whatever the real column count turns out to be — at the cost of requesting a
wider image than a default-zoom column strictly needs. That is the
deliberate trade: AGENTS.md ranks image quality above bandwidth, and a
masonry or justified thumbnail is a moderate download at any of these
widths.

## Out of scope

Presentation never changes a gallery's canonical result, cursor scope,
section filter, or lightbox ordering — see the seam boundary above. Content
placement, membership, and every other gallery contract (sections, seeded
ordering, continuation cursors) are unaffected by any of the three layouts or
two caption placements.
