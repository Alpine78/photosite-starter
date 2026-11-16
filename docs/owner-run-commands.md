# Operational and owner-run commands

Moved verbatim from `AGENTS.md` "Commands" (AB#381). Commands marked owner-run are
run by the owner, or with the owner's explicit authorization for that run; the
annotations below are part of each command's contract (dry-run defaults, read-only,
never writes CMS). Read the command's own documentation before running or changing it.

Every command below that writes to Sanity reads its write token from the environment only
(never a flag), refuses to run while a `NEXT_PUBLIC_` copy of that token is set, and prints
`Sanity target: project …, dataset …, API version …` before its first request; check that
line before a write proceeds. The upload and multi-batch writers leave a partial-run record
when a run stops after it began writing: `partial-run.json` in the private `--out`
directory, or one `PARTIAL_RUN {…}` line on stderr for a command without one. It lists the
uploaded asset ids and the last completed batch for reconciling by hand; it is not a resume
file (AB#421).

```bash
npm run verify:preview -- <url> <dpl_id> # assert ownership, protection, and noindex
npm run client-gallery:zip -- --input <private.json> --output <new-private-dir> [--apply --approved-digest <sha256>] # owner-run: verify existing whole ZIP against actual private JPEG/metadata/set audits and complete anonymous remote hashes; dry-run default, one guarded draft-only attach/replace/detach, no uploads/publication/deletes; docs/client-gallery-zip.md
npm run verify:client-gallery-cleanup-readiness # owner-run: explicit opt-in + private target/canary manifest; bounded GET-only export/Doc reads, never writes or enables deletion; docs/client-gallery-cleanup.md
npm run verify:client-gallery-cleanup-rehearsal # owner-run: explicit prepare/run mode + private inputs; prepare is one export GET + generated local fixtures; separately authorized digest-bound run writes/deletes only exact synthetic preview targets, never activates Production; docs/client-gallery-cleanup-rehearsal.md
npm run verify:legacy-redirects -- report [--csv] # AB#19: mapping report or pending review CSV; check <origin> [<canonical-origin>] probes a production build
npm run benchmark:keywords -- plan # AB#65 spike: fixture + query-strategy benchmark (owner-run for the live matrix)
npm run benchmark:keywords -- seed|run|move|clean --project <id> --dataset <disposable> --api-version <v> [--yes] # owner-run: writes only `kwbench--` documents to a dedicated benchmark dataset; seed/move/clean are dry-run without --yes; SANITY_BENCHMARK_TOKEN; docs/keyword-query-benchmark.md
npm run seed:sanity -- --project <id> --dataset <name> --api-version <v> [--yes [--prune-stale] | --delete-all --yes] # owner-run: write the demo fixture set and its six demo photographs; dry-run by default, no network request; --delete-all removes every seed-owned document; SANITY_SEED_TOKEN; docs/sanity-seeding.md
npm run write:services -- --plan <service-write-plan.json> [--approved-digest <sha256> --yes] # owner-run: create-only (createIfNotExists) write of an approved service plan; dry-run by default, no network request; SANITY_MIGRATION_TOKEN; docs/sanity-seeding.md
npm run write:categories -- --plan <category-write-plan.json> [--approved-digest <sha256> --yes] # owner-run: create-only write of an approved category tree fragment in dependency order; dry-run by default, no network request; SANITY_MIGRATION_TOKEN; docs/sanity-seeding.md
npm run write:foundation -- --plan <foundation-write-plan.json> [--approved-digest <sha256> --yes] # owner-run: create-only write of the site-settings and home-page singletons; dry-run by default, no network request; SANITY_MIGRATION_TOKEN; docs/sanity-seeding.md
npm run create:localized-draft -- --content-id <id> --from <language> --to <language> [--yes] # owner-run: read-only dry run by default; --yes creates the linked target-language drafts in one strict-create transaction and never edits the source; SANITY_LOCALIZATION_TOKEN + SITE_LOCALE_ROUTES; docs/localized-draft-action-plan.md
npm run recompute:shuffled-order -- --gallery <contentId> --language <lang> [--yes] # owner-run: reads and prints the plan by default; --yes patches the published placements' shuffled keys under revision guards; SANITY_SEED_TOKEN for --yes; docs/sanity-seeding.md
npm run write:locale-publication -- --kind category-services|articles --plan <plan.json> --snapshot <raw.ndjson> --review-packet <reviewed.json> --recovery-receipt <receipt.json> --out <new-private-dir> [--apply --approved-digest <sha256>] # owner-run: provider dryRun=true by default; --apply publishes the approved, rebuilt plan's guarded transactions with per-transaction private receipts; SANITY_LOCALIZATION_TOKEN; docs/locale-publication.md
node scripts/write-reviewed-content-plan.mts --plan <private-plan.json> [--approved-digest <sha256> --out <private-recovery-dir> --yes] # owner-run: revision-guarded small content correction (AB#297); dry run reads no credential; SANITY_MIGRATION_TOKEN; docs/sanity-seeding.md
npm run verify:cms-publication -- plan|apply|restore|reconcile … # owner-run: offline plans by default; apply/restore --yes sends one approved revision-guarded request, reconcile is read-only; SANITY_PUBLICATION_TOKEN / SANITY_AUDIT_TOKEN; docs/cache-revalidation.md
npm run convert:joomla -- --source <articles.ndjson> --out <dir> # owner-run: convert legacy content, report only, never writes
npm run write:joomla -- --plan <import-plan.json> --image-root <dir> --out <dir> --approved-digest <hash> # owner-run: write an approved import plan to Sanity, dry-run by default
npm run sync:keywords -- --out <new-private-dir> [--imports <fields.json>] [--set-discoverable] [--approved-digest <hash> --yes] # owner-run: re-derive media keywords and closures (AB#69), dry-run by default, no upload; see docs/keyword-sync.md
npm run plan:rally -- --folder <rally folder> --out <dir> # owner-run: plan a capture-sequence rally import offline, never writes
npm run plan:legacy-delivery -- --input <private.json> --image-root <dir> --backup <archive.zip> --out <dir> # owner-run: verify unchanged retained legacy sources offline; no CMS write
npm run plan:legacy-image-reupload -- --image-root <dir> --out <new-private-dir> [--asset-plans <dir> --published <media.json>] # owner-run: AB#391 report on legacy source images (action, GPS, keywords, postal address), and by published medium with the two options; reads local files only, never writes CMS
npm run write:legacy-image-reupload -- --plan <published.json> --image-root <dir> --out <new-private-dir> [--sensitive <list>] [--delete-replaced] [--approved-digest <hash> --yes] # owner-run: replace public assets from their sources under ADR-0039 decision 8, dry-run by default; see docs/legacy-image-reupload.md
npm run write:rally -- --plan <plan.json> --folder <rally folder> --out <dir> --approved-digest <hash> # owner-run: write an approved rally plan to Sanity, dry-run by default
npm run plan:rally-conversion -- --gallery <contentId> --folder <renamed copy> --artifacts <dir> --out <dir> # owner-run: plan converting a published rally gallery, read-only
npm run write:rally-conversion -- --plan <plan.json> --folder <renamed copy> --out <dir> --approved-digest <hash> --backup-archive <path> # owner-run: write an approved rally gallery conversion to Sanity, dry-run by default
npm run fix:joomla-intro -- --out <dir> [--approved-digest <hash> --yes] # owner-run: move imported Joomla intros into listing-only leads, plan-only by default
npm run reconcile:joomla-intro -- --out <recovery-dir> --approved-digest <hash> # read-only diagnosis after an intro write; never retries CMS mutations
npm run reconcile:identities -- --map <map.json> --approval <approval.json> --baseline <original.ndjson> --snapshot <current.ndjson> --approved-digest <hash> --out <private-dir> # offline identity reconciliation; report only, never writes CMS
npm run plan:identity-changes -- --map <map.json> --approval <approval.json> --baseline <original.ndjson> --snapshot <current.ndjson> --approved-digest <hash> --out <private-dir> # offline revision-bound change batches; never writes CMS
npm run plan:article-end-sections -- --manifest <private.json> --snapshot <complete-raw.ndjson> --out <new-private-directory> # offline first-adoption evidence only; never writes CMS
npm run revalidate:article-end-sections -- --baseline-manifest <private.json> --baseline-snapshot <raw.ndjson> --baseline-digest <sha256> --current-manifest <private.json> --current-snapshot <raw.ndjson> --out <new-private-directory> # offline pre-write comparison only; never writes CMS
npm run release:production -- stage | promote --receipt <03-staged.json> --confirm <dpl_id> # owner-run: staged Production release; stage never changes production, promote needs the passed receipt (AB#379)
```
