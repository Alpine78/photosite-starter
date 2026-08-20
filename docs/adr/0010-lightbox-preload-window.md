# ADR-0010: Bounded adjacent-image lightbox preload window

**Status:** Accepted
**Date:** 2026-08-20
**Deciders:** Project owner (Ilkka Rytkönen)
**Work item:** AB#79

## Context

The project-owned PhotoSwipe wrapper (`src/components/gallery-lightbox.tsx`, ADR-0001)
opens a visitor's currently-loaded slide array unchanged and never set PhotoSwipe's own
`preload` option (`[before, after]` slide counts). PhotoSwipe 5 defaults that option to
`[1, 2]` internally, so the lightbox already preloaded one slide back and two forward —
but as an inherited library default, not a decision this project made or could point to.
AB#79 requires the window to be "explicit, bounded, and configurable from project-owned
integration code," to demonstrably never download a whole large gallery or every full-size
image on open, to let a failed preload neither block the current slide nor stay broken,
to never itself cross a gallery's page cursor, and to have its network and memory behavior
measured on an agreed mobile profile and recorded.

Reading PhotoSwipe 5.4.4's own source settled the mechanics rather than assuming them:

- `ContentLoader.updateLazy` only ever requests indices derived from
  `pswp.currIndex +/- preload[n]`, looped modulo the length of the `dataSource` array the
  viewer was actually given. `gallery-lightbox.tsx` builds that array from exactly the
  grid's own currently-loaded slide list (`open()`) and appends to it in place as a page
  continuation delivers more (AB#72). There is no separate, larger backing array preload
  could reach into — it structurally cannot request an index beyond what the client has
  already loaded, and so cannot itself trigger fetching a new page. Crossing a page cursor
  stays the existing, separate mechanism that fires only once a visitor's current slide is
  the last one loaded, through `GET /api/gallery`.
- Each slide is an independent `Content` instance with its own load state. A failure calls
  the library's `displayError()`, using the project's already-wired `errorMsg` label; one
  slide's failure never touches another slide's content or blocks the current slide's
  rendering. `Content.activate()` retries loading (`this.load(false, true)`) whenever a
  slide in an error state becomes active — landing on a slide whose preload failed retries
  it for free. So the "does not block, recovers on demand" criterion is a property of the
  library once the window is set, not something this story needed to build.
- `ContentLoader`'s cache capacity is `Math.max(preload[0] + preload[1] + 1, 5)` — the
  bounded window still keeps up to five `Content` objects live, a detail worth recording so
  a later reader of a memory measurement does not expect the cache to hold exactly four.
- The project's Playwright config (`playwright.config.ts`) already runs `desktop-chromium`
  and `mobile-webkit` (`devices["iPhone 15"]`) — `mobile-webkit` is the project's existing
  agreed mobile profile elsewhere in the codebase, chosen because WebKit is the only engine
  real iOS devices run.

## Decision

**`LIGHTBOX_PRELOAD_WINDOW: readonly [number, number] = [1, 2]`**, added to
`src/lib/image-delivery.ts` beside the file's existing lightbox presentation constants
(`LIGHTBOX_MAX_CSS_WIDTH`, `getLightboxZoomCap`), and wired into the `PhotoSwipeLightbox`
constructor's `preload` option in `gallery-lightbox.tsx` as `[...LIGHTBOX_PRELOAD_WINDOW]`
(spread into a fresh mutable pair — PhotoSwipe's own option type is `[number, number]`, not
`readonly`). The values restate the library's own prior incidental default — one slide back,
two forward, forward-biased because next is the more common navigation direction — made
into a single, explicit, project-owned place to change it, rather than re-tuning behavior
with no demonstrated need.

The window stays a compile-time constant rather than an environment variable or other
runtime knob: AB#79 asks for it to be configurable from project-owned integration code, not
configurable per deployment, and no clone has a stated reason to need a different value.

`e2e/gallery-lightbox-preload.spec.ts` is the verification this decision rests on, run
against the production build on both Playwright projects:

1. Opening the lightbox on a gallery whose loaded page holds far more items than the window
   causes zero requests to `/api/gallery` and touches at most
   `LIGHTBOX_PRELOAD_WINDOW[0] + LIGHTBOX_PRELOAD_WINDOW[1] + 1` (4) distinct underlying
   photograph identities — never the whole loaded page, let alone the whole gallery.
2. Each forward-navigation step touches at most that same bound of newly-requested
   photographs.
3. A preload failure on one adjacent slide is injected by aborting exactly one matching
   request; the current slide and the open dialog are unaffected, and navigating onto the
   failed slide retries and succeeds — proving the library's native retry-on-activate
   behavior holds in a real browser, not only in its source.
4. A JS-heap memory delta is sampled via Chromium DevTools Protocol
   (`Performance.getMetrics`, `JSHeapUsedSize`) after opening plus four forward
   navigations, run only on the `desktop-chromium` project at the `mobile-webkit`
   project's own iPhone-15 CSS viewport size — an explicitly-labeled best-effort proxy, not
   a true WebKit/iOS measurement (see "What this ADR did not establish").

`src/lib/image-delivery.test.ts` pins the constant to exactly `[1, 2]`, plus a supplementary
check that it stays a small, bounded, non-negative integer pair.

### Measured evidence

Captured from a real `npx playwright test e2e/gallery-lightbox-preload.spec.ts` run against
a production build, 2026-08-20 — actual observed numbers, not estimates:

| Measurement | desktop-chromium | mobile-webkit |
| --- | --- | --- |
| Distinct photographs requested on open (bound: 4, loaded page size: 24) | 4 | 2 |
| Per-step new photographs across 4 forward navigations (bound: 4/step) | 1, 1, 0, 0 | 1, 1, 0, 0 |
| `/api/gallery` requests during open + 4-step walk | 0 | 0 |
| JS heap delta after open + 4 forward navigations (Chromium CDP proxy) | 2.94 MB | not measurable — see below |

`mobile-webkit` touched fewer distinct photographs than the theoretical bound on open (2,
not 4) because at that viewport the grid thumbnail and lightbox slide select overlapping
responsive-candidate widths for some of the same photographs, so one of the four
theoretically-preloaded images was already cached from the grid. That is the "zero new
request is valid when the browser reuses an already-loaded candidate" case, not a
violation of the bound — the bound is a ceiling, not a target.

## Options Considered

### Option A (chosen): explicit `[1, 2]` constant, matching the library's prior default

**Pros:** zero behavioral change for a visitor, satisfies every AB#79 acceptance criterion,
smallest possible diff, gives future retuning a measured baseline to compare against.
**Cons:** none identified — the acceptance criteria's "must not download the whole gallery"
requirement is trivially satisfied by any small window, so there was no correctness reason
to pick different numbers.

### Option B: a wider window (e.g. `[2, 3]`) for smoother rapid back-and-forth browsing

**Pros:** could reduce a visible load flash for a visitor who navigates faster than the
network can keep up. **Cons:** no demonstrated UX need prompted this story, and it trades
directly against "opening a large gallery does not download... every full-size image" —
the margin the current window leaves is exactly what a future change like this would spend.
**Rejected for now**; the measured evidence above is what a future proposal to widen it
would need to revise.

### Option C: runtime/environment-configurable window

**Pros:** a clone could tune it without a code change. **Cons:** no deployment-specific
reason has been stated for needing a different value, and a compile-time constant already
satisfies AB#79's "configurable from project-owned integration code" criterion literally —
runtime configurability was never asked for. **Rejected**, consistent with the sibling
constants (`LIGHTBOX_MAX_CSS_WIDTH`) already living the same way.

### Option D: automate the memory measurement identically on WebKit

**Pros:** would give the agreed mobile profile its own real number instead of a proxy.
**Cons:** verified, not assumed — Playwright's WebKit driver exposes no portable API
equivalent to Chromium's `Performance.getMetrics` CDP domain for JS heap or image memory.
**Rejected as infeasible with current tooling**; recorded as a limitation rather than faked
or silently dropped (see below).

## Trade-off Analysis

**Correctness versus UX tuning.** Every acceptance criterion this story had to satisfy is a
property of *having* a small, explicit, bounded window — not of which small numbers it
contains. That collapsed the numeric choice (Option A vs. B) into a UX judgment call with
no forcing constraint, so the decision defaults to the value already proven not to regress
anything: today's incidental behavior, now made deliberate.

**A durable written record versus a CI-asserted exact number.** The e2e suite asserts the
*structural* bound (`LIGHTBOX_PRELOAD_WINDOW[0] + [1] + 1`), not today's measured point
values — a gallery's exact request count depends on caching and responsive-candidate
overlap between runs, so pinning CI to the literal numbers above would make the suite
flaky for reasons unrelated to a real regression. This ADR is therefore the durable record
AB#79's "measured and recorded" criterion asks for; the suite is what keeps the *bound*
true going forward.

**A Chromium proxy versus no mobile memory measurement at all.** Given WebKit has no
portable measurement API, the choice was between recording nothing for AB#79's memory
criterion or recording an explicitly-labeled proxy. A labeled approximation that a reader
can see is approximate serves the acceptance criterion's intent — catching a preload
window that regresses into unbounded memory growth — better than silence would.

## Consequences

**Easier**

- A future change to `LIGHTBOX_PRELOAD_WINDOW` changes both the runtime behavior and
  `e2e/gallery-lightbox-preload.spec.ts`'s expectations together, since the suite reads the
  constant rather than restating its numbers — retuning it needs no hunt for hardcoded
  assertions elsewhere.
- The failure/retry behavior AB#79 required is now verified against a real browser, not
  only inferred from reading the library's source.

**Harder**

- Nothing new: the constant lives beside its siblings in `image-delivery.ts`, and no new
  runtime surface, dependency, or configuration path was introduced.

**To revisit — migration triggers**

- **A demonstrated UX need for faster rapid-navigation preloading emerges** → revisit
  Option B against a fresh measurement, using this ADR's numbers as the "before" baseline.
- **Playwright or WebKit ever exposes a portable memory-sampling API** → replace the
  Chromium-proxy measurement with a real `mobile-webkit` one and update the table above.
- **A clone's deployment genuinely needs a different window** → revisit Option C; no such
  case exists today.

## Action Items

1. [x] Add `LIGHTBOX_PRELOAD_WINDOW` to `src/lib/image-delivery.ts` and wire it into
       `gallery-lightbox.tsx`'s `PhotoSwipeLightbox` constructor.
2. [x] Pin the constant with a Vitest unit test in `src/lib/image-delivery.test.ts`.
3. [x] Add `e2e/gallery-lightbox-preload.spec.ts` covering the bounded-window, bounded-delta,
       failure/retry, and Chromium-proxy memory measurements described above.
4. [x] Record the measured evidence in this ADR from a real Playwright run.

## What this ADR did not establish

- **A real WebKit/iOS memory measurement.** The Chromium CDP proxy is a documented
  approximation taken at the `mobile-webkit` project's own viewport size, not a
  measurement of WebKit's actual memory behavior. Closing that gap, if it is ever needed,
  would most likely be a one-time manual measurement via Safari's Web Inspector rather than
  further Playwright automation, given the verified absence of a portable API.
- **Any change to the preload window's numeric values.** This ADR restates the library's
  prior default deliberately; it is not a claim that `[1, 2]` is optimal, only that it is
  measured, bounded, and sufficient for every stated acceptance criterion today.
