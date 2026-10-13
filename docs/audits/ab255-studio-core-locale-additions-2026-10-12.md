# AB#255: Finnish Studio core resource additions

AB#255 remains Active. This branch fills the 159 source-comparison gaps observed in the pinned Finnish package; it does not claim all 159 appear in the configured Studio.

The resources cover seven namespaces: canvas (1), comments (2), copy-paste (1), releases (10), structure (5), studio (32), and variants (108). Adding resources does not enable variants, releases or another tool. Interpolation tokens, markup and plural keys match Sanity 6.18.0's English source. The copied English verification fixture carries its MIT notice in licenses/MIT-sanity-core-locales.txt and docs/asset-inventory.md.

Validation: 240 unit-test files / 5733 tests passed, including the actual installed i18next engine's interpolation, plural and fallback behavior. Lint, Studio typecheck, schema validation and static Studio build passed. No dependency or lockfile change. The Finnish locale choice is supplied by merged PR #365; the combined config also retains PR #364's navigation bundles.

An owner-operated headed Chromium helper opens a separate ignored profile and exposes local debugging at 127.0.0.1:9222. The owner signs in themselves; the repository and CI never receive credentials, cookies or browser-profile artifacts. The integrated local preview includes the proposed schema, navigation and core additions. Its authenticated UI check remains pending: the browser currently shows the login-provider prompt.

No Studio deployment, CMS content write or production activation occurred. General album-image alt/caption authoring is deferred until after MVP.

Main integration, 2026-10-13: updated to `534dada` after PRs #359/#363/#364/#365. Config/README conflicts preserve the core Finnish plugin, navigation bundles and the new resource additions together. Lint, Studio typecheck, zero-error schemas and static build passed, with 896 package notices. A parallel unit run timed out in one existing Proxy test under concurrent build load; an unrestricted full rerun with unchanged timeouts passed all 5743 tests. No dependency delta against current main. Authenticated verification remains pending; the previous local browser is no longer available.
