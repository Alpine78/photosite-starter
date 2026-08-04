# ADR-0004: Reference production host and ownership boundary

**Status:** Accepted
**Date:** 2026-08-04
**Deciders:** Project owner (Ilkka Rytkönen)
**Work item:** AB#109

## Context

PhotoSite Starter needs a reference production host before deployment and cache
integration are implemented. The reference is the maintained, documented path for the
first production site and future clones; it does not remove the starter's promise that a
clone can be deployed on another capable host.

The current application uses Next.js 16 App Router in its default server mode. It does
not use static export, and its image surfaces use `next/image`. The future public content
tree also requires server-rendered continuation routes. Three work items blocked by this
decision add requirements that a static-only host cannot meet:

- AB#12 adds a privacy-respecting contact Route Handler with bounded input, abuse
  controls, outbound delivery, server-only credentials, and application-emitted logs
  that contain no form content or other personal data.
- AB#83 adds a signed Sanity webhook Route Handler and tag-based cache invalidation. A
  revalidation accepted by one runtime instance must not leave other instances serving
  stale content.
- AB#116 provisions the customer-owned Preview environment, deploys a release candidate
  to a non-indexable URL, and documents the later production promotion and rollback
  mechanisms. AB#18 later promotes the approved release candidate and identifies the
  production rollback target and path; AB#118 exercises that rollback before handoff.

The host therefore has to support Next.js server rendering and Route Handlers, managed
secrets, operational logs, image optimization, non-indexable previews, and a coherent
multi-instance cache. Customer ownership and a credible exit path matter because each
photographer runs an independent clone; there must be no shared cross-customer account,
credential, or production resource.

Provider capabilities and public retail prices in this record were checked against the
official sources listed under *Evidence* on 2026-08-03. Prices and service limits are
snapshots, not contractual quotes, and must be rechecked when AB#116 provisions the
environment.

### Accepted privacy boundary: application logs and hosting-provider telemetry

On 2026-08-04, the project owner accepted the following boundary for AB#12 and this
decision:

- Application-emitted logs never contain form fields or other personal data. The
  application event schema contains only a random correlation identifier, state, and a
  redacted error class. The correlation identifier contains no embedded user data and is
  not persisted with form content or direct identifiers.
- Necessary hosting-provider-generated request and security telemetry is permitted only
  as a separately documented, minimized, and access-controlled processing boundary. Its
  data categories, purpose, privacy role, access, retention and deletion, processing
  locations or transfers, and ownership must be recorded before production launch.

Vercel Runtime Logs expose request metadata including the path, search parameters, user
agent, status, region, and request identifier. Vercel also uses IP address and user-agent
data to identify requests from the current browser. Base Pro without Observability Plus
has one-day Runtime Logs retention; Observability Plus raises it to 30 days. The public
documentation provides no per-route switch that disables or redacts this
hosting-provider-generated telemetry.

Vercel's Data Processing Addendum distinguishes Customer Data, for which Vercel acts as
a processor, from personal data in Service-Generated Data, for which Vercel acts as a
controller. The current DPA allows Vercel to use Service-Generated Data and Contact Data
to operate, improve, and support the service and for purposes that include analytics,
benchmarking, reporting, and marketing or service-related messages; it does not map each
purpose to each Runtime Logs field. These provider-defined purposes are a documented
trade-off of the selected host and cannot be narrowed by application code. The project
owner separately accepted these purposes on 2026-08-04.

This ADR therefore does not classify all hosting-provider telemetry as processor data or
assume that the Runtime Logs product's one-day retention defines the lifecycle of all
Service-Generated Data. The applicable role, purposes, and lifecycle are documented from
the current provider terms at implementation time. A material expansion beyond this
recorded boundary triggers a revisit before launch.

## Decision

**Use Vercel Pro as the reference production host, provisioned directly in a
customer-owned Vercel team.**

Keep the application boundary on standard Next.js APIs so Azure App Service, Azure
Container Apps, or another full Node.js host remains a feasible exit target.

This acceptance selects the maintained reference path and the privacy boundary above. It
does not provision an environment or authorize a DNS change.

### 1. Ownership and portability boundary

- The customer controls the deployment repository, Azure DevOps project and Pipeline,
  CI service connection and secret store, Vercel team and project, billing relationship,
  production domain association, environment variables, and provider integrations from
  the first Preview deployment.
