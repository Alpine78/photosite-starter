# AB#268 — release source gate, 2026-10-13

AB#268 moved New → Active before implementation, under AB#18. The owner authorized
independent worktree commits, pushes and PRs. This slice introduces an offline,
bounded owner-private source identity gate; it performs no provider mutation.

Authenticated GET-only API receipts were captured for the owned current Production
and Preview deployments. Production `dpl_6e4xtTvbq7Zd39g3mmp9AVNL7KYF` reports
source `14b1af09da443ee52248b94535c286be31f8fd10` and `gitDirty=1`: the gate issued
`SOURCE_DIRTY`. Preview `dpl_Fhf384pq5MZLqsBk2EW75bMn6pMy` reports merged main
`5b4f64d062483d20f8ecb5a043b65caa72444741`, but omits `gitDirty`: the gate issued
`SOURCE_CLEANLINESS_UNKNOWN`. Both observations are refusals, not launch acceptance.
Provider bodies and receipt packets remain ignored, mode 600 under mode 700 directories.

Synthetic tests cover a complete positive identity, wrong ownership/readiness/target,
ambiguous and missing SHAs, dirty/unknown cleanliness, malformed metadata and secret
projection. Private IO tests cover bounds, links, permissions, Git visibility and
existing evidence. Local lint, strict TypeScript, all 5,982 browser-free tests and a synthetic
production build passed. No public journey changed; the mandatory PR CI still
runs the full journey and Studio gates. Security self-review checked untrusted
input bounds, private evidence and fail-closed projection; no unresolved finding
remains in this slice. This is not final owner security/privacy acceptance.

No artifact provenance, protection/canonical probe, deployment/promotion, rollback,
DNS, CMS publication or credential action occurred. AB#18 remains Active. The new
task remains Active until its reviewed PR is accepted and merged. The operator
contract is [release-source-verification.md](../release-source-verification.md).
