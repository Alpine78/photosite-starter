# Decode a selected JPEG export set locally

AB#327 adds full JPEG decoding evidence alongside the existing whole-ZIP builder
and container auditor. It does not create a ZIP, transform an image or authorize
an upload. Original JPEG and embedded metadata bytes stay unchanged.

Use the same private ordered selection as the whole-ZIP builder:

```text
processed-jpeg-selection-v1
exports/first.jpg
exports/second.jpeg
```

Run with the pinned Node version:

```bash
node scripts/verify-jpeg-exports.mts \
  --selection /private/work/selection.txt \
  --root /private/work/processed \
  --out /private/work/jpeg-audit \
  --classification processed-jpeg-exports
```

The selection is explicit: no scanning, globbing, extraction or automatic source
classification. Owner-owned `0700` directories and `0600` regular single-link
files are required, with no symlink components. Inputs and outputs inside a Git
checkout must be ignored and untracked. The output is a new private directory
outside the selected source root; an existing directory is never overwritten.

The tool reads and hashes the same bounded source bytes that it decodes. It
accepts a narrow single-image baseline, extended sequential or progressive DCT
JPEG envelope; checks segment boundaries and entropy-marker boundaries; refuses
concatenated images, trailing bytes, MPF multi-picture data and unsupported frame
profiles. APP payloads, including embedded thumbnails and ICC profiles, are
opaque to the envelope walker. The pinned Sharp decoder then decodes the complete
image data through a raw output pipeline with warnings treated as failures.
Header/decode dimensions and channel/byte counts must agree. Report dimensions
account for EXIF orientation, without exposing the tag or metadata values.

A successful decode proves that the contained image data can be decoded by this
pinned implementation. It cannot prove that optional progressive refinement
scans were intended, that export quality is final, or that the source is an
approved processed deliverable. Valid data is not proof of public suitability.
The owner still checks the exact source set and its embedded metadata.

Limits are 256 files, 25 MB per JPEG, 100 megapixels per image, 1 GB compressed
total and 64 KiB reads. Processing is sequential. Raw decoded pixels alone can
use up to 400 MB; progressive coefficient buffers and native caches add memory
and total process memory can exceed 1 GB at the pixel ceiling. This is a pixel
and IO bound, not a constant-RSS guarantee. Completed decode results retain only
technical dimensions, and per-operation cancellation listeners are removed.
A real isolated Node/GC regression exercises 96 sequential >1 MB source reads.

The audit has a shared 330-second operation budget and each native decode has a
30-second processing timeout. Native timeout starts at processing, excluding
libuv queue time, as documented by
[Sharp](https://sharp.pixelplumbing.com/api-output/#timeout). Cancellation does
not promise immediate interruption of native work or an OS filesystem operation;
all subsequent operations check the signal. Deadline and decode-timeout refusals
have their own closed codes. No provider call occurs.

`entries.tsv` contains neutral ordered names, byte counts and SHA256 hashes in
the same format as the whole-ZIP builder and auditor. It is observed evidence,
not independent intended-set approval. `receipt.json` is written last and always
states `readyToUpload: false` and `published: false`, with provenance, metadata
suitability, set approval and provider support unproven. There are no original
names, source paths or metadata values in either report or console output.

Selected input descriptors/current paths and report identities, hashes and modes
are checked through completion. A handled failure or interrupt cleans only
identity-matching files created by that invocation. Foreign files/replaced
directories stay intact. Missing receipt means incomplete output; SIGKILL can
leave residue. Local path check/unlink operations are not transactional: keep
the private workspace free of concurrent writers.

No legacy deadline/link, source file, existing ZIP, schema or runtime changes.
ADR-0035's general public ZIP media contract is accepted. Exact batch export/metadata
approval, whole-file transport, account capacity and actual publication remain
separate owner decisions/checks.

## Inventory metadata envelopes without reading their values (AB#344)

Before reviewing embedded metadata for a future whole-package delivery, the owner
can locate recognized metadata envelopes in the same explicit private JPEG set:

```bash
npm run inventory:jpeg-metadata-envelopes -- \
  --selection /private/work/selection.txt \
  --root /private/work/processed \
  --out /private/work/metadata-inventory \
  --classification processed-jpeg-exports
```

The private input/output rules above are shared with the decode command. This
command makes a **new** `0700` directory with only `0600` `entries.tsv` and
`receipt.json`. It reads at most 25 MB per file, 256 files and 1 GB of source
bytes, sequentially in at most 64 KiB reads, with the same 330-second operation
budget. It does not decode pixels or allocate raw image output; cancellation
still cannot promise immediate interruption of a synchronous scan or OS call.
The source-byte ceiling excludes ZIP overhead, so an accepted inventory does
not establish that the existing builder can package the set within its bounds.

The shared single-JPEG envelope walker follows segment lengths, scan boundaries,
stuffed entropy bytes, restarts and the final EOI. Metadata-like bytes inside
entropy or an embedded thumbnail are not separate marker segments. Truncated,
unsupported, multi-picture or trailing data is a refusal, never a clean result.
Full pixel-decoding evidence remains the separate AB#327 command above.

Each neutral image row has `headerSegments` and `payloadBytes` arrays in the
receipt's fixed `categories` order:

| Index | Category | What the count records |
| --- | --- | --- |
| 0 | `exifHeader` | APP1 with the complete standard Exif prefix |
| 1 | `xmpHeader` | APP1 with the standard XMP prefix |
| 2 | `extendedXmpHeader` | APP1 with the extended XMP prefix |
| 3 | `iccHeader` | APP2 with the ICC profile prefix |
| 4 | `photoshopHeader` | APP13 with the Photoshop resource prefix |
| 5 | `jfifHeader` | APP0 with the JFIF prefix |
| 6 | `jfxxHeader` | APP0 with the JFXX prefix |
| 7 | `adobeHeader` | APP14 with the Adobe prefix |
| 8 | `comment` | Every COM segment, including an empty comment |
| 9 | `otherApp` | Every other APP segment |

Counts are **segments**, not photographs or decoded metadata records. Repeated
ICC/extended-XMP chunks each count separately. Payload byte totals include the
prefix but exclude the marker and its two-byte length field. A prefix match
never validates the enclosed TIFF, XML, ICC profile or Photoshop resources,
reassembles chunks, or proves IPTC data exists. The exact fixed prefixes are
verified against the [Adobe SDK](https://github.com/adobe/XMP-Toolkit-SDK/blob/main/XMPFiles/source/FileHandlers/JPEG_Handler.cpp),
[libjpeg-turbo](https://github.com/libjpeg-turbo/libjpeg-turbo/blob/main/src/jdmarker.c)
and [ICC format guide](https://github.com/InternationalColorConsortium/iccDEV/blob/master/iccdev-mcp/docs/icc-format-guide.md).
Nonstandard Exif signatures and other vendor envelopes remain `otherApp`.

The tool never outputs metadata values, tag names, GPS/contact records, original
filenames or local paths. Zero recognized counts do **not** establish absence
of private information. Every receipt keeps `readyToUpload: false`,
`published: false`, opaque/unvalidated metadata and unproven suitability, intended
set approval, provenance, public-file permission and provider support.
`entries.tsv` binds the observed unchanged JPEG bytes in the same neutral ordered
format as the decoder and whole-ZIP builder; it is not independent approval.

No metadata is stripped, transformed, copied to a CMS or approved for exposure.
No ZIP is created, modified or split. This inventory does not satisfy AB#29's
metadata-exposure acceptance criterion; exact batch export/metadata approval and
upload authorization remain required under the accepted ADR-0035 media contract.
