# Asset and licensing inventory

Audit of everything non-original that ships in this project, per AB#43. Records the
source, author, license, attribution requirement, and commercial-use status of each
item so the Free Core / Premium boundary (AB#42) can be decided on facts.

**Audited:** 2026-07-31 · **Against dependency tree:** current `package-lock.json`

## Distribution model assumed by this audit

The project is distributed **as source**: a photographer clones the repository and runs
`npm install` themselves. This matters, because it means the repository does **not**
redistribute npm dependencies — obligations that attach to redistribution do not apply
to them today.

Two things *are* redistributed and therefore carry obligations: the vendored agent
skills (in the repository) and the Geist font files (embedded into the build output and
served by a deployed site).

> **This assumption is not yet ratified.** AB#42 defines the Free Core / Premium product
> boundary. If the deliverable ever becomes a bundle, a zip, or a hosted build rather
> than a source clone, the npm dependency rows below must be re-reviewed — in particular
> `sharp` (LGPL-3.0-or-later) and `caniuse-lite` (CC-BY-4.0).

## Original work

| Item | Author | License | Notes |
| --- | --- | --- | --- |
| Application source (`src/`), config, CI, docs | Ilkka Rytkönen | MIT (project `LICENSE`) | Scaffolded from `create-next-app` (Next.js, MIT) and then rewritten |

## Third-party material that ships

| Item | Source | Author | License | Attribution required | Commercial use |
| --- | --- | --- | --- | --- | --- |
| Geist, Geist Mono typefaces | `vercel/geist-font` via `next/font/google` | The Geist Project Authors | OFL-1.1 | **Yes** — notice + license must accompany redistribution | Yes |
| `architecture` skill | `anthropics/knowledge-work-plugins` | Anthropic | Apache-2.0 | **Yes** — license copy, retained notices, state changes | Yes |
| `security-review` skill | `affaan-m/ECC` | Affaan Mustafa | MIT | **Yes** — copyright + permission notice | Yes |
| Demo photographs (`public/gallery/`, 6 files) | OpenAI services | Project author (assigned) | Project MIT | No | Yes — see below |

Attribution for all four is in the root `NOTICE` file; full license texts are in
`licenses/`.

### Demo photographs — basis for the commercial-use finding

The six WebP files carry **no embedded metadata** (bare `VP8` chunks — no EXIF, XMP, or
ICC), so provenance could not be established from the files and was confirmed with the
author: they were generated with OpenAI services.

OpenAI's Terms of Use, verified 2026-07-27, state: *"As between you and OpenAI, and to
the extent permitted by applicable law, you (a) retain your ownership rights in Input and
(b) own the Output. We hereby assign to you all our right, title, and interest, if any,
in and to Output."* No attribution to OpenAI is required, and onward licensing under the
project's MIT license is permitted.

Two caveats worth carrying forward:

- The same terms note that *"Output may not be unique and other users may receive similar
  output"*. These images are not exclusive to this project — acceptable for placeholder
  content, but they should not become part of a brand identity.
- They are placeholders. A production clone replaces them with the photographer's own
  work, which is why the mock data layer labels them as such.

## npm dependencies — recorded, not redistributed

394 packages are installed in the audited Windows x64 dependency tree. Platform-specific
optional packages for other targets remain recorded in `package-lock.json` but are not
included in this installed-tree count. Licence distribution:

| License | Packages |
| --- | --- |
| MIT | 333 |
| Apache-2.0 | 23 |
| ISC | 19 |
| BSD-2-Clause | 7 |
| MPL-2.0 | 5 |
| BSD-3-Clause | 2 |
| Apache-2.0 AND LGPL-3.0-or-later | 1 |
| Python-2.0, CC-BY-4.0, CC0-1.0, 0BSD | 1 each |

No package is under a copyleft license that would reach the application source. Four
warrant a note if the distribution model changes:

| Package | License | In production tree | Why it is flagged |
| --- | --- | --- | --- |
| `sharp` (`@img/sharp-*`) | Apache-2.0 AND LGPL-3.0-or-later | Yes | LGPL obligations attach on binary redistribution. Runs server-side only; never sent to browsers |
| `caniuse-lite` | CC-BY-4.0 | Yes | CC-BY requires attribution when the data is redistributed. Build-time data, not served |
| `axe-core` | MPL-2.0 | No (dev) | File-level copyleft; dev tooling only |
| `lightningcss` | MPL-2.0 | No (build) | File-level copyleft; build tooling only |

## Open items

| # | Item | Status |
| --- | --- | --- |
| 1 | `security-review` skill has diverged from upstream (5 lines, including an upstream fix `error.errors` → `error.issues`). Its source repo also moved to `affaan-m/ECC`. | Refresh from upstream; not blocking |
| 2 | `skills-lock.json` records four skills but only two are vendored here; `computedHash` is not reproducible as a content hash and cannot be used to verify provenance. | Replace with pinned commit SHAs, or trim to what the repo actually contains |
| 3 | `.claude/skills/architecture/SKILL.md` links to a `CONNECTORS.md` that does not exist. Verified as an **upstream** defect — the vendored copy is faithful. | Leave; report upstream if desired |
| 4 | Distribution model unratified. | Blocked on AB#42 |

## Verifying provenance of a vendored skill

`computedHash` in `skills-lock.json` is not a reproducible content hash. Verify against
the upstream source instead, normalizing line endings first — a Windows checkout is CRLF
and an unnormalized diff reports every line as changed:

```bash
curl -sf "https://raw.githubusercontent.com/<org>/<repo>/main/<path>/SKILL.md" -o upstream.md
tr -d '\r' < .claude/skills/<name>/SKILL.md > local.md
diff upstream.md local.md
```

## Contributions

This project does not accept external contributions — see `README.md`. This keeps future
relicensing (AB#42) unencumbered without the overhead of a CLA.
