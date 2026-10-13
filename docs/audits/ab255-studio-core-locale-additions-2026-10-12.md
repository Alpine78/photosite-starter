# AB#255: Finnish Studio core resource additions

AB#255 remains Active. This branch fills the 159 source-comparison gaps observed in the pinned Finnish package; it does not claim all 159 appear in the configured Studio.

The resources cover seven namespaces: canvas (1), comments (2), copy-paste (1), releases (10), structure (5), studio (32), and variants (108). Adding resources does not enable variants, releases or another tool. Interpolation tokens, markup and plural keys match Sanity 6.18.0's English source. The copied English verification fixture carries its MIT notice in licenses/MIT-sanity-core-locales.txt and docs/asset-inventory.md.

Validation: 240 unit-test files / 5733 tests passed, including the actual installed i18next engine's interpolation, plural and fallback behavior. Lint, Studio typecheck, schema validation and static Studio build passed. No dependency or lockfile change. The Finnish locale choice is supplied by merged PR #365; the combined config also retains PR #364's navigation bundles.

An owner-operated headed Chromium helper opens a separate ignored profile and exposes local debugging at 127.0.0.1:9222. The owner signs in themselves; the repository and CI never receive credentials, cookies or browser-profile artifacts. The integrated local preview includes the proposed schema, navigation and core additions. Its authenticated UI check remains pending: the browser currently shows the login-provider prompt.

No Studio deployment, CMS content write or production activation occurred. General album-image alt/caption authoring is deferred until after MVP.

Main integration, 2026-10-13: updated to `534dada` after PRs #359/#363/#364/#365. Config/README conflicts preserve the core Finnish plugin, navigation bundles and the new resource additions together. Lint, Studio typecheck, zero-error schemas and static build passed, with 896 package notices. A parallel unit run timed out in one existing Proxy test under concurrent build load; an unrestricted full rerun with unchanged timeouts passed all 5743 tests. No dependency delta against current main. Authenticated verification remains pending; the previous local browser is no longer available.

CI installation correction, 2026-10-13: build #872 failed in the root unit
job because `i18next` was not installed there. The separate Studio job's
dependencies are not shared with that job. Removing the local Studio dependency
symlink reproduced the same missing-package failure. The root install step now
installs both locked dependency trees and stops on either install failure. The
actual SDK/translation-engine tests remain mandatory; no test, assertion, timeout
or quality gate is bypassed. Runtime code, package manifests/locks, credentials
and deployment permissions are unchanged. Full fresh-install validation is
recorded in the local CI-fix logs.

CI build correction, 2026-10-13: build #880 reached the application build but
failed TypeScript in the owner-operated browser helper. Its Promise resolver
was passed directly as the BrowserContext `close` listener, which receives a
BrowserContext argument rather than a void Promise result. An explicit
zero-argument callback resolves the Promise without changing browser lifetime
or cleanup. The exact error was reproduced with the pinned Playwright 1.63.0
types before the correction. The missing Playwright-report artifact was a
secondary failure after the build stopped, not a translation-test failure.
Current main `212c5a2` integrates cleanly on this branch. The draft still requires
authenticated FI/EN Studio journeys and wording acceptance; source checks do
not establish those outcomes.

The corrected integration passes all 5,805 unit tests, lint and the production
application build after a fresh locked root install. Studio typecheck, schema
validation (zero errors) and static build also pass. The existing shared root
dependency symlink was preserved locally before installation: Turbopack rejected
its outside-root location, an independent local setup issue absent from CI's
fresh installs. No package manifest, lockfile, type-check exclusion, timeout,
translation assertion or quality gate was weakened.
