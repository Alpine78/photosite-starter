# Image import path inventory, 2026-10-22 (AB#391)

Read-only source inventory for [AB#391](https://dev.azure.com/ilkkarytkonen/photosite-starter/_workitems/edit/391)'s
first acceptance criterion, against `main` at `d33ecec`. It records what each path that
uploads image bytes to Sanity does to the image data and embedded metadata today, so the
owner rules recorded in [ADR-0039 decision 8](../adr/0039-keyword-taxonomy-and-ingest-boundary.md)
(no re-encoding up to 2048 px; keep copyright, creator name/phone/email/website, EXIF and
GPS; remove keywords and the postal address) can be applied path by path. Nothing was
changed or run against a dataset.

## Upload paths

Every write goes through `uploadSeedImageAsset` in `scripts/sanity-seed-http.mts`
(`POST /assets/images/<dataset>`). The callers differ in what they upload:

| Path (owner-run) | Source | What reaches Sanity today | Against decision 8 |
| --- | --- | --- | --- |
| `write-joomla-content.mts` → `joomla-image-derivative.mts` | Legacy Joomla images | `generatePublicDerivative`: EXIF-oriented, resized to ≤2048 px, **always re-encoded** (JPEG q90 / WebP q90 / AVIF q65 / PNG), **all metadata stripped** (no `withMetadata`) | Re-encodes images already ≤2048 px; strips copyright, creator, EXIF and GPS |
| `write-rally-import.mts` | Rally capture-sequence exports | Same `generatePublicDerivative` | Same |
| `write-rally-conversion.mts` | Existing rally galleries | Same `generatePublicDerivative` | Same |
| `client-web-image-preparation.mts` (`prepare-client-web-image-batch.mts`) | Client delivery web images | Same `generatePublicDerivative`, then audited | Same |
| `seed-sanity-content.mts` | Repository demo WebP fixtures | Bytes unchanged | Demo assets, not owner photographs; out of scope |
| Legacy delivery import (`plan-legacy-delivery-import.mts` and verifiers) | 21 retained delivery galleries | Owner-supplied JPEGs unchanged | ADR-0028's byte-for-byte exception; unchanged by decision 8 |

The inactive protected private-gallery upload tooling (ADR-0034, AB#313) is not a
public import path and is not listed.

## What AB#391 has to change

1. One shared step replaces `generatePublicDerivative` for the four owner-photograph
   paths: a JPEG at most 2048 px keeps its compressed image data byte for byte and only
   has its keyword and postal-address fields removed; a larger source is downscaled,
   re-encoded and gets the kept fields back.
2. EXIF orientation: today the derivative is rotated into its pixels (`autoOrient`).
   Without re-encoding, the orientation tag stays in the file and browsers apply it;
   the recorded dimensions must then follow the oriented size.
3. Non-JPEG sources (PNG, WebP, AVIF, GIF/TIFF fallback) need their own rule; decision
   8 speaks about JPEGs.
4. The metadata tool (recommended `exiftool-vendored`) is verified on AB#54's test files
   and recorded in `docs/asset-inventory.md` before it lands.
5. `docs/sanity-seeding.md`, `docs/asset-inventory.md` and `docs/deployment.md` stop
   saying EXIF/GPS is stripped.
6. The legacy re-upload plan lists every legacy public image whose source carries GPS
   for owner review before any write.

Points 2 and 3 are open questions for the implementation, not decided here.
