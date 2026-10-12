# ADR-0031: Identity migration compatibility and operational plan

**Status:** Accepted
**Accepted scope:** Implementation policy only; operational approvals pending
**Date:** 2026-10-12
**Deciders:** Project owner (Ilkka Rytkönen)
**Work item:** AB#260

## Context

[Accepted ADR-0030](0030-legacy-identity-retirement.md) fixes the exact mapping of
1,541 domain identities and retains Sanity `_id`, `_ref` and document history.
It separately requires acceptance of implementation, compatibility/retention,
rehearsal and actual Production writing. On 2026-10-12 the owner explicitly
accepted the decision packet's first three implementation policies: “Hyväksyn nämä
toteutuskäytännöt”. This accepts permanent aliases and public-table readability,
legacy-writer retirement and the tested maintenance boundary for separately scoped
implementation. Named isolated targets, asset copies and actual Production
operations remain separately approved; neither policy acceptance nor merge permits
those operations.

### Verified observations

- AB#258's supplied raw snapshot matches the approved original snapshot byte for
  byte. That observation covers its recorded capture window, not the current CMS.
- AB#259's local plan covers 2,393 fields in 2,368 documents, grouped into 1,521
  indivisible groups and 48 batches at 50 documents per batch. The largest group
  has two documents. It is non-executable and never cutover-ready.
- The private map's minimal `field`/`oldId`/`newId` array is 202,328 UTF-8 bytes.
  No map rows or real identity values are reproduced in this repository.
- `enquiry-media.ts` authorizes a curated `contentId` against the locale's public
  tree before the source adapter. `sanity-enquiry-media.ts` then distinguishes
  placement IDs from capture-sequence media IDs. Dynamic media IDs are separate.
- Gallery and article-gallery continuation APIs resolve an existing page path.
  They do not expose a new arbitrary content-ID query interface.
- The Joomla writer still uses `createOrReplace` for non-media documents. Changing
  only a manifest's domain IDs can remint provider IDs; old plans can restore old
  fields. A migration guard, aliases and maintenance mechanism do not exist yet.

After the owner's explicit eight-checkout approval, private AB#257/258 data moved
to ignored `temp/worktree-retirement/20261012T104159Z/`, beneath the respective
original checkout names. All 16 input/evidence hashes checked for AB#259 match.
AB#259's three local output artifacts remain in its retained worktree. The archive
index and per-checkout receipts record preserved paths, metadata and data hashes;
all eight branch refs remain. No ignored local file was disposed of, including dependencies
and generated files. This is evidence preservation, not a verified dataset backup.

## Decision

### Accepted implementation policy

Use a bounded CMS alias table, permanent compatibility for the accepted
mapping, explicit legacy-import retirement, and a controlled public maintenance
window. Implement them in separately scoped slices under the recorded acceptance.
Keep the accepted mapping and normal Studio publication validators unchanged.

### 1. Alias data and reader generations

Use one operator-managed, published `identityAliasSet` document containing only
its format version, source-map digest and approved family/old/new triples.
The operational plan pins its exact provider ID/type and canonical payload
SHA-256. Deployment configuration pins the expected payload digest, accepted row
count and reader generation; CMS data cannot select a reader generation.

The number of rows must equal the accepted configuration (currently 1,541).
Apply a 256 KiB payload budget and the existing bounded identity grammar; neither
budget permits extra mappings. Require injective targets, disjoint old/new values,
known families, no chains, no duplicate rows and no additional authored fields.
Project the table through a server-only adapter, never into browser data or code.
Read/validate the bounded table once per configured cache generation, with an
explicit cache-invalidation contract. Do not issue one query per incoming ID.

