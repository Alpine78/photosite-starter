# Lightroom keyword extraction spike — 2026-11-04

**Work item:** AB#54, Active, feeding AB#55 and
[ADR-0039](../adr/0039-keyword-taxonomy-and-ingest-boundary.md). **Result:** keywords and
hierarchy survive a Lightroom export and can be read locally before upload. Sanity keeps
them in the stored original, but its ordinary image CDN serves none of them. No production
code, schema or ingest changed. Three test assets were uploaded and deleted.

The photographs, verbatim field dumps and receipts stay in the git-ignored
`temp/ab54-evidence/` and `temp/Lightroom/`. This record names each file by its role and
replaces the one person keyword with `<person>`.

## Method

| Item | Value |
| --- | --- |
| Lightroom | `Adobe Photoshop Lightroom Classic 15.6 (Windows)`, from each file's `xmp:CreatorTool` |
| Operating environment | Windows 11 Pro, version 26H2, OS build 26300.9818, supplied by the owner |
| Exports read | 1920 px set (hierarchy option off), then 6240 × 4160 px set (hierarchy on) |
| Reader | ExifTool 13.60, command line and through `exiftool-vendored` 39.1.0 |
| Upload target | The reference project's `preview` dataset, API `v2026-06-24` |
| Upload request | `POST /assets/images/preview`, `content-type: image/jpeg`, no query parameters: the request `scripts/sanity-seed-http.mts` sends |
| Credential | The owner's Sanity CLI login through `sanity exec --with-user-token` |

### Export settings

From the owner's screenshots of the Lightroom Export dialog for the 6240 × 4160 px set. The
dialog shows a one-file export of the flat image, and the owner supplied it as the set's
settings.

| Section | Setting |
| --- | --- |
| Export location | Specific folder with a subfolder, Add to This Catalog off, Existing Files "Ask what to do" |
| File naming | Rename To off, extension Lowercase |
| File settings | JPEG, quality 60, Limit File Size off, sRGB IEC61966-2.1, 8 bits/component, HDR Output off |
| Content Credentials | Storage method "Don't include" |
| Image sizing | Resize to Fit off, resolution 240 ppi |
| Output sharpening | Sharpen for Screen, amount Standard |
| Metadata | Include "All Metadata", Remove Person Info off, Remove Location Info off, Write Keywords as Lightroom Hierarchy on |
| Watermarking | On, with the owner's own preset |
| Post-processing | After Export "Do nothing" |

All three files agree on what they can show: 6240 × 4160 px, 240 ppi, 8 bits and the sRGB
profile. Quality, sharpening and the watermark are not read from the files.

Earlier screenshots of the 1920 px set showed the same quality, colour space, Content
Credentials, sharpening, metadata, watermark and naming settings. That set differed in Resize
to Fit, with a long edge of 1920 px, and with Write Keywords as Lightroom Hierarchy off.

### Deviations from the acceptance criteria

- **Dataset, not project.** No separate non-production project exists. The owner accepted the
  `preview` dataset of the production project on 2026-11-04.
- **Uploaded files are copies.** The 6240 px exports exceed the 2048 px public bound, so each
  went through `generatePublicDerivative` and ExifTool then copied its metadata back:
  `-TagsFromFile <source> -all:all -unsafe`, then `-IPTC:CodedCharacterSet=UTF8`. This is the
  sequence ADR-0039 decision 8 describes for larger sources.

## Embedded keyword fields

| Role | `dc:subject` | `lr:hierarchicalSubject` | `lr:weightedFlatSubject` | IPTC Keywords |
| --- | --- | --- | --- | --- |
| Control | absent | absent | absent | absent |
| Flat | `Espanja`, `Fuengirola` | `Espanja`, `Fuengirola` | `Espanja`, `Fuengirola` | as `dc:subject` |
| Hierarchical | `Hyundai`, `<person>`, `WRC`, `moottoriurheilu`, `ralli`, `rally`, `urheilu` | `Hyundai`, `<person>`, `urheilu\|moottoriurheilu\|ralli\|WRC` | `WRC`, `ralli`, `moottoriurheilu`, `urheilu`, `Hyundai`, `<person>` | as `dc:subject` |

Findings:

- **`lr:hierarchicalSubject` exists only with the export option ticked.** It was absent from
  every file of the 1920 px set. Ticked, a keyword with parents is one pipe-separated path,
  root first; a keyword without parents is a single term.
- **`dc:subject` and IPTC Keywords flatten the hierarchy** into a sorted list that includes
  every ancestor, so they cannot show which terms are parents.
- **A Lightroom synonym is flat only.** `rally`, which the owner confirms is a synonym of
  `ralli`, appears in `dc:subject` and IPTC Keywords, but not in the path. With the option
  off it also appeared in `lr:weightedFlatSubject`; with it on, it did not.
- **`lr:weightedFlatSubject` also carries keywords**, and ADR-0039 did not list it for
  removal. On a test copy, removing only the three listed fields left the terms readable,
  while `inspectJpegImportFacts` reported `keywordMetadata: false`, because
  `scripts/image-import-metadata.mts` checks only `dc:subject`, `lr:hierarchicalSubject` and
  IPTC Keywords.
