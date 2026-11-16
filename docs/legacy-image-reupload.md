# Legacy image re-upload

**Audience:** the owner running the re-upload. **Work item:** AB#391. **Decision:**
[ADR-0039](adr/0039-keyword-taxonomy-and-ingest-boundary.md) decision 8.

The Joomla import stripped all metadata and re-encoded every public image. This replaces each public asset with one prepared from its source: a JPEG within 2048 px
keeps its image data, keywords and the creator's postal address go, and everything else stays, **GPS included**. A medium on the sensitive list also loses
its location. The media documents, their ids and every page stay; only `image.asset` moves, so the image's URL changes.

## Before you start

**Document and storage limits.** Every new asset is a new document, and old assets stay unless `--delete-replaced` removes them. On 2026-11-05 Production held 21,230 documents and about 2.44 GB of
image assets. The plan adds up to 5,218 assets and about 2.49 GB. Check these against the project's current plan: without deleting, this reaches 26,448 documents.

**What the CDN serves.** [AB#54](audits/ab54-lightroom-keyword-spike-2026-11-04.md) found that the ordinary image CDN serves neither the metadata nor the original bytes on the requests tested, so visitors of a
page do not receive what this restores. It stays in the stored original, for the features that read it.

## Steps

1. **Read the published media** (read-only), saving `[{_id, _rev, mediaId, assetRef}]`:

   ```groq
   *[_type == "media" && !(_id in path("drafts.**"))]{_id, _rev, mediaId, "assetRef": image.asset._ref}
   ```

2. **Build the plan.** It reads local files and writes private reports; it never contacts a provider.

   ```bash
   npm run plan:legacy-image-reupload -- --image-root <images> --out <new-dir> --asset-plans <folder of approved import plans> --published <media.json>
   ```

   A source reaches a medium only through the `assetRequirements` of the approved import plans and their SHA-256. `legacy-image-reupload-published.json` lists the planned media, the reason for each one skipped, and
   `gpsReview`: every planned medium whose source has a location.

3. **Review `gpsReview`** and write the sensitive list: one `mediaId` per line, `#` for a comment. A line naming no planned medium is refused.

4. **Dry run.** It prepares every file and uploads nothing. It reports each failure and the digest to approve.

   ```bash
   npm run write:legacy-image-reupload -- --plan <published.json> --image-root <images> --out <new-dir> --sensitive <list> [--delete-replaced]
   ```

5. **Write,** on the same inputs. Use `--approved-digest` from step 4, and `--delete-replaced` if step 4 had it, because the digest covers it.

   ```bash
   npm run write:legacy-image-reupload -- --plan <published.json> --image-root <images> --out <new-dir> --sensitive <list> [--delete-replaced] --approved-digest <hash> --yes
   ```

## What protects a run

- **The plan is checked first.** A row with no revision would become an unconditional patch, so it refuses the whole file.
- **The digest** covers each medium, its revision, the asset it replaces and its source hash, the sensitive list and `--delete-replaced`.
- **A sensitive file is read back in full** after its location is removed. A field that still names a place fails that medium.
- **The source is hashed again** before preparing, and each prepared file is checked: image data unchanged, nothing lost but what the rules remove.
- **Each medium is patched under the plan's revision,** so an edit since then stops the run (exit code 3) rather than being overwritten. Build a fresh plan and continue: uploading the same bytes yields the same asset, so a finished medium is skipped.
- **Uploaded dimensions must match** the prepared file. A mismatch fails that medium and moves nothing.
- **`--delete-replaced` is permanent.** It deletes each old asset right after its medium moves, and Sanity refuses one that something still refers to. A cached page can show a broken image until the webhook has expired it. An old URL elsewhere stops working.

The command exits 0 when everything went through, 1 when any medium failed or the run was interrupted, 2 on an error before the run, and 3 on a revision conflict.

**If an old asset could not be deleted,** the result file's `undeleted` lists it, and the run continues. A fresh plan knows only the new asset, so that list is the record: delete those ids once the cause has passed. A killed process leaves no result file. In that case, look for assets nothing refers to, and read the list before deleting anything, because it may also hold assets unrelated to this run:

```groq
*[_type == "sanity.imageAsset" && count(*[references(^._id)]) == 0]._id
```

## What it does not do

Media with no recorded source, and non-JPEG sources, keep the asset they have. `write:joomla` still strips metadata: this command is its successor for what is already published, and it stays that way because a re-run would publish GPS nobody reviewed. `--dataset` is not an option: the target comes from the environment, so set `SANITY_DATASET` deliberately.
