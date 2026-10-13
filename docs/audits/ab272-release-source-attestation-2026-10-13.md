# AB#272 — clean checkout source attestation, 2026-10-13

AB#272 moved New → Active before implementation, under AB#18. The owner
requested independent worktrees, commits, pushes and ready PRs. AB#268's
GET-only exercise found unknown source cleanliness on the Git-built Preview,
and dirty source on the old Production deployment.

The new bounded Git checker binds HEAD and its tree to an explicit 40-character
expected commit and rejects any tracked, staged or unignored untracked change.
The existing Preview stage checks before building and again immediately before
upload. Only then does it attach `gitCommitSha` and affirmative `gitDirty=0`
metadata. Both steps use the immutable Azure `Build.SourceVersion`. Existing
quality gates, main-only admission, latest-main alias lock, project/team binding,
protection/noindex and failure cleanup remain mandatory. CLI credentials use
existing step-scoped environment variables rather than command arguments.

Metadata flag and authentication behavior were verified against the pinned
installed Vercel CLI and [official deploy documentation](https://vercel.com/docs/cli/deploy#meta).
This describes clean checkout observations at two checkpoints, not signed
provenance, ignored dependency/configuration contents or the exact prebuilt
artifact. It does not alter older immutable deployment metadata.

Synthetic tests cover wrong SHA/tree, staged/untracked dirt, invalid expected
identity, before/after checkout drift and the CI upload-order contract. All
local lint, full browser-free tests, strict TypeScript and synthetic production
build gates passed. Real updated pipeline deployment/readback remains pending
reviewed merge and main CI; no current clean deployment is falsely claimed.

The owner's merged #379–381 child tasks are Closed. Broader AB#18/117 remain
Active and AB#118 remains New. Existing local recovery proves current document
and original-asset bytes, not provider restore, previous deployment rollback,
custom-domain behavior or final owner security/privacy acceptance.
