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

One run creates 448 documents, all deliberately built from the six real,
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
| `gallery` | 2 | `featured` (2 sections, a body) and `archive` (neither) — see below |
| `galleryPlacement` | 426 | 26 in `featured` across its two sections, 400 in `archive` |

The two galleries are deliberately built to exercise different parts of the
gallery schema at once:

- **`featured`** has two named sections (`high-tide`, `low-tide`) and a body
  (paragraph, heading, list, quote, and a media block) — the "sections and
  body" half of this story's acceptance criteria.
- **`archive`** has neither, and its 400 placements are the "roughly
  400-placement fixture" half — enough to exercise
  `src/lib/sanity-gallery.ts`'s keyset-paginated read across several pages,
  not just its first one.
- One photograph (from the shared 6-item pool) has a placement in **both**
  galleries, under two different `placementId`s — proving a single `media`
  document keeps one identity while appearing in two curated placements
  (ADR-0002).

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
builds the full 448-document fixture set, runs every structural invariant
check it knows about (`validateSeedFixtures` in `sanity-seed-fixtures.mts` —
unique ids, every reference resolving to the right document type, no cycle in
the category tree, exactly one gallery with sections *and* a body and one
with neither, exactly 400 archive placements, the shared-media invariant, and
more), prints a per-type count, and lists the six demo photograph files it
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
   every service `slug`, and every article/gallery `(contentId, language)`
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
   goes around the Studio entirely.
3. **Write.** All 448 documents are sent as `createOrReplace` mutations, in
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
   assets carrying any recognizable filename (the upload never sets one):

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

- **`sanity dataset export <dataset>`** — a full dataset export, including
  assets, to a local archive. Run this before a destructive operation you are
  not fully certain about, seeded content or not.
- **`sanity dataset import <file> <dataset>`** — restores from that archive.
- Sanity's own document history (available on paid plans) can recover an
  individual document's prior state without a full dataset restore.

See Sanity's own CLI documentation for exact flags and current behavior —
this project does not restate a vendor command reference that would drift out
of date.

## Production handoff

AB#84 exists to prove this workflow against a real, customer-owned dataset
before the later Production launch seed runs it for real. This section is
that handoff: the exact command, inputs, verification, rollback, and owner
actions the launch story needs, distilled from a real write-enabled run this
story performed against the customer-owned Preview project and dataset.
Seeding the reference *Production* dataset itself stays out of scope here —
it is that later story's own work, not this one's.

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
   fixture, Production included — verifying arbitrary owner-approved launch
   content is a distinct, unimplemented need. The selected file must define
   its own `SANITY_PROJECT_ID`/`SANITY_DATASET`/`SANITY_DATASET_VISIBILITY`/
   `SANITY_API_VERSION` rather than leaving any of them to the ambient shell
   environment (`src/lib/sanity-live-verification-config.ts` enforces this
   and the suite prints its resolved target before issuing any query, so an
   operator can confirm it). It is deliberately separate from `npm test` (it
   reaches a real network) and from route wiring (nothing under `src/app` or
   `src/components` imports it): it exists to prove the adapters work, not
   to switch the deployment over to them.

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
  (the number the dry run prints as `Fixture set: N documents`, 448 as of
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
  SANITY_AUTH_TOKEN=$SANITY_SEED_TOKEN npx sanity dataset export <dataset> <local-path> -p <project-id>
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
   real, owner-approved launch content that differs from the fixture. Use
   the read-only content audit tool below to verify a real Production seed
   instead — it makes no assumption about which specific content was
   written.
4. Revoke the token immediately after, in Sanity's project API settings —
   not by letting it expire — the same step this story's own Preview run
   requires.
5. Record the non-secret target identity (project id, dataset name, run
   date, and the verification outcome) durably outside this repository — an
   Azure Boards comment on the launch story, matching how this story
   recorded its own Preview run (see `docs/sanity-setup.md`'s *Ownership*
   section on why the project id itself never enters this repository).
6. Treat *Going live: removing the sample content* above as mandatory before
   real customer content is authored against the same dataset, exactly as it
   already is for Preview.

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

## Testing this script itself

```bash
npx vitest run scripts/sanity-seed-fixtures.test.mts
npx vitest run scripts/sanity-seed-http.test.mts
npx vitest run scripts/sanity-seed-content-verification.test.mts
```

All three run as part of `npm test`. Neither reaches a network — the fixture
tests are pure, and the HTTP tests inject a fake `fetch`. Only an actual
`--yes` invocation talks to a real project.

The AB#138 audit tool and the `verify:sanity-live` configurability above
have their own offline suites, also part of `npm test`:

```bash
npx vitest run scripts/sanity-audit.test.mts
npx vitest run src/lib/sanity-live-verification-config.test.ts
```

The first exercises `runContentAudit`'s pagination, classification, and
consistency checks against a fake `runQuery`, and pins the sensitive-field
policy against `sanity/schemas/media.ts`'s real field names. The second
exercises the env-file resolution and target-completeness checks
`sanity-live-verification.test.ts` itself now uses. Neither reaches a
network; only `npm run verify:sanity-live` and an actual `npm run
audit:sanity` invocation do.
