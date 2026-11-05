# Keyword sync

**Audience:** the owner running `npm run sync:keywords`. **Work item:** AB#69. **Decisions:**
[ADR-0039](adr/0039-keyword-taxonomy-and-ingest-boundary.md) decisions 2 and 3.

The command re-derives each medium's `keywords` and `expandedKeywordIds`, and its private `keywordRecord.<mediaId>`, from current data. It
uploads nothing and changes no asset URL. A medium is identified by its `mediaId`, never by a filename or CDN URL.

## Two uses

| Use | Input | What it does |
| --- | --- | --- |
| **Import** | `--imports <fields.json>`, an object of `mediaId` → ExifTool `-G1` fields | Maps the new terms and keeps the editor's additions and removals. |
| **Re-sync** | none | Re-maps every medium from its stored import, after a parent move, merge or retirement. Acknowledges the taxonomy version only if nothing failed. |

A keyword the site has moved stays on a medium already holding it, whichever use this is: the closure follows the new hierarchy, and the old path goes to review so that an editor can settle it with a whole-path alias.

`--set-discoverable` also opts the imported media in to keyword galleries (ADR-0012 §2). It is off by default, and it never applies to a client
delivery. Building the fields file from local exports belongs to the import path, once AB#391's metadata tool has landed.

## Running it

```bash
npm run sync:keywords -- --out temp/keyword-sync/run-1                                  # reads and reports only
npm run sync:keywords -- --out temp/keyword-sync/run-2 --approved-digest <hash> --yes   # writes exactly that plan
```

The token is `SANITY_MIGRATION_TOKEN`, from the environment, with `SANITY_PROJECT_ID`, `SANITY_DATASET` and `SANITY_API_VERSION`. The report is private,
because a review item can hold anything a photographer typed. The console prints counts only. Try it on the `preview` dataset first.

## What protects a run

- **The digest** covers every mutation and its revision guard, the taxonomy version and publication sequence, and whether the run acknowledges that version. An approval therefore names exactly one state of the data, and anything changing since then fails it. The clock is left out, so a dry run's digest still holds an hour later.
- **Every document is revision-guarded.** A draft is patched with its published document, because publishing a stale draft would undo the sync.
- **Every batch of 50 media is one transaction that also advances `keywordTaxonomyState`,** the guard Studio's keyword publication takes, so the two conflict rather than interleave.
- **A medium whose keywords change also guards its record,** because the keywords come from the record's overrides.
- **A conflict stops the run with exit code 3.** Run the dry run again: what was written is found unchanged and skipped, so resuming repeats nothing.
- **A publication during the run stops it, also with exit code 3,** because the plan rests on the older vocabulary. That covers a new keyword or alias, which leave the taxonomy version alone.
- **A re-sync reads everything again before it acknowledges the taxonomy version.** A draft or release version created during the run leaves every revision guard intact, so if that read finds anything left to do, the run ends as `not-settled` with exit code 3 and the version stays open. Run it again. One created after that read is not detected.
- **A run that skipped any medium exits 1,** after writing the others and the report. Exit code 2 is an error before or outside the run.

## What it refuses, per medium

The report lists these as `failed`, and the others continue. A full re-sync with any failure does not acknowledge the taxonomy version.

| Code | Meaning |
| --- | --- |
| `RELEASE_VERSION_EXISTS` | A Content Release holds a version, which would undo the sync when released. |
| `KEYWORDS_WITHOUT_RECORD` | Keywords with no record have no known source, and deriving from nothing would remove them. |
| `RECORD_MALFORMED` | The stored import or a reference on the record is not in the expected shape. |
| `IMPORT_UNREADABLE` | The fields for this medium hold an ExifTool error. Mapping that as "no keywords" would remove every imported keyword. |
| `MEDIA_ID_REPEATED` | Two documents claim one `mediaId`. Every claimant fails, because no order makes one of them right. |
| `VOCABULARY_REFERENCE_UNKNOWN` | An override names a keyword that does not exist. |

A broken vocabulary or damaged term decisions stop the whole plan. An import naming no medium is listed under `unmatchedImports`, never guessed. Terms that do not resolve go to `reviewItems` on
the private record, and Studio's **Keyword review** tool shows them (AB#70). A decision there reaches the photographs on the next sync.

## Term decisions

A flat term several keywords answer to, such as one name in two categories, stays ambiguous however many aliases it gets. An editor chooses in Studio's **Keyword review** tool, and the choice goes in the private document `keywordTermDecisions.current`. The sync reads it on every run, so a choice also covers later imports. It applies only while that keyword is still one of the term's options; otherwise the term returns to review.

## Budget

The budget for a 400-medium batch is 60 seconds. Planning it takes well under a second, and it writes eight transactions. AB#65's benchmark re-synced 3541 documents in about 15 s
on a real project. **This command itself has not run against a real dataset**, so the first run on `preview` should record the actual time here.
