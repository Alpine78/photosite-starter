# PhotoSite security-patched `braces`

This is a small, temporary fork of upstream `braces` 3.0.3. It retains the upstream
MIT license in `LICENSE` and all runtime source except for one parser guard.

The parser now rejects brace or parenthesis group nesting deeper than 100 before
recursive compilation or expansion can exhaust the Node.js call stack. The package
version `3.0.4-photosite.1` identifies this local patch; it is not an upstream
release.

The patch addresses [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
As checked on 2026-10-07, the advisory lists no upstream patched version and its
maintainer issue remains open: https://github.com/micromatch/braces/issues/70.
Replace this fork with a supported upstream fix when one is available, after
verifying its behavior and removing the local package override.

`scripts/braces-security.test.mts` exercises normal expansion and deep-pattern
rejection through the copy installed for `micromatch`. Rebuild the locked tarball
after source changes with `npm pack vendor/braces --pack-destination vendor`.
