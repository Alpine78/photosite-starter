# AB#280 — exact published English Blog alias, 2026-10-13

The owner-approved eighteen-article publication makes `/en/stories/blog` a real
public category. Its current-source production-build page returns 200 with the
reviewed Blog heading, canonical and Finnish counterpart; the independently owned
and protected CI 941 Preview also now returns 200/noindex there. The publication
is documented by AB#279 in its separate evidence branch.

AB#19 requires an exact same-language canonical replacement when available.
The one source-bound AB#271 row for `/en/blog` therefore changes from an explicit
English-home unavailable-content fallback to a direct **301 → `/en/stories/blog`**.
The default redirect no longer adds an unavailable notice. An exact comparison
against source `8932116` proves every other byte of the mapping file is unchanged.
All source identities, query policies and 415 inventory classifications are preserved:
232 redirects, 179 Gone, zero pending, three excluded and one already live.

The existing source-bound tests now distinguish the available Blog category from
still-unavailable legacy service offers. Generic redirect/request code, fallback
rendering, Finnish paths and the distinct over-twelve-hour package are unchanged.
No CMS, asset, credential, DNS, deployment or alias mutation occurs in this branch.

## Validation and release limit

Lint, all 6,061 browser-free tests and an actual-CMS production build/type check pass.
The production-harness legacy and fallback suites pass 132 Chromium/WebKit cases
with four data-dependent skips. Harness data is synthetic. A separate existing
real-content probe verifies the actual `/en/blog` source 301, direct target 200,
parameter-free default Location and canonical agreement, with no probe issues.
Its private receipt has SHA-256
`b790ccad0fe227e056d01830c5db43438c453fb05a52b26953d3a0e3d70ac6da`.

The scoped security check found no new issue in this fixed same-origin data update;
request/query boundaries and shared engine remain unchanged. This is not the final
hosted security/privacy review. The current older Preview source does not acquire
this mapping by a CMS publication; final integrated deployment and all 415 deployed
canonical checks remain separate gates.

AB#280 is Active pending owner review/merge. Parent AB#19 and final launch, supported
whole-ZIP transport, rollback/handoff and security/privacy acceptance remain open.
