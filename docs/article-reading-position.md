# Article reading-position requirements

Refinement worksheet for AB#193, under rough story AB#20 and Feature AB#91.
This records questions and unapproved options; no reading-position feature or
storage contract has been accepted or implemented.

## Verified requirement and current boundary

AB#20 asks for browser `localStorage` to preserve position in long articles and
travel stories across a browser restart. The current source uses localStorage
for theme preference, not reading continuity. Public articles already have
content identity, locale, body headings and native-ratio media; their existing
navigation must keep working if persistence fails or JavaScript is disabled.
The worksheet does not promise permanent storage, identity or cross-device sync.

## Decisions required before implementation

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

## Unapproved candidate slices

1. **Decision and browser spike:** answer R1–R4 and R7–R10 with owner examples,
   verified browser behavior and a storage-failure exercise. Record any ADR needed
   for a durable key or restoration contract before implementing it.
2. **One-surface continuity:** only after the choices are accepted, implement one
   article use case. A journey must reopen it after restarting the browser,
   respect an explicit anchor and survive denied storage without a reading error.
3. **Visitor controls and difficult layouts:** verify clear/disable, shared-device
   expectations, keyboard/focus behavior and the agreed R5 cases before broadening
   to further content variants.

These are proposals, not prioritized stories. AB#20 is not complete merely
because this worksheet exists. The [feature history](feature-status.md) remains
supporting context; the work item governs future scope.
