# Article reading-position requirements

Refinement worksheet for AB#193, under rough story AB#20 and Feature AB#91.
The initial worksheet below is preserved as refinement history. On 2026-10-18
the owner accepted the bounded policy below. AB#362 implements its storage
foundation; AB#364 integrates public restoration and visitor controls.

AB#321 subsequently prioritized a reading address following existing body
headings through H4. AB#330 implements that separate, nonpersistent enhancement:
deliberate reading scroll replaces the current URL fragment without adding
history entries, scrolling or moving focus. Direct fragment links and native
history navigation remain authoritative. It uses no browser storage and does
not restore a saved position. The owner accepted H4-section precision for the
future restoration; the policy below now resolves the bounded storage choices.
The original questions remain useful integration checkpoints.

## Accepted policy, 2026-10-18 (AB#20)

For article variants, remember stable content identity, locale, the existing
chapter anchor through H4, and last save time in origin-local `localStorage`
for 90 days. Store no title, full URL, media data or pixel offset. Explicit
fragment links and native Back/Forward or bfcache restoration win. A missing
chapter falls back to the top; before the first chapter, do not save a place.
Visitor settings must allow disabling and clearing saved places. This decision
does not authorize server storage, synchronization, tracking or CMS writes.

### Implemented storage boundary (AB#362)

`src/lib/reading-position-store.ts` takes an optional three-method storage port
and a clock; it accesses no browser globals. Positions are a JSON array under
`photosite.reading-positions.v1`, containing only `contentId`, `locale`,
`headingId` and integer `savedAt` fields. Preference key
`photosite.reading-positions-disabled.v1` stores `1` for disabled; absence or
another string means enabled. IDs/anchors are bounded to 512 UTF-16 code units,
locale to 64, the serialized array to 128 Ki code units including escaping,
and the retained set to 100 article/locale pairs. These are application limits,
not a promise of browser quota. Oldest entries are evicted first; equal times
use code-unit order of content identity, locale, then anchor. A duplicate pair
keeps its newest record, with that same anchor tie break.

`save` accepts only a heading chapter and refreshes its 90-day retention from
the successful save time. `load` returns the matching current heading or null;
an empty/incomplete current-heading set never deletes a valid record. Missing
headings return null for the integration's top fallback. Exactly 90 days old is
expired. Malformed, extra-field, expired and future-dated records are discarded;
a backward device-clock change can therefore invalidate a saved place.
Invalid/throwing clocks cause no save or restore. Invalid outer JSON is treated
as empty. Oversized inputs are ignored rather than parsed. Reads prune only
when normalization changes the stored array; output is evicted until both
count and serialized-size limits hold.

`save`, `clear` and `setEnabled` return a boolean persistence result; false
also covers ignored non-heading/invalid saves. `load` returns `string | null`.
`clear` touches only positions, preserving the preference and unrelated keys.
If removal fails it tries writing `[]`. If both fail it reports false and
suppresses old records in this instance, including after re-enabling; a new
instance can still see the old bytes. A subsequent successful save overwrites
from empty. Disabling clears positions and takes effect in this instance even
when persistence fails. Enabling cannot release that suppression, and reports
failure if the disabled preference cannot be removed or overwritten. Every
operation rechecks the persisted preference; denied reads fail closed.
Last writer wins between tabs; this foundation does not provide transactions
or cross-tab events. The integration must throttle saves and reflect failures
accurately rather than claiming a successful persistent clear/disable.

Expiry is enforced on next use, not while the browser is closed. This feature
must attempt continuity across browser restarts, but cannot guarantee browser
retention: private mode, eviction, quota and denied storage may prevent it.
The browser integration acquires `window.localStorage` in a try/catch.

### Article integration (AB#364)

Only article variants pass content identity and locale to the existing reading
address observer. Accepted deliberate reading input saves an H2/H3/H4 chapter;
intro, outside-body and modal movement does not save. The observer accepts at
most one update every 500 ms. A newly accepted chapter is saved immediately;
only same-chapter timestamp refreshes are limited to once per minute. This is
not a minute-long debounce that could lose an accepted H4 on leaving the page.

A fresh, visible, top-of-page visit without a fragment gets one bounded restore
attempt after hydration. The current chapter is scrolled into view instantly,
with native scroll padding/margin and no focus, query, URL or history-state
change. Existing fragment links, native history/bfcache, an already scrolled
page, modal state, unknown initial navigation and new input take priority.
A missing/expired chapter leaves that eligible fresh visit at the top. Two
animation frames defer the initial attempt. A temporary observer of the body
compensates actual later layout changes (for example comparison images switching
from their full-image fallback) while that automatic anchor is still current.
It makes no style/layout writes or polling loop and stops on any reader gesture,
settings change, explicit navigation, hidden page, modal or unmount. The initial
fresh `pageshow` locks chapter tracking without cancelling restoration; a
persisted `pageshow` remains authoritative history and cancels it. The root observer keeps history/input context across in-app
article transitions, with symmetric listeners and module state across shell
remounts. A fresh same-tab local link can restore after its actual destination
arrives; a cancelled, modified, download or new-tab click cannot release the
current page's protection. Unsupported/ambiguous cases conservatively retain
the current place. Existing gallery bodies keep their nonpersistent address.

