# Sanity setup, ownership, and failure behavior

How a deployment connects to its content store, who owns that store, and what the site
does when the store cannot be reached.

This covers the connection, the MVP schemas/adapters, their route-facing source switch, and
the published cache boundary. Seeding sample content into a real dataset is
[`docs/sanity-seeding.md`](sanity-seeding.md). AB#135 wires every public content seam behind
`SITE_CONTENT_SOURCE`: `mock` keeps the fixture layer available outside Production, while
`sanity` reads the deployment's real dataset with no fixture fallback or mixed-source page.

## Ownership

**The site owner owns the Sanity account outright.** ADR-0004 §5 makes every external
account customer-owned, and this one is no exception:

- The **organization, project, dataset, uploaded assets, and billing** belong to the
  photographer, in their own Sanity account. The project author holds no copy, no
  fallback, and no administrative access by default.
- **There is no shared cross-customer account, project, dataset, or credential.** Each
  clone connects to its own project. A credential leaked from one deployment reaches
  nothing belonging to another.
- **Transfer is a change of settings, not a change of code.** Nothing in this repository
  names a project id, a dataset, or a token. Handing the site to another photographer
  means pointing four deployment settings at their project; moving an existing project
  between owners is done in Sanity's own console, and the deployment does not change at
  all.
- **Exit is possible.** The dataset can be exported through Sanity's own tooling, and the
  application's runtime connection to Sanity is confined to two files (see
  [ADR-0006](adr/0006-sanity-data-access-boundary.md) §1), so replacing the CMS means
  rewriting those and the adapters above them — not auditing every route. The document
  types are separate again, in [`sanity/`](../sanity/README.md), and describe the content
  rather than the provider.

The one thing the owner must not delegate is billing and account recovery. A CMS the
photographer cannot log into is a site they cannot edit.

## Setup

Sanity's console UI changes; their own [documentation](https://www.sanity.io/docs) is
authoritative for the exact steps. What this project needs from it:

1. **Create the project in the owner's own Sanity account** — not in the developer's.
   If it was created elsewhere first, transfer it before launch rather than after.
2. **Create the datasets.** Production and Preview must not share one, so a release
   candidate can never publish into the live site's content (ADR-0004 §3).
3. **Note the project id.** It is the hostname label in
   `<projectId>.api.sanity.io`, which is why the application validates it as one.
4. **Pin an API version.** Use a dated version, `vYYYY-MM-DD`, from the day the
   deployment was built and tested. Bumping it later is a deliberate change with its own
   verification, which is the point of pinning.
5. **Decide, and then verify, whether each dataset is public or private.** It is not a
   convenience setting: a public dataset is readable by anyone with the project id, so it
   may hold nothing you would not publish, and the schemas are built accordingly
   (*Dataset visibility*, below). Verify it against Sanity rather than against your own
   notes — check the dataset's visibility in the project's console, and confirm that a
   request with no credential returns nothing from a private one. A declared setting says
   what you intended; only Sanity knows what is true, and a dataset can be switched, or
   revert when a plan lapses.
6. **Create phase-scoped read tokens if the dataset is private.** A public dataset needs
   none; a private one cannot be read without one. Use the narrowest read-only role Sanity
   offers. The trusted build gets `SANITY_BUILD_READ_TOKEN` from Azure DevOps, and the
   running deployment gets a different `SANITY_READ_TOKEN` from Vercel Sensitive. Issue
   both separately per environment — never put either in source control or under a
   `NEXT_PUBLIC_` name.
7. **Set the deployment settings** below, then verify the connection before wiring any
   content: `probeSanityConnectivity` in
   [`src/lib/sanity-client.ts`](../src/lib/sanity-client.ts) runs a query that reads no
   document and proves the address is usable. It cannot prove a private credential,
   because Sanity answers an unauthenticated private read with the same empty result;
   the required visibility declaration and provisioning check own that guarantee.

## Settings

| Setting | Required | Purpose |
| --- | --- | --- |
| `SITE_CONTENT_SOURCE` | always | `mock` (the project's demo fixtures) or `sanity` (this deployment's Content Lake). No default. |
| `SANITY_PROJECT_ID` | when `sanity` | Project id: 1–63 lowercase letters, digits, or inner hyphens — it is the hostname label in `<projectId>.api.sanity.io`. |
| `SANITY_DATASET` | when `sanity` | Dataset name, to Sanity's own rule: 1–64 characters of lowercase letters, digits, hyphens, and underscores, beginning and ending with a letter or digit. |
| `SANITY_DATASET_VISIBILITY` | when `sanity` | `public` or `private`, matching both the actual dataset and the Studio schema configuration. |
| `SANITY_API_VERSION` | when `sanity` | Dated API version, `vYYYY-MM-DD`. Undated, legacy, impossible, and future-dated versions are refused. |
| `SANITY_READ_TOKEN` | when `private` | Server-only runtime credential. Local builds use this name too; the reference pipeline maps its separate Azure `SANITY_BUILD_READ_TOKEN` to it only for the build step. Declaring `private` without a usable build credential fails the build. |

`SITE_CONTENT_SOURCE` is read as part of the deployment configuration, which every route
resolves — so an unset or illegal value fails the **build**, not the first content read.
Every Sanity setting is validated in mandatory build configuration before any route or
adapter is evaluated, and the runtime client validates the same values again. Both use
the service's own rules rather than a looser approximation: a name Sanity would reject
fails here, where it names itself, instead of becoming a 404 to debug later.

A future-dated API version is refused too. That one is this project's rule rather than a
documented Sanity constraint: a version dated after today pins no behavior the deployment
could have been built against, so a typo like `v2099-01-01` would silently opt into every
future breaking change instead of freezing one.

### Secrets

The read token is server-only, and three things keep it out of the browser:

- **The setting is not prefixed `NEXT_PUBLIC_`.** Next.js inlines only
  `NEXT_PUBLIC_`-prefixed values into client bundles, so an unprefixed value cannot be
  compiled into browser JavaScript. That is the guarantee. A token found mirrored under
  `NEXT_PUBLIC_SANITY_READ_TOKEN` fails the deployment rather than being quietly ignored,
  because its presence means the credential is already on its way to every visitor.