- Customer-controlled accounts require multi-factor authentication. Production promotion
  and rollback require an owner-controlled approval. Maintainer access is least-privilege
  and time-bounded; it is removed or explicitly renewed at handoff.
- The domain registration and authoritative DNS account remain customer-owned outside
  Vercel. Vercel receives only the records needed to serve the site. An exit therefore
  needs a controlled DNS cutover, not a registrar or nameserver transfer.
- Deployment credentials are customer-specific, stored only in trusted CI jobs, and
  rotated or revoked during handoff. Forked or otherwise untrusted branches never receive
  Preview, Production, provider, or protection-bypass secrets. Credentials are never
  committed and never reused by another clone.
- The repository uses Next.js Route Handlers, `next/image`, and Next.js cache APIs rather
  than Vercel-only runtime SDKs. A provider-specific dependency requires a new justified
  decision.
- A Vercel project transfer is a recovery path, not the normal handoff. Vercel can move
  deployments, domains, configuration, and most environment variables between teams,
  but logs, drains, and integrations do not all transfer. Direct customer ownership
  avoids that incomplete boundary.

### 2. Runtime and region

- Run Next.js on the Node.js runtime. AB#116 pins the same supported Node major in CI and
  Vercel rather than relying on a moving platform default.
- Configure the function region as Stockholm (`arn1`) for the first Finnish production
  site. Static assets remain globally CDN-distributed. This is a latency choice, not a
  promise that every platform datum remains in Sweden or the EU.
- Use one configured compute region for the MVP. Vercel may execute multiple function
  instances within the platform; the application must therefore never depend on process
  memory or local disk for shared state.

### 3. Preview, promotion, and rollback

- Azure Pipelines remains the quality gate. AB#116 adds deployment only after lint,
  browser-free tests, production build, and the required Playwright journeys pass.
- Pull Preview-scoped variables and create an immutable Preview deployment for review.
  Use its generated Vercel URL, not a custom preview domain. Vercel adds
  `X-Robots-Tag: noindex` to ordinary Preview deployments; the pipeline must assert the
  header before publishing the URL.
- Enable Vercel Authentication with Standard Protection so Preview and generated or
  non-current Production URLs require access while the current production domain remains
  public. CI supplies the automation bypass only as a server-side request header from a
  trusted secret; it never puts the bypass value in a URL. AB#116 verifies both access
  protection and `noindex` because neither replaces the other.
- Keep Preview and Production CMS, contact-delivery, webhook, and site configuration
  separate. Preview uses the published CMS perspective for the release-candidate journey.
  It sends contact tests only to a non-production sink using synthetic data. A later
  authoring draft preview must also remain authenticated, use explicit `no-store`
  behavior, and never put drafts into a public cache.
- Disable automatic assignment of production domains. In AB#18, after the launch gates
  pass, create a staged Production build with Production-scoped variables and without
  assigning the production domain. Smoke-test that exact deployment, require owner
  approval, and then promote the same build without rebuilding it.
- Roll back by repointing production to the last known-good Production deployment.
  This reactivates that deployment's build and runtime configuration, including the
  environment-variable values captured for it. It does not roll back Sanity content,
  email-provider state, or other external systems. The runbook rejects a target whose
  credentials are expired or compromised, verifies external contracts, and invalidates
  affected cache tags. Secret rotation requires a new deployment; an older deployment is
  not a safe rollback target merely because its code is known-good.

### 4. Cache and revalidation

- Production Sanity reads use the explicit published perspective and Next.js cache tags.
  AB#83 owns the tag map, bounded broad fallback, request validation, replay behavior, and
  exact cache API calls.
- The signed webhook carries its signature in a request header, never in the URL. It is
  POST-only, bounds the raw body, verifies the signature over those exact bytes before
  parsing, validates the expected project/dataset and payload schema, and fails closed.
  Duplicate, replay, and out-of-order state is not held only in process memory. Secret
  rotation is coordinated between Sanity and Vercel. Logs contain only a server-generated
  correlation identifier, outcome, and redacted error class.
- On Vercel, use the managed Next.js Data Cache and ISR integration. Do not add an
  application-owned cache handler for the reference deployment. Tag invalidation must be
  verified on the deployed multi-instance runtime in AB#83 rather than inferred from a
  successful webhook response or one warm process.
- Every cached public read has a finite maximum lifetime so missed webhook delivery
  eventually converges. Unpublish, delete, and public-to-private changes use hard expiry,
  not stale-while-revalidate behavior. AB#83 provides bounded reconciliation or a full
  public-cache purge runbook for a missed or failed event.
