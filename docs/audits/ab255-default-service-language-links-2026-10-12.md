# AB#255: Default service aliases expose actual language siblings

AB#255 remains Active. The default service listing/detail aliases lacked the language-switch behavior present in localized content-tree routes. This small branch exposes the actual provider-owned locale siblings on those aliases and aligns metadata with existing canonical service paths.

Listing/detail switches use published locale versions, omit the current language and never invent a translation or slug. Canonical/hreflang metadata and service JSON-LD use the real provider path under the configured service root. Existing alias URLs remain available. Cards, contact actions, prices, authored copy and full-frame images retain their current behavior.

Validation: lint and TypeScript passed; 239 unit-test files / 5731 tests passed. A production-build browser run passed all 16 targeted service tests across Chromium and WebKit, including scriptless default listing/detail switches, return navigation and canonical/hreflang checks. No dependency, CMS schema, publication or deployment change.

This branch does not supply the five missing published English service documents. Their owner editing proposals are separate. General album-image alt/caption authoring is deferred until after MVP.

Main integration, 2026-10-13: updated to `534dada` without conflicts. Final lint passed. The integrated production build and all 30 service browser cases passed, including the merged broader FI/EN journeys. A parallel unit run timed out in three existing Proxy/public-route tests during concurrent builds; the original timeout limits are unchanged.

The full unrestricted rerun then passed all 5741 unit tests in 239 files with unchanged timeouts.

Conflict repair, 2026-10-13: integrated main `212c5a2` after the independent
legacy-delivery, redirect and contact-verification merges. Only the shared
coverage/status documents conflicted; both work histories are retained. The
combined branch passes lint and all 5,803 unit tests. The production build and
60 service/legacy-redirect Chromium/WebKit journey cases pass. Language-sibling
selection, canonical paths, original frames and authored content are unchanged
by conflict resolution. No CMS write, publication or deployment occurred.

Integration after PR #372, 2026-10-13: both coverage/status histories are retained against main `1e63b7e`. All 5 original runtime/test files and 27 incoming runtime/test files remain byte-identical to their reviewed source commits. Lint and all 5,827 unit tests pass. Earlier required CI #889 passed; this newer merge requires its own CI. No authored content or runtime behavior changed by conflict resolution.
