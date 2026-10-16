# AB#19 — current-source redirect reconciliation, 2026-10-15

AB#19 remains Active. This pass checks committed source at `eabbc5d` (after #413,
#415 and #416), not the source/configuration serving any public alias. No live
origin, CMS, DNS or redirect mapping was changed or queried.

`npm run verify:legacy-redirects -- report` reports all 415 distinct inventory
paths: **232 redirects, 179 Gone, zero pending, three excluded and one already
live**. The 442 original crawl records collapse to those 415 paths. These counts
match the [October 13 final decisions](ab271-remaining-legacy-decisions-2026-10-13.md);
older 37/48-pending checkpoints no longer describe current source. Zero pending
classifications is not proof that every deployed target works.

## Validation

The following existing suites passed: **5 files / 251 tests**:

```sh
node /path/to/installed/vitest/vitest.mjs run \
  src/lib/legacy-redirects.test.ts \
  src/lib/locale-routes.test.ts \
  src/lib/locale-prefix-request.test.ts \
  scripts/legacy-redirect-verification.test.mts \
  scripts/legacy-target-probe.test.mts
```

The executable path selects the existing dependency installation; all test inputs
and the project root were this worktree. No live-provider test or production build
was part of that command. The suites cover registry/engine behavior, fallback and
query preservation, target-verifier behavior, localized search namespace validation
and request routing. Existing test coverage is not a fresh hosted fallback-notice check.

A read-only scan of every report source and outcome found no path/text containing
`haku` or `search`. Thus the current registry neither directly occupies nor targets
the new configured `/haku`, `/en/search` or default `/search` namespaces. This is a
snapshot, not a new global ban on system routes or proof of all CMS slug collisions.
The existing locale-route tests retain collision rejection for search versus
stories, services, static/root namespaces and locale prefixes. No extra test
mirroring this static snapshot was added.

#413's owner-approved photographer-article move and exact old Common/article
redirects are on this baseline; its documented local real-content checks do not
prove they are deployed. #415's shared `q`/`keywords` route does not authorize
changing any historical 410 decision or forwarding old search intent to it.
Search result pages intentionally have **no canonical link**, so do not apply
the legacy fallback-notice canonical policy to search results.

## Close only after serving-source evidence

Identify and freeze the exact owned release and its deployed locale/redirect
configuration. Use the existing `verify:legacy-candidate`/`verify:legacy-redirects`
operator flow against the actual canonical origin to verify statuses, final
same-language targets, notices, query bytes, no chains and target availability.
Protected candidates require the existing authenticated verifier; this report
makes no production-origin assumption and performs no rollout. AB#297 and AB#299
release evidence remain separate from these deterministic checks.
