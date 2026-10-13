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
