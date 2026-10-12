# AB#255 — Category description language inventory, 2026-10-12

The owner requested independent continuation worktrees after PR #347 and #348
merged. This scope covers optional descriptions on the 12 published shared
categories. Labels/slugs and all-page acceptance remain separate requirements;
AB#255 stays Active.

## Observed coverage

| Optional description pair | Categories |
| --- | ---: |
| Both FI and EN | 8 |
| FI only | 1 |
| EN only | 1 |
| Absent in both | 2 |

The 18 locale entries contain 27 paragraph blocks and 33 inline spans. All
observed blocks/entries conform to the restricted description shape and bounds,
with unique languages/span keys and nonempty text. Two links are root-relative;
there are no external links or inline marks in this snapshot. Their actual
destinations and selected-locale equivalents have not been resolved.

The reader selects only the requested-language description and does not fall
back to another language. Optional absence in both is not a translation gap.
The two one-language cases need editorial review of intended differences and
any counterpart copy; this inventory does not automatically require identical
descriptions or declare the existing wording accepted.

The retained English proposal for the FI-only category still matches its whole
current source document and revision. It remains a local, unaccepted suggestion;
no competing proposal or English CMS field is created. The EN-only description
is a new Finnish-copy review candidate. Missing English label/slug on the
previously inventoried shared category still blocks its dependent article
placement; optional description presence does not resolve that requirement.

## Evidence and authoring gate

Window: **2026-10-12T12:08:59.015Z → 12:08:59.653Z UTC**. Two complete anonymous,
non-CDN `published` reads use API `v2025-02-19` and the previously verified
production target. Counts before/after, `_id`/`_rev` sets and payloads match.
Scoped source fingerprint:
`ec7e7e40e63426ee2c338f137a0a8d4d2a650ae7351738604217944d4324446c`.

Both source graphs, queries, the complete FI/EN matrix, prior hash-bound proposal
and validation are ignored under this worktree's `temp/bilingual-continuation/`.
Actual labels/slugs/descriptions, provider identities/revisions and short-copy
hashes remain outside Git. No credentials, image URLs/bytes or private content
were requested. Newer draft/release bodies were not queried; their presence is
unknown, not assumed absent. Preserve the owner-only evidence before retirement.

The schema permits localized paragraphs/lists and bounded text spans with
restricted marks and root-relative/http(s) links; it does not use article body
blocks or Portable Text annotations. Future authoring must conform to those
rules, reconcile draft/release state and accept wording before publication.
AB#125's linked article/gallery action does not update shared categories. The
existing owner-run category writer uses `createIfNotExists`, so it does not
add English entries to this already-existing category.

Refresh retained Sanity identity/revision bindings and coordinate
[ADR-0030](../adr/0030-legacy-identity-retirement.md)'s operational gates before
any later edit; a domain-ID rewrite or changed revision invalidates the old
proposal binding. AB#260's Proposed policy is not writing or freeze approval.
No CMS write, accepted translation, publication or runtime change occurred.
Matching sources, restricted shapes/bounds, proposal fidelity, private-value
exclusion, local links and whitespace are checked. Application tests/build were
not rerun for this prose-only inventory; main CI #824 at `811acc8` verifies its
merged starting commit.
