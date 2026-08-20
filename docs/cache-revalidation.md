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
npm run revalidate:public-cache -- https://example.com/api/revalidate
```

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
Production deployment currently exists; a local test cannot satisfy that gate.
AB#83 therefore remains open until a staged/current deployment can run the
publish → webhook → repeated cross-instance fetch check, unless the owner first
accepts an ADR/work-item scope amendment assigning that evidence elsewhere.
