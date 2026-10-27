# Prepare client-gallery web images locally

AB#325 adds an explicit ordered batch around the one-image preparation from
AB#314. It prepares files for later owner review; it does not upload or publish
anything. Existing legacy JPEGs and whole delivery ZIPs are unchanged.

Create a private UTF-8 selection file with a final LF, for example:

```text
processed-web-images-v1
exports/first.jpg
exports/second.png
```

Each line selects one existing processed export relative to the source root.
The order is preserved. No folder scanning or wildcard expansion occurs.
JPEG, PNG, WebP and AVIF extensions are accepted case-insensitively, and decoded
format must agree with the extension. Names must use NFC Unicode; traversal,
empty path segments, control/format characters, glob characters and ambiguous
names are refused. Duplicate physical files are refused too.

Run with the pinned Node version:

```bash
node scripts/prepare-client-web-image-batch.mts \
  --selection /private/work/selection.txt \
  --root /private/work/processed \
  --out /private/work/prepared \
  --classification processed-exports
```

Inputs must be owner-owned regular single-link files with mode `0600`, inside
owner-owned `0700` directories, with no symlink path components. Files inside a
Git checkout must be ignored and untracked. The output parent must already be
private; the output directory must be new and outside the source root.

The output contains neutral `image-0001.jpg`, `image-0002.png`, … names and one
final `receipt.json`. The existing image converter preserves the complete frame,
normalizes orientation, never enlarges, limits the longest edge to 2048 pixels
and removes embedded metadata from the web version only. Sources remain byte
for byte unchanged. Each receipt entry records source/output bytes, SHA256,
format and true dimensions, without original names or metadata values.

Processing is sequential: at most one image is converted at a time, with local
reads and writes capped at 64 KiB. Limits are 256 selected images, 25 MB per input,
100 megapixels per decoded source, a 64 KiB selection and 1 GB each of aggregate
compressed input/output bytes. Native decoder memory and its cache are not a
constant-RSS promise. These are local engineering limits, not Sanity or product
limits. Very low file-descriptor limits may cause a closed local-IO refusal;
previously opened descriptors are closed before returning.

All selected source descriptors and their current path identities remain bound
until completion. Output identities, private modes and hashes are checked again
before and after the final receipt is written. A missing receipt means the batch
is incomplete. A handled interrupt or error removes only identity-matching files
created by that invocation, then the empty output directory. Foreign files and
replaced directories are retained. SIGINT/SIGTERM request cleanup without an
immediate exit; cancellation through final receipt verification removes that
receipt. SIGKILL cannot run cleanup. Local check-before-unlink races cannot be
made transactional with Node's path-based filesystem APIs; use an owner-private
workspace without concurrent writers.

Every receipt explicitly says no upload, publication, source eligibility or
metadata-suitability approval. Selecting and classifying a file does not prove
its provenance or authorize public distribution. Review the exact output set,
public-file policy, account capacity and publication workflow separately.
ADR-0035's ZIP media contract is accepted; this command approves neither a customer
batch nor its upload/publication.
