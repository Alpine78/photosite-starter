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
locale choices while retaining English (`en-US`). After signing in, use the
labelled **Interface language / Käyttöliittymän kieli** selector below the toolbar.
Sanity 6.18.0 disables its built-in language menu; `locale-navbar.tsx` supplies
this control through the configured navbar extension. The SDK stores the choice
in its existing per-project preference store. No site-content locale is changed.
The bridge uses the SDK's exported, internally marked `useLocale` hook: keep the
version pinned and repeat the authenticated switch/reload check on SDK upgrades.
The same wrapper translates the default Structure/Releases menu titles while
preserving custom tool titles and all default menu behavior. The HTML language
also follows the selected interface language.
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

## Checking Finnish interface text

The project's seven additional core resource bundles fill the 159 missing keys
observed in the pinned Finnish package. The Finnish core plugin registers the
language; the navbar above exposes its selection. Adding resource text enables
no new Studio tool.
See [the source and engine checks](../docs/audits/ab255-studio-core-locale-additions-2026-10-12.md).
The owner must still check the views actually used while signed in.

Run the headed test browser from the repository/worktree root:

```bash
npx playwright install chromium
node scripts/open-studio-test-browser.mts "http://localhost:3333/"
```

Start the local Studio first, or supply the intended deployed HTTPS Studio URL.
The computer needs a graphical browser session. Sign in yourself using the
project's normal login provider. Never send a password, token or exported cookie
file to the agent. The separate profile stays in ignored
`temp/studio-browser/profile`; local debugging uses `127.0.0.1:9222`.
Close the test window when done. Do not copy its profile, recordings or network
responses into repository or CI artifacts.

With the repository in WSL, a headed Linux browser may have no visible Windows
window. The VS Code embedded browser has a separate login session. For the
authenticated check on 2026-10-13, the owner used a native Windows Chrome window
with a separate temporary profile and the local Studio at `http://localhost:3333`.
That check verified switching, native select keyboard operation and preference
persistence after reload. It also found remaining upstream/editor metadata and
screen-reader text gaps; see the [authenticated UI receipt](../docs/audits/ab255-authenticated-studio-locales-2026-10-13.md).

General album-image alt/caption authoring remains deferred until after MVP.


## Editing content

Project-owned form titles, help text, option labels, preview fallbacks and custom
validation messages have Finnish presentation adapters. They use the active
Studio locale; canonical schemas, stored values and identifiers stay unchanged.
The Finnish locale choice is supplied by the core locale plugin.
Unknown future strings retain their source text. Actual authored preview titles
and slugs are never translated as interface fallbacks.

Source validation is recorded in [the schema locale audit](../docs/audits/ab255-studio-schema-locales-2026-10-12.md).
Authenticated visual verification and translation-wording acceptance remain
pending. General album-image captions and alt authoring are deferred until after
MVP; this adapter does not generate them.

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

Shared-media names use an existing authored caption, falling back to alternative
text. The interface language is preferred, then FI/EN and stable language order;
the subtitle names the language actually used and retains any credit. Missing
descriptions are marked explicitly. Filenames and internal identifiers never
become substitute titles. This changes no image bytes or authored text.

Permanent identifiers live at the end of the form in the native **Tekniset
tunnisteet / Technical identifiers** group. It starts expanded because new
documents need manually entered identifiers; existing-content editors can
collapse it. Field names, uniqueness/immutability validators and reference
bindings remain unchanged. Titles and URLs are edited in their ordinary fields.

The accepted [identity-retirement decision](../docs/adr/0030-legacy-identity-retirement.md)
and [operational policy](../docs/adr/0031-identity-migration-operational-plan.md)
rename domain identifiers while preserving Sanity document `_id`/`_ref` and
history. [AB#301](https://dev.azure.com/ilkkarytkonen/photosite-starter/_workitems/edit/301)
tracks the remaining outcome alongside AB#257/260. This presentation slice does
not rename stored values, public references or document URLs.

| Existing implementation | Still required before retirement |
| --- | --- |
| Offline reconciliation and revision-bound change/alias planners (AB#258/259/265) | Fresh source reconciliation, approved current inputs and restore evidence |
| Pinned alias resolver, bounded published loader and deployment-settings validator (AB#261/263/264) | Alias schema/write path, reader integration and pinned payload activation |
| Accepted legacy-writer retirement and maintenance policy (AB#260) | Writer guards, tested maintenance boundary, conditional writer/receipts/rollback and isolated rehearsal |

These helper modules do not establish a completed live migration. Preserve the
historical import plans and recovery records. New readable identifiers must still
be minted once and remain stable after later title, slug or translation edits.

The application-registry read on 2026-10-16 reports an active Studio deployment
from 2026-10-11 (6.18.0), before [PR #339](https://github.com/Alpine78/photosite-starter/pull/339)
merged the existing readable placement/category previews on 2026-10-12.
Updating repository code alone cannot update that hosted editor: a separately
reviewed Studio publication and authenticated list/header/picker/creation check
remain necessary. This branch performs neither publication nor a CMS write.

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

### Localized array accessibility

The Sanity 6.18.0 array renderer does not forward accessibility options to its
DndContext. The exact Vite alias in sanity.cli.ts supplies localized instructions
and announcements through that API, re-exporting the native module so sortable
consumers share its contexts. @dnd-kit/core 6.3.1 was already installed; its direct
dependency declaration adds no package version. Recheck this bridge on SDK upgrades.
The finalization receipt is [here](../docs/audits/ab255-studio-drag-localization-2026-10-13.md).
