# Gallery presentation (AB#157)

Audience: whoever authors a deployment's gallery presentation defaults in
Sanity, restyles a clone's gallery grid, or debugs why a photograph moved on a
continuation. Update this file when the placement rule, a responsive
threshold, the caption-access mechanism, or the inheritance model changes —
see the Documentation table in `AGENTS.md`.

## What is authored, and where

Three independent, optional fields:

- **Layout** — `grid`, `masonry`, or `justified` (the default).
- **Caption placement** — `below` (the default) or `overlay`.
- **Continuation** (AB#374) — `endless` (the default), `automatic-then-button`,
  or `button`. See "Loading more images" below.

All three are authored site-wide on `SiteSettings` and may be overridden per
gallery. Clearing a gallery's override restores inheritance for that field
alone — the fields never travel together. An absent site-wide value falls
back to `justified` / `below`. All six combinations are offered; nothing about the
resolution is layout-specific, so a future seventh layout only has to extend
`GALLERY_LAYOUTS`.

`src/lib/gallery-presentation.ts` is the one resolution seam:
`effectiveGalleryPresentation(gallery, settings)` composes the two
`GalleryPresentationFields` (`gallery.galleryLayout ?? settings.galleryLayout
?? "justified"`, and the same shape for caption placement) so the mock fixture
layer and the Sanity adapters read one identical rule. An unknown stored
value is rejected as malformed content at the adapter boundary
(`readGalleryPresentationFields`'s `reject` callback), never silently
downgraded to a default or passed through as an unrecognized CSS class —
that would hide a real authoring mistake or a schema/runtime drift as if the
gallery had simply been left unstyled.

AB#321 / AB#322 supersede AB#157's original grid fallback: absent settings now
use justified rows. Explicit stored grid or masonry choices remain authoritative;
this source change does not rewrite production settings or gallery overrides.
Article-end galleries inherit both site settings on their first page and direct
continuation, with the same resolved presentation retained during an append.
They have no per-article presentation field.

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
`100vw`, unconditionally, no viewport-breakpoint branches at
all (AB#373 widened it from `calc(100vw - 32px)` when article galleries began
running edge to edge on phones).

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

**Curated pages on wide screens (AB#385, owner decision 2026-10-21).** A
Production measurement showed what that trade cost: at 1280 px every
masonry/justified thumbnail of about 360 px requested the 1536 px candidate
(2048 px at 2x), 3.4–5.6 MB per 24-image page. Curated gallery pages and the
home portfolio sit in the full-width page column, so two bounds hold there up
to 200% text without assuming a column count from `sizes`:

- **Masonry** declares `50vw` from 1280 px (`curatedGalleryMasonry`). At a 32px
  root the page's `sm:px-6` padding doubles to 96px and a second column needs a
  34rem container, so two columns are guaranteed from about 1200 px; 1280 px
  keeps a margin for the scrollbar.
- **Justified** declares each image's own bound from 512 px × its ratio
  (`curatedJustifiedImageSizes`): a row is at most 16rem high (singleton and
  open rows 12rem), which is 512 px at a 32px root, so the image can never be
  wider. Below that viewport width the image cannot exceed the viewport, so
  `100vw` remains, and a panorama whose bound reaches the viewport keeps it.

Article-end galleries keep `100vw`: their narrow column can stay single-column
on a desktop at enlarged text, and their single-column images use an `80svh`
height cap instead of the row caps. The enlarged-root e2e matrix now measures
every first-page image, and a desktop default-size check pins the saving. Beyond
200% text a curated masonry thumbnail can be softer than before; WCAG 1.4.4's
200% is the stated bound.

## Inline mini-galleries (AB#334)

Article body mini-galleries inherit the site's resolved layout. Gallery body
mini-galleries use the gallery's resolved layout, including an explicit per-page
override. These are the existing presentation fields; an article need not have an
end gallery to inherit its site's layout. `justified` uses the shared native-ratio
row compositor. `grid` and, deliberately, `masonry` retain the existing inline
one/two-column grid. Curated masonry remains unchanged.

These small sets always render whole, in authored order, with their own viewer.
Their complete captions and credits stay below, without the curated caption clamp,
overlay or popover. Long words wrap. Small native renditions get a separate row
before grouping; a multi-image row that cannot reserve 3rem per picture at its
band's narrow edge becomes ordered single-image rows. A singleton's caption can
use the whole row even when its photograph is very narrow. The fitting policy is
bounded to a root font of 32px; CSS native-size caps still prevent upscaling above
that bound. Tiny source photographs can remain tiny viewer targets.

Justified inline sets share the `100vw` source-size bound and preserve
SSR geometry through hydration and image loading: each occurrence retains its source
aspect ratio even if an optimized tiny image has integer-rounded dimensions. The
old mini-gallery source-size profiles remain for the grid fallback. No layout changes the 12-image maximum, placement identity,
viewer isolation, media contract, CMS content, or URL. See ADR-0003's dated AB#334
amendment for the exact replacement of the historical AB#24 grid clause.

## Phone single column (AB#373)

Below the first justified band (34rem of container), each image in an article's
mini galleries and end gallery (and in a gallery body's mini galleries) is its own
row. It fills the column at its native ratio instead of the former 12rem tail
height; curated gallery pages keep the tail height. The end gallery reads the
extra `--j-single-full-width` property inside a container query, so the curated
placement itself is unchanged;
only a tall portrait is bounded, so its height never exceeds 80svh
(`JUSTIFIED_SINGLE_MAX_HEIGHT_SVH`). Inline sets stay capped at their rendition
width, so nothing is upscaled. Below 40rem of viewport, an article's mini
galleries and end gallery run edge to edge (square corners, captions keep the
page gutter), and the narrow `sizes` fallback is the whole viewport. Nothing is
cropped. In landscape, the existing bands already compose an equal-height row
(for example three photographs in a 54rem phone viewport). Masonry keeps its own
column thresholds, so a landscape phone below 56rem of container shows two
masonry columns.

## Loading more images (AB#374)

A gallery longer than one bounded page (24 items) continues in one of three
authored modes. Every mode keeps the server-rendered `?cursor=` continuation
link of ADR-0003 decision 8, so visitors without JavaScript, crawlers and a
failed script still reach every page.

- **`endless`** (the default when nothing is authored): once hydrated, the link
  is hidden and the next page is appended whenever a sentinel after the list is
  within one viewport below the visible area or has already been scrolled past.
  Loading continues page by page until the gallery is complete, however long it
  is. The footer and anything after the gallery are reached once every image has
  loaded; landmark navigation reaches them at any time.
- **`automatic-then-button`**: the same until
  `AUTOMATIC_CONTINUATION_PAGE_LIMIT` (3) pages, 72 images at the current page
  size, are shown; then the link appears as the familiar control and automatic
  loading does not resume.
- **`button`**: the pre-AB#374 behaviour, unchanged.

Automatic loading requests one page at a time through the grid's existing
single-flight loader and never moves focus. The polite status line announces
loading. A failure stops automatic loading at once and reveals the link as a
retry; a successful retry hands control back to scrolling. The address bar is
not updated, as before. Article end galleries inherit the site value and have no
per-article field. The mock content layer authors `button` site-wide so the
existing continuation journeys keep testing the control;
`content-endless-archive` and `content-automatic-archive` override it per gallery.

## Out of scope

Presentation never changes a gallery's canonical result, cursor scope,
section filter, or lightbox ordering — see the seam boundary above. Content
placement, membership, and every other gallery contract (sections, seeded
ordering, continuation cursors) are unaffected by any of the three layouts or
two caption placements.

### AB#234 — response transport integrity

Gallery continuation requests stay on their application endpoint with manual redirects; browser opaque redirect responses fail the existing HTTP-success check. Successful JSON must be valid UTF-8 before item/slide identity and metadata validation. Parser and body-read failures expose only a fixed unusable-slice message. Valid Unicode, literal U+FFFD and a response BOM remain supported; layout, image dimensions, full-frame rendering and cursor semantics are unchanged.