- Cache tags are stable across deployments. Promotion and rollback may reuse cached
  published data, but on-demand revalidation is scoped to the deployment and domain that
  receives it. The Sanity webhook targets the current Production domain; Preview, staged,
  and old rollback deployments are not assumed to be invalidated with it. Promotion and
  rollback run a bounded revalidation or purge against the newly current deployment and
  are never treated as content snapshots. Draft, private, contact-form, authorization,
  and signed-download responses are always excluded from the public cache.
- A move to a multi-instance self-hosted platform requires a shared cache handler and
  cross-instance tag coordination before traffic is scaled beyond one instance. A
  temporary single-instance deployment is an acceptable migration bridge, not the final
  high-availability design.

### 5. Images, logs, and secrets

- Use Vercel's `next/image` integration for public web renditions. Camera originals and
  other large files do not pass through the image optimizer or a Next.js Route Handler.
- Private media never enters the public image optimizer. Its cache is separate from the
  tagged Data Cache. A public-to-private transition revokes or replaces the public source
  URL and invokes the provider's image-cache purge procedure where available. Bytes that
  were already public cannot be made confidential retroactively; AB#108 and AB#122 must
  preserve that boundary.
- Base Pro without Observability Plus retains hosting-provider-generated request metadata
  in Runtime Logs for one day. The applicable Vercel privacy role, data categories,
  purpose, access, retention, deletion, and transfer boundary must be documented before
  launch. Broader Service-Generated Data is not assumed to be deleted with the one-day
  Runtime Logs window. Do not enable Observability Plus or add a log drain unless a
  concrete retention or incident-response need justifies the extra privacy and cost
  surface.
- Minimize access on Pro by limiting Owner, Member, and Developer seats to operators who
  need Runtime Logs; use Pro Viewer for non-operators and remove maintainer access at
  handoff. Pro does not provide project-level roles, so its residual team-wide operator
  access is part of the accepted trade-off.
- Application-generated operational events contain only a correlation identifier, state,
  and redacted error class. They exclude contact fields, webhook bodies, signed URLs,
  authorization values, secrets, and client identifiers. User-facing errors remain
  generic.
- The first-party contact flow uses a fixed POST route and carries form fields only in
  the bounded request body. It never puts form data, authorization values, or correlation
  identifiers in a path, query string, or referrer; unexpected query parameters are not
  consumed or copied into application logs.
- The contact-delivery account, recipient mailbox, abuse-control data, and their retention
  and deletion controls are customer-owned and documented. Preview uses a non-production
  delivery sink and synthetic form data.
- Store CMS, delivery-provider, and webhook credentials as environment-scoped sensitive
  variables. Production and Preview use different values. No secret is exposed through a
  `NEXT_PUBLIC_` variable, URL, build log, or client bundle.
- Platform firewall and rate controls are defense in depth. AB#12 and AB#83 still own
  method, content-type, origin/signature, size, schema, timeout, replay, and abuse
  validation at the application boundary.

### 6. Future private downloads

AB#122 will choose the private-gallery security, storage, delivery, and retention model.
This ADR records only the host constraint:

- A successful authorization may mint a short-lived, object-scoped download URL from a
  customer-owned object store. The browser downloads directly from storage; the
  application must not proxy a camera original through a Vercel Function.
- Vercel Functions have a 4.5 MB ordinary request or response body limit. Public contact
  and webhook bodies will be far smaller; full-resolution photographs commonly will not.
- Vercel Image Optimization currently limits source dimensions and optimized output size.
  The public rendition pipeline must validate against the then-current limits, while
  private originals bypass it.
- Generated ZIP archives are not assumed to fit a synchronous Function request. AB#122
  must evaluate asynchronous generation, temporary storage, duration, memory, and cleanup
  before offering bundles.
- Signed URL query tokens are never persisted in content, application logs, analytics, or
  caches. AB#122 must account for unavoidable storage/CDN request logging and token
  redaction in its provider and audit boundary.
- Storage provider, authorization policy, expiry, revocation, range requests, retention,
  and audit semantics remain explicitly undecided. No private-gallery feature is
  implemented in AB#109.

## Capability Matrix

