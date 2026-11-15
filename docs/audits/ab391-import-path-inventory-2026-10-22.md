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

**Update 2026-11-03:** point 2 is answered for reporting: the kept path records the size
after EXIF orientation, in `scripts/image-import-metadata.mts`. The source half of point 6
exists as `npm run plan:legacy-image-reupload`; matching its rows to published assets is
still open. Points 1, 3, 4 and 5 remain open.

**Update 2026-11-04:** the owner decided to do the re-upload after AB#54 showed the image CDN
serves neither the metadata nor the original bytes. Point 4 is done, and `prepareJpegForImport`
in `scripts/image-import-metadata-edit.mts` is the shared step of point 1. The removed fields are
now as ADR-0039 lists them: `lr:weightedFlatSubject` joins the keywords, and creator city and
country stay. Still open:

- **Wiring.** No path calls the shared step, so points 1 and 5 stay open and the current
  documents, which say metadata is stripped, are still true.
- **Point 2.** A kept file carries its orientation tag. Whether Sanity's recorded dimensions and
  CDN follow it needs a live check before wiring, because the no-crop layout depends on them.
- **Point 3.** Non-JPEG sources have no rule, and the shared step refuses them.
- **The client web image path.** `prepareClientWebImage` deliberately refuses any output with
  metadata and has its own receipt, so carrying metadata there is a separate owner decision.

**Update 2026-11-04, later the same day:** the list above is resolved as follows.

| Path | State |
| --- | --- |
| `write-rally-import.mts`, `write-rally-conversion.mts` | Wired through `prepareImportImage`. |
| `client-web-image-preparation.mts` | Owner decision: nothing is removed. A JPEG within the bound stays byte for byte, and any other web copy carries all metadata. |
| `write-joomla-content.mts` | **Not wired.** A re-run would publish GPS nobody has reviewed. It changes with the legacy re-upload. |

- **Point 2** no longer blocks wiring: a public JPEG that needs rotating is re-encoded upright.
  `npm run plan:legacy-image-reupload` over the Joomla image folder found orientation 1 in all
  25,843 readable JPEGs, so legacy sources are unaffected.
- **Point 3:** a public non-JPEG source keeps today's metadata-free derivative. No separate rule
  has been decided.
- **Point 5** is done for the rally paths. `docs/sanity-seeding.md` keeps its statement about the
  Joomla writer, because that is still true.
- **Point 6 is still open.** The report covers the whole folder, so its GPS list is far longer than
  what is published. It still has to be matched to published assets, and the owner's list of
  sensitive locations needs a way to remove location at upload. The re-upload itself needs a tool
  and an approved plan, and no CMS write has been made.
