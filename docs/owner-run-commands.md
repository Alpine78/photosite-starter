# Operational and owner-run commands

Moved verbatim from `AGENTS.md` "Commands" (AB#381). Commands marked owner-run are
run by the owner, or with the owner's explicit authorization for that run; the
annotations below are part of each command's contract (dry-run defaults, read-only,
never writes CMS). Read the command's own documentation before running or changing it.

```bash
npm run verify:preview -- <url> <dpl_id> # assert ownership, protection, and noindex
npm run client-gallery:zip -- --input <private.json> --output <new-private-dir> [--apply --approved-digest <sha256>] # owner-run: verify existing whole ZIP against actual private JPEG/metadata/set audits and complete anonymous remote hashes; dry-run default, one guarded draft-only attach/replace/detach, no uploads/publication/deletes; docs/client-gallery-zip.md
npm run verify:client-gallery-cleanup-readiness # owner-run: explicit opt-in + private target/canary manifest; bounded GET-only export/Doc reads, never writes or enables deletion; docs/client-gallery-cleanup.md
npm run verify:legacy-redirects -- report [--csv] # AB#19: mapping report or pending review CSV; check <origin> [<canonical-origin>] probes a production build
npm run benchmark:keywords -- plan # AB#65 spike: fixture + query-strategy benchmark (owner-run for the live matrix)
npm run convert:joomla -- --source <articles.ndjson> --out <dir> # owner-run: convert legacy content, report only, never writes
npm run write:joomla -- --plan <import-plan.json> --image-root <dir> --out <dir> --approved-digest <hash> # owner-run: write an approved import plan to Sanity, dry-run by default
npm run plan:rally -- --folder <rally folder> --out <dir> # owner-run: plan a capture-sequence rally import offline, never writes
npm run plan:legacy-delivery -- --input <private.json> --image-root <dir> --backup <archive.zip> --out <dir> # owner-run: verify unchanged retained legacy sources offline; no CMS write
npm run write:rally -- --plan <plan.json> --folder <rally folder> --out <dir> --approved-digest <hash> # owner-run: write an approved rally plan to Sanity, dry-run by default
npm run plan:rally-conversion -- --gallery <contentId> --folder <renamed copy> --artifacts <dir> --out <dir> # owner-run: plan converting a published rally gallery, read-only
npm run write:rally-conversion -- --plan <plan.json> --folder <renamed copy> --out <dir> --approved-digest <hash> --backup-archive <path> # owner-run: write an approved rally gallery conversion to Sanity, dry-run by default
npm run fix:joomla-intro -- --out <dir> [--approved-digest <hash> --yes] # owner-run: move imported Joomla intros into listing-only leads, plan-only by default
npm run reconcile:joomla-intro -- --out <recovery-dir> --approved-digest <hash> # read-only diagnosis after an intro write; never retries CMS mutations
npm run reconcile:identities -- --map <map.json> --approval <approval.json> --baseline <original.ndjson> --snapshot <current.ndjson> --approved-digest <hash> --out <private-dir> # offline identity reconciliation; report only, never writes CMS
npm run plan:identity-changes -- --map <map.json> --approval <approval.json> --baseline <original.ndjson> --snapshot <current.ndjson> --approved-digest <hash> --out <private-dir> # offline revision-bound change batches; never writes CMS
npm run plan:article-end-sections -- --manifest <private.json> --snapshot <complete-raw.ndjson> --out <new-private-directory> # offline first-adoption evidence only; never writes CMS
npm run revalidate:article-end-sections -- --baseline-manifest <private.json> --baseline-snapshot <raw.ndjson> --baseline-digest <sha256> --current-manifest <private.json> --current-snapshot <raw.ndjson> --out <new-private-directory> # offline pre-write comparison only; never writes CMS
npm run admin:secret # owner-run: generate the private-gallery administrator credential (ADR-0015 §4)
npm run release:production -- stage | promote --receipt <03-staged.json> --confirm <dpl_id> # owner-run: staged Production release; stage never changes production, promote needs the passed receipt (AB#379)
```
