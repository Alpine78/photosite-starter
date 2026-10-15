# AB#43 — dependency license metadata refresh, 2026-10-15

Status: partial audit evidence; AB#43 remains Active. Source baseline is
`eabbc5d4f13a342f6bd0d68c7f211d2cc046b734` (includes search #415 and documentation #416).
Node 24.20.0 / npm 12.0.2 were observed. No dependency or license text changed.

## Scope and counting rule

Count every non-root, non-link entry in each committed v3 lock independently,
including optional packages for other platforms and nested copies. These are
**lock entries, not installed packages, unique package names, browser bytes or
legal clearance**. Do not compare them directly with the dated installed-tree
counts in the [inventory](../asset-inventory.md). Studio remains a separate app.

| Tree | Entries | Lock SHA-256 |
| --- | ---: | --- |
| Public site/tooling | 841 | `81a7175c5e2d6d3347ac099fec2db38e56e187908cfb22ab7ac88f39eb880d35` |
| Standalone Studio | 940 | `b706f683fc5c67262169ce47b175124cda8a7432ed8d7fc36345236256c4e853` |

| Declared expression (unchanged) | Root lock | Studio lock |
| --- | ---: | ---: |
| `(Apache-2.0 WITH LLVM-exception)` | 1 | 0 |
| `(MIT OR CC0-1.0)` | 0 | 2 |
| `(MPL-2.0 OR Apache-2.0)` | 0 | 1 |
| `0BSD` | 2 | 1 |
| `<missing>` | 1 | 1 |
| `Apache-2.0` | 92 | 57 |
| `Apache-2.0 AND LGPL-3.0-or-later` | 3 | 0 |
| `Apache-2.0 AND LGPL-3.0-or-later AND MIT` | 1 | 0 |
| `BSD-2-Clause` | 9 | 13 |
| `BSD-3-Clause` | 5 | 10 |
| `BlueOak-1.0.0` | 9 | 10 |
| `CC-BY-4.0` | 1 | 1 |
| `CC0-1.0` | 1 | 1 |
| `ISC` | 36 | 39 |
| `LGPL-3.0-or-later` | 10 | 0 |
| `MIT` | 637 | 788 |
| `MIT-0` | 0 | 2 |
| `MPL-2.0` | 32 | 13 |
| `Public Domain` | 0 | 1 |
| `Python-2.0` | 1 | 0 |

SPDX `AND`/`OR` expressions are kept intact. Missing or informal declarations
need the original package texts; no expression is inferred from a parent package.
Two missing lock declarations were checked against matching installed versions:

- Root `@vercel/cli-auth` 0.3.9: package metadata has no license field; its
  `LICENSE` contains Apache-2.0, copyright 2017 Vercel, Inc.
- Studio `md5-o-matic` 0.1.1: legacy `licenses` array declares MIT; the shipped
  `LICENSE` carries the MIT permission text and copyright 2014 Trent Millar.

These observations do not update the locks. MPL, LGPL/libvips, CC-BY data and
Apache notice obligations still require the existing distribution/bundle review.
The public site's last browser-bundle audit is historical; no fresh bundle
composition or commercial-deliverable approval is claimed here. Studio's build
still generates its conservative installed-tree notice artifact through
`scripts/write-studio-notices.mts`; that artifact was not rebuilt in this pass.

## Reproduce the metadata census

From the reviewed checkout, without installation, network or package scripts:

```sh
python3 - <<'PYCODE'
import collections, hashlib, json, pathlib
for name in ('package-lock.json', 'studio/package-lock.json'):
    path = pathlib.Path(name)
    packages = json.loads(path.read_bytes())['packages']
    entries = [v for k, v in packages.items() if k and not v.get('link')]
    counts = collections.Counter(v.get('license', '<missing>') for v in entries)
    print(name, len(entries), hashlib.sha256(path.read_bytes()).hexdigest())
    for license, count in sorted(counts.items()):
        print(license, count)
PYCODE
```

The original demo-photo provenance, fonts, skills and notices remain recorded in
the inventory; this census neither re-creates provenance nor grants new rights.
The scaffold favicon entry is historical: #413 removed the static `.ico`; the
current route uses the settings-owned logo or the existing project-authored
brand-free PNG fallback. No new third-party icon was introduced.

AB#42's distribution decision is still Proposed. Before AB#43 closes, resolve that
boundary and verify any actual shipped bundle/paid artifact with the required
notices. No owner or professional acceptance is inferred from metadata counts.
