# Revision-bound locale publication

AB#270 provides a narrow owner-run continuation for reviewed English category/service
copy and existing approved article editing drafts. It changes documents only: no assets,
ZIP transport, DNS, deployment promotion, translation generation or automatic retries.
The two commands are separate from CI and default tests never access a real CMS.

## Prepare and review

Capture a stable complete raw NDJSON baseline, including editing drafts, releases, assets
and system documents, using a read credential. Retain the matching local recovery receipt
and recovered asset bytes. Read [CMS recovery](cms-recovery-rehearsal.md) and
[publication locale census](publication-locale-census.md) before operating.
An English article cannot be planned until its canonical category and every ancestor have
published English label and slug values. A service requires its English parent first.

Keep the reviewed packet, baseline and plans in owner-private files (0600, no symlinks)
and an ignored directory. The output directory must be new. Review packets contain the
exact source revisions and English fields; they are not generic mutation files.

```bash
npm run plan:locale-publication -- \
  --kind category-services \
  --snapshot <private-current-raw.ndjson> \
  --review-packet <private-reviewed-copy.json> \
  --project <project-id> --dataset <dataset> --api-version <vYYYY-MM-DD> \
  --out <new-private-plan-directory>
```

Use `--kind articles` with the accepted article proposal packet for the second phase.
Category approval, five service counterparts and article publication are distinct
editorial facts. Creating drafts or matching source revisions is not publication approval.
Any approval refers to exact reviewed copy and a concrete plan digest; changed content,
revisions or target needs a rebuilt plan and appropriate approval. Existing approved poll
omissions remain omissions; this tool never supplies new text or translations.

## Provider validation and execution

Supply a dedicated, temporary document-writing token only through
`SANITY_LOCALIZATION_TOKEN`. Provision it only within the approved operation. Never place
a token in command arguments, a tracked file or a receipt. Creating a credential can change
system-document revisions: capture/recover the baseline and build the final plan after that
change instead of exempting system groups from the full baseline comparison.

```bash
npm run write:locale-publication -- \
  --kind category-services \
  --plan <private-plan-directory/plan.json> \
  --snapshot <private-current-raw.ndjson> \
  --review-packet <private-reviewed-copy.json> \
  --recovery-receipt <private-recovery/receipt.json> \
  --out <new-private-validation-directory>
```

The default sends the provider's `dryRun=true`; it validates without publishing. Only
`--apply --approved-digest <exact-plan-digest>` enables writes. The CLI rebuilds the plan
from its private inputs and refuses altered mutations. It compares the complete current
raw revision manifest before the operation and the source documents before each batch.
The recovery gate matches snapshot hash, document/asset counts and every recovered asset
identity/size/hash. It trusts the retained local recovery receipt; it does not rehash every
asset again, restore Content Lake or assert that provider restoration has been rehearsed.

Category locale fields are appended with a revision guard. New services use strict create,
never replacement. Each article and its complete end-gallery placement set are one atomic
transaction: guarded draft patches, strict published creates and editing-draft deletes.
Only approved text review markers are cleared, and only placement parent references are
strengthened. Finnish source guards write their existing language/order values unchanged;
Sanity may advance their revision/update metadata. Authored Finnish content and media stay
equivalent. Operator limits (50 batches, 500 mutations and 2 MiB per batch, 16 MiB read
responses) are conservative bounds, not claimed provider entitlements.

The implementation uses the documented [Mutation API](https://www.sanity.io/docs/http-reference/mutation),
with `visibility=sync`, strict `create` and `dryRun`; it introduces no Actions API or SDK
dependency. A low-level mutation does not perform Studio's interactive schema validation:
the planner deliberately accepts only this bounded reviewed content shape.

## Readback, interruption and completion

Each applied batch reads back exact authored content and verifies deletion of the editing
drafts. Before submission it persists a private intent; per-batch receipts record success,
refusal/ambiguous submission or failed post-write readback without raw upstream responses.
Never replay an ambiguous request. Inspect the raw dataset, reconcile completed batches and
build a new revision-bound plan for any remaining work. The overall operation is not atomic
across articles; the receipt never authorizes a retry or automatic rollback.

After category/service publication, take a fresh complete snapshot/recovery baseline and
plan the articles against the actual published category. An offline simulated category
cannot stand in for that live baseline. After all writes, independently capture and compare
the complete raw dataset, rerun the public locale census, test actual same-language routes,
canonical metadata, body/gallery rendering and delivery hooks. Check unrelated fields,
media and placement coverage, not just title counts. Revoke the dedicated writer in a
`finally` cleanup and prove the revoked credential is refused; preserve the credential ID
and sanitized evidence privately.

The operator's receipt explicitly leaves full-dataset audit, writer revocation and launch
approval false. Its success alone does not close AB#255, AB#137 or the publication gate.
The final deployed source, provider rollback, security/privacy acceptance and supported
whole-ZIP delivery remain separate release requirements.
