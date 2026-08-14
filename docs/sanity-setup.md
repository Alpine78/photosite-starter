# Sanity setup, ownership, and failure behavior

How a deployment connects to its content store, who owns that store, and what the site
does when the store cannot be reached.

This covers the connection and the site settings, home page, shared media, and category
schemas. The remaining schemas, caching and webhook revalidation, and content seeding are
separate work items (AB#81, AB#83, AB#113, AB#114); until they land, every deployment runs on
`SITE_CONTENT_SOURCE=mock`.

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

Four document types exist: **siteSettings**, the deployment's brand, contact details, and
static navigation; **homePage**, the hero, introduction, and section links; **media**, the
shared photograph; and **category**, one node in the public content tree. Galleries,
articles, and services arrive with their own stories.

**Settings and home links name intent, not generated paths.** A link stores either an
application-owned root-relative static route, the generated story root, or the featured
gallery selected once by `featuredGalleryId`. The story namespace comes from deployment
route configuration, and the gallery route comes from its content identity and the public
tree. No category list or category path is copied into settings. If that gallery has no
published canonical route, the home action and section are omitted rather than pointed at
a 404; malformed or duplicated navigation is rejected.

Both settings and the home page are published singletons. A missing document and two
published documents are different classified content defects, and both raise instead of
falling back to fixtures. Their adapters validate the raw result, resolve language-keyed
text for the requested language, and return the existing project-owned `SiteSettings` and
`HomeContent` contracts. The home hero dereferences the shared media document through the
same public-media projection as every other image, so its stored asset, intrinsic
dimensions, and delivery policy cannot fork from the media boundary.

**The Studio validates against the dataset.** Several rules query it while an editor
works, which is the only place they can run in time: an uploaded image is measured and its
format checked before the document can be published, a media ID is checked for being
unique across the dataset and for not having changed since the last publish, and a
category id is checked the same way. They use the Studio's own client and need no extra
configuration.

**Categories describe the tree, never its content.** A category document carries a stable
`categoryId`, an optional reference to its parent, a sibling order, and a language-keyed
label and path segment — the same fields [`content-tree.ts`](../src/lib/content-tree.ts)'s
`ContentCategoryInput` needs, and nothing else. It never lists the galleries or articles
placed in it: ADR-0003 decision 5 makes canonical and secondary category placement a
property of the content being placed, so that reference lives on the gallery or article
document once AB#113 and AB#81 add it, not on the category. Before a standard Publish,
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
    // bilingual deployment of SITE_LOCALE_ROUTES=fi||tarinat,en|en|stories.
    storyRootPaths: ["/tarinat", "/en/stories"],
  }),
}
```

Declaring `private` makes a build-scoped `SANITY_READ_TOKEN` required: locally that is the
ordinary setting, while the reference pipeline maps its separate Azure build credential
to that name. The build fails without it rather than the site quietly serving an empty
version of itself.

**Archive locations, and where they may live.** The media document can carry an *Archive
location* — where your master lives, in your own archive. No query the site runs reads it,
so it never reaches a page. But storing it is a decision about the dataset, not about the
site:

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

## Not yet decided

- **Caching, revalidation, and the API CDN.** Reads currently go to the uncached
  `api.sanity.io` host with `cache: "no-store"`. AB#83 owns the cache contract — tag map,
  invalidation, expiry, and whether to move to `apicdn.sanity.io` — and that choice
  should be made there, deliberately, rather than inherited from a default set here.
- **The POST query form.** Reads use GET, bounded at Sanity's documented 11 KB. A query
  that outgrows it fails loudly rather than being truncated; the API's POST form would be
  implemented then, not speculatively now.