| Required capability | Vercel Pro — selected | Azure App Service S1+ | Azure Container Apps Consumption |
| --- | --- | --- | --- |
| Next.js SSR and Route Handlers | Native Next.js deployment to Node.js Functions | Runs `next start` on managed Linux Node; framework integration is ours | Runs a standalone Next.js OCI image; container lifecycle is ours |
| AB#12 contact processing | Function supports bounded POST handler and outbound provider call; application owns all validation and redaction | Supported by the Node app; application owns validation, scaling, and redaction | Supported by the container; application owns validation, scaling, and redaction |
| AB#83 signed webhook and cache tags | Managed Data Cache/ISR supports Next.js tag invalidation across platform instances | Single instance works locally; scale-out needs shared cache plus tag coordination | Every replica has ephemeral local cache by default; shared cache plus tag coordination is required |
| Image optimization | Managed `next/image` transforms and CDN cache; usage-metered | Self-hosted optimizer consumes app CPU/disk and production needs `sharp` | Same as App Service, with ephemeral replica cache unless externalized |
| Preview and `noindex` | Standard Protection plus Vercel Authentication, generated Preview URLs, automatic `X-Robots-Tag`, and header-based CI bypass | Deployment slot or separate app; pipeline and application must add and verify access and `noindex` | The selected strict-isolation policy uses a separate Preview app; revisions can reference different secret names but all secrets remain app-scoped |
| Production promotion | Staged Production deployment promoted by domain assignment without rebuild | Warm staging-slot swap; requires Standard tier or higher | Immutable revision with explicit traffic/label move |
| Rollback | Instant alias rollback to a known-good Production deployment | Swap the previous slot back | Move traffic or label back to an inactive revision |
| Logs | Base Pro without Observability Plus retains Runtime Logs for one day; they include hosting-provider-generated request metadata, while broader Service-Generated Data follows the documented provider terms | App Service log stream; Azure Monitor/Application Insights for durable retention | Console/system logs in Log Analytics; retention and query cost are ours |
| Secrets | Sensitive variables scoped to Preview or Production; changes apply to new deployments | App settings or Key Vault references with managed identity | App-scoped secrets or Key Vault references; rotation restarts or redeploys revisions |
| Region | Stockholm function region (`arn1`), global CDN | North Europe or Sweden Central subject to SKU availability | Selected Azure region subject to current regional availability |
| Future large private downloads | Authorize in a handler, then return a direct signed object-store URL; the 4.5 MB buffered-body limit makes ordinary proxying unsuitable, and this ADR excludes a streaming proxy | Same direct-download model recommended; App Service limits and egress still apply | Same direct-download model recommended; container ingress is not the archive delivery path |

## Options Considered

### Option A: Vercel Pro

| Dimension | Assessment |
| --- | --- |
| Next.js capability fit | High — managed implementation of the framework's server, cache, image, preview, and deployment primitives |
| Operational complexity | Low — no container, shared-cache service, image optimizer, or slot orchestration to operate |
| Base cost snapshot | USD 20/month for Pro with included usage credit; commercial sites cannot rely on Hobby fair use |
| Cost variability | Image transformations/cache operations, function compute, requests, transfer, and observability can add usage charges |
| Ownership/transfer | Strong when created in the customer team; project transfer exists but omits some operational data and integrations |
| Exit | Good at source level; self-hosting adds `sharp`, shared-cache work for scale-out, image/CDN choices, and new release infrastructure |

**Pros:** smallest path to correct Next.js behavior; coherent tag revalidation;
authenticated and non-indexable previews; managed image pipeline; exact-build promotion
and fast rollback; lowest initial operational load.

**Cons:** recurring commercial plan and metered usage; managed caches and deployment
history are not exportable runtime state; base Pro Runtime Logs retention is one day;
hosting-provider-generated telemetry needs a documented privacy boundary; data
location is broader than the selected function region; full platform behavior is not
reproduced by plain `next start` without additional infrastructure.

### Option B: Azure App Service S1 or higher

| Dimension | Assessment |
| --- | --- |
| Next.js capability fit | Medium-high — one `next start` process supports the framework, but Azure supplies no Next-specific distributed cache adapter |
| Operational complexity | Medium — Node runtime, `sharp`, writable/external cache behavior, slots, logs, scaling, and optional CDN need explicit ownership |
| Base cost snapshot | North Europe Linux S1 was USD 0.095/hour, about USD 69.35 per 730-hour month, before monitoring, storage, CDN, or shared cache |
| Lower-cost caveat | Linux B1 was USD 0.018/hour, but it does not provide the deployment-slot workflow required by this decision |
| Ownership/transfer | Strong inside a customer subscription; cross-tenant or cross-region moves can require redeployment |
| Exit | Standard Node deployment is portable; Azure-specific IaC, slots, identity, logs, and cache services must be replaced |

