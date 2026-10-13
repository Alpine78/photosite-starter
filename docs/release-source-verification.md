# Frozen release source verification (AB#268)

`npm run verify:release-source` is an offline identity gate for a **private,
owner-captured Vercel deployment API response**. It sends no requests and changes
no deployment, alias, DNS, content or credential. It binds the response to four
explicit frozen expectations; do not resolve a moving alias or `main` inside the gate.

Capture the response with the existing authenticated Vercel tooling into an ignored
owner-private directory. Unix owner/mode checks require a regular, nonlinked,
single-link input with no group/other permissions, at most 4 MiB. Never put the
response in a PR, pipeline artifact or log: it may contain provider secrets.

```sh
mkdir -m 700 temp/release-source
# Capture a provider response privately as deployment.json (mode 600).
npm run verify:release-source -- \
  --receipt temp/release-source/deployment.json \
  --source-sha <frozen-40-character-source-sha> \
  --deployment-id <dpl_id> --project-id <prj_id> --team-id <team_id> \
  --out temp/release-source/check-1
```

The output directory must be new, ignored by Git, and beneath an owned directory
that others cannot write. Existing evidence is never overwritten. The receipt
binds the raw input SHA-256 but projects only expected identities, fixed refusal
codes and reserved gates. Exit 1 means a refusal or invalid evidence; a valid
refusal still produces a receipt. Parse/IO failures print no raw payload or path.

A pass requires the exact deployment/project/team, `READY`, a known target,
and one consistent expected SHA across every present supported source field
(`meta.gitCommitSha`, `meta.githubCommitSha`, `gitSource.sha`). Cleanliness must
be affirmative (`meta.gitDirty` is `"0"` or `false`). `"1"`/`true` is dirty;
absent or other values remain unknown. Absence on a Git-generated deployment
cannot establish clean local input. This conservative gate may therefore refuse
a legitimate candidate until separate source evidence is available; it does not
silently reinterpret absence as proof.

The receipt is an offline observation of owner-supplied provider metadata, not a
provider signature or a deployment freshness assertion. It does **not** prove the
contents of a prebuilt artifact, install/build provenance, environment settings,
access protection, `noindex`, canonical URL, contact delivery, CMS propagation,
rollback or owner launch approval. Continue using `verify:preview`, existing
release probes and the deployment runbook independently.

See [the current read-only exercise](audits/ab268-release-source-verification-2026-10-13.md).

The AB#272 Preview pipeline supplies affirmative cleanliness metadata only after
`node scripts/assert-deployment-source.mts <expected-sha>` checks the exact clean
checkout before building and immediately before uploading. This fills the
missing provider field for future reviewed pipeline deployments. It attests
only those checkout observations and leaves artifact/configuration and live
publication gates independent. Older deployment receipts are unchanged.
