# Article reading-position requirements

Refinement worksheet for AB#193, under rough story AB#20 and Feature AB#91.
The initial worksheet below is preserved as refinement history. On 2026-10-18
the owner accepted the bounded policy below. AB#362 implements its storage
foundation; public restoration and visitor controls remain pending.

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
The caller must acquire `window.localStorage` in a try/catch. Browser integration
still needs navigation precedence, heading readiness, layout/scroll handling,
unchanged focus, localized settings and failure feedback, local-data disclosure,
and production-build Chromium/WebKit restart/anchor/history/denied-storage
journeys. No public call site uses this foundation yet; AB#20 remains Active.

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