**Pros:** customer-owned Azure subscription and billing; good Azure Pipelines integration;
managed Node runtime; Key Vault/managed-identity path; warm slot swap and swap-back;
predictable fixed compute price.

**Cons:** the comparable S1 baseline costs more before add-ons; preview noindex is ours;
scale-out makes cache correctness an application/infrastructure responsibility; image
optimization consumes the plan and needs `sharp`; package-based deployment can make the
application directory read-only and therefore needs an explicit cache design.

### Option C: Azure Container Apps Consumption

| Dimension | Assessment |
| --- | --- |
| Next.js capability fit | Medium-high — a standard OCI image can run the full Node server |
| Operational complexity | High for this site — container build, registry, probes, revisions, replica scaling, shared cache, image optimization, and logs are ours |
| Cost snapshot | North Europe active rates were USD 0.000024/vCPU-second, USD 0.000003/GiB-second, and USD 0.40/million requests before monthly grants; registry, logs, storage, and egress are separate |
| Ownership/transfer | Strong inside a customer subscription; OCI image is the most portable artifact considered |
| Preview/release | Excellent immutable revisions and traffic control; this design chooses a separate Preview app for an administrative boundary because revision secret names still resolve from one app scope |
| Exit | Best runtime-artifact portability; platform IaC, ingress, identity, logging, and cache services still change |

**Pros:** scale-to-zero option; immutable revisions; explicit traffic splitting and
rollback; OCI artifact can move to another container platform; strong customer-owned
Azure boundary.

**Cons:** most moving parts; cold-start and cache-warming trade-offs; ephemeral
per-replica storage; a distributed cache is required before scale-out; an isolated
Preview doubles resource configuration; operational work does not improve the MVP
visitor experience enough to justify it.

### Option D: Azure Static Web Apps hybrid Next.js

Rejected before final comparison. Microsoft's hybrid Next.js support remains Preview,
and the documented integration does not provide the full production image/ISR behavior
required here. Its PR environments are attractive, but a Preview framework integration
is not the reference production boundary for a real customer site.

## Trade-off Analysis

**Framework fidelity versus infrastructure portability.** Container Apps produces the
most portable runtime artifact, while Vercel supplies the most complete implementation of
the Next.js platform contract. The repository's real portability boundary is the source
and its use of standard Next.js APIs, not an unrealistic promise that every host runs the
same build with no infrastructure changes. Choosing Vercel avoids building a distributed
cache and image platform before the MVP has traffic that justifies them.

**Cost versus operational responsibility.** Vercel Pro starts at USD 20/month plus use.
App Service needs the roughly USD 69/month S1 tier for the comparable slot workflow.
Container Apps can cost less at low traffic, but its bill is workload-dependent and it
moves container, registry, cache, logging, and release engineering onto the maintainer.
For one photography site, the managed path is the simpler and currently cheaper complete
system even though individual Azure compute meters can be lower.

**Azure learning versus production priority.** Azure Boards and Pipelines remain part of
the professional delivery workflow. Hosting production on Azure would add useful AZ-400
practice, but the project's priority order puts working MVP functionality and simplicity
above portfolio breadth. The Azure options remain documented exit targets rather than
being selected for learning value alone.

**Customer control versus easy setup.** Creating the first project in a maintainer-owned
account would be faster, but it creates a later transfer with known omissions. Requiring
the customer-owned team before the first preview adds a small onboarding step and removes
the most consequential handoff risk.

**Managed cache versus migration work.** Vercel makes AB#83 materially smaller and less
risky. The cost appears at exit: cached state is rebuilt, and a scaled self-hosted target
needs shared storage and tag propagation. Cached public CMS data is disposable, so that
is an acceptable exit cost; source content remains in the customer-owned CMS.

**Application logs versus hosting-provider telemetry.** AB#12 keeps application-emitted fields
to a random correlation identifier, state, and redacted error class. The project owner
accepts necessary hosting-provider-generated request and security telemetry as a separate,
minimized, access-controlled, and documented processing boundary. Base Pro without
Observability Plus has a one-day Runtime Logs window, but that does not establish the
lifecycle of all Service-Generated Data. Vercel is the controller when personal data is
classified as Service-Generated Data; the public terms do not map every Runtime Logs
field to a DPA category. The applicable role, provider-defined purposes, access,
retention, deletion, and transfer boundary must therefore be recorded without enabling
Observability Plus or an optional long-term log drain by default.

