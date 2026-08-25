# Published-content cache and revalidation

AB#83's cache boundary for the published Sanity source. Draft preview, keyword
search, and dynamic galleries are separate work and do not use this cache.

## One cache authority

Published queries continue to use `https://<project>.api.sanity.io`, always with
`perspective=published`. They deliberately do **not** use Sanity's API CDN.
Next.js's managed Data Cache is the one cache authority for the reference Vercel
deployment, so an accepted tag invalidation refetches from Content Lake instead
of racing an independently cached `apicdn.sanity.io` response.

Every reviewed public query has a one-hour maximum lifetime and the stable
global tag `sanity:public`, plus the applicable tags below. A query tag that is
not in `src/lib/sanity-cache.ts` is `no-store`; adding an adapter cannot silently
publish data into a cache whose invalidation effects have not been reviewed.
Connectivity probes are therefore never cached. A missed webhook converges at
the one-hour hard bound even if no operator intervenes.

| Tag | Inputs covered |
| --- | --- |
| `sanity:settings` | global settings and settings-driven chrome |
| `sanity:home` | home content and its settings/media dependencies |
| `sanity:services` | service listing and detail inputs |
| `sanity:articles` | article listings, placements, bodies, and neighbours |
| `sanity:categories` | localized tree, ancestry, routes, and branch listings |
| `sanity:galleries` | gallery metadata, sections, placements, order, filters, and cursor inputs |
| `sanity:media` | shared public media projections |
| `sanity:metadata` | canonical and Open Graph inputs |
| `sanity:sitemap` | current and future sitemap inputs (AB#85) |

`siteSettings`, `homePage`, `service`, `article`, `category`, `gallery`,
`galleryPlacement`, and `media` form the closed document-type map. A known
change expires only the bounded family set that can embed it. Media invalidates
every content family that can reuse the rendition; category changes invalidate
both content variants and route/metadata inputs; gallery and placement changes
expire the same `sanity:galleries` consistency group. This keeps gallery
metadata, sections, items, ordering/filter versions, and cursor validation from
knowingly remaining on different cache generations.

All invalidations use `revalidateTag(tag, {expire: 0})`. Route Handlers cannot
use `updateTag`, and hard expiry is the safe common behavior for publish,
unpublish, delete, public/private visibility, slug/category moves, placement or
order changes, sections, bodies, renditions, and metadata. Next.js exposes no
atomic multi-tag call; the handler expires the finite set synchronously before
acknowledging the event, and returns 503 if any call fails.

## Webhook contract

Configure one Sanity **document webhook per deployment environment**:

- URL: `https://<deployment>/api/revalidate`
- dataset: the environment's exact `SANITY_DATASET`
- trigger: create, update, and delete
- filter:
  `_type in ["siteSettings", "homePage", "service", "article", "category", "gallery", "galleryPlacement", "media"]`
- HTTP method: `POST`
- API version: the deployment's pinned `SANITY_API_VERSION`
- drafts: off
- versions: off
- secret: the environment's `SANITY_WEBHOOK_SECRET`
- projection:

  ```groq
  {
    "schemaVersion": 1,
    "projectId": sanity::projectId(),
    "dataset": sanity::dataset(),
    "operation": delta::operation(),
    "before": before(){_id, _type},
    "after": after(){_id, _type}
  }
  ```

**Preview additionally requires a Vercel Authentication bypass header on the
webhook itself.** Every generated Preview URL sits behind Vercel's own SSO
wall (`docs/deployment.md`'s access-protection requirement, verified by
AB#116); a request with no bypass credential — Sanity's webhook included —
never reaches `route.ts` at all and gets Vercel's `302` to
`vercel.com/sso-api` instead, which is not something `readSanityWebhook` can
see or report. Add a custom header to the Sanity webhook:

- `x-vercel-protection-bypass`: a Vercel Protection Bypass for Automation
  secret (Project Settings → Deployment Protection → Protection Bypass for
  Automation) — the same mechanism `scripts/vercel-preview-api.mts` already
  uses to read a protected deployment. **Generate a separate secret dedicated
  to this webhook rather than reusing the "Azure Pipelines" one.** Vercel
  supports more than one named bypass secret per project; giving Sanity its
  own keeps webhook compromise or rotation from coupling to the pipeline's
  own verification credential, matching this project's existing pattern of
  splitting credentials by who holds them (`SANITY_BUILD_READ_TOKEN` vs.
  `SANITY_READ_TOKEN` in `docs/deployment.md`).

Production is not expected to need this: `ssoProtection.deploymentType` is
`all_except_custom_domains`, and AB#18's production promotion puts Production
on a real custom domain, which Vercel's own SSO protection exempts.

The endpoint accepts only POST because `route.ts` exports no other method. It
bounds the raw body at 16 KiB, requires JSON and Sanity's `idempotency-key`,
verifies `sanity-webhook-signature` over the exact raw UTF-8 body with the
official `@sanity/webhook` verifier, and only then parses a closed schema. The
signed project and dataset must equal deployment configuration. Draft/version
IDs, unknown document types, extra fields, mismatched before/after identities,
and impossible operation/state combinations fail closed.

Sanity delivers at least once, so the same idempotency key may arrive more than
once. The endpoint does not need a process-local or external replay ledger:
hard-expiring the same stable tag again has the same result, making duplicate,
replayed, and out-of-order events idempotent across runtime instances. The key
is validated but neither retained nor logged. Current Sanity behavior retries
429/5xx responses twice at 30-second intervals; 4xx responses are terminal, so
configuration and payload failures must be corrected and reconciled rather than
waited out.

Webhook delivery can be delayed. Because the origin query bypasses Sanity's API
CDN, the handler does not add an arbitrary sleep before invalidation; once the
signed event arrives, the next cache fill reads the published Content Lake
origin. The finite one-hour lifetime is the backstop for a delivery that never
arrives.

## Recovery and reconciliation

When an update/delete payload lacks trustworthy old state, the endpoint expires
the single `sanity:public` tag. Unknown document types do not trigger this path:
they fail with a bounded 400 instead of creating an unbounded amount of work.

After webhook downtime, a failed terminal delivery, promotion, or rollback, an
operator performs the same bounded global expiry against the newly current
deployment:

```bash
SANITY_PROJECT_ID=... \
SANITY_DATASET=... \
SANITY_WEBHOOK_SECRET=... \
VERCEL_AUTOMATION_BYPASS_SECRET=... \
VERCEL_TOKEN=... \
VERCEL_ORG_ID=... \
VERCEL_PROJECT_ID=... \
npm run revalidate:public-cache -- https://example.com/api/revalidate
```

`VERCEL_AUTOMATION_BYPASS_SECRET` is optional and required only against a
deployment behind Vercel Authentication — every Preview deployment today.
Without it, the request never reaches `route.ts`: Vercel's own SSO challenge
answers first, and the script reports a non-JSON response rather than
acceptance. Production is expected to run on a real custom domain, which
Vercel's SSO protection exempts, so the variable stays irrelevant there.
Because the bypass secret is a reusable, project-wide credential, the script
never attaches it to an unverified host: whenever it is set, it first
resolves the endpoint through Vercel's authenticated deployment API — the
same check `verify-preview-deployment.mts` already performs — which is why
`VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` are required
alongside it, and only alongside it.

The script signs a schema-versioned `reconcile` payload and sends no secret in
the URL, arguments, body, or output. Run it from a trusted shell whose variables
are sourced from that environment's secret store. A success prints only the
deployment origin and the endpoint's random correlation reference. Run public
smoke checks after it; a 200 proves acceptance, not multi-instance propagation.

## Logs and responses

Application events contain only `event`, a random correlation identifier,
`state`, and a redacted error class. They never contain the request body,
document identity, signature, secret, idempotency key, source headers, cache
tags, or provider error. Responses likewise contain only status and correlation
identifier and always carry `Cache-Control: no-store`.

## Deployed verification gate

Unit tests prove request validation, replay behavior, the invalidation map,
hard-expiry calls, failures, and the broad fallback. ADR-0004 separately requires
propagation to be observed on a deployed Vercel multi-instance runtime. No
Production deployment exists yet (AB#18 is a later story), but a Preview
deployment now does (AB#116, closed 2026-08-24) and is reachable for this gate —
a local test still cannot satisfy it. **The publish → webhook part of that
check has now been run and recorded against a real Preview deployment
(2026-08-25, below); the repeated cross-instance fetch part has not, and
cannot be until a separate route-wiring gap closes (also below). AB#83
therefore remains open**, unless the owner first accepts an ADR/work-item
scope amendment assigning that remaining evidence elsewhere.

The gate has two independent halves, and only one is currently satisfiable.
No route in `src/app` reads from Sanity yet — every content adapter exists
(AB#80–82, AB#112–114) but none is wired into a route-facing seam, so
`SITE_CONTENT_SOURCE` stays `mock` in every deployment today (`docs/deployment.md`).
That means there is no visitor-facing output that a Sanity publish could ever
change yet, so the gate's "repeated cross-instance fetch" half — observing a
page actually reflect the new content — cannot be exercised until a route-wiring
story lands. This is a scope gap in the epic, not a defect in AB#83's own code,
and it blocks closing AB#83 regardless of how the webhook half below goes.

The webhook half — real Sanity publish → real signed delivery → `/api/revalidate`
verifying and accepting it on the deployed runtime — does not depend on route
wiring, since `getSanityConfig()` and the webhook handler read `process.env`
directly rather than going through `SITE_CONTENT_SOURCE`. As of 2026-08-24,
Preview carries its own `SANITY_PROJECT_ID`, `SANITY_DATASET` (a dedicated
public Preview dataset, distinct from Production's), `SANITY_API_VERSION`,
and a freshly generated `SANITY_WEBHOOK_SECRET`, all set as Vercel Preview
environment variables — the concrete values belong to this deployment, not
the generic template, and stay out of this repository per
`docs/sanity-setup.md`'s ownership boundary; they are recorded against AB#83
in Azure Boards instead. A fresh Preview deployment was built and deployed
with `vercel build/deploy --target=preview` to pick them up — confirmed
still protected (`302` to `vercel.com/sso-api`) and `X-Robots-Tag: noindex`.
**The webhook half is now verified**, against a real deployed Preview
runtime (2026-08-25): a dedicated Protection Bypass for Automation secret
was generated for this webhook in Project Settings → Deployment Protection
(distinct from the pipeline's own, per the least-privilege reasoning above),
a Sanity document webhook was created against a Preview deployment's
generated URL per the contract above, a real document was mutated in the
`preview` dataset via Sanity's HTTP mutate API, and the deployment's function
logs recorded `{"event":"sanity.revalidation","correlationId":"dbb4c2b2-96c2-4672-9e03-e33dc3904173","state":"accepted"}`.
Two operational findings surfaced getting there, worth keeping:

- **A `SANITY_WEBHOOK_SECRET` change does not reach an already-created
  deployment.** The first delivery attempt correctly reached `route.ts`
  (past the SSO bypass) but failed with `invalid-signature`, because the
  running deployment still carried the value it was built with, not the
  updated one — confirming that a Sensitive variable's runtime injection is
  still fixed to the deployment's own creation-time snapshot rather than
  following a later change. `docs/deployment.md`'s webhook-secret rotation
  guidance now records the correct order this requires (Vercel, then
  deploy, then Sanity).
- The target-staleness risk noted above was confirmed directly, from the
  same rotation: the webhook's URL had to be repointed by hand to the new
  deployment, and the old one kept answering `invalid-signature` to later
  deliveries in the meantime — exactly the "old `route.ts` enforcing a
  contract that no longer matches the live one" case, not a cache-staleness
  one.

**This target remains temporary — for this verification run only.** Preview
has no stable alias — the pipeline's `DeployPreview` stage produces a
brand-new, unique `<hash>.vercel.app` URL on every `main` run, and nothing
repoints an existing webhook when it does. Vercel's Data Cache persists
across deployments within one project environment (Preview and Production
never share it, but every Preview deployment does) and `revalidateTag`
invalidates it globally, so an old webhook target does not by itself leave a
newer release candidate stale on cache-isolation grounds — but, as just
confirmed, it does stop delivering at all once code or secrets drift, or the
old deployment is eventually cleaned up. Making Sanity's webhook durable
across deployments — a stable, protected Preview alias the pipeline
repoints after each verified deploy, or an equivalent — is a separate,
currently unbuilt piece of work, not something to improvise here; file it
before route wiring makes Preview's cache-carrying traffic real.

Also outstanding beforehand: during this session, an unrelated stray
Production deployment (`source: cli`, no `X-Robots-Tag`, no SSO challenge) was
found live at the project's default `photosite-starter.vercel.app` domain —
almost certainly a leftover manual `vercel deploy`/`vercel build` run from
AB#116 debugging, before its `--target=preview` fix landed. It served only
mock content, so nothing sensitive was exposed, but it was public, indexable,
and unprotected. It has been deleted.
