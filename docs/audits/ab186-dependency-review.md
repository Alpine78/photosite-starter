# AB#186 dependency remediation evidence — 2026-09-29

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
