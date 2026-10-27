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

Body-image rows use their own authored placement caption when present, otherwise
the shared media's existing caption/alternative-text preference above (AB#349).
The **Kuvakohtainen kuvateksti / Placement caption** subtitle identifies a plain
caption's source without inventing a content language. Missing references and
missing descriptions share an explicit localized fallback; full-frame thumbnails
use the same public image. Compiled synthetic tests cover the actual Studio
configuration and selected paths. Loading caption/alt arrays through references
in the hosted preview store still needs an authenticated check after publication;
offline hydrated fixtures do not establish that hosted behavior.

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

The 2026-10-18 [publication audit](../docs/audits/ab18-production-refresh-2026-10-18.md)
confirms the existing hosted app was updated from accepted main `33cb41a` after
full CI. Its active deployment is `g7gul7gnkadxlna70rzgr7ah` (6.18.0), replacing
the October 11 deployment observed on October 16. Registry identity, the fresh
hosted manifest and versioned JavaScript/CSS bytes were verified. The existing
entry redirects to Sanity Dashboard authentication; authenticated
list/header/picker/creation checks still require owner testing. This publication
does not rename stored identifiers or establish the live identity migration.

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
`DO_NOT_TRACK=1`; it never deploys Studio. The root test suite also covers native
Studio SDK/schema and GROQ contracts, so install both locked dependency trees
with `npm ci` and `npm ci --prefix studio` before `npm test`, as described in the
[root README](../README.md). These tests use local synthetic fixtures, not a live
CMS or credentials.

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

## Ongoing client galleries (AB#302 / AB#145)

The reference owner selects existing Sanity and unlisted customer pages
([ADR-0034](../docs/adr/0034-ongoing-unlisted-client-delivery.md)). The new
**Client galleries / Asiakasgalleriat** list uses the existing Sanity login and
project roles. It is separate from public portfolio galleries and the read-only
legacy import types. No S3/PostgreSQL account, custom administrator credential or
additional dependency is needed. Publishing permissions still depend on the
project's actual role configuration; no live role/editor workflow is verified here.

For a new document:

1. Keep the automatically generated, read-only link identifier. Do not put
   customer names or contact/job details in titles or other public fields.
2. Add ordered images under **Client gallery images / Asiakasgallerian kuvat**.
   Upload complete exported web copies no larger than 2048 pixels on the longest
   edge. Use neutral filenames and review embedded metadata before uploading;
   Sanity files are public immediately, including while their document is a draft.
   Add real alternative text in at least one language; further language entries
   are authored independently. The editor does not generate translations.
