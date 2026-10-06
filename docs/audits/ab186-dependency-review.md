# AB#186 dependency remediation evidence — 2026-09-29

The 2026-09-29 section below is historical evidence. The current audit is recorded in the dated 2026-10-05 section; the October 2 remediation remains historical evidence.

This is a snapshot of the root lockfile and the Azure Preview CLI path. npm audit reports **affected package entries**, including parent packages reached through a transitive dependency; the counts below are not counts of distinct exploits or proof of a publicly reachable vulnerability. The baseline is merged `main` at `c6b7b69cb91abc24ddc65e3ff22ed747d48f6881`. The proposed result is the uncommitted AB#186 branch. The audit used Node 24.20.0 and npm 12.0.2 against `https://registry.npmjs.org`.

| Full production + development audit | Before | Proposed |
| --- | ---: | ---: |
| Critical affected package entries | 1 | 0 |
| High | 15 | 1 |
| Moderate | 11 | 9 |
| Low | 1 | 0 |
| Total | 28 | 10 |

Raw JSON: [before](ab186-before.json) (SHA-256 `1c161be63cd9b3c50c7ad4dfe4b04621faac883841e3d7d394e6eff1382047c0`), [proposed](ab186-after.json) (SHA-256 `e442e202ecb2b07d3a8698e828f66f777b98c9f280748c6b2bd90ab603e473a1`). The baseline command was `npm audit --json --registry=https://registry.npmjs.org`; the proposed command explicitly included dev dependencies with `npm audit --json --include=dev --registry=https://registry.npmjs.org`. Both exited 1 due to reported advisories. These raw reports contain the individual advisory URLs and affected ranges. The prior security scan's separate baseline artifact is recorded on AB#186; this snapshot repeats the audit against the merged main branch.

The full audit covers the **actual CLI installation selected by the changed Azure Preview job**: `npm ci --include=dev` installs `vercel@61.0.0` from this lockfile, and the job invokes `./node_modules/.bin/vercel` for `pull`, `build`, and `deploy`. There is no separate global CLI tree after this change. Before it, Azure installed `vercel@58.9.1` globally while the root lockfile resolved `59.11.7`; the earlier root audit did not cover that global installation. The old global tree is removed rather than treated as audited retroactively. `scripts/node-version-pin.test.mts` checks the exact manifest/lockfile CLI match and Azure's local CLI use.

The direct CLI dependency moved from production to development dependencies. `npm ci --omit=dev` in an isolated directory installed no `vercel` package, and the [production-only audit](ab186-after-production.json) returned zero affected entries (SHA-256 `94e026ac77bc15f00693712c5daab4420d6b330acaa465c5e088c52b56147834`). No application source imports `vercel`, `undici`, or `tar`. A local `next build` passed; searches of its `.next/server` and `.next/static` output found no `node_modules/vercel`, `node_modules/undici`, `node_modules/tar`, or `@vercel/node` package path. More directly, `vercel pull --yes --environment=preview` and `vercel build --target=preview` passed with CLI 61.0.0, and the resulting 148-file `.vercel/output` contained no files or text path references to those packages. This is evidence about the generated Preview artifact, not proof that every possible runtime path or future build is safe. No deployment was created from this uncommitted branch.

The lockfile lifts affected transitive versions using narrow, exact-old-version npm overrides: `ajv` 8.6.3 → 8.20.0, `js-yaml` 4.1.1 → 4.3.2 (the ESLint path also resolves 4.3.2 after its compatible update), `minimatch` 10.1.1 → 10.2.6, `path-to-regexp` 6.1.0 → 6.3.0 and 8.3.0 → 8.4.2, `smol-toml` 1.5.2 → 1.9.0, and `tar` 7.5.11 → 7.5.22. The newer Vercel CLI already resolves its `@vercel/fun` tar to 7.5.22. These overrides preserve each package's major version and only match the previously pinned affected release. They should be removed when Vercel ships corrected pins; they are not a claim of upstream compatibility certification. The selected CLI's Preview build and the repository gates are the practical compatibility checks.

## Residual undici advisories

