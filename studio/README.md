# PhotoSite Studio

Optional, standalone Sanity Studio for the site owner's account. It imports the
canonical `../sanity/schemas` directly; there is no schema copy to update. Its npm
dependencies, lockfile and static build are separate from the public Next.js site.
Node 24 is required, as in the main project.

## Local setup

From the repository root:

```bash
npm ci --prefix studio
cp studio/.env.example studio/.env.local
```

Edit `studio/.env.local` with the site's existing project, dataset and actual
dataset visibility. Copy the **complete** `SITE_LOCALE_ROUTES` into
`SANITY_STUDIO_LOCALE_ROUTES`; this derives every locale's story root for the
navigation validator. Set the Studio title for its editor header. These settings
are public browser configuration. Never copy site read/write tokens, webhook
secrets, import credentials or private-gallery credentials into this file.

In Sanity Manage, allow `http://localhost:3333` as a CORS origin with credentials
for this project. Then:

```bash
npm run dev --prefix studio
```

Open `http://localhost:3333` and sign in with a Sanity account that has permission
to edit this project/dataset. Studio uses that account's authenticated session,
including for private datasets. It has no embedded API credential and creates no
new project or dataset.

## Core interface language

The Studio registers the pinned `@sanity/locale-fi-fi@1.1.40` plugin alongside the
existing structure tool. It adds **Suomi (`fi-FI`)** to Sanity's core interface
locale choices while retaining English (`en-US`). Use Sanity's user-menu language
control after signing in; no project default or site-content locale is changed.
The registration API is documented by [Sanity](https://www.sanity.io/docs/studio/localizing-studio-ui)
and the [Finnish package](https://github.com/sanity-io/locales/tree/main/locales/fi-FI).

This is partial core-UI localization. Against pinned Sanity 6.18.0, the package
lacks 159 of 2,151 English resource keys; fallback display and Finnish wording
still need authenticated owner review. Project schema titles/descriptions,
preview fallbacks and custom validation text remain project-owned source
strings; the structure-title resources are described below. Authored FI/EN content is independent. Login/hosted chrome and language
preference persistence are not established by the static build.

See [the checked build receipt](../docs/audits/ab255-studio-core-locale-build-2026-10-12.md).
Before deploying, verify actual FI/EN switching, persistence, applicable missing
messages, wording, and normal editor/action/validation behavior with agreed test
content. This registration does not establish a fully bilingual Studio.

## Project-owned interface titles

The content root, home/settings panes and editorial lists use English (`en-US`)
and Finnish (`fi-FI`) resources in `studio/locales/`, registered in the separate
`photosite-editorial` namespace. Structure nodes keep their original English
fallback titles and stable IDs. Change the resource values to refine wording;
keep both dictionaries' keys aligned.

The pinned Finnish core plugin above makes `fi-FI` available for these title
resources. Bundle registration itself does not add a core locale.
Authored document language, schema field text, preview fallbacks and custom
validation messages are independent. Verify actual authenticated FI/EN rendering
and wording before publishing Studio. See the [build/source receipt](../docs/audits/ab255-studio-structure-locales-2026-10-12.md).

## Editing content

Home page and Site settings open the existing document identity, including an
imported document whose ID differs from its type name. A successful empty query
opens a conventional initial ID. A transport/permission error, malformed result,
full query bound or multiple different identities stops that pane; it never
creates a replacement as recovery. The normal Studio templates and document
actions prevent duplicate, delete and unpublish operations on these two types.
These are UI guardrails, not API authorization or a concurrency lock for two
editors doing initial setup. Provision initial singletons with one operator.

Services, articles, galleries, gallery images, shared media, categories, article
end galleries and polls use the existing schema forms and publication validation.
Gallery images and article end galleries are separate placement documents; assign
their container identities and required references before publishing. Capture
sequence galleries use shared media's capture-sequence fields instead of gallery
placements; see [schema guidance](../sanity/README.md).

Article and gallery list rows and reference pickers identify language versions in their subtitle
(for example, `FI · coastal-visit` and `EN · coastal-visit`). Categories use their
authored localized labels and language tags. Gallery image and article end-gallery
rows show `Image 31 · Coastal visit`, the container's language and a full-frame
thumbnail from the referenced shared media's public web image. Missing titles,
languages or positions are marked explicitly so incomplete drafts stay editable.
These preview labels are specific to this Studio; the canonical schemas keep their
existing metadata for other consumers.

An image number is the stored zero-based `order` plus one, not a computed rank in
the current visitor view. Gaps and ties remain visible as authored; a shuffled
gallery can present a different order. The document list's sorting is unchanged.
Each occurrence is its own document so large galleries can be queried in bounded
pages. FI/EN occurrences share one image asset and occurrence identity but can
carry different captions. Equal page titles likewise can represent language
siblings. A matching title alone is not evidence of duplicate content.

Content, category and placement IDs are permanent technical identities. An
imported `joomla-…` value records its origin; it does not require a running Joomla
installation. Readable previews do not rename these fields or Sanity `_id` values.
Keep them intact during source import/reimport and recovery verification. After
migration acceptance, [AB#257](https://dev.azure.com/ilkkarytkonen/photosite-starter/_workitems/edit/257)
tracks planning their replacement: inventory consumers, agree on stable names,
check collisions and every language/reference, rehearse against a restorable
snapshot, and update or retire reimport tooling before an approved write.
Sanity document `_id` cannot be patched; replacing documents also requires
rewriting references and assessing history/recovery consequences. See
[Sanity's ID contract](https://www.sanity.io/docs/content-lake/ids).
New readable identities must still be minted once and remain stable after later
title, slug or translation edits.

Upload only prepared public web derivatives, at most 2048 pixels on the longest
edge. Assets have public URLs from upload, including in a private dataset. Never
upload camera masters, protected client-gallery files or sales assets. The
existing schema retains its native-image/no-crop and filename-removal controls.
Editorial list/reference previews show complete images, including portrait and
panoramic assets, with bounded `fit=max` thumbnails and contained rendering.

The retained legacy-delivery types remain in the canonical schema but have no
navigation, creation template or document action here. Their import, availability
and publication remain the separately approved owner workflow. Operational poll
receipts/tallies and protected private-client-gallery records are outside Studio.

This slice adds no public-site draft preview, translation action, AI suggestions,
category URL-change workflow, media-library plugin or bulk uploader. Existing
owner-run commands keep their documented scope. Publishing a normal document is
independent of publishing the Studio application; the site's configured signed
webhook updates its public cache after content publication.

## Checks and publication

```bash
npm run typecheck --prefix studio
npm run schema:validate --prefix studio
npm run build --prefix studio
```

Schema validation and build need the public configuration but no CMS reads or
write token. CI uses synthetic settings and disables telemetry with
`DO_NOT_TRACK=1`; it never deploys Studio. The root tests cover settings, singleton
resolution and editorial policies without installing Studio's packages.

Once the code is reviewed, select a unique hostname through the Sanity deploy
prompt or `SANITY_STUDIO_HOSTNAME` in the local configuration. From `studio/`,
authenticate the CLI if needed using `npm exec -- sanity login`, then from the
repository root run:

```bash
npm run deploy --prefix studio
```

The explicit owner command builds and publishes to `<hostname>.sanity.studio`,
requires schema deployment to succeed, and records the Studio under the project's
Studios list. After the first deployment, save its returned application ID as
`SANITY_STUDIO_APP_ID` in the ignored local file so later deployments update that
application without an application-selection prompt. Sanity hosting handles its CORS origin.
The hosted address can redirect through Sanity's dashboard to its account login.
Updates to the shared schema
need a fresh reviewed Studio build/deployment; automatic version updates are off.
No production content is imported or rewritten by this application setup.

The build includes `THIRD-PARTY-NOTICES.txt` with installed package licenses and
exact upstream artifact URLs. It covers the whole installed tree conservatively,
including tools that do not enter the editor bundle. Keep this file with the
published build. Dependency overrides and the remaining CLI-only advisory scope
are recorded in [the inventory](../docs/asset-inventory.md#standalone-studio-ab254).

After deployment, verify login with the intended account, all editorial panes,
the existing home/settings IDs, the public-dataset archive-field omission and a
normal draft/edit/publish flow on agreed test content. Verify webhook propagation
separately against the site's configured environment. A static build alone proves
none of those live checks. See [Sanity installation](https://www.sanity.io/docs/studio/installation),
[public environment settings](https://www.sanity.io/docs/studio/environment-variables)
and [hosting](https://www.sanity.io/docs/studio/deployment).
