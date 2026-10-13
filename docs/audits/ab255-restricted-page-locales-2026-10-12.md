# AB#255: Restricted page UI locale implementation

AB#255 remains Active. The owner accepted ADR-0032 on 2026-10-12. This branch implements the exact configured full-tag GET selector on existing administrator, protected-gallery and retained-legacy URLs.

The Proxy overwrites caller-provided locale headers and selects only a single supported bounded locale query. Layouts/pages revalidate that value; unsupported, repeated, empty or absent values use the deployment default. Plain document links retain only the fixed page path and validated locale. Root language, built-in labels, dates and generic legacy metadata agree. Login/logout reload the selected locale without adding preference cookies or changing closed API bodies.

Protected switches require an authorized response and a clean browser fragment; server markup exposes none before that browser check. Failed fragment removal cannot introduce outgoing language links. Dirty form edits prompt before switching. Logout is disabled until hydration, matching login's existing readiness guard.

Localized route error boundaries render generic labels from the current document tree. Root-layout failures retain a fixed bilingual fallback with explicit language spans. Exception messages, provider data and digests are never rendered.

Security review checked header ownership and second rewrites, fixed same-origin destinations, secret/body/session separation, fragment handling, no-store/noindex/referrer boundaries and the retained-image manifest. Locale grants no authorization and performs no CMS lookup in Proxy. Authentication, cookie/origin/rate-limit policy, image/native dimensions and image/ZIP bytes are unchanged. React review checked request-scoped context, hook cleanup, hydration state, full-document navigation and full-frame media.

Validation details are recorded in the final verification section below. Authored protected/legacy titles remain a separate editorial acceptance dependency. General album-image alt/caption authoring is deferred until after MVP; existing source descriptions stay intact. No production deployment occurred.

## Final source verification, 2026-10-13

Lint and TypeScript passed. All 240 unit-test files / 5755 tests passed. The
production-build restricted regression passed 157 browser tests; 21 tests are
explicitly skipped because WebKit cannot retain the required Secure cookies in
the HTTP harness. Existing cookie policy is unchanged. Authenticated HTTP API
and server-rendered FI/EN boundaries are covered in both browsers; HTTPS browser
authentication remains a production verification dependency.

The shared document-root public regression passed 70 tests, skipped four WebKit
HTTP-auth cases and encountered two 15-second load timeouts in the existing
article/end-gallery tests. All eight combinations of those article tests then
passed in a serial rerun without timeout or assertion changes. Contact delivery,
home content, article presentation, selected-language errors, scriptless links
and failed capability scrubbing have production-build evidence. The full final
restricted regression then passed with no failures.

Main integration, 2026-10-13: updated to `534dada` without conflicts. Final lint and all 5765 unit tests passed. The new production-build restricted regression passed 157 tests with the same 21 documented WebKit HTTP-cookie skips. No failed tests in this integrated restricted run.

Conflict repair, 2026-10-13: integrated main `212c5a2` after the independent
legacy-delivery, redirect and contact-verification merges. Only the shared
coverage/status documents conflicted; both work histories are retained. The
combined branch passes lint and all 5,827 unit tests. Its production-build
restricted-locale, private-route-hygiene and legacy-redirect journeys pass
90 cases with four documented WebKit HTTP-cookie skips. No authentication,
locale-parser, media or deployment contract was changed by conflict resolution.
