# ADR-0006: Sanity data-access boundary and client transport

**Status:** Proposed
**Date:** 2026-08-10
**Amended:** 2026-08-13 — see the amendment under §1
**Deciders:** Project owner (Ilkka Rytkönen)
**Work item:** AB#39

## Context

The project has committed to Sanity as its CMS (README, ADR-0004), and every content
seam in `src/lib` — site settings, home content, services, the content tree, listings,
content pages, galleries — is already written as an async accessor over a mock layer,
waiting for an adapter behind it. Six work items (AB#80, AB#81, AB#82, AB#83, AB#112,
AB#114) will write those adapters. They all need one thing first: a way to reach the
Content Lake.

That "way" is a bigger commitment than it looks. Whatever this story establishes will be
imported by every adapter written afterwards, so its shape decides how expensive it is to
change the CMS, how a credential is handled, and whether draft content can leak into a
public page. Three constraints frame it:

- **Customer ownership (ADR-0004 §5).** Each clone runs its own Sanity organization,
  project, dataset, and billing. There is no shared cross-customer account or credential,
  and the site must be transferable without touching code.
- **Minimal dependencies (AGENTS.md).** The project does not add a library without a
  stated need. It already reaches its email provider over plain HTTP for exactly this
  reason (`src/lib/contact-delivery-resend.ts`), and every shipped third-party component
  has to be recorded in `docs/asset-inventory.md` with its license.
- **Nothing decided early that AB#83 owns.** Caching, revalidation, tag invalidation, and
  the webhook boundary are that story's, and a client that arrives with its own opinions
  about caching would pre-empt it.

The immediate question is therefore not "how do we query Sanity" but "what does the rest
of the project get to know about Sanity, and what carries the credential".

## Decision

### 1. Two modules hold the runtime connection to Sanity

`src/lib/sanity-config.ts` holds the validated connection settings and the read token.
`src/lib/sanity-client.ts` holds the HTTP surface: the hostname, the API version path
segment, the perspective, the parameter encoding, and the response envelope. Nothing else
in the repository names any of them.

Adapters in `src/lib` compose GROQ and project results into the project's own types.
Routes and components read those adapters. Two mechanisms enforce the direction, because
one is not enough: ESLint forbids `src/app/**` and `src/components/**` from importing
either module, and both modules carry the `server-only` marker so that a Client Component
reaching them *through an adapter* — which ESLint cannot see — fails the build rather
than the request. The boundary is a rule, not a convention.

#### Amendment 2026-08-13 (AB#82) — §1, what "two modules" counts

**Status of the record: still Proposed.** This amendment states the scope of one clause
more precisely. Nothing it permits is new, and no other section changes.

**The original rule, preserved:** "`src/lib/sanity-config.ts` holds the validated
connection settings and the read token. `src/lib/sanity-client.ts` holds the HTTP
surface… Nothing else in the repository names any of them."

**What it counts:** the two modules are the application's **runtime connection** — the
settings, the credential, and the request surface the running site uses to reach the
Content Lake. The rule bounds what has to be rewritten to replace the CMS and where a
credential may live. It was never a count of files in the repository that mention Sanity.

Two things AB#82 added are therefore inside the rule, not exceptions to it:

- **`sanity/schemas/`** is a Studio schema artifact — content-store configuration
  exported to the customer's own Studio, importing nothing and imported by nothing under
  `src/`. It holds no credential and issues no request. Its only link to the application
  is a test asserting that the adapter projects fields the schema declares.
- **The asset CDN host** is named in `src/lib/sanity-config.ts`, which already owns the
  project id and dataset the address is built from, and restated in `next.config.ts`. The
  restatement is unavoidable: the image optimizer's allow-list is build configuration and
  cannot import a module marked `server-only`. A test pins the two values together.

**Unchanged:** adapters compose GROQ and project results into project-owned types; routes
and components read adapters; ESLint forbids `src/app/**` and `src/components/**` from
importing the client or its configuration; both modules carry the `server-only` marker.
Replacing the CMS still means rewriting those two modules and the adapters above them.

#### Amendment 2026-08-13 (AB#82) — §5, what a server-side boundary does not protect

**Status of the record: still Proposed.** This amendment adds a constraint the original
§5 did not state. Nothing it said is withdrawn.

**The original rule, preserved:** "The token setting is unprefixed… The token travels in
an `Authorization` header, never in a URL, and is never logged."

**What the first schema story established:** §5 reasoned about the *credential*, and
about data crossing the application's own boundaries. It did not reason about what the
content store itself exposes, and two things there are outside the application's reach
entirely:

- **A public dataset is world-readable.** Anyone holding the project id can query every
  published document in it. A field the application never projects — ADR-0002 §1's
  `archiveLocator` is the case in point — is therefore not server-only in a public
  dataset. It is published, by the store, regardless of what the adapter does.
- **Assets are public in either dataset.** An uploaded file is addressable on
  `cdn.sanity.io` from the moment the upload completes, before any document is published
  and regardless of dataset visibility. A read-time refusal keeps those bytes out of a
  page; it does not make them unreachable.

**The addition:** the schema is built for a stated dataset visibility, and the
world-readable case does not get the field at all — `defineSchemaTypes({ datasetVisibility })`
omits `archiveLocator` for a public dataset, so there is no place to record a master's
location into a document anyone can read. A private dataset makes `SANITY_READ_TOKEN`
required rather than optional. Separately, the export policy is enforced in the Studio as
a publish-blocking asynchronous validation, and again in the adapter, because the Studio
binds an editor while the HTTP API, an import, and a migration script do not.

**Consequence for later schema stories:** any field carrying something a visitor may not
read is a dataset-visibility decision before it is an adapter decision. "The adapter does
not project it" is not, on its own, a control.

**Evidence:** Sanity's dataset visibility and asset access documentation, and the AB#82
review of 2026-08-13, which found the original read-time-only enforcement insufficient.

### 2. No client SDK — the query API over `fetch`

A published read is one authenticated GET. The client composes it directly, following the
same pattern as the project's email adapter, and adds no CMS library. (The one package
this story does add, `server-only`, is a build-time marker with no code — see §1.)

