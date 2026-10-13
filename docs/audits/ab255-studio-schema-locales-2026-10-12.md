# AB#255: Studio schema interface localization

AB#255 remains Active. This branch implements Studio presentation adapters for Finnish and English. It does not change the canonical content schemas or authored values.

The Finnish catalog contains 340 schema titles, help texts and option labels, plus 151 validation templates and preview strings. Field/input adapters select the current Studio locale. Custom validation preserves the actual immutable Sanity Rule chain, warning severity, original context, synchronous/asynchronous behavior and failures. Preview localization changes only missing-value fallbacks; actual authored titles, labels, slugs and media remain unchanged. Sanity 6.18.0's installed PreviewLoader forwards the complete prepared preview value, including the adapter's metadata, to the custom preview.

Validation: lint and Studio typecheck passed; 241 unit-test files / 5739 tests passed. The final focused rerun passed 36 tests. Canonical schemas compile without errors, and the static Studio build passes with the existing 895-package notice generation. No dependency or lockfile change.

The Finnish locale selector and navigation titles are supplied by merged PRs #365 and #364. Authenticated visual verification is pending: the owner-operated local preview currently shows the login-provider prompt. Static tests do not prove every form widget or preview in an authenticated Studio. No CMS write, Studio deployment or production activation occurred.

General album-image alt/caption authoring is explicitly deferred until after MVP. Existing authored image text, references and full-frame previews remain intact. Review translation wording before accepting the interface.

Main integration, 2026-10-13: updated to `534dada` after PRs #359/#363/#364/#365. The config conflict retains fiFILocale, editorialLocaleBundles and the new form adapters. Final lint and all 5749 unit tests passed; Studio typecheck, zero-error schemas and static build passed, with 896 installed-package notices. No dependency delta against current main. Authenticated verification remains pending; the previous local test browser is no longer available.

CI installation correction, 2026-10-13: build #871 failed in the root unit
job because `@sanity/schema` was not installed there. The separate Studio job's
dependencies are not shared with that job. Removing the local Studio dependency
symlink reproduced the same missing-package failure. The root install step now
installs both locked dependency trees and stops on either install failure. The
actual SDK/translation-engine tests remain mandatory; no test, assertion, timeout
or quality gate is bypassed. Runtime code, package manifests/locks, credentials
and deployment permissions are unchanged. Full fresh-install validation is
recorded in the local CI-fix logs.
