# ADR-0001: Lightbox library for portfolio galleries

**Status:** Accepted
**Date:** 2026-07-27
**Deciders:** Project owner (Ilkka Rytkönen)
**Work item:** AB#13

## Context

The portfolio thumbnail grid has landed. The next gallery slice is a fullscreen
lightbox, and the library behind it is hard to reverse: it dictates the markup the grid
emits, the keyboard model, and the extension point any future video slide has to use.

Five project rules constrain the choice more than features do:

- **Images are never cropped.** The lightbox must fit the whole frame at its native
  ratio, at any aspect ratio.
- **WCAG 2.1 AA**, with keyboard navigation called out explicitly for galleries.
- **Privacy by default** — no third-party requests, no cookies.
- **Minimal dependencies.** Before this decision the project has zero runtime
  dependencies beyond Next.js and React.
- **The media model must not assume photo-only content.** Video is on the roadmap; the
  lightbox must have a path to it that does not require replacing the library.

This was a time-boxed spike (AB#13, 1 day). Both candidates were built as working
prototypes in the App Router against the same mock gallery — six frames covering 3:2,
2:3 and 1:1 — so every number below comes from this codebase rather than from
documentation or recollection.

**Measurement environment:** Next.js 16.2.11 (Turbopack), React 19.2.1, TypeScript
strict, Chromium via Playwright 1.60. Prototypes on branch `chore/13-lightbox-spike`;
they are not merged.

## Decision

**Adopt PhotoSwipe 5 (MIT) as the lightbox for the portfolio gallery**, integrated
behind a project-owned client component so the grid never references the library
directly.

The deciding factor is accessibility, not features: PhotoSwipe ships focus management
that react-photo-view does not have, and the project targets WCAG 2.1 AA. The
one-click zoom that the owner preferred in hands-on comparison reinforces the same
choice but did not decide it.

## Options Considered

### Option A: PhotoSwipe 5.4.4 (MIT)

| Dimension | Assessment |
| --- | --- |
| Integration complexity | Medium — vanilla JS, needs a project-owned client wrapper; ~120 lines including the custom caption |
| Runtime cost | 11.9 KB gzip on route load, +16.8 KB gzip deferred until the lightbox opens |
| Accessibility | High — focus trap, focus return, and six distinct ARIA attributes emitted, all built in |
| Extensibility (video) | Medium — imperative: `data-pswp-type` + `itemData` filter + `contentLoad` event |
| Maintenance risk | Medium — mature and dependency-free, but last release 2024-05-24 |

**Pros:**
- `trapFocus` and `returnFocus` are library options, not code we maintain.
- One-click zoom is a supported option (`imageClickAction: "zoom"`), not a workaround.
- MIT — the lightest attribution obligation.
- The core is a dynamic import, so visitors who never open a photo never download it.
- Modern package with an `exports` map and shipped types.

**Cons:**
- No built-in caption; ours is a custom UI element registered via `uiRegister`.
- Vanilla JS in a React codebase — lifecycle is ours to get right.
- Heavier in total (28.8 KB gzip) once a visitor actually opens the lightbox.
- The video path is imperative, and the official docs warn that iframe content cannot
  be swiped over. The companion `photoswipe-video-plugin` (ISC) was last published
  2022-07-11 and is staler than the core.

### Option B: react-photo-view 1.2.7 (Apache-2.0)

| Dimension | Assessment |
| --- | --- |
| Integration complexity | Low — native React provider and trigger components |
| Runtime cost | 14.2 KB gzip on route load, nothing deferred |
| Accessibility | Low — `role="dialog"` with no focus management and no `aria-*` attributes |
| Extensibility (video) | High — typed `render` prop returning an arbitrary React node per slide |
| Maintenance risk | Medium-high — no `exports` map, and types written against the pre-React-19 global `JSX` namespace |

**Pros:**
- Cleanest integration of the three; the caption slot (`overlayRender`) receives `scale`,
  which makes hiding the caption while zoomed a one-line condition.
- Lightest in total bytes for a visitor who opens the lightbox.
- The best video extension point of the candidates: a typed React render prop, no plugin.
- Owner observed noticeably faster image paint when browsing quickly.

**Cons:**
- **Focus never enters the dialog.** Measured: on open, `document.activeElement` remains
  the trigger button outside the overlay; Tab walks into the page behind it. A
  `role="dialog"` without focus management is a documented anti-pattern, and closing this
  gap by hand is exactly the work a library was supposed to remove.
- Zero `aria-*` attributes anywhere inside the overlay.
- Zoom requires a double-click; the owner found this clumsier than one-click.
- Apache-2.0 obliges a `NOTICE` entry and a bundled license text.
- The shipped `.d.ts` uses the global `JSX.Element`, which `@types/react` 19 no longer
  declares. It compiles here only because `skipLibCheck` is `true` — a latent signal
  about the maintenance horizon, not a current failure.

### Option C: No library — custom lightbox

| Dimension | Assessment |
| --- | --- |
| Integration complexity | High — focus trap, scroll lock, gestures, zoom and preloading are all ours |
| Runtime cost | Lowest, and fully under our control |
| Accessibility | Whatever we build, verified by us |
| Extensibility (video) | Total freedom |
| Maintenance risk | All of it is ours, permanently |

**Pros:** preserves the zero-runtime-dependency position; no licensing obligation;
nothing to swap later.

**Cons:** rebuilds solved problems. The project conventions name a lightbox as the
example of a library that is acceptable when justified, and the two hardest parts —
gesture handling and focus management — are precisely what the candidates already solve.

**Rejected**, but recorded because it was genuinely considered: had both candidates
failed the no-crop or privacy rules, this was the fallback.

## Trade-off Analysis

**What did not separate the candidates.** Both passed every blocking rule. Worst
aspect-ratio deviation across all six frames was 0.06% (PhotoSwipe) and 0% (react-photo-view)
at 1280×800 and 390×844, with every image fitting inside the viewport — neither crops.
Neither made a single third-party request, and neither bundle contains `fetch`,
`XMLHttpRequest`, `document.cookie` or `localStorage`. Both build, lint and type-check
clean under Next 16 and React 19, with no unmet peer dependency warnings, and neither
adds a `npm audit` finding. Escape closes and arrow keys navigate in both. Swipe
navigation works in both when driven by real touch events — an early observation that
react-photo-view did not respond to swipe turned out to be an artifact of devtools touch
emulation and was discarded rather than recorded.

**Accessibility against bundle size.** react-photo-view is smaller for a visitor who
opens the lightbox — 14.2 KB gzip against 28.8 KB. PhotoSwipe wins the initial route
load (11.9 KB against 14.2 KB) because its core is code-split behind a dynamic import,
and loses only when a photo is actually opened. On a photography site, most visitors
will open a photo, so the honest comparison is 28.8 against 14.2, and PhotoSwipe is the
heavier choice. We accept ~14 KB gzip to get focus trapping, focus return, and a
populated ARIA surface from the library instead of from us. Building equivalent focus
management by hand on top of react-photo-view would cost code and, more importantly,
would have to be verified by us on every future release.

**Video against accessibility.** This is the genuine cost of the decision. On the
roadmap criterion, react-photo-view is the better tool: a typed React render prop
against PhotoSwipe's imperative event wiring plus a plugin last published in 2022.
We are choosing the option that is worse for a roadmap feature in order to be better on
a rule that applies to every visitor today. If video in the lightbox later proves
unworkable through `contentLoad`, that is the trigger to revisit this ADR — not a
reason to delay the decision now.

**Feel.** The owner compared both by hand: zoom lands correctly in both, captions are
readable and get out of the way in both, and fullscreen presentation is good in both.
Two differences were reported — PhotoSwipe's one-click zoom over react-photo-view's
double-click, and faster image paint in react-photo-view when browsing quickly. These
are the owner's assessment, recorded as such, and they point in opposite directions.

## Consequences

**Easier**
- Keyboard and focus behaviour for the lightbox is configuration, not code we own.
- The grid stays presentational; the lightbox lives behind one client component driven
  by the shared `Media` model, so replacing the library later touches one file.
- Visitors who never open a photo do not download the lightbox core.

**Harder**
- Captions are custom code (`uiRegister` plus a `zoomPanUpdate` handler to hide the
  caption while zoomed), and that code is ours to maintain.
- A vanilla-JS library inside React means the lifecycle — init on mount, `destroy` on
  unmount — is our responsibility.
- Video slides will need `contentLoad` wiring, and the iframe-swipe limitation means
  click-to-load embeds need care.

**To revisit**
- If PhotoSwipe has no release by roughly mid-2027, re-assess maintenance risk.
- If video in the lightbox cannot be built cleanly through `contentLoad`, reopen this
  decision with that evidence.
- If a screen reader test contradicts the measured ARIA surface, that outweighs the
  attribute count this ADR relied on.

## Action Items

1. [x] Implement the lightbox behind `src/components/gallery-lightbox.tsx`, driven by
       `Media`, with the grid trigger a real `<button>` or anchor (AB#13 follow-up story).
2. [x] Add `photoswipe` to `package.json` **in the implementation story**, not in this one.
3. [x] Record PhotoSwipe in `docs/asset-inventory.md`, add the MIT attribution to
       `NOTICE`, and place the license text in `licenses/` — before the dependency lands.
4. [x] Verify keyboard behaviour and the no-crop rule in the running app, not only in
       the prototype.
5. [ ] Run a screen reader pass (NVDA or VoiceOver) against the implemented lightbox.
       This spike measured ARIA attributes, which is not the same as a screen reader
       test, and no screen reader was used.
6. [x] Delete the spike branch `chore/13-lightbox-spike` once this ADR is merged.

## What this spike did not establish

- No screen reader was run against either candidate.
- Pinch-to-zoom was not tested on a physical device; swipe was verified through
  synthesised touch events only.
- Bundle figures are gzip of Turbopack production chunks measured on this branch; they
  will shift as the app grows.

## What implementation found (AB#15)

The decision held: focus management, keyboard navigation, and the no-crop rule all came
from the library rather than from us. Four behaviours were not visible from the spike and
are recorded here so the next person does not rediscover them.

- **Focus enters the dialog after the opening animation, not at open.** The library
  dispatches the event that installs its focus handling from `openingAnimationEnd`, so
  that focusing does not force layout mid-animation. There is a ~330 ms window in which
  the dialog is on screen and focus has not moved yet. Acceptable, but it is why the
  journey test polls for focus instead of asserting it immediately.
- **The library's own focus return goes to the element that opened the dialog**, which is
  the wrong one once a visitor has navigated. The project turns `returnFocus` off and
  restores focus to the trigger of the slide the visitor ended on, keyed by `itemId`.
- **Opening without a pointer position is what makes the dialog take focus at all.** The
  library reads a supplied pointer position as "opened by mouse" and then leaves focus
  outside until the visitor presses Tab. The project opens programmatically and passes
  none, so click and keyboard behave identically.
- **The library owns the `sizes` attribute at runtime**, replacing it with the slide's
  rendered CSS width. The project-owned hint from ADR-0005 therefore does one job: it
  makes the optimizer emit width-descriptor candidates. The selection among them is the
  library's, and it is more accurate than a static hint could be.
- **The library hides its previous and next controls on touch devices**, assuming a
  visitor swipes. The project overrides that in `gallery-lightbox.css`. A swipe is a
  dragging gesture with a distance and a direction, which is exactly what limited motor
  control, a switch device, or a head pointer makes hard; a hidden control is in neither
  the tab order nor the accessibility tree, so on a phone the gallery would have had no
  operable pointer navigation at all. This is the one place where the accessibility
  argument that chose the library also required departing from its defaults.
- **The zoom cap has to be applied to every zoom level the library exposes**, not just
  the initial and maximum ones. It computes the effective maximum as the largest of the
  initial, secondary, and maximum levels, so leaving the secondary level at its default
  raises the ceiling straight back past the cap — bounded only by the library's own
  looser 4000-pixel clamp. Covered by a browser-free calculation test, because no
  current mock derivative is wide enough for a browser test to reach the case.

Residual checks that remain manual, and were not performed:

- **Screen reader.** Action item 5 above is still open. The implementation adds
  `aria-modal` and an accessible name to the library's `role="dialog"`, which the
  automated journey asserts — but attributes are not a screen reader test.
- **Physical touch.** The journey drives the gesture through pointer events, which is the
  same handler a finger reaches, on a synthetic device profile. Swipe and pinch-to-zoom
  on real glass are unverified, and the spike already found that emulated touch can
  mislead. Verify on a physical device before launch.