Verified against Sanity's HTTP API reference (2026-08-10):
`GET https://<projectId>.api.sanity.io/<apiVersion>/data/query/<dataset>`, GROQ in
`query`, parameters as `$`-prefixed URL parameters whose values are JSON literals,
optional `perspective` and `tag`, `returnQuery=false` to suppress the echo. Success is
`{ ms, query, result, syncTags }`; a rejection is `{ error: { description, type, … } }`.
GET is capped at 11 KB, and because GROQ always evaluates to a value, a missing document
is `null` or `[]` rather than a 404.

`query()` returns `unknown`. This module knows the transport and nothing about content, so
a generic type parameter would be a cast dressed as a guarantee; the adapter that wrote
the query owns validating what came back.

### 3. Published perspective, by construction

Every request states `perspective=published`, and no setting, option, or argument can
change it. Draft access is not off by default — it is absent. A draft-preview surface is a
separate, authenticated, `no-store` feature (ADR-0004 §3), and building it requires
deliberately editing this file.

### 4. The content source is declared, and production may not be demo content

`SITE_CONTENT_SOURCE` is `mock` or `sanity`, with no default. A production deployment may
not select `mock`; an undeclared `SITE_DEPLOYMENT_STAGE` counts as production, so the
guard fails closed. There is no fallback path between the two sources at any seam — a
failed Sanity read raises, carrying a failure class, a retry decision, and a correlation
identifier.

The source is read inside `loadDeploymentConfig`, not lazily at the first content read.
Every route resolves the deployment configuration, so an illegal combination fails while
the site is being built rather than waiting for some future adapter to consult the
setting — a guard that only fires once someone remembers to ask it is a guard in name
only. Reading it there means the stage parser lives in its own module
(`deployment-stage.ts`), so the configuration and the guards it applies do not import each
other in a circle.

### 4b. Settings are validated against the service's rules

Where Sanity documents a constraint, the validator enforces that constraint rather than a
looser approximation of it: the dataset name follows Sanity's own 1–64 character rule, and
the project id is validated as the hostname label it becomes. A validator that accepts
values the service rejects does not validate — it relocates the error to the first request
of a deployed site. The one rule the project adds on its own is refusing a future-dated
API version, which pins nothing.

### 5. Secrets

The token setting is unprefixed, so Next.js cannot compile it into a client bundle; a
value mirrored under `NEXT_PUBLIC_SANITY_READ_TOKEN` fails the deployment rather than
being ignored. The token travels in an `Authorization` header, never in a URL, and is
never logged. Operational events carry only a correlation identifier, a state, a
project-owned tag, and a redacted error class (ADR-0004 §5).

### 6. Caching is deferred to AB#83

Reads go to the uncached `api.sanity.io` host with `cache: "no-store"`. The API CDN, tag
invalidation, and expiry belong to AB#83's cache contract.

## Options Considered

### Option A: `@sanity/client`

The official SDK. Handles URL composition, parameter encoding, retries, CDN switching,
listeners, and mutations, and is what most Sanity documentation assumes.

- Adds a runtime dependency and its transitive tree to a project that ships to people who
  clone and rebrand it, and a row in `docs/asset-inventory.md`.
- Brings behavior the project has not decided on: retry policy, `useCdn`, and a live
  listener transport. Defaults would silently become decisions AB#83 is meant to make.