3. New Studio delivery galleries start with **Until a deadline / Määräaikaan asti**
   and an editable deadline **six calendar months from creation** (AB#393). The day
   clamps to the target month-end; UTC time stays the same, while the local display
   may shift across DST. Review before publishing: publication does not restart the
   clock. You can instead choose **Explicitly indefinite / Nimenomaisesti toistaiseksi
   voimassa** and clear the deadline.
   **Uuden toimitusgallerian oletus on kuusi kalenterikuukautta luomisesta. Tarkista
   määräaika ennen julkaisua: julkaisu ei aloita aikaa uudelleen.**
   [Retention and remaining automatic cleanup](../docs/client-gallery-retention.md).
   This default changes no existing gallery and deletes no files.
4. **Available to link holders / Sivu käytettävissä linkillä** is an editor-controlled
   pause setting, initially false. Publish the document to apply that setting or
   any other change. Native unpublished documents are always unavailable.

The schema checks handle collisions against both new and legacy types, preserves
published handles, and validates measured image metadata. Authored document
content is limited to 256 KiB of UTF-8 JSON, excluding Sanity-managed identity,
revision, timestamps and system metadata. Shorter translated texts may be needed
at the 256-image limit. Shared assets marked private-only are refused. These are editorial
checks, not a security boundary against direct API writes. The customer reader
must validate everything again and refuse ambiguous handles. Duplicate/restore
schema actions are excluded for these new documents; API tools still require
appropriately scoped credentials. Legacy creation/templates/actions remain blocked.

The **AB#303** source reader is off by default. After its accepted merge and
[deliberate runtime configuration](../docs/deployment.md#ongoing-unlisted-client-galleries-adr-0034),
configure the optional public `SANITY_STUDIO_SITE_ORIGIN` with the canonical
website origin (for example `https://example.com`) and rebuild the Studio. The
**Copy client gallery link / Kopioi asiakasgallerian linkki** action shows a
selectable URL for the published document and copies only that URL on request.
Choose the site default or one of its declared full locale tags (for example
`fi` / `en-GB`). A manual-copy fallback remains available when clipboard access
is unsupported or refused. The action does not send email or verify page access.
Unpublished, release/version or synchronizing documents cannot supply a link;
pending draft fields are never used. Published paused/expired documents may
still have a stable URL; their availability follows the published record.

Blank/unset origin disables only this convenience action. A supplied invalid
origin fails Studio configuration. Use a canonical bare ASCII HTTPS origin,
optionally with one trailing slash; credentials, whitespace, noncanonical host
spelling, path, query, fragment and HTTP targets are refused. A locally running
Studio can still copy a configured HTTPS site URL; an HTTP local target is not
supported. No origin is inferred from the Studio address or a Preview deployment.
The selected action requires the public dataset supported by AB#303.
Alternatively, assemble `<canonical-origin>/client-gallery/<handle>` yourself,
appending `?locale=<configured-full-tag>` for the interface language. Titles are shown
only in their authored language; alternative text falls back to the site's
language and then the first authored entry. Missing titles use a generic label.
Neither the page nor Studio invents translations. Pausing/unpublishing or passing
the deadline removes the page on fresh reads; it does not remove files.
The hosted Studio was not changed by the AB#305 source PR; the later
[2026-10-18 publication audit](../docs/audits/ab18-production-refresh-2026-10-18.md)
records its update. Real editor, keyboard and permission verification remain
open under AB#145.

AB#305 source validation covers URL/locale/identity guards, clipboard result
handling and Studio SDK type/schema/build compatibility. Actual hosted login,
role restrictions, keyboard focus and native clipboard permission behavior remain
unverified under AB#145. No hosted deployment, customer communication or CMS
mutation is performed by this source change.

### Choose several existing web images (AB#336)

In **Client gallery images**, choose **Choose existing web images / Valitse
valmiita verkkokuvia** to load already uploaded eligible web-image assets. This
control uploads nothing. It shows at most the newest 256 assets, initially 64
thumbnails; use **Show more / Näytä lisää** to reveal the rest of that result.
For an older batch, optionally enter **Uploaded before / Ladattu ennen** and
choose **Search images / Hae kuvat** (AB#343). Enter a complete date and time in
**UTC**, to the minute; the boundary is exclusive. Clearing the field and searching
returns the newest images. Editing the boundary immediately clears the prior
selection/results and cancels the previous search, but performs no new request.
The results state the applied UTC boundary. Incomplete/invalid input is refused;
cutoff edits are locked while selected images are being added.

Every search still retains at most 256 eligible images and reveals 64 at a time;
no automatic archive walk or growing list is performed. More than 256 uploads
within one minute cannot be separated by this filter. Use the unchanged native
editor for those images or any images outside the displayed result. Portfolio and other gallery images can appear: technical
eligibility is not approval to reuse or publish any image.

Select images in the intended order, then choose **Add selected images / Lisää
valitut kuvat**. The list appends those references once and preserves existing
items/reordering. Repeated source images are allowed and marked when already
used. New entries deliberately have no invented alternative text: author it in
the native editor before publication. Full-frame thumbnails are lazy and bounded.
Selection capacity is advisory; concurrent edits and the document text-size limit
are still checked by native publication validation. Selected assets are checked
again before adding; later private-only changes still require publication/runtime
validation. Role failures show a fixed message rather than an empty library.

Retry, Show more, Clear selection and Add selected images remain focusable
when temporarily unavailable, with `aria-disabled` and guarded actions, so an
action does not disable or remove its focus anchor. The FI/EN native-control
keyboard fixture verifies Tab/Space, distinct names and these unavailable
anchors in Chromium/WebKit.
It does not hydrate React or prove controlled-state updates, close-focus return or hosted Studio authorization.
The UTC extension adds native labelled date/time and search controls, visible
cleared/invalid feedback, deterministic controller tests, and actual GROQ query
fixtures including strictly earlier timestamps and older-image appends. Those
fixtures do not constitute live Content Lake/query or hosted Studio acceptance.
Those authenticated editor/role/keyboard checks remain under AB#145. No hosted
Studio deployment, content publication or CMS write occurs during this change.

### Prepare one web image locally (AB#314)

The owner-run command below prepares **one processed static export** with the
existing encoder. It keeps the entire frame, normalizes EXIF orientation, never
enlarges it, and limits the longest edge to 2048 pixels. JPEG, PNG, WebP and AVIF
retain their format. Embedded EXIF, XMP, IPTC, ICC and PNG text payloads are removed
from the web copy; Sharp converts embedded colour profiles to web sRGB first.
Original exports, retained legacy files and full-resolution ZIP contents are not
modified. An output is technical evidence only: it does not establish that an
arbitrary JPEG is an eligible processed deliverable or suitable for publication.

Use Node 24 on a filesystem with real POSIX permissions (for WSL, use the Linux
filesystem). Create an owner-private workspace outside Git, or use locally
ignored private storage. Every ancestor must resist other users' writes; sticky
system temporary directories are supported. For example, after copying your
processed export into the private workspace:

```bash
mkdir -m 700 /path/to/private-workspace
# Copy the selected processed export there, then protect its local copy:
chmod 600 /path/to/private-workspace/export.jpg
npm run prepare:client-web-image -- \
  --source /path/to/private-workspace/export.jpg \
  --classification processed-export \
  --out /path/to/private-workspace/prepared
```

The output directory must not already exist. It is created with mode `0700` and
contains only `web-image.jpg` (or `.png`, `.webp`, `.avif`) and `receipt.json`, both
`0600`. Both paths must be outside Git or untracked and covered by the repository's
own ignore rules; a global ignore alone is insufficient. Never force-add them.
Symlinks, hard-linked sources, unsafe permissions and overwritten evidence are
refused. The receipt records bytes, SHA-256, display-oriented dimensions and
format, without source names, paths or embedded metadata. The image is written
and rehashed first; the receipt is written last. Interrupted/incomplete output
must not be used as a successful preparation receipt.

Local engineering bounds are 25,000,000 compressed input bytes and 100,000,000
source pixels. These are this command's resource bounds, not a ZIP/package limit
or a provider upload guarantee. Animation (including APNG), unsupported formats,
invalid/truncated images and warning-grade decode corruption are refused rather
than flattened or repaired. Review another clean processed export on refusal.

| Diagnostic | Action |
| --- | --- |
| `SOURCE_CLASSIFICATION_REQUIRED`, `INVALID_ARGUMENTS`, `OUTPUT_ALIAS` | Supply the exact three flags and a new separate output directory. |
| `INPUT_BYTE_LIMIT`, `PIXEL_LIMIT` | Export a smaller processed image within the local bounds. |
| `UNSUPPORTED_FORMAT`, `ANIMATED_IMAGE`, `INVALID_IMAGE`, `IMAGE_PROCESSING_FAILED` | Use a complete static JPEG/PNG/WebP/AVIF export; do not bypass the decode refusal. |
| `PRIVATE_PERMISSIONS_UNSUPPORTED`, `PRIVATE_PATH_REQUIRED`, `UNSAFE_PATH` | Use an owner-private POSIX workspace with the stated modes and no links. |
| `GIT_VISIBLE_PATH`, `GIT_CHECK_FAILED` | Move the workspace outside Git or fix its local ignore/ownership checks. |
| `SOURCE_CHANGED`, `OUTPUT_CHANGED`, `OUTPUT_CONTRACT_FAILED`, `LOCAL_IO_FAILED`, `INTERRUPTED` | Keep the evidence, inspect the local problem and rerun into a new directory. |

The receipt always says `uploaded: false`, `published: false`,
`sourceEligibilityApproved: false` and `metadataSuitabilityApproved: false`.
Inspect the full image and its suitability before any separately authorized
upload. Sanity files become public from upload, including while the gallery is a
draft. This command makes no network request and changes no CMS or deployment.
It neither accepts new full-resolution files/ZIPs nor completes AB#145's live
role, keyboard, editor or publication checks. Batch preparation remains separate.

No ZIP input is offered yet: AB#407 implements the accepted
[ADR-0035 contract](../docs/adr/0035-unlisted-delivery-zip-proposal.md); verified
whole-upload and authoring still remain separate, without extending the 21 legacy
galleries' file exceptions.
Unlisting/noindex is reduced discovery, not confidentiality; public CMS records can
be enumerated. Closing/unpublishing a page does not revoke direct asset URLs or
copies already cached or downloaded. No live customer upload or publication is
part of this implementation.

The optional [offline availability planner](../docs/deployment.md#optional-offline-availability-plans-ab304)
prepares private revision-bound evidence for future operator changes; it does not
replace native Studio editing or write to Sanity. A paused published document is
still public metadata. No remote writer is provided by the planner, and later publication
can overwrite any separately applied root-document patch.

## Publish a client gallery and replace proofs (AB#396)

Every delivery uses **Publish client gallery / Julkaise asiakasgalleria**, after validation
and syncing finish. Choose explicitly whether this is an ordinary publication or replaces
proofs. Ordinary publication preserves the previous draft-to-published behavior and the
chosen deadline, including publishing paused pages.

For a replacement, enable proof galleries in Studio, copy the exact proof document ID
from its document menu, and enter it in the delivery publication dialog. Review the target
ID, absolute deadline, working-selection state and counts of records/images to remove.
Type the proof ID again and choose **Publish and permanently delete proofs**. This deletes
the proofs, terms, current selection, confirmed versions/price snapshots, notices,
reminders and unused images in the same guarded transaction as publication. Images in
the delivery or used elsewhere are kept. The target must be available, with a deadline
more than five minutes after server time, or explicitly indefinite. Publication does not
restart the six-month creation-time suggestion. An already-published target may be selected
explicitly with no draft; ordinary publication still requires a draft.

The old proof link stops working (404); send the customer the new delivery link. Later
pausing, expiry, unpublishing or deleting delivery cannot restore proofs. Copies already
downloaded, CDN caches, provider history/backups and in-flight email retain their limits.
No invoice/export retention gate or new ZIP eligibility is introduced.

A conflict/refusal leaves the operation unapplied and requires a new review. For an unknown
outcome, use **Check outcome / Tarkista lopputulos**; publication stays disabled and the
reviewed plan survives closing this dialog. Checking is read-only. **Not observed applied**
allows a fresh review, but a timed-out request might still finish; revision guards prevent
duplicate operations. A mixed/unreadable state stays unknown. Never bypass this by ordinary
publication followed by manual deletion. Large operations are refused, never split.

AB#404 retains each unused proof image's fresh revision in the reviewed plan. Manual
proof deletion and replacement publication both patch that exact revision immediately
before deleting the image in the same transaction. A changed or missing candidate fails
the entire operation; shared and delivery images receive no mutation. Metadata changes
can cause a safe conflict: reload and review again. A referenced image already missing
at review blocks collection; resolve dangling references in both the published gallery
and its draft through the normal Studio editing/publication workflow before reviewing
again. All referenced assets, including retained images, must have valid fresh
read evidence. Source fixtures cover these cases; actual hosted permissions/error shapes
and the separate controlled-writer/reference conditions still require acceptance.

Old `replacedBy` links are read-only. Any legacy link to this delivery, including a
single link, blocks ordinary publication, even a text edit. Select the exact linked
proof for explicit replacement (which deletes it), or delete the old proofs with their
own deletion action before ordinary publication. Conflicting or multiple links require
that manual resolution. No source is chosen by name or handle. With proofs disabled, ordinary delivery does
not inspect inactive proof links.

Client/proof and private-record release versions are invalid and native scheduling is removed for those types;
public galleries and stories keep scheduling. Existing release copies block the operation.
This is a Studio workflow, not an API permission rule. Before activating, check the hosted
FI/EN keyboard flow, private-record/asset permissions, fresh all-versions reads and release
validation (including mixed public/client releases); clear already-scheduled client/proof
versions and ensure other writers use this workflow and strong references. Weak references,
external URL copies and stale editor buffers have the limits in
[ADR-0038](../docs/adr/0038-proof-selection-in-existing-sanity.md#replacement-deletion-amendment-2026-10-24).
No hosted mutation, deployment or activation is implied by this source change.

## Review automatic delivery cleanup enrollment (AB#397)

`SANITY_STUDIO_CLIENT_GALLERY_CLEANUP` is public build configuration: blank or `off`
disables the workflow, `enabled` exposes it, and other values fail configuration.
This Studio setting does not enable the separate server worker (AB#398). Leave it
unset until the authenticated roles and hosted acceptance checks are complete.

With the workflow enabled, **Publish client gallery / Julkaise asiakasgalleria**
reads the private control record before showing the cleanup choice. Every unenrolled
delivery starts unchecked and requires deliberate opt-in, including a new delivery.
Current absence of publication cannot distinguish new drafts from previously published,
then unpublished galleries. Existing enrolled/pending approval stays checked across
text edits. Disabled/completed records never silently re-enroll. Indefinite deliveries,
proofs and imported legacy galleries cannot enroll. The six-month creation suggestion
and actual deadline are unchanged. Review the displayed deadline and image count:
an already expired ordinary delivery can become eligible immediately after publication.

Publication saves enrollment, renewal or withdrawal in the same atomic transaction,
with the exact existing control revision or a create-only absence assertion. A changed
deadline or image set is shown for renewed review. Withdrawal changes the control
revision and clears any pending attempt, fencing its old destructive transaction.
With the flag off, publication reads/writes no cleanup control; a later worker must
recheck policy and fresh gallery revisions, and cannot adopt a changed policy silently.

The dialog shows the stored state and latest closed cleanup result in FI/EN. An open
draft or any incoming reference to delivery (including a retained proof link) can block
cleanup indefinitely until resolved. Shared images stay online and receive no later
sweep from this worker. Inspect blocked results and resolve their cause before a new
review; do not delete private controls to force a retry. Unknown publication outcomes
use read-only reconciliation of the exact publication/source identity. A matching
completion receipt can prove publication even if cleanup already removed an expired
delivery. Other mixed states remain unknown; never blindly replay the transaction.

The operational `clientGalleryCleanup.<SHA256(published gallery ID)>` record has no
editable schema/template or native actions. It contains only IDs, revisions, the
approved handle/deadline/image set and one latest attempt/result/receipt; no customer
names, titles, email, filenames or URLs. Its source revision is the reviewed draft or
published revision, not the server-assigned revision after publishing. The record
remains until deliberate re-enrollment or separately authorized operator removal;
there is no new purge timer. Dataset writers can forge it, so the worker independently
validates the current gallery and policy. Studio editor roles need authenticated
read/create/update access to this private prefix. Verify anonymous reads cannot expose
it, control CAS races, permissions, FI/EN keyboard/assistive-technology behavior and
provider transaction semantics using synthetic records before activation.

No live enrollment, publication, deletion, deployment or activation is performed by
this source slice. [Retention and remaining gates](../docs/client-gallery-retention.md).

## Proof galleries (AB#130)

Proof galleries ([ADR-0038](../docs/adr/0038-proof-selection-in-existing-sanity.md))
are hidden unless the Studio is built with `SANITY_STUDIO_PROOF_GALLERIES=enabled` and
`SANITY_STUDIO_SITE_ORIGIN`. Leave the setting unset until the site's proof pages are live;
any value other than `enabled`, `off` or blank fails the Studio configuration.

When enabled, this Studio signs in with `auth.loginMethod: 'token'`: the editor's token is
kept in the browser's `localStorage` instead of an HTTP-only cookie, so scripts on the Studio
origin can read it. The Studio runs only its own bundle and renders no user HTML; a Studio
without proof galleries keeps Sanity's default sign-in. The site checks the same
token against documented project-member identity flags, permitting a non-admin human
Editor subject to their actual content permissions. Actual Editor/owner/robot
acceptance remains required before activation; see the
[publication contract](../docs/sanity-setup.md#proof-gallery-publication-ab130-adr-0038).

- **Publish proof gallery / Julkaise vedosgalleria** replaces native publish. It becomes
  available when the draft has been validated for its current revision with no errors.
  It sends that revision with the editor's token to the site's
  `/api/proof-gallery/publish` route, which numbers the proofs and publishes in one
  transaction, or refuses without writing anything if the draft changed in between.
- The **first publication** asks for the terms: images included in the price, the price
  per additional image (`12,50` or `12.50`; whole units only for currencies without minor
  units), the currency, a job reference and the reminder. The reminder is on by default
  after 7 days and then needs the customer's email address; with the reminder off no
  address is stored. Reminder sending itself arrives in a later release.
- The selection link `/client-proof/<handle>#select=<key>` is **shown once**. Copy it
  before closing the dialog; otherwise create a new one.
- **Create a new selection link / Luo uusi valintalinkki** replaces the key after a
  confirmation; the old link stops working immediately.
- When the dialog says the outcome is unknown, do not publish again straight away:
  reload, check whether the gallery shows as published, and after a first publication
  create a new selection link. If every attempt ends that way and nothing is published,
  the site route is probably off or does not list this Studio's origin: an answer without
  its CORS headers cannot be read, so the Studio cannot tell a refusal from a lost answer.
- **Replaced by client gallery** is now a read-only legacy field. New replacements use
  **Publish client gallery / Julkaise asiakasgalleria** on the delivery document; see below.
- **Reminder settings / Muistutusasetukset** on a published proof gallery switches the
  customer reminder on or off and changes the delay, the customer's address and their
  language (Finnish or English among the site's locales). Prices are never changed here.
  Switching on, or changing the delay, waits for the next reminder step rather than
  sending at once; switching off removes the address. The first-publication dialog asks
  for the same language, and the selection link it shows starts in that language.
- **Proof notices needing action / Toimenpiteitä vaativat vedosilmoitukset** lists the
  photographer's emails that failed, or stayed pending for more than five minutes after a
  confirmation (the list reflects that age when opened or refreshed). Open a notice and
  follow **Confirmed selection** to read the customer's version: job reference, totals and
  every proof number with its original filename. **Confirmed proof selections** lists all
  versions. Both are read-only; there is no resend.
- **Reminders needing action / Toimenpiteitä vaativat muistutukset** lists customer
  reminders that failed or stayed pending for more than five minutes (a cancelled one was
  stopped on purpose because the gallery changed just before sending). **Incomplete
  reminder settings / Puutteelliset muistutusasetukset** lists published proof galleries
  whose reminders are on but lack a language, address or publication time; fix them with
  **Reminder settings**. Nothing is resent from Studio.
- **Proof selections / Vedosvalinnat** lists each customer's working selection. A
  confirmed one offers **Reopen selection / Avaa valinta uudelleen**: after a confirmation
  step it reopens exactly the state you reviewed (a selection changed meanwhile is left
  alone), so the customer can change it and confirm the next version. Earlier versions and
  their notices stay. A page the customer already has open shows the change after a
  reload. At the 999-version limit reopening is not offered.
- Unpublish and native delete are not offered for proof galleries: the published document
  holds the fixed proof numbers, **Available to link holders** pauses the page, and native
  delete would leave the private records behind. Discarding a draft remains.
- **Delete proof gallery and its records / Poista vedosgalleria ja sen tiedot** deletes the
  gallery, its draft and every private record — terms with prices, key and customer
  address, the working selection, confirmed versions, notices and reminders — and the
  gallery's image files in one transaction. It first lists what it found (counts only) and refuses when something
  cannot be read, a record has a draft or release version, or other content references
  the gallery. Type the gallery's document ID to confirm. If the customer confirms or a
  reminder is claimed meanwhile, nothing is deleted: reload and review again. An unknown
  outcome means reload and check, not retry. An image that other content uses is kept and
  shown separately. Downloaded copies, the CDN's cache for a while, Sanity's history,
  backups and emails already sent are not affected. See the
  [proof selection data flow](../docs/proof-selection-data-flow.md#retention-and-deletion).

The site route must be enabled separately; see
[proof gallery publication](../docs/sanity-setup.md#proof-gallery-publication-ab130-adr-0038).

AB#396 hosted checks must verify the exact `includeAllVersions=true` response: each
requested base ID appears in `documents`, or in `omitted` with `reason: "existence"`;
permission omissions, missing `omitted` arrays and unreported IDs are refused. Check
draft-only records too. The synthetic fixture is not provider evidence for that shape.
Also verify focus moves to the dialog heading on loading/review/outcome transitions,
returns to the action on close, and that a screen reader announces asynchronous results
from the already-mounted status region. Static markup tests do not prove hydration,
focus transitions or announcements in authenticated Studio.
