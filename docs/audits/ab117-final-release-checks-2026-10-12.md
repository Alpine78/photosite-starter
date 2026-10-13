# AB#117 — final release checks, 2026-10-12

Status: operational evidence refreshed and one real contact test delivered through the
application; final launch acceptance remains open. AB#117/18/137/250 remain Active.
No full security/privacy approval, canonical launch or customer handoff is claimed.

## Exact serving release

Authenticated provider readback verifies the intended owner-controlled project and team.
The public Production alias serves `dpl_6e4xtTvbq7Zd39g3mmp9AVNL7KYF`, source
`14b1af09da443ee52248b94535c286be31f8fd10`, READY and Production-targeted.
Provider metadata also reports `gitDirty=1`: that commit is a tagged source base,
not proof of the complete deployed patch. The uncommitted source delta remains
unverified; exact deployment ID, rather than commit equality, binds the live receipts.
The main code used by this worktree begins at `5262def`; its newer language and
presentation changes are not attributed to the serving artifact. The intended
canonical domain continues to serve Joomla. No DNS, promotion or alias write occurred.

The observed contact response is HTTPS HTML and carries CSP, HSTS, DENY framing,
nosniff, restrictive permissions and referrer policy, plus the expected alias noindex.
The robots/canonical policy for final custom-domain activation remains a distinct gate.
The current root lockfile audit reports zero vulnerabilities. The isolated Studio
lockfile still reports eight moderate chain entries for the known sprintf-js advisory;
Studio is not part of the public application artifact. This does not erase that follow-up.

## One actual contact delivery attempt

`verify:contact-delivery` is plan-only by default. `--send` makes exactly one synthetic
POST to the fixed application endpoint, with a fresh UUID, an empty honeypot, same-origin
headers, no credentials/redirects and a closed bounded JSON response check. The body and
reply address contain no customer information. The attempt identity is durably written
before sending, and an existing private receipt cannot be overwritten. There is no
automatic retry; a network or acknowledgement failure can still have sent the message.

```bash
npm run verify:contact-delivery -- --origin <verified-origin> --out <new-private-receipt.json>
# --send performs the separately intended single real delivery attempt.
```

One authorized live attempt on the public Production alias at 19:54 UTC returned HTTP
200, a valid delivered acknowledgement and no-store. The exact deployment's logs contain
both accepted and delivered events for its correlation ID. This proves application/provider
acceptance. On October 13 the owner supplied a mailbox screenshot showing the exact
preserved synthetic submission identity and the expected Reply-To
`release-verification@example.com`. This confirms mailbox arrival and the displayed
reply address for that same attempt; its displayed October 12 time is 22:54. The
recipient's identity and screenshot stay outside the public repository. A separate
private confirmation receipt supplements the original immutable send/log receipts.
The canonical Joomla-domain form was not tested as if it already served this application.

## CMS publication and privacy

An authenticated raw audit scanned 16,947 documents over 85 pages: 16,946 non-draft
records, one settings draft, no release versions and no release records. It observed
5,158 image assets, zero stored original filenames, zero image assets missing dimensions
and zero media documents carrying the audited private/internal metadata fields. This is
field-presence/content-store evidence; it is not a new binary EXIF inspection, complete
restore exercise or permission-independent anonymous inventory. Existing drafts were
preserved, not treated as abandoned content or removed.

Both configured hooks are enabled and target Production content. The public Production
hook's identity-only projection matches its reviewed contract exactly. Current hook
history records real CMS-triggered successful attempts, most recently October 11 at
16:23 UTC, before the currently serving artifact's activation. The messages-history
endpoint failed; no new publication is inferred from that failure. A bounded current
Production revalidation-log search returned no entries. Therefore a fresh genuine CMS
publication and observed rendered update on this exact release remain unverified.

A new complete raw snapshot captured all 16,947 documents and rechecked every
identity/revision/type against a second complete scan without drift. Its exact home
source still matches the private proposal. Asset binaries were not newly copied and
a restore was not exercised; raw snapshot completeness does not supply those proofs.

A private one-field proposal binds the existing home document's intro array to its
current revision, appends a synthetic Finnish test marker and preserves every other
field, language, image and reference. Exact restoration requires the revision observed
after the write; a stale original revision cannot authorize restoration. The proposal
is explicitly non-executable and unapproved. Before a real publish/restore test, establish
a complete current recoverable baseline, review the guarded operator and obtain the
exact mutation approval; then bind genuine hook receipts and visible marker/restoration
checks to both operations. No CMS write or writer credential was created here.

## Recovery and remaining release decision

The [rollback record](../rollback-exercise-record.md) distinguishes code, alias/DNS,
CMS documents, shared assets, caches, credentials and sent mail. The previously exercised
protected-alias restoration is not a project rollback, CMS restore or customer handoff.
AB#118 remains New. The owner-accepted first canonical-launch fallback is the deliberately
dark web state, preserving mail; it does not assume Joomla remains available after the
October 15 host retirement. The actual chosen compatible recovery path and exercise
remain required before the full release is accepted.

Final AB#117 acceptance still depends on the remaining exact legacy decisions and their
serving-source verification, supported retained-customer ZIP transport/import/runtime,
current notice and processor/credential residual reconciliation, exact-candidate scriptless
404 residual review, physical-device completion, publication proof and any required
contact recheck on the final candidate, and recovery/ownership evidence. These are
existing launch requirements, not new roadmap work. No pending result or old deployment test is counted as a fresh pass.

## Validation and review scope

Deterministic smoke tests cover unsafe origins/identities, one-shot delivery, malformed
or oversized responses, unexpected cache/CORS headers, redirects, hangs/cancellation,
redaction and non-overwriting private receipts. Full browser-free tests, lint and the
synthetic production build passed after fixing test-only TypeScript inference. No public
UI/runtime route changed in this worktree. Private receipts preserve original failures,
exact source identity, current audits and the one live attempt without publishing tokens,
message bodies or CMS data. Review outcome and final counts accompany the PR.
