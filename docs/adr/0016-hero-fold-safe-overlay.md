# ADR-0016: Fold-safe hero overlay — full-bleed native image, viewport-clamped band

**Status:** Accepted
**Date:** 2026-09-04
**Deciders:** Project owner (Ilkka Rytkönen)
**Work item:** AB#148

## Context

The home hero renders the site's lead photograph at `h-auto w-full` — its true native
size, never cropped, per AGENTS.md's hero convention — with the overlaid site name,
tagline, and call to action anchored to the image's own **bottom** edge
(`absolute inset-x-0 bottom-0`). Because the image is full native width, its rendered
height is `viewportWidth / aspectRatio`: a *wider* window makes the image *taller*, not
shorter, so the bottom-anchored overlay is pushed further down the page as the window
widens, independent of the window's height. At 1440×900 with the current 3:2 demo asset
the overlay was already measured pushed roughly half off-screen; a genuinely wide
desktop window makes it worse, not better. The bug is real at ordinary target sizes, not
an edge case.

Two remedies were drawn as wireframes and rejected before this decision, for reasons
worth recording:

- **Cap the image's own height** (e.g. at `72dvh`, contained, centred) so its rendered
  bottom edge — and the overlay anchored to it — can never pass a bounded fraction of the
  viewport. This keeps the overlay on screen at every target size, but the image is then
  narrower than the viewport whenever the cap binds — at 1920×1080 with the demo asset,
  roughly 1166 of 1920px, leaving ~377px of blank page surface on each side. The
  photographer explicitly rejected this: a full-bleed hero with no side margins is the
  point, and "supply a wider image" does not fix it in general, since the cap still binds
  for most real photographic aspect ratios at ordinary monitor ratios.
- **Crop the image to fit within the fold.** Rejected outright: AGENTS.md's "Never crop
  images" and "Hero convention" rules forbid it explicitly, and doing it anyway would need
  a per-photograph focal point the media model does not have — a real, separate
  feature, not a fold fix.

## Decision

**The overlay band, not the photograph, is what's fold-safe.** The photograph keeps
rendering at its full native size, uncapped, exactly as the existing hero convention
already requires — nothing about the image itself changes. What changes is what the
overlay is measured against and where it's anchored:

- **Band height** = `min(the image's own rendered height, the visible viewport height
  below the header)`, expressed as one pure-CSS `min()` expression, computed and
  interpolated server-side from the media's real intrinsic `width`/`height` — no
  client-side measurement, no JavaScript dependency for the guarantee to hold:

  ```
  height: min(
    calc(100vw * <intrinsicHeight> / <intrinsicWidth>),
    calc(100dvh - <HERO_CHROME_RESERVE_PX>px)
  )
  ```

- **Anchored to the TOP of the hero**, not the image's bottom edge. Anchoring to the
  bottom is exactly the mechanism that let the overlay drift off-screen as the window
  widened; anchoring to the top and clamping the band's own height removes width from
  the equation entirely — the band's bottom edge can never pass
  `100dvh - HERO_CHROME_RESERVE_PX` from the header, at any window width.
- The overlay's own content (title, optional tagline, optional CTA) is bottom-aligned
  *within* that band (`flex flex-col justify-end`), so the visual weighting stays close
  to the previous bottom-anchored look, while the guarantee is now structural rather
  than incidental.
- `dvh`, not `vh` (AC6): a mobile browser's collapsing address-bar chrome changes the
  *dynamic* viewport height, and `vh` in most mobile browsers tracks the *largest*
  (chrome-collapsed) viewport, which would let the same fault reappear as the chrome
  expands back after a scroll-to-top.
- The band is **not** clipped with `overflow: hidden`. If the title/tagline/CTA stack
  ever needs more vertical room than the band provides, it simply extends upward past
  the band's own top edge (ordinary `flex-col; justify-content: flex-end` overflow
  behaviour) rather than truncating — still fully over the photograph, just with less of
  it under the scrim's darkest stop. See "What this ADR did not establish" below for why
  this is accepted rather than engineered further.

### `HERO_CHROME_RESERVE_PX`

The band formula needs the chrome height *above* the hero as a number, and the header
(`site-header.tsx`) has no fixed height — it's `py-4` padding around one line of
`text-lg` type, sized by content, not pinned. Three ways to get a usable number were
considered:

1. **Measure the header's real height client-side** (`ResizeObserver` /
   `getBoundingClientRect`) and set a CSS custom property after hydration. Rejected: the
   fold-safety guarantee would then depend on JavaScript running at all — a regression
   from a guarantee that should hold on the very first paint, and out of step with this
   project's general preference for CSS-only guarantees where one is achievable.
2. **Pin the header to an explicit fixed height** (e.g. `h-16`), making it a known
   constant everywhere. Rejected for this story specifically: the header is a shared,
   site-wide component with no complaint against it, and AB#148 is scoped to the hero.
   Changing a shared component's sizing model to serve a hero-only fix is a larger,
   different change than this story asked for.
