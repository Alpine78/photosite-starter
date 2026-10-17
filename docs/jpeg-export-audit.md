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
ADR-0035 remains Proposed. Whole-file transport, account capacity, a new public
file exception and actual publication remain separate owner decisions/checks.
