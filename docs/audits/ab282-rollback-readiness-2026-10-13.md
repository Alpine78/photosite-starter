# AB#282 — rollback readiness before the recovery exercise

AB#282 moved New → Active before changes, under AB#118. The owner authorized
commits, pushes and PR preparation for overnight launch work. This slice adds an
offline preflight; it performs no provider, alias, DNS, CMS or credential writes.

`npm run verify:rollback-readiness` binds both private provider responses to frozen
source, deployment, project and team identities through the existing AB#268 gate.
Both must be clean, READY Production builds in the same project/team. A Preview
build or selecting the current deployment again cannot pass. The separate observation
file binds the exact response bytes, current complete CMS snapshot, locally verified
recovery bytes, per-build route/media compatibility and runtime read/secret access.
It also requires observed hosting eligibility, previous Production use, a machine-alias
inventory and a cache-recovery plan. Observations expire after one hour; future or
invalid timestamps and extra fields are refused. Their assertions are operator evidence,
not independently measured facts: the receipt explicitly reserves that boundary.

The CLI reuses owned, bounded, nonlinked mode-0600 inputs and exclusive mode-0700
ignored output directories. UTF-8 decoding is strict. Output contains frozen expected
identities, hashes and fixed refusal codes; raw provider payloads, HTML, secrets and
observation contents are never emitted. Tests cover source dirtiness, Preview targets,
byte-binding mismatches, missing observations, snapshot/compatibility drift, stale and
future captures, malformed encoding, same-deployment recovery and project mismatch.

Vercel's current [Instant Rollback documentation](https://vercel.com/docs/instant-rollback)
says eligible targets previously served Production; Hobby is limited to the immediately
previous deployment, while Pro/Enterprise may choose any eligible target. A rollback
uses the selected build's environment configuration and disables automatic assignment
until promotion resumes it. Therefore READY metadata or an available Preview is not
sufficient eligibility or secret-freshness evidence. These are provider rules, not proof
of this project's current entitlements or a retention promise.

The [exercise record](../rollback-exercise-record.md) still needs the actual approved
action, post-recovery content/cache observations and owner handoff. Passing this
preflight authorizes nothing and reports `rollbackExecuted=false`, `cmsRestored=false`,
`artifactContentsVerified=false` and `launchApproved=false`. No successful recovery
or final release acceptance is claimed. AB#282 remains Active pending review/merge;
parent AB#118 remains open for the exercised recovery and accepted transfer.

Validation: 53 focused rollback/source tests and the complete 6,089-test offline suite
pass. ESLint and the production build using the current real-CMS read configuration
pass. No public runtime journey changes require a new browser suite. An initial local
dependency/Studio setup and a duplicate build lock were corrected before the final run.