**Public-dataset consequence:** server-only projection does not conceal a published
CMS table from direct dataset queries. The owner's acceptance covers that precise
ID-only disclosure. Include no titles, locators, source paths, revisions, snapshot
data, credentials or media internals. Dataset privacy also does not protect asset
CDN bytes; [the existing boundary](../sanity-setup.md#assets) remains in force.
Selecting a different storage policy requires a subsequent scoped decision;
implementation must not weaken this boundary.

Use the same immutable triples with three explicit reader modes:

| Deployment mode | Incoming mapped identities | Required configuration |
| --- | --- | --- |
| `legacy` | Existing old IDs pass through | Default for unaffected clones and before migration; aliases are unused |
| `renamed` | Old → new, in one lookup; new stays canonical | Exact pinned alias payload must exist and validate |
| `restored` | New → old, in one lookup; old stays canonical | Same pinned payload; supports links observed before a rollback |

Missing or malformed expected configuration is a classified content/configuration
failure, never silent identity fallback. Unknown IDs still face existing source
resolution and rejection. Keep aliases indefinitely; removal or extension needs
a later explicit decision. This retains historical strings as technical data,
without retaining a Joomla runtime or renaming identities after title/URL edits.

Validate request shape, multiplicity, grammar and full route locale first.
For curated enquiries, translate the content identity before public-tree container
authorization. Translate an occurrence only after identifying a placement-based
container. Dynamic and capture-sequence `mediaId` values never pass through the
placement lookup. The target still must belong to that container/language, be
visible, and satisfy existing media/enquiry eligibility checks. An alias grants
neither access nor eligibility and creates no missing translation.

Apply equivalent occurrence resolution to existing `?enquire=` page handling;
preserve its current cursor/section conflict rejection. Do not add permissive API
parameters or weaken canonical path resolution. Category/end-gallery mappings
are available only at established typed identity seams, not new public endpoints.
Do not translate authenticated cursor scopes or boundaries: old tokens retain
stale/mismatched 404 and restart behavior. Bare legacy numeric lightbox parameters
and pathname redirects retain ADR-0003/AB#19 policy. Slugs and public paths do not
change because of this job.

### 2. Retire legacy writers before domain updates

Disable legacy live import/recovery entrypoints on a migrated target,
instead of adapting every historical full-replacement plan. A generic operational
guard record holds only migration state and accepted digests, no legacy ID strings.
Its exact provider ID/type and admissible fields are separately approved additions;
it is outside the 2,368 mapped documents. New guard-aware tooling checks it fresh
on the actual target before mutations. A present prepared/renamed/restored guard
blocks legacy imports; malformed data or failed reads fail closed. `--yes` does
not bypass it. Unaffected clones retain their existing behavior.

Inventory all write paths, including seed, Joomla/category/foundation/service,
rally import/conversion, intro recovery, ordering jobs, Studio sessions, scheduled
publishes/releases, runtime poll writes and old Preview deployments. Stop or retire
the relevant jobs and rotate/revoke old write credentials under a separately
accepted operator plan. An application guard is not an ACL: an old binary or direct
Editor credential can ignore it. Verify actual role scope and remaining writers;
do not assume document-scoped roles or a provider-wide read-only switch.

The freeze therefore needs an owner-controlled writer inventory, agreed suspension
or credential action and repeated full revision-index checks. Procedural suspension
alone retains a concurrent-writer risk. Do not start while uncontrolled writers
remain. Policy acceptance authorizes no immediate credential action.

Historical manifests, approval files and backups remain unchanged. Future recovery
uses a new approved generation that binds both the domain map and retained provider
identities; it may not generate `_id` from a renamed `content_id`. Leaving the guard
after rollback is intentional: old imports stay blocked. Lifting it needs a new
owner-reviewed recovery decision, not removal during an error-handling routine.

### 3. Bind source, restored target and writer receipts

The future job manifest binds the original map/baseline approval, current accepted
source delta, target project/dataset, raw snapshot, code version, fixed batch
digests, reader/guard/alias plans and operational approval. Checksums establish
integrity, not owner identity or permission. Private records stay 0700/0600 and
outside Git. Log only counts, digests, batch identifiers and static error classes.

Keep original source `expectedRevision` values as history. If fresh source edits
or a restored target have different revisions, AB#258/259 must report/refuse that
drift as they do now. A **separately reviewed operational target plan** binds source
and observed target revisions while retaining the exact approved field pairs and
document IDs. Never edit the original map or silently refresh its guards. Review
authored-value deltas too, including AB#255 drafts; added affected variants or
occurrences require explicit renewed scope/treatment acceptance.

Restore equivalence must distinguish provider revisions/update metadata and any
target-specific asset-location metadata from authored values. Inventory and approve
each provider-location difference explicitly. Keep references, `_key`, slugs,
language, media/ordering/visibility and every other authored value intact. Compare
asset bytes and intrinsic dimensions independently; do not normalize metadata away
to make a failed byte comparison pass. A no-upload domain rewrite is distinct from
a separately accepted binary restore.

For each approved group/batch, the future writer verifies fresh raw fields,
untouched-value hashes and target revisions, then submits only listed top-level
sets at retained `_id` with `ifRevisionID`. No replacements, deletes, asset uploads,
draft publication or schema relaxation. Preserve AB#259's complete group boundaries
and document/byte limits. One transaction is atomic; a multi-batch job is not.
Sanity queries can lag a committed transaction; see
[transactions and revision guards](https://www.sanity.io/docs/content-lake/transactions).

Durably record intent before submission. Validate the returned affected IDs,
transaction identity and post-write documents/revisions, and persist a result
receipt bound to the job and batch. Use returned documents where supported, then
verify raw read-back with bounded retries; no successful HTTP response or polling
timeout alone establishes a verified cutover. The future transport must verify
the pinned [mutation API](https://www.sanity.io/docs/http-reference/mutation) contract.

Resume classification is separate from the existing strict prewrite tools:

| State | Required evidence | Action |
| --- | --- | --- |
| Untouched | Original target revision and all selected before values match | May apply the approved batch |
| Completed | Verified receipt, exact post-write revision, after values and untouched hashes match | Skip that completed batch |
| Already rolled back | Verified rollback receipt and its resulting revision/values match | Do not infer another write from old values alone |
| Mixed, edited, missing or otherwise conflicting | Any mismatch or new affected variant | Stop for review |
| Submission outcome unknown | Missing/unverified acknowledgement or receipt | Quarantine; never infer completion merely from after values or blindly resubmit |

For an unknown outcome, the operator may recover a receipt only from independently
verified transaction/revision evidence, using provider history and trusted local
intent records where available. If that cannot establish the exact result, stop
for a new approved recovery checkpoint. Actual history access/retention and the
plan tier remain unverified prerequisites. Request tags or a local batch digest
are not assumed to give provider idempotency.

Rollback changes only selected fields in reverse verified batch order, guarded by
recorded **post-write** revisions. Validate restored values, untouched hashes and
new rollback revisions; record partial/completed/conflicting rollback states.
Preserve unrelated later records and the settings draft. Apply guard/alias record
changes only against their separate verified revisions. Keep the alias payload
and activate `restored` mode before reopening, so newly observed IDs remain useful.
If rollback precedes alias creation, provision and verify the separately approved
payload during recovery first. If its creation failed or has an unknown outcome,
resolve that configuration step with verified receipts or an approved checkpoint;
keep maintenance active until the required payload is available. Do not select
`restored` against a missing table or silently fall back to `legacy` after domain
updates may have exposed new IDs. An abort before any domain submission may retain
`legacy` only after verifying the complete unchanged old state.
After public reopening/editorial resumption, the original rollback is no longer
presumed safe: concurrent edits require a forward fix or a new approved window.

### 4. Rehearsal and Production sequence

Owner approval must name an isolated target and its existing contents, credentials,
actual privacy and outbound-effect controls. Never default a rehearsal to Production
or overwrite an occupied target. Take a current full document-and-binary backup;
inventory hashes and verify restore before mapping. An old export or a local worktree
archive proves neither completeness nor restore success. Provider restores may
rehost asset bytes at publicly accessible URLs even with private document reads;
accept that separately or choose a different target/restore approach.

Rehearse apply, interrupted batches, revision conflicts, partial fields, new
draft/release variants, lost acknowledgement, missing receipts, query lag and
selective rollback. Measure apply/read-back/rollback time before choosing a window.
Repeat the following complete comparisons on the restored copy and on the frozen
cutover data; selected-image spot checks are insufficient:

| Comparison | Pass condition |
| --- | --- |
| Documents/references | Exact retained IDs, `_ref`/`_key`, variant inventory and accepted unrelated-record delta; all required references resolve |
| Locale/routes | Same public paths, visibility/expiry, missing-language behavior, navigation, metadata, sitemap and legacy redirect destinations |
| Ordering | Same complete logical occurrence sequences after mapping, including tied ID sorts, all five listing/category groups and all 27 observed containers; recompute evidence if scope changes |
| Seeded/capture sequence | Fresh inventory confirms affected ordering modes; any seeded or tied-order change needs its own approved calculation, media/section identity stays intact |
| Media/legacy delivery | Identical source binaries/embedded metadata, references, true dimensions and full frames; same retained JPEG/ZIP links and expiry behavior |
| Compatibility | Old/new enquiries, locale/multiplicity/conflict rejection, hidden/ineligible/wrong-container rejection and stale cursor 404/restart |
| Recovery | Interrupted/unknown outcomes cannot auto-succeed; guarded rollback preserves unrelated state, and `restored` reader works with both ID spellings |

[ADR-0028](0028-legacy-unlisted-gallery-continuity.md) remains limited to 21 retained
galleries. No new gallery exposure, camera masters, private/sales reclassification,
download control or ZIP transport resolution follows from rehearsal. Any new
public copy of retained JPEG/ZIP bytes requires a separately accepted scoped
decision; do not assume the existing-storage exception covers it. Direct file/CDN
URLs and previously cached bytes do not become private during page maintenance.

Implement a measured public maintenance boundary with a provisional **15-minute
target budget**. The actual window is accepted after rehearsal. Reserve measured rollback/verification
time; stop starting new batches before that reserve is consumed. A 503 with
`no-store`, `Retry-After: 60` and existing security headers should gate public pages
and APIs, including poll writes, without disclosing internal state. It must cover
warmed caches, routing variants and existing clients; no untrusted bypass header.
Verify this in a production build and at the actual host before using it. No such
gate exists now. Source CMS/CDN access is outside the application's gate.

Use this ordering only under a future, separately approved freeze and cutover window:

1. Suspend the inventoried writers/schedules; provision the separately approved
   guard. Export fresh complete raw data and stable revision indexes. AB#258/259
   may consume a guard-bearing snapshot as an unrelated added-record diagnostic
   when its identity-free content is valid; their mapped-field blockers remain.
   They must still refuse drift/unknown consumers, not special-case an arbitrary
   marker. Review any delta and approve the operational target plan before writing.
2. Verify the maintenance boundary is active, including old deployed clients and
   Preview/runtime write paths; arm no public renamed reader yet. Re-read the
   complete raw revision index after activation and require equality with the
   accepted frozen snapshot. Any mismatch stops for delta review; never refresh
   the target plan's guards silently.
3. Apply the approved domain batches and receipts. Verify complete new-ID data,
   references, order/routes and media invariants before compatibility activation.
4. Create/verify the separately approved immutable alias record. Its exact old-ID
   entry paths are intentional consumers admitted only by the future specialized,
   receipt-bound verifier; all other unknown consumers remain blockers. Do not
   modify AB#258/259 into permissive post-write resume tools.
5. Verify a protected, `noindex`, side-effect-free candidate reader in `renamed`
   mode with the pinned digest. Test old/new inputs, fresh pages and failed stale
   cursors. Coordinate webhook fan-out and explicit all-public cache invalidation;
   automatic per-batch webhook delivery is not evidence of one coherent generation.
6. Go/no-go checkpoint: exact inventory and receipts, complete comparisons,
   compatibility, cache freshness, remaining time and recovery evidence all pass.
   Activate the matching Production reader/cache generation while maintenance
   remains active, verify it, then reopen and resume only the accepted writers.

If the budget or a guard fails, stop new work and perform verified guarded rollback
where possible. An unknown outcome/conflict can exceed the target budget: keep
maintenance active, inform the owner and use the approved recovery procedure.
Never reopen an incoherent dataset to satisfy a deadline. Gate and operational
record transitions also need receipts; do not restore an old deployment against
new data before verified rollback and `restored` reader activation.

## Options Considered

| Choice | Benefit | Cost / selection |
| --- | --- | --- |
| CMS alias document, all accepted families | Existing content provider; no site-specific map compiled into generic code | Published-table readability explicitly accepted; selected |
| Deployment-owned server artifact | Avoids anonymous CMS-table readability | Requires an explicit artifact-staging/build/tracing design and equivalent digest validation; credible alternative |
| Only content/placement aliases | Covers observed direct enquiry ID inputs | 1,509 rows; excludes 32 category/end-gallery identities and needs a typed-consumer audit/acceptance |
| No aliases or time-limited aliases | Smallest implementation or later cleanup | External old links/messages have not been shown absent; requires explicit accepted compatibility loss |
| Maintenance window | Keeps partial multi-batch data away from public app readers | Tested gate accepted for implementation; actual outage remains separately approved |
| Dual-generation live projection | Can avoid a public outage | Larger temporary read/query/cache contract; not justified for this one-time job |
| Disable legacy writers on migrated targets | Stops replay of old replacement plans | Selected; new recovery generation needed |
| Adapt all old writers/manifests | Preserves old tooling entrypoints | Broad retained-ID mapping and approval changes across several tools |

A host-level maintenance mechanism is an alternative only after its capabilities,
cache/API coverage and rollback behavior have been verified; none is assumed here.

## Trade-off Analysis

The accepted policy plans one short outage and two separately accepted operational
CMS records to avoid a general dual-identity migration framework. Permanent aliases
cost one bounded table and avoid guessing whether old enquiry links were shared.
Reverse resolution in `restored` mode protects new links even if they were observed
through direct CMS access before reopening. These mechanisms preserve request
authorization, not hide public data or replace provider permissions.

Freeze, restore equivalence and durable receipt recovery are implementation and
operational obligations. Approving their design cannot establish that they work.
Changing the exact map, adding affected occurrences or extending legacy-delivery
exposure still needs renewed acceptance under the governing decisions.

## Consequences

### Implementation gaps

All runtime mechanisms here remain unimplemented: alias schema/adapter/configuration,
legacy-write guards, the maintenance boundary, operational target-plan generator,
writer/receipt/resume/rollback transport and complete rehearsal verification.
AB#258/259 remain useful strict offline inputs, not a migration-ready writer.
No dataset target, full backup, freeze, restore or Production window is accepted.
Deployed architecture diagrams remain unchanged because no boundary was implemented.

### Owner decision packet

Review this section as the concrete approval packet, distinct from authorizing
an operation. The first three policies were **accepted on 2026-10-12** by the
owner's explicit reply quoted above. The last two operational approvals remain
**pending**.

| Decision | Recommendation | What acceptance would allow |
| --- | --- | --- |
| Compatibility — Accepted | All 1,541 aliases indefinitely; CMS ID-only table with deployment-pinned digest and three reader modes | Separately scoped implementation; published-table readability accepted |
| Legacy tooling — Accepted | Guard migrated targets, retire old replacement writers/credentials/schedules; new recovery generation | Separately scoped guard/recovery implementation, not immediate revocation |
| Rollout — Accepted | Tested maintenance boundary; provisional 15-minute target with measured recovery reserve | Separately scoped gate/writer/receipt implementation, not a window or write |
| Isolated rehearsal | Name target, inventory, outbound controls and exact acceptable asset-copy accessibility | Only the separately approved restore/rehearsal run after its tooling/evidence is ready |
| Production | Fresh source/delta approval, code/reader/cache versions, named window, backup/restore proof and verified rehearsal receipts | Only that exact cutover; never a blanket write permission |

Acceptance of the first three policies unlocks separately scoped implementation
stories while target selection and actual operations remain pending. A later
alternative requires a dated scoped amendment or superseding decision; do not
silently rewrite this accepted history.

## Action Items

- [x] Record owner acceptance of compatibility, retirement and rollout implementation policy (2026-10-12).
- [ ] Implement and review the bounded alias reader, legacy-write guard and maintenance gate.
- [ ] Implement operational target plans and revision/receipt-bound apply/resume/rollback.
- [ ] Name/approve the isolated target, binary restore accessibility and complete rehearsal.
- [ ] Approve the frozen current generation and exact Production window only after evidence passes.