- **Both modules carry the `server-only` marker.** A Client Component that reaches them —
  directly, or through an adapter several hops away — fails the build.
- **ESLint forbids `src/app` and `src/components` from importing the client or its
  configuration.** Routes and components read adapters in `src/lib`; provider knowledge
  and credentials stay behind that line. The marker above covers the indirect case ESLint
  cannot see.

The token never appears in a URL, is never logged, and is never returned to a caller.

### `SANITY_POLL_VOTE_TOKEN` (AB#162, ADR-0018)

A separate, **write-scoped** credential the article poll-voting feature's `/api/poll-vote`
route uses to record a vote — the first write path an anonymous visitor's own request can
reach, unlike the read token above or the owner-run `SANITY_SEED_TOKEN`/`SANITY_MIGRATION_TOKEN`
(`docs/sanity-seeding.md`). It never authorizes a read: the route reads a poll's own
question/options/close date through the ordinary read token, and this token is asked to
create or patch only two document types (`pollTally`, `pollVoteReceipt`) and nothing else.

**Scope it as narrowly as Sanity's role/permission model allows at token-creation time —
but verify what that actually is before assuming it.** Ideally: create and update, never
delete, and never a write role broad enough to modify `poll`, `article`, `media`, or any
other document type. The ordinary read connection separately reads published polls
and receipt existence; runtime write-token access remains narrowly scoped. Document-type-scoped custom roles are the mechanism that would grant
exactly that, and they are a **Growth-plan-and-above Sanity feature** (verified against
Sanity's own role documentation, 2026-09-18) — **not available on the Free plan.** This
project's own Sanity plan tier is not recorded anywhere in this repository. If it turns
out to be Free, the only tokens available are dataset-wide (Viewer/Editor/Administrator),
and `SANITY_POLL_VOTE_TOKEN` must in practice be a full **Editor** token — the same power
as `SANITY_MIGRATION_TOKEN`, except long-lived and reachable from a public, anonymous,
unauthenticated request rather than owner-run and temporary. [ADR-0018](adr/0018-article-poll-voting-storage-and-dedup.md#7-a-new-write-credential-honestly-scoped)
records this correction in full, including why the application code's own hardcoded
mutation shape — not the credential's permissions — is the real safety boundary if a
scoped role isn't available, and why that code path is kept the *only* one allowed to
reach this credential (`eslint.config.mjs`'s `no-restricted-imports`, ADR-0018 §8).
**Record which kind of token was actually minted here once provisioning happens** — this
paragraph states the risk, not a settled fact about what exists.

Reading `SANITY_POLL_VOTE_TOKEN` follows the identical refusal the read token above
already applies: a value mirrored under `NEXT_PUBLIC_SANITY_POLL_VOTE_TOKEN` fails the
request rather than being silently accepted, because its presence means the write
credential is already on its way to every visitor.

## Standalone editor

The optional [`studio/`](../studio/README.md) application consumes the canonical
schemas in this checkout with a separate package-lock and build. Configure it
with this site's existing project, dataset, actual dataset visibility and complete
locale-routing table. The editor uses the owner's Sanity session; the site's
server-only read token is never a Studio setting. Its guide covers local CORS,
login, schema/build checks and explicit owner publication to Sanity hosting.
CI validates the editor without deploying it. Deployment is an explicit owner
operation and does not import or rewrite the site's content documents.

## Content schemas

The document types this site reads live in [`sanity/`](../sanity/README.md) as plain
objects that import nothing — a Sanity schema type *is* a plain object, so the repository
needs no `sanity` package to describe one. Point your Studio's `schema.types` at them
(that directory's README shows how). Copying works and drifts; a path, a submodule, or a
workspace dependency does not.

`defineSchemaTypes({ datasetVisibility, storyRootPaths })` needs two deployment facts.
Dataset visibility decides which fields exist at all — see *Dataset visibility* below.
`storyRootPaths` is the generated story root for *every* configured locale — one entry
per `SITE_LOCALE_ROUTES` locale, the default locale's unprefixed and each other locale's
carrying its own prefix — and must match it exactly. The Studio uses the full list to
reject a static link that would duplicate any configured locale's generated story
navigation before the settings can be published; naming only the default locale's path
would leave every other locale's collision undetected until the site reads the document.

The canonical schema includes **siteSettings**, **homePage**, **media**, **category**,
articles, services, galleries and their placements, article end-gallery placements,
polls and the separately gated retained legacy-delivery types. Studio's normal
editorial navigation excludes those importer-owned legacy types, whose creation
and publication remain outside this application setup.

**Settings and home links name intent, not generated paths.** A link stores either an
application-owned root-relative static route, the generated story root, or the featured
gallery selected once by `featuredGalleryId`. The story namespace comes from deployment
route configuration, and the gallery route comes from its content identity and the public
tree. No category list or category path is copied into settings. If that gallery has no
published canonical route, the home action and section are omitted rather than pointed at
a 404; malformed or duplicated navigation is rejected.

Header/footer navigation also supports a **category shortcut** (`target: "category"`,
`categoryId`: the category’s stable identity). Its localized label and position belong
to settings; its current canonical path and public visibility come only from the
locale’s content tree. The generated Stories submenu remains available. Category
shortcuts store no `href` and are omitted for locales where their category is not
public. Home actions and home sections keep the three target kinds above. Deploy
the compatible adapter before publishing this new navigation target. If a settings
draft already exists, reconcile its navigation explicitly so later publication does
not restore the previous menu.

The home page's **Selected photographs** section reads the first bounded page of this
featured gallery. Its authored gallery sections become the topic links: create sections
on the gallery and assign each photograph's placement to one to offer filters. Counts
include only public, visible photographs. A gallery without sections still shows its
photographs without topic links. The **View all photographs** link opens the complete
gallery, retaining the selected topic; topic links themselves reload filtered photographs
on the home page, including when JavaScript is disabled.

Both settings and the home page are published singletons. A missing document and two
published documents are different classified content defects, and both raise instead of
falling back to fixtures. Their adapters validate the raw result, resolve language-keyed
text for the requested language, and return the existing project-owned `SiteSettings` and
`HomeContent` contracts. The home hero dereferences the shared media document through the
same public-media projection as every other image, so its stored asset, intrinsic
dimensions, and delivery policy cannot fork from the media boundary. The optional
`photographerIntroduction` object adds a public portrait image, language-keyed eyebrow,
heading and text, and at most three language-keyed title/detail facts. Complete it in each
published language; an absent object leaves the existing home introduction in place. The
portrait uses the same public-media boundary and renders at its native ratio. The two
application-owned actions lead to contact and services.

**The site name is authored per language** (AB#187). `siteSettings.siteName` is a
language-keyed list like the tagline, because a brand commonly reads differently per
language — "Valokuvaaja …" in Finnish, "… Photography" in English. Each locale's header,
default page title, and Open Graph site name use that locale's entry, and the title
template (`defaultSeo.titleTemplate`) is resolved the same way; a language without its
own entry uses the default locale's. Localized home headings use the requested
locale; global structured data on the default home and owner notification emails
retain the default locale's name (AB#255). A document published before this change still holds one plain
string there: the site keeps reading it as the default locale's name, while the Studio
reports the field as the wrong type. **Re-author it once** — open Site settings, clear the
old value, and add one entry per published language — then publish.

`siteSettings.logo` optionally references a shared media document as the brand mark
beside the brand text in the header. It renders at its native ratio, 43px high on wider
screens and 33px on narrow ones, at most 160px wide, so a square mark and a wide
wordmark both fit. Upload a PNG or WebP with a **transparent background** (no tile or
matte colour). `siteSettings.logoDark` optionally references a variant shown while the
site is in its dark theme — by the device's preference or the visitor's pinned choice —
for a mark that does not read on a dark ground; without it the logo shows in both
themes. Check each against its own theme before publishing. Both are decorative there —
the visible brand text already names the link — so their alternative text is not shown,
though each media document still requires one. A reference that does not resolve, or
that names anything but a public image media document, is refused like any other
malformed setting, and so is a dark variant without the logo it replaces; leave both
empty for a text-only brand.

`siteSettings.brandDescriptor` optionally gives the header a two-line brand: the
photographer name (`photographerName`) as the large line and a small uppercase
descriptor per language — "Valokuvaaja" in Finnish, "Photography" in English — with
its own position, **before** or **after** the name, so each language reads naturally.
The link's accessible name is the two lines in that order, so author the site name to
match ("Valokuvaaja …" / "… Photography"). A language without a descriptor shows its
site name on one line; another language's descriptor is never borrowed.

`siteSettings.contact.portrait` optionally references a shared public image for the
contact page's side column. It renders at its native ratio. The site projects only
the public web derivative and rejects private-only or non-image media; leave the
reference empty when the page needs no portrait. Update the authored
`contact.privacyNotice.collected` when enabling the optional phone/date and
subject fields on an existing deployment.

**The Studio validates against the dataset.** Several rules query it while an editor
works, which is the only place they can run in time: an uploaded image is measured and its
format checked before the document can be published, a media ID is checked for being
unique across the dataset and for not having changed since the last publish, and a
category id is checked the same way. They use the Studio's own client and need no extra
configuration.

**Categories describe the tree, never its content placement.** A category document carries
a stable `categoryId`, an optional reference to its parent, a sibling order, and a
language-keyed label and path segment. It may also carry one optional landing-page
description per language. The description is deliberately bounded to paragraphs and
ordered or unordered lists with emphasis and safe links; it cannot add headings, media,
embeds, or raw HTML. The public adapter validates the same limits as the Studio and does
not fall back to another language. The initial category page renders the description
below its sole `h1`; cursor continuation pages omit it.

A category never lists the galleries or articles placed in it: ADR-0003 decision 5 makes
canonical and secondary category placement a property of the content being placed, so
that reference lives on the gallery or article document once AB#113 and AB#81 add it, not
on the category. Before a standard Publish,
document-level validation reads the published category set, overlays the document being
edited, and rejects self-parenting, indirect cycles, orphaned parents, excessive depth,
and sibling-slug collisions. `content-tree.ts` repeats those checks as
[ADR-0003](adr/0003-public-content-tree-and-url-structure.md) decision 4's authoritative
backstop because an API import can bypass Studio validation.

Published parent references and existing localized slugs cannot be changed in the
ordinary form. Such a change needs the customer Studio's warned URL-change workflow: it
must capture the before/after snapshots, call `diffPublicCategorySnapshots`, show every
affected descendant category and canonical content page, persist the accepted previous
paths, and only then publish. This repository supplies the guarded schema and the pure
diff seam; it does not contain the customer's Studio application or pretend that typing
into the ordinary field records history. Adding a category's first path in another
language is allowed because it creates no previous URL to retain.

### Create a linked language draft in Studio (AB#125)

On a saved article or gallery, choose **Create language version** (Finnish:
**Luo kieliversio**). The target-language select offers only configured language
subtags without an existing draft, published or release version. Review the proposed
field list and related-category/shared-media notices, then select **Create draft**.
The action does not translate or publish. Find the created version in the ordinary
article/gallery list and review each `localizationReview.pendingFields` entry before
publishing. Existing schema validation still blocks pending review and invalid
canonical category placement; shared media is not copied or edited by this action.

The action uses the signed-in editor's existing permissions and a direct, raw,
non-CDN Sanity client, with no extra token or website endpoint. Release versions
cannot be sources. Wait for autosave; a changed source/placement/category/media
snapshot invalidates the preview. Creation re-reads inputs and uses strict,
deterministic IDs in one transaction; simultaneous action calls cannot overwrite
an existing draft. Unrelated external writers using different IDs are outside this
same-ID safeguard. The last recheck and source snapshot are not an atomic source
lock, and the source is never patched.

Limits are 64 raw content versions, 1,000 raw placement versions, 32 category
records and 2,000 media records, with limit-plus-one reads and a 3.5 MB UTF-8
mutation budget. Overflow refuses rather than truncating a copied gallery. A secure
browser WebCrypto context is required. After a network/acknowledgement failure,
check for an existing target draft before trying again; no automatic retry occurs.
The operator CLI remains available separately. This source change does not authorize
live CMS writes, Studio hosting or acceptance of translated content.

**Authored text is language-keyed.** A field a visitor reads is an array of
`{ language, value }` entries, keyed by language subtag — never fields named after your
languages. Publishing in another language means adding entries and a locale route, not
editing a schema. Alternative text falls back to the site's own language when a
translation is missing — so always author that one; a photograph described in neither the
viewed language nor the site's own is refused rather than shown undescribed. A caption is
simply not shown, because prose in the wrong language is worse than no prose. [ADR-0008](adr/0008-localized-authored-text.md) records
why.

**What is not on the media document.** Where a photograph sits — its order in a gallery,
the section it belongs to, a caption written for one particular page — belongs to the
gallery that places it, never to the photograph
([ADR-0002](adr/0002-media-identity-and-placement-boundary.md)). One photograph is one
document, described once, reused everywhere.

## Media and assets

### Dataset visibility

Stated twice, on purpose, and the two must agree: once in the Studio's schema
configuration, because it decides what may be stored at all, and once as the deployment's
`SANITY_DATASET_VISIBILITY`, because it decides whether the site may run without a
credential.

```ts
schema: {
  types: defineSchemaTypes({
    datasetVisibility: "private",
    // One entry per SITE_LOCALE_ROUTES locale. This example matches a
    // bilingual deployment of
    // SITE_LOCALE_ROUTES=fi||tarinat|palvelut,en|en|stories|services.
    storyRootPaths: ["/tarinat", "/en/stories"],
  }),
}
```

Declaring `private` makes a build-scoped `SANITY_READ_TOKEN` required: locally that is the
ordinary setting, while the reference pipeline maps its separate Azure build credential
to that name. The build fails without it rather than the site quietly serving an empty
version of itself.

**Archive locations, and where they may live.** The media document can carry an *Archive
location* — where your master lives, in your own archive. No query the site *renders*
reads it, so it never reaches a page. One server-only path does read it: the AB#60 gallery
enquiry resolver (`src/lib/sanity-enquiry-media.ts`) uses it to tell you which master a
visitor is asking about, in an email to you — never in anything a visitor receives. It is
length-bounded (512 characters) in the schema and again in that resolver, which refuses a
value past the limit rather than passing it on, and the resolver surfaces it **only when
`SANITY_DATASET_VISIBILITY` is `private`** — on a public dataset any stored value is
dropped, because there is no private archive boundary to lead back across. Storing it is
still a decision about the dataset, not about the site:

- **A public dataset is world-readable.** Anyone with the project id can query every
  published document in it. The schema therefore **does not offer the field at all** when
  it is built with `datasetVisibility: "public"` — there is no way to record an archive
  path into a document anyone can read.
- **A private dataset** restricts document reads to a credential, so the field exists and
  `SANITY_READ_TOKEN` becomes required rather than optional: the site cannot read its own
  content without one.

Verify which one you have during provisioning rather than assuming — a dataset created as
public and later filled with archive paths is a disclosure, not a misconfiguration to fix
later.

**Enquiries have separate photograph and gallery controls (AB#289).** Newly created
ordinary public media initialize *May receive enquiries* (`enquiryEligible`) to `true`,
and newly generated public rally/Joomla import plans record that value explicitly.
Turn it off to prevent enquiries about that photograph in every gallery. The public
gallery's *Allow photograph enquiries* switch also defaults on; turning it off blocks
all photograph enquiries from that gallery. These controls exist in public and private
Content Lake datasets; dataset visibility is separate from client-gallery authorization.

Existing photographs with a missing or false media permission remain unavailable for
enquiries. Schema defaults do not update them, and import reruns preserve their existing
permission. Activating selected imported photographs needs an exact reviewed CMS operation.
An approved historical plan is never rewritten to inject the new default. A Joomla rerun
refuses to replace a gallery with an editor-owned enquiry setting, preserving its choice.
Public visibility, `privateOnly`, and gallery authorization are still checked independently;
this enquiry default grants no sales or delivery permission and does not apply to protected
client or retained legacy delivery documents.

**Visibility never applies to assets.** Uploaded files are served from public CDN URLs in
both cases. That is what the export rules below exist for.

### Assets

**Upload exported web copies, never camera masters.** Every asset in a dataset is served
from a public URL on Sanity's asset CDN. There is no "upload it but keep it private" for
the images this site reads, and bytes that have been delivered publicly cannot be made
secret afterwards — they persist in visitor, intermediary, and provider caches.

The site enforces the export policy rather than trusting it:

| Rule | Why |
| --- | --- |
| At most **2048 pixels on the longest edge** | The widest candidate the image optimizer emits. A larger file could never be delivered in full, so its extra pixels are cost with no reader — and a camera master is several times this size, so uploading one fails instead of being published. |
| **JPEG, PNG, WebP, or AVIF**, with a matching media type | Web delivery formats. A camera or print format is refused. |
| The asset must belong to **this deployment's project and dataset** | The optimizer's allow-list is scoped to them, so a foreign URL could not be rendered anyway. |
| Dimensions come from the file | Never typed in. The site reserves space at the photograph's true ratio and never crops it. |

**Uploaded filenames are not kept.** Sanity stores the original filename on the asset
document by default, and its own documentation warns that filenames carry sensitive
information — a client's name, an internal working title, a shoot nobody has announced.
The image field turns that off, so it applies to **new uploads only**: assets already in
the dataset keep the filename they were stored with, and clearing those means editing or
re-uploading them.

The first two are checked twice. The Studio measures the uploaded file and **blocks the
publish**, so a camera master never becomes part of a page; the site checks again when it
reads the document, because the Studio is not the only thing that can write one — the
HTTP API, an import, and a migration script all bypass it.

**Blocking a publish does not un-upload a file.** An asset is addressable on the public
CDN from the moment it finishes uploading, before anyone presses publish. So when the
Studio refuses an image:

1. Remove the file from the document.
2. **Delete the uploaded asset itself** in the Studio's media browser, so the dataset
   stops holding it.
3. Treat the URL as having been public. If it was ever shared or fetched, assume copies
   exist — a deletion removes the origin, not caches. This is why the rule is "export
   first, upload second", not "upload and let the site sort it out".

### Media identity

**One photograph, one Media ID.** The identity is minted by hand and must be unique across
the whole site. The Studio checks it while you type — against every other document, and
against what this document was last published as, because renaming an identity breaks
every reference already pointing at it. The site checks again when it reads: two documents
claiming one identity means it refuses to serve either rather than guessing which was
meant.

**Identity survives reprocessing.** Re-exporting or re-uploading a photograph creates a
new asset with a new id and a new delivery URL — that is how the site knows the bytes
changed and caches can be replaced — while the Media ID stays put, so links, references,
and later enquiries keep pointing at the same work.

## Drafts

**Every read asks for the published perspective, and nothing configurable can change
it.** Draft access is not a setting that could be flipped, or a default that could shift
under a version bump — it is absent from the code. Adding a draft-preview surface means
deliberately editing `src/lib/sanity-client.ts`, and ADR-0004 §3 already fixes what such
a surface must be: authenticated, explicitly `no-store`, and never cached publicly.

## Failure behavior

**The site never silently substitutes demo content for real content.** There is no
fallback path from Sanity to the mock layer, in either direction, at any seam.

- A **failed read raises**, carrying a failure class, a retry decision, and a correlation
  identifier. Callers surface an error state; nothing serves a fixture instead.
- A **production deployment may not declare `SITE_CONTENT_SOURCE=mock`.** The deployment
  configuration refuses it, and every route resolves that configuration, so the failure
  happens while the site is being built. It is the same safeguard the contact form's sink
  adapter carries, for the same reason: publishing the project's placeholder copy and
  AI-generated placeholder photographs as a photographer's own work is misrepresentation,
  not a mode. An undeclared `SITE_DEPLOYMENT_STAGE` counts as production, so the guard
  fails closed.
- A **missing `SITE_CONTENT_SOURCE`** fails the same way, naming the setting, rather than
  defaulting to either store.

Failures are classified, and the class decides whether a retry can help:

| Class | Cause | Retryable |
| --- | --- | --- |
| `unauthorized` | Token absent, wrong, revoked, or out of scope | no |
| `not-found` | Unknown project, dataset, or API version — *not* a missing document | no |
| `query-rejected` | The query was refused; a defect in the adapter that wrote it | no |
| `rate-limited` | The account's request allowance is spent | yes |
| `unavailable` | Content Lake outage or a transport failure | yes |
| `timeout` | The read exceeded its bound | yes |
| `malformed-response` | A 200 that was not the documented envelope | no |

Because GROQ always evaluates to a value, a document that does not exist is `null` or
`[]` — a legitimate answer, not a failure. A 404 means the address itself is wrong.

### What gets logged

One line per failure, with the same closed schema the contact endpoint writes
(ADR-0004 §5): a random correlation identifier, the state, the project-owned tag naming
which read it was, and the redacted error class. The query, its parameters, the response
body, and the token are never written — a rejection echoes the query it describes, and a
query can carry parameters derived from a visitor's URL.

```json
{"event":"sanity.query","correlationId":"…","state":"failed","tag":"article.detail","errorClass":"unavailable"}
```

## Local development and tests

Both select their source explicitly; neither reaches a real project.

- **Local development** runs on `SITE_CONTENT_SOURCE=mock` out of `.env.example`. A
  developer who wants to read a real dataset sets `sanity` and supplies the four
  settings — usually against a personal or staging project, never the customer's
  production dataset.
- **Vitest** never reads configuration from the environment or the network. The client's
  `fetch` is injected, and the connectivity and content-fetch tests in
  `src/lib/sanity-client.test.ts` answer from fixtures written in that file: two invented
  documents with no person, no location, and no photographer's work in them.
- **Playwright** runs the application under harness-owned settings in
  `e2e/support/harness-environment.ts`, which declares `mock`. A journey asserting
  against a live Content Lake would fail whenever someone published, and failure traces
  are published as pipeline artifacts, so the harness holds no credential.
- **The Azure Pipelines build gate** declares itself `preview` with a `mock` source. It
  compiles and prerenders the project's fixtures and must reach no external service, so
  it cannot be a production build — a production build with demo content is exactly what
  the guard above refuses.

## Published caching and the webhook

AB#83 keeps published reads on the Content Lake origin and makes Next.js's tagged Data
Cache the one cache authority. The finite lifetime, complete tag/type map, signed webhook
projection and setup, replay behavior, failure/retry rules, and broad reconciliation
runbook are in [`docs/cache-revalidation.md`](cache-revalidation.md). Preview and
Production use separate datasets, webhook URLs, and `SANITY_WEBHOOK_SECRET` values.

Draft preview remains a future authenticated `no-store` surface. Draft and version
documents are excluded from the webhook configuration and rejected at the public
revalidation boundary.

## Still not decided

- **The POST query form.** Reads use GET, bounded at Sanity's documented 11 KB. A query
  that outgrows it fails loudly rather than being truncated; the API's POST form would be
  implemented then, not speculatively now.


Poll runtime reads (snapshot, results and receipt existence) are intentionally
fresh. Poll/option identities are at most 64 characters, text at most 500,
options at most 10, and tally buckets are nonnegative safe integers. The vote
transaction initializes the selected bucket and creates its receipt in the same
atomic mutation request. Receipt IDs hash the poll/token pair; raw cookies,
option choices and vote timestamps are not stored in the receipt. Neither
operational document has a Studio schema, but both remain API-readable in a
public dataset. Follow the current amendment in ADR-0018 and the
[poll processing record](poll-data-flow.md), rather than assuming Studio
invisibility protects them.

### AB#233 — response transport integrity

Runtime published queries keep their fixed Content Lake origin and use manual redirects. Successful JSON is decoded as strict UTF-8; a response BOM, valid Unicode and literal U+FFFD remain supported. Damaged bytes and ordinary body-read failures keep the existing non-retryable `malformed-response` classification with redacted events. AB#320 bounds both fetch and body waits by the same 10-second attempt deadline and any supplied caller abort: expiration returns a retryable `timeout`, including native unbounded queries. An unrelated native-query body `AbortError` still means `malformed-response`; bounded queries and fresh-document reads retain their existing `AbortError` timeout classification. Unused error bodies and late responses are cancelled best effort without waiting for cleanup. Published perspective, parameters, timeout and finite Next cache tags/TTL remain unchanged. The pinned Next fetch implementation caches response bytes before application-level JSON validation: a malformed cached 200 can therefore keep failing until the existing TTL expires or approved webhook/recovery invalidation clears it. This change adds no live propagation proof.
## Legacy delivery continuity (AB#250)

The registered `legacyDeliveryGallery` and `legacyDeliveryImage` types implement
ADR-0028's separate imported legacy surface. They do not become `media`, ordinary
galleries or discoverable content-tree entries. Imported fields are read-only in
the Studio; the initial availability flag is false. Runtime projection validates
every field, exact source asset identity, JPEG dimensions/orientation, ordered
manifest and optional whole-ZIP identity. Studio read-only fields are an editing
convention, not authorization for an API credential.

The runtime is off by default. Sanity selection requires the existing content
source configuration, `LEGACY_GALLERY_IMPORT_BATCH` (64 lowercase hex characters)
and distinct `LEGACY_GALLERY_HANDLES` (32 lowercase hex characters each).
Sanity selection is refused in a declared or platform Preview environment,
so customer content cannot be served by that adapter in Preview.
No more than 256 handles or images per gallery are accepted. Unknown handles are
refused before provider IO. Availability uses two uncached
[Doc API](https://www.sanity.io/docs/http-reference/doc) reads around a bounded
image query, with revision and manifest checks; these reads are intentionally
separate from ordinary cached public queries. Doc replies are capped at 32 KiB,
image-query replies at 512 KiB. The reader accepts only the verified legacy
orientation 1 and exact intrinsic dimensions; unsupported data is refused,
never transformed. Image URLs have no transformation parameters. The direct ZIP
URL uses the documented [`dl` parameter](https://www.sanity.io/docs/content-lake/manage-assets);
live attachment/byte verification remains an import gate.

### Original JPEG file delivery (2026-10-14)

The Production byte check found that an unchanged uploaded JPEG's ordinary
image-CDN response did not retain the original bytes. An upload response's
`sha1hash` is therefore insufficient delivery evidence. Sanity's
[image transformation reference](https://www.sanity.io/docs/apis-and-sdks/image-urls)
distinguishes `dl` download headers from authenticated `dlRaw` original retrieval;
the anonymous original-image request returned 401. Never send a CMS token to the
browser to work around that boundary.

An explicitly reviewed JPEG binding can instead declare `kind: "file"` and the
exact `file-<sha1>-jpg` asset identity with MIME `image/jpeg`. It still carries the
source-verified byte count, SHA-256, width, height and orientation 1. The compiler
places its reference in the read-only `originalFile` field; older image bindings
keep `source`. The reader rejects documents containing both, and validates the
file identity, MIME and size before checking the ordered manifest. File assets
have no image-pipeline dimensions: the reviewed dimensions remain bound to that
manifest and cannot be inferred from provider metadata.

Both thumbnails and the viewer use the direct `/files/…/<sha1>.jpg` URL, without
transformation or download parameters and without the public image optimizer.
The browser policy grants that configured project/dataset file path only to
`img-src`; the public optimizer's allow-list remains image assets only
([ADR-0011's scoped amendment](adr/0011-security-response-headers.md#scoped-amendment--2026-10-14-original-legacy-jpeg-file-delivery-ab250)).
The original image binding grammar and manifest remain available for existing
fixtures and reviewed history. A new file binding changes the document/asset
candidate digest and requires a new exact import approval; it does not change the
source review digest, gallery identities, order, deadlines or ZIPs. Complete
anonymous CDN byte verification and browser rendering remain publication gates.
This implementation is not evidence of a completed customer import or a provider
support commitment. ADR-0028's existing public-asset and expiry disclosures apply.

An isolated Preview experiment on 2026-10-14 uploaded one synthetic JPEG as a
file asset. All 4,597 source bytes, SHA-1/SHA-256 and nonce EXIF were preserved
through the anonymous file-CDN response. Chromium and WebKit rendered its native
160 × 100 frame at 128 × 80. Only that owned fixture was deleted afterwards and
the original twelve-document Preview baseline was restored. This proves the
tested synthetic path; every real Production source still needs its own complete
byte proof before publication.

Before importing, independently verify the approved batch/source inventory,
fresh baseline, quota/usage, recovery, notice and project webhook filters. The
inspected production document hooks select ordinary types and exclude these
legacy types; preserve that exclusion. Do not add legacy types to the public
revalidation cache map or expose customer paths/contact details in fields.

A service landing page can set `hideFromListing: true` to omit its card from both
service listings while keeping its URL and child-route ancestry. This is a
presentation setting, not publication or access control: the page remains in the
service catalog, sitemap and contact choices. Leave the field unset (or false)
for an ordinary visible service. Deploy a reader that supports the flag before
expecting a Production listing to hide the card.

The home page's "Latest stories" section reads published article and gallery
documents ordered by their own `_updatedAt` (AB#252). Because a gallery's
photographs live in separate placement documents, adding photographs to an existing
gallery does not change that order; creating a gallery, or editing and publishing
the gallery document, does. `siteSettings.featuredGalleryId` names the gallery
shown as the home portfolio and used by the hero button and menu entry. A service
page lists its child services (those whose `parentServiceId` is its `serviceId`) as
packages, each with its `coverMedia` when set.


#### Retained customer source-link configuration (AB#250)

`LEGACY_GALLERY_REDIRECTS` is an optional owner-local JSON array of exact
`[sourcePath, opaqueHandle]` pairs. Keep real sources out of Git, Preview and CI.
The server parses at most 64 KiB / 256 pairs; each source is a bounded local path
without percent encodings, query/fragment syntax, traversal or reserved roots.
Targets must occur in the enabled adapter's handle allowlist. Fixture mapping is
limited to the existing explicit local-development fixture policy; real Sanity
mapping inherits the Preview refusal. An off adapter serves no source mapping.

Reserved route namespaces and the public legacy registry take precedence.
GET/HEAD redirect in one temporary 307 to the served gallery path, including one source
trailing slash, with no-store/noindex/nofollow/no-referrer. Historical query data
is discarded; only a validated non-default UI locale is carried. Unsupported
methods return 405 without reading their body. This mapping grants no access
control and proves no customer import or publication; verify all actual source
and target routes after the separately approved Production import/configuration.
During launch validation, the temporary status avoids teaching browsers a
permanent destination before the mapping is confirmed. Revisit a permanent
status only after the Production source inventory and targets are verified.
An invalid map disables all retained-source redirects until configuration is
corrected; ordinary public pages continue to load, and the server logs one
sanitized warning per process without customer paths.

### New unlisted client gallery authoring (AB#302)

The standalone Studio now has a separate Client galleries / Asiakasgalleriat
list for new `clientDeliveryGallery` documents and their embedded
`clientDeliveryItem` objects. It reuses Sanity authentication and project roles;
no S3/PostgreSQL or custom site-administrator login is required. See the
[schema contract](../sanity/README.md#ongoing-unlisted-client-delivery-ab302) and
[editor workflow](../studio/README.md#ongoing-client-galleries-ab302--ab145).
Legacy imported fields/actions remain read-only. Bounded web-image authoring and
the AB#303 reader are source implementations; the reader remains off by default.
Its [runtime configuration](deployment.md#ongoing-unlisted-client-galleries-adr-0034)
is separate from deploying the hosted Studio or verifying actual editor roles.
All files and public dataset fields are public; unlisting and page expiry do not
revoke direct asset URLs. No live upload, publication or deployment is performed.

AB#305 adds an optional native customer-link action. Configure the public
`SANITY_STUDIO_SITE_ORIGIN` and rebuild to show/copy the published gallery's URL;
blank/unset configuration keeps copying disabled. It uses declared full locale
tags, shows a selectable manual fallback, sends no message and makes no availability
promise. See the [Studio workflow](../studio/README.md#ongoing-client-galleries-ab302--ab145).


## Optional article-end sections (AB365)

The backend implements the [accepted ADR-0036 contract](https://github.com/Alpine78/photosite-starter/pull/516)
for an optional `article.endGallerySections` catalog and `endGallerySectionHeading`.
The catalog has at most 20 ordered entries with stable section ID, localized slug
and label; it has no section introduction. A nonempty catalog needs an end-gallery
ID and a nonblank, content-authored heading of at most 160 characters. Heading and
labels describe the author's chosen categories, with no built-in rating scale.
The Studio field labels, help and custom errors support Finnish and English.
AB367 adds the [public controls and route/API integration](#article-end-filter-controls-ab367).
An article without a published catalog keeps its existing behavior.

`articleEndGalleryPlacement.sectionId` is optional free text, validated against the
**published containing article**, not its draft. An unassigned image belongs to All.
No dropdown or automatic classification is introduced. Publish a first single-locale
catalog before assigning its placements, or use an explicitly approved checked batch.
Among translations declaring catalogs, stable ID sets must match and shared placement
identities must have matching assignment, including assigned versus unassigned.
Translations without a catalog stay exempt but cannot publish an assigned section.

Article publication checks use a bounded published snapshot and limit-one conflict
witnesses; removal checks include hidden placements. Published array keys prevent an
in-place ID change and an existing section ID prevents an in-place slug change. These
checks compare the current published snapshot: they do not maintain tombstones or
prove that a deleted ID was never used historically. Retired IDs must not be reused.
Malformed snapshot/key data needs a reviewed repair, not silent validation success.

**Coordinated changes to existing multilingual classifications and ID sets require a
checked batch.** A locale with existing unassigned published placements cannot publish
a conflicting catalog/assignment first, and placements cannot borrow a draft-only
catalog. Ordinary Studio publishing cannot perform that cross-document transition.
A new translation with no published placements can instead publish its reviewed
catalog before its linked placement drafts, retaining the source's section IDs.
The shared language-copy planner marks the heading, section slugs and labels for
target-language review; clearing the other copied texts does not bypass these checks.
It does not translate text or publish anything automatically. Studio custom validation is a client-side
consistency check, not a transaction, authorization boundary or an enforcement layer
for direct API/CLI/MCP writes. A future content writer must verify complete prospective
state, revisions and backups; this source change authorizes no such operation.
See [Sanity's validation contract](https://www.sanity.io/docs/studio/validation).

Public article and pagination basics explicitly project only heading and bounded
ID/slug/label summaries; intros and provider metadata are excluded. Catalog output is
capped at 21 entries to detect overflow beyond the supported 20 without loading an
unbounded catalog. Malformed lists are represented as invalid rather than accidentally
collapsed to absence by GROQ traversal. A declared catalog's dangling returned rows fail
closed; legacy uncatalogued pages preserve their old window projection and ignore
membership fields that projection never requested.

The server adapter accepts only a resolved stable section ID and verifies it before
fetching placements. Its selected predicate applies to both candidate and continuation
boundary queries **before** the page-size-plus-one window. The core requires an exact
source acknowledgement. All includes unassigned items and retains its existing token
scope and manual ordering. The catalog and window are separate reads: an intervening
edit can yield a refused stale/malformed result; no atomic-snapshot guarantee is claimed.
Offline tests evaluate the actual queries using the Studio's existing `groq-js/1`
dependency and synthetic published fixtures. They prove query and projection semantics,
not a live provider perspective, ACL, CDN freshness or production content classification.


## Article-end filter controls (AB367)

An article declaring `endGallerySections` uses its authored
`endGallerySectionHeading` to name real All/section links. The optional catalog
reuses the gallery controls, including a single section plus All; it does not
introduce a numeric rating model. FI/EN application copy reports the selected
label, actually loaded images and whether more are available, with an explicit
empty state. No collection-wide totals are queried or promised.

Selected first pages and every continuation remain `noindex`, canonicalize to
the parameter-free article and omit hreflang. The visible language switch opens
the translated first article without section/cursor state. Unknown or repeated
selectors on catalogued articles return HTTP 404 before path normalization or window
reads. Articles without catalogs retain incidental section-query behavior.
`section=all` and an empty selector normalize to All on the page; the strict
append API accepts only a named slug or omission, with a mandatory cursor.
A stale catalog-selected ID returns404 when the source no longer declares it;
malformed CMS/source acknowledgements remain server defects, never All fallback.

Filter links clear continuation state and carry unrelated query values, including
repeated values. Hydrated links also follow the current article fragment, including
updates made by the reading-address observer. JavaScript-free links navigate to
real bounded server pages. Hydrated selection preserves the controls' viewport
and focus through grid replacement, including a continuation-to-initial transition.
A browser-only pending intent expires after 8 seconds and is cancelled by reader
input/history events; it is never persisted or populated by server rendering.
Article filter navigation takes priority over automatic saved-position restore.
The ordinary back-to-article link remains a fresh reading visit and may restore.
No localStorage schema or application-owned history.state field is added.

The selected viewer contains only loaded selected placements; body photographs
and minigalleries keep their independent groups. Catalog and placement reads remain
separate, as described above. Mock-mode journeys use a separate bilingual synthetic
article with interleaved selected/unassigned occurrences, leaving the earlier
reading fixture intact. They do not classify the actual retained 41-item collection.
That collection still needs its reviewed heading/labels, rendered-image/text approval
and a concrete revision-bound content plan with owner approval before any CMS write.

### Offline first adoption of article-end sections (AB#368)

`npm run plan:article-end-sections -- --manifest <private.json> --snapshot <complete-raw.ndjson> --out <new-private-directory>` prepares evidence only. It has no apply mode, provider client or credential. The target Studio must separately deploy the ADR-0036 article-end schema; `schemaContract` identifies the expected contract, not deployment proof.

The strict manifest uses `format: "article-end-adoption-intent-v1"`, `snapshot: {sha256, documentCount, observedAt}`, `article: {documentId, expectedRevision, contentId, language, endGalleryId}`, `sourceEvidenceSha256`, `heading`, ordered `sections: [{sectionId, slug, label}]` and `members: [{sourceItemId, sourceImageSha256, documentId, expectedRevision, placementId, mediaDocumentId, mediaRevision, mediaId, assetRef, sectionId}]`. `observedAt` is an explicit UTC ISO timestamp with milliseconds. Classifications and localized copy must be supplied, never inferred. Array keys are derived deterministically; empty sections are permitted and report zero members.

The NDJSON must be a complete raw capture, including drafts, releases, hidden placements and assets. The supplied raw SHA-256 and document count are pinned; a matching file alone cannot prove completeness, capture atomicity, freshness or source authenticity. Validate its independent capture receipt before real use. The tool checks the selected reference closure and refuses absent references, draft/release counterparts, duplicate or foreign identities and inconsistent shared occurrences. A missing `visible` is excluded as in the public predicate; visible rows must point to publicly renderable, non-private image media. Article expiry is checked at the supplied observation time, not the later execution time. Other public-media projection and real asset bytes are not revalidated.

This is first adoption only: any existing catalog, heading or membership field in the target/peer scope, even null or empty, is refused. Uncatalogued published language peers can remain unassigned. Catalogued or partially assigned peers require a separately coordinated plan. The only proposed changes are the target article catalog/heading and each visible placement's `sectionId`. Body, captions, media, identities, hidden placements and ordering remain unchanged.

`plan.json` is private (directory 0700, file 0600), exclusive and refused in Git-visible or already tracked output paths. A refused attempt can leave a private empty directory or partial evidence; these are preserved, so use a new output directory for a retry. Logs contain only counts, a digest and refusal codes. Keep inputs owner-private as well. The 64 MiB snapshot, 100,000-document, 2 MiB manifest, 2,000-member and 8 MiB report limits are local resource bounds, not transaction-capacity guarantees.

The canonical plan digest covers the complete report except `planSha256`. The manifest digest uses canonical keys and document-ID-sorted member bindings; catalog order remains meaningful. The snapshot digest binds exact raw bytes. Every changed document carries its expected revision, absent before-fields and after-fields. Unchanged-value hashes exclude only the changed fields, `_rev` and `_updatedAt`; read conditions for unmodified documents are advisory. A future writer must re-read and reconcile the entire selected closure, detect newly added variants/members/peers, enforce change revisions and a reviewed atomic-request budget. This artifact is neither a writer nor approval, backup, absence guarantee or transactional guard for unchanged documents.

First adoption makes incidental `section` parameters meaningful, unknown selectors return HTTP 404 and published section IDs/slugs become immutable. The star-rating use case also requires an owner-reviewed heading naming the author's rating. Real source-image bindings, review-text parity, translated labels, content approval and rendered results remain separate checks; AB#321/27 do not close from this planner.

### Offline pre-write revalidation of an adoption proposal (AB#369)

`npm run revalidate:article-end-sections -- --baseline-manifest <private.json> --baseline-snapshot <raw.ndjson> --baseline-digest <plan-sha256> --current-manifest <private.json> --current-snapshot <raw.ndjson> --out <new-private-directory>` compares two supplied captures using the same planner. The baseline digest must be the exact report digest from this planner version; it is an anchor, not owner approval. The supplied current manifest may repin raw snapshot bytes/count and observation time, but the time cannot precede the baseline. Equal times are allowed; no clock or live connection verifies recency.

All other plan semantics must match, including classifications, copy, catalog order, source bindings, revisions, complete scoped document hashes and proposed changes. Even an otherwise unrelated edit to the article or an advisory reference refuses. Only records outside the entire scoped proposal may change. Added peers, hidden members and variants are checked again; changing expiry or reaching expiry at the supplied time also refuses. No caller inputs or revisions are rebased.

The exclusive private `revalidation.json` embeds the complete current plan and records baseline/current plan digests, unchanged scope and an evidence digest. Its wrapper is included in the inherited 8 MiB output cap. Permissions, Git exclusion, input bounds, static diagnostics and preservation of unsuccessful output follow the planner above. Refused input creates no output; use a new directory after a partial output attempt. Neither evidence nor supplied capture is proof of completeness, authenticity, live state or execution-time atomicity, and `approved`, `writable` and `backup` stay false.

This is pre-write only. Once adoption fields exist, the first-adoption planner refuses; this command is not a post-apply verifier. A separate approved writer and a live recheck remain necessary before any CMS operation.