- Its surface is large relative to what the MVP needs: published reads. Mutations,
  listeners, and asset uploads are not used, and their presence is a temptation.
- Upgrades follow the SDK's cadence rather than the project's, and pinning an API version
  no longer fully pins behavior.
- In exchange: less project-owned code, and someone else maintains the transport.

### Option B (chosen): project-owned adapter over the HTTP query API

- No CMS library, no transitive tree, and nothing whose bytes reach a browser.
- Every behavior the site depends on is visible in one file and asserted in tests: the
  exact URL, the perspective, the parameter encoding, the failure classification.
- Matches the existing precedent for an external provider (`contact-delivery-resend.ts`),
  so the codebase has one way of reaching a third party rather than two.
- Costs: the project owns URL composition and error mapping, must re-verify them when the
  API version is bumped, and implements only the subset it uses — GET reads today, with
  the POST form left for the story that needs it.

### Option C: SDK, but wrapped behind the same boundary

Keeps the boundary of Option B and the maintenance of Option A. Rejected because it pays
the dependency cost without removing the code — a wrapper thin enough to be worth having
is roughly the size of Option B's whole client — and the SDK's defaults still have to be
audited and overridden.

## Trade-off Analysis

| | A: SDK | B: HTTP adapter (chosen) | C: wrapped SDK |
| --- | --- | --- | --- |
| CMS library added | yes | **none** | yes |
| Behavior visible in-repo | low | **complete** | partial |
| Pre-empts AB#83's cache decision | yes, via defaults | **no** | yes, must be overridden |
| Draft access impossible by construction | no (an option away) | **yes** | yes, if the wrapper forbids it |
| Code the project maintains | least | most | middle |
| Cost of replacing the CMS | rewrite adapters | **rewrite two files + adapters** | rewrite two files + adapters |
| Effort to reach parity on features unused today | none | implement when needed | none |

The decisive column is the third and fourth. A bootstrap story's job is to make the
later stories possible without making their decisions for them, and the SDK's defaults —
`useCdn`, retries, `perspective` — are exactly those decisions arriving early and
invisibly. The cost is real: the project maintains URL composition and error mapping it
would otherwise get for free. It is bounded, tested, and about 200 lines.

This is reversible in the direction that matters. If a later story needs listeners,
mutations, or asset uploads, adopting the SDK behind the same boundary is Option C, and
the adapters above it do not change.

## Consequences

**Good**

- The MVP reaches its CMS with no client SDK and no library whose bytes reach a browser.
  The one dependency added is `server-only`, a marker package that resolves to an empty
  module in a server build and exists to fail the other case.
- Draft content cannot reach a public page through configuration alone.
- A production deployment cannot publish the project's demo photographs as a
  photographer's own work.
- Replacing the CMS is two files plus the adapters, and ESLint proves no route reached
  past them.
- AB#83 inherits an explicitly uncached client and a clean decision.

**Bad / risky**

- The project owns transport correctness. The URL shape, parameter encoding, and error
  envelope are verified against documentation at a point in time, and bumping
  `SANITY_API_VERSION` means re-verifying them.
- Only the subset in use is implemented. A query above 11 KB fails loudly rather than
  falling back to the POST form, and there is no retry, no listener, and no mutation path.
- Adapters receive `unknown` and must validate. That is correct, and it is more work per
  adapter than an SDK's typed helpers would be.
- Requiring `SITE_CONTENT_SOURCE` makes it a breaking configuration change for anything
  that builds this project: the Azure Pipelines build gate, the Playwright harness, and
  every local `.env.local` must declare it. That is the intended cost of having no
  default.
- The CI build gate now declares itself `preview`. It never was a production deployment,
  but it previously built as one by omission, and that is no longer possible while the
  project's only content source is its own fixtures.

**Neutral**

- The uncached host is a deliberate placeholder. Until AB#83, a Sanity-backed deployment
  would make one request per read — correct, and not yet fast.

## Action Items

- [ ] AB#83: decide the cache contract, including whether to move reads to
      `apicdn.sanity.io`, and replace `cache: "no-store"` with the tag-based policy.
- [x] AB#82 wrote the first adapter behind this boundary (`src/lib/sanity-media.ts`),
      validating the `unknown` result it receives and projecting an allow-list.
- [ ] AB#80 / AB#81 / AB#112 / AB#114: write the remaining adapters the same way; each
      owns validating the `unknown` result it receives.
- [ ] AB#116: run `probeSanityConnectivity` against the Preview deployment's own project
      as part of provisioning verification.
- [ ] Revisit this record if a story needs listeners, mutations, or asset uploads; that
      is the trigger for reconsidering the SDK behind the same boundary.