3. **Reserve a deliberately generous, fixed pixel budget** — chosen — that is not a
   measurement of today's header (~61px, verified against `site-header.tsx`'s actual
   classes: 1px border + 32px vertical padding + one `text-lg` line) but a documented
   upper bound safely above it. `HERO_CHROME_RESERVE_PX = 96` in `src/lib/image-delivery.ts`.

Option 3 keeps the guarantee true even for a clone with a larger type scale or a site
name that wraps to two lines, without touching the header component at all — at the cost
of the band sometimes being a little shorter than the theoretical maximum on today's
site (today's header leaves ~35px more room than the reserve assumes). That slack is the
right direction to be wrong in: reserving *too little* would silently reopen this exact
bug for a taller header; reserving generously only ever costs unused band height.

## Measured evidence

Captured from a real `npx playwright test` run against a **production build**
(`e2e/home-hero-fold-safety.spec.ts`), 2026-09-04 — actual laid-out positions, not
computed estimates:

| Viewport | Image rendered (w×h) | Title box (y, h) | Tagline box (y, h) | CTA box (y, h) | CTA clears fold by |
| --- | --- | --- | --- | --- | --- |
| 1920×1080 | 1920×1280 | 781, 72 | 865, 28 | 925, 48 | 107px |
| 1680×1050 | 1680×1120 | 751, 72 | 835, 28 | 895, 48 | 107px |
| 1440×900 | 1440×960 | 601, 72 | 685, 28 | 745, 48 | 107px |
| 1280×800 | 1280×853 | 501, 72 | 585, 28 | 645, 48 | 107px |

At every target size the CTA — last in the stack, so the first element the fold would
threaten — clears the fold by the same 107px margin (`HERO_CHROME_RESERVE_PX`'s 96px
plus real header slack), confirming the guarantee holds uniformly across the whole width
range rather than only at the sizes it happened to be tuned against. The rendered image
height matches `round(viewportWidth / 1.5)` exactly at every size (1280, 1120, 960, 853),
confirming the photograph itself is genuinely uncapped and running past the fold by
200–305px, reached only by scrolling, never cropped.

`e2e/home-hero-fold-safety.spec.ts` also proves, against the real build: the title alone
on `mobile-webkit`'s own device viewport (iPhone 15); that the band's inline style
specifies `dvh` and never a bare `vh`; and that the rendered `<img>` carries positive
intrinsic dimensions (the no-CLS reservation AC4 asks for).

`src/lib/image-delivery.test.ts` pins `HERO_CHROME_RESERVE_PX` to a positive integer at
least 90 — comfortably above the header's real ~61px — so a future change that shrinks
the budget below the header's real height fails there before it ever reaches a browser.

## Options Considered

### Option A: today's bottom-anchored, uncapped overlay

**Pros:** none — this is the bug. **Cons:** the overlay's screen position is a function
of viewport *width* while the fold is a function of viewport *height*, so nothing
relates the two; the fault gets worse as the window widens. **Rejected**, this is what
AB#148 exists to fix.

### Option B: cap the image itself (bounded viewport-height box, `object-contain`)

**Pros:** keeps the overlay on screen at every target size with the *least* change to
the existing bottom-anchored overlay markup. **Cons:** produces visible page-surface
margins beside the photograph on desktop for most real photographic aspect ratios —
exactly the "full-width banner" look AGENTS.md's hero convention says should come from
the photographer's own wide-format asset, not from the layout. Explicitly rejected by
the site owner (a photographer) in favour of true full-bleed. **Rejected.**

### Option C: crop to fit within the fold

**Pros:** guarantees full-bleed *and* fold-safety simultaneously, and is "what most
photography sites do" per AB#148's own description. **Cons:** directly forbidden by
AGENTS.md's "Never crop images" hard rule; would need a focal-point field the media
model does not have, so a crop would default to a centred crop that can cut off the
photograph's actual subject. **Rejected**, and not a fold-safety decision this ADR can
make on its own — see "What this ADR did not establish."

### Option D (chosen): fold-anchored band, uncapped image

**Pros:** full-bleed on every desktop size (no side margins, ever), the guarantee is a
pure CSS `min()` expression with no client-side measurement and no JavaScript
dependency, and it generalizes to every full-bleed hero on the site — AB#149 (content-page
hero) reuses this exact mechanism rather than inventing a second one, per that story's
own AC8. **Cons:** the photograph is not fully visible without scrolling on any desktop
size with the current demo asset (it runs 200–305px past the fold, per the measured
table above) — accepted, since AGENTS.md's own hero convention already states the
full-bleed look comes from the photographer's asset, not from the layout guaranteeing
the whole frame fits one screen. **Chosen.**