- **Vocabulary seeding (AC 5).** The JPEGs carry the exact format above, so no separate
  keyword-list export is needed. Reading the path needs the export option ticked.

## After upload

All three uploads returned 200. A later read of each asset document matched the upload
response.

| Asset document value | Origin |
| --- | --- |
| `metadata.dimensions`, `hasAlpha`, `isOpaque`, `size`, `mimeType`, `extension` | file-derived |
| `metadata.lqip`, `blurHash`, `thumbHash`, `palette` | generated |
| `sha1hash`, `assetId`, `path`, `url`, `uploadId`, `originalFilename` (hash-based, because the request sent no filename) | generated |
| `metadata.exif`, `metadata.location`, any keyword or IPTC/XMP value | absent |

Bytes fetched from the asset URL, parsed with ExifTool:

| Request | Authentication | Bytes compared with upload | Keywords, GPS, contact details |
| --- | --- | --- | --- |
| no parameters | none | smaller and different | absent |
| `?w=800` | none | resized | absent |
| `?dl=`, `?w=2048`, `?fm=jpg` | none | same size as no parameters | not parsed |
| `?q=100` | none | larger and different | not parsed |
| `?dlRaw=true` | none | 401 | none returned |
| `?dlRaw=true` | owner token | identical SHA-256 | present, including the path and GPS |

This matches the earlier evidence in
[`docs/sanity-setup.md`](../sanity-setup.md) and
[ADR-0011](../adr/0011-security-response-headers.md).

**What this does not establish:** the behaviour of requests with Sanity's `meta` upload
parameter, of transformations not listed above, or of `file`-type assets, which ADR-0028 and
AB#250 deliver directly.

## Consequences for AB#55 and AB#391

1. **Extract locally before upload.** Sanity's asset document offers no keywords, and the
   stored original needs a token. ADR-0039's extraction point stands.
2. **Decision 8's kept metadata does not reach visitors through the image CDN.** Neither do
   the original compressed bytes. Both exist only in the token-protected original, unless a
   file is delivered as a `file` asset. Knowing this, the owner decided on 2026-11-04 to do
   AB#391's re-upload of legacy public images. Its plan still needs approval before any CMS
   write.
3. **Removing keywords from uploads still matters**, because anyone with dataset access can
   fetch the original and a `file` asset is public.
4. **Add `lr:weightedFlatSubject` to removal and detection.** The detector should also stop
   flagging creator city and country, which the owner decided on 2026-11-04 may stay. Both
   belong to AB#391.
5. **Treat flat terms as evidence of a path, not as separate keywords.** A flat term that is
   part of a mapped path, or is a synonym, needs no review item of its own, or every import
   floods the review queue. AB#57 should settle this.
6. **Open question 4's default needed a rule.** A parentless keyword is a top-level term, so
   `Hyundai` and `<person>` would each have become a category. The owner decided on 2026-11-04
   that only a path of at least two levels proposes a category; other keywords go to one
   general category. The fields read carry no marker for a person, so the editor's review has
   to identify person keywords.
7. **Preserve the IPTC charset explicitly.** `-TagsFromFile -all:all` dropped
   `IPTC:CodedCharacterSet`, which leaves non-ASCII values such as a creator's name open to
   misreading. It also dropped the Photoshop thumbnail, the IPTC digest and `crs:Glow`.

## Dependency recommendation

Use **`exiftool-vendored`** as a `devDependency` used only by owner-run import scripts, never
in the application bundle. It read every field above identically to the command line and
made the precise edits on test copies with an unchanged SHA-256 image-data hash.

| Measure | Value |
| --- | --- |
| Wrapper | 39.1.0, MIT (`LICENSE`), Node 22 or newer; the project pins 24 |
| ExifTool | 13.60; the file says "same terms as Perl itself", so record it separately from the MIT wrapper in the asset inventory |
| Install on Linux | 30 MB and 7 packages, of which `exiftool-vendored.pl` is 22 MB; needs Perl (5.40.1 here) |
| Windows package | `exiftool-vendored.exe`, 34.6 MB unpacked by registry data; not installed or tested |
| Maintenance | 323 versions since 2016, latest 2026-10-28, repository not archived, one npm maintainer |

It is not yet added to the repository or the asset inventory; AB#391 does that when it
wires the tool in.

## Cleanup

The three assets were created by this run, had zero references and no pre-existing copies.
Each document was deleted and a read confirmed it gone. The dataset's image-asset count was 0
before and after. **The anonymous asset URLs still returned 200 straight after deletion**, so
cached processed copies can outlive the documents. Those responses carry no embedded
metadata, but show the pixels.

## Review

Codex reviewed the plan once before upload. It led to a single upload session, receipts
written straight after each request, a pre-existing-asset check, reading
`lr:weightedFlatSubject` and recording this report's limits. Its concern about publishing
creator city and country was closed by the owner's 2026-11-04 decision to keep them.
