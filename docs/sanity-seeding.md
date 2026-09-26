# Sample content seeding and handoff

How this project's sample Sanity documents get into a real Content Lake, how
to tell them apart from real customer content, and how to remove them before
a site goes live.

This is the seeding half `docs/sanity-setup.md` said would remain separate
work. It covers the script itself, not the connection, schemas, or failure
behavior — see that document for those; this one links back rather than
repeating them.

## What the script is, and is not

`scripts/seed-sanity-content.mts` (`npm run seed:sanity`) writes a fixed set
of sample documents — the same shape this repository's own schemas describe —
into a Sanity dataset over the plain HTTP mutate/asset-upload API. It is:

- **An owner-run tool, never wired into the application or CI.** No route
  reads it, no pipeline stage invokes it, and it is never bundled into the
  Next.js build (`scripts/` never is — see `AGENTS.md`'s conventions). You run
  it from your own machine, pointed at your own project, with your own
  credential.
- **A dataset to Sanity-owned by whoever runs it, at whatever URL they name.**
  It has no concept of "Preview" or "Production" beyond the `--project`/
  `--dataset` you pass it. Nothing stops you from pointing it at your real
  production dataset — the acceptance criterion this script exists to satisfy
  is literally "production content is seeded through a documented, repeatable,
  owner-controlled workflow" — but nothing stops you from pointing it at a
  throwaway dataset first, either, which is the recommended way to try it.
- **Repeatable, not incremental.** Every write is `createOrReplace` against a
  fixed document id (see *The `seed--` id namespace* below), so running the
  command again updates the same documents rather than duplicating them. It is
  not a diffing tool: it has no notion of "what changed since last time"
  beyond the stale-document report described below.
- **Sample content, not a starting draft.** It exists to prove the pipeline —
  schema, write, and read — end to end, and to give a freshly cloned site
  something to look at before the owner writes anything real. It is not meant
  to be edited into your actual content; delete it and start fresh instead
  (*Going live* below).

### What it writes

One run creates 474 documents, all deliberately built from the six real,
already-vetted, non-personal demo photographs in `public/gallery/` — no other
image bytes are ever uploaded, and one photograph legitimately backs many
documents, the same way ADR-0002 describes a real archive working:

| Kind | Count | Notes |
| --- | --- | --- |
| `media` | 6 | One document per demo photograph — never more identities than there are photographs |
| `category` | 6 | A 3-level tree: `landscapes` → `coastal` → `tidal-pools`, `landscapes` → `forest`, `journal` → `field-notes` |
| `siteSettings` | 1 | The one published singleton |
| `homePage` | 1 | The other published singleton |
| `service` | 3 | Portrait sessions, wedding coverage, fine art prints |
| `article` | 3 | One page authored in both `fi` and `en`, one `fi` only — demonstrating ADR-0003 decision 7's independent per-language publication |
| `gallery` | 3 | `featured` (2 sections, a body), `archive` (neither), `shuffled` (seeded-random) — see below |
| `galleryPlacement` | 451 | 26 in `featured` across its two sections, 400 in `archive`, 25 in `shuffled` |

The three galleries are deliberately built to exercise different parts of the
gallery schema at once:

- **`featured`** has two named sections (`high-tide`, `low-tide`) and a body
  (paragraph, heading, list, quote, and a media block) — the "sections and
  body" half of AB#105/AB#106's acceptance criteria.
- **`archive`** has neither, and its 400 placements are the "roughly
  400-placement fixture" half — enough to exercise
  `src/lib/sanity-gallery.ts`'s keyset-paginated read across several pages,
  not just its first one.
- **`shuffled`** (AB#129) is a `seeded-random` gallery: 3 pinned leads plus 22
  non-pinned placements, each of the 22 carrying a `shuffledOrder` key
  pre-computed from the fixture's own `orderingSeed`. It is written already
  consistent — every non-pinned placement's `shuffledOrderSeed` matches the
  gallery seed — so it serves immediately, with no `recompute:shuffled-order`
  pass needed. `verify:sanity-live` walks its materialized tiered order (pinned
  leads by `order`, then the rest by `shuffledOrder`).
- One photograph (from the shared 6-item pool) has a placement in **both**
  `featured` and `archive`, under two different `placementId`s — proving a
  single `media` document keeps one identity while appearing in two curated
  placements (ADR-0002).

### Locales

The fixture is written in `fi` (galleries, most content) and `en` (one
article, every category's label/slug). It targets the two language subtags
this project's documentation already uses as its running bilingual example
(`SITE_LOCALE_ROUTES=fi||tarinat,en|en|stories` in `docs/sanity-setup.md` and
`sanity/README.md`). A clone configured for different locales edits the
language list at the top of `scripts/sanity-seed-fixtures.mts` — the same file
a real content migration would eventually replace outright.

## Running it

```bash
# 1. Dry run (the default) — builds and validates the fixture set, prints a
#    summary, resolves the six demo photograph files, and stops. No network
#    call is made.
npm run seed:sanity

# 2. Point it at a real dataset and actually write:
export SANITY_SEED_TOKEN=...   # a write-scoped token — see below
npm run seed:sanity -- --project <id> --dataset <name> --api-version v2026-06-24 --yes
```

`--project`/`--dataset`/`--api-version` fall back to the same-named
`SANITY_PROJECT_ID`/`SANITY_DATASET`/`SANITY_API_VERSION` environment
variables the application itself uses — convenient if your shell already has
them exported for local development. The token has **no CLI flag at all,
deliberately**: a process's arguments are visible to other processes on the
same machine and commonly end up in shell history, which is not where a
write-scoped credential belongs. Set `SANITY_SEED_TOKEN` and nothing else —
**never `SANITY_READ_TOKEN`**: see *The write token* below.

### The write token

Mint a **separate, write-scoped API token** in your Sanity project's API
settings — the narrowest role Sanity offers that can create and update
documents (an "Editor" role, not "Administrator", is enough). Set it as
`SANITY_SEED_TOKEN` in your own shell, never in a deployment's environment
variables:

- It is never the same value as the runtime app's `SANITY_READ_TOKEN`. That
  token is baked into every deployment and is read-only; this one can write,
  and belongs only on the machine (or one-off CI run) that seeds content.
- It is never committed, never logged (`sanity-seed-http.mts` sends it only as
  an `Authorization` header and never writes it to a log line or error
  message — verified by that module's own test suite), and never placed in a
  URL.
- It is not required for a dry run. Only `--yes` needs it.

### Dry run is the default, on purpose

`--yes` is the only thing that makes a network call. Without it, the script
builds the full 474-document fixture set, runs every structural invariant
check it knows about (`validateSeedFixtures` in `sanity-seed-fixtures.mts` —
unique ids, every reference resolving to the right document type, no cycle in
the category tree, at least one gallery with sections *and* a body and at
least one with neither, exactly 400 archive placements, every seeded-random
placement's `shuffledOrder` matching `HMAC(seed, placementId)`, the
shared-media invariant, and more), prints a per-type count, and lists the six
demo photograph files it
found in `public/gallery/`. That is everything worth checking before you ever
touch a real project, and none of it needs a credential.

## The public `seed--` id namespace

Every document this script writes gets a **deterministic, root-level,
dot-free `_id`**: `seed--media--coastal-landscape`,
`seed--category--tidal-pools`, `seed--gallery--archive--fi`,
`seed--placement--archive-0001`, and so on, plus the two singletons
`seed--site-settings` and `seed--home-page`. Sanity's
[IDs and paths documentation](https://www.sanity.io/docs/content-lake/ids)
states that every id containing a dot is restricted to authenticated reads,
even in a public dataset. Keeping these
ids at the root is therefore what lets the application's tokenless public-
dataset client read the sample content; the CLI's write token must not be the
only reason verification can see it.

The reserved `seed--` prefix makes the fixture set both repeatable (re-running
`--yes` is `createOrReplace` against the same ids, so it converges rather than
duplicating) and, more importantly, **distinguishable from customer
content**. Cleanup normalizes published, `drafts.`, and
`versions.<release>.` ids and checks this prefix locally, since one GROQ
`path()` expression cannot match a root id plus both optional system prefixes.
Never mint a real `mediaId`,
`categoryId`, `contentId`, `placementId`, or singleton document under a
`seed--` id yourself.

The first AB#84 implementation briefly used private `seed.…` dot-path ids.
`--delete-all` still recognizes and removes those legacy ids so an early
smoke-test dataset can be cleaned before it is seeded again; the write path
never creates them.

**Uploaded assets are the one exception.** Sanity mints an asset document's id
itself on upload (`image-<hash>-<dimensions>-<format>`), so the six uploaded
photographs are not under `seed--` and are not found by the document cleanup.
With only six of them, this is a proportionate, disclosed manual step rather
than something worth building orphan-asset detection for — see *Going live*.

### Stale documents across a fixture revision

If a future edit to `sanity-seed-fixtures.mts` removes something a previous
run wrote (a placement, a service, an entire gallery), that old document is
still sitting in your dataset under its old `seed--` id — `createOrReplace`
only ever touches documents in the *current* manifest, it never deletes on
its own. Every `--yes` run reports any such document by id. Add
`--prune-stale` to actually delete them:

```bash
npm run seed:sanity -- --project <id> --dataset <name> --api-version v2026-06-24 --yes --prune-stale
```

Deletion is opt-in rather than automatic — a script quietly deleting
documents on every run is a bigger risk than a stale document sitting
unused, and the report alone is often all you need.

## What happens on `--yes`, in order

1. **Preflight.** Before writing anything — before even uploading an asset —
   the script checks the target dataset for a document that already claims
   one of this fixture's own public identities under a *different* id: the
   `siteSettings`/`homePage` singletons, every `mediaId`, every `categoryId`,
   every service `(serviceId, language)`, and every article/gallery `(contentId, language)`
   pair, plus all 426 `placementId` values. Placement identities are checked
   in bounded chunks so no GET crosses Sanity's URL-size limit. This fixture's
   own identity values ("landscapes", "featured", "coastal-landscape", …) are
   ordinary, plausible names a dataset that already has some real content
   could easily be using — and the mutate API has no Studio validation to
   catch that collision itself, unlike an ordinary editor's publish. Any
   collision refuses the run outright: two documents claiming one identity is
   exactly the state the application's own read adapters refuse to serve,
   and that failure has to happen here, loudly, not as a mystery on the live
   site.
2. **Upload.** The six demo photographs are uploaded once each (an asset may
   legitimately back more than one `media` document — see above). Each
   response is checked against the exact same public-delivery policy
   `sanity/schemas/media.ts`'s own Studio validation enforces (longest edge,
   format/mime-type agreement) before it is trusted, even though these six
   files are already known-good — the only check available for a write that
   goes around the Studio entirely. The HTTP Asset API otherwise retains the
   supplied original filename, so the writer immediately unsets
   `originalFilename` from the asset document before it can be referenced by
   published media. This mirrors the Studio schema's
   `storeOriginalFilename: false` policy and keeps archive or client filename
   information out of the public dataset.
3. **Write.** All 474 documents are sent as `createOrReplace` mutations, in
   batches (a self-chosen, conservative size — not a documented Sanity limit —
   so one request stays small and one failure is cheap to diagnose), ordered
   categories → media → settings/home/services/articles/galleries →
   placements — every reference field this schema set declares is a **strong**
   reference (Sanity's default; nothing here sets `weak: true`), and Sanity's
   own documentation says a strong reference "will enforce that the document
   it points to actually exists", so the referenced side is always written
   before whatever references it. Because every write targets a fixed id, **a
   run that fails partway through is safe to simply re-run in full**: every
   earlier batch's writes are idempotent no-ops the second time.
4. **Stale report / prune**, as described above. It runs before verification
   so the operator sees exactly what changed before the final readback.
5. **Live verification.** This is the actual proof of this story's
   "representative content queries pass" acceptance criterion: a fixed set of
   hand-written GROQ checks — do the two singletons read back with their
   expected fields, does the category count match, does the archive gallery's
   placement window have exactly 400 rows, do the featured gallery's two
   declared sections show up, does at least one media document have a
   placement in both galleries — run against the dataset you just wrote to,
   for real. Each prints `PASS` or `FAIL`; any failure exits non-zero (the
   write already happened by this point; see below).

### What each verification layer actually proves

Four different guarantees exist in this story, and they are not restatements
of each other. Notably, the third row — this script's own built-in
`--yes` step — is **not** adapter coverage: it is hand-written GROQ that
proves the documents exist and are shaped right, not that the real
`src/lib/sanity-*.ts` code that will eventually read them actually works.
Only the fourth row proves that; an earlier draft of this document
overstated the third row's reach, and AB#84's own review caught it.

| Layer | What it proves | Needs a real project? |
| --- | --- | --- |
| `sanity-seed-fixtures.test.mts` (`validateSeedFixtures`) | The fixture set's own internal structure is correct — unique ids, every reference resolves, the tree is acyclic, the counts match | No |
| `sanity-seed-content-verification.test.mts` | This fixture's `media`/`siteSettings`/`homePage` content projects through the real projectors, and the 400-placement archive walks first through final cursor pages through the real `readSanityCuratedGalleryPage` adapter | No — offline, via Vitest's `server-only` stub and a seed-document-backed store boundary |
| `seed-sanity-content.mts --yes`'s live verification step | The written documents are actually queryable, in the shapes above, from a real Content Lake — via hand-written GROQ, not the repository's own read adapters | Yes |
| `src/lib/sanity-live-verification.test.ts` (`npm run verify:sanity-live`) | The real `src/lib/sanity-*.ts` adapters — settings, home, services, categories/content tree, articles in both published languages, gallery sections, media projection, sibling and placement ordering, and the full 400-item archive gallery's cursor chain page by page including the page-size boundary — actually work against a real Content Lake, using a real `SanityClient` and injected Preview configuration | Yes |

The article, content-tree, and services adapters are exercised, live, only by
the fourth row — the offline verification file's own module comment already
disclosed that it covers gallery placements alone, narrower than a GROQ
interpreter: it answers the adapter's two owned query tags from the actual
seed documents while leaving cursor creation, scope validation, keyset
advancement, projection, page size, and completion to production adapter
code. `verify:sanity-live` is opt-in and separate from `npm test` (it reaches
a real network) and from route wiring (nothing under `src/app` or
`src/components` imports it) — it exists to prove the adapters work, not to
switch anything over to them.

### `sanity-client.test.ts` already covers failure behavior

This story does not re-test what `docs/sanity-setup.md`'s
*Failure behavior* table already documents and `src/lib/sanity-client.test.ts`
already proves — the `unauthorized`/`not-found`/`rate-limited`/etc. failure
classification is unchanged by anything here. What this story adds is the
content that makes those classes observable against real content instead of
an empty dataset: a missing document versus a private-but-uncredentialed read
now differ in exactly the way that document already describes, because there
is finally something to be missing.

## Going live: removing the sample content

**Do this before real customer content grows, not after.** `--delete-all`
and `--prune-stale` both find candidates by fetching every document of each
seeded type (`media`, `category`, `service`, `article`, `gallery`,
`galleryPlacement`, plus the two singletons) and filtering to the current
`seed--` or legacy `seed.` prefix locally. One GROQ expression cannot narrow
a root-level prefix while also allowing optional `drafts.` and
`versions.<release>.` system prefixes. On a dataset that
already holds a lot of real content of these types, that is a meaningfully
bigger read than the few hundred documents this fixture itself seeds. This
is exactly why the recommended order of operations is seed → verify →
clean up, before authoring real content grows the same document types.

Before real customer content is authored (or before this dataset becomes the
one a production deployment reads), remove every document this script wrote:

1. **Find the six uploaded asset ids before deleting anything**, while the
   `media` documents that reference them still exist — this is much easier
   than searching Studio's media browser by hand, and does not depend on the
   assets carrying any recognizable filename (the writer removes the HTTP
   upload API's default `originalFilename` field before publishing):

   ```groq
   *[
     _type == "media" &&
     (_id in [
       "seed--media--coastal-landscape",
       "seed--media--forest-stream",
       "seed--media--lakeside-reeds",
       "seed--media--lichen-stones",
       "seed--media--misty-birch",
       "seed--media--open-marsh"
     ] || _id in path("seed.media.**"))
   ].image.asset._ref
   ```

   The legacy `path()` branch only exists for datasets touched by the first
   AB#84 smoke-test implementation.

   Keep this list; you delete these assets in step 3.
2. **Delete every seed-owned document:**

   ```bash
   SANITY_SEED_TOKEN=... npm run seed:sanity -- --project <id> --dataset <name> --api-version v2026-06-24 --delete-all --yes
   ```

   This is the real cleanup command — `--delete-all` never builds or
   validates the fixture set (an earlier draft of this doc suggested
   emptying `sanity-seed-fixtures.mts`'s own document list and re-running
   with `--prune-stale`, which cannot work: an empty fixture set fails
   `validateSeedFixtures`'s own structural checks before it ever gets to
   pruning anything). It also finds and deletes any draft or content-release
   copy of a seeded document, not just the published one — a draft edit
   left open in Studio is still found. It only queries and deletes, in the
   sequence of waves that is safe against this schema set's strong
   references (Sanity's default; nothing here sets `weak: true`, and
   Sanity's own documentation says a strong reference "will not allow
   deletion of a document that any other document refers to"): every
   `galleryPlacement` first (the only type referencing a gallery or media
   document while nothing references it back), then articles/galleries/
   services/the home page (which reference media and categories), then
   categories themselves — as many sub-waves deep as the tree actually is,
   deepest first, since a category can reference another category as its
   own parent — then media, then finally site settings, which references
   nothing. See `orderSeedDocumentsForDeletion` in
   `scripts/sanity-seed-fixtures.mts` for the exact reference graph this
   reflects. A manual delete through Studio's bulk-delete UI or the
   `sanity documents delete` CLI works too, in that same wave order, if you
   would rather not run the script. After deletion the command repeats its
   raw-perspective lookup and exits non-zero while naming every seed-owned id
   that remains; a successful exit is the document-cleanup verification.
3. **Delete the six assets found in step 1** — they are not under `seed--`
   (Sanity mints an asset document's own id on upload) and are not deleted by
   step 2, so they need their own pass, using the ids you already have.
4. **Verify asset deletion** by querying the six asset ids saved in step 1:

   ```groq
   *[_id in ["image-…", "image-…"]]._id
   ```

   An empty result confirms the separately managed assets are gone; step 2's
   built-in raw-perspective verification already proved that no seed document,
   draft, or release version remains.

Nothing in this repository enforces that cleanup automatically. A production
deployment refuses to declare `SITE_CONTENT_SOURCE=mock` (see
`docs/sanity-setup.md`), but once route-facing seams read from `sanity`
(a later story — see `AGENTS.md`'s feature-status paragraph), a deployment
reading a dataset that still holds `seed--` documents would serve them as if
they were real. Treat this checklist as part of go-live, not as optional
cleanup.

## Export and recovery

This script has no export, backup, or rollback of its own beyond the opt-in
`--prune-stale`/`--delete-all` deletion described above — everything else it
does is additive/idempotent-replace only. For everything else, use Sanity's
own tooling, which already exists and is documented by Sanity, not invented
here:

- **`sanity datasets export <dataset> <local-archive>`** — a full dataset export, including
  assets, to a local archive. Run this before a destructive operation you are
  not fully certain about, seeded content or not.
- **`sanity datasets import <file> <dataset>`** — imports that archive. A
  replacement import does not by itself remove unrelated documents added
  after the export; compare the restored dataset with the baseline before
  calling rollback complete.
- Sanity's own document history (available on paid plans) can recover an
  individual document's prior state without a full dataset restore.

See Sanity's [export guide](https://www.sanity.io/docs/content-lake/exporting-data)
and [CLI reference](https://www.sanity.io/docs/cli-reference/cli-datasets) for
current flags and behavior.

## Migrating approved content from an existing site (AB#137)

`npm run seed:sanity` writes the fixed demo fixture described above. It is
not an importer for an existing site's articles, galleries, or images. A
source migration needs an owner-reviewed manifest of **individual public
items**, keyed by stable source identity. A published flag in an old CMS is
only a candidate signal: a source may also contain private galleries,
abandoned assets, and content that the new site's body blocks cannot yet
represent. Keep source exports, image trees, review sheets, and tokens outside
Git; a clone must inherit none of them.

Before any Production write, record for each chosen item its source identity,
new canonical route, media and derivative choice, and explicit launch decision
with approver and date in an owner-controlled private manifest. An unmatched
image, unresolved rights or privacy classification, or unsupported body markup
keeps that item **out** of the import until resolved. Do not copy raw CMS HTML,
camera masters, archive paths, private proofs, or sales assets into a public
Sanity dataset. Record a non-secret manifest digest and the owner's approval
on AB#137; retain the manifest itself privately. This gives AB#117 a stable
record without putting customer content in the public repository or Board.

First run `npm run audit:sanity` with a Viewer credential to see all
Production states, including drafts, releases, and assets. An anonymous
published-content query cannot establish that the dataset is empty. If it is
nonempty, take and verify a recoverable export **before** changing it, for
example with the current Sanity CLI's `sanity datasets export <dataset>
<secure-local-archive> --project-id <project-id>` command. Keep that archive
outside Git and document its location, retention, and restore operator in the
private handoff record. Dry-run the approved mapping locally. If a live
Preview rehearsal is needed, audit and back up its existing content first;
never overwrite Preview fixtures just to test an import. The import
implementation must match the approved manifest; the demo seeder must not be
used as a shortcut.

### The conversion step: `npm run convert:joomla`

The first half of that separate implementation exists. It converts an exported
set of legacy articles into this project's shared content blocks and reports
exactly what would and would not migrate. **It performs no write of any kind** —
no network request, no Sanity credential, no dataset change — and the plan it
produces is marked non-writable by construction. The write step
(`npm run write:joomla`) that turns this plan into real Sanity documents is
described further down, after the conversion step's own contract.

```bash
# Review pass: convert everything the manifest selects, whatever its eligibility.
npm run convert:joomla -- \
  --source <articles.ndjson> \
  --resolution <resolution.json> \
  --image-root <image-tree> \
  --out <report-dir>

# Plan pass: strictly approval-gated, one phase.
npm run convert:joomla -- \
  --source <articles.ndjson> \
  --resolution <resolution.json> \
  --image-root <image-tree> \
  --manifest <approved-manifest.csv> \
  --categories "<categoryId> <categoryId> …" \
  --phase launch \
  --out <report-dir> --plan
```

Every option name is validated: `--source`, `--out`, `--manifest`, `--resolution`,
`--image-root`, `--phase`, `--categories`, `--plan`, and `--review` are the
only ones recognized. A typo (`--phaze` instead of `--phase`) fails the
command rather than being silently absorbed while the phase quietly stays at
its default — phase decides which approved rows a `--plan` write covers, so a
silently wrong one is not a cosmetic mistake (found in Codex review round 10).

There are two modes because of a real ordering problem. Every row in the
selection worksheet starts out not yet eligible for import, and what makes a row
eligible is knowing what its conversion would lose or refuse. An approval-gated
tool alone could never produce the findings needed to grant the approval it
demands. `--review` (the default) therefore converts every selected article and
reports; `--plan` builds the import plan from fully approved rows only.

**Inputs.** `--source` is a newline-delimited JSON export, one line per article
per language: `joomlaId`, `language`, `title`, `body` (the raw source HTML),
and optionally `summary`, `author`, `tags`. This is a deliberately small
contract rather than a general Joomla SQL or archive reader — produce it once
from the backup. `--resolution` is a JSON file mapping each body image `src` to
its **approved locator and content hash** (`{"locator": "…", "sha256": "…"}` —
a bare locator string was the original shape, but nothing then verified a
loose image's bytes the way a gallery file's already were, so an in-place
substitution here was invisible everywhere, including the resolved-output
digest below), each locator to its **language-keyed** alternative text
(`{"fi": "…", "en": "…"}`, never a bare string — a translated article pair
commonly shares one gallery folder, so a single string per locator would
attribute one language's alt text to the other language's article), each
gallery folder to its owner-approved **ordered file inventory**
(`galleryFiles`: each entry a `filename` and the file's SHA-256, not merely a
count — a file count alone cannot tell a substituted photograph from the
approved one, only that the folder holds the right number of *something*, and
a repeated filename in that inventory is itself refused rather than silently
collapsed), and a YouTube video id to its accessible title (`youtubeTitles`).
`--image-root` is the local image tree; the tool reads every approved image's
and gallery file's bytes to verify its content hash, though nothing is
uploaded or transmitted anywhere. Without `--image-root`, or when a file is
missing or its bytes do not match, an image or gallery simply does not
resolve — refused the same way an unapproved reference is, never resolved on
trust alone.

**The manifest.** A semicolon-delimited file with these columns:

| Column | Meaning |
| --- | --- |
| `joomla_id`, `language` | Source identity. One row per article per language. |
| `content_id` | Shared across a page's languages; with `language` it is the article's whole identity. |
| `slug`, `canonical_category`, `secondary_categories` | The new canonical route and placement. `canonical_category` is a category identity, or the reserved token `@story-root` for a page directly beneath the localized story namespace; an empty value is never a placement. |
| `phase` | Which write this row belongs to (the owner's "Lever B" phased manifest). |
| `published_at`, `event_date` | ISO instants (any real spelling — a numeric offset, no fractional seconds — is accepted and then canonicalized to the exact UTC-`.000Z` shape `src/lib/sanity-article.ts`'s own reader requires, so the planned document is never something the production adapter would reject); `event_date` is the public ordering key (ADR-0017). |
| `source_digest` | SHA-256 over the whole imported record — title, summary, author, tags, and body, not the body alone — this approval was given against. |
| `resolved_digest` | SHA-256 over the *resolved conversion output* — the actual photograph identities, verified content hashes, gallery order, alt text, and video titles — printed as `resolvedDigest` in `findings.json` for the owner to copy in. |
| `conversion_policy` | The conversion policy version the approval was reviewed under. |
| `acknowledged_findings` | Lossy finding codes the owner has accepted for this article. |
| `public_launch_decision`, `eligible_for_import` | `INCLUDE`/`LATER`/`EXCLUDE`, and `YES`/`NO`. |
| `approved_by`, `approved_at` | Who approved it and when. |

A row that is `LATER`, `EXCLUDE`, not yet eligible, or approved for another
phase is **deferred** and reported with its reason. A row that *claims* approval
while missing the approver, the date, the digest, or the phase is an **error**,
because a malformed approval record must not read as a deferral and quietly
disappear from the launch. An identity or route collision is an error even
across phases, since a later phase colliding with this one would otherwise only
surface at write time. Naming a phase no approved row matches is an error too,
rather than a clean run over nothing.

**Why the digest covers the whole record, not just the body.** An approval that
digested only the HTML body would let an edited title or author slip through
unreviewed while the body stayed byte-identical — the digest exists to answer
"is this still the thing that was approved," and a title is part of that thing.

**Why there are two digests, not one.** `source_digest` covers what the owner
supplied in the source export. It cannot see a change to `resolution.json` —
a different photograph substituted for the same `src`, an edited alt text, a
reordered gallery, or a changed YouTube title — since none of that touches
the source article text at all. `resolved_digest` closes that gap: it covers
the actual resolved output (`resolvedConversionDigest` in
`joomla-html-conversion.mts`), so an edit to the resolution file after
approval is caught the same way an edit to the article itself is, even though
neither `source_digest` nor the conversion policy would have moved.

**Why the digest and the policy version travel with the approval.** A conversion
can lose a link's destination while keeping its words — "download the programme"
still reads correctly while doing nothing. The owner may accept that, but the
acceptance has to name what was accepted. Re-editing the source article, or
changing a conversion rule, invalidates the acknowledgement rather than letting
it silently carry over to content nobody re-reviewed.

**What the conversion refuses.** Anything with no equivalent in the shared block
set: an unknown element, a Joomla `{loadposition}`/`{loadmodule}`/`{contentpoll}`
marker, a non-YouTube embed, script or style, content hidden by a style rule
(`display:none`/`visibility:hidden` plus `opacity:0`, `visibility:collapse`,
and `font-size:0` in any of their common spellings — a merely small or
translucent value, like `opacity:0.5`, is untouched. This is a bounded,
pattern-based check for the known common techniques, not a CSS parser; a
compound technique such as `position:absolute;left:-9999px` still passes as
ordinary presentation, a named and deliberately unclosed gap), an
attribute that could carry behaviour — checked **per element**, not once
globally: `src`, `href`, `alt`, `colspan`/`rowspan`, and `start`/`type` are
structural only on the specific element that actually reads them (an `<img>`,
an `<a>`, a table cell, an `<ol>`), so `href` on a `<p>` or `src` on an `<a>`
is refused rather than silently accepted the way a flat, tag-independent
allow-list once let it through — `<br>` and `<hr>` go through the same
allow-list too, since they had been the two elements this check never ran on
at all, letting a dropped anchor id or a behavioural attribute vanish with no
finding — a heading outside levels 2–4 or out of
semantic order, a nested list, a headerless or ragged or merged-cell table, a
`<th>` outside a table's first row (a second header row, or a row header — the
shared table block has one header row only), an image with no approved identity
or no alternative text, a YouTube video with no accessible title, a gallery
whose folder disagrees with the approved count, a second oversized gallery in
one article (an article owns at most one end gallery), a photograph the owner's
own persisted identity map claims is shared between two locators whose verified
bytes actually differ (an unresolvable ambiguity about which file is canonical
— it fails the whole run rather than picking one by processing order), the same
photograph appearing twice in one gallery with two different approved alt texts
for the same language (alt text is authored once, on the shared media
document — a disagreement is an authoring ambiguity, not something to silently
resolve by keeping whichever occurrence was listed last), and a body that
converted to nothing. Presentation — classes, inline styles, Word
residue — is dropped and *recorded*, because the new site owns its own design.
A single `<p>` wrapping a quote or list item's text is flattened without a
finding (it is exactly representable); more than one is flattened too, with the
paragraph boundary itself recorded as lossy, since a quote or item is one flat
string. Nothing is ever dropped silently.

**The plan is never writable from here.** Two things cannot be known offline:
which Sanity asset a photograph's derivative becomes, and which document id a
category identity resolves to in the target dataset. Both are emitted as
explicit pending markers rather than guessed, so a plan carrying a placeholder
can never be mistaken for one ready to write.

**Identity.** `photograph-identities.json` in the report directory is
**two-part**: `byLocator` maps each source locator to the stable photograph
identity minted for it, and `byContentHash` maps each verified content hash to
that same identity. **Keep the whole file and pass it back on the next run**
(`photographIdentities` in the resolution file, same two-part shape):
ADR-0002 §1 requires a photograph's identity to survive a filename change, a
re-upload, and a re-run, and `byLocator` alone cannot do that — a renamed or
moved file simply has no entry under its *new* path, so a locator-only map
would mint it a second, different identity. `byContentHash` closes that gap as
a **lookup correlation only, never as the identity's own derivation**: if a new
locator's verified bytes match a hash already known under any other locator,
the existing identity is reused instead of a fresh one being minted. A
genuinely reprocessed photograph (different bytes for what is still the same
work) is exactly the case a hash *cannot* correlate, and still needs the
owner to carry the identity over by hand, as ADR-0002 already expects.

**`mediaId` itself is minted opaquely — a random token, never derived from the
locator.** An earlier draft of this tool hashed the source locator (a private
path that embeds the original filename) directly into the returned identity,
which is exactly the derivation ADR-0002 §1 forbids: not "not derived from a
content hash," but not derived from the filename, a CDN URL, or a provider
asset id either. A locator-derived id is not a genuine mint, it is whatever
the source tree's naming happened to be at the moment the tool first saw a
file. `mintPhotographIdentity()` now takes no locator at all and returns a
fresh CSPRNG token; the persisted `byLocator`/`byContentHash` maps are the
*only* mechanism carrying an identity forward, exactly as the paragraph above
already required of them.

Because minting is now genuinely non-deterministic, an owner who does not
carry `photograph-identities.json` forward between runs will see a *new*,
different set of ids on every run over the same photographs — this was always
the documented workflow ("keep it and pass it back"), but it is no longer
possible to skip by accident and still get a stable-looking result: a fresh
mint every time is now visibly fresh, not silently derived from a path that
happened not to change.

**Three conflicts are detected, and any one fails the whole run before the
rest of the report is written** — no `findings.json`, no
`photograph-identities.json`, only a private `conflicts.json` naming what
disagreed — so neither an ambiguous choice nor a silently-collapsed value can
be inherited by a later run:

- An **identity conflict**: the owner's own persisted `byLocator` map claims
  two *currently referenced* locators are the same photograph, but their
  verified bytes actually differ. One identity must resolve to exactly one
  physical asset; the tool cannot know which of the two is canonical, and
  picking "whichever was processed last" would make the plan silently
  order-dependent.
- A **persisted-index disagreement**: the *same* file's `byLocator` and
  `byContentHash` entries name two *different* identities — a hand-edited or
  merged `photograph-identities.json` gone inconsistent. An earlier draft
  preferred `byLocator` whenever both existed, which silently overwrote
  `byContentHash` with it; the same photograph could then end up with a
  different id depending on which locator happened to be processed first,
  exactly what the two-index design exists to prevent (found in Codex review
  round 10). This is caught before either index is trusted, not resolved by
  an arbitrary preference order.
- An **alt-text conflict**: the same photograph (by content hash) appears
  twice in one gallery with two different owner-approved alt texts for the
  same language. Alt text is authored once, on the shared media document
  (ADR-0008) — two disagreeing values for one photograph is an authoring
  ambiguity the tool refuses to silently resolve by keeping whichever
  occurrence happened to be listed last.

Every verified content hash also travels into `resolvedConversionDigest`
(`joomla-html-conversion.mts`), so a file swapped in place — same locator,
same identity, different pixels, with its recorded hash updated to match —
still invalidates a stale approval even though nothing else about the
resolved output changed. One photograph used twice is one identity and two
placements, never two photographs.
An end-gallery occurrence's `placementId` is itself language-free: an fi/en
translation pair of the same article shares the same occurrence id for the
same photograph sequence, exactly as `galleryPlacement`'s own cross-language
sharing already works, so a live audit can recognize the same occurrence
across both languages.

Migrated documents live in their own `migrated--` id namespace, deliberately not
the demo seeder's `seed--`. That is a safety property: `npm run seed:sanity --
--delete-all` deletes every `seed--` document, so real launch content written
under that prefix would be destroyable by the demo seeder's own cleanup command.

**The report directory is private migration material.** Findings carry bounded
source excerpts, dropped link targets, and converted bodies. Keep it out of Git
and out of shared evidence; what belongs on the work item is the counts and the
digests the command prints. This is enforced for the identity and alt-text
conflicts too: their full detail — private source locators, content hashes,
localized alt text — goes only into a mode-0600 `conflicts.json` in the report
directory, never to the console; an earlier draft printed the full detail to
stderr, which this repository's own terminal or CI logs could then retain
(found in Codex review round 10). A malformed `--plan` manifest's own row
errors get the same treatment — a route or a content id a colliding row names
is exactly the kind of private, pre-launch detail this rule exists for — into
a mode-0600 `manifest-errors.json`, with only the error count on stderr (found
leaking the same way in Codex review round 11). Two more private-detail cases
get the identical treatment: an approved manifest row with no matching article
in the source export (`missing-from-export.json` — the older of the three
console-leak instances, present since this tool's first slice, closed in round
12), and a malformed entry in the persisted `photograph-identities.json`
(`malformed-identities.json`). The malformed-identity check runs *before*
conversion starts at all: without it, a bad persisted value would flow all the
way through and only surface as an uncaught exception deep inside
`buildImportPlan`'s own `migratedId` call — a crash instead of the diagnosable
private report every other failure mode here produces (round 12).

### Writing an approved localized service plan

`npm run write:services` writes a reviewed JSON plan containing only `service`
documents. It is separate from the Joomla article/gallery writer because a service has
no category placement, media upload, or body conversion. A dry run validates every
field, deterministic document id, language-local parent, sibling slug, and parent graph,
then prints the digest that binds the later write to those exact documents. It makes no
network request and needs no credential:

```bash
npm run write:services -- --plan <service-write-plan.json>
```

The real write requires the printed digest and a temporary Editor-role migration token.
It checks the target dataset before writing, refuses drafts and differing documents under
the planned ids, writes parents before children with `createIfNotExists`, and reads every
document back afterward. It never replaces an existing document; an identical prior write
is accepted as an idempotent rerun.

```bash
SANITY_MIGRATION_TOKEN=<temporary-editor-token> npm run write:services -- \
  --plan <service-write-plan.json> \
  --approved-digest <dry-run-digest> \
  --project <project-id> --dataset <dataset> --api-version <api-version> \
  --yes
```

### Creating an approved category tree fragment

`npm run write:categories` creates a reviewed fragment of the public category
tree before an approved Joomla content plan resolves its category references. It
accepts only category fields from the current Studio schema: stable identity, a
parent reference, localized labels and slugs, the restricted category
description blocks, and sibling order. It never writes a gallery, media asset,
or page.

```bash
# Validate locally; this prints the digest and makes no network request.
npm run write:categories -- --plan <category-write-plan.json>

# Apply only the exact reviewed digest with a temporary Editor token.
SANITY_MIGRATION_TOKEN=<temporary-editor-token> npm run write:categories -- \
  --plan <category-write-plan.json> \
  --approved-digest <reviewed-sha256> \
  --project <project-id> --dataset <dataset> --api-version <api-version> --yes
```

The writer validates all localized path segments locally, writes parent nodes
before their children, and uses `createIfNotExists`. Before applying, it rejects
a draft of a planned id, an existing document with altered content, or a
different document that already owns the planned `categoryId`. Its final
read-back must match the exact approved plan. A category-only dry run does not
contact Sanity; the apply-time preflight does.

Run this as a controlled prerequisite to `write:joomla`, not as a replacement
for the content writer's category-resolution and route-collision preflight.
The latter still verifies that an approved article or gallery can occupy its
localized public route without colliding with existing content.

### Writing approved site settings and home page

`npm run write:foundation` writes exactly one `siteSettings` singleton and one
`homePage` singleton from an owner-reviewed plan. It is separate from gallery
import because it does not upload assets or resolve category references. The
apply-time preflight refuses a draft, an owner-edited planned singleton, or a
second singleton of either type. It also proves that the home hero already
exists as published public media and that an optional featured-gallery identity
already exists before either singleton is created.

```bash
# Offline validation only. It prints the digest that the owner reviews.
npm run write:foundation -- --plan <foundation-write-plan.json>

# Apply the exact reviewed foundation plan after its referenced gallery exists.
SANITY_MIGRATION_TOKEN=<temporary-editor-token> npm run write:foundation -- \
  --plan <foundation-write-plan.json> \
  --approved-digest <dry-run-digest> \
  --project <project-id> --dataset <dataset> --api-version <api-version> --yes
```

The command never patches or replaces an existing singleton. An exact prior
run is accepted as an idempotent rerun; any difference stops before mutation.
Its normal dependency order is categories, gallery media/content/placements,
then foundation, because the home hero and featured gallery must be readable
before the foundation preflight succeeds.

### The write step: `npm run write:joomla`

Takes the plan `convert:joomla --plan` produced and turns it into real Sanity
documents: generates each photograph's public web-delivery derivative,
uploads it, resolves each category reference against the target dataset's
real document ids, substitutes both kinds of pending marker in place, and
writes. **Dry-run by default, exactly like `npm run seed:sanity`**: without
`--yes`, this command makes no network request at all, not even a read —
every step is local filesystem and CPU only, so an operator can validate a
plan's photographs are readable and decodable before ever minting a
write-scoped credential.

```bash
# Dry run: verifies every photograph locally, reports counts, touches no network.
# <plan-digest> is the "Plan digest: …" line convert:joomla --plan printed —
# copy it forward after reviewing the plan, the same way a manifest's own
# resolved_digest column is copied forward from a conversion's own output.
npm run write:joomla -- \
  --plan <report-dir>/import-plan.json \
  --image-root <image-tree> \
  --out <write-report-dir> \
  --approved-digest <plan-digest>

# Real write, against a temporary write-scoped credential.
SANITY_MIGRATION_TOKEN=<temporary-editor-token> npm run write:joomla -- \
  --plan <report-dir>/import-plan.json \
  --image-root <image-tree> \
  --out <write-report-dir> \
  --approved-digest <plan-digest> \
  --project <project-id> --dataset <dataset> --api-version <api-version> \
  --yes
```

**`--approved-digest` confirms this is the exact plan that was reviewed.**
`import-plan.json`'s `manifestDigest`/`sourceExportDigest` (and the
conversion's own `resolvedDigest`) bind the owner's manifest approval to what
`convert:joomla` produced — but neither is checked again once the plan file
is written to disk, and this write step has no access to the manifest, the
source export, or the resolution file to re-derive them; it only ever reads
`import-plan.json` itself. A hand edit or a file-system corruption after the
plan was produced would otherwise change what gets published with nothing to
catch it, even though every image byte is separately re-hashed. `--approved-
digest` closes that gap: `convert:joomla --plan` prints a `documentsDigest` —
a SHA-256 over exactly the documents it is about to write, **and** every
asset requirement's `mediaId`/`contentHash` pair — and the write step
recomputes the identical digest from the plan file it loaded and refuses
unless the two match. Asset requirements are bound in deliberately: a
`media` document's own `image.asset` field is still a pending marker at
digest time, naming no bytes at all, so a digest over `documents` alone would
leave a hand-edited swap of a photograph's `sourceLocator` and `contentHash`
— pointing the same, approved `mediaId` at different, unreviewed pixels —
completely invisible to the comparison (found in Codex review round 6). A
photograph's `sourceLocator` itself is deliberately excluded — a private
filesystem path must never enter a digest an operator copies into a shell
command or a Board comment — so moving a file without changing its bytes
does not invalidate the digest, only changing what it verifies against does.
The comparison is always against the value the operator supplies on the
command line, never against the `documentsDigest` field stored inside the
plan file itself, since a hand-edited plan could update that field to match
its own tampered content just as easily as the documents it describes. The
plan's own `errors` and `blocked` arrays are bound into the digest too: the
write step separately refuses a plan whose *loaded* file still carries either,
but `convert:joomla --plan` prints this digest unconditionally, before either
is necessarily resolved, so an operator could plausibly record the digest of
a plan that still had open issues. Without `errors`/`blocked` in the digest,
quietly emptying those two arrays by hand later would leave the recorded
digest matching a plan that was never actually clean when it was reviewed
(Codex round 7, finding "Bind blocker state into the approved plan digest").

**A separate credential from the demo seeder's.** `SANITY_MIGRATION_TOKEN` is
read from the environment only — never accepted as a flag, so it never lands
in shell history or a process listing — and is distinct from
`SANITY_SEED_TOKEN`: reusing the demo fixture's own token would let this tool
and `npm run seed:sanity` share one credential and its blast radius. Mint an
Editor-role token for this run only and revoke it immediately after, the same
discipline the Production handoff section below already uses.

**Never trusts the plan file blindly.** A plan may be read long after it was
produced, against a separately-minted credential, possibly after the source
files it names have moved or changed. Before touching the filesystem or the
network, the write step re-validates the plan's own shape — every
`assetRequirements`/`categoryRequirements` entry, an exact correspondence
between those requirements and the actual pending references in the plan's
documents, and every document's `_type` **and its exact field set** against an
allow-list matching precisely what `buildImportPlan` itself emits for that
type — and re-runs every document invariant `validateMigrationDocuments`
already checks at plan-build time, rather than trusting the file's own claim
about how it was produced. The field allow-list exists because Sanity's mutate
API has no schema of its own to reject an extra field with: a corrupted or
hand-edited plan carrying one (a private `archiveLocator` slipped onto an
`article`, say) would otherwise be written into a public dataset verbatim and
become directly queryable there. The check is not only top-level: every
nested structure this tool itself ever produces — a `body` block of every
kind the converter emits (paragraph, heading, quote, list, YouTube, media,
mini-gallery, table, including a mini-gallery's own `images` array and a
table's own `rows` array), a reference object, and a localized-text entry —
is checked against the exact field set that structure's own emission code
carries, since an injected field nested two or three levels deep would
otherwise slip past a check scoped only to a document's own top level. A
reference's *position* is checked too, not only its shape: a category
placeholder must actually be a pending *category* marker (never a pending
asset marker misplaced into `canonicalCategory`), a media document's own
`image.asset` must reference *its own* mediaId specifically (never a
different photograph's placeholder), and any reference that should already
be resolved by plan-build time (a body block's media, an end-gallery
placement's `article`/`media`) is refused if it is still a pending marker of
either kind — a set-membership check alone cannot tell a reference used in
its correct position from one swapped into the wrong field. The required
fields `validateMigrationDocuments` itself does not check — an article's
`title` and `language`, a placement's `visible` — are checked for presence
and type here too, since a malformed value would otherwise reach
`createOrReplace` and only surface later as a broken page in production.

**Every photograph is re-verified immediately before it is uploaded.** The
plan's `resolved_digest` binds an approval to the photograph bytes it was
reviewed against at plan-build time (see above); that guarantee does not, by
itself, reach the write step, which can run arbitrarily later. Each
`assetRequirements` entry therefore also carries the exact content hash its
approval was bound to, and the write step re-hashes the file at that locator
immediately before generating its derivative — the same buffer feeds both the
hash check and the derivative generator, so there is no re-read window
between "verified" and "used." A mismatch refuses the whole run rather than
uploading a file that changed since approval, whatever caused the change.

**The derivative.** Resized so its longest edge never exceeds this project's
own 2048px public-delivery ceiling, `fit: "inside"` so it is never cropped,
never upscaled if already smaller. EXIF orientation is applied before
resizing so a sideways-tagged source publishes upright; EXIF/GPS metadata
does not survive into the derivative. An AVIF, JPEG, PNG, or WebP source
re-encodes to the same format at an explicit, stated quality — never Sharp's
own version-dependent default, which would otherwise be an unstated
publication policy. An animated or multi-page source (an animated GIF, a
multi-page TIFF) is **refused, not silently flattened to one frame** — this
tool publishes a single static derivative, and a universal fallback would
discard visual meaning the photographer never chose to give up. A static,
otherwise-unsupported source (a single-frame GIF/TIFF/etc.) still converts to
JPEG, with an explicit white background rather than whatever a transparent
source would otherwise composite onto by default.

**Target-dataset collision preflight.** An API write bypasses every Studio
uniqueness and route-validation rule a customer's own Studio would otherwise
enforce, so before uploading anything the write step checks, raw
perspective, whether the target dataset already has a document — under a
**different** `_id` than this plan intends — claiming a `mediaId`, an article
`(contentId, language)` pair, an article's `(language, category, slug)`
route, or an end-gallery `placementId` this plan is about to write. A hit
under this plan's own `_id` is treated as an earlier run of the same plan
(`migrated--` is a disjoint, single-writer namespace) and left to
`createOrReplace`'s ordinary idempotency; any other hit refuses the whole run
— two documents claiming one public identity is exactly the state the site's
own read adapters refuse to serve. That single-writer namespace assumption is
itself checked, not simply trusted: every planned `_id` is also queried
directly, and a hit whose `_type` or identity field does not actually match
what this plan intends refuses the run — every other check above is scoped to
one identity field (`mediaId`, `contentId`+`language`, `placementId`) and
queries by that field, so none of them would ever see a *different kind* of
document already occupying one of this plan's own deterministic ids, even
though `createOrReplace` addresses purely by `_id` and would silently destroy
it regardless (Codex round 8, finding "Reject incompatible documents
occupying planned IDs"). Re-running this command after a
migrated document has been hand-edited in Studio will overwrite that edit:
`createOrReplace` idempotency means safe to re-run, not safe from a manual
fix landing in between. The `contentId` and route checks span **both**
articles and curated galleries, and the route check also spans public child
categories — `content-placement-validation.ts`'s own `makeContentIdentityValidator`
and `findProspectiveLocalSlugCollision` establish these as one shared
namespace, so a preflight scoped to articles alone could miss a real
collision with a gallery or a category (found reviewing this tool's own
plan-review round). A category reference is also checked for the requested
article language's own published label and slug, not merely that the category
document exists — `validateProspectivePlacement`'s own rule — since a category
that exists but is not yet localized in that language is, for that language,
indistinguishable from not existing at all. That check reads the actual
label and slug *values*, not only which languages have an entry at all: a
present-but-blank label or a slug not matching `content-tree.ts`'s own
`SLUG_PATTERN` would satisfy a presence-only check and still take the whole
public tree down the moment any route reads it, well after this migration
had already written content depending on it (Codex round 8, finding
"Validate localized category values, not just language keys"). An end-gallery placement's
`placementId` is checked against a curated gallery's own `galleryPlacement`
documents too, since that identity is site-wide (ADR-0002 §1); a match there is
always foreign. A match against another `articleEndGalleryPlacement`, though,
is not automatically a collision: the schema's own validator explicitly allows
two documents to share one `placementId` when they are the same occurrence's
sibling-language versions (same article `contentId`, same `endGalleryId`, same
`media`, different `article`), which matters across the documented phased
workflow specifically — a translation pair's two languages can land in
different phases, so the earlier phase's placement is never one of *this*
plan's own document ids even though it is entirely legitimate. The preflight
dereferences the existing placement's own article to decide this, the same way
the Studio validator does.

**A published article's URL is frozen, and its category branch's local slug
namespace is checked in full, not only its direct children.**
`article-validation.ts`'s own `changesPublishedUrlFields` freezes an
article's `language`, `slug`, and canonical category once published — an API
write bypasses that Studio guard entirely, so the preflight fetches every
planned article's currently-published state by its own `_id` and refuses the
run if rerunning this plan would change any of the three, since that would
silently retire the existing URL with no redirect (Codex round 7, finding
"Preserve published routes when rerunning an article"). Separately, migrating
content into a category can make a previously dormant branch public for the
first time — and, once public, that branch's whole ancestry can collide with
a sibling category or existing content anywhere along it, not only among the
direct children of the category this plan targets, which an earlier version
of this check covered (Codex round 7, finding "Check collisions for newly
public category ancestors"). Both checks reuse
`content-placement-validation.ts`'s own pure functions — restated in
`write-joomla-content.mts` rather than imported, since that file's own
`./validation` import has no file extension, which Sanity Studio's bundler
resolves but plain Node's ESM loader does not (`node
scripts/write-joomla-content.mts` crashed with `ERR_MODULE_NOT_FOUND` on a
real subprocess run even though `tsc` and Vitest's own resolver both
tolerated it — the same class of "passes under a transpiler, fails for real"
trap `docs/sanity-seeding.md`'s own history already has one instance of, from
AB#116's parameter-property crash). Restating means the exact algorithm the
Studio publish guard runs, not an approximation of it, so a future change to
either copy needs to update both.

**The write-scoped credential refuses a `NEXT_PUBLIC_` mirror, and a
reference object is checked for `_type`, not only a well-formed `_ref`.**
Before reading `SANITY_MIGRATION_TOKEN`, the write step first checks for
`NEXT_PUBLIC_SANITY_MIGRATION_TOKEN` and refuses to run if it is set,
matching the same pattern this project's security-review skill and
`src/lib/sanity-config.ts`'s own read-token parsing already establish
elsewhere: a `NEXT_PUBLIC_`-prefixed variable is compiled into the browser
bundle by Next.js, so a write-scoped credential must never answer to that
name even as an accidental leftover copy (Codex round 9, finding "Reject a
public copy of the migration token"). Separately, `checkReferenceShape` — the
contract check every `canonicalCategory`, `secondaryCategories`, `gallery`,
`article`, `endGallery`, and `media` reference in a planned document passes
through — used to accept any object carrying a syntactically valid `_ref`
string, regardless of its `_type`. A reference missing `_type` entirely, or
carrying the wrong one, would have passed this check and then dereferenced as
`null` at read time in production, since Sanity does not validate a
reference's declared type against the document it points to. The check now
also requires `_type === "reference"` before accepting the object (Codex
round 9, finding "Require actual Sanity reference objects").

**Media fields an editor owns are merged, not overwritten, across phases.** A
photograph reused across phased writes gets a separate plan each time, and
that plan's own `media` document only ever carries the fields this tool
itself authors — `mediaId`, `mediaType`, `alt` (only the language(s) *this*
phase's accepted articles contributed), `publiclyRenderable`, and `image` — it
cannot see a `caption`, `credit`, `capturedAt`, or `enquiryEligible` an editor
added by hand, or an earlier phase's other-language `alt` entries. Before
uploading anything, the write step fetches each planned media document's
currently-published fields and merges them: `alt` is merged by language (a
language this phase does not itself contribute is carried over unchanged, and
a language both sides already provide but genuinely *disagree* on refuses the
whole run rather than silently picking a side — the same posture every other
conflict class in this tool already takes); `caption`/`credit`/`capturedAt`/
`enquiryEligible`/`archiveLocator` are fields this tool has no opinion on at
all, so an existing value is always carried over unchanged rather than
deleted; and `publiclyRenderable` follows a "false wins" rule — an editor who
has already turned this off to keep a published photograph out of every
public page stays hidden regardless of this plan's own unconditional `true`,
since only an editor should reverse that choice. Conflicts are reported
privately in `media-field-conflicts.json`.

**Write ordering.** Sanity's mutate API requires a strong reference's target
to already exist in an *earlier* transaction — the same constraint the demo
seeder's own write above is ordered around. The write step therefore batches
every `media` document first, to completion, before batching everything else
(articles, end-gallery placements) — never the plan's own raw document
order, which interleaves an article with its media references and would
break the moment a real migration's document count crosses one mutation
batch.

**Every private report is mode-0600 in a mode-0700 directory**, matching the
conversion step's own convention exactly: `plan-validation-errors.json`,
`asset-verification-failures.json`, `unresolved-categories.json`,
`target-collisions.json`, `media-field-conflicts.json`, and `upload-failures.json`
each carry whatever private detail (a source locator, a content hash, a route,
a document id) explains the failure; the console prints only counts. Assets
already uploaded in a run that later fails are **not** rolled back — Sanity has no
delete-on-failure transaction for this — the same accepted posture the demo
seeder's own upload step already has; `createOrReplace`'s idempotency makes a
full re-run safe regardless.

**Post-write verification.** Ends with a chunked, byte-budgeted readback
query confirming every written document's `_id` round-trips, printed as
PASS/FAIL — the same "representative queries pass" pattern the demo seeder's
own live verification already establishes, scaled to a migration's real
document count rather than one dataset's fixed 474.

After the Production write, run `npm run audit:sanity` and
`npm run verify:sanity-adapters` against that dataset, including a real
multi-page gallery witness. Compare every published document and asset with
the approved manifest, inspect drafts/releases and public derivative metadata,
then revoke the temporary Editor credential. Record the outcome, runtime read
access, retry and rollback steps, owner/operator, and evidence for AB#117 on
AB#137. This section prepares the operation; it does not claim that AB#137's
live acceptance criteria have been met.

## Production handoff

AB#84 exists to prove this workflow against a real, customer-owned dataset
before the later Production launch seed runs it for real. This section is
that handoff: the exact command, inputs, verification, rollback, and owner
actions the launch story needs, distilled from a real write-enabled run this
story performed against the customer-owned Preview project and dataset.
Seeding the reference *Production* dataset itself stays out of scope here —
it is that later story's own work, not this one's.

**The command below writes demo fixtures.** Use it in Production only if the
owner explicitly approves those exact fixtures as launch content. For a
migration of real content, follow the approval and audit boundary above and
use a separate implementation built for the approved manifest.

### Command

The same script, pointed at the Production project and dataset instead of
Preview:

```bash
export SANITY_SEED_TOKEN=...   # fresh, Production-scoped, Editor role — see
                                # "The write token" above; never reuse a
                                # token minted for a different dataset
npm run seed:sanity -- \
  --project <production-project-id> \
  --dataset <production-dataset> \
  --api-version <the Production deployment's own SANITY_API_VERSION> \
  --yes
```

### Inputs the operator supplies

| Input | Source | Notes |
| --- | --- | --- |
| `--project` | the Production deployment's `SANITY_PROJECT_ID` | never written into this repository — see `docs/sanity-setup.md`'s *Ownership* section |
| `--dataset` | the Production deployment's `SANITY_DATASET` | not `preview` |
| `--api-version` | the Production deployment's own `SANITY_API_VERSION` | keep the write on the same dated version the reading deployment is pinned to |
| `SANITY_SEED_TOKEN` | minted fresh, Editor role, in the owner's own Sanity project settings | never the deployment's `SANITY_READ_TOKEN`; never committed, logged, or placed in a CI variable group — see *The write token* above |

### Verification the run must reproduce

Three independent layers, matching *What each verification layer actually
proves* above — all three already pass today and must keep passing before a
Production run is trusted. The first two prove the write; only the third
proves the repository's own read adapters:

1. `npm test` (or, scoped: `npx vitest run scripts/sanity-seed-fixtures.test.mts
   scripts/sanity-seed-http.test.mts scripts/sanity-seed-content-verification.test.mts`)
   — the offline fixture/HTTP/adapter-shape suite, which needs no live
   project.
2. The script's own built-in `--yes` live-verification step: 8 checks in
   `buildVerificationChecks` (`scripts/seed-sanity-content.mts`) — both
   singletons readable, the category/service/article counts, the archive
   gallery's full 400-row placement window, the featured gallery's two named
   sections, and the shared-media cross-gallery placement. Every check must
   report `PASS`; the script already exits non-zero on a `FAIL`, but the
   write has already happened by that point (see *What happens on `--yes`,
   in order* above) — a failure here means investigating the live dataset
   before anything reads from it, not re-running blindly. This step's checks
   are hand-written GROQ, not the repository's own read adapters — it proves
   the data, not the code that will eventually read it.
3. `npm run verify:sanity-live` (`src/lib/sanity-live-verification.test.ts`):
   the real `src/lib/sanity-*.ts` adapters — not hand-written GROQ, and not
   an offline fake store — reading settings, home content, services,
   categories and the content tree, articles in every language they were
   actually published, gallery sections and media projection, sibling and
   placement ordering, and the full curated gallery's cursor chain, page by
   page, including the page-size boundary. This is what actually satisfies
   "representative repository adapter queries... against Content Lake". It
   needs only read access — every dataset this project uses is public, so
   no token at all. As of AB#138, its target env file is configurable rather
   than hardcoded: it defaults to `.vercel/.env.preview.local`, unchanged
   from before, but setting `SANITY_LIVE_VERIFICATION_ENV_FILE` (absolute,
   or relative to the repository root) points it at any other env file — for
   example, a `.env` naming a Production project and dataset once one has
   been seeded with this exact fixture set. It remains a **fixture
   verification suite, not a generic Sanity health check**: its assertions
   are the exact values `scripts/sanity-seed-fixtures.mts` writes, so it
   will correctly fail against a dataset that has not been seeded with that
   fixture, Production included. The selected file must define
   its own `SANITY_PROJECT_ID`/`SANITY_DATASET`/`SANITY_DATASET_VISIBILITY`/
   `SANITY_API_VERSION` rather than leaving any of them to the ambient shell
   environment (`src/lib/sanity-live-verification-config.ts` enforces this
   and the suite prints its resolved target before issuing any query, so an
   operator can confirm it). It is deliberately separate from `npm test` (it
   reaches a real network) and from route wiring (nothing under `src/app` or
   `src/components` imports it): it exists to prove the adapters work, not
   to switch the deployment over to them.
4. `npm run verify:sanity-adapters` (`src/lib/sanity-adapter-smoke-verification.test.ts`,
   AB#137): the same real `src/lib/sanity-*.ts` adapters as layer 3, but
   content-agnostic — it makes no assumption about which specific content
   exists, so it is what actually satisfies "representative repository
   adapter queries... against Content Lake" once Production holds real,
   owner-approved launch content that differs from the AB#84 fixture (where
   layer 3 will, correctly, fail). See *Adapter smoke verification (AB#137)*
   below.

Additionally, confirm the dataset holds *exactly* the intended manifest —
neither a foreign document nor a stale leftover from an older fixture
revision — the same way this story's own Preview run did:

```groq
{
  "total": count(*[]),
  "seedTotal": count(*[_id match "seed--*"]),
  "assetTotal": count(*[_type == "sanity.imageAsset"]),
  "nonSeedNonAsset": count(*[
    !(_id match "seed--*") &&
    _type != "sanity.imageAsset" &&
    !(_type match "system.*")
  ])
}
```

Three separate checks against this one result, for three separate failure
shapes:

- **`nonSeedNonAsset` must be `0`.** A non-zero count means either real
  content already existed before this run, or an unrelated document type
  was left by something else — stop and investigate rather than proceeding.
- **`seedTotal` must equal the fixture's own reported document count**
  (the number the dry run prints as `Fixture set: N documents`, 474 as of
  this fixture revision). This query's `!(_id match "seed--*")` predicate
  cannot see a *stale* `seed--` document — one an earlier fixture revision
  wrote that the current manifest no longer includes — because it is still
  legitimately `seed--`-prefixed. `seedTotal` reading higher than the
  fixture's own count is exactly that case: rely on the run's own stale-
  document report (*Stale documents across a fixture revision* above,
  which every `--yes` invocation prints unconditionally) to name the
  specific leftover ids, and re-run with `--prune-stale` before trusting the
  seed as clean. `seedTotal` reading lower means the write did not
  complete — investigate before re-running.
- **`assetTotal` must equal the number of demo photograph files the dry run
  resolves** (`Resolved N demo photograph file(s) in public/gallery/`, 6 as
  of this fixture revision). `nonSeedNonAsset` deliberately excludes every
  `sanity.imageAsset` document rather than counting it — an asset's id is
  minted by Sanity on upload, never `seed--`-prefixed, so this fixture's own
  six assets would otherwise always read as "unrelated" — but that means it
  cannot by itself catch an *extra* asset: an orphaned upload from an
  earlier, incomplete run, or an unrelated file uploaded through Studio,
  both silently pass `nonSeedNonAsset == 0`. `assetTotal` reading higher
  than expected is exactly that case — investigate and remove the extra
  asset (see *Going live* above for how to find and delete one by id) before
  trusting the seed as clean; reading lower means an upload did not
  complete.

### Rollback evidence

- **Before writing**, take a full export:
  ```bash
  SANITY_AUTH_TOKEN=$SANITY_SEED_TOKEN npx sanity datasets export <dataset> <local-path> --project-id <project-id>
  ```
  (`SANITY_AUTH_TOKEN` is the Sanity CLI's own non-interactive auth
  variable — a separate name from this script's `SANITY_SEED_TOKEN`, even
  though the same Editor-role token value satisfies both.) This story's own
  Preview run found the target dataset already empty of content — zero
  published documents, zero drafts — so no export was needed; a Production
  dataset seeded after real content already exists always needs one first.
- **After writing**, `--delete-all` (see *Going live* above) is the tested
  rollback: it removes every `seed--`-owned document in reference-safe
  deletion order, repeats its own raw-perspective lookup until none remain,
  and names the six uploaded asset ids so they can be deleted separately —
  the one part `--delete-all` cannot reach itself, since Sanity mints their
  ids on upload.
- Both the write and the built-in verification were exercised for real
  against Preview during this story, not only read from documentation, with
  the non-secret target identity and results recorded on AB#84.

### Owner actions this handoff assumes

1. Mint a fresh, Production-scoped, Editor-role `SANITY_SEED_TOKEN` — never
   the token used for this story's Preview run, and never the deployment's
   own `SANITY_READ_TOKEN`.
2. Run the command above from the owner's own machine (or a one-off CI job),
   never as part of the deployment pipeline — this script is never wired
   into `azure-pipelines.yml` or the application build, by design (see *What
   the script is, and is not*).
3. Run both `npm test`-covered layers above (1–2) and confirm every check
   passes before treating the seed as complete. `npm run verify:sanity-live`
   (layer 3 above) can now be pointed at a Production env file via
   `SANITY_LIVE_VERIFICATION_ENV_FILE` (AB#138) — but only run it against
   Production if this run actually wrote the exact AB#84 fixture set there;
   its assertions are fixture-specific, so it will (correctly) fail against
   real, owner-approved launch content that differs from the fixture. For
   real, owner-approved launch content, run `npm run verify:sanity-adapters`
   (layer 4 above, AB#137) instead — it exercises the same real adapters
   without assuming which specific content was written. The read-only
   content audit tool below answers a different question ("what is actually
   in this dataset") and does not exercise adapter queries or gallery
   pagination at all — it does not substitute for either live-adapter layer.
4. Revoke the token immediately after, in Sanity's project API settings —
   not by letting it expire — the same step this story's own Preview run
   requires.
5. Record the non-secret target identity — project id, dataset name,
   visibility (public/private), region, ownership (the account and, if
   different, the operator who ran this handoff), run date, and the
   verification outcome — durably outside this repository — an
   Azure Boards comment on the launch story, matching how this story
   recorded its own Preview run (see `docs/sanity-setup.md`'s *Ownership*
   section on why the project id itself never enters this repository).
6. Treat *Going live: removing the sample content* above as mandatory before
   real customer content is authored against the same dataset, exactly as it
   already is for Preview.

## Planning a rally folder import (AB#167)

A capture-sequence gallery ([ADR-0022](adr/0022-capture-sequence-rally-galleries.md))
is imported from one folder of exported web photographs. This first step is **offline**:
it reads the folder, checks every file, and writes a reviewable plan. It sends nothing
anywhere, reads no credential, and changes no dataset. Writing the plan to Sanity is a
separate, later step.

### The folder

```
Rally_Finland_2024/
  rally.json
  Rally_Finland_2024_0001_SS1_Harju_1.jpg
  Rally_Finland_2024_0002_SS1_Harju_1.jpg
  SS4/Rally_Finland_2024_0147_SS4_Lankamaa_1.jpg     ← subfolders are fine
  Rally_Finland_2024_0301_Huoltoparkki.jpg
```

- **File names:** `<filePrefix>_<NNNN>_<sectionKey>.jpg|.jpeg|.webp`, ASCII letters,
  digits, `_`, and `-` only.
  - `NNNN` is four digits, runs across the whole rally, and is unique. It is the order
    the gallery shows. EXIF capture time is not read.
  - `sectionKey` is everything after the number and must be declared in `rally.json`.
- **Subfolders:** allowed, and ignored for ordering, because the section comes from the
  file name.
- **Skipped:** dot-files such as `.DS_Store`.
- **Refused:** everything else that does not match, including camera masters (`.dng` and
  similar) and sidecars (`.xmp`).
- **Size and format:** only exported JPG or WebP, with the longest edge at most 2048 px
  after EXIF orientation. A larger file is refused rather than resized; export a web
  derivative instead.

`rally.json`:

```json
{
  "version": 1,
  "contentId": "rally-finland-2024",
  "filePrefix": "Rally_Finland_2024",
  "canonicalCategory": "rally",
  "eventDate": "2024-08-01",
  "title": { "fi": "Rally Finland 2024", "en": "Rally Finland 2024" },
  "slug": { "fi": "rally-finland-2024", "en": "rally-finland-2024" },
  "summary": { "fi": "…", "en": "…" },
  "cover": 147,
  "sections": [
    { "key": "SS1_Harju_1", "label": { "fi": "EK 1 Harju 1", "en": "SS 1 Harju 1" } },
    { "key": "Huoltoparkki", "label": { "fi": "Huoltoparkki", "en": "Service park" } }
  ]
}
```

- **Optional fields:** `summary`, `cover` (a running number), `publishedAt` (a UTC
  timestamp; it defaults to the time the plan is made), `photoWord` (the noun used in alt
  text for a language other than `fi`/`en`), and a section's `slug`.
- **Section id:** derived from the key, so `SS1_Harju_1` becomes `ss1-harju-1`, which is
  also the default slug.
- **Languages:** the languages are those of `title`, and every localized field must have
  exactly those. Unknown fields are refused.

### Command

```bash
npm run plan:rally -- --folder <rally folder> --out <report folder> [--accept-interleaved-sections]
```

`--out` must be outside the rally folder. The command writes three private files there,
each mode `0600` in a mode `0700` directory:

- **`rally-import-report.json`:** counts, and every refused file with its reason.
- **`rally-import-plan.json`,** written only when nothing was refused:
  - a media document per photograph, with FI/EN alt text in the approved pattern
    "`<title>: <section label>, kuva <N>`";
  - the two capture-sequence gallery documents;
  - the asset list with each file's SHA-256;
  - the `documentsDigest`.
- **`rally-identities.json`:** the content-hash map that keeps each photograph's
  `mediaId` stable. A rerun with the same `--out`, or a renamed file, reuses the identity;
  a re-export from Lightroom changes the bytes and gets a new one. Keep this file; do not
  delete it between runs.

The console prints counts and the digest only. Sections whose running-number ranges
overlap block the plan. That is usually a photograph in the wrong stage. When it is
intended, for example a service-park photograph between two stages, rerun with
`--accept-interleaved-sections`.

## Writing an approved rally plan (AB#168)

The second step takes the plan `plan:rally` wrote and puts it into a Sanity dataset.

```bash
npm run write:rally -- --plan <out>/rally-import-plan.json --folder <rally folder> \
  --out <report folder> --approved-digest <documentsDigest> [--yes]
```

**Without `--yes` it is a dry run.** It validates the plan, recomputes its digest from
the content and compares it with `--approved-digest`, then re-reads every photograph:

- the SHA-256 must still match;
- the public copy is generated, with EXIF and GPS stripped, never cropped or upscaled;
- the public copy's dimensions must equal the planned ones.

It reads no credential and makes no network request. A plan that was edited by hand, or
a file that changed after planning, stops it here.

**With `--yes`,** the write needs `SANITY_PROJECT_ID`, `SANITY_DATASET`, and
`SANITY_API_VERSION` (or the matching flags) and `SANITY_MIGRATION_TOKEN`, a write-scoped
token read from the environment only. A `NEXT_PUBLIC_` copy of the token is refused.
Before anything is uploaded, a preflight under the raw perspective (so drafts and
releases count) refuses the whole write if:

- the category is missing, or has no published label and slug in a plan language;
- a planned document id holds another document type, or has an unpublished draft or
  release in Studio;
- the gallery `contentId` or a `mediaId` is already used by another document;
- the gallery's address in a language is already used in that category by a gallery,
  an article, or a subcategory;
- `galleryPlacement` documents reference the gallery (ADR-0022 §1);
- media in the dataset name this gallery but are not in the plan. The import never
  deletes, so remove them in Studio or put the files back;
- an existing gallery document's `contentId`, language, slug, category, or ordering rule
  differs from the plan. A published address is not changed by an import.

It then uploads each public copy, writes the media, writes the two galleries, and reads
back the galleries and the gallery's photograph count to compare with the plan.

**Reruns are safe and conservative:**

- New documents are created with `createIfNotExists`.
- An existing photograph gets only its `captureSequence` and `image` updated.
- An existing gallery gets only sections it does not have yet, and a cover if it has
  none.
- Alt text, captions, credits, flags, titles, summaries, and section intros edited in
  Studio are never overwritten.
- Nothing is deleted.
- An identical file uploads to the same Sanity asset, so rerunning after a failed upload
  creates no duplicates.

Documents are written as published, so the gallery is live as soon as the write finishes.

## Planning an existing rally gallery's conversion (AB#169)

A placement-based rally gallery already in Production is converted to capture sequence one
gallery at a time ([ADR-0022](adr/0022-capture-sequence-rally-galleries.md) §7). This
first step plans the conversion. It writes nothing to Sanity. Deleting the placements
and switching the rule is a separate, later step.

1. **Copy the gallery's source files into a new folder** and rename them to the
   `<filePrefix>_<NNNN>_<sectionKey>.jpg` convention. Rename only: a re-export from
   Lightroom changes the bytes, and the file can then no longer be recognized as the
   published photograph.
2. **Write `rally.json`** with each section's existing `sectionId` and `slug`, so every
   published `?section=` address keeps working:

   ```json
   { "key": "SS15_Harju_2", "sectionId": "category-3", "slug": "ss-15-harju-2",
     "label": { "fi": "SS 15 - Harju 2", "en": "SS 15 - Harju 2" } }
   ```

3. **Run:**

   ```bash
   SANITY_PROJECT_ID=… SANITY_DATASET=production SANITY_API_VERSION=v2025-02-19 \
   npm run plan:rally-conversion -- --gallery <contentId> --folder <renamed copy> \
     --artifacts <folder of import plans> --out <report folder>
   ```

The published gallery is read **without a token**, under the published perspective only.
Every file is recognized by content hash through the import artifacts'
`assetRequirements`, because Sanity stores no file names. The result:

- **The photographs keep their existing documents and `mediaId`s.**
- **Refused:** a published photograph with no file in the folder, a hidden or pinned
  placement, or a photograph already in another capture-sequence gallery.
- **Refused unless you pass `--allow-new-photographs`:** a file that matches no published
  photograph.
- **Refused unless you pass `--accept-removed-duplicates`:** a photograph placed twice.
- **Placement alt text:** an override equal to the photograph's own alt text in that
  language is redundant and is simply dropped. One that differs refuses the conversion.
- **Placement captions:** moved onto the photograph when the photograph has no caption
  in that language, or the same one. A conflicting caption refuses the conversion.
- **Use in another gallery,** such as the best-of, is reported, not refused.

`rally-conversion-report.json` lists every photograph whose position changes (`moved`),
every duplicate placement that disappears (`duplicate-removed`), every section change,
and every added photograph. Review it before approving the `conversionDigest`. The plan,
`rally-conversion-plan.json`, holds the media patches (`captureSequence`, plus a caption
where one moves), any new photographs, and the placements the write step will delete.

**Known per-gallery facts (2026-09-23):**

- **Secto Rally Finland 2021:** 14 files in the SS15 folder have no stage in their names.
  After renaming, it was planned with no deviations (107 photographs, 214 placements) and
  **converted in Production on 2026-09-24**, the first real run of `write:rally-conversion`.
  The read-back matched the plan, and an independent tokenless read confirmed both
  galleries are `capture-sequence`, no placement references them, all 107 photographs are
  in ascending sequence, and the section counts are 32/11/14/16/34. Production went from
  6,820 to 6,606 documents. A rehearsal of the write's fresh snapshot against the real
  dataset before the run found that its id lists overflowed the GET URL cap at 107
  photographs; the queries are now chunked, with a regression test.
- **Neste Rally Finland 2016:** needed no renaming (all 126 files already follow
  `NRF_2016_NNNN_<stage>.jpg`; an earlier "one unnumbered file" was a number that looked
  like a year). **Converted in Production on 2026-09-24:** 126 photographs, 252
  placements deleted, and one placement caption ("Ferrari / Näytösajo Harjulla", photograph
  19) moved onto the photograph. The independent read-back matched: 0 placements left,
  126 members in ascending sequence, sections 35/18/17/27/17/12, and the other eight rally
  galleries untouched.
- **Neste Rally Finland 2018:** converted in Production on 2026-09-24 (verified: 0
  placements left, both galleries `capture-sequence`, sequences ascending and unique).
- **Secto Rally Finland 2023** (120 photographs, two captions moved) and **TET Rally
  Latvia 2024** (226 photographs): no renaming beyond the convention and no deviations.
  Converted on 2026-09-24 and verified the same way.
- **Neste Rally Finland 2017:** a folder name with a space ("Podium WRC") is not a valid
  stage key, so the copy's keys are the source folder names with anything outside
  `A–Z a–z 0–9 _ -` replaced by `_`. Two "SS 21 Päijälä 2" photographs (numbers 4913 and
  4922) sit before the end of the "SS 18 Saalahti 2" range, so the two sections
  interleave; the owner approved that (`--accept-interleaved-sections`), and the two
  photographs move. 291 photographs, converted on 2026-09-24.
- **Neste Rally Finland 2019:** two sections ("SS 13 Päijälä 1" and its Vetomiehet
  section) share one stage id in their file names; the copy separates them by source
  folder name. One SS3-named file sits in the SS9 section and stays there (the owner
  had moved it to the right folder without renaming). Three service-park photographs
  (numbers 673, 695, 731) now come before the SS9 photographs by running number, so they
  move from positions 40–42 to 14–16; the owner approved the change. 172 photographs,
  converted on 2026-09-24.
- **Rally Estonia 2023:** the owner decided that the 31 photographs also placed in SS19
  are SS14 photographs, and that SS19 receives its own 37 unpublished photographs
  (`SS19_Toyota_Kambja_1`). Planned with `--accept-removed-duplicates
  --allow-new-photographs`: 31 duplicates removed, 37 added, 203 existing photographs
  patched, 240 in total. Converted on 2026-09-24; the 37 new photographs are renderable
  with their image assets. (The read-only reconcile rehearsal does not upload, so it
  cannot build the write waves for a plan with new photographs and stops there; the
  write itself is unaffected.)
- **Secto Rally Finland 2022:** the file names carried per-stage numbers, so running
  numbers were not unique across the gallery. The copy is numbered `0001…0213` in the
  gallery's existing order, which keeps every photograph where it is (no deviations);
  the photographer's original numbers are not retained. 213 photographs, 170 captions
  moved onto photographs. Converted on 2026-09-24.

After these conversions Production held 3,581 documents (from 6,820) and 38
`galleryPlacement` documents, all belonging to the placement-based "Rally Finland
2001–2019" best-of collection, which stays curated.

A placement of a photograph that the folder puts in a different section is a removed
duplicate, and its own alt text or caption override goes with it; the planner no longer
blocks on those, only on overrides of the placement that survives.

## Writing an approved rally gallery conversion (AB#170)

The second step of converting an existing rally gallery takes the plan
`plan:rally-conversion` wrote and puts it into Sanity: existing photographs gain their
`captureSequence`, any owner-approved new photographs are created, the old
`galleryPlacement` documents are deleted, and both language galleries switch to
`orderingRule: capture-sequence`.

**Before running this with `--yes`, take a fresh export:**

```bash
sanity datasets export production ./backups/production-$(date +%Y%m%d-%H%M).tar.gz
```

`backups/` is gitignored on purpose: an export is a full copy of the dataset, hundreds of
megabytes with every image, and this repository is public. Keep it that way, and keep the
archive itself until the converted gallery has been checked on the live site.

```bash
npm run write:rally-conversion -- --plan <out>/rally-conversion-plan.json \
  --folder <renamed copy> --out <report folder> --approved-digest <conversionDigest> \
  --backup-archive ./backups/production-<timestamp>.tar.gz [--yes]
```

**Without `--yes` it is a dry run**, and makes no network request at all: it validates
the plan, recomputes its digest and compares it with `--approved-digest`, checks
`--backup-archive` exists, is not a trivially small or placeholder file, and was
modified within `--backup-max-age-hours` (24 by default — export again if it is
older), and re-verifies every new photograph locally.

This tool cannot run `sanity datasets export` itself and cannot confirm the archive is
actually of this dataset — only that a real, recent file exists at the path given. That
is the one check it can make; the export itself, and confirming it restores, stay the
owner's own step (see "Export and recovery" above).

**With `--yes`,** a fresh, raw-perspective read of the gallery, its placements, and the
media the plan touches decides what is actually left to do — never the plan's own
snapshot, which can be stale. This is what makes the command **safe to interrupt and
rerun**: an already-applied photograph patch or an already-deleted placement is skipped,
not redone. The run refuses before any write if:

- a placement now references the gallery that the plan does not know about (content was
  added after planning);
- a photograph's `captureSequence` now disagrees with the plan;
- a document the plan touches has an unpublished draft in Studio;
- a gallery is now ordered by neither `manual` nor `capture-sequence`.

The write order matters and is fixed: photographs (new, then patched) go first, since
setting `captureSequence` has no effect while a gallery is still `manual`. Only then does
each language's remaining placement deletions run, batched, with the `orderingRule`
switch to `capture-sequence` folded into the **same mutation call** as that language's
last deletion batch. Sanity executes every mutation in one call as a single transaction,
so this is what stops a request boundary from ever leaving a gallery in the one state the
public read refuses outright — `capture-sequence` while a `galleryPlacement` still
references it (`src/lib/sanity-gallery.ts`'s own guard, ADR-0022 §1) — and bounds how long
a gallery can look emptier than it is to at most one deletion batch.

After the write, a read-back confirms both galleries are `capture-sequence` with zero
remaining placements and a photograph count matching the plan. `rally-conversion-write-
report.json` under `--out` records what this run actually did.

## Moving imported Joomla intros into listing-only leads (AB#172)

The legacy importer placed each Joomla article's intro text as the first body paragraph.
Joomla showed that intro only in listings, and the full text usually repeats it. As a
result a migrated story opened with the same paragraph twice, and its listing card had no
excerpt. This one-off correction moves the paragraph into `summary` and sets
`summaryListingOnly: true` (ADR-0003's 2026-09-26 amendment), so the intro becomes the
listing excerpt and search-engine description and leaves the page.

```bash
npm run fix:joomla-intro -- --out <report folder>                                   # plan (read-only)
npm run fix:joomla-intro -- --out <report folder> --approved-digest <digest> --yes  # write
```

`SANITY_PROJECT_ID`, `SANITY_DATASET` and `SANITY_API_VERSION` come from the environment or
`--project`/`--dataset`/`--api-version`.

**Planning** reads the published articles and galleries without a token and writes
`intro-summary-plan.json`. It changes a page only when all of these hold:

- the page is a published article or gallery;
- it has no summary and no flag;
- its body is a plain paragraph (`_key`, `_type`, `text` only) followed by at least one
  more block.

Every other page is listed under `excluded` with its reason and left alone. That includes
a page whose single paragraph is the whole text, a page that starts with a heading, and a
malformed summary or flag value. Review the planned summaries, then approve the printed
digest. The digest binds the target project and dataset, each page's published revision,
its complete original body, and the exact patches.

**Writing** needs a temporary write-scoped `SANITY_MIGRATION_TOKEN` in the environment,
never as a flag, and a short editing freeze in Studio while it runs. It:

- rereads the raw dataset and recomputes the plan. Any edit since the review changes the
  digest and refuses the run.
- refuses if any planned page has a draft or release version, because publishing one
  later would restore the old body. It checks again immediately before the write.
- saves the approved plan as `intro-summary-approved-<digest>.json` before sending
  anything. The record is never overwritten, and it holds every page's original body for
  rollback.
- sends every patch in **one** transaction. Each patch is guarded by the approved
  revision (`ifRevisionID`), so a page edited in the meantime rejects the whole
  transaction.
- reads every page back after the write, whatever its outcome, and classifies each as
  applied, pending, or unexpected in `intro-summary-reconciliation.json`. It also reports
  any draft that appeared during the run.

If the write's outcome is uncertain, for example after a timeout, rerun the same command.
It reconciles against the saved record first. If everything was applied it stops. If
nothing was, it writes again under the same checks.

**Rollback** is manual, one page at a time, from the recovery record. First check the page
still has the planned result: the planned `summary`, the flag `true`, and body equal to
`originalBody` minus its first block. Then patch it with `ifRevisionID` set to its
*current* revision:

- set `body` to `originalBody`;
- unset `summary` and `summaryListingOnly`.

A page edited since the correction needs a human decision rather than a rollback.

**After the write**, check the live site once the published-content cache has been
invalidated (`docs/cache-revalidation.md`): listing cards show the excerpts, story pages no
longer open with the intro, and each page's meta description is its intro. The
application must already be deployed with AB#172, or a gallery hero would briefly show the
intro above the full text.

## Rotating a seeded-random gallery's order (AB#129)

A gallery whose `orderingRule` is `seeded-random` (ADR-0009) has a per-placement
`shuffledOrder` key that is **materialized**, not computed on the read path.
Changing the gallery's `orderingSeed` in Studio does not, on its own, re-shuffle
anything — it only marks every existing key stale. Rotation is two steps:

```bash
# 1. In Studio: edit `orderingSeed` on the gallery document and Publish.

# 2. Materialize the new keys (owner-run, same credential story as seeding):
export SANITY_SEED_TOKEN=...   # Editor-role, write-scoped — never SANITY_READ_TOKEN
npm run recompute:shuffled-order -- \
  --project <id> --dataset <name> --api-version v2026-06-24 \
  --gallery <contentId> --language <lang> --yes
```

- `--gallery` and `--language` are **both required**. One `contentId` can have a
  document per language (ADR-0008); an ambiguous or absent match aborts rather
  than guessing.
- Without `--yes` it is a **dry run**: it reads, prints how many placements would
  change, and writes nothing.
- **Resolve outstanding drafts first.** The command patches only *published*
  documents, so if the gallery (`drafts.<id>`) or any of its placements has an
  unpublished Studio draft, the command refuses to run — publishing that draft
  afterwards would overwrite the corrected document. It re-checks for drafts as
  part of the final gate too, so a draft created *during* the run also fails the
  command. Publish or discard the drafts, then re-run.
- With `--yes` it patches each stale placement under `ifRevisionID` (an editor
  touching a placement mid-run causes a bounded retry, or an abort if the
  placement's id or pinned flag changed), re-checks the gallery's revision, rule,
  and seed **before the first and after the last** patch, and ends with an
  authoritative "every placement is consistent" query — which runs even when the
  initial plan had zero patches. Any of those checks failing exits non-zero; re-run.
- **Between step 1 and a successful step 2, the public site serves that gallery
  as an accessible "this gallery is being reordered" state** (`SanityGalleryError
  "ordering-stale"`), not a mis-paginated one — an HTTP 200 page on the detail
  route, an HTTP 503 + `Retry-After` from the `/api/gallery` continuation
  endpoint. It recovers on its own — no further action — once step 2's placement
  writes invalidate the `sanity:galleries` cache tag (the same webhook path AB#83
  already wires). The command's final check is the operator's "done" signal; it
  does not gate that recovery.

Known limitation: on the *detail route* that state is HTTP 200 with `noindex`,
not `503` — an App Router page render cannot set an arbitrary status (the
continuation endpoint, a Route Handler, does return a real 503). See ADR-0009's
2026-08-28 amendment.

The seed fixture's own `shuffled` gallery (above) is written already consistent,
so a fresh `npm run seed:sanity` never needs a recompute pass.

## Content audit (AB#138)

A separate, read-only tool — `npm run audit:sanity` (`scripts/audit-sanity-content.mts`,
logic in `scripts/sanity-audit.mts`) — for exactly the launch-readiness
question AB#137's own acceptance criteria ask, and that neither the seed
script's own `--yes` verification nor `verify:sanity-live` answers: *what is
actually in this dataset*, independent of which specific content was
authored. Unlike `verify:sanity-live`, it makes no assumption that
`scripts/sanity-seed-fixtures.mts`'s fixture — or any particular content —
was ever written there; it simply reports what it finds.

### What it reports

One bounded, keyset-paginated scan (`_id > $after`, `order(_id)`, never an
offset slice — Sanity's own documentation warns offset slicing is
inefficient at scale) over every document in the dataset, at every
perspective — published, drafts, and documents copied into a content
release. Every document and every image/file asset the scan sees is listed
individually in the printed report, by id — not just counted or sampled:
"is any of this actually approved launch content?" is a question only a
list of identifiers can answer, a count cannot. The report is:

- every document's id, `_type`, and identity (published / draft / which
  release a version belongs to), plus the same broken down as totals and by
  `_type`;
- `system.release` records (content releases themselves) and how many
  document versions exist inside any release;
- every image and file asset's id and dimensions, and which image assets
  are missing their public derivative dimensions (a file asset having none
  is expected and never flagged);
- which assets have a stored original filename — `sanity/schemas/media.ts`
  sets `storeOriginalFilename: false` specifically so this list should be
  empty; a nonzero one is worth investigating before launch;
- which `media` documents carry `archiveLocator` or `capturedAt` — the two
  fields `SENSITIVE_MEDIA_METADATA_FIELDS` in `sanity-audit.mts` names as
  private/internal.

The asset-filename and media-private-field checks are scoped to their real
types (`sanity.imageAsset`/`sanity.fileAsset`, and `media`, respectively): an
unrelated document type that happens to declare a same-named field is never
misreported as one of these, though it is never hidden either — every
`_type` the scan sees, expected or not, appears in the per-type breakdown
and the full document list above, since the scan itself has no type
allow-list.

It reports **presence and counts only, never a value**: the GROQ projection
itself only ever asks `defined(<field>)`, a boolean, so a filename or an
archive location never leaves the dataset in the first place, let alone
reaches a log or a printed report. Deciding whether specific launch content
is *approved* — AB#137's own "no unapproved demo, webhook-test, private,
archive, sales, or abandoned content" acceptance criterion — is a manual
judgment call this tool's numbers and ids inform; it names no specific past
artifact and makes no approval decision itself.

Every read is validated defensively: a malformed row, a page returning more
than the requested page size, or a pagination cursor that fails to advance
strictly are all reported as a classified `AuditQueryError` rather than a
false empty result. The collected document count is checked against an
initial `count(*[])` snapshot; a mismatch — the dataset changed while the
audit was running — is reported as `AuditConsistencyError` rather than a
report that looks complete but was actually built from a moving target.
This catches any net growth or shrinkage in the document count during the
scan, which is the realistic failure mode; a delete and an unrelated insert
landing in the same window with the count unchanged is a known, disclosed
gap this count-only check cannot see (closing it would mean a second,
identity-comparing full scan — doubling the read cost to guard against a
coincidence). **Run this tool against a quiet dataset** — no concurrent
authoring or another process seeding it — the same operational expectation
the seed script's own live-verification step already carries.

### Required credential

`SANITY_AUDIT_TOKEN` — environment-only, like `SANITY_SEED_TOKEN`, and never
passed as a CLI flag (a process's argument list is visible to other
processes and shell history). Its required role is deliberately the
narrowest of the three tokens this project ever mints:

| Token | Role | Can write | Sees drafts/releases |
| --- | --- | --- | --- |
| `SANITY_READ_TOKEN` (runtime) | — (or none, for a public dataset) | No | No — `src/lib/sanity-client.ts` hardcodes `perspective=published` |
| `SANITY_SEED_TOKEN` (seeding) | Editor | Yes | Yes |
| `SANITY_AUDIT_TOKEN` (this tool) | **Viewer** | No | Yes |

Verified against Sanity's own documentation (2026-08-26): reading draft
content requires an authenticated client, and Sanity's docs state that
explicitly "requires an authenticated client with a viewer role" — the
built-in, read-only Viewer role is sufficient. Content Releases are
likewise gated only on authentication ("because releases are not public,
all API requests must be authenticated"), with no documented requirement
for a stronger role to read them. Never mint an Editor- or
Administrator-role token for this tool — it never needs write access, and
using a least-privilege credential means a leaked audit token cannot alter
or delete anything.

### Command

```bash
export SANITY_AUDIT_TOKEN=...   # fresh, Viewer role — read-only, safe to run repeatedly
npm run audit:sanity -- \
  --project <project-id> \
  --dataset <dataset> \
  --api-version <API version>
```

Safe to run against a live dataset at any time, including Production,
before or after a seed — it never writes, mutates, or deletes anything.
`--project`/`--dataset`/`--api-version` may also come from the
`SANITY_PROJECT_ID`/`SANITY_DATASET`/`SANITY_API_VERSION` environment
variables instead; if both a flag and its matching environment variable are
set and disagree, the tool refuses to guess which one was meant rather than
silently picking one.

## Adapter smoke verification (AB#137)

`npm run verify:sanity-adapters` (`src/lib/sanity-adapter-smoke-verification.test.ts`,
pure logic in `src/lib/sanity-adapter-smoke.ts`) closes the gap the audit
tool above deliberately does not: AB#137's own AC4, "representative
route-facing adapter queries and bounded gallery pagination succeed against
Production content." The audit tool proves *what documents exist*, never
calling the real `src/lib/sanity-*.ts` adapters at all; `verify:sanity-live`
calls the real adapters, but only proves they work against the one exact
AB#84 fixture set. This tool calls the real adapters — like the second — but
makes no assumption about which specific content exists — like the first.

### What it does

For every configured route locale (`localeRoutes.locales`, not just the
default): reads settings, home content, and services at the deployment's
default locale (matching those seams' own actual route semantics — see
`home-content.ts` and `services.ts`); builds the full category/content tree
for that locale, which exercises the adapters' own internal-consistency
checks (acyclic tree, every reference resolved, no orphaned parent) without
re-implementing them; picks one deterministic published article per locale
(lexicographically smallest `contentId`, so a repeat run samples the same
document); reads the article's detail page; and searches published galleries
in that same deterministic order — up to `MAX_GALLERIES_SEARCHED_PER_LOCALE`
(20) — walking each one's real cursor chain (`readSanityCuratedGalleryPage`)
to completion until one produces more than one page or the search is
exhausted, then reads that gallery's own detail page. Searching rather than
sampling a single gallery matters: a locale can have one small gallery sort
first and a larger, multi-page one sort later, and stopping at the first
would then report AC4's pagination requirement as undemonstrated even though
the dataset does demonstrate it. Every gallery actually walked during the
search — not only the one eventually reported — is watched for a duplicate
placement id or a repeated cursor across pages; either is a distinct
failure, not treated as "a large gallery," regardless of which candidate
exposed it. A hard page cap (`GALLERY_PAGINATION_HARD_CAP_PAGES`, 500) per
gallery guards against a runaway loop and is itself a failure if reached,
never silent success.

It deliberately does **not** re-validate what the adapters already validate
themselves (an empty article title or body, an unresolved category
reference, invalid media dimensions) — see `sanity-adapter-smoke.ts`'s own
module comment. It is not exhaustive: it samples one article per locale and
searches (rather than exhaustively walks) galleries, to stay a smoke test
rather than a full walk that scales with Production's eventual size.

**AC4 is only actually demonstrated, not merely attempted, if some gallery
found during that search, in some configured locale, produces more than one
page.** A dataset where every searched gallery fits on a single page never
exercises cursor encode/decode or keyset continuation at all; the run's
final check fails loudly in that case naming exactly what was and was not
exercised, rather than reporting a pass that never proved pagination.

A fresh, per-run random key exercises the cursor's own encode/decode logic;
it does **not** prove a real deployment's own `GALLERY_CURSOR_SIGNING_KEY` is
configured or reachable through the route-facing `gallery.ts` seam — a clean
run is not evidence of that separate deployment secret's presence.

**Run this against a quiet dataset**, the same operational assumption the
audit tool above already carries: `readSanityCuratedGalleryPage` recomputes
its cursor scope's `visibilityVersion` on every request, so a placement edit
landing between two page fetches can legitimately invalidate an outstanding
cursor mid-walk, and this run cannot distinguish that from a real bug.

### Required credential

Read-only, the same class as the deployment's own runtime `SANITY_READ_TOKEN`
— no separate token type is minted for this tool. A public dataset needs
none. A **private** dataset (Production may be private where Preview is
public) needs one, and it must come from the selected env file itself, never
an ambient shell variable: `assertPrivateDatasetHasUsableReadToken` refuses
to run if `SANITY_DATASET_VISIBILITY` is `"private"` and the selected file
does not define a real, non-placeholder `SANITY_READ_TOKEN` — this stops a
Production-targeted run from silently borrowing an unrelated token a
developer happened to have exported for other work. A **public** target
whose selected file omits `SANITY_READ_TOKEN` gets the same isolation from
the other direction: the suite unconditionally clears any ambient
`SANITY_READ_TOKEN` before loading the file, so a public run can never
silently attach an unrelated token left over in the shell either.

The selected env file must also define `SITE_LOCALE` and `SITE_LOCALE_ROUTES`
(`assertRouteConfigIsSelfContained`) — this suite reads locale route
configuration to decide which locales and default locale to query, and
without this check that could otherwise be silently inherited from the
ambient shell instead of the selected target, letting a run query Production
content through stale or unrelated routing while still reporting a pass.

### Command

```bash
npm run verify:sanity-adapters
```

Uses the same env-file resolution as `verify:sanity-live`
(`SANITY_LIVE_VERIFICATION_ENV_FILE`, defaulting to
`.vercel/.env.preview.local`) — see that section above. Point it at a
Production env file once one exists to actually satisfy AC4 there.

## Testing this script itself

```bash
npx vitest run scripts/sanity-seed-fixtures.test.mts
npx vitest run scripts/sanity-seed-http.test.mts
npx vitest run scripts/sanity-seed-content-verification.test.mts
```

All three run as part of `npm test`. Neither reaches a network — the fixture
tests are pure, and the HTTP tests inject a fake `fetch`. Only an actual
`--yes` invocation talks to a real project.

The AB#138 audit tool, the `verify:sanity-live` configurability above, and
the AB#137 adapter smoke tool's pure orchestration logic each have their own
offline suites, also part of `npm test`:

```bash
npx vitest run scripts/sanity-audit.test.mts
npx vitest run src/lib/sanity-live-verification-config.test.ts
npx vitest run src/lib/sanity-adapter-smoke.test.ts
```

The first exercises `runContentAudit`'s pagination, classification, and
consistency checks against a fake `runQuery`, and pins the sensitive-field
policy against `sanity/schemas/media.ts`'s real field names. The second
exercises the env-file resolution and target-completeness checks
`sanity-live-verification.test.ts` itself now uses. Neither reaches a
network; only `npm run verify:sanity-live` and an actual `npm run
audit:sanity` invocation do.


### Article end galleries (AB#161)

An article can declare one optional `endGalleryId` (1–128 lowercase letters,
digits and single hyphens). Keep that identity stable after publication and use
the same value for translations that declare an end gallery; a translation may
omit the optional gallery. Place each photograph in a separate
`articleEndGalleryPlacement` document referencing the article and public media,
with a stable `placementId`, a non-negative integer `order`, and `visible`.
Equal order values are resolved by placement ID. Matching translated occurrences
share placement IDs and media; different occurrences have different IDs.

The public adapter reads 24 images plus one lookahead per request. It never
loads the complete gallery for an article render. The gallery appears after the
body; loose images and mini-galleries keep their own positions and viewers.
Continuation URLs require the existing `GALLERY_CURSOR_SIGNING_KEY`. They are
`noindex` and canonicalize to the article's first page.

Studio validation is advisory against concurrent writes. After an import, run
`npm run verify:sanity-live` with the explicitly selected verification environment
as described above: its AB#161 published-occurrence audit checks article/gallery
ID collisions and translation bindings in bounded 500-document reads. The other
checks in that command still require the documented seed fixtures. An audit with
no end-gallery documents proves no migrated gallery; verify the imported articles
and every cursor slice against the approved source manifest before launch.
No production import is performed by this feature change.

### Historical article polls (AB#162)

The poll-voting branch adds an optional input to the existing conversion step:

```bash
npm run convert:joomla -- --review \
  --source <original-articles.ndjson> --out <private-report-directory> \
  --poll-results <legacy-poll-results.tsv>
```

Use the **original** source body, including `{CONTENTPOLL id=N}` markers. A
previously stripped body cannot establish where the author placed its poll.
The TSV header is exactly:

```text
poll_id	question	total_votes	language	option_title	option_votes
```

Every option occupies one row; each poll's question, total and language repeat.
Row order supplies stable `option-1`, `option-2`, … IDs. No source questions or
counts are embedded in the generic repository. The converter validates totals,
2–10 options, bounded plain text and safe nonnegative integers. Source `*`
language becomes `und`; other languages normalize to their language subtag.
A language mismatch refuses the placement rather than silently translating it.
Unknown markers without a matching TSV record remain refusals.

The reference source is the owner's gitignored
`joomla-backup/migration-audit/poll-data/legacy-poll-results.tsv`. An offline
parser check on 2026-09-18 found **22 polls, 110 option rows, matching totals**.
This validates the exported input, not an import into the Production dataset.

Review the converted blocks and `pollDocuments` in the private report. Each
referenced poll gets a `migrated--poll--N` document and its separately addressed
`pollTally-migrated-poll-N`, populated with the actual historical counts. The
closing instant `1970-01-01T00:00:00Z` is a sentinel meaning **already closed on
import**, not a source closing date. No runtime vote can enter these polls.
Repeated references use one document pair. Poll/tally contents, including counts,
are included in the article's `resolved_digest` approval binding and the final
plan digest.

The current conversion policy is **joomla-conversion-v3** and import plan format
**joomla-import-plan-v5**. Version 5 adds curated galleries; version 4 added the explicit story-root canonical
placement alternative. Regenerate review reports and approvals before planning;
old approvals/plans are intentionally rejected. Pass the same `--poll-results`
input to the subsequent `--plan` run. The existing approval-gated writer validates
matched historical pairs and their closed state, rejects identity collisions or
an existing draft, and writes a poll/tally wave before article references. It
never imports a live tally. Actual Production writes still follow AB#137's
owner-controlled baseline, approval, credential, audit and revocation workflow.

Live reader voting uses a **different runtime credential**, never the migration
credential; provisioning and a real-provider conflict/atomicity check are covered
by [Sanity setup](sanity-setup.md) and [ADR-0018](adr/0018-article-poll-voting-storage-and-dedup.md).


## Joomla comparison modules (AB#23)

The converter recognizes `{loadmodule mod_aikon_awesome_compare,<module title>}`.
Use the exact source module title as the key in the private resolution file's
`comparisonModules`. The source module stores `img1`/`img2`, with separate
`alt1`/`alt2` and `title1`/`title2` text. Review these rather than blindly copying
legacy presentation settings or its jQuery implementation. Supply descriptive
image alt text through the existing language-keyed `altText` map, and approve
side labels separately:

```json
{
  "comparisonModules": {
    "Synthetic exposure comparison": {
      "img1": "stories/example/original.jpg",
      "img2": "stories/example/adjusted.jpg",
      "labels": {
        "fi": { "first": "Alkuperäinen", "second": "Säädetty" },
        "en": { "first": "Original", "second": "Adjusted" }
      },
      "title": { "fi": "Valotusvertailu", "en": "Exposure comparison" }
    }
  }
}
```

Both `img1` and `img2` must also have the usual `images` entries with an approved
locator and SHA-256, and `altText` entries for the article's language. Pass the
same `--resolution` and `--image-root` to review and plan runs. The converter
verifies bytes before resolving either photograph; it invents no identities,
side labels, or descriptive text. Labels are nonblank and at most 200 characters;
optional titles are nonblank when set and at most 120. Missing module resolution,
wrong-language labels, unresolved images, and missing descriptive alt text refuse
the article. Other module types remain unknown-marker refusals.

Both placements remain at the marker's authored body position. Their labels,
media identities, and verified content hashes are bound into the conversion
approval. The plan contains both media references and asset requirements; the
writer rejects malformed references and extra/private block fields. Its existing
final plan digest covers the two images and their hashes.

The authoritative AB#23 discussion inventories **12 comparisons in 9 articles**.
Keep their private module inventory out of the template and CI fixtures. The
unlabeled source pair needs owner-authored labels before approval. Regenerate
review reports and manifest approvals under **joomla-conversion-v3**; do not reuse
v1/v2 conversion approvals. The current plan format is **joomla-import-plan-v5**;
the later story-root and curated-gallery changes advanced it without changing this block.
These articles enter the launch manifest only after their complete converted
bodies have been reviewed; adding converter support does not itself approve them.


## Curated Joomla galleries (AB#137)

`node scripts/joomla-curated-gallery-plan.mts INPUT.json OUTPUT.json [OWNER-APPROVAL.json]`
prepares curated `gallery`, `galleryPlacement`, and shared `media` documents for
`write:joomla`. This is separate from the HTML converter: BA Gallery markers must
be resolved into the complete ordered placements before this tool is called.
Never treat a marker removed from a body as proof that its photographs migrated.

The private input holds `documents`, `assetRequirements` (media identity, contained
source locator and exact source-byte `contentHash`), `categoryRequirements`
(stable category identities), and `sourceEvidenceDigest` (SHA-256 of the retained
source/binding evidence). This evidence digest is an owner-supplied recorded
assertion; this tool does not read or authenticate the evidence file. The owner
must verify it against the retained evidence before approval. The review digest
hashes the parsed input's JSON serialization: object key order is significant,
while input-file indentation is not. Reordering keys requires fresh approval;
array order always remains significant. Documents use the existing schema fields and pending
asset/category reference conventions. Categories must already exist in the target;
this command does not create them. Gallery covers may be independent of the grid.
Named sections support `sectionId`, `slug` and `label`; rich section introductions
and seeded-random ordering remain outside this importer slice and are rejected.

Without an approval file the tool writes a review plan and reports a nonzero exit
status. Its sole approval error is expected for a structurally valid review.
The printed **review digest** binds the complete input, including source hashes,
placements, captions, routes and source-evidence digest. After the owner reviews
that exact set, the separately authored approval file must contain:

```json
{
  "reviewDigest": "<the exact 64-character review digest>",
  "approvedBy": "<owner>",
  "approvedAt": "<real ISO timestamp with timezone>",
  "approvedForImport": true
}
```

Approval covers editorial content, public-image rights and privacy. An absent,
stale or malformed approval keeps the generated plan blocked. Supplying approval
does not clear structural failures. Re-run with that file to obtain the final
**write-plan digest** used by the existing `write:joomla --approved-digest` gate.
Those are different digests: the latter also binds the final plan's error state.
The normal baseline, temporary credential, dry run, explicit `--yes`, audit and
revocation workflow still applies. Neither this command nor its review output
uploads anything. Private input, approval and plans do not belong in Git.

The writer's v5 contract validates public-image covers, section membership,
manual placement order and bilingual occurrence identity. Repeated uses of a
photograph keep distinct placement IDs. It checks the target's category languages,
shared article/gallery content identity and routes, plus existing placement
ownership before writing. Transactions run in dependency waves: media, historical
polls when present, content containers, then placements. The final placement wave
also applies to article end galleries, so splitting a large import into batches
cannot send a placement before its parent document exists.

On a rerun, preflight also refuses to replace a gallery carrying an editor-authored
`galleryLayout`, `galleryCaptionPlacement` or section `intro`. These fields are
outside this importer's allowed input, so replacing the document would erase them.
Resolve such a conflict with the owner before retrying; do not clear authored
fields just to make the import pass. The refusal occurs before any asset upload.
The existing ordering rule and seed must also match the plan exactly: a rerun is
not a seed-rotation operation. Use the established recompute workflow for a later
editorial rotation rather than silently changing it during a migration retry.