The ten remaining affected package entries all derive from one vulnerable dependency family: `undici@5.29.0` directly under `vercel@61.0.0`, and `undici@5.28.4` under `@vercel/node@16.0.2` under that CLI. Other installed undici versions (`6.28.1` and `7.30.0`) are not reported by this audit. There is no fixed 5.x release currently published; forcing undici 6.x through these exact 5.x pins would be a major transitive API substitution in the deployment tool and is deferred pending upstream support. The 14 registry advisory records below all inherit the **same measured reachability boundary**: both affected copies are installed only with development/CI dependencies; no application source import, production-only installation, local production build output, or generated Preview artifact included them. The CLI itself can use HTTP during `pull`, `build`, or `deploy`, so attacker influence over those CLI requests and the affected internal code paths is **not ruled out**. This is a residual CI/developer tooling risk, not a demonstrated anonymous visitor exploit.

**Accountable owner for each advisory below:** PhotoSite Starter maintainer, Azure Boards account `ilkka@ilkkarytkonen.fi` (AB#186 assignee). **Next remediation/review deadline for each:** **2026-10-13**. At that date, check Vercel's published dependency tree and npm advisories again; update to a fixed supported CLI/undici chain or record a new dated decision. AB#186 remains Active until the proposed change and Preview pipeline have been reviewed and accepted.

| Residual registry advisory | Reachability evidence | Owner | Review by |
| --- | --- | --- | --- |
| [GHSA-c76h-2ccp-4975](https://github.com/advisories/GHSA-c76h-2ccp-4975) | CLI-only undici 5.x boundary above | `ilkka@ilkkarytkonen.fi` | 2026-10-13 |
| [GHSA-g9mf-h72j-4rw9](https://github.com/advisories/GHSA-g9mf-h72j-4rw9) | CLI-only undici 5.x boundary above | `ilkka@ilkkarytkonen.fi` | 2026-10-13 |
| [GHSA-cxrh-j4jr-qwg3](https://github.com/advisories/GHSA-cxrh-j4jr-qwg3) | CLI-only undici 5.x boundary above | `ilkka@ilkkarytkonen.fi` | 2026-10-13 |
| [GHSA-2mjp-6q6p-2qxm](https://github.com/advisories/GHSA-2mjp-6q6p-2qxm) | CLI-only undici 5.x boundary above | `ilkka@ilkkarytkonen.fi` | 2026-10-13 |
| [GHSA-vrm6-8vpv-qv8q](https://github.com/advisories/GHSA-vrm6-8vpv-qv8q) | CLI-only undici 5.x boundary above | `ilkka@ilkkarytkonen.fi` | 2026-10-13 |
| [GHSA-v9p9-hfj2-hcw8](https://github.com/advisories/GHSA-v9p9-hfj2-hcw8) | CLI-only undici 5.x boundary above | `ilkka@ilkkarytkonen.fi` | 2026-10-13 |
| [GHSA-4992-7rv2-5pvq](https://github.com/advisories/GHSA-4992-7rv2-5pvq) | CLI-only undici 5.x boundary above | `ilkka@ilkkarytkonen.fi` | 2026-10-13 |
| [GHSA-p88m-4jfj-68fv](https://github.com/advisories/GHSA-p88m-4jfj-68fv) | CLI-only undici 5.x boundary above | `ilkka@ilkkarytkonen.fi` | 2026-10-13 |
| [GHSA-vxpw-j846-p89q](https://github.com/advisories/GHSA-vxpw-j846-p89q) | CLI-only undici 5.x boundary above | `ilkka@ilkkarytkonen.fi` | 2026-10-13 |
| [GHSA-g8m3-5g58-fq7m](https://github.com/advisories/GHSA-g8m3-5g58-fq7m) | CLI-only undici 5.x boundary above | `ilkka@ilkkarytkonen.fi` | 2026-10-13 |
| [GHSA-8xcm-r25x-g524](https://github.com/advisories/GHSA-8xcm-r25x-g524) | CLI-only undici 5.x boundary above | `ilkka@ilkkarytkonen.fi` | 2026-10-13 |
| [GHSA-m8rv-5g2x-5cg5](https://github.com/advisories/GHSA-m8rv-5g2x-5cg5) | CLI-only undici 5.x boundary above | `ilkka@ilkkarytkonen.fi` | 2026-10-13 |
| [GHSA-v3r7-h72x-cjcm](https://github.com/advisories/GHSA-v3r7-h72x-cjcm) | CLI-only undici 5.x boundary above | `ilkka@ilkkarytkonen.fi` | 2026-10-13 |
| [GHSA-35p6-xmwp-9g52](https://github.com/advisories/GHSA-35p6-xmwp-9g52) | CLI-only undici 5.x boundary above | `ilkka@ilkkarytkonen.fi` | 2026-10-13 |

`npm ci`, ESLint, 172 unit-test files (4,178 tests), local production build, local CLI version/flag inspection, and the non-deploying Preview pull/build passed. The pipeline's authenticated **Preview deployment and `verify:preview` checks have not run for this uncommitted change**. They must pass with this exact lockfile after the user commits it and the gated deployment path runs; do not merge or promote it automatically. If the new CLI fails in that stage, stop publication, inspect the stage logs, and revert the CLI/pipeline change together to the previous reviewed state before reattempting. No production promotion was performed.

## 2026-10-02 follow-up — AB#186 remains Active

The audit baseline is the then-current `main` at
`8433a05d2de3626cabc050be2a405d2523516438`. During the resumed review, remote
`main` advanced to `06e0f081c8e2cc894e582ce945b1bd1b3f8e884e`, merging
Next.js 16.3.6 and the same brace-expansion refreshes. The before/after reports
below retain their original baseline; the diff review uses the newer remote
`main`, rather than counting those merged refreshes as new changes.
The earlier CLI reclassification, drift removal and overrides are already merged.
This follow-up changes the exact framework pin from resolved Next.js 16.3.3 to
16.3.8, aligns `eslint-config-next` 16.3.7 → 16.3.8, and refreshes compatible
`brace-expansion` ranges from 1.1.18/2.1.4 to 1.1.21/2.1.7 without an override.
It adds the exact-old-version `undici@5.28.4` → 5.29.0 override; `@vercel/node`
now deduplicates to that same CLI copy. A compatible existing `@vercel/blob`
range also refreshed undici 6.28.1 → 6.29.0. No major transitive substitution
or `npm audit fix --force` was used.

| Fresh audit, production + development | Baseline | Follow-up |
| --- | ---: | ---: |
| Critical package entries | 1 | 0 |
| High | 2 | 1 |
| Moderate | 9 | 9 |
| Low | 0 | 0 |
| Total | 12 | 10 |

The new baseline includes [Next.js's ImageResponse advisory](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j)
and brace-expansion advisories. The application's source has no `next/og` or
`ImageResponse` use; that absence limits the stated exploit precondition, not
the need to maintain the framework. Both packages' entries disappear from the
fresh follow-up report. npm package entries, including transitive parents, are
not independent demonstrated exploits.

Commands used Node 24.20.0 / npm 12.0.2 and the explicit npm registry:
`npm audit --json --include=prod --include=dev --registry=https://registry.npmjs.org`
(exit 1 before and after) and `npm audit --json --omit=dev --registry=https://registry.npmjs.org`
(exit 0 after). Raw reports and SHA-256:

| Evidence | SHA-256 |
| --- | --- |
| [before](ab186-2026-10-02-before.json) | `ca97c3b388a320a12559158c0bbe1b30674ee9f94d50b46debc7e5abac69f119` |
| [after](ab186-2026-10-02-after.json) | `5986d7ce32e939a4e432700584a47a037dae75ad72c17234ccfb7677f9a5655b` |
| [production](ab186-2026-10-02-production.json) | `dfcbd36d5cb91962f8beb674915b73c83645505fed514906383b57d1450f0c1a` |
| [cli62-comparison](ab186-2026-10-02-cli62-comparison.json) | `f21327bb27a31833a482c31408fc952406609dc5b06edd4536ebc35fc82ec9fd` |

### CLI choice, production reachability, and override ownership

The actual Azure installation remains the single root lockfile tree,
`vercel@61.0.0` in devDependencies, installed with `npm ci --include=dev` and
invoked by explicit local path. No global installation remains to audit.
`npm ls undici --all` verified the deduplicated 5.29.0 copies; `npm ci` alone
initially retained a stale 5.28.4 lock entry, which was removed and re-resolved
by npm before the final clean installation and reports above.

An isolated manifest containing `vercel@62.1.0` and the same overrides was
resolved and audited separately (`npm install --package-lock-only --ignore-scripts`,
then the full audit with `--prefix` pointing at that directory). Its tree also
resolves undici 5.29.0, 6.29.0 and 7.30.0. Its ten reported package entries and
thirteen undici advisory IDs equal this follow-up's residual set. Other builder
versions change across that CLI major, but no additional advisory family was
removed in this comparison. CLI 61.0.0 is retained to keep the change bounded;
this comparison is not a compatibility test or endorsement of CLI 62.1.0.

An isolated `npm ci --omit=dev --ignore-scripts` installed 28 packages and no
Vercel CLI; the production-only report above has zero entries. Source searches
found no application imports of `vercel`, `undici` or `tar`. The local production
build's 26 server trace files carried 720 unique path references, with no
`node_modules/vercel/`, `node_modules/undici/`, `node_modules/tar/` or
`node_modules/@vercel/node/` reference. This is evidence about the installed
npm packages and this artifact. Node's built-in fetch implementation and
framework-bundled internals are separate inventories, not these npm versions;
zero entries does not establish general safety.

All eight exact-old-version overrides below are owned by the PhotoSite Starter
maintainer (`ilkka@ilkkarytkonen.fi`, AB#186 assignee). **Review/removal deadline:
2026-10-13 for each.** Remove an override when an audited supported upstream
consumer resolves a fixed version without it; if that is unavailable, obtain a
new dated owner decision. Matching the old version prevents rewriting future
pins silently. Each replacement stays within its existing major; this is a
compatibility boundary, not proof that every API path was exercised.

| Override scope | Replacement | Compatibility evidence |
| --- | --- | --- |
| `ajv@8.6.3` | 8.20.0 | Existing CLI static-config consumer; selected CLI build gate |
| `js-yaml@4.1.1` | 4.3.2 | Existing CLI Python-analysis consumer; lint and CLI build gates |
| `minimatch@10.1.1` | 10.2.6 | Existing CLI Python-analysis consumer; CLI build gate |
| `path-to-regexp@6.1.0` | 6.3.0 | Existing builder consumer; CLI build gate |
| `path-to-regexp@8.3.0` | 8.4.2 | Existing builder consumer; CLI build gate |
| `smol-toml@1.5.2` | 1.9.0 | Existing CLI TOML consumer; CLI build gate |
| `tar@7.5.11` | 7.5.22 | Existing build/extraction tooling; CLI build gate |
| `undici@5.28.4` | 5.29.0 | `@vercel/node` uses `request` and `Headers` in its local-dev server; same-major API retention, valid installed tree, CLI gates |

### Current residuals — evidence, not an accepted-risk decision

All ten residual entries derive from the thirteen undici advisory records below.
The 5.29.0 update removes the older randomness/certificate advisories; the latest
report adds GHSA-r53p-7pc4-xj5r, so the historical fourteen-row table is not the
current set. No newer undici 5.x release was published at this check. Neither
Vercel CLI version tested removes the family, and an unsupported 5.x → 6.x
override has not been substituted into this deployment tool.

The shared verified boundary for **each** row is: installed only in developer/CI
tooling, absent from the production-only installation and traced application
artifact. Inspected consumers are CLI `fetch-proxy` importing `Agent`/`ProxyAgent`
and `@vercel/node/dist/dev-server.mjs` importing `Headers`/`request` to forward
local development traffic. HTTP traffic is a real tooling use, and upstream
responses, proxy settings or local-dev requests can be untrusted. Searches of
these consumers did not identify undici WebSocket, cookie-parser/serializer or
retry-interceptor registration; that limited inspection does not rule out use
elsewhere in the CLI. No anonymous public application path to these packages
was found, and no exploit was reproduced. Per-mechanism limits follow:

| Advisory | Reachability evidence and remaining uncertainty |
| --- | --- |
| [GHSA-g9mf-h72j-4rw9](https://github.com/advisories/GHSA-g9mf-h72j-4rw9) | Response decompression: CLI HTTP responses are external input; a call to the affected library fetch/decompression path was not established. |
| [GHSA-2mjp-6q6p-2qxm](https://github.com/advisories/GHSA-2mjp-6q6p-2qxm) | HTTP framing: Agent/ProxyAgent and local-dev request consumers exist; exploit framing and attacker control were not established. |
| [GHSA-vrm6-8vpv-qv8q](https://github.com/advisories/GHSA-vrm6-8vpv-qv8q) | WebSocket decompression: no undici WebSocket constructor identified in the inspected CLI consumers; other tooling paths remain unverified. |
| [GHSA-v9p9-hfj2-hcw8](https://github.com/advisories/GHSA-v9p9-hfj2-hcw8) | WebSocket negotiation: same unverified WebSocket boundary; no public application call. |
| [GHSA-4992-7rv2-5pvq](https://github.com/advisories/GHSA-4992-7rv2-5pvq) | Upgrade header injection: no attacker-controlled upgrade option identified in the inspected consumers; CLI request inputs remain a tooling boundary. |
| [GHSA-p88m-4jfj-68fv](https://github.com/advisories/GHSA-p88m-4jfj-68fv) | Set-Cookie decoding: no affected cookie-parser call identified in the inspected consumers; CLI server responses remain untrusted. |
| [GHSA-vxpw-j846-p89q](https://github.com/advisories/GHSA-vxpw-j846-p89q) | WebSocket fragmentation: no undici WebSocket constructor identified in the inspected consumers; no public application call. |
| [GHSA-g8m3-5g58-fq7m](https://github.com/advisories/GHSA-g8m3-5g58-fq7m) | SameSite parsing: no affected cookie-parser call identified in the inspected consumers; no public application call. |
| [GHSA-8xcm-r25x-g524](https://github.com/advisories/GHSA-8xcm-r25x-g524) | Retry interceptor desynchronization: no retry interceptor registration identified in the inspected consumers; other CLI paths remain unverified. |
| [GHSA-m8rv-5g2x-5cg5](https://github.com/advisories/GHSA-m8rv-5g2x-5cg5) | Blob body header injection: no attacker-controlled blob-like type identified in inspected consumers; no public application call. |
| [GHSA-v3r7-h72x-cjcm](https://github.com/advisories/GHSA-v3r7-h72x-cjcm) | Cookie attribute injection: no affected cookie-serialization call identified in inspected consumers; no public application call. |
| [GHSA-35p6-xmwp-9g52](https://github.com/advisories/GHSA-35p6-xmwp-9g52) | Keep-alive response poisoning: CLI dispatchers/local-dev request consumers exist; malicious response control and exploit path remain unverified. |
| [GHSA-r53p-7pc4-xj5r](https://github.com/advisories/GHSA-r53p-7pc4-xj5r) | Retry interceptor response splitting: no retry interceptor registration identified in inspected consumers; other CLI paths remain unverified. |

**Owner for every row:** `ilkka@ilkkarytkonen.fi`. **Remediation/review deadline
for every row:** 2026-10-13. The daily full-dependency audit remains nonzero and
visible. These are proposed time-bound residuals; no owner acceptance, dismissal,
automatic merge or Production promotion is recorded by this follow-up.

### Validation status for this uncommitted follow-up

- `npm ci --include=dev`, `npm ls undici --all`, lint, all 191 Vitest files /
  4,366 tests, and a harness-configured Next.js production build passed again
  in the resumed review. A restricted-shell unit run could not start some CLI
  subprocesses (`EPERM`); the unchanged full suite passed outside that sandbox.
  Fresh full and production-only audits matched the raw reports above.
- The first full Chromium/WebKit run completed without losing its server:
  714 accepted results (including the four AB#132 expected failures), 36 skips,
  two private-gallery-link failures. Three serial repeats of those two cases
  passed. After one Codex test-synchronization correction, a four-worker,
  six-repeat check had 11 passes and one recurring history-scrubbing failure.
  The requested workflow handed the recurring correction to Claude during the
  resumed review: the history journey now waits for the deferred bootstrap
  script before mutating the fragment. Claude also corrected the earlier Codex
  exchange wait, which required an authenticated heading in WebKit despite its
  documented HTTP-loopback Secure-cookie limitation. The test still checks
  fragment removal before the POST, the clean public URL and the request shape
  in both engines, and checks the authenticated landing in Chromium.
  The final six-repeat focused run passed 18 cases with six existing WebKit
  session/history skips. The subsequent complete four-worker browser gate
  passed: 716 accepted results (712 ordinary passes and four AB#132 expected
  failures), 36 existing skips, no unexpected failures, no retries. Its fresh
  scriptless observations matched AB#132's four raw records. The four expected
  failures do not constitute a passing scriptless recovery journey.
- `vercel pull --yes --environment=preview` and the selected local CLI's
  `vercel build --target=preview` passed with the linked owner's existing
  Preview settings. Two sensitive environment values were provider-redacted
  during pull. No Production settings were fetched. The generated artifact's
  package-path inspection is recorded below; this is not deployment verification.
- Authenticated project inspection confirmed the expected owner/project,
  Standard Protection (`all_except_custom_domains`) and an existing automation
  bypass configuration. **No deployment or `verify:preview` run was performed**
  for this candidate. No alias was repointed.

The local gates now pass; independent diff review and authenticated deployment
verification are separate checks. Before accepting AB#186, build and deploy
with the same pinned CLI, then verify the exact Preview deployment's ownership,
protection and noindex. Owner acceptance of the tooling residuals remains a
separate requirement; AB#186 remains Active. No commit, merge or Production
promotion was performed.

Preview artifact inspection (2026-10-02): 150 files across 51 unique real directories, following local directory links once; 0 affected CLI package file paths and 0 text path references. Lockfile SHA-256: `fa44fb8c5563f5d06ef048a4148bcb674c32f47bd2d81208acf0b65a8af7a1d7`. This excludes the four installed CLI package paths named above; it is not a claim about every bundled framework internal.

## 2026-10-05 audit refresh — new tooling families, no package change

This follow-up audits the exact root lockfile at merged main
`4b8dd013880eddf79e54e42244d18f5cda32d860`, after PR #246. Node 24.20.0 /
npm 12.0.2 ran `npm audit --json --include=prod --include=dev
--registry=https://registry.npmjs.org` (exit 1) and the corresponding
`--omit=dev` audit (exit 0) in the published AB#186 worktree. No manifest,
lockfile, override, CLI, application or pipeline setting changed.

| Affected package entries | Full audit | Production-only |
| --- | ---: | ---: |
| Critical | 0 | 0 |
| High | 25 | 0 |
| Moderate / low / informational | 0 | 0 |
| Total | 25 | 0 |

These are affected package entries, including dependent parents, **not 25
independent exploits or proof of visitor reachability**. Fifteen advisory
records belong to three dependency families. The thirteen undici records
listed in the October 2 residual table remain; the newly reported families
are busboy and braces. The older ten-entry report is a dated snapshot and
must not be used as the current audit result.

| Fresh report | SHA-256 |
| --- | --- |
| [full](ab186-2026-10-05-full.json) | `5d433f33b0ec19bd8c87f5f9929b8ab440a953d4196cb658dfb2140a42cae011` |
| [production](ab186-2026-10-05-production.json) | `dfcbd36d5cb91962f8beb674915b73c83645505fed514906383b57d1450f0c1a` |

### Supported remediation and actual consumer boundaries

| Family | Installed chain and measured reachability | Supported fix / current disposition |
| --- | --- | --- |
| [@fastify/busboy, GHSA-x8mw-p69m-v3mx](https://github.com/fastify/busboy/security/advisories/GHSA-x8mw-p69m-v3mx) | `vercel@61.0.0 → undici@5.29.0 → @fastify/busboy@2.1.1`. Undici's `lib/fetch/body.js` imports Busboy and calls its direct `write()` / `end()` in multipart `formData()` parsing. The advisory's malformed part-header failure therefore has an installed consumer; attacker control and invocation through this CLI were not established. No public application import or emitted installed-package path was found. | The maintainer fixes versions below 3.2.1 in **3.2.1**. Undici declares `^2.0.0`; the published 2.x line ends at 2.1.1. Substituting 3.x is an unverified major transitive change. No override added. |
| [braces, GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | `eslint-config-next@16.3.8 → @next/eslint-plugin-next → fast-glob → micromatch → braces@3.0.3`, also reported through CLI builders. `fast-glob/out/utils/pattern.js` calls `micromatch.braces(..., {expand:true})`. The Next plugin's `get-root-dirs.js` globs configured `settings.next.rootDir`; this repository does not configure that setting. Build/lint patterns and repository configuration are tooling inputs, not shown to originate in visitor requests. Untrusted repository input remains a CI concern. | The current registry latest is **3.0.3** and the advisory has no patched version. No supported patch was available at this check. No downgrade or force fix. |
| undici | The thirteen October 2 advisory rows retain their per-mechanism assessment. The root CLI and `@vercel/node` resolve the same 5.29.0 copy. CLI network use remains a tooling risk; absence from public output is not a finding dismissal. | No fixed 5.x release was published. Registry metadata for latest `vercel@62.4.0` still declares `undici: 5.29.0`; changing CLI major alone would retain that family and its busboy chain. This is dependency-metadata inspection, not a CLI 62.4 compatibility or full-tree audit. |

The audit covers the **actual Azure CLI installation**: `npm ci` installs
root devDependencies, and DeployPreview uses `./node_modules/.bin/vercel`
61.0.0. The historical global CLI drift has already been removed. The eight
exact-old-version overrides, their scope and October 13 review/removal deadline
remain as documented above; this refresh changes none of them.

A fresh manual Production-target prebuilt build of the same unchanged main
source passed with the pinned CLI and fourteen public configuration values.
All six contact/key runtime settings were excluded from the local build.
The 27 `.next` trace files contained 346 unique resolved paths; none named
installed `vercel`, `@vercel/node`, `undici`, `@fastify/busboy` or `braces`
packages. The 387 CLI-mapped runtime inputs also contained no such package path.
The complete output manifest covered 220 entries, including 70 directory
aliases, and five physical Node 24 functions. A heuristic scan of all 537
physical/mapped files found no selected token shapes. Input exclusion, path
inventory and a heuristic scan have different limits: Node's built-in fetch
and framework-bundled internals are separate inventories, and none of these
checks proves every possible execution path safe.

### Proposed residual decision and verification limits

**Accountable maintainer already named on AB#186:** `ilkka@ilkkarytkonen.fi`.
**Proposed review/remediation deadline for every advisory and override:**
**2026-10-13**, or before any earlier public promotion. The busboy and braces
rows join the existing thirteen undici rows in that decision. A choice to
retain the current supported tooling must record these input boundaries,
remaining uncertainty, compensating trusted-PR gate and next review. It is
**pending owner acceptance**; the agent does not accept it on the owner's
behalf, suppress the daily failed audit, or close AB#186.

Validation for this evidence refresh: clean lockfile installation, lint,
193 Vitest files / 4,467 tests and the exact-source manual prebuilt build passed.
The first lint invocation overlapped that build's dependency reinstall and
failed to resolve a plugin; the unchanged post-build lint and test runs passed.
Authenticated deployment/upload/protection proof is a separate release check;
this document does not claim it occurred. The required main CI and release
candidate records are reported by the release handoff. No dependency change,
new runtime exploit, owner acceptance, CMS write or public promotion is claimed.

## Offline counts from a saved report (AB#204)

Run `npm run summarize:audit -- <saved-audit.json>` on npm audit v2 JSON (maximum
4 MiB). No registry call or dependency fix occurs. Exit 0 is validated clean, 1 is
findings and 2 is invalid/error/inconsistent input. Package entries, concrete and
inherited entries, string-via edges and unique numeric advisory IDs are distinct
counts. Direct dependencies are counted by npm's `isDirect`; this differs from entries
with concrete advisories. Cycles must reach a concrete advisory, and every reference
must exist. GHSA IDs are optional and extracted only from exact GitHub advisory URLs.
Counts do not establish exploitability or approve risk. AB#160/186 remain open.