## Trade-off Analysis

**Full-bleed versus "the whole photograph visible on load."** These two goals are in
real tension for a native-ratio, uncapped hero: at ordinary monitor aspect ratios (~16:9
to 16:10), a native 3:2 (or narrower) photograph rendered at full viewport width is
*always* going to be taller than the viewport at some window widths. Option D resolves
the tension by keeping the text guarantee (always on screen) and giving up the "whole
photograph visible" guarantee (accepted, since the hard rule was never "the whole frame
must fit one screen" — only "never crop, never impose an aspect ratio").

**A generous fixed chrome reserve versus an exact but fragile one.** Measuring the
header's real height (client-side) or pinning it (a shared-component change) would both
let the band use a few more pixels of the viewport on today's site. Neither was worth
the cost: JavaScript-dependent fold-safety is a real regression in guarantee strength,
and resizing the header is a different story's decision. A deliberately generous,
documented, tested-lower-bound constant is simpler, keeps the guarantee CSS-only, and
degrades in the safe direction if it's ever wrong.

## Consequences

**Easier**

- The fold-safety guarantee is now a property of the CSS the server renders, provable
  without a browser running any JavaScript, and directly testable with
  `boundingBox()` assertions against real target viewports.
- AB#149 (content-page hero: article and gallery) inherits this mechanism unchanged
  rather than needing its own — one hero mechanism, one place to reason about it.

**Harder**

- `HERO_CHROME_RESERVE_PX` is a manually-maintained upper bound, not a live
  measurement. A future header redesign that grows past ~96px (a much larger type
  scale, a two-line wrapped site name at desktop widths) would need this constant
  raised by hand; nothing currently alerts on that automatically beyond the unit test's
  lower-bound pin, which only catches the constant being *lowered* carelessly, not the
  header growing past it.
- The photograph is not fully visible on load on desktop, which is a genuine, visible
  change from a hero that happened to fit one screen with a shorter-than-average image.

**To revisit — migration triggers**

- **A demonstrated need to keep the whole photograph visible on load** (not merely
  fold-safe text) → this is Option B or C territory, and Option C specifically needs a
  focal-point field on the media model first; revisit only with an explicit product
  decision to trade away full-bleed or to build cropping.
- **The header's real rendered height changes materially** (a redesign, a larger type
  scale, added chrome) → re-verify `HERO_CHROME_RESERVE_PX` against the new height and
  raise it if needed; the unit test's lower bound is a floor, not a ceiling check.
- **AB#149 lands** → extract the band mechanism into a shared component
  (`HeroBand`-shaped) rather than duplicating the `page.tsx` markup a second time; not
  done here since AB#148 has exactly one call site.

## Action Items

1. [x] Add `HERO_CHROME_RESERVE_PX` to `src/lib/image-delivery.ts`.
2. [x] Rework the home hero overlay in `src/app/(default)/page.tsx`: top-anchored,
       viewport-clamped band; bottom-aligned text stack within it; `dvh`, not `vh`.
3. [x] Pin `HERO_CHROME_RESERVE_PX` with a Vitest lower-bound test in
       `src/lib/image-delivery.test.ts`.
4. [x] Add `e2e/home-hero-fold-safety.spec.ts` covering every AC1 target viewport, the
       mobile size, the `dvh` CSS assertion, and the intrinsic-dimension CLS check.
5. [x] Record the measured evidence in this ADR from a real Playwright run.
6. [ ] When AB#149 lands, extract the band into a shared component rather than
       duplicating this markup a second time.

## What this ADR did not establish

- **That the whole photograph is visible without scrolling.** It deliberately is not,
  by design — see Trade-off Analysis. This ADR only establishes that the *overlay text*
  is fold-safe.
- **A real mobile browser's collapsing-chrome transition.** `dvh` is a dynamic unit by
  specification and the CSS assertion in `e2e/home-hero-fold-safety.spec.ts` proves the
  band is built from it, never a bare `vh` — but an automated headless browser has no
  collapsing toolbar to begin with, so no Playwright run can exercise the live
  transition itself. Closing that gap, if it's ever needed, would be a one-time manual
  check on a real device, the same shape as ADR-0001's own outstanding pinch/pan check.
- **Whether an unusually long site name or tagline could push the CTA below the fold.**
  The measured table above used the project's own fixture copy (short site name, one-line
  tagline); the band's overflow behaviour (grows upward past the band's own top rather
  than truncating) was reasoned through but not measured against deliberately long
  content, since AC2 explicitly allows recording this as a possible fallback rather than
  requiring a universal guarantee, and this project's `SiteSettings` copy is realistically
  short (a business name and a one-line tagline, not a paragraph).
- **A crop-based or focal-point-based alternative.** Considered and rejected above as
  out of scope for a fold-safety fix; would be its own product decision and its own ADR.
