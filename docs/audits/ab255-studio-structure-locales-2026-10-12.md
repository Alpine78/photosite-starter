# AB#255 — Studio structure titles, 2026-10-12

This slice adds English (`en-US`) and Finnish (`fi-FI`) resource bundles in the
project-owned `photosite-editorial` namespace. It connects 11 generic titles to
the root content list, home/site-settings singleton entries and document panes,
and eight editorial list entries and child panes. The original English titles
remain as stable fallbacks. Initial checked baseline: `ce43481`; Sanity is pinned
to 6.18.0. The worktree then fast-forwarded to `3da712b`; only documentation changed
between those main commits, so tested Studio, schema and package inputs remain.

The implementation uses the documented [resource bundle configuration](https://www.sanity.io/docs/studio/internationalizing-plugins-ui)
and [Structure Builder title localization](https://www.sanity.io/docs/studio/structure-builder-reference),
checked against the installed version's declarations and builder implementation.
It uses the existing dependency; package manifests and lockfiles are unchanged.
The Finnish dictionary is checked against the English key set by TypeScript.

## Checked gates

- Root lint and Studio typecheck passed.
- Schema validation reported zero errors; the static Studio build passed on
  existing CI synthetic settings and emitted 895 installed-package notices.
- All 55 focused editorial policy, readable preview and image-selection tests
  passed in three files.
- A local contract check executed the old and new structure resolvers with the
  actual pinned Sanity builders and a synthetic read client. It checked 21
  localized nodes, both bundles and all 11 resource keys, preserving actual
  document IDs, schema types, filters, sorting, menus, synthetic templates and
  singleton resolution. Optional whole-type count descriptors still agree.
  Sanity's generated divider counter was excluded from stable document-ID
  comparison. All four singleton reads were synthetic; there was no CMS request.

The source keeps the existing singleton raw-perspective query and error policy,
editorial action/template restrictions, and full-frame public image previews.
Canonical schemas, authored content, access rules and application source did not
change. No new dependency, credential, CMS write or deployment is introduced.

## Remaining acceptance

Resource bundles translate these project-owned titles; they do not register a
Finnish core UI locale choice. That activation is a separate slice. Until it is
integrated, the current main configuration retains its existing available core
locale. The translation resources are ready for `fi-FI` when configured.

Verify owner-authenticated switching, actual title rendering and wording before
deployment. This source/build check does not establish browser persistence or
translation quality. Schema field titles/descriptions, preview fallback strings,
custom validation messages, authored content and hosted authentication remain
separate work. A source inventory count is not a claim of complete visible UI.

AB#255 remains Active. The owner instructed this continuation to proceed without
Claude; source review and applicable checks were completed locally. The ignored
handoff retains the exact source/build hashes, synthetic contract check and logs.
