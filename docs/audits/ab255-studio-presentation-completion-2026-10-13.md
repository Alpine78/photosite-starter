# AB#255 — Studio presentation completion, 2026-10-13

PR #370 completes the three presentation paths identified by the authenticated
Studio audit: compiled document-type headings/help, document-list interface
text and full-frame photographic list previews.

The locale-aware layout supplies a separate compiled-schema presentation
projection through the pinned SDK's internal SourceProvider/WorkspaceProvider
bridges. Inner list/document providers resolve that projected source. Canonical
schema objects, fields, validators, initial values, identities, clients and auth
stores remain unchanged; only type titles/descriptions and prepared interface
text vary. Actual authored titles, slugs and labels remain opaque. Recheck these
internal exports whenever Sanity 6.18.0 is upgraded.

Document-list panes bypass schema preview components. The supported
preview.prepare media slot now supplies a React image component instead of a raw
image source. It requests fit=max with a bounded 320-pixel box, preserves the
asset's intrinsic dimensions and contains the full frame. Crop/hotspot inputs
do not enter the URL builder. This also preserves media in the localized preview
pipeline. No image descriptions, derivatives or assets are generated or rewritten.

## Verification

- Authenticated Windows Chrome: the article type heading is Artikkeli in Finnish
  and Article in English. The rendered editor control values compare equal
  across the switch, without exporting authored values.
- The same gallery-placement list has 31 Finnish Kuva prefixes / zero Image
  prefixes, then 31 Image prefixes / zero Kuva prefixes in English.
- Both list views have 31 photographic URLs using fit=max and zero fit=crop
  URLs. Contained CSS alone was not treated as evidence of a full-frame request.
- Compiled-SDK regressions verify type metadata, stable field/validation
  references, authored-value preservation and React media in the real preview
  preparation pipeline. Full unit suite, lint, Studio typecheck, zero-error
  schema validation and Studio/Next.js production builds pass.
- UI checks guard document writes. The original null-array content condition
  was not reset. Custom publication messages retain their Rule-engine tests;
  no blanket live exercise of every validator or missing-value case is claimed.

Final committed-head CI and normal PR/wording review remain. Source/UI readiness
does not deploy Studio or publish accepted article drafts. General album-image
caption/alt authoring stays deferred after MVP. AB#255 remains Active.

## Ordered integration

The branch includes #371 head 8d141e5 and resolves their one shared Studio
configuration conflict with both features retained. Merge #371 first, then
#370. The exact combined source passes all 5,846 tests, lint, Studio typecheck,
zero-error schema validation and Studio/Next.js production builds.

The final photo-preview pass also covers default media/service/home previews
without custom prepare functions. Compiled regressions preserve selected authored
text and unrelated SDK/plugin preview functions with their view options. An
authenticated media-library list additionally shows 31 fit=max images and zero
fit=crop requests. The photographic selectors currently select scalar title and
subtitle fields; keep that contract or supply an explicit prepare for a future
portable-text title.

Latest-main integration: after #376 merged as 94c9816, #371 was reconciled as
dd0732c and included in this combined branch. The Studio runtime inputs from
that integration are unchanged; the combined 252-file / 5,919-test suite and
Next.js production build pass against the new main. The final gallery URL-rule
wording correction passes its focused translation/Rule tests. New final-head CI
is required; earlier green statuses do not validate this newly published head.
