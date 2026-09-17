# Asset and licensing inventory

Audit of everything non-original that ships in this project, per AB#43. Records the
source, author, license, attribution requirement, and commercial-use status of each
item so the Free Core / Premium boundary (AB#42) can be decided on facts.

**Audited:** 2026-07-31 · **Against dependency tree:** current `package-lock.json`
**Amended:** 2026-09-17 — `parse5` added as a development dependency for AB#137's
owner-run migration tooling; see the npm dependency section.
**Amended:** 2026-09-17 — `sharp` added as a development dependency for AB#137's
owner-run migration write tooling; see the npm dependency section.  
**Amended:** 2026-08-06 — PhotoSwipe added (AB#15). Package counts below are from the
original audit and were not recounted.
**Amended:** 2026-08-10 — `server-only` added (AB#39); see the npm dependency section.
Counts were not recounted.
**Amended:** 2026-08-13 — D2 diagram tooling added (AB#133): the `@terrastruct/d2`
development dependency, and the Source Sans Pro subsets it embeds into the generated
SVGs in `docs/architecture/`. Counts were not recounted.
**Amended:** 2026-08-24 — the vendored `architecture` and `security-review` skills were
adapted to the repository's own ADR, security, privacy, CMS, media, and deployment
boundaries; their upstream licenses and attribution remain in place.
**Re-verified 2026-09-13 (AB#43):** a fresh audit pass against the current dependency
tree and `public/`/`src/app/` assets. Two new production dependencies since the original
audit — `@sanity/webhook` (MIT, AB#83's webhook signature verification) and the `vercel`
CLI (Apache-2.0, deployment tooling) — were checked against a real production build's
`.next/static/chunks/` and confirmed absent from it, the same verification method this
document already prescribes; neither crosses the redistribution line, so the shipped
table below is unchanged by their addition. One real gap was found and fixed: see
"Default scaffold favicon" below.

## Distribution model assumed by this audit

The project is distributed **as source**: a photographer clones the repository and runs
`npm install` themselves. This matters, because it means the repository does **not**
redistribute npm dependencies — obligations that attach to redistribution do not apply
to them today.

**The test is where the code ends up, not who put it there.** A package is redistributed
when its bytes are served to a visitor, whether this project imported it directly or a
framework emitted it. Most of the dependency tree never crosses that line — it is build
tooling, or it runs server-side, or it is stripped from the client bundle. Everything
that does cross it belongs in the shipped table below, and nothing that crosses it is
excused by being a framework's own output.

Applying that test, five things are redistributed and carry obligations: the vendored
agent skills and the generated architecture diagrams (both in the repository), and —
embedded into the build output and served by a deployed site — the Geist font files, the
Next.js/React client runtime, and the PhotoSwipe browser bundle.

The diagrams are the one that is easy to miss, because nothing about them looks like a
shipped asset. `docs/architecture/*.svg` are generated files, and D2 embeds a subset of
Adobe's Source Sans Pro into each one as base64 WOFF — that is how the renditions display
identically without a network call. Those subsets travel with every clone of this
repository, so the OFL's notice requirement attaches to them exactly as it does to Geist.
D2 itself does not: it is a development dependency that renders the files at author time,
and none of its own code ends up in them.

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
| Next.js, React, React DOM client runtime | `vercel/next.js`, `facebook/react` via npm | Vercel, Meta and contributors | MIT | **Yes** — copyright + permission notice | Yes |
| PhotoSwipe 5.4.4 (JS + CSS) | `dimsemenov/PhotoSwipe` via npm | Dmitry Semenov | MIT | **Yes** — copyright + permission notice | Yes |
| `architecture` skill (project-adapted derivative) | `anthropics/knowledge-work-plugins` | Anthropic | Apache-2.0 | **Yes** — license copy, retained notices, state changes | Yes |
| `security-review` skill (project-adapted derivative) | `affaan-m/ECC` | Affaan Mustafa | MIT | **Yes** — copyright + permission notice | Yes |
| Source Sans Pro subsets embedded in `docs/architecture/*.svg` | Adobe Source Sans Pro, vendored by D2 and subset into each generated SVG | Adobe | OFL-1.1 | **Yes** — notice + license must accompany redistribution | Yes |
| Demo photographs (`public/gallery/`, 6 files) | OpenAI services | Project author (assigned) | Project MIT | No | Yes — see below |

Attribution for all seven is in the root `NOTICE` file; full license texts are in
`licenses/`.

These are the only npm packages whose bytes reach a browser. The framework runtime is
listed because the test above is where code ends up, not who emitted it: a deployed site
serves React and the Next.js client runtime to every visitor, so their MIT notice has to
travel with it exactly as PhotoSwipe's does. PhotoSwipe is the one this project chose
deliberately — see [ADR-0001](adr/0001-lightbox-library.md) — and it has no dependencies
of its own.

Verifying the list, rather than trusting it: `.next/static/chunks/` after a production
build is the complete set of bytes a browser receives. Anything third-party found there
and absent from this table is an audit gap.

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

Except the three in the shipped table above — the Next.js and React client runtimes and
PhotoSwipe — whose bytes are served to browsers. They remain in the counts below, since
those describe the installed tree.

`@terrastruct/d2` (MPL-2.0) was added in AB#133 and is not reflected in the counts
below. It is the WASM build of the D2 diagram engine, pinned to an exact version so the
lockfile decides which renderer produced the committed SVGs in `docs/architecture/`. It
is a development dependency that runs at author time and in CI: nothing in the
application imports it, and its own code is not part of what it renders — the generated
SVGs contain diagram geometry and an embedded font subset, not D2. MPL-2.0 is file-level
copyleft over D2's own source files, which this project neither modifies nor
redistributes.

`parse5` (MIT) and its one dependency `entities` (BSD-2-Clause) were added in AB#137 and
are not reflected in the counts below. They are development dependencies used only by the
owner-run Joomla migration tooling (`npm run convert:joomla`, `scripts/joomla-*.mts`):
nothing under `src/` imports them, they are not in the production dependency tree, and
their bytes never reach a browser. The stated need is the allow-list guarantee that
tooling makes — that every construct in a legacy body is explicitly converted, explicitly
recorded as lossy, or refused, with no silent fourth category. Deciding that requires the
source to be parsed the way a browser parses it, including unclosed tags, entities, and
mixed content; hand-rolled or regex handling would make "unsupported" mean whatever the
pattern happened to miss. parse5 is the WHATWG-spec reference parser and is what
`jsdom` and Angular use for the same reason. Both licences are permissive and would only
require their notices if the distribution model changed to shipping the dependency tree.

`sharp` (Apache-2.0) was added in AB#137 and is not reflected in the counts below. It is a
development dependency used only by the owner-run Joomla migration write tool
(`npm run write:joomla`, `scripts/write-joomla-content.mts`,
`scripts/joomla-image-derivative.mts`): nothing under `src/` imports it, it is not in the
production dependency tree, and its bytes never reach a browser — it was already present
as a transitive optional dependency of `next` (for the framework's own image optimizer),
and is now also a direct devDependency. The stated need is generating the one public
web-delivery derivative a migrated photograph may publish: resized to this project's own
2048px public-delivery ceiling, never cropped, never upscaled (`AGENTS.md`'s hard rules),
with EXIF orientation applied and EXIF/GPS metadata stripped before upload. `sharp` is a
thin binding over `libvips`, the same image-processing library this project's own
production `next/image` optimizer already uses at runtime, so this migration tool needs
no second image library and no new runtime dependency.

`server-only` (MIT, published by the React team) was added in AB#39 and is not reflected
in the counts below. It is a marker package: inside a React Server Component build it
resolves to an empty module, and anywhere else it throws on import — which is the whole
mechanism, since that throw is what turns a Client Component importing a server module
into a build error. Its bytes therefore never reach a browser by construction, so it does
not cross the redistribution line drawn above. Its MIT notice would apply if the
distribution model ever changed to shipping the dependency tree.

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

No package is under a copyleft license that would reach the application source. Five
warrant a note if the distribution model changes:

| Package | License | In production tree | Why it is flagged |
| --- | --- | --- | --- |
| `sharp` (`@img/sharp-*`) | Apache-2.0 AND LGPL-3.0-or-later | Yes | LGPL obligations attach on binary redistribution. Runs server-side only; never sent to browsers |
| `caniuse-lite` | CC-BY-4.0 | Yes | CC-BY requires attribution when the data is redistributed. Build-time data, not served |
| `axe-core` | MPL-2.0 | No (dev) | File-level copyleft; dev tooling only |
| `lightningcss` | MPL-2.0 | No (build) | File-level copyleft; build tooling only |
| `@terrastruct/d2` | MPL-2.0 | No (dev) | File-level copyleft; renders documentation at author time |

## Open items

| # | Item | Status |
| --- | --- | --- |
| 1 | `skills-lock.json` records four skills but only two are vendored here; `computedHash` is not reproducible as a content hash and cannot be used to verify provenance. | Replace with pinned commit SHAs, or trim to what the repo actually contains |
| 2 | Distribution model unratified. | Blocked on AB#42 |

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

## Default scaffold favicon (AB#43, found and fixed 2026-09-13)

`src/app/favicon.ico` was still `create-next-app`'s own scaffold default: Vercel's
triangle wordmark (verified by extracting and viewing the icon's embedded 256×256
frame, not assumed from the filename). This is Vercel's own brand mark, not this
project's, and had never been noticed, replaced, or recorded in this audit — every
clone was shipping another company's logo as its own site's favicon by default, which
this project's own "keep it generic" hard rule (`AGENTS.md`) does not permit for any
identity, including one this project did not choose.

Replaced with a plain, brand-free concentric-circle lens glyph (project-authored SVG,
rendered to the four sizes the original `.ico` carried: 16/32/48/256px). It is a
placeholder, not a finished brand mark — recorded here, not silently fixed, so a
clone knows to replace it with the photographer's own icon, exactly like the demo
photographs above. No license or attribution applies; it is original work under the
project's MIT license, same as `src/`.

## Original gallery boundary fixtures (AB#157)

`public/gallery/layout-panorama.*.webp` (2048×256) and
`public/gallery/layout-portrait.*.webp` (256×2048) are project-authored geometric
gradients with a thin frame, generated for aspect-ratio boundary verification.
They contain no third-party imagery, watermark, signature, branding, or URL.
They follow this repository's license and commercial-use terms; no additional
attribution or third-party license applies. Each filename includes its content
hash, and `src/lib/mock-gallery-boundaries.ts` records its true dimensions.
