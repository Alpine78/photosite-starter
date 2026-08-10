# Sanity setup, ownership, and failure behavior

How a deployment connects to its content store, who owns that store, and what the site
does when the store cannot be reached.

This covers the connection only. Content schemas, caching and webhook revalidation, and
content seeding are separate work items (AB#80, AB#81, AB#82, AB#83, AB#112, AB#114);
until they land, every deployment runs on `SITE_CONTENT_SOURCE=mock`.

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
  application's knowledge of Sanity is confined to two files (see
  [ADR-0006](adr/0006-sanity-data-access-boundary.md)), so replacing the CMS means
  rewriting those and the adapters above them — not auditing every route.

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
5. **Create a read token only if the dataset is private.** A public dataset needs none.
   Use the narrowest read-only role Sanity offers, issue a separate token per
   environment, and store it in the hosting provider's secret storage — never in the
   repository, never in a URL, and never under a `NEXT_PUBLIC_` name.
6. **Set the deployment settings** below, then verify the connection before wiring any
   content: `probeSanityConnectivity` in
   [`src/lib/sanity-client.ts`](../src/lib/sanity-client.ts) runs a query that reads no
   document and proves the address and credential are right.

## Settings

| Setting | Required | Purpose |
| --- | --- | --- |
| `SITE_CONTENT_SOURCE` | always | `mock` (the project's demo fixtures) or `sanity` (this deployment's Content Lake). No default. |
| `SANITY_PROJECT_ID` | when `sanity` | Project id; validated as a hostname label. |
| `SANITY_DATASET` | when `sanity` | Dataset name; validated as a single URL path segment. |
| `SANITY_API_VERSION` | when `sanity` | Dated API version, `vYYYY-MM-DD`. Undated and legacy versions are refused. |
| `SANITY_READ_TOKEN` | optional | Server-only credential for a private dataset. |

Every value is validated where it is read, so a typo names itself at startup instead of
becoming a 404 to debug later.

### Secrets

The read token is server-only, and two things keep it out of the browser:

- **The setting is not prefixed `NEXT_PUBLIC_`.** Next.js inlines only
  `NEXT_PUBLIC_`-prefixed values into client bundles, so an unprefixed value cannot be
  compiled into browser JavaScript. That is the guarantee. A token found mirrored under
  `NEXT_PUBLIC_SANITY_READ_TOKEN` fails the deployment rather than being quietly ignored,
  because its presence means the credential is already on its way to every visitor.
- **ESLint forbids `src/app` and `src/components` from importing the client or its
  configuration.** Routes and components read adapters in `src/lib`; provider knowledge
  and credentials stay behind that line.

The token never appears in a URL, is never logged, and is never returned to a caller.

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
- A **production deployment may not declare `SITE_CONTENT_SOURCE=mock`.** It is refused
  at startup — the same safeguard the contact form's sink adapter carries, and for the
  same reason: publishing the project's placeholder copy and AI-generated placeholder
  photographs as a photographer's own work is misrepresentation, not a mode. An
  undeclared `SITE_DEPLOYMENT_STAGE` counts as production, so the guard fails closed.
- A **missing `SITE_CONTENT_SOURCE`** fails with a configuration error naming the
  setting, rather than defaulting to either store.

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

## Not yet decided

- **Caching, revalidation, and the API CDN.** Reads currently go to the uncached
  `api.sanity.io` host with `cache: "no-store"`. AB#83 owns the cache contract — tag map,
  invalidation, expiry, and whether to move to `apicdn.sanity.io` — and that choice
  should be made there, deliberately, rather than inherited from a default set here.
- **The POST query form.** Reads use GET, bounded at Sanity's documented 11 KB. A query
  that outgrows it fails loudly rather than being truncated; the API's POST form would be
  implemented then, not speculatively now.
