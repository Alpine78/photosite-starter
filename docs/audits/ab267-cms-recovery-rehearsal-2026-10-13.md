# AB#267 — local recovery exercised, 2026-10-13

AB#267 moved New → Active before implementation under AB#18. The owner authorized
separate worktree commits, pushes and PRs. This slice changes offline tooling only.

The fresh authenticated GET-only raw capture completed at
`2026-10-13T14:15:58.754Z`; complete `_id`/`_rev` manifests matched before/after
paging. A retained wrapped official Sanity export plus thirteen preserved original
additions recovered all 17,609 current raw documents and 5,158 assets into a new
ignored mode-700 directory. Asset original bytes total **2,436,624,774**. All asset
sizes and SHA-1 identities matched, additions matched frozen SHA-256, and every
written asset plus the exact raw snapshot was re-read and SHA-256 verified.

The final implementation repeated the successful local run at `2026-10-13T14:44:22.197Z`:

| Bound evidence | SHA-256 |
| --- | --- |
| Retained backup archive | `5550b8fd50f115f51ea9a8ce8102929753c3322ffd102a7b667296b6ba32ea70` |
| Current raw snapshot | `379ff9e99232bd8ad73475b0bff62e5616b10b4aebfdd50a8de26140e9a879cc` |
| Current asset manifest | `de3f21b6ef4f940c6c1254823edb92a5e86edd3443701505d53e729fc78e3c8a` |

Detailed receipts and recovered customer/source bytes stay private and ignored;
none enter Git, default tests or CI artifacts. Inputs were not changed. The census
and recovery tools cannot prove completeness from a supplied snapshot alone; that
claim here comes from the separately retained live capture manifests.

Synthetic tests cover plain/wrapped recovery and output readback, additions,
corruption, missing/duplicate/unexpected assets, traversal, symbolic/hard links,
truncation, mismatched frozen hashes, source links, bounds and asset inventory.
Private IO tests cover permissions, Git visibility and evidence preservation.
Local lint, strict TypeScript, all 5,977 browser-free tests and a synthetic
production build passed. No public journey changed; the mandatory PR CI still
runs the full journey and Studio gates. Security self-review checked untrusted
input bounds, private evidence and fail-closed projection; no unresolved finding
remains in this slice. This is not final owner security/privacy acceptance. `tar@7.5.22` is now an explicit
dev-only parser dependency, retaining the already installed pinned dependency tree.

No CMS/provider restore, publication, credential, deployment, alias or DNS change
occurred. Provider recovery, candidate rollback and owner handoff remain open;
AB#18 remains Active and AB#118 remains New. AB#267 stays Active until reviewed
acceptance and merge. See [the operator contract](../cms-recovery-rehearsal.md).

The final root locked dependency audit reported zero vulnerabilities; declaring the
existing tar version changed no installed package or integrity.

Final stream review added deterministic incomplete-asset and synchronous gzip
expansion refusal cases. Parser errors now terminate active readers and never
wait for a drain event after a synchronous refusal. The complete tests, build
and real local recovery were repeated successfully after this correction.
The separate Studio audit still reports eight moderate findings in its existing
CLI dependency chain; this slice does not change or approve that tree.

Every recovery source stream now ends at the admitted opened-file size, including
archive hashing, parsing and original additions. A deterministic growing-file
case proves that appended bytes cannot expand work and revision/stat validation
refuses the changed source. Full gates and real recovery passed after this guard.