## Consequences

**Easier**

- AB#12 and AB#83 can use ordinary Next.js Route Handlers without introducing a second
  server platform.
- Multi-instance tag invalidation, image transformation, Preview URLs, production
  promotion, and rollback are managed platform capabilities.
- The first production deployment has one customer-owned account and billing boundary.
- Azure Pipelines can stay the independent test and approval gate.

**Harder**

- Commercial production has a minimum Vercel Pro subscription and usage-based cost.
- The project must watch image, transfer, function, and log usage rather than assuming a
  fixed bill.
- Strict EU-only processing cannot be inferred from the Stockholm function setting.
- Hosting-provider-generated request and security telemetry remains an explicit processing
  boundary whose current provider terms and controls must be rechecked before launch.
- A future self-hosted scale-out requires a shared cache, tag coordination, `sharp` or an
  external image loader, and a replacement release/rollback mechanism.

**To revisit**

- A customer requires contractual data residency, private networking, or an Azure-only
  estate.
- Measured Vercel image, transfer, function, or observability cost exceeds a comparable
  Azure design including its operational services.
- Vercel no longer supports the project's pinned Next.js release or required cache APIs.
- Vercel materially expands its controller purposes, retention, or transfer boundary
  beyond the terms recorded here, or a deployment owner cannot accept those terms.
- AB#122 establishes private-download requirements that cannot be met cleanly with
  direct signed object-store URLs.
- The site needs multi-region origin failover rather than global static delivery with one
  configured function region.

## Action Items

1. [x] On 2026-08-04, the project owner accepted the application-log and
       hosting-provider-telemetry boundary.
2. [x] On 2026-08-04, the project owner confirmed the provider-defined controller
       purposes recorded above and accepted Vercel Pro as the reference host.
3. [ ] AB#116 provisions the project directly in the customer-owned Vercel Pro team,
       configures `arn1`, requires MFA and time-bounded roles, separates Preview and
       Production values, keeps Observability Plus disabled, limits Runtime Logs to the
       minimum Owner, Member, and Developer seats, uses Pro Viewer for non-operators,
       records the current provider terms and telemetry settings, and leaves registrar
       and authoritative DNS ownership with the customer.
4. [ ] AB#116 pins the deployment CLI, enables Standard Protection with Vercel
       Authentication, keeps the automation bypass in a trusted request header, deploys
       Preview after the gates, verifies access and `noindex`, uses a synthetic contact
       sink, and records the later promotion and rollback commands.
5. [ ] AB#18 disables automatic production-domain assignment, deploys the staged
       Production build after the launch gates, identifies the rollback target and
       procedure, and promotes the exact tested build.
6. [ ] AB#83 implements published-only tagged caching and the signed webhook, then tests
       deployed invalidation propagation, finite cache lifetime, hard visibility removal,
       missed-event recovery, and the bounded broad fallback.
7. [ ] AB#108 and AB#83 document the separate image-cache invalidation and source-URL
       revocation path; private media never enters the public optimizer.
8. [ ] AB#12 implements the bounded contact handler, customer-owned delivery boundary,
       abuse controls, delivery-processor and hosting-provider-telemetry lifecycles, and minimal
       redacted operational events without persisting form content. The first-party flow
       uses a fixed POST route and keeps form data and correlation identifiers out of
       paths, query strings, and referrers.
9. [ ] AB#118 exercises rollback and, before customer handoff, documents account roles,
       billing, domains, environment ownership, credential rotation, cache recovery, and
       the DNS-based exit runbook.
10. [ ] AB#122 selects object storage and defines authorization, signed-URL expiry,
       revocation, retention, range requests, bundle generation, provider logging, and
       audit behavior before any private download is built.

## Evidence

Official documentation checked on 2026-08-03; privacy terms rechecked on 2026-08-04:

