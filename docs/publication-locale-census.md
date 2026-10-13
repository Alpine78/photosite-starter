# Revision-bound publication census (AB#269)

`npm run audit:publication-locales` inspects an owner-private raw Sanity NDJSON
snapshot offline. It never writes CMS content, clears review metadata, translates
text or approves publication. Obtain a complete `raw` snapshot using the existing
read-only transport, checking the complete sorted `_id`/`_rev` manifest before,
during and after capture. An arbitrary supplied file cannot prove its own completeness.

```sh
mkdir -m 700 temp/publication-census
# Put the complete raw snapshot here, as a regular mode-600 snapshot.ndjson.
npm run audit:publication-locales -- \
  --snapshot temp/publication-census/snapshot.ndjson --languages fi,en \
  --out temp/publication-census/check-1
```

Input is owner-private and nonlinked; bounds are 256 MiB, 100,000 documents and
4 MiB per line. UTF-8, document identity/revision, duplicate IDs, configured language
syntax and content identities are validated before a report is written. Output
must be a new ignored private directory; files use mode 600, directories mode 700.
Exit 1 signals reported blockers or invalid input; valid blocker reports are kept.
Errors never echo authored text, raw JSON, credentials or filenames.

The report binds the exact snapshot SHA-256 and selected document revisions. It
uses `contentId` for articles/galleries, `serviceId` for services and `categoryId`
for shared categories. Published, editing-draft and release versions are separate.
Drafts/releases do not fill published language gaps. Distinct roots claiming one
identity are blockers, while a published document and its own draft are normal.
Categories require exactly one nonempty label and valid slug in the language.
Article/gallery canonical categories and every ancestor must be published with
that language's label/slug; missing references, cycles and paths deeper than the public five-level limit block.

Review diagnostics preserve pending-field **counts**, source mismatch and absent
review metadata; no authored body, pending text, notice prose or contact data is
projected. IDs and revisions stay in the private report; stdout has aggregate
counts and snapshot hash only. Copied draft text is not accepted translation, and
a census without observed gaps still cannot authorize publication. The command
does not check every schema/route, placement, media text, restricted-page UI,
editorial quality or owner decision. General image text authoring remains deferred.

Before any approved publication, recapture and compare revisions, finish owner
review and category prerequisites, then use the existing publication workflow.
Do not remove `localizationReview` to make the census green.
