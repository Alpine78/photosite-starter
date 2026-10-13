# AB#278 — Studio sprintf-js exposure investigation, 2026-10-13

The current installed formatter is vulnerable, but this investigation found no
browser-facing call path in the compiled Studio reviewed here. The exact dependency
enters through local CLI framework tooling and an unused YAML command-line formatter.
This narrows the launch decision; it neither patches the package nor accepts the
residual risk or dismisses Dependabot alert #66.

## Fresh advisory and dependency evidence

A fresh network-backed audit of the unchanged Studio lockfile reports eight moderate
affected dependency nodes, zero high and zero critical. They propagate the
[reviewed advisory GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c):
an attacker-controlled format string can pass excessive precision to numeric formatting
and cause an uncaught RangeError. The advisory covers versions through 1.1.3 and lists
no patched version as of this review. The installed path is:

`sanity 6.18.0 → @sanity/cli 8.16.0 → @vercel/frameworks 3.29.0 →
js-yaml 3.15.2 → argparse 1.0.10 → sprintf-js 1.0.3`.

Frameworks declares js-yaml 3.13.1, but the existing reviewed Studio override resolves
it to 3.15.2. The investigation verified actual module resolution, rather than
treating the declared version as the loaded one. npm proposes a Sanity 5.14.1 major
downgrade; it was not applied. No dependency or lockfile was changed.

## Actual local call paths

Installed `@vercel/frameworks/dist/read-config-file.js` imports the normal `js-yaml`
module and calls `safeLoad` for YAML configuration. `js-yaml/index.js` exports the
library loader/dumper. It does not import its `bin/js-yaml.js` executable. That
separate executable imports argparse and constructs its usage/help strings from
fixed package code. Argparse reaches sprintf through usage, explanatory text and
action help; its two explicit-argument error calls use a fixed format string with
the argument passed as a value. Format-string ownership matters for this advisory.

A fresh Node process imported the actually resolved YAML library and parsed synthetic
precision-looking YAML data. The value remained data; the newly loaded module cache
contained neither argparse nor sprintf-js. A separate caught synthetic call to the
installed sprintf-js using `%.101f` threw RangeError on the pinned Node 24 runtime.
This reproduces the affected behavior locally without crashing the process, touching
customer data or exercising a provider. It does not claim the library is safe.

The application source and Studio configuration introduce no formatter import.
Existing project-controlled CLI/schema/plugin code must remain trusted and reviewed;
this investigation does not certify arbitrary future plugins or untrusted CLI help
configuration, or prove safety of every local CLI command.

## Actual Studio browser build

A local build of merged source `c32d1e8` used public synthetic connection settings,
telemetry denial and the pinned CLI's `--source-maps` option. No CMS read/write token
or deploy operation was used. The build succeeded and emitted 325 JavaScript files.
The 321 JavaScript source maps contain 2,115 source entries. None identifies
sprintf-js, argparse, js-yaml, @vercel/frameworks or @sanity/cli.

All four files without maps were separately inspected: two 47-byte re-exports,
the 1,519-byte preload helper and the 716-byte module interop runtime. Their code
contains no vulnerable formatter fingerprint or numeric precision calls. The private
evidence retains their hashes/full code and hashes for every reviewed source map.
Source maps and synthetic output remain ignored and were not deployed.

This is affirmative evidence for the observed compiled browser graph and YAML-library
path, not a package-level remediation or a repository-wide security scan. It does not
establish a final hosted Studio identity or the final integrated release's bundle.
New dependency/plugin/build changes require repeating the analysis.

## Residual decision and validation

The smallest supported continuation is to keep the alert visible, monitor the
upstream remedy and keep CLI/configuration code under trusted operator control.
If the owner chooses to accept this current scoped tooling risk for launch, that
decision must name the advisory, exact versions/source and observed browser exclusion,
retain the future-upgrade/review condition, and remain separate from final hosted
security/privacy acceptance. No acceptance or advisory dismissal has occurred here.
An unreviewed major downgrade or API-incompatible YAML override is not a verified fix.

Private evidence receipt SHA-256:
`bf37d254221cc9f6e543480a3760bff69cf2c8f6fb87806ac0758d5e8ccda90e`.
Unmapped-script review SHA-256:
`f52e33cfd855c5ebbabe2eefaa7c22be0a75a2573f0a7e3caf613042fb7f6034`.
Fresh audit SHA-256:
`8469e1ee9f09960cf13acb77e9c467fe7278bf87501f5be2e85478a7c01650c1`.

Validation consists of the fresh audit/resolution/static call-path review, caught
precision reproduction, YAML import-cache observation, actual Studio build and all
emitted script/map checks. Documentation introduces no runtime patch or dependency;
no implementation unit suite is claimed as proving this exposure boundary. AB#278 is
Active pending evidence PR review/merge. AB#117 and final risk/launch acceptance stay
open; no provider, credential, CMS, DNS or deployment setting changed.
