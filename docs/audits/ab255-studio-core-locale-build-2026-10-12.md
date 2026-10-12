# AB#255 — Studio core language-choice build, 2026-10-12

Source baseline `4382537` includes both PR #355 and PR #356. This small source
slice adds pinned `@sanity/locale-fi-fi@1.1.40` (MIT) and registers `fiFILocale()`
next to `structureTool()`. The exact release's named export/optional options and
Sanity peer range are verified. It supplies a `fi-FI` core locale choice alongside
English; project/content locales, schema fields, editor policies, previews and
authentication/deployment boundaries remain unchanged.

## Checked gates

- Lockfile adds only the root dependency and one locale-package entry; every
  existing package entry/version/integrity is unchanged. Installation disabled
  lifecycle scripts. `npm ls sanity` resolves one deduplicated Sanity 6.18.0.
- Studio typecheck passes; schema validation reports zero errors.
- Static Studio build passes on the existing CI synthetic public settings with
  telemetry disabled, not an owner's project/dataset or ignored real env file.
- Compiled JavaScript contains the actual locale plugin name and `fi-FI` ID.
  The build emits notices for 896 installed packages; the new package's original
  MIT license and exact artifact URL are included.
- Calling the installed `fiFILocale()` returns only the plugin name and i18n
  configuration, with the expected Finnish locale and 13 lazy resource bundles.
  This configuration check loads no translation resources or CMS data.
- Before/after dependency audit has the same eight moderate advisories and no
  new findings. Existing dependency limitations are not hidden or fixed here.
- Root lint and all 5,696 tests in 237 files pass. Local documentation links,
  scope/privacy and whitespace checks pass; evidence is retained in the handoff.

The owner instructed this continuation to proceed without Claude on 2026-10-12.
Codex completed the final source review; earlier plan reviews and the unsuccessful
external-review attempt remain historical evidence, not a pending release gate.

## Remaining acceptance

The [source inventory](ab255-studio-language-inventory-2026-10-12.md) found 159
missing Finnish keys out of 2,151 English keys, including 108 in `variants` and
51 elsewhere. This patch does not invent replacements or prove fallback
rendering, translation quality, enabled features or complete visible coverage.
Project schema/structure/preview/custom-validation text remains separate.
No authored translation is created or accepted by interface selection.

Verify actual owner-authenticated FI/EN switching, browser preference persistence,
missing/interpolated messages, wording and ordinary editor/validation/action
controls before deployment. Authentication and hosted pre-config chrome are
outside this core-plugin proof. No authenticated session, live CMS read/write,
Studio deployment or Production activation occurred. Public Next.js routes and
journeys are unchanged; its production build/E2E are not rerun for this isolated
Studio configuration slice. AB#255 remains Active; full bilingual Studio and
all-pages acceptance remain outstanding.

The ignored owner packet retains one plan review/dispositions, exact release
metadata, lock/audit delta, build logs, compiled-asset/notices checks and review
snapshots. The application keeps the existing build/notices tooling; this slice
adds no committed helper or source-text mirror test.