Settings inside each article provide Finnish/English controls for remembering
positions and clearing all saved positions, including on articles without a
heading list. The checkbox shows the effective state, a polite status reports
success/failure, and the disclosure explains device-only retention and eviction.
Controls render after hydration; a no-script explanation preserves ordinary
reading without inert checkboxes. Settings and observer share a browser-only
store instance so failed-clear suppression survives between their calls.
Settings changes cancel pending restoration and lock saving until new deliberate
input. Cross-tab disable/clear events also lock the observer; last-writer-wins
storage remains best effort. No data is transmitted to a server or third party.

### Reading-position interface (AB#372)

The owner's Claude Design "Tarina hi-fi" (frames 01–05) moved the visible
controls into the article contents list. The list shows percent read, a
timeline of read/current/upcoming top-level sections and the current chapter's
expanded sub-headings with a "reading now" marker; other sections' sub-lists
open on demand. The remember switch, the device-only retention note and clear
sit in the list footer. Below 64rem a sticky bar under the site header names the
current chapter, section index and percent, and opens the same navigation
landmark as a modal bottom sheet with focus containment and Escape. Following a
link closes the sheet and lets native fragment navigation proceed. Without
script, the complete inline list remains and the bar is hidden.

Current-chapter state uses the same geometry as the saved chapter, so the
list never marks a different chapter than the one stored. An automatic restore
dispatches one event that a bottom status uses to name the chapter and offer the
start of the story; it closes after eight seconds unless hovered or focused and
never moves focus by itself. Choosing the start moves focus to the page title
only when focus was in the notice. Articles without a heading list keep the
previous settings disclosure. Storage, eligibility and precedence rules above
are unchanged.

Verification uses the production harness and synthetic content, including
Chromium/WebKit desktop/mobile emulation, delayed-script scrolling, real
keyboard/wheel input, actual native Back, FI/EN isolation, image/font layout,
missing/expired entries, denied acquisition/mutations and no-script reading.
An additional isolated persistent-profile journey closes the browser process,
relaunches it and checks saved bytes/restoration in desktop Chromium/WebKit.
It installs the same origin guard and synthetic client-address header as the
project fixture; it uses no daily browser profile. Separate-page reopening is
identified separately from that process restart. Physical devices and real
bfcache lifecycle are not claimed by these automated tests. AB#20 remains Active
until owner acceptance and merge; no Production deployment is implied.

Browser contracts were checked against
[Navigation Timing's document navigation types](https://www.w3.org/TR/navigation-timing-2/#dom-performancenavigationtiming-type),
[HTML's persisted pageshow event](https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-pagetransitionevent-interface)
and [Playwright persistent contexts](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context).
A two-engine operator probe also confirmed that `replaceState` does not change
CSS `:target`; restoration does not rely on that selector.

## Verified requirement and current boundary

AB#20 asks for browser `localStorage` to preserve position in long articles and
travel stories across a browser restart. The current source uses localStorage
for theme preference, not reading continuity. Public articles already have
content identity, locale, body headings and native-ratio media; their existing
navigation must keep working if persistence fails or JavaScript is disabled.
The worksheet does not promise permanent storage, identity or cross-device sync.

## Original refinement questions (historical)

| ID | Question to resolve | Evidence or acceptance needed |
| --- | --- | --- |
| R1 | Is the scope article variants only, or also galleries with long-form bodies? | Owner examples of returning to each supported surface. |
| R2 | How is a saved entry keyed and versioned? | Compare a route key with a `contentId` plus locale key; decide what happens after a slug, locale, body or deployment revision changes. |
| R3 | What does position mean? | Compare raw scroll offset, a heading anchor and an authored block anchor plus offset; verify which stable anchors both mock and CMS content actually provide. |
| R4 | Which navigation wins? | Define explicit `#anchor`, native Back/Forward and bfcache restoration versus saved position; avoid a second jump that overrides the visitor. |
| R5 | When may restoration happen? | Exercise image layout reservation, lazy media, click-to-load embeds, tabs, inline galleries and appended end-gallery pages. Define a bounded fallback if the saved target no longer exists. |
| R6 | Is restoration automatic or offered? | Decide the visible control, reduced-motion behavior, keyboard focus and screen-reader announcement; restoring scroll must not silently move focus. |
| R7 | When is a position saved or cleared? | Decide reading completion, navigation away, expired/unpublished/404 content and any retention limit. No numeric duration is selected here. |
| R8 | How can the visitor clear or disable it? | Decide control location and behavior on a shared device; confirm what identifying content keys reveal locally. |
| R9 | What can the browser guarantee? | Verify the supported browsers' restart, private-mode, storage-disabled, eviction and quota behavior. Handle failures without breaking reading; do not promise that browser storage cannot disappear. |
| R10 | What privacy review is required? | Document data and purpose, local-only boundary and owner decisions about necessity/consent before choosing a policy. Do not inherit a poll-cookie justification. |

## Original unapproved candidate slices (historical)

1. **Decision and browser spike:** answer R1–R4 and R7–R10 with owner examples,
   verified browser behavior and a storage-failure exercise. Record any ADR needed
   for a durable key or restoration contract before implementing it.
2. **One-surface continuity:** only after the choices are accepted, implement one
   article use case. A journey must reopen it after restarting the browser,
   respect an explicit anchor and survive denied storage without a reading error.
3. **Visitor controls and difficult layouts:** verify clear/disable, shared-device
   expectations, keyboard/focus behavior and the agreed R5 cases before broadening
   to further content variants.

These were proposals at the refinement checkpoint. AB#362 is now prioritized
for the bounded storage foundation described above. AB#20 is not complete merely
because this worksheet exists. The [feature history](feature-status.md) remains
supporting context; the work item governs future scope.
