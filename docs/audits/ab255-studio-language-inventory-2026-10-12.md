# AB#255 — Standalone Studio language discovery, 2026-10-12

After PR #353 merged as `f0d3e50` with required CI #835, this continuation
examines the Studio interface under the owner's all-pages FI/EN requirement.
AB#255 remains Active. This is source/package discovery; it does not implement
or establish a fully translated Studio.

## Three separate text layers

| Layer | Observed source | Remaining work |
| --- | --- | --- |
| Sanity core interface | Studio pins `sanity@6.18.0`. Its configuration registers `structureTool`; no Finnish locale plugin or project resource bundle is configured. | Verify a pinned Finnish plugin in an isolated Studio, applicable missing keys, wording, interpolation and real FI/EN journeys. |
| Project interface | Structure labels, schema titles/descriptions, editorial preview fallbacks and custom validation text are application-owned source strings. | Verify the supported locale APIs and supply generic project dictionaries/adapters; preserve schema field names, stored identities, previews, validators and authentication behavior. |
| Authored content | The content's stored locale/text remains governed by the existing independent FI/EN authoring and publication contracts. | Continue the separate page/content/media inventories and owner review. Interface-language selection does not supply missing authored translations. |

[Sanity's localization guide](https://www.sanity.io/docs/studio/localizing-studio-ui)
explicitly limits core localization to the Studio UI; schema text and customizations
remain project-owned. It documents resource bundles for string overrides. The
[Finnish package README](https://github.com/sanity-io/locales/tree/main/locales/fi-FI)
describes the user-menu language option and community maintenance; wording still
needs human review. No private Studio session or actual rendered screen was examined.

## Pinned package comparison

Candidate: **`@sanity/locale-fi-fi@1.1.40`**, MIT, published 2026-08-25.
The registry's observed latest tag is also `1.1.40`. Its declared Sanity peer range
is `^3.22.0 || ^4.0.0-0 || ^5.0.0-0 || ^6.0.0-0`; it accepts the project's pinned
`6.18.0`. Declared compatibility does not establish runtime compatibility.

Both exact npm archives matched their published SHA-512 integrity values. Their
compiled JavaScript was parsed as inert text with the available TypeScript parser;
no downloaded module or dependency lifecycle script was executed. The comparison
includes both normal resource-helper tables and the separately registered plain
`variants` table, which would be missed by a helper-only scan.

| English namespace | English keys | Defined matching FI literals | Missing FI keys |
| --- | ---: | ---: | ---: |
| `canvas` | 27 | 26 | 1 |
| `comments` | 78 | 76 | 2 |
| `copy-paste` | 26 | 25 | 1 |
| `feedback` | 21 | 21 | 0 |
| `media-library` | 5 | 5 | 0 |
| `presentation` | 65 | 65 | 0 |
| `releases` | 257 | 247 | 10 |
| `singleDocRelease` | 10 | 10 | 0 |
| `structure` | 347 | 342 | 5 |
| `studio` | 1,085 | 1,053 | 32 |
| `tasks` | 75 | 75 | 0 |
| `validation` | 47 | 47 | 0 |
| `variants` | 108 | 0 | 108 |
| **Total** | **2,151** | **1,992** | **159** |

The remaining 51 gaps are in namespaces supplied by the Finnish package; the
`variants` namespace is absent entirely. The Finnish package additionally carries
`vision`, outside this comparison with the pinned core package. Undefined entries
are excluded, matching the package's resource-removal helper. Twenty-six paired
values are identical; neutral technical strings may legitimately match.

These are exact package-key sets, not counts of visible messages or accepted
translations. Optional tools/feature flags, permissions, fallback behavior,
plural/interpolation handling and actual screen reachability were not evaluated.
The key totals do not imply that every packaged feature is enabled in this Studio.

## Project-owned source observations

A coarse AST inventory reads 39 non-test Studio/schema source files. It finds
321 literal `title` property occurrences, 135 literal `description` occurrences
and one literal structure-builder title call. This counts literal properties and
that one builder-call form; strings supplied through other arguments or variables
are not enumerated as builder-call labels.

There are also 54 literal-return and 58 template-return candidates in schema
sources. These can include program values; they are not an exhaustive or unique
validation-message catalog. Conditional messages, dynamic preview expressions,
JSX text and rendered reachability need their own checks. The source inventory
records locations and whole-file hashes privately; it makes no language-quality
or complete-string-coverage claim.

## Next implementation slices and evidence

Full bilingual-Studio readiness is not established. A useful next slice is an
isolated pinned core-plugin integration with FI/EN switching and applicable gap
review. Project schema/structure/preview/validation localization then needs its
own verified API design and small working slices. Preserve existing content
language values, stable identifiers, singleton/editorial restrictions, full-frame
previews and the Studio's separate authentication/deployment boundary.

Before declaring completion, verify actual authenticated FI/EN author journeys,
language persistence/fallbacks, validation and publishing controls. Adding the
core locale plugin alone cannot satisfy the project-owned text layer. No existing
authored article, gallery or shared-media wording is accepted by this inventory.

The ignored owner-only `temp/bilingual-continuation/` packet retains exact registry
metadata, integrity-verified archives, inert extracted files, namespace/key sets,
AST analysis scripts, source-location inventory and evidence hashes. The analysis
parser is the available local TypeScript `5.9.3`; it is not the Studio's pinned
compiler or a new dependency. Existing one-time plan review is retained.

Registry/archive integrity, key-set/count consistency, source hashes, peer range,
local documentation links, privacy and whitespace are checked. Application/Studio
builds and journeys are not rerun for discovery documentation alone; runtime and
authenticated UI proof remain future gates. No package installation, lockfile,
schema/configuration, CMS request/write, Studio login, deployment or activation
occurred in this slice.