- Next.js: [deploying to platforms](https://nextjs.org/docs/app/guides/deploying-to-platforms),
  [self-hosting and multi-instance cache coordination](https://nextjs.org/docs/app/guides/self-hosting),
  [tag revalidation](https://nextjs.org/docs/app/api-reference/functions/revalidateTag),
  and [production `sharp` requirement](https://nextjs.org/docs/messages/sharp-missing-in-production).
- Vercel: [Next.js support](https://vercel.com/docs/frameworks/full-stack/nextjs),
  [environments](https://vercel.com/docs/deployments/environments),
  [Preview `noindex`](https://vercel.com/kb/guide/are-vercel-preview-deployment-indexed-by-search-engines),
  [Deployment Protection](https://vercel.com/docs/deployment-protection),
  [automation bypass](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation),
  [staged production promotion](https://vercel.com/docs/deployments/promoting-a-deployment),
  [Instant Rollback](https://vercel.com/docs/instant-rollback),
  [regions](https://vercel.com/docs/regions),
  [project transfer](https://vercel.com/docs/projects/transferring-projects),
  [Runtime Logs](https://vercel.com/docs/logs/runtime),
  [access roles](https://vercel.com/docs/rbac/access-roles),
  [Data Processing Addendum](https://vercel.com/legal/dpa),
  [Privacy Notice](https://vercel.com/legal/privacy-notice),
  [shared responsibility](https://vercel.com/docs/security/shared-responsibility),
  [environment variables](https://vercel.com/docs/environment-variables),
  [Function limits](https://vercel.com/docs/functions/limitations),
  [Image Optimization limits and pricing](https://vercel.com/docs/image-optimization/limits-and-pricing),
  and [Pro pricing](https://vercel.com/pricing).
- Azure App Service: [Node.js configuration](https://learn.microsoft.com/en-us/azure/app-service/configure-language-nodejs),
  [run from package](https://learn.microsoft.com/en-us/azure/app-service/deploy-run-package),
  [deployment best practices and slots](https://learn.microsoft.com/en-us/azure/app-service/deploy-best-practices),
  [logging](https://learn.microsoft.com/en-us/azure/app-service/troubleshoot-diagnostic-logs),
  and [Key Vault references](https://learn.microsoft.com/en-us/azure/app-service/app-service-key-vault-references).
- Azure Container Apps: [revisions](https://learn.microsoft.com/en-us/azure/container-apps/revisions),
  [storage behavior](https://learn.microsoft.com/en-us/azure/container-apps/storage-mounts),
  [logging](https://learn.microsoft.com/en-us/azure/container-apps/log-monitoring),
  [secrets](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets),
  and [billing](https://learn.microsoft.com/en-us/azure/container-apps/billing).
- Azure Static Web Apps: [hybrid Next.js support](https://learn.microsoft.com/en-us/azure/static-web-apps/nextjs).
- Sanity: [webhooks](https://www.sanity.io/docs/content-lake/webhooks) and
  [webhook best practices](https://www.sanity.io/docs/content-lake/webhook-best-practices).
- Azure prices: [Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices),
  queried in USD with `armRegionName eq 'northeurope'`, `type eq 'Consumption'`,
  and the product, SKU, and meter shown below.

| Product | SKU and meter | Unit price | Effective from |
| --- | --- | --- | --- |
| Azure App Service Basic Plan - Linux | B1 / B1 | USD 0.018 per hour | 2019-06-01 |
| Azure App Service Standard Plan - Linux | S1 / S1 App | USD 0.095 per hour | 2018-05-11 |
| Azure Container Apps | Standard / Standard vCPU Active Usage | USD 0.000024 per second | 2022-06-01 |
| Azure Container Apps | Standard / Standard Memory Active Usage | USD 0.000003 per GiB-second | 2022-06-01 |
| Azure Container Apps | Standard / Standard Requests | USD 0.40 per million | 2022-06-01 |

## What this ADR does not establish

- No production or preview resource has been created.
- No production promotion, DNS change, or customer handoff has been performed.
- No Vercel, Azure, Sanity, storage, email, domain, DNS, or customer account has been
  changed. Azure Boards changes are limited to AB#109's state and AB#12's acceptance
  criteria.
- No deployment pipeline, cache handler, webhook, contact endpoint, private gallery, or
  download flow has been implemented.
- No load, failover, cache-propagation, image, or rollback measurement has been run.
  Cache propagation is verified in AB#83, Preview and `noindex` in AB#116, production
  promotion in AB#18, and exercised rollback in AB#118.
- This record accepts a product requirement and architecture boundary; it is not a legal
  compliance conclusion. Each deployment owner remains responsible for its privacy
  notice, processing record, provider terms, and applicable legal review.
- No private-storage provider or strict data-residency commitment has been selected.
