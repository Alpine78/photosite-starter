# Deployment: the Preview environment and release candidates

How a release candidate reaches a testable URL, who owns the infrastructure it runs on,
and which settings differ between Preview and Production.

The proposed [release and compatibility policy](release-policy.md) covers source
version identifiers, changelog entries, migrations, and support windows. This
document covers deployment operations.

This covers the **Preview environment only**. Production promotion (AB#18), exercised
rollback and customer handoff (AB#118), and legacy URL redirects (AB#19) are separate
work items. The promotion and rollback commands are recorded here because ADR-0004 §3
requires them decided before the first deployment — but nothing in this repository
performs them, and no custom production domain or DNS record exists yet. (A
production-target deployment on the project's `*.vercel.app` address does exist: see
"A production-target deployment exists" below.)

The reference host and the reasoning behind it are
[ADR-0004](adr/0004-reference-production-host-and-ownership-boundary.md). This document
is the operational half: what to create, what to set, and what the pipeline does with it.

## Application maintenance boundary (AB#341)

`SITE_MAINTENANCE_MODE` is a server-only deployment-generation setting. Absent,
empty or `off` preserves normal operation; `on` enables the boundary. A nonempty
unknown value or a populated `NEXT_PUBLIC_SITE_MAINTENANCE_MODE` fails closed with
the same generic response. Do not publish a browser mirror. Changing a deployed
generation requires the host's verified deployment/restart procedure; there is
no CMS switch, public toggle, bypass cookie, bypass query or bypass header.

The boundary returns `503`, `Cache-Control: no-store`, `Retry-After: 60`, no cookies,
and the existing security headers before ordinary configuration/content reads or
API handlers. Pages have bounded, scriptless Finnish/English recovery text; APIs
retain `{ "status": "failed", "retryable": true }`. Responses also use
`noindex, nofollow` and `no-referrer`, covering custom reserved namespaces without
reading their normal configuration. Existing legacy redirects and dynamic
metadata temporarily return the same maintenance response. Monitors also see
503; this setting has no timer and never automatically reopens the site.

Actual static files, the public image optimizer, direct Sanity/CDN URLs and bytes
already delivered to a browser remain available. This is no privacy or revocation
mechanism. While enabled, application-served static files and missing candidates receive
no-store/noindex/no-referrer; their bytes remain unchanged. This temporary
conservative policy prevents missing versioned asset paths inheriting immutable
cache headers before the fallback503. It does not evict previously cached bytes.
Ordinary disabled operation preserves the existing asset cache policy. The public
image optimizer retains its own cache policy; it is outside the content gate.
Deploying this source adds a Proxy invocation for every asset request even when
maintenance is off; immediate pass-through preserves responses and cache behavior,
not invocation count. Exact hosted latency and any billing effect are unmeasured
and belong in the deployment review, independently of later maintenance activation.
See the [dated matcher amendment](adr/0007-proxy-request-path-boundary.md#2026-10-18-maintenance-matcher-amendment-ab341).
Proxy matches every path but lets file-shaped candidates proceed to
Next's exact static-file check. A private request marker, always removed/replaced
by Proxy, selects an `afterFiles` rewrite for missing candidates before the dynamic
catch-all. Metadata names are compared after the same single percent-decoding as
Next's filesystem lookup, so encoded spellings cannot evade the early response.
The tiny fallback handler reads no content. This closes the distinction
between an actual static file and a missing `/gallery/…`, `/_next/…` or root file
that would otherwise execute the content fallback. Normal operation preserves
the old asset exclusions' pass-through behavior.

Source implementation is not operational approval. Before any separately approved
window, verify the exact hosted routing adapter, CDN and real content-cache layers,
all application and old Preview generations, old write clients, routing/metadata
variants and response headers. Some framework canonicalization redirects precede
Proxy; verify that their destinations are gated without content or write work.
Local `next start` cannot prove a hosting adapter's rewrite or cache ordering.

Follow [ADR-0031](adr/0031-identity-migration-operational-plan.md): accept the writer
freeze, rehearsal, measured rollback reserve and actual window separately. Verify
the coherent reader generation and all-public cache invalidation **before** reopening.
The public `/api/revalidate` endpoint is itself gated; verify an out-of-band or new
generation invalidation procedure rather than adding a public bypass. That actual
host procedure remains an activation prerequisite. On an uncertain/failed migration,
keep maintenance active until a verified unchanged state or guarded rollback and
compatible reader have been established. Reopening requires the explicit operator
checkpoint; changing the flag to `off` is not proof of dataset or cache coherence.

The production journey restarts one unchanged build with harness-owned settings:
it warms generated `robots.txt`, proves an off-state prepared poll write, then
checks the enabled generation's page/API/metadata responses and absence of the
poll-handler log. An invalid content-source control catches fallback reader entry;
actual static bytes remain equal with the enabled conservative cache policy. This establishes the tested local
generated-response boundary, not Sanity Data Cache/CDN invalidation or an actual
15-minute outage window. No source change activates a deployment or CMS operation.

## Legacy URL mapping verification (AB#19)

The first-site mapping is deployment configuration in `src/lib/legacy-redirects-data.ts`;
the source inventory and undecided/excluded/already-live classifications live beside it.
The reusable engine rejects invalid sources, duplicate decisions, self-redirects, and
targets that are other legacy sources. No target is inferred from a legacy slug.

**2026-10-18 canonical-host checkpoint:** all 415 rows passed on the current
Production host with before/after source-identity guards; four JavaScript-free
FI/EN Chromium/WebKit cases verified the visible localized fallback notice and
metadata. [The dated audit](audits/ab19-canonical-production-verification-2026-10-18.md)
records the identified release, attached report, timing and limits. AB#137 and
owner acceptance remain open; this does not approve launch or change mappings.

Export its complete, offline JSON report with:

```bash
npm run --silent verify:legacy-redirects -- report > /tmp/legacy-mapping.json
```

The report distinguishes the full crawl's 442 URL records (the AB#19 attachment) from the
415 path/status observations committed here. Counts and classifications are calculated
from the mapping: currently 232 redirects, 179 justified `410` responses, no pending
decisions, three excluded error paths, and one already-live root. A duplicate, unaccounted,
or non-inventory source fails report generation. Successful export proves bookkeeping;
it does not prove target availability or approve launch.

At the 2026-10-09 checkpoint, the service slice added twelve direct rows for ADR-0021's seven approved
wedding-service sources and their redundant Finnish aliases. All seven targets answered
200 with the expected language and canonical metadata on the activated renderer; the
fresh Joomla backup binds each source to its published menu identity. These rows are
prepared and not yet deployed at that checkpoint; other package/service decisions
and post-import rows were still open then. The October 18 checkpoint above records
today's full registry result. See the [service redirect audit](audits/ab19-service-redirects-2026-10-09.md).

Check a production build or candidate with the intended locale configuration and content:

```bash
npm run --silent verify:legacy-redirects -- check https://candidate.example.test https://site.example.test > /tmp/legacy-check.json
```

The first argument is the serving origin. The optional second argument is the canonical
origin from `SITE_CANONICAL_BASE_URL`; it defaults to the serving origin. Supply it when a
candidate serves a site's canonical URLs from a different hostname. HTTP is allowed only
on loopback for a local production build, e.g. `http://127.0.0.1:3000`. Neither argument
may contain a credential, path, query, or fragment. This tool sends anonymous GETs only;
an access-protection challenge fails the check. It accepts no bypass secret or read token.

Every decided source is checked against its declared response: `301` with the exact
same-origin destination and fixed fallback query when applicable, `410` for justified
retirements, `404` for excluded Joomla error routes, or `200` for already-live routes.
Each distinct redirect target must answer `200` directly and emit exactly one canonical
URL matching its declared parameter-free target and the configured canonical origin.
Fallback responses must also carry `noindex`, status markup, and no language alternates.
Responses are parsed without executing scripts or fetching media. GETs have a 20-second
timeout and HTML reads a 4 MiB limit; redirects are never followed. Reports retain numeric
statuses and fixed issue codes, without response bodies or raw network error messages.

Pending paths are reported but never accepted as successful `404` decisions. Check mode
exits nonzero if any pending decision or failed probe remains. There is no option to waive
pending rows. This command complements the existing CI registry tests and target
allowlists; it is an owner-run check, not a live-network CI job. The generic mock browser
harness proves redirect and localized accessible fallback mechanics, not the first site's
imported targets. Case-sensitive exact matching, the existing trailing-slash normalization,
per-row `cursor`/`section` policy, and byte-preserved unrelated queries are unchanged;
fragments remain browser-held state and are not sent in these HTTP requests.

AB#19 remains **Active**. AB#137's migration and reviewed same-language target/fallback
decisions must precede final production-target verification. This tooling slice is not
evidence that the decided paths meet AB#19's acceptance criteria or that a phased launch
manifest has been approved. Attach the final check report to AB#19 after migration, before
AB#117/AB#18's launch gates.

## Ownership

**The site owner owns the hosting account outright**, on the same terms as the CMS
(see [`sanity-setup.md`](sanity-setup.md)):

- The **Vercel team, project, billing relationship, environment variables, and domain
  association** belong to the photographer, in their own Vercel account. There is no
  shared cross-customer team, project, or credential.
- **The domain registrar and authoritative DNS stay outside Vercel**, in the owner's own
  account. Vercel receives only the records needed to serve the site, so leaving is a
  controlled DNS cutover rather than a registrar transfer.
- **Customer-controlled accounts require multi-factor authentication.** Maintainer access
  is least-privilege and time-bounded, and is removed or explicitly renewed at handoff.
- **Nothing in this repository names a team, project, token, or domain.** Deploying a
  clone somewhere else means pointing a different set of pipeline variables at a
  different project; no code changes.
- A Vercel **project transfer is a recovery path, not the handoff plan**. Deployments,
  domains, and most environment variables move between teams, but logs, drains, and
  integrations do not all follow. Creating the project in the owner's team from the start
  avoids that incomplete boundary.

## Provisioning runbook

Vercel's console changes; their own [documentation](https://vercel.com/docs) is
authoritative for the exact clicks. What this project needs from it:

1. **Create the scope in the owner's own Vercel account.** Enable MFA on the account
   before anything else.

   **Plan tier depends on how the deployment is actually used, not on this template.**
   A commercial site — one that advertises a paid product or service, processes payment,
   accepts donations, carries ads, or pays anyone involved in producing it — cannot rely
   on Hobby fair use and needs Pro or Enterprise; that requirement is unchanged and
   applies to essentially every clone of this starter, including this repository's own
   eventual Production deployment.

   **This reference deployment's Preview environment currently runs on Hobby.** That is
   not automatically fine just because it's Preview and not Production: Vercel's
   fair-use rule turns on the deployment's purpose of financial gain, not on whether it
   is labeled Preview or Production, and this repository's dual purpose as a
   professional software portfolio leaves that question genuinely open for the current
   usage too — the owner keeps Hobby in use for development, accepting this as an open
   interpretation risk rather than a settled one. **The Production tier is a separate,
   still-open decision**, not something this document or ADR-0004 has settled:
   [ADR-0004](adr/0004-reference-production-host-and-ownership-boundary.md)'s Decision
   (Pro) remains the current plan for Production, and its 2026-08-25 amendment records
   the observed Hobby/Preview divergence without granting a Production exception. The
   choice — stay on this ADR's original Pro plan, or bring Hobby into Production too —
   will be made immediately before AB#18. Vercel Support's explicit confirmation would
   give certainty for the current Preview usage too, and becomes mandatory specifically
   if Hobby is chosen for Production; choosing Pro for Production needs no such
   confirmation, though it would not retroactively resolve whatever period was spent on
   Hobby beforehand.

   ADR-0004 §1 says "team" because it assumes the common case: the developer builds the
   site for a photographer, and the account has to belong to the photographer rather than
   to whoever wrote the code. When the site owner and the developer are the **same
   person**, that requirement is met by the owner's own **one-person team** — which is
   what Vercel's default scope already is, on either tier; Pro is billed per team and
   includes one deploying seat, so a Pro clone needs no second paying member either. A
   clone built for someone else needs a team owned by them, created before the project,
   because a later project transfer leaves logs, drains, and some integrations behind.

2. **Create the project empty — do not connect the Git repository.** This is the one
   step where the obvious path is the wrong one. The dashboard's "Add New → Project" flow
   is built around importing a Git repository, and a connected Git integration deploys on
   every push — putting a deployment on the internet _before_ lint, tests, the build, and
   the Playwright journeys had run. Azure Pipelines is the gate (ADR-0004 §3), and it
   deploys through the CLI, so the project needs no Git connection at all. Use the CLI,
   which is also what the provider's own Azure Pipelines guidance recommends:

   ```bash
   npm ci
   ./node_modules/.bin/vercel login
   ./node_modules/.bin/vercel project add photosite-starter
   ```

   The exact CLI version is pinned in `package.json` and `package-lock.json`; the
   Azure Preview job uses this same local installation after `npm ci`. Do not run
   `vercel deploy` from a local checkout as a routine: it would create a deployment that
   skipped every gate. The one exception is the gated manual release in "When the
   pipeline cannot deploy" below.

3. **Leave the region and Node version alone.** `vercel.json` pins the function region to
   Stockholm (`arn1`) and `package.json` `engines` pins Node to the major named in
   `azure-pipelines.yml`. Both override the dashboard, deliberately: the repository is
   where a reviewer can see them, and a platform default that moves with each LTS release
   is exactly what the pin exists to stop.

4. **Enable Deployment Protection: Standard Protection with Vercel Authentication.**
   Preview deployments and generated or non-current Production URLs then require a signed-in
   team account, while the current production domain stays public once it exists.

5. **Generate Protection Bypass for Automation** and keep the secret. The pipeline sends
   it as a request header so the verification step can read what a reviewer would see.

6. **Choose the stable Preview integration alias** (AB#136). Pick an unused
   `<name>.vercel.app` host — for example `<project>-preview.vercel.app` — that the
   pipeline will repoint at each verified Preview deployment so a webhook configured once
   keeps working across ordinary redeploys. It must be a `*.vercel.app` host, not a custom
   domain: Standard Protection "protects all domains except production domains" on every
   plan, so a `*.vercel.app` alias inherits Vercel Authentication, while a custom domain's
   protection posture is not guaranteed. (Vercel omits its automatic `X-Robots-Tag:
   noindex` for any assigned domain or alias; `next.config.ts` supplies it for this host —
   see [The stable Preview integration alias](#the-stable-preview-integration-alias).)
   This alias is
   **not** the human review URL — reviewers still open the generated, per-deployment URL
   from the run summary — and it must never be added to the project as a Production
   domain. The pipeline creates the alias on its first run; there is nothing to register
   in the Vercel dashboard beforehand. Its value goes in the variable group as
   `PREVIEW_STABLE_ALIAS` (step 10). See
   [The stable Preview integration alias](#the-stable-preview-integration-alias).

7. **Nothing to do about production-domain assignment — it is a deploy-time flag, not a
   project setting.** ADR-0004 §3 requires that a production build never take the
   production domain merely by being deployed. Vercel expresses that as
   `vercel deploy --prod --skip-domain`, which AB#18's promotion sequence below already
   uses; there is no switch to turn off here, and no custom domain exists yet anyway.

   Leave the project's default `<project>.vercel.app` domain connected to **Production**,
   where Vercel puts it. Do not repoint that default domain at Preview and do not remove
   it. A release candidate is **reviewed by a person** at the generated, per-deployment
   URL the pipeline publishes, never at a stable preview domain (ADR-0004 §3). The
   `PREVIEW_STABLE_ALIAS` from step 6 is a different thing: a dedicated, access-protected,
   `noindex` address for **machine integrations only**, repointed by the pipeline solely
   after a deployment has passed the same two publication checks, and re-verified on every
   repoint (ADR-0004 §3, 2026-08-31 amendment).

8. **Set the Preview-scoped environment variables** from the table below. Scope them to
   Preview only — Production values are set in AB#18, and the two must never be one set.

9. **Create a deployment token** scoped to the team, and read the team (org) id and
   project id. Linking the checkout writes both to a local file:

   ```bash
   ./node_modules/.bin/vercel link --yes --project photosite-starter
   cat .vercel/project.json      # orgId and projectId
   ```

   `.vercel/` is gitignored, so nothing here reaches the repository.

10. **Create the variable group** `photosite-starter-vercel-preview`, authorize only this
    pipeline to use it, and add the values from the table below. Create the group with
    `PREVIEW_DEPLOYMENT_ENABLED=false` first; the YAML must be able to resolve the
    protected resource before any branch containing its reference is merged. Add and
    verify every other value — including `PREVIEW_STABLE_ALIAS` (step 6), which the deploy
    stage now treats as required — then change the flag to `true`. Do not grant open
    access to all pipelines. Finally, on the group's **Approvals and checks** tab, add an
    **Exclusive lock** check: the `DeployPreview` stage declares `lockBehavior:
    sequential`, and the lock only engages because the stage consumes this group, so two
    `DeployPreview` runs never repoint the alias at the same time. (Serializing execution
    is not the same as ordering by commit — see the known limitation in
    [The stable Preview integration alias](#the-stable-preview-integration-alias).)

11. **On Pro, keep Observability Plus disabled** and limit Owner, Member, and Developer
    seats to the people who need Runtime Logs; everyone else gets Pro Viewer. Both are
    privacy decisions, not cost ones, and remain the plan for Production, which is
    still on this ADR's Pro Decision. **On Hobby — Preview's currently observed
    tier — neither applies today**: Observability Plus isn't offered to enable at all,
    and Hobby has no RBAC roles to configure at all. Separately, the live team was
    checked 2026-08-25 and found to have exactly one member, role `OWNER` — so there is
    currently no excess access to remove, not because Hobby's lack of RBAC causes that,
    but because that is simply what the live check found. Hobby's fixed one-hour Runtime Logs
    retention is itself the tightest posture Vercel offers below Pro. Whether Production
    ends up on Pro or Hobby is unresolved and will be decided before AB#18 — if Pro, the
    policy above applies directly there; if Hobby, re-read
    [ADR-0004](adr/0004-reference-production-host-and-ownership-boundary.md)'s
    2026-08-25 amendment for what that would require. See
    [Logs and telemetry](#logs-and-telemetry).

The group exists before its credentials do, so provisioning can remain incomplete without
reddening `main`: the deploy stage skips while `PREVIEW_DEPLOYMENT_ENABLED=false`. Turning
that flag on is the explicit handoff from provisioning to the first release-candidate run.
`PREVIEW_STABLE_ALIAS` is required from that point on — a Preview deployment that does not
also maintain the durable webhook alias is the regression AB#136 exists to prevent — so
add it to the group **before** flipping the enable flag. If Preview is already enabled and
this is being added later, expect the deploy stage's "Check deployment configuration" step
to fail by name until the variable is set.

## Pipeline variables

Store these in the customer-owned `photosite-starter-vercel-preview` variable group.
Secret variables must be marked secret; Azure Pipelines masks them in logs and passes
them to a step only where the YAML names them explicitly in an `env:` block. The group is
a protected resource, is authorized only for this pipeline, and is referenced only from
the deployment stage rather than the quality gates.

| Variable                          | Secret | Purpose                                                               |
| --------------------------------- | ------ | --------------------------------------------------------------------- |
| `PREVIEW_DEPLOYMENT_ENABLED`      | no     | `false` during provisioning; `true` deliberately enables the stage.   |
| `VERCEL_ORG_ID`                   | no     | Team expected to own every deployment the pipeline handles.           |
| `VERCEL_PROJECT_ID`               | no     | Project expected to own every deployment the pipeline handles.        |
| `VERCEL_TOKEN`                    | yes    | Team-scoped deployment/API credential, rotated or revoked at handoff. |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | yes    | Lets the verification probe — and the alias probe — read the protected deployment. |
| `PREVIEW_STABLE_ALIAS`            | no     | Bare `*.vercel.app` host the pipeline repoints at each verified Preview deployment so a webhook configured once keeps working (AB#136). Required once `PREVIEW_DEPLOYMENT_ENABLED=true`. Also passed into the `vercel build` step: `next.config.ts` bakes this host's `X-Robots-Tag: noindex` rule at build time. |
| `SANITY_BUILD_READ_TOKEN`         | yes    | Read-only Preview credential used only while a private dataset is prerendered; omit for a public dataset. |

The GitHub service connection that supplies this repository to Azure Pipelines is also
customer-controlled and remains the pipeline's source connection. Vercel authentication
is intentionally not represented as an Azure service connection: Vercel's supported
Azure Pipelines interfaces accept a team-scoped access token as a secret variable, and
the CLI used here needs that token for `pull`, `build`, `deploy`, and the authenticated
deployment API. Inventing a generic service connection would not make that credential
available to those commands; it would add an unused second resource. The accepted
ownership boundary is the customer-owned source connection plus this least-privilege
deployment secret store — recorded as the
[2026-08-12 amendment to ADR-0004 §1](adr/0004-reference-production-host-and-ownership-boundary.md)
and on AB#116.

## Environment variables

These live in the **Vercel project**, scoped per environment, not in the pipeline and not
in this repository. `vercel pull --environment=preview` fetches the Preview set at build
time; the Production set is never fetched by the Preview job.

| Setting                                        | Preview                                              | Production (AB#18)                      |
| ---------------------------------------------- | ---------------------------------------------------- | --------------------------------------- |
| `SITE_DEPLOYMENT_STAGE`                        | `preview`                                            | `production`                            |
| `SITE_CONTENT_SOURCE`                          | `sanity` for the reference Preview; `mock` remains valid for isolated fixture previews | `sanity`                                |
| `SITE_LOCALE`, `SITE_LOCALE_ROUTES`            | same as production                                   | the launch route contract               |
| `SITE_CANONICAL_BASE_URL`                      | a fixed non-production origin — see below            | the production origin                   |
| `SITE_DEFAULT_SOCIAL_IMAGE` and its dimensions | same as production                                   | the launch social image                 |
| `SITE_ROBOTS_DISALLOWED_AGENTS`                | unset (Preview's `robots.txt` already disallows everyone) | optional: crawlers to keep off the whole site — see below |
| `SITE_ANALYTICS`                               | unset (a `preview` stage ignores it)                 | unset, or `vercel` once the owner enables page-view statistics — see below |
| `SITE_SPEED_INSIGHTS`                          | unset (a `preview` stage ignores it)                 | `vercel` on the reference deployment since 2026-10-20 (AB#376); unset for a clone until it runs the same checks — see below |
| `CONTACT_DELIVERY_ADAPTER`                     | `sink`                                               | `resend`                                |
| `CONTACT_DELIVERY_FROM`, `CONTACT_DELIVERY_TO` | unset                                                | the owner's verified sender and mailbox |
| `RESEND_API_KEY`                               | unset                                                | Production-only secret                  |
| `GALLERY_CURSOR_SIGNING_KEY`                   | one stable Preview secret                            | a separate, stable Production secret     |
| `SANITY_PROJECT_ID`, `SANITY_API_VERSION`      | same project, pinned version                         | same                                    |
| `SANITY_DATASET`                               | a Preview dataset                                    | the production dataset                  |
| `SANITY_DATASET_VISIBILITY`                    | that dataset's actual visibility                     | that dataset's actual visibility        |
| `SANITY_READ_TOKEN`                            | a Preview runtime token in Vercel, required if private | a separate Production runtime token in Vercel, required if private |
| `SANITY_WEBHOOK_SECRET`                        | one stable Preview secret                            | a separate, stable Production secret    |

**Site analytics (AB#371, ADR-0037).** `SITE_ANALYTICS=vercel` loads Vercel Web Analytics and
is honored only on a `production` stage; Preview ignores it even if the value is copied across.
It is a build-time setting, so changing it takes effect on the next build. Enabling it also needs
the Web Analytics switch in the Vercel dashboard (included in Pro, billed per event from the
shared monthly credit) and a notify-only Spend Management threshold. The processing record is
[analytics-data-flow.md](analytics-data-flow.md).

**Speed Insights (AB#376, ADR-0037 amendment).** `SITE_SPEED_INSIGHTS=vercel` loads Vercel
Speed Insights under the same rules: production stage only, build-time, so enabling or
disabling it needs a rebuild and redeploy. It also needs Speed Insights enabled for the
project in the Vercel dashboard (free tier: Real Experience Score only, 10,000 events per
rolling 30 days shared across the team). Keep it unset until the checks in
[analytics-data-flow.md](analytics-data-flow.md#speed-insights-ab376) pass. The reference Production
environment sets it to `vercel` from 2026-10-20.

**Site-search route (AB#299, ADR-0033).** The fifth field of a `SITE_LOCALE_ROUTES` entry
is the locale's search namespace and defaults to `search`, so a deployment whose value
lacks it publishes `/search` and `/en/search`. The launch contract is
`fi||tarinat|palvelut|haku,en-GB|en|stories|services|search` (the English entry's locale
is `en-GB`, its prefix `en`), which publishes the Finnish page
at `/haku` as ADR-0003 reserved. The setting is read at build time: changing it in the Vercel
project is an owner-run operation that takes effect on the next build, for both Preview and
Production, and the Production value is not changed by this repository's pull request.
The owner set the Production value above on 2026-10-16 (previously
`fi||tarinat|palvelut,en-GB|en|stories|services`), and the same day's release of merged
source `6cdc231` published `/haku` and `/en/search`; that release was staged with
`--skip-domain`, smoke-tested on its protected URL and then promoted, with the previous
deployment `photosite-starter-35iy29v0b` as the rollback target.

Two of these are safeguards rather than preferences. `SITE_CONTENT_SOURCE=mock` is
**refused outright** in a production deployment, and so is `CONTACT_DELIVERY_ADAPTER=sink`:
publishing the project's demo photographs as a photographer's own work, or accepting an
enquiry that is silently discarded, are failures worth failing the build over. Preview is
where both are legitimate — its contact tests go to a sink, with synthetic data, and never
to the owner's mailbox.

`SITE_ROBOTS_DISALLOWED_AGENTS` (AB#181) is a comma-separated list of crawler tokens that
production `robots.txt` disallows from the whole site, for crawlers that bring no visitors
but spend the plan's request, CPU, and image-optimization allowances. The reference
deployment's first candidates come from the legacy site's 2026 statistics, where SEO-tool
crawlers outweighed human traffic: `SemrushBot,AhrefsBot,DotBot,MJ12bot`. Each crawler's
own published token is what goes in the list. Unset leaves `robots.txt` exactly as it was.
This is guidance only: a crawler that ignores `robots.txt` needs a Vercel Firewall rule
instead. `robots.txt` is prerendered at build time, so a change takes effect with the next
deployment.

Every content schema and adapter is now present, and AB#135 wires the public route-facing
seams to dispatch on this setting. The reference Preview uses `sanity` with its seeded
Preview dataset; `mock` remains an explicit non-Production choice for local development,
CI, and isolated fixture previews.

### Sensitive variables and the prebuilt build

Vercel's **Sensitive** type makes a value non-readable after creation, and `vercel pull`
does not retrieve it — it writes the literal placeholder `"[SENSITIVE]"` into the pulled
env file. The pipeline builds on the Azure agent from those pulled values and deploys the
result prebuilt, so a Sensitive setting reaches `next build` as the string `[SENSITIVE]`
rather than its value.

That splits the table above in two, and the split is by **when the value is read**, not
by how secret it is:

| | Type | Why |
| --- | --- | --- |
| Settings the **build** reads — every `SITE_*` value, `CONTACT_DELIVERY_ADAPTER`, and — when `SITE_CONTENT_SOURCE=sanity` — `SANITY_PROJECT_ID`, `SANITY_DATASET`, `SANITY_DATASET_VISIBILITY`, and `SANITY_API_VERSION` | plain | A Sensitive value never arrives. None of them is a credential either: the canonical base URL, locale, default social image and its dimensions are all published in the page's own HTML, and the project id and dataset are visible in every image URL the site serves. |
| A credential used only by the trusted build — `SANITY_BUILD_READ_TOKEN`, when the dataset is private | Azure secret variable | The pipeline maps it to `SANITY_READ_TOKEN` only for `vercel build`. It is distinct from the runtime token, never echoed, and never deployed as an application setting. |
| Credentials only the **running** application reads — `RESEND_API_KEY`, `GALLERY_CURSOR_SIGNING_KEY`, `SANITY_WEBHOOK_SECRET`, and private-dataset `SANITY_READ_TOKEN` | Sensitive | Vercel injects the real value at request time, where the build's inability to retrieve it costs nothing. ADR-0004 §5 requires delivery and CMS credentials to be environment-scoped sensitive variables. |

`SITE_DEPLOYMENT_STAGE` marked Sensitive is the failure worth recognising: the build
rejects `[SENSITIVE]` as not one of `development`, `preview`, `production`. Loud, but
with a confusing cause.

`SANITY_PROJECT_ID` and `SANITY_DATASET` fail the same way for the same reason, and it is
worth knowing why the build wants them at all: `next.config.ts` scopes the image
optimizer's remote allow-list to this deployment's own asset path, so it needs both while
the configuration is being read. `[SENSITIVE]` is not a value Sanity would accept, and the
build says so rather than silently widening the allow-list.

**Never downgrade a credential to plain to get it through the build.** The private Sanity
credential is split by phase instead.

#### Private Sanity credentials are split by phase

A private Sanity dataset may be read twice: while authored pages are prerendered and later
by a running Function. One credential spanning both phases would either have to be made
plain in Vercel or be unavailable to the prebuilt build, so the two phases deliberately
do not share one:

- `SANITY_BUILD_READ_TOKEN` is a read-only secret in the customer-owned Azure variable
  group. The release-candidate step maps it to the application's `SANITY_READ_TOKEN` name
  only for `vercel build`; Next.js gives an existing process environment value precedence
  over the pulled `.env` file. It is never emitted, uploaded as a Vercel setting, or made
  available to a pull-request job.
- `SANITY_READ_TOKEN` is a different read-only token stored as Sensitive in Vercel. The
  running Preview or Production Functions receive it; `vercel pull` cannot reveal it to
  the build.

The build configuration requires every non-secret Sanity setting whenever the selected
content source is `sanity`. If the declared visibility is `private`, it also refuses a
missing credential, Vercel's `[SENSITIVE]` placeholder, and an unresolved pipeline macro.
The failure therefore happens before a release candidate can be produced, even while no
route happens to import a Sanity adapter. A public dataset needs neither token.

The alternatives were a permanently public Preview dataset or moving the build to
Vercel. The first would make archive locations impossible in Preview, and the second
would abandon the prebuilt artifact and its Azure build log. Phase-scoped credentials
preserve both boundaries at the cost of provisioning and rotating two read-only tokens.

### Offline whole-package integrity checks (AB#310 / AB#315)

`npm run verify:delivery-zip -- --zip /private/delivery.zip --manifest /private/entries.tsv`
is read-only: it neither extracts/writes files nor contacts Sanity or another
provider. On supported POSIX hosts the immediate parent must be owner-only
`0700`, inputs owner-only `0600`, real regular files with one link; all parent
symlinks are rejected. Inside Git, inputs must be ignored and untracked. The
command emits only fixed status/check names, counts, byte totals and SHA-256
hashes. It never prints the local paths or entry names. Keep any captured report
private too. Windows permission enforcement is not implemented and fails closed.

Supply a privately reviewed ASCII/LF TSV with this exact first line and then one
ordered entry per intended processed JPEG (the placeholders below are notation,
not literal manifest content):

```text
delivery-zip-v1
image-0001.jpg<TAB>BYTE_COUNT<TAB>LOWERCASE_SHA256
image-0002.jpg<TAB>BYTE_COUNT<TAB>LOWERCASE_SHA256
```

Use literal tab separators and a final newline. Neutral flat names are strictly
sequential `image-0001.jpg` through the intended count (`.jpeg` also supported).
The manifest is at most 65,536 bytes, with 1–256 entries. This closed syntax does
not establish who approved the supplied set. Keep original names/job records out
of the manifest and the public dataset. The tool does not rename/repackage
anything, and never modifies source JPEG bytes.

The supported container profile is deliberately narrow: single-volume ZIP32,
STORE or DEFLATE, ZIP 1.0/2.0 entries, plain DOS/Unix regular files and optional
standard signed/unsigned data descriptors. Local entries must be contiguous and
in central-directory/manifest order. Encryption, ZIP64, extra fields, comments,
paths/directories/symlinks, unknown flags/records, inconsistent headers, trailing
bytes and missing/extra/reordered entries fail closed. A valid ZIP with unsupported
extras may be refused; this is not a general-purpose ZIP reader. The archive and
total expanded bytes are each limited to 100,000,000, each member to 25,000,000;
these are local audit bounds, not measured provider or customer-package limits.
Expansion is bounded before decoding; consumed DEFLATE input, entry CRC32 and
exact expected byte lengths/SHA-256 are checked. Nothing is extracted to disk.

A successful report always says `readyToUpload: false`. It verifies the container
against the supplied byte set, **not** JPEG decoding, image/master classification,
embedded metadata suitability, owner approval, provider capacity/transport or
remote readback. Do those checks separately before a separately authorized
operation. This offline tool grants no new full-resolution public-media exception,
changes no legacy contract and adds no ZIP field/download to the current web-only
new-gallery path. No S3/PostgreSQL service is involved.

For whole packages in the hundreds of megabytes, use the separate streaming audit:

```bash
npm run verify:delivery-zip-large -- --zip /private/delivery.zip --manifest /private/entries.tsv
```

This command retains the same narrow ZIP32 profile, manifest syntax, private-file
requirements and redacted report, but permits up to **1,000,000,000 archive and
expanded bytes**. The 25,000,000-byte entry and 256-entry limits stay unchanged.
These are local engineering bounds, **not** product requirements or evidence of
Sanity upload support. Packages outside this profile are refused whole; neither
command splits, truncates or partially approves a package. The original buffered
`verify:delivery-zip` command and its 100,000,000-byte limits remain unchanged.

The streaming audit requests at most 65,536 bytes at a time, retains only bounded
central-directory metadata and uses backpressure during DEFLATE decoding. Every
archive byte is read once; the whole-file SHA-256 covers the same header, member,
descriptor, directory and EOCD bytes that were checked. A 330-second processing
deadline cancels decoding and pending adapter reads. Both source descriptors stay
open through the audit. Before reporting success, their current paths and open
files must still agree on identity, size, ownership, permissions, link count and
nanosecond modification/change timestamps. Source bytes are never changed.

The separate-process regression guard samples process-local `arrayBuffers` while
an adapter read is paused after 100 MB, before the audit and its cancellation
controller finish. It uses the same fixed GC → one `setImmediate` turn → GC
sequence for the baseline and the single asserted sample, with the original
**8,388,608-byte** limit. It does not retry, select a minimum, or measure only
after return. This lets collectible completed-read buffers settle while still
catching their retention by a shared unresolved cancellation promise. No new
runtime leak was found or fixed by AB#332. The original immediate-GC probe
reported 10,223,616 bytes in main CI #1154 and 22,186,112 bytes in an independent
full-suite run; both exceeded the guard despite the already-corrected runtime.

Validation on Node **24.20.0** used the actual revised embedded probe: four
concurrent current-runtime controls alongside two CPU workers each measured
196,608 bytes; four pre-fix controls each measured 100,253,470 bytes. The actual
105 MB test with only the probe's runtime import redirected to the old runtime
also fails specifically at the unchanged retained-bytes assertion. The pipeline
pins Node major 24; its failing run's patch version was not independently bound.
A committed Azure run is still required to confirm the CI correction.

The independent negative control uses source commit
`dda3e9eb3ca41d09df6e92dbae40f1870acadb0d` (SHA-256
`9a24b6b1acc2aae7ce6a3bad7bc91f3485d0c03ab6ce55107c2f84cb6eb73099`),
with only its relative integrity-helper import rewritten to the existing local
helper. The unchanged current streaming source hash is
`a028bfd8b7feb6abcf153bd794ce4f41dcf2efa85dbf3410a6ad528f1092e9a0`.
The synthetic 105,000,542-byte fixture hash is
`417c755b561477f95c7f2e08a7261f9f40ede41ede1f22a9b70bc16213d8843f`.
The old runtime and generated fixture remain private ignored test evidence,
not shipped application code or customer files.

The result fields `archiveBytes` and `archiveSha256` can be copied into a separately
run remote-byte verification after an independently authorized upload. A successful
local result always retains `readyToUpload: false`; it proves neither JPEG/master
classification nor metadata suitability, manifest approval, supported whole-file
upload transport or remote integrity. The owner's largest packages have been
hundreds of megabytes and must remain whole. Provider upload feasibility remains
open in [ADR-0035](adr/0035-unlisted-delivery-zip-proposal.md).

### Retained legacy customer galleries (ADR-0028)

The first production site's 21 retained legacy galleries are available through
direct `/client-gallery/<handle>` links without authentication. They use the
separate `LEGACY_GALLERY_ADAPTER=sanity` path, not the protected private-gallery
store or its `/admin` page. The adapter remains off by default for clones.
These galleries are intentionally excluded from ordinary listings, search and
the sitemap; use the customer's direct link or the owner-local approved mapping.
Keep real customer titles, handles and old paths outside the public repository.

On 2026-10-15, an anonymous published-perspective read of the configured Production
dataset found 21 gallery documents with `published == true`, 1,792 legacy image
placement documents and 12 ZIP asset documents. Anonymous GETs to all 21 handles
on the canonical production origin returned HTTP 200; each response contained
image markup and a Sanity asset URL. This establishes page availability, not
successful image/ZIP downloads or byte integrity. See the
[dated verification record](audits/ab250-release-verification-2026-10-12.md#production-readback--2026-10-15).

To check current access, read the Production dataset for published
`legacyDeliveryGallery` documents, use their `handle` values to open
`<canonical-origin>/client-gallery/<handle>`, and check the actual response and
viewer. Verify old customer URLs separately against `LEGACY_GALLERY_REDIRECTS`.
For source-byte and complete ZIP validation, use the approved private source plan
and bindings with `verify:legacy-delivery-assets --live`; an asset count or HTTP
200 page alone is insufficient. No ZIP downloads, browser interactions, old-link
redirects, response-policy headers or full launch acceptance were rechecked in
the October 15 availability pass. Public file URLs and cached bytes remain
accessible independently of page expiry as described in ADR-0028.

### Read-only whole-ZIP CDN byte check (AB#316)

For an **already existing** Sanity file asset, the standalone Node 24 command
checks complete remote bytes against the expected local package. Obtain
`archiveBytes` and `archiveSha256` from the unchanged, privately inspected
package (the offline ZIP audit uses those names), and the exact
`file-<40 lowercase SHA1 hex digits>-zip` identity from the intended project's
file asset. The project and dataset identifiers are public identifiers, not
credentials. Retain the expected declaration privately; its authority and the
file's suitability remain the owner's responsibility.

```bash
npm run verify:delivery-zip-remote -- \
  --project-id "$project_id" --dataset "$dataset_name" \
  --asset-id "$file_asset_id" --bytes "$archive_bytes" --sha256 "$archive_sha256"
```

The command makes one whole anonymous GET to the constructed own-project
`cdn.sanity.io/files/...` URL with the fixed neutral attachment name
`photographs.zip`. It accepts no arbitrary URL, credentials, custom headers,
Range, redirects or optimizer; it saves no files and never retries. Expected
SHA256 accepts either hex case and normalizes to lowercase. The new check has a
**1,000,000,000-byte local engineering limit**, not a product or provider upload
limit. Larger inputs are refused whole; packages are never split or truncated.
Normal asset-download bandwidth is consumed even though nothing is saved.

The total deadline is **330 seconds**, across response headers and body reads.
A 1 GB package requires roughly 24.3 Mbit/s payload throughput (500 MB roughly
12.2 Mbit/s), before latency and protocol overhead. A timeout/network error is
an unverified observation, not proof of corruption. HTTP 200, identity encoding,
ZIP MIME (`application/zip` or `application/x-zip-compressed`), attachment
disposition and exact Content-Length when present are required. Other headers,
including `application/octet-stream`, cause a `headers` refusal even if the
bytes could be intact. Full byte count, asset SHA1 and expected SHA256 must all
agree. A malformed declaration is refused before any request.

Exit **0** means byte agreement, **1** means an unverified observation and **2**
invalid arguments. JSON contains only a fixed result/status, limitations,
`readyToPublish: false` and a `declarationDigest`; no URL, target identity,
filename, provider body or timestamp is echoed. The digest is SHA256 of the
JSON array `["remote-zip-v1", projectId, dataset, assetId, bytes, sha256]`, using
the validated declaration and normalized SHA256. It binds supplied inputs, not
their approval. `http`, `headers`, `bytes`, `digest` and `request` are bounded
failure classes; 404 is separately absent. Do not interpret any result as ZIP
structure/JPEG/metadata validation, manifest authority, supported upload,
import approval or customer publication.

The retained legacy workflow still uses its approved source plan, review digest
and bindings with `verify:legacy-delivery-assets --live`; this standalone check
cannot replace those gates. Its shared HTTP core keeps that compiler and the
existing **3 GB** legacy declaration limit unchanged. No S3, PostgreSQL, new
service, CMS write or runtime-gallery setting is read or introduced. Current
new-gallery runtime remains web-preview-only while ADR-0035 is Proposed and
whole-upload feasibility is unresolved.

### Ongoing unlisted client galleries (ADR-0034)

The selected implementation reuses existing Sanity and the native Studio login;
no S3, PostgreSQL, custom `/admin` login or new dependency is required. New
`clientDeliveryGallery` documents are separate from retained legacy imports.
The new reader is **off by default**; this source change does not configure a
production deployment or upload/publish customer content.

| Setting | Meaning |
| --- | --- |
| `CLIENT_GALLERY_ADAPTER=off` / unset | No new galleries served; legacy adapter unchanged |
| `CLIENT_GALLERY_ADAPTER=sanity` | Requires `SITE_CONTENT_SOURCE=sanity`, `SANITY_DATASET_VISIBILITY=public` and its existing `SANITY_*` settings; real content refused in Preview |
| `CLIENT_GALLERY_ADAPTER=fixture` | Synthetic local development/CI only; refused by production/Preview deployment stages |

After accepted source merges, deploy the Studio and verify actual author/editor
permissions, FI/EN keyboard workflow and a synthetic published gallery before
separately enabling the runtime on the intended environment. Use
`<canonical-origin>/client-gallery/<handle>` (optional `?locale=fi` / `?locale=en`).
Keep `LEGACY_GALLERY_ADAPTER` and its approved mapping unchanged. A handle owned
by that mapping always follows the legacy result, including expiry or failure.
The new adapter never rescues a missing or unavailable legacy page.

Native publication, `available == true`, and either an explicit exclusive UTC
deadline or explicit indefinite access are all required. Finite new pages show
the exact UTC cutoff, including seconds and any nonzero milliseconds; indefinite
pages invent no deadline. The displayed cutoff does not promise continued access
if an editor pauses earlier, and never revokes files. Each successful read
uses a bounded, non-CDN published GROQ snapshot with measured assets, then a
fresh Doc API read as the publication/availability authority. A mismatched
revision/snapshot is retried once within one 15-second budget; persistent index
lag is a transient error, not a fabricated 404. No positive result, page body or
availability state is cached. A bounded 128-entry, 10-second absent-discovery
cache applies only to public datasets. Newly published pages can therefore be
delayed by that cache plus Sanity index propagation. Unique unknown handles
still query Sanity: this cache is not rate limiting. Each HTTP response is
limited to 1 MiB with duplicate JSON keys rejected; authored content is limited
to 256 KiB, and at most 256 complete public web images of 2048 px longest edge
are accepted. Invalid/ambiguous content is unavailable; provider failures remain
errors. Other Sanity readers keep their existing limits and decoding defaults.

Verify no-store/noindex/nofollow/no-referrer headers, expiry/pause/unpublication,
full-frame images, keyboard viewing, and existing legacy links after rollout.
Monitor the existing provider's API/bandwidth quotas; using the same account
still consumes its allowance. Real CDN reads, deployed headers, permissions and
quota suitability have not been verified by the synthetic source tests. The
maximum-viewer journey uses 256 occurrences of two complete local web fixtures;
it checks navigation, end bounds and occurrence focus, not 256 unique CDN files
or live provider performance. It adds no production fixture exposure.

This model offers reduced discovery, **not confidentiality**. Public dataset
metadata and files can be enumerated; GROQ request URLs include the handle and
may appear in provider logs. Application malformed-content diagnostics contain
only a fixed label. Do not put customer/contact/job information in fields or
filenames; review embedded metadata before upload. Asset bytes are public even
while the owning document is a draft, and page expiry/unpublication cannot revoke
URLs or cached/downloaded copies. There is no new-gallery ZIP or individual
full-resolution delivery: the legacy-only original-file exception is unchanged.
See the [Studio workflow](../studio/README.md#ongoing-client-galleries-ab302--ab145).

The selected gallery adapter supports public datasets only, matching its visitor
notice and ADR-0034. A private dataset is a configuration error for this adapter;
other site adapters retain their own visibility contract. This restriction does
not make ordinary dataset assets private: Sanity documents that their CDN URLs
are public even when dataset metadata is private. [Official asset visibility](https://www.sanity.io/docs/media-library/asset-visibility).


### Proof pages (AB#130, ADR-0038)

`/client-proof/<handle>` shows a published proof gallery read-only: complete,
uncropped watermarked web proofs in authored order, each with its permanent number
(`Proof 014` / `Vedos 014`, also the lightbox caption). The reader is **off by
default**; enabling it publishes nothing.

| Setting | Meaning |
| --- | --- |
| `PROOF_GALLERY_ADAPTER=off` / unset | No proof pages served |
| `PROOF_GALLERY_ADAPTER=sanity` | Same requirements as `CLIENT_GALLERY_ADAPTER=sanity`; real content refused in Preview |
| `PROOF_GALLERY_ADAPTER=fixture` | Synthetic local development/CI only |

It follows the delivery reader's contract: discovery by handle within the proof type
only, then a fresh Doc API read of the published document (never a draft or a dotted
private record), compared with the snapshot after normalization; every proof must carry
the number publication fixed. Paused, expired and missing galleries are an ordinary
unavailable page; malformed content logs only `[proof-gallery] malformed-content`. The
namespace has the same reserved-path hygiene (`noindex`, `no-store`, `no-referrer`,
literal handle grammar only), stays out of the sitemap, search and analytics, and
accepts `?locale=`. As with delivery pages, public files and metadata stay discoverable.

**Selecting.** With `PROOF_SELECTION=enabled` (see [Sanity setup](sanity-setup.md)), a
link carrying `#select=<key>` enhances the same page: the browser reads the key from the
fragment and sends it only in same-origin `POST /api/proof-selection` bodies, never in a
URL. Each proof gets a select toggle; the summary shows the counts and the extra-image
total (a summary, not a charge), and confirming takes a deliberate second step. A
confirmed selection is shown as recorded, with its proof list, and cannot be changed by
the customer. Without the key, without JavaScript or with a refused key, the page stays
read-only. The language switch carries a validated key to the same gallery's other
language. `PROOF_SELECTION=fixture` is the harness's synthetic store and is refused
outside local development. A confirmation emails the photographer through the contact
delivery settings, so activating selection also requires a working `CONTACT_DELIVERY_*`
configuration; a missing one leaves the notice pending in Studio.
`/client-proof/<handle>/reminders` is the customer's own reminder stop: it shows no gallery
data, and only its button stops reminders, using the key in the link's fragment; it works
while the proofs are paused, expired or replaced.

**Customer reminders.** `vercel.json` schedules `GET /api/proof-reminders` daily at
06:00 UTC; Vercel calls the **production** deployment with `Authorization: Bearer
<CRON_SECRET>` and does not retry. The route is off (404) unless `PROOF_REMINDERS=enabled`
together with an enabled selection route, `PROOF_SELECTION_KEY_SECRET`, a `CRON_SECRET` of
at least 16 characters and the contact delivery settings; an incomplete configuration
answers 503. Each run sends the latest due reminder per gallery once, in the customer's
language, with Reply-To set to the owner mailbox, and answers counts only. It starts no
new gallery after 15 seconds of its 200-second limit (Hobby and Pro with Fluid compute)
and continues from a private cursor the next day. Before claiming a step, elapsed time
plus the 130-second reserve for the claim, fresh reads including replacement delivery
checks, send, outcome read/patch and cursor write must fit within a 185-second hard
deadline, leaving a 15-second safety margin; otherwise it counts the gallery as skipped
without writing the step, allowing a later run to claim it. Claimed work always finishes.
Every reminder links to the customer's stop page
(`/client-proof/<handle>/reminders`). Before activation the privacy notice must name the
reminder. With manual production releases, a schedule change takes effect only with the
next release.

**Current replacement runtime (ADR-0038 owner answer 5).** A proof gallery's
optional `replacedBy` names the client gallery holding the finished images. While exactly
that document is an available new delivery gallery — through the delivery reader, so it
needs `CLIENT_GALLERY_ADAPTER` and is never a retained legacy handle — the proof link
answers `307` to `/client-gallery/<handle>`, even when the proofs themselves are paused
or expired. The redirect keeps a single configured `?locale=` and ends in an empty
fragment, so a browser does not carry `#select=` over to the delivery URL. Clearing the
field, deleting or pausing the delivery gallery shows the proofs again if they are
available. Delivery provider failures stay server errors. The
[2026-10-24 amendment](adr/0038-proof-selection-in-existing-sanity.md#replacement-deletion-amendment-2026-10-24)
requires deletion at replacement publication instead (AB#396, not implemented).
No deployment flag currently makes this redirect perform deletion.

### Build one whole delivery ZIP offline (AB#319)

This owner-run tool creates one local package from an **explicitly selected** set
of processed JPEG exports. It neither discovers photographs nor creates missing
legacy packages. The required classification is an owner assertion; it grants no
public-media exception and cannot reclassify camera masters, RAW, private-only or
sales assets. No upload, CMS access, credential, publication or new service is
involved. A complete package larger than a local bound is refused whole, never
split, truncated or silently reduced.

```bash
npm run build:delivery-zip -- \
  --selection /private/operator/selection.txt --root /private/operator/exports \
  --out /private/operator/new-package --classification processed-jpeg-exports
```

The private UTF-8/LF selection has this exact header, ordered relative paths and
a final newline. Paths are local owner information, not output/public metadata:

```text
processed-jpeg-selection-v1
first-export.jpg
subfolder/second-export.jpeg
```

Choose every file deliberately. No globbing, recursive scanning, absolute paths,
traversal, aliases or duplicate sources are accepted. Canonical UTF-8/NFC paths
are limited to 512 characters with individual components at most 255 bytes;
control characters, backslashes and colon notation are refused. The selection is
at most 65,536 bytes with 1–256 entries. Every source must have a `.jpg`/`.jpeg`
extension and exact JPEG SOI/EOI boundary markers; trailing data after EOI is
refused. This screen does **not** decode JPEGs or prove they are processed exports.

The ZIP uses STORE, neutral `image-NNNN.jpg` entry names, signed ZIP32 data
descriptors and fixed neutral container timestamps. JPEG bytes, including all
embedded EXIF/GPS/IPTC/ICC metadata, remain unchanged. The tool performs no
metadata review or stripping. Such metadata would remain exposed if a package
were later uploaded to a public file URL. Owner review and publication approval
remain separate.

Local engineering bounds are 1,000,000,000 archive **and** expanded bytes,
25,000,000 bytes per entry and 256 entries. Exact ZIP overhead counts toward the
archive bound before output is created. Sources and output use sequential reads
and writes of at most 65,536 bytes with backpressure; CRC32, member SHA-256 and
whole-archive SHA-256 are calculated while copying. The copy-stage deadline is
330 seconds. SIGINT/SIGTERM request cancellation and identity-safe cleanup.
Filesystem syscalls themselves cannot be interrupted by this signal; a stalled
filesystem can delay cancellation until the syscall returns. This is not proof
of Sanity upload support, product size limits or permitted public-file delivery.

On supported Linux/macOS POSIX filesystems, source directories, the selection's
parent and the output's existing parent must be owner-owned `0700`; inputs must
be owner-owned regular single-link `0600` files. Symlink components are refused.
Inputs and **every** output inside Git must be ignored and untracked. The output
directory is new and exclusively created, outside the source root. The tool
holds source descriptors and checks their current paths, identity, size, modes,
ownership, link counts and nanosecond change/modification timestamps before and
after copying. These checks detect drift; they do not promise race-free operation
against a malicious process with the same OS identity. Unsupported permissions
or hosts fail closed.

Only `delivery.zip`, `entries.tsv` and `receipt.json` are produced, all `0600` in
the new `0700` directory. The TSV records **observed** neutral entry names, byte
counts and SHA-256 for a later independent integrity audit; it does not establish
owner approval of the intended set. The fixed receipt/stdout contains only
technical counts, hashes and checks, always `readyToUpload: false`. JPEG decoding,
processed-export classification, metadata suitability, manifest authority and
provider compatibility remain unproven. The archive hash covers bytes written;
it is not an independent on-disk readback.

`receipt.json` is written last after ZIP/TSV sync and source/output checks. A
successful receipt is the completion marker; ZIP existence alone is insufficient.
Failure removes only still-identifiable files created by the current invocation,
never overwrites existing data and never recursively deletes a directory.
SIGKILL or power loss can leave incomplete files without a valid receipt; inspect
and remove such private artifacts deliberately before retrying in a new output
directory. Recheck the package independently before any separately authorized
upload. The existing 100 MB audit covers small packages only; larger ones need a
separately available whole-package verifier. ADR-0035 remains Proposed and actual
whole-file provider transport remains unresolved.

### Optional offline availability plans (AB#304)

Ordinary creation, pause and publication remain native Studio operations. The
optional `plan:client-gallery-availability` command prepares local evidence for
one published `clientDeliveryGallery`, then can verify that plan against a
separately supplied snapshot. It never connects to Sanity, loads a token,
authenticates an operator, applies a mutation, sends mail or changes production.
It writes private **local** JSON artifacts; there is no `--apply`, `--write` or
credential flag. Keep real snapshots and plans outside the public repository.

Inputs are private regular files (owner-only permissions, no symlinks/hardlinks):
a root-document snapshot and a closed JSON intent. For example, an explicit pause
with indefinite page availability is `{"available":false,"availabilityMode":"indefinite"}`.
A finite intent instead includes `"availabilityMode":"until"` and a canonical UTC
`expiryInstant` (seconds or three milliseconds, ending in `Z`). There is no default
duration. A requested available page must have a deadline strictly after the
explicit planning instant; pausing can retain an expired deadline. No-op requests
are refused. This is an availability check, **not** full content/image eligibility
validation: the native schema and fresh customer reader retain that responsibility.

```bash
npm run plan:client-gallery-availability -- plan \
  --snapshot /private/operator/current.json --intent /private/operator/intent.json \
  --at <current-UTC-instant> --out /private/operator/plan-01
npm run plan:client-gallery-availability -- verify \
  --snapshot /private/operator/new-current.json --plan /private/operator/plan-01/plan.json \
  --approved-digest <reviewed-plan-SHA256> --at <current-UTC-instant> \
  --out /private/operator/check-01
```

Replace the placeholders with actual current UTC instants and the reviewed
identifier. The output directory must be new, under an existing owner-private
0700 parent with no symlink path. Output is 0700/0600 and never overwrites evidence;
inside Git, the existing artifact guard also requires the output to be ignored.
Use a filesystem that enforces these permissions; source checks run on Linux,
not Windows/DrvFS. Input JSON is strict UTF-8 without BOM or duplicate keys,
bounded to 1 MiB, depth 32 and 20,000 nodes (intent file: 4 KiB).

The plan binds the complete canonical snapshot, document ID, revision and ordered
image membership. Its only possible patch fields are `available`,
`availabilityMode` and `expiryInstant` (unset for indefinite access), with
`ifRevisionID`. Verification replans and compares the complete artifact/digest;
any revision, handle, image order/membership or other source change invalidates it,
even if the revision was accidentally retained. Verification has its own explicit
instant and refuses a deadline that has now passed or a clock earlier than the plan.
Console output contains only fixed notices, mode and digest, never source text,
IDs, handles or private paths. Native filesystem/JSON errors are redacted.

A matching digest is integrity evidence, **not authentication or authorization**.
The tool cannot tell whether a local snapshot is current, whether a Studio draft
exists, or whether images are eligible. Both outputs state `readyToWrite:false`.
There is no remote writer. Any future separately approved writer must refetch,
validate content/metadata and the exact reviewed plan, **refuse an existing
`drafts.<id>`**, and atomically compare-and-swap the published revision. Otherwise
later Studio publication could undo a direct published-document change.

Setting `available=false` pauses a page; it does not unpublish the document or
remove it from a public dataset. Neither pause nor expiry revokes asset URLs,
provider caches or downloaded copies. No legacy gallery, handle, image, ZIP,
customer field or protected store is edited by this tool.

### Private client galleries (ADR-0014, deferred alternative)

**Owner decision, 2026-10-16:** [ADR-0034](adr/0034-ongoing-unlisted-client-delivery.md)
selects existing Sanity/unlisted delivery for ongoing customer work, including
future galleries. Do not provision the S3/Postgres services below for this owner
or enable the protected runtime. These instructions remain an inactive
alternative, not prerequisites for the current deployment. Existing legacy
configuration remains unchanged; new authoring and reads use the separate
Sanity workflow above.

Post-MVP and **off on every environment today**. The feature is a separate service
boundary — a private S3-compatible object store and a private PostgreSQL-family database
in accounts the site owner controls, never Sanity and never a public bucket (ADR-0014
§8, §9). AB#29 ships it in slices; the isolation boundary, the reserved route namespace
and its response hygiene, the capability envelope, the session and cookie contract, the
rate-limited exchange, the link/exchange routes, and a bounded per-asset mint
route exist so far. The mint route reauthorizes a session before it reads an asset
request, enforces a per-session rolling 60-per-minute mint limit, and reaches
the existing budget-and-signing facade; it is verified against
the development fixture only and cannot deliver bytes in a real deployment yet.
**No store adapter does** — `PRIVATE_GALLERY_STORE=enabled` throws on the first
request that needs one, by design, so a deployment that turns the feature on
before AB#29's provisioning slice fails
visibly instead of half-serving.

Three build-safe settings, read during `loadDeploymentConfig` like the `SITE_*` values:

| Setting | Preview | Production |
| --- | --- | --- |
| `PRIVATE_GALLERY_STORE` | `off` (or unset) | `off` (or unset) until AB#29 provisioning |
| `PRIVATE_GALLERY_ROUTE_PREFIX` | unset (defaults to `private`) | same |
| `PRIVATE_GALLERY_ADMIN_ROUTE_PREFIX` | unset (defaults to `admin`) | same |

`PRIVATE_GALLERY_STORE` accepts a third value, `memory`, which
`readPrivateGalleryDeployment` accepts **only when `SITE_DEPLOYMENT_STAGE` is
`development`** —
the same production-refusal safeguard `SITE_CONTENT_SOURCE=mock` and
`CONTACT_DELIVERY_ADAPTER=sink` already carry, and for the same reason: its one fixture
gallery has a **published, non-secret** capability. It exists so the exchange can actually
be run — locally with `npm run dev`, and by the Playwright harness, which sets it in
`e2e/support/harness-environment.ts`. It reads none of the Sensitive settings below: the
fixture is sealed under an ephemeral key minted per process and never written anywhere, so
a restart re-seals the same link under a fresh key and nothing from one run authorizes
anything in another. The link is

```
/<PRIVATE_GALLERY_ROUTE_PREFIX>/EREREREREREREREREREREQ#LS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0
```

— the two constants `src/lib/private-gallery-memory-store.ts` exports. Preview is refused
as well as production, and deliberately: Preview is a shared, access-protected environment
standing in for Production, so a fixture gallery there would be a private-namespace
surface nobody reviewed. `npm run dev` and the Playwright harness both declare
`development` already, so nothing that legitimately needs the fixture loses it.

`PRIVATE_GALLERY_ROUTE_PREFIX` is validated and reserved as a root segment **whether the
feature is on or off**, so a deployment can never assign `/private` to a locale prefix or
a story namespace and then be unable to enable the feature without a public URL
migration. A collision fails the build.

`PRIVATE_GALLERY_ADMIN_ROUTE_PREFIX` (ADR-0015 §1) is the administrator namespace's own
root segment, reserved on exactly the same terms and for the same reason. Two things
about it are worth knowing before a clone changes it:

- **It must differ from `PRIVATE_GALLERY_ROUTE_PREFIX`,** and the build refuses a
  configuration where the two are equal. ADR-0015 §1 keeps the namespaces from
  overlapping at all: the customer session cookie is `Path`-scoped beneath the customer
  prefix, so a shared root would place an administrator route inside the scope of a
  customer credential.
- **The prefix is not a secret and is not a security control.** Changing it to something
  unguessable is fine and costs nothing, but the boundary is the credential, the
  persisted login rate limit, and the `__Host-` session ADR-0015 §2–§4 decide — none of
  which is built yet (AB#145). Note in particular that **production `robots.txt`
  publishes whatever value you choose**, as a `Disallow` line: renaming the prefix is
  not concealment, and nothing here is designed on the assumption that it is.

Administration does not exist yet, so every path under this prefix is a 404 today. It
already answers with `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, and
`Referrer-Policy: no-referrer`, and production `robots.txt` disallows it: a namespace has
to behave privately *before* it has content, or the deployment that adds the first route
is also the first one crawled.

#### The administrator credential

`PRIVATE_GALLERY_ADMIN_SECRET_HASH` (ADR-0015 §4) is the whole administrator identity
mechanism: a `scrypt` hash of a **generated** secret, carrying its own salt and cost
parameters:

```
scrypt$1$32768$8$1$<salt>$<hash>
```

Produce it with the repository's own command, which generates the secret, hashes it, and
verifies its own output before printing anything:

```bash
npm run admin:secret
```

It prints two values and writes neither to disk. The **secret** goes into the operator's
password manager — it is printed once and is not recoverable. The **hash** becomes this
Sensitive environment variable on the deployment.

- **A memorable passphrase is not an acceptable value.** ADR-0015 §4 makes that a
  requirement of the decision rather than advice, because the boundary has to be
  *stronger* than a 256-bit customer capability, and there is deliberately no
  password-reset flow to fall back on. The command generates the secret for you; if you
  supply your own with `--secret`, it enforces a length floor.
- **Rotation and recovery are the same operation**: change the variable, redeploy. That
  ends every live administrator session immediately (ADR-0015 §2), because each session
  row stores a digest of the credential it was minted against and every request compares
  it. There is no table to clear and nothing to remember.
- It is read **lazily at request time**, never at build, so a deployment that has not
  provisioned administration still builds — the same posture `GALLERY_CURSOR_SIGNING_KEY`
  has. Administration simply refuses every login until the value is set.
- Never `NEXT_PUBLIC_`, which is refused unconditionally at two layers.

The parameters are ADR-0015 §4's `N = 2^15, r = 8, p = 1`, roughly 74 ms of CPU per
verification. A deployment may raise the cost and never lower it; the parser enforces that
floor. There is a ceiling too, so a mistyped `N` fails the command rather than exhausting
memory inside a login.

#### Signing in

With `PRIVATE_GALLERY_ADMIN_SECRET_HASH` set, the operator signs in at
`/<PRIVATE_GALLERY_ADMIN_ROUTE_PREFIX>` — `/admin` by default. The same address serves
both states: with a session that currently authorizes it renders the signed-in surface,
and without one it renders the sign-in form. A stranger and an operator whose session ran
out see exactly the same page.

Signing in needs JavaScript. ADR-0015 §3 fixes `application/json` for the login and every
mutation, so the form posts JSON rather than submitting a plain form — the opposite of the
trade the customer gallery makes, and deliberately: a visitor did not choose their browser
for this site, while the operator is one person using their own tools.

**There is nothing to administer yet.** The surface says so rather than implying more.
Creating, publishing, notifying, and revoking galleries are AB#145's remaining scope and
need the private stores this runbook's provisioning section describes.

#### Consider platform access control in front of the administrator namespace

The administrator login will carry a **deployment-wide** persisted rate limit (ADR-0015
§3): thirty attempts per fifteen minutes, for the whole site rather than per client (the
development-only `memory` fixture, whose credential is published, uses a larger cap so the
production-build journey suite cannot exhaust it — AB#377). That
is the right shape for what it protects — one operator, one shared CPU budget, and a
counter whose key nothing a caller sends can influence, so it cannot be used to grow a
table — but it has an accepted cost the ADR does not discuss:

> **Sustained attempts from anywhere can exhaust the window and leave the operator unable
> to log in until it rolls over.** The failure mode is a wait of at most fifteen minutes,
> not an escalating lockout, and it does not affect customers: a private gallery link and
> an already-issued administrator session both keep working.

The reason it is accepted rather than solved in the application is that the alternatives
are worse. A per-client persisted counter reintroduces the unbounded key space ADR-0014 §3
deliberately avoided for the capability exchange, and rotating addresses defeat it anyway.

If that residual matters for a given deployment, the fix belongs at the platform rather
than in this repository: restrict the administrator namespace at the edge — an IP allow
list, or the host's own access control — so the endpoint is not reachable from the open
internet in the first place. Nothing in the application depends on that being configured,
and nothing about it is required for correctness; it is a defence against a nuisance.

**One exception to the request-time rule.** `PRIVATE_GALLERY_S3_ENDPOINT` is additionally
read at **build** time, and only when `PRIVATE_GALLERY_STORE=enabled`. The private routes
grant that origin — and only that origin — in their Content-Security-Policy `img-src`
(ADR-0011 action item 4, ADR-0014 §6), because a private preview is an `<img>` pointed at
a signed object-store URL; a CSP is a static response header and cannot be assembled per
request. The endpoint is an origin rather than a credential, and this follows the
precedent already in `next.config.ts`, where `SANITY_PROJECT_ID` and `SANITY_DATASET` are
read at build for the optimizer's allow-list. Practical consequence: **an `enabled` build
must supply the endpoint**, and fails closed if it does not — the alternative is a gallery
whose every photograph the browser blocks with no build error to explain it. No
`connect-src` grant is added, because the browser never fetches the store from script,
which is also why the bucket needs no CORS policy.

The credential-bearing settings — `PRIVATE_GALLERY_DATABASE_URL`, the
`PRIVATE_GALLERY_S3_*` endpoint/region/bucket/key-prefix and verifier credentials, and
the `PRIVATE_GALLERY_CAPABILITY_KEYS` keyring plus
`PRIVATE_GALLERY_CAPABILITY_ACTIVE_KEY_ID` — are **request-time Sensitive**, exactly like
`GALLERY_CURSOR_SIGNING_KEY`: read lazily when a private route first needs one, never by
`next build`, and stored as Vercel Sensitive variables per environment. None is ever
prefixed `NEXT_PUBLIC_`; that name is refused unconditionally. ADR-0014 §8a defines
**three** least-privilege object-store credentials — the deployed runtime/verifier pair
(GET signing + metadata HEAD only), the retention worker's prefix-scoped
enumerate/delete pair, and the owner-run upload CLI's write/multipart pair that lives
only on the photographer's machine (the same posture as `SANITY_SEED_TOKEN`). Only the
verifier pair belongs in a deployed environment. `.env.example` lists all of them.

**The proof-confirmation notification transport (AB#130) is a separate, smaller
settings group**, not part of the object-store/database credentials above:
`PRIVATE_GALLERY_NOTIFICATION_ADAPTER` (no default, `resend` or the
development-only `sink`) and `PRIVATE_GALLERY_NOTIFICATION_FROM`, sharing the
contact path's own `RESEND_API_KEY`. Same request-time-only, no-`NEXT_PUBLIC_`
posture, and `sink` is refused outright in a production deployment, exactly as
`CONTACT_DELIVERY_ADAPTER=sink` is. Configuring this does not, by itself, send
anything: no scheduled worker yet claims a queued proof-confirmation attempt
and calls this transport (`docs/feature-status.md`).

#### Provisioning the two private services — deferred alternative

**Not part of the owner's selected deployment (ADR-0034).** The historical
procedure below requires a separately approved protected-gallery scope before
any service order or credential/configuration change.

**Nothing in this repository can do this part.** The object store and the database are
accounts in the site owner's own name (ADR-0014 §8), the same way the Resend account is
AB#117's own prerequisite. It is written down here now, ahead of the code that needs it,
because it is the long-lead item on AB#29: the delivery slices (signed URLs, the ZIP)
cannot start without it, and every step below is a decision or a signup rather than a
deployment.

The reference object store is **UpCloud Managed Object Storage** (ADR-0014 §8a: an EU/
Finnish company, S3-compatible, presigned `GET`, zero-cost egress under Fair Transfer);
Cloudflare R2 is the named alternative. The database is **any PostgreSQL-family managed
service the owner controls**, vendor deliberately left open (§8b). What follows is
provider-neutral: it states what must be *true* and how to *verify* it over the S3 and
Postgres wire protocols. Console paths change and are not restated here — read them from
the provider's current documentation, per this repository's anti-hallucination rule.

**1. Object store: one bucket, default-deny.** ADR-0014 §8a: *"naming it private is not
the control."* The bucket must satisfy all of:

- an EU region, in the owner's own account, holding nothing else;
- no public-read ACL on the bucket or on any object, and no credential below permitted to
  set one;
- an explicit policy (or the provider's equivalent) that **rejects anonymous and unsigned
  access for every operation** while still honouring a valid presigned `GET`. UpCloud
  exposes no S3 `PublicAccessBlock` API — verified against its S3-compatibility table on
  2026-08-31 — so the deny policy plus the no-public-ACL rule *is* the control there, and
  it is verified live in step 4 rather than assumed from a toggle;
- one key prefix for private-gallery objects, which becomes `PRIVATE_GALLERY_S3_KEY_PREFIX`.

**1b. The key layout the policies are scoped to.** Objects are written under a shape the
application assigns; nothing else may write into the prefix. Knowing it before you write
the policies matters, because all three credentials below are prefix-scoped and a policy
written against a guess would either be too wide or would refuse the application's own
objects:

```
<PRIVATE_GALLERY_S3_KEY_PREFIX>/g/<galleryId>/<preview|proof|zip>/<128-bit token>
```

The trailing token is CSPRNG, not a counter, so one key never implies a sibling — that is
what makes the runtime credential's *absence* of `ListBucket` meaningful. The key carries
**nothing about the customer or the photograph**: no name, no shoot title, no original
filename, no capture date, no gallery handle. A key is not browser-facing, but it is
visible to anyone who can list the bucket and to the provider's own tooling, and a listing
that read `.../smith-wedding-2026/DSC_0431.jpg` would have published the customer
relationship to all of them. `src/lib/private-gallery-object-key.ts` is the only place a
key is created, and it refuses any gallery id that would escape the prefix.

**2. Object store: three credentials, not one (§8a).** Each is least-privilege and scoped
to the private key prefix in this one bucket. None may write a bucket policy or ACL,
delete the bucket, or reach another bucket.

| Credential | Permissions | Lives in |
| --- | --- | --- |
| **Runtime / verifier** | object read on the key prefix, plus metadata-only `HEAD` for an exact key. **No `ListBucket`, no writes.** | The deployed environment — `PRIVATE_GALLERY_S3_VERIFIER_ACCESS_KEY_ID` / `…_SECRET_ACCESS_KEY` as Vercel Sensitive values. The **only** storage credential a deployment ever holds. |
| **Retention worker** | prefix-scoped enumeration and deletion of objects, versions, and incomplete multipart uploads. Nothing else. | The scheduled worker's own environment only (§7). Never the web deployment. |
| **Owner-run upload CLI** | `PutObject` and the multipart create/upload/complete/abort operations on the prefix. **No read, delete, list, ACL, or policy.** | The photographer's machine only — the same posture as `SANITY_SEED_TOKEN`. Never any deployed environment, never CI. |

**3. Private metadata store.** A PostgreSQL-family managed service. Before committing to a
vendor, verify and record each of these — §8b makes them the decision criteria, not a
wish list: EU region; encryption at rest and in transit; automated backup **and** a
point-in-time-recovery window inside §7's ≤ 30-day ceiling; a **restore actually tested**,
not merely offered; unambiguous customer ownership and a working export; connection
pooling suited to serverless invocation (a pooler endpoint or an HTTP driver); a
schema-migration path; and current price. The connection URL becomes
`PRIVATE_GALLERY_DATABASE_URL`, Sensitive, request-time only.

**4. The live verification gate.** ADR-0014 §8a requires these to pass against the real
bucket *before* the deployment is accepted. They are protocol-level, so they hold whatever
the console looked like:

- an unsigned `GET` of a known object key **fails**;
- an unsigned `LIST` of the bucket or prefix **fails**;
- a presigned `GET` minted with the verifier credential **succeeds**;
- a `Range` request against a large (~20 GB) ZIP object **succeeds and returns 206**, so a
  resumed download works;
- object responses carry `Cache-Control: no-store`, and the ZIP additionally carries
  `Content-Disposition: attachment`;
- the CLI credential **cannot** read or delete, and the verifier credential **cannot**
  write or list — check the denials, not only the grants. A credential that is merely
  *not used* for an operation is not the same as one that *cannot* perform it.

Record the results against AB#29 in Azure Boards, the way AB#116's Preview verification
and AB#84's seed run were recorded: which provider, which region, the date, and the
observed outcome of each check. A provisioning claim with no evidence is what the AB#117
re-check found and had to retract twice.

**5. Generate the capability keyring.** Independent of both services, and the one value
this repository can tell you how to produce exactly:

```bash
# One 256-bit key, standard base64. The id is yours to choose (lowercase, digits, hyphens).
printf '%s:%s\n' "k1" "$(openssl rand -base64 32)"
```

Set `PRIVATE_GALLERY_CAPABILITY_KEYS` to the comma-separated `id:base64` list and
`PRIVATE_GALLERY_CAPABILITY_ACTIVE_KEY_ID` to the id new capabilities are sealed under.
Both are Sensitive and request-time. Rotation adds a key and moves the active id; the old
key stays in the list until every stored envelope has been re-sealed under the new one
(ADR-0014 §3). A key removed too early makes those galleries permanently unopenable — the
envelope is encrypted, not hashed, precisely so links can be re-issued, and that only
works while its key is still in the ring.

**What must never happen:** none of these values belongs in a pull-request job, in
`.env.example`, in a Playwright artifact, or in this repository. `PRIVATE_GALLERY_STORE`
stays `off` until step 4 has actually passed — the code refuses to half-serve, but an
`enabled` deployment with a half-provisioned bucket is a deployment throwing on every
private request.

**6. The scheduled retention worker.** ADR-0014 §7 makes a metadata-driven worker
authoritative for the six-month lifecycle, and it must run **at least once every 24
hours** — a platform cron or scheduled job, not an owner-run command. Owner-run
invocation of the same script is for repair or backfill only. The worker's decision
rules are already built and tested (`src/lib/private-gallery-retention.ts`); the job
that performs the IO lands with the store adapters. Two provisioning consequences to
settle while you are in the consoles:

- the object store needs the **backstop lifecycle policy** — expire objects on the
  private prefix at **275 days** after creation, expire noncurrent versions at **30
  days**, abort incomplete multipart uploads at **7 days**. It is a backstop for
  objects the worker missed, never the access clock: an age rule cannot see a
  gallery's publication-derived expiry, and the 275 days sit beyond every legitimate
  object lifetime, so the rule can only ever hit a genuine orphan. A deployment may
  lower these ages; raising one breaks the derivation.
- the database's **PITR window** must sit inside the ≤ 30-day retention ceiling, which
  is why step 3 lists it as a selection criterion rather than a nice-to-have: a backup
  that can restore private objects' metadata from beyond the deletion horizon
  reintroduces data the lifecycle promised was gone. A restore also re-runs the worker,
  by design — that is what makes expiry restore-safe.

#### Backups, and the gate a restore has to pass

Two stores, two different rules, and they do not meet in the middle.

The **object store** must not carry backup or version history that outlives
`accessExpiresAt + 30 days`. If versioning is enabled for accident recovery, its
noncurrent-version expiration must be **at most the 30-day deletion grace** — otherwise
the lifecycle's promise that a gallery's bytes are gone becomes a promise that they are
gone *except in versions*, which is not the same statement and is not the one the
customer was given.

The **metadata store's** point-in-time-recovery window is bounded at **30 days**, and may
be set lower. PITR is never a substitute for the retention worker: it recovers from a
mistake, it does not implement the access clock.

**The restore gate.** A restore from any metadata backup **runs the retention worker
before traffic resumes**. ADR-0014 §7 states this as a gate rather than a suggestion, and
the reason is concrete: a backup taken before an expiry, restored after it, brings back
rows describing a gallery whose access window has since closed. Without the worker running
first, that gallery is briefly accessible again — a customer's photographs reachable after
the six months they were told about. The order is: restore, run the worker to completion,
verify the gallery states it moved, then allow traffic.

A restore that cannot run the worker first is not a restore that may be put into service.

**Test it before you need it.** ADR-0014 makes a *tested* restore a provider-selection
criterion, not a nice-to-have. Restore into a scratch database, run the worker against it,
and confirm both that it completes and that an expired gallery came back expired. Record
the date and the outcome against AB#29 the way AB#116's deployment verification and
AB#84's seed run are recorded — an untested restore is an assumption with a runbook
attached.

#### Drift monitoring

The backstop lifecycle policy is the net under the retention worker, and a net nobody
checks is a net that has already failed. The worker's **final step asserts that the policy
is present and enabled, and reports if it is not** (ADR-0014 §7). A silently disabled
policy is a finding, not a warning to be skimmed: it means orphaned objects — the ones the
worker itself missed — now live indefinitely.

Three things drift in practice, and the first is the only one automated:

- **the backstop lifecycle policy** — asserted by the worker on every scheduled run;
- **the bucket's default-deny posture** — re-run §8a's live checks after any console change
  to the bucket, because an unsigned `GET` that starts succeeding is not something the
  application can detect from inside;
- **the three credentials' scopes** — a credential that gains permissions is invisible until
  something uses them. Re-check them when the provider's console is touched and at the same
  cadence as any other credential review.

#### Owner-run repair and backfill

The retention worker's normal mechanism is the **scheduled** run, at least once every 24
hours. The same script may be invoked by hand, and that invocation is for **repair or
backfill only** — after an incident, after a restore, or to reconcile a preparation the
scheduled run could not finish.

It is never the normal mechanism, for the reason ADR-0014 §7 gives: a lifecycle that
depends on somebody remembering to run it is not a lifecycle. If hand-running becomes
routine, the schedule is broken and that is the thing to fix.

An owner-run invocation is subject to the same rules as the scheduled one — it obeys the
same deadlines, the same bounded batches, and the same deletion guard — and it should be
recorded when it changes state, because "why did this gallery move to `deleting` on a
Sunday" is a question somebody will eventually ask.

#### The exit path

Both services are the site owner's, and ADR-0004's ownership boundary means leaving has to
be possible without asking anyone's permission. Neither store holds anything that cannot
be taken out.

**Getting the data out.** The metadata store exports with the provider's own dump — it is
ordinary PostgreSQL, thousands of rows, no media. The object store's contents are
enumerable and downloadable with the retention-worker credential's prefix-scoped list plus
any S3-compatible client. **What matters is what is *not* there:** the camera masters were
never uploaded (ADR-0014 §8c — the photographer prepares everything locally), so an export
is derivatives and delivery ZIPs, not the archive. The archive is already on the
photographer's own machine, which is the point of that decision.

**Shutting it down.** Set `PRIVATE_GALLERY_STORE=off` and redeploy: the routes stop serving
and the reserved prefix stays reserved, so nothing else can claim it. Then delete the
objects, drop the database, and **revoke all three credentials plus the capability
keyring** — the keyring last, because a retained key is what would let a recovered envelope
be opened later.

**What the customer keeps.** Nothing about shutting the service down reaches a customer who
already downloaded their ZIP; it is on their machine. A customer who has not downloaded it
loses access at shutdown exactly as they would at the six-month expiry, which is the
argument for telling them before it happens rather than after.

**None of this has been exercised.** No deployment has provisioned either service, so every
step here is derived from the ADR and the providers' documented capabilities rather than
from a run. The first owner to follow it should correct it where it is wrong — that is more
useful than leaving it aspirational.

#### Offline private upload source check

This development tool runs before storage upload and needs no provider credential.
It never changes images, writes to Sanity/object storage, assigns object keys or
publishes a gallery. Input and output contain private local paths/filenames: use
owner-owned `0700` directories and a `0600` input JSON. Inside a checkout, both
artifacts must be untracked and Git-ignored. Symlink components are refused.
Native Windows ACL handling is unverified and refused; filesystems that do not
honour the required POSIX permissions also fail closed.

For externally watermarked proof exports, the input shape is:

```json
{"mode":"proof","externallyWatermarked":true,"images":[{"relativePath":"proofs/IMG_0001.JPG","mediaId":"media-1"}]}
```

The watermark flag is the operator's declaration, **not watermark detection**.
Every proof needs its existing stable media identity; filenames do not create it.
For delivery, use `{"mode":"delivery","images":[{"relativePath":"previews/IMG_0001.JPG"}],"zipPath":"delivery.zip"}`.
Paths are relative to the source root; ambiguous case/NFC aliases, hardlink aliases,
traversal and duplicate media identities are refused. Delivery requires its one ZIP.

```bash
npm run plan:private-gallery-upload -- --input <private.json> --source-root <export-folder> --out <private-output>
```

The tool checks JPEG metadata and a complete pixel decode at native ratio, one page, upright orientation,
≤ 2,048 pixels on the longest edge and ≤ 8 MiB per preview; it changes no bytes.
The existing 1,000-object plan limit permits 1,000 proofs or 999 previews plus ZIP.
The ZIP is streamed and capped at 20 GiB, with a 25 GiB gallery total. Only its
local-file signature is recognized: archive entries, CRC and full-JPEG membership
remain unchecked. The local report flags EXIF/ICC presence without copying their
contents. Review private export metadata before upload.

`upload-source-plan.json` is written exclusively at `0600`; an existing result is
never overwritten. Its digest covers the versioned manifest, local asset paths,
sizes/hashes and declared checks, excluding the digest itself. It detects change,
not authenticity. This is a planning-time snapshot: the future uploader must rehash
before writing and obtain/obey the server-committed preparation and opaque keys.
Only the report's `manifest` is input for future preparation; the local paths and
hash report never belong in a browser payload. Server coordination, upload,
provider checksum semantics and actual publication remain separate work.

The npm command suppresses only Node's module-type detection notice for shared
TypeScript policy imports. Validation failures print a fixed code and optional
item ordinal, without native filesystem/Sharp errors or private filenames.

Revalidate a selected saved plan immediately before later upload tooling:

```bash
npm run verify:private-upload-sources --silent -- --plan <private-output/upload-source-plan.json> --source-root <export-folder> --expected-digest <selected-digest>
```

The verifier reads a private report of at most 4 MiB, reconstructs its complete
closed contract and checks the selected digest before touching a source path.
It reuses the planner's unchanged path/open/stat guards and complete JPEG decode;
ZIPs are streamed again. Sizes, hashes, dimensions, metadata-presence flags and
the ordered manifest must still match. Identical copied/restored files remain
valid: inode identity detects aliases within one run, not changes across runs.
The tool writes no artifact and emits only counts, digest and fixed caveats.
`--silent` suppresses npm's command echo, which otherwise repeats local arguments.

This checks the selected bytes, not authenticity, watermarks or archive contents.
Files can change after any preflight; a later uploader must verify/stream its own
open handles rather than reopening files and treating this as a lock. Intermediate
path components can also change between the component walk and open: this is
offline operator tooling, not an adversarial-filesystem isolation boundary.
No credential, remote metadata, object key or upload is provided by this command.

### The Sanity webhook signing secret

`SANITY_WEBHOOK_SECRET` is a Sensitive, runtime-only value shared with exactly one
environment's Sanity document webhook. Generate at least 32 random bytes (for example,
`openssl rand -base64 48`), use a different stable value for Preview and Production, and
rotate both Sanity and Vercel sides together. A mismatch makes every delivery fail closed
with 401; the value is never a URL parameter or custom bearer token.

**"Rotate together" is necessary but not sufficient — a running deployment does not pick
up the new Vercel-side value on its own.** Sensitive variables are injected at request
time rather than baked into the build, but that injection is still fixed to whatever the
deployment's own environment snapshot was when it was created; it does not follow a later
change to the variable. Verified directly against a real Preview deployment (AB#83,
2026-08-25): updating `SANITY_WEBHOOK_SECRET` and then delivering against the
already-running deployment fails closed with `invalid-signature`, because that deployment
still carries the value it was created with. **Rotation order:** update the secret in
Vercel, deploy — the Preview pipeline stage or an equivalent manual
`vercel build/deploy --target=preview` — and only then update the same value in Sanity's
webhook `Secret` field, so no delivery is signed with the new secret before a deployment
exists that can verify it.

The endpoint, exact GROQ projection, finite cache lifetime, tag map, retry behavior, and
the promotion/rollback broad-expiry command are documented in
[`cache-revalidation.md`](cache-revalidation.md). A webhook 200 proves that this
deployment accepted the event; it does not by itself prove cross-instance propagation.

### The stable Preview integration alias

A Preview deployment's generated `<hash>.vercel.app` URL is unique to that deployment. A
webhook — the Sanity revalidation webhook today, potentially other integrations later —
pointed at one goes stale (stops delivering) the moment a newer deployment supersedes it.
`PREVIEW_STABLE_ALIAS` (AB#136) is the fix: one bare `*.vercel.app` host that the
`DeployPreview` stage repoints at each newly verified deployment, so the webhook is
configured once with `https://<PREVIEW_STABLE_ALIAS>/api/revalidate` and never edited
again for an ordinary redeploy.

**What the pipeline does with it.** After the generated URL passes the access-protection
and `noindex` checks, `npm run repoint:preview` runs the repoint as a transaction:

1. it re-binds the just-deployed generated URL to the expected project and team;
2. the **monotonic guard** — it refuses to move the alias to a deployment created *before*
   (or at the same time as) the one it already points at (by Vercel `createdAt`). It is
   retained as defence in depth, including for an owner-run invocation of this same
   repoint script outside CI. A direct `vercel alias` command bypasses the script and its
   safeguards;
3. the **revision gate** (AB#144) — immediately before the assignment it resolves `main`'s
   tip live (`git ls-remote`) and compares it with `$(Build.SourceVersion)`, the commit
   this deployment was built from. If `main` has moved past that commit, this deployment
   is an ineligible candidate: the alias is **left exactly as it was** (`superseded`, a
   pipeline warning, not a failure) and never pointed at a stale revision. If the tip
   cannot be resolved the step **fails closed** rather than falling back to `createdAt`
   ordering;
4. it assigns the alias to this deployment through Vercel's atomic
   `POST /v2/deployments/{id}/aliases`;
5. it re-verifies the alias host itself for the same SSO challenge and exact
   `X-Robots-Tag: noindex` (AC1/AC4), with a short bounded retry for propagation lag;
6. if anything fails once the assignment has been attempted — a lost response to the
   POST, or a failed re-verification — it **reconciles**: it re-reads the alias and
   restores the previous target (or removes a first assignment) while the alias still
   points at what this run assigned; if a newer run has since published to it, this run
   leaves it alone. If the alias cannot be read or restored afterwards, the step fails
   loudly as *unreconciled* — run `npm run verify:preview-alias` and repoint by hand.

Before any of that, the repoint **refuses** a `PREVIEW_STABLE_ALIAS` that is the
project's own default production domain (`<project>.vercel.app`) or that currently
resolves to a `target: "production"` deployment — a misconfigured value can never pull a
production domain onto Preview.

Concurrent `DeployPreview` runs are serialized by the stage's `lockBehavior: sequential`
plus the Exclusive lock check on the variable group (provisioning step 10) — but that
serializes *execution*, not commit order, which is why step 3's revision gate exists.

**Residual behaviour, by design (AB#144).** The gate never initiates an assignment for a
candidate already known to be superseded. The alias can nevertheless remain on an older
revision after `main` advances: if the current-tip run fails, is cancelled, or has not yet
completed, the alias stays on its last verified target. That target is stale relative to
the current tip, but remains a real, verified, access-protected `main` deployment. A
`superseded` warning makes a declined older run visible; the current-tip run's own failure
or cancellation remains visible in that run. Recovery, if needed, is the manual
**Rollback**/**Verification** commands below.

**Clone note.** Step 3 resolves the tip through `git ls-remote origin refs/heads/main` in
the DeployPreview checkout. The reference repository is public, so no credential is needed.
A **private-repo clone** must give the `DeployPreview` job an explicit
`- checkout: self` with `persistCredentials: true` (or add a token), otherwise
`ls-remote` fails and — correctly — the repoint fails closed.

**Why `*.vercel.app` only.** Standard Protection "protects all domains except production
domains" on every plan, so a `*.vercel.app` alias inherits Vercel Authentication. The
tooling refuses any other host: a fixed, unprotected copy of the site at a stable address
is exactly what step 7 warns against.

**The alias's `noindex` is application-supplied (AB#136, 2026-09-06).** Vercel adds
`X-Robots-Tag: noindex` to a Preview deployment's *generated* URL but **omits it for an
assigned domain or alias** (`vercel.com/docs/headers/response-headers`), so the alias
inherits Standard Protection but not that header — the AC5 exercise's first run proved it.
`next.config.ts` adds the header itself for requests whose `Host` is `PREVIEW_STABLE_ALIAS`,
gated to `VERCEL_ENV === "preview"` (`src/lib/preview-noindex-alias.ts`). Because it is a
static response header baked at build time, `PREVIEW_STABLE_ALIAS` is now **also a
build-time input**: the `DeployPreview` stage passes it into the `vercel build` step (it
is a variable-group value, so `vercel pull` does not write it), on the same footing as the
Sanity ids `next.config.ts` reads at build for the image-optimizer allow-list. A Preview
build with `VERCEL_ENV=preview` and no usable `PREVIEW_STABLE_ALIAS` fails closed. The
alias-host re-verification on every repoint still checks the SSO challenge *and* the exact
`noindex`; a `--prod` build never emits the rule.

**Rollback** (repoint the alias to a known-good earlier deployment by hand):

```bash
vercel alias set <previous-good-deployment-url> <PREVIEW_STABLE_ALIAS> --token="$VERCEL_TOKEN"
```

As with any rollback, an older deployment is only a safe target if its captured
environment values are still valid — a rotated secret needs a fresh deployment, not an
alias move (ADR-0004 §3, and "Promotion and rollback" below).

**Rotation** is two things, kept separate:

- *The alias name.* Change `PREVIEW_STABLE_ALIAS` in the variable group, run one Preview
  deploy so the new alias is assigned and verified, then update the Sanity webhook URL to
  the new host once. This is the only time the webhook URL changes.
- *The automation bypass secret* (`VERCEL_AUTOMATION_BYPASS_SECRET`). Vercel supports
  multiple named bypass secrets; rotate the pipeline's and, separately, the one the Sanity
  webhook itself carries as `x-vercel-protection-bypass`
  ([`cache-revalidation.md`](cache-revalidation.md)). Neither rotation touches the alias.

**Verification** — safe to run by hand at any time; it never assigns or removes the alias:

```bash
PREVIEW_STABLE_ALIAS=<host> VERCEL_AUTOMATION_BYPASS_SECRET=... \
VERCEL_TOKEN=... VERCEL_ORG_ID=... VERCEL_PROJECT_ID=... \
npm run verify:preview-alias
```

**Owner handoff.** The alias is a customer-owned Vercel resource, like the project and
its domains. Nothing about it — the host, the token, the bypass secret — lives in this
repository. At handoff, transfer or re-create it in the owner's team and rotate the token
and bypass secrets alongside every other credential.

**Exercise against Preview (owner-run, AB#136 AC5).** Run these against the real protected
Preview environment and record the evidence on the work item before the item is closed:

1. First assignment: enable the stage with `PREVIEW_STABLE_ALIAS` set, run a deploy,
   confirm the run's "Repoint the stable Preview alias" step reports `-> dpl_…` and that
   `npm run verify:preview-alias` passes.
2. Ordinary redeploy: run a second deploy from `main`; confirm the alias moves to the new
   deployment and the Sanity webhook still delivers **without editing its URL**.
3. Real signed delivery: mutate a document in the `preview` dataset and confirm
   `/api/revalidate` at `https://<PREVIEW_STABLE_ALIAS>/…` logs `state:"accepted"` — using
   the webhook's own `x-vercel-protection-bypass` secret, not the pipeline's.
4. Rollback and roll-forward: `vercel alias set` the alias to the previous deployment,
   verify, then run a deploy to move it forward again.
5. Rotation: rotate the alias name (and update the webhook URL once), then separately
   rotate the automation bypass secret; verify after each.
6. Protection intact: after every step above, `npm run verify:preview-alias` still passes
   (SSO challenge without the bypass, exact `noindex` with it).
7. Handoff dry-run: confirm the alias, token, and bypass secrets are all customer-owned
   and rotatable, and that none appears in this repository.

### The continuation cursor signing key

`GALLERY_CURSOR_SIGNING_KEY` signs every opaque continuation cursor this deployment
issues: for a gallery larger than one page (AB#72) and — since AB#140 — for a category
branch listing larger than one page (ADR-0013). **One shared secret signs both.** It sits
in the Sensitive, runtime-only row above deliberately: the build never issues a cursor, so
it never needs the key, and keeping it out of the build is what lets it stay unreadable
after creation.

Three properties are worth knowing before provisioning it.

**It must be one stable value per environment.** ADR-0003 decision 8 makes unfiltered
continuation URLs indexable, and serverless instances do not share a process. A value that
differed per deploy — or per instance — would 404 a cursor another instance had just
issued, so generating one at boot is not an option.

**Rotating it retires every continuation URL already issued and indexed** — gallery *and*
category-branch continuations. That is the same property that stops a forged token from
being spendable, so it is a cost rather than a defect, but it makes rotation a deliberate
act: expect crawlers to re-discover the continuation URLs afterwards, and do not rotate as
routine hygiene. Rotate it if the value leaks. Nothing else is invalidated — a gallery's or
a branch's own pages, and every parameter-free URL, are unaffected.

**It is read lazily, so a missing key is a late failure rather than a build failure.**
Nothing at build time issues a cursor, and a gallery or a category branch that fits inside
one page never needs one either, so neither `next build` nor the CI gate will tell you the
key is missing. The mock fixtures ship both a gallery and a category branch larger than one
page (and the reference Preview's Sanity seed ships the large gallery), so a deployment
needs the key: that page answers with a configuration error naming the setting while every
other route keeps working. Set it during provisioning rather than discovering it from a
single broken page later.

Generate one with `openssl rand -base64 48`. It needs 32 to 256 printable ASCII
characters, must not be prefixed `NEXT_PUBLIC_` (the application refuses that outright,
because Next.js compiles such values into the browser bundle), and must differ between
Preview and Production like every other secret.

### The routing Proxy is required

`src/proxy.ts` runs on every content request (Node runtime, see ADR-0007). Two behaviours
depend on it, so a host that cannot run it is not a supported target for this site:

- **Trailing-slash normalization.** `next.config.ts` sets `skipTrailingSlashRedirect`, so
  Next.js no longer emits its own `/path/` → `/path` redirect. The Proxy emits it instead,
  after a gallery continuation token has been validated — without that ordering an invalid
  cursor would produce the cached permanent redirect ADR-0003 decision 8 forbids. Without
  the Proxy, slash variants stop normalizing and serve duplicate content.
- **The 404 return link.** The refused pathname reaches the not-found boundary only as a
  Proxy-set request header. Without it those 404s lose their link back to the gallery.

Vercel runs it as part of the deployment; nothing extra is provisioned. It matters when
evaluating another host, or when putting a cache or proxy in front of this one: the two
project headers it sets (`x-photosite-request-path`, `x-photosite-request-has-cursor`) are
overwritten on every matched request, so an upstream layer cannot inject them, and it
should not be configured to strip them either.

### Canonical URLs on a Preview deployment

`SITE_CANONICAL_BASE_URL` is read when the site is **built**, and a Preview deployment's
URL is generated when it is **deployed** — after the build, and different for every
deployment. A prebuilt deployment also has no access to the platform's own system
environment variables during the build. So there is no honest way to make a Preview
deployment's canonical URLs point at itself.

Preview therefore declares a **fixed non-production origin**, and the canonical and Open
Graph URLs it emits point there rather than at the deployment being reviewed. That is
acceptable only because a Preview deployment is access-protected and carries `noindex`:
nothing is crawling those URLs. It is also a standing reason never to relax either
protection — a Preview deployment opened to the internet would advertise canonical URLs
for a site that does not exist at that address.

Do not point it at the production origin. A release candidate that names the live site as
its canonical home is one indexing accident away from competing with it.

## What the pipeline does

`azure-pipelines.yml` has three stages: Verify, DependencyAudit and DeployPreview.

**Verify** runs on every push and pull request to `main`: lint, the browser-free test
suite, the architecture-diagram check, the production build, and the Playwright journey suites.

After a failed Verify step, browser diagnostics are published only when the
`playwright-report` directory exists (AB#333). Since AB#377 they are also published
after a green run in which a test passed only on retry: the JSON reporter writes
`test-results/results.json`, and a nonzero `stats.flaky` keeps the failed attempt's
trace and screenshot, which a green run previously discarded. A missing or unreadable
results file counts as no flaky tests. Discovery uses the artifact task's
`System.DefaultWorkingDirectory`, so its relative path matches the unchanged
publication target. An earlier unit/build failure with no report emits a fixed
skip note and retains the original failure. Existing directories (including
empty or linked directories) still reach the artifact task; actual publication
errors remain visible. No report is created by discovery. The HTML reporter
continues to collect its existing screenshot/trace attachments.

**Fetching a run's report locally (AB#377).** `az pipelines runs artifact download`
needs the artifact tool's own interactive sign-in and otherwise fails with "Identity …
has not been materialized". The REST API returns a short-lived signed URL with the
existing `az devops` credentials instead; the report's `data/*.zip` files are the
Playwright traces (`npx playwright show-trace <zip>`):

```bash
az devops invoke --area pipelines --resource artifacts \
  --route-parameters project=photosite-starter pipelineId=1 runId=<run id> \
  --query-parameters artifactName=playwright-report '$expand=signedContent' \
  --api-version 7.1-preview -o json > artifact.json
curl -sL "$(jq -r .signedContent.url artifact.json)" -o playwright-report.zip
```

The URL expires within the hour; treat the downloaded traces as published CI artifacts
(the harness keeps credentials and personal data out of them).
Local Bash fixtures cover missing paths, regular files, reports with attachments,
empty directories and directory links. Live Azure evaluation still needs a
committed run: earlier gate failure without a report, browser failure with a
report, and cancellation. Missing JUnit warnings remain a separate existing
reporting behavior; this does not alter their task or the quality gates.

**DependencyAudit** runs daily at 06:00 UTC on `main`, even without a source
change, in the `Default` self-hosted pool. It audits the committed production
and development dependency tree without installing packages. Scheduled runs
skip Verify and DeployPreview, so the audit does not spend Microsoft-hosted
minutes or deploy a release candidate. The [dependency response process](dependency-security.md)
records actual runs and the outstanding notification-delivery check (AB#160).

### Offline lockfile-bound audit triage (AB#329)

`npm run triage:audit -- <paired-audit.json> <package-lock.json>` reads saved
inputs only. It never queries a registry, installs or fixes packages. Exit codes
are 0 (validated clean report), 1 (findings), and 2 (invalid input or IO).

The closed pairing envelope is:

```json
{"schemaVersion":1,"lockfileSha256":"<64 lowercase hexadecimal characters>","audit":{}}
```

Replace `audit` with the complete saved npm audit v2 JSON, and record the SHA-256
of the exact corresponding lockfile bytes **when capturing that report**. Copy
both into private operational storage; retain the original audit separately.
For a Node-only digest command:

```bash
node --input-type=module -e 'import {readFileSync} from "node:fs"; import {createHash} from "node:crypto"; console.log(createHash("sha256").update(readFileSync(process.argv[1])).digest("hex"))' package-lock.json
```

Record the lockfile hash before and after collecting the audit; if it changed,
recapture the pair. Do not attach an old report to a newly computed digest.
The helper verifies the supplied pairing, **not its capture provenance or report
freshness**. An operator can supply the wrong pair; equal paths do not prove
that the audit covered those versions. No advisory range or safe update is
inferred. Exact-byte hashes change with CRLF conversion or `autocrlf`; copy the
recorded file rather than regenerating it. A UTF-8 BOM counts toward the hash
and is accepted during decoding.

Supported inputs are v3 lockfiles and conventional lowercase npm package node
paths, including nested and scoped packages. A referenced link, alias or invalid
version is refused. Unreferenced lock entries are not interpreted. Regular-file
symlinks may be read; directories, FIFOs and devices are refused. Inputs are
bounded to 4 MiB for the envelope and 8 MiB for the lockfile, with 25,000 node
occurrences, 200,000 audit edges, 32 nesting levels and a 16 MiB projected JSON
budget. JSON uses native last-key-wins parsing; duplicate keys are not detected.

The report retains affected package names, relative node paths, exact recorded
versions, severity, inherited links, numeric advisory IDs and unverified registry
fix proposals. Raw titles, resolved URLs and arbitrary provider error text are
omitted. Lockfile `dev`, `optional` and `devOptional` flags are reported as
[declared by npm](https://docs.npmjs.com/cli/v12/configuring-npm/package-lock-json/#packages),
with absent flags shown as false; other flags are not interpreted. An all-false
record means none of these three markers was declared, including conventional
non-development dependencies; it is not an added `production` verdict. Optional
and mixed development/optional markers remain separate raw flags. These flags
say nothing about deployed bundle inclusion, request reachability or
exploitability. A suggested version, including a major downgrade, remains an
unverified proposal. AB#160's notification and live maintenance acceptance remain
open; this tool neither approves risk nor changes dependency versions.

### Scheduled audit capture and safe artifacts (AB#331)

The scheduled `DependencyAudit` job now invokes `npm run --silent capture:audit`.
The Node 24 POSIX wrapper executes the same npm CLI supplied by `npm_execpath`
with `shell:false`, explicit `--prefix .` / `--prefix studio`, the existing
`--include=prod --include=dev --audit-level=low` flags and `--json`. Explicit
prefixes bind the command to the lockfile being hashed even if a prefix was
inherited; registry and npm fetch/retry configuration are inherited unchanged.
There is one invocation per target, no wrapper retry, install or automatic fix.
Both fixed targets run after ordinary first-target findings or tool errors.

`Agent.TempDirectory`, `Build.ArtifactStagingDirectory`, `Build.BuildId` and
`System.JobAttempt` supply the CI-owned paths/identity. Raw paired envelopes go
only to a private mkdtemp directory outside both checkout and artifact trees.
Only the exact newly created `dependency-audit-<BuildId>-<JobAttempt>` leaf can
be published as `dependency-audit-<JobAttempt>`. The two safe triage files are
written exclusively, then the summary manifest is committed last. A false-by-
default readiness variable becomes true only when current output and private
cleanup complete. The artifact task additionally requires
`succeededOrFailed()`, which excludes cancellation. Azure's documented
[step variables and conditions](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/conditions?view=azure-devops#step-variables-used-in-subsequent-step-conditions)
and [job-attempt identity](https://learn.microsoft.com/en-us/azure/devops/pipelines/build/variables?view=azure-devops)
provide this wiring; actual committed service execution remains to be checked.

Limits: stdout 4 MiB minus 512 bytes of envelope allowance, stderr 64 KiB,
lockfile 8 MiB, each projected report at AB#329's 16 MiB bound, and a deliberate
120-second deadline per audit plus at most two seconds of kill/pipe settlement.
The raw cap also counts pretty-printing whitespace, so it is conservatively
stricter than the triage helper's compact-JSON cap. Native process-group cleanup
is POSIX-only; Windows refuses. Lockfiles must be regular non-symlink files;
a symlinked Studio directory or alternate `npm-shrinkwrap.json` / `yarn.lock`
profile is explicitly unsupported. This is not a claim about npm precedence.

Gate exits preserve `--audit-level=low`: 0 for clean or info-only findings,
1 for low-or-higher findings, 2 for tooling/input failure. The triage report's
`findings` status remains independent; info-only is never relabelled clean.
Safe manifests can record tooling failures without inventing target reports.
No raw provider output is streamed, and errors use fixed classes only. Local
same-operation digest bracketing preserves AB#329's false provenance/runtime
flags. It does not prove registry attestation, capture beyond the local command,
no lockfile ABA race, package reachability or that a suggested fix is safe.

Synthetic tests verify wrapper-level cancellation, not actual forwarding by
npm/Azure or queued-stage evaluation. First committed scheduled capture,
publication/privacy/retention and cancellation evidence remain outstanding.
The [dependency response process](dependency-security.md) retains AB#160's
notification and operational acceptance checks.

### Cancelling a run

Both quality and scheduled-audit stages retain Azure's default `succeeded()`
status guard alongside their `Build.Reason` predicate (AB#189). The reason-only
condition previously admitted Verify after cancellation: run
[#546](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=546)
reported that its custom condition re-evaluated to true while waiting for an agent.
DependencyAudit is independently admitted with `dependsOn: []`; Verify is the
first stage. The success guard also preserves dependency-success gating if a
prerequisite is added later. Pool, fork admission and Preview conditions are unchanged.

Azure [custom-condition semantics](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/conditions?view=azure-devops)
require an explicit status check when replacing a default condition. Local YAML
parsing cannot prove service-side evaluation. After merging, cancel a trusted run
while its stage waits for an agent and confirm the stage does not start; repeat
for a scheduled audit when available. This live check remains pending until the
changed YAML is committed and run. Cancellation of already-running steps remains
Azure's normal cancellation process.

### The Verify stage runs on a self-hosted agent

`Verify` runs in the organization's `Default` pool, a self-hosted agent, not a
Microsoft-hosted `vmImage`. The free Microsoft-hosted tier for a private Azure DevOps
project is one parallel job capped at 1,800 minutes/month; this pipeline's own journey
suite exhausted that quota (2026-09-16), and an additional Microsoft-hosted parallel job
is a recurring $40/month while an additional self-hosted one is $15/month — the
organization already had one self-hosted parallel job free and unused. The move saved
hosted minutes, but `npm ci` and repository scripts execute on a persistent machine.
No deployment credential is injected into the `Verify` job, but the current agent
runs under the operator's Unix account and can read credentials stored on that host.
It must admit only trusted same-repository code (see AB#184 below), and it must never
share its host with `DeployPreview` or another secret-bearing job.

**Quality-gate timing and concurrency (AB#378, 2026-10-20).** Baseline from PR runs
1316/1320/1325: Verify stage 1 391/1 507/1 387 s, of which end-to-end 1 176/1 298/1 178 s;
install 22 s, lint 16 s, unit tests 73 s, deployment-settings build 18 s, Studio job 32 s in
parallel. The harness build inside the Playwright `webServer` takes about 6 s, so the two
builds are kept: they check different settings and together cost about 24 s. Main run 1326
summed 2 311 s of test time across 1 847 tests into 1 183 s of wall time on two workers, with
no test over 16 s. Measured on this agent (24 CPUs, 31 GB) with CI settings: four workers
805 s, 0 failed, 0 flaky, at least 7.5 GB free; six workers 662 s but 9 failed and 2 flaky,
5.6 GB free. `ciE2eWorkers` is therefore 4 and applies to Playwright only. Vitest has its own
`ciTestWorkers`, measured separately on 2026-10-21 (three runs each, 8 527 tests, all passing):
2 workers 73.8 s, 4 workers 41.6 s, 6 workers 31.0 s; it is 4. AB#293's unexplained agent disconnects
are why this stays a one-line, reversible setting: set `ciE2eWorkers` back to `"2"` if an
agent disconnect or new contention flake appears. Main CI runs are batched
(`trigger: batch: true`): merges that land during a run are built once, as the newest
commit, after the whole current run (DeployPreview included) has finished. PR validation is
not batched. Result over 18 four-worker runs (2026-10-20/21): Verify median ~981 s,
end-to-end ~770 s. Batching observed 2026-10-21: run 1363 built `59c2d37` (#566); the 13 merges that
landed while it ran (#552–#563, 08:17–08:34 local) were built once, as run 1364 of the
newest commit `fd2e619`, started as soon as 1363 finished; no intermediate commit got a run.

`DeployPreview` was briefly moved to the same self-hosted agent on 2026-09-16 to avoid
the $40/month Microsoft-hosted cost entirely, then moved back the same day once an
independent Codex review caught what that shared: `Verify` also runs pull-request code
on that same persistent machine, and a persistent agent doesn't reset between jobs the
way a Microsoft-hosted one does — so a compromised dependency pulled in by a PR's own
`npm ci` could leave something behind (a modified `PATH` entry, a wrapped binary) that a
later `DeployPreview` run on the same machine picks up alongside the real
`photosite-starter-vercel-preview` Vercel token, automation bypass secret, and Sanity
build read token in that job's environment. That is a materially different risk from
"a credential touches a personal machine" — it is "PR-triggered code gets a path to a
deployment credential" — so `DeployPreview` **stays on `vmImage: "ubuntu-latest"`**.

**It did not recover by 2026-09-24.** Every `main` run from 2026-09-23 failed in
`DeployPreview` with "Your organization has no free minutes remaining", while `Verify`
(self-hosted) kept passing. At that 2026-09-24 check, no Preview deployment had
been created after 2026-09-23 11:54, so
merged changes did not reach Vercel — and when data changed ahead of code (the rally
gallery conversions, AB#170), every converted gallery answered 500 on the deployed code
until a manual release was made.

**Recovery evidence, 2026-10-01–02:** [manual main run #488](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=488)
passed Verify and DeployPreview on 2026-10-01 for revision
`02d46471b092cdb7edba114d503e467872dac168`. The later automatic
[main CI #501](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=501)
passed both stages on 2026-10-02 for revision
`06e0f081c8e2cc894e582ce945b1bd1b3f8e884e`, including identity, access-protection,
noindex and stable-alias checks. This proves Preview delivery had resumed for
that revision; it does not establish the remaining hosted-minute balance or
deployment of a later merge. **Check `az pipelines runs list --branch main` and
`vercel ls` before assuming a merged change is live.**

### When the pipeline cannot deploy

A gated manual release, done by the owner or by an agent the owner has authorized for
that deployment. "Gated" means the commit is the tip of `main` **and** its `Verify` stage
succeeded; never deploy a checkout with local changes or an unverified commit.

```bash
git checkout main && git pull --ff-only          # a clean tree at the verified tip
npm ci                                          # install the reviewed lockfile
./node_modules/.bin/vercel pull --yes --environment=preview
./node_modules/.bin/vercel build --target=preview
./node_modules/.bin/vercel deploy --prebuilt --target=preview --archive=tgz
```

The CLI version comes from the reviewed lockfile. The CLI must already be
authenticated as the owner; no token is put on a command line. A Preview deployment is
behind Vercel Authentication, so verify it with `vercel curl <path> --deployment <url>`
rather than `curl`. What this does **not** do: it does not run `verify:preview`
(its secrets live in the pipeline's variable group), and it does **not** repoint
`PREVIEW_STABLE_ALIAS` — repoint that only with the guarded script, or the Sanity
webhook keeps reaching an older deployment. Record such a release on the work item it
served.

For the production-target deployment use the staged sequence in "Promotion and rollback"
below: `--skip-domain`, smoke-test, then an explicit owner approval before
`vercel promote`.

### A production-target deployment exists

`photosite-starter.vercel.app` is served by a deployment whose target is `production`,
first created 2026-09-22 (its origin is not recorded; it was not produced by AB#18's
sequence). It is public, reads the `production` Sanity dataset, and is **not** protected
the way a Preview is. On 2026-09-24 it was replaced with a release built from the tip of
`main` through the staged sequence below, with the owner's approval of the deploy and of
the promote; the previous deployment (`photosite-starter-bx2ijzv9x`) stays available as the
`vercel rollback` target. Whether this address stays public is AB#18's decision.

Registering the agent (owner-run, on the machine that will build):

1. Azure DevOps → user settings → **Personal access tokens** → create one scoped to
   **Agent Pools (Read & manage)** only, with a short expiry. This token is typed once
   into the agent's own setup prompt and is not this project's `az devops` credential.
2. Download the Linux x64 agent package from the organization's **Organization
   settings → Agent pools → Default → New agent** page (the download link is
   version-pinned per organization; there is no stable public URL to hardcode here).
3. Extract it into its own directory and run interactively:
   ```bash
   ./config.sh --url https://dev.azure.com/ilkkarytkonen --auth pat \
     --pool Default --agentName <machine-name>
   ```
   Enter the PAT from step 1 when prompted; accept the default work folder.
4. Run it as a persistent service so a queued build does not wait on the machine being
   awake with a terminal open: `sudo ./svc.sh install && sudo ./svc.sh start`.
5. `UseNode@1` installs the pinned Node major itself, but Playwright's browser OS
   dependencies are the operator's own one-time step, not the pipeline's: run
   `sudo npx playwright install-deps chromium webkit` once on the agent host. Playwright's
   own `--with-deps` flag always re-invokes `sudo sh -c "apt-get ..."` internally, which
   cannot succeed non-interactively (`sudo: A terminal is required to authenticate`)
   without granting effectively unrestricted passwordless root — sudoers cannot scope a
   `sh -c` invocation any narrower than that, since the script body is arbitrary. A
   persistent self-hosted agent doesn't need to reinstall the same OS packages on every
   run the way a fresh Microsoft-hosted `ubuntu-latest` image would anyway, so the
   pipeline step omits `--with-deps` (just `npx playwright install chromium webkit`) and
   this one-time manual step replaces it — re-run it after a Playwright version bump
   changes which system libraries a browser needs.

The tradeoff this accepts: `Verify` only runs while the registered machine is powered on
and the agent service is running. A queued run waits rather than failing, but a
photographer relying on this template for real CI should weigh that against the $40/month
Microsoft-hosted alternative once the free self-hosted allotment is not enough (e.g. a
second concurrent pipeline).

**AB#184 runner admission and reset (live read-back 2026-09-29).** These are this
project's Azure settings, not values a template clone inherits. Recheck them in each
clone before its first PR build:

| Boundary | Observed control |
| --- | --- |
| GitHub and Azure admission | The GitHub repository is public, with one collaborator visible to the repository API. This Azure organization has one project and one pipeline (definition `1`). Project pipeline settings report `forkProtectionEnabled=true` and `buildsEnabledForForks=false`; definition revision `3` also has `pullRequest.forks.enabled=false`, `allowSecrets=false`, and `allowFullAccessToken=false`. The same-repository `main` PR trigger stays enabled. |
| GitHub source connection | Definition `1` uses the `Alpine78` GitHub service connection, whose live `authorization.scheme` is `OAuth`. Its access follows that OAuth grant and the authorizing GitHub identity, not a GitHub App's selected-repository installation setting. The OAuth grant's exact reach was not inspected. A separate Azure Pipelines GitHub App installation, if present, has not been checked: the available GitHub token cannot read personal-account installation settings. Do not claim that this pipeline's GitHub access is restricted to this repository. |
| Job token | Project settings report `enforceJobAuthScope=true` and `enforceReferencedRepoScopedToken=true`; definition `jobAuthorizationScope=project`. The project setting also overrides a broader definition value, so the effective Azure job scope is the current project. This YAML checks out only the GitHub `self` repository and declares no other repository resource. These Azure job-token controls do not narrow the separate GitHub OAuth grant. |
| Verify pool and protected resources | Organization pool `Default` (`1`) maps to project queue `10`. It has one enabled, online Ubuntu 26.04 agent (`17`); the queue's pipeline-permissions API authorizes only definition `1`. The Preview variable group (`1`) authorizes only definition `1` and is referenced only by `DeployPreview`, on a Microsoft-hosted agent. No other Azure project or pipeline appeared in the organization listing. |
| Actual agent host | Azure's agent hostname matches this development host. The systemd agent service runs as the operator's ordinary Unix user, with `DynamicUser=no`, `ProtectHome=no`, `PrivateTmp=no`, and `Restart=no`. The same user can read local CLI credential stores and this checkout's `.env.local`; no credential content was read. The agent service has no host-reset step, and no agent-specific reset was found among systemd timers, the operator's crontab, or system cron jobs. A reset performed out of band cannot be ruled out from these checks. Other local processes share this host. |
| Build Service ACL | The `photosite-starter Build Service` is project scoped. Its inspected effective masks are Build `1089` (view builds and definition; update build information), Project `649` (read project, publish/view test results, update build), Azure Repos `0`, and Library `1` (view). Unused build-quality, queue-management, check-in-override, test-configuration-management, and Azure Repos read/tag grants were removed. No direct ServiceEndpoints or DistributedTask grant was present. The GitHub checkout uses its source connection, not Azure Repos permissions. |

The existing OAuth source connection is an explicit access-scope exception: this
change preserves it to keep the trusted checkout working while closing the fork
admission gap. Its repository reach has not been shown to be limited to `self`. If
repository-only access is required, replace it in a separately verified change with
a GitHub App connection installed for only this repository and retest trusted PR
verification. [Microsoft's GitHub repository guidance](https://learn.microsoft.com/en-us/azure/devops/pipelines/repos/github?view=azure-devops)
distinguishes OAuth from GitHub App authentication.

The central `enforceNoAccessToSecretsFromForks` field still reads `false`: two PATCH
attempts, including a full settings body, returned the unchanged value while fork
builds were disabled centrally. Treat the central **build block** and the definition's
`allowSecrets=false` as the verified gates; do not claim that secondary central flag
is enabled. This flag was checked by configuration read-back only. No fork PR was run. Trusted same-repository PR #210 passed Azure run #450 before
these live settings changed. After the definition and ACL changes, manual `main`
Verify-only run [#453](https://dev.azure.com/ilkkarytkonen/photosite-starter/_build/results?buildId=453)
passed all gates with `DeployPreview` explicitly skipped; it used the already merged
`main` YAML. Azure also compiled this branch's proposed `workspace.clean: all` YAML in
a nonexecuting preview. A new trusted PR must exercise that YAML and the unchanged PR
trigger after the change before AB#184 can be considered fully validated.

The Verify job requests `workspace.clean: all`, which deletes its previous
`$(Pipeline.Workspace)` **before** the next job once this YAML is merged. It does not
erase files or processes elsewhere on the persistent host and is not a sandbox. The
observed host shares the operator's user account and credentials. No separate automatic
host reset was found in the inspected service or schedules; no isolated agent user is
configured. Treat the runner as **trusted-code only**; review every same-repository PR
and dependency change before it executes here. If host integrity is in doubt, disable
the agent and rebuild the host before admitting another trusted run.

Never enable external fork PRs by flipping either Azure gate alone. First decide and
record an ephemeral or isolated execution model with no trusted host-state reuse, no
secret access, and reviewed admission; then update and test both central and definition
settings. Microsoft documents the [fork controls](https://learn.microsoft.com/en-us/azure/devops/pipelines/repos/github?view=azure-devops), [job-token scope](https://learn.microsoft.com/en-us/azure/devops/pipelines/security/secure-access-to-repos?view=azure-devops), and [workspace-clean limit](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/phases?view=azure-devops).

**Preview release candidate** runs only when all four of these hold:

- every gate above passed;
- the run is not a pull-request build — a PR branch, a fork's above all, never receives
  Preview, provider, or protection-bypass secrets;
- the branch is `main`, which is what a release candidate is;
- `PREVIEW_DEPLOYMENT_ENABLED=true`, set only after the customer-owned variable group,
  Vercel project settings, and every credential are ready.

It then checks that provisioning is complete (failing by name if it is half done),
installs the pinned Vercel CLI, pulls the Preview configuration, builds, and deploys the
prebuilt output, so the provider does not rebuild it remotely and the deployment runs
what the pipeline log accounts for — a rebuild of the gated commit against the real
Preview configuration, not the gate's own fixture-built artifact. Before a project
secret is sent to the deployment, the pipeline resolves the generated URL through
Vercel's authenticated API and compares its immutable deployment ID, project ID, owner
ID, and hostname with the expected values. It verifies the deployment; then — unless
`main` has already moved past this commit — repoints `PREVIEW_STABLE_ALIAS` at it and
re-verifies access protection and `noindex` on the alias host itself (AB#136 / AB#144 —
see [The stable Preview integration alias](#the-stable-preview-integration-alias)); and
only then publishes the URL to the run summary. A failed or unverified deployment never
reaches the repoint step, so the alias keeps pointing at the last deployment that passed.
The whole stage holds an exclusive lock, so two runs cannot repoint the alias at once.

## Verifying a release candidate

```bash
npm run verify:preview -- https://<deployment>.vercel.app dpl_<immutable-id>
```

The command expects `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `VERCEL_TOKEN`, and
`VERCEL_AUTOMATION_BYPASS_SECRET` in its environment; the pipeline supplies them without
putting them on the command line. It first asks Vercel's authenticated API for the
deployment and refuses a missing or mismatched private identity field. Only after that
binding succeeds does it make two requests, because the two publication properties are
independent and neither substitutes for the other:

- **Without the bypass header**, the deployment must refuse the request. `noindex` asks a
  crawler not to list a URL; it asks nothing at all of a person who has it.
- **With the bypass header**, the response must carry the exact, unscoped
  `X-Robots-Tag: noindex` that Vercel documents. Protection
  keeps crawlers out today; the header is what keeps the URL out of an index if
  protection is ever relaxed.

Anything else fails, including answers that prove neither — an unverified deployment is
not a protected one. The secret is read from `VERCEL_AUTOMATION_BYPASS_SECRET` and sent
in a request header. Never put it in the URL: the provider accepts it as a query
parameter, and a URL carrying a secret survives in build logs, referrers, and request
telemetry long after the deployment is gone. The script refuses a URL with a query string
for that reason.

The decisions live in `scripts/preview-verification.mts` and have tests. The small IO
boundary is `scripts/vercel-preview-api.mts`; the identify, verify, and cleanup commands
call it without adding an SDK dependency. If verification fails or the run is cancelled,
the cleanup step rechecks the immutable `dpl_…` ID through the same API and deletes
exactly that deployment. If the first URL-to-ID lookup itself failed after deployment,
cleanup authenticates the captured generated URL, binds the API answer to the expected
project and team, and sends only the returned immutable ID to the DELETE endpoint. It
never passes a captured value to the multi-purpose `vercel remove` command, where a
project name would mean a much broader operation. These scripts run on the Node major
pinned in `package.json`, which executes TypeScript directly.

The release API client applies a **16 MiB decoded JSON-response budget** and one
original **20-second deadline per network attempt**, including headers and body
reads (AB#347). These are local engineering budgets, not Vercel limits or proof
that arbitrary deployment metadata fits. An alias lookup followed by a deployment
lookup still consists of two separate attempts. Unused and late bodies receive
observed, nonblocking cleanup; cleanup never authorizes another request.
Malformed, oversized or timed-out mutation acknowledgements leave the remote
outcome unverified. They do not establish that assignment/deletion was unapplied,
and they do not authorize resubmission. The existing fresh-read conditional alias
recovery and exact deployment `DELETED`/UID acknowledgement checks remain in force.
Diagnostics exclude provider-controlled alias prose. Offline regression evidence
does not establish live provider behavior or complete AB#18/117 acceptance.

## Promotion and rollback

**Recorded; AB#18 still owns the first production build.** AB#118 exercises rollback
before handoff. Both are named here because ADR-0004 §3 requires the mechanism decided
before the first deployment, not discovered during the first incident. The staged
sequence below was run once by hand on 2026-09-24 (see "A production-target deployment
exists"); that does not complete AB#18.

The owner accepted [AB#132's temporary scriptless-404 residual](adr/0007-proxy-request-path-boundary.md#2026-10-07-owner-accepted-temporary-residual-risk-ab132)
on 2026-10-07; AB#132 comment `59465` records impact, reason, review date and
follow-up, and AB#18 comment `59466` links that decision. Its 2026-10-08 review date
has passed. The [2026-10-18 recheck](adr/0007-proxy-request-path-boundary.md#scriptless-404-recheck--2026-10-18-ab132)
does not renew acceptance: before AB#18 promotion, obtain a new explicit owner
decision with impact, reason, review date and follow-up, or a verified fix, and
retest the exact candidate. Scriptless probes remain known semantic failures;
acceptance does not make them passing journeys. AB#132 stays Active.

AB#186's dependency gate is Closed: zero full and production-only audit findings
and a passed exact-main CI #655 authenticated protected Preview with the patched
CLI tree ([current evidence](audits/ab137-renderer-readiness-2026-10-07.md#merged-source-and-dependency-gate)).
AB#117, AB#137 and AB#18 retain their independent Active gates.

The owner keeps the existing Hobby subscription for now and will reconsider later
(AB#18 comment `59467`). [The dated hosting preference](adr/0004-reference-production-host-and-ownership-boundary.md#amendment-2026-10-07-ab18-ab117--current-hobby-preference)
is recorded separately from the unresolved suitability of commercial launch content.
No billing change or provider exception is established by that preference.

Promotion stages a production build without routing traffic to it, smoke-tests that exact
deployment, and then promotes the same build without rebuilding:

```bash
vercel pull --yes --environment=production --token="$VERCEL_TOKEN"
vercel build --prod --token="$VERCEL_TOKEN"
vercel deploy --prebuilt --prod --skip-domain --token="$VERCEL_TOKEN"
# smoke-test the staged deployment, then, after owner approval:
vercel promote <deployment-url> --token="$VERCEL_TOKEN"
```

### Scripted release (AB#379)

`npm run release:production` runs the sequence above from the **primary checkout**, with the
owner's own `vercel` and `az` logins; it reads no token and prints no environment value.
It is bound to the project in `.vercel/project.json`: a `VERCEL_PROJECT_ID`/`VERCEL_ORG_ID` in
the shell naming anything else is refused, API reads pass that `teamId`, and `vercel curl` and
`vercel promote` run with `--scope` set to it.
Two owner-run steps, so the approval between them stays explicit:

```bash
npm run release:production -- check   # optional, read-only: would a release start right now?
npm run release:production -- stage
# review the printed candidate, smoke results and receipt, then:
npm run release:production -- promote --receipt temp/releases/<run>/03-staged.json --confirm <candidate dpl_id>
```

`check` runs only `stage`'s read-only preflight below and prints the current routing (each
project domain, its deployment and redirect, generated and unrelated aliases) and the rollback
command. It takes no lock, creates no evidence directory and runs no install, build, deploy,
curl or promote; `git fetch` is its only local change. Its result is a snapshot at the time
checked: `stage` repeats every check, and build, deployment and candidate verification are not
covered by it.

`stage` refuses unless the checkout is a clean `main` exactly at the fetched `origin/main`
**and** a completed, succeeded, non-scheduled main CI run exists for that exact revision (a
scheduled run is only the dependency audit and skips Verify). The candidate is polled until
READY, since a prebuilt deploy returns earlier. It reads the
complete alias inventory and the project's production domains (no Git-branch or custom
environment binding; every Vercel API read names the linked team) and refuses a split baseline (a project
domain missing or on a different deployment). It writes `01-prepared.json` with the previous
production deployment and the documented rollback command **before** deploying. Then it
runs `npm ci --include=dev`, removes any stale `.vercel/output`, runs `vercel pull --environment=production`
and `vercel build --prod`, and rechecks the checkout. It deploys with
`--prebuilt --prod --skip-domain --archive=tgz --meta gitCommitSha=<sha> --meta gitDirty=0`
and records `02-deployed.json` as soon as the command returns. The candidate is read back
(`verifyReleaseSource` plus a strict `target: production`), and the alias inventory is compared
again, and the candidate's own URL must challenge an anonymous request with Vercel's
authentication redirect (`classifyProtection`; a 401/403 is not proof) and answer an
authorized request with `X-Robots-Tag: noindex`. Project domains must still serve the previous deployment with unchanged redirects,
and no other alias may change. A generated alias that followed the candidate is reported
with its exact `vercel alias set` restore command and recorded as accepted. Smoke paths are
`/`, `/robots.txt`, `/sitemap.xml` and an evenly spaced sample of the candidate's own sitemap
(same canonical origin; sitemap indexes refused). Every path must answer 200 through
`vercel curl`; matching a failing production is not a pass. The result is `03-staged.json`
with `verdict: pass|fail`; production is not changed.

`promote` accepts only a version-1, passed stage receipt whose candidate id equals
`--confirm`. It rechecks CI, rereads routing (production still on the previous deployment;
only the generated aliases recorded at staging may point at the candidate) and the
candidate. It writes `04-promote-attempted.json` and runs `vercel promote`. A failed or
timed-out promote is treated as an uncertain outcome and read back either way: every
production alias must serve the candidate within a minute, and each project domain must
answer over public HTTPS (200, or the recorded redirect); every other alias, such as the
stable Preview alias, must be unchanged. It ends with `05-verified.json` or
`05-failed.json` and always prints `npx vercel rollback https://<previous> --scope <team>`. It never deletes
deployments, changes environment variables or touches the stable Preview alias.

Evidence lives in a new private directory under the ignored `temp/releases/` (owner-only
modes, exclusive writes, selected fields rather than raw provider responses); a lock
directory prevents two local releases at once. Dashboard or manual alias changes during a
release remain a race the script detects only at its next readback. `vercel pull` writes the
Production environment file into the ignored `.vercel/` directory exactly as the manual
sequence did. The rollback caveats below apply unchanged.

Check the public Production domain **and the generated project/team alias** before and
after staging, using the authenticated deployment API and immutable deployment IDs.
During the 2026-10-04 AB#137 remote-build rehearsal, `--prod --skip-domain` kept the
public Production domain on the old deployment but reassigned the protected generated
team alias to the candidate. The operator restored exactly that alias to its original
deployment and verified both targets. Do not infer that every alias stayed put from
the flag or the CLI's success message; keep the original IDs and single-alias restoration
operation ready. Smoke the candidate through its immutable generated URL, retain
deployment protection, and never forward a bypass header through a redirect.

The 2026-10-04 remote build was a one-time operator staging rehearsal after a local
Production environment copy was blocked. The Azure/prebuilt release path and its
phase-separated Sanity credentials remain the documented delivery design. Vercel's
remote builder receives the [configured Production environment](https://vercel.com/docs/environment-variables), including Sensitive
values; it does not preserve the prebuilt build/runtime credential split. Its source
identity was verified against the original uploaded archive, rather than inferred from
absent provider Git metadata. This protected rehearsal does not authorize promotion
or replace the launch gates or the Azure/prebuilt release path above.

The initial 2026-10-05 protected renderer preparation used a **manual prebuilt** build from
the unchanged, CI-verified main revision. Only named public configuration values entered
the local build; the Production dataset is public and needs no build read token.
Runtime Sensitive values stayed provider-side. The uploaded archive's physical outputs,
function aliases and mapped runtime files all matched the local manifests. Both existing
aliases stayed on the old deployment, and protected FI/EN route and gallery-continuation
checks passed. This is operator evidence, not an Azure Production build or launch approval.
Production contact-delivery settings were absent at that initial checkpoint. The later
checkpoint below supersedes that provisioning status; rendering GET checks do not
test email delivery.

**Later checkpoint, 2026-10-05 (AB#137):** PR #246's merged source
`4b8dd013880eddf79e54e42244d18f5cda32d860` passed main CI #545, including the
Playwright gate. A new manual prebuilt candidate from that exact source reached READY.
The subsequently merged documentation-only change did not alter its runtime or build
inputs. All 607 uploaded members match the local manifests. Only 14 public build
settings entered the build; the temporary local configuration was removed and the
original project link restored. Runtime contact settings and Sensitive credentials
remain provider-side. No new Sanity write credential was created.

Both generated aliases and the project's Production target remained on the previous
deployment after a settling check; the complete project-domain inventory contains no
custom domain. A separate anonymous readback found the default project alias publicly
serves that old deployment with HTTP 200, while the generated team alias redirects to
Vercel login. The immutable candidate URL is challenged anonymously and its authorized
responses carry noindex. Activating the default alias would change public serving code;
the project protection setting alone does not establish every alias's access behavior.
Fourteen current-content route/pagination GETs passed. Contact GET plus four rejected
POST cases passed without sending. The owner has already verified real delivery and Reply-To on the preceding candidate. `CONTACT_DELIVERY_ADAPTER`,
sender, recipient and `RESEND_API_KEY` are now configured for Production; a real email
from this revision is still unverified. Its current CMS notice must cover the new
fields and actual processors; see [the contact checkpoint](contact-data-flow.md#2026-10-05-account-and-notice-checkpoint).

The raw-document and asset metadata manifests still equal the complete baseline.
Approved writer dry runs and collisions/quotas were rechecked. All 3,512 derivatives
pass full-frame dimension and metadata checks; seven match existing assets, and 3,404
unique hashes demonstrate why row counts cannot predict created asset IDs. Keep all
1,748 baseline IDs protected and record actual new IDs during any write. Repeat the
complete freshness and collision checks immediately before a later write.

This evidence leaves activation, import/audit/revocation and the public launch open.
AB#132's scriptless recovery still fails on the exact local build, and AB#186's fresh
advisories need a current residual decision before earlier promotion. Production hosting,
AB#141's physical-device check, AB#19's remaining route decisions and AB#117's live-account
review also remain gates. The October 8 go/no-go and October 15 legacy-host deadline
are unchanged; preserve Infomaniak mail and change only approved web records at cutover.

**2026-10-07 dependency gate update:** the October 5 dependency conclusions
above are historical. PR #281 and main CI #655 verified the remediated CLI tree,
including authenticated protected Preview deployment; AB#186 is now Closed.
[The fresh renderer checkpoint](audits/ab137-renderer-readiness-2026-10-07.md)
records the current preparation and the still-open activation/import/launch gates.

Before publishing a CMS batch with a new field representation, verify compatibility
against the deployment actually serving each public alias. A merged adapter and a
protected candidate do not establish that the current public deployment can read it.
The 2026-10-05 AB#137 check found that the September 24 public renderer omits inline
`spans` and `richItems`, making 14 pages in the approved batch unreadable there. Keep
the CMS write gated until compatible code is live; do not remove approved links to
fit the old renderer. Re-read the complete raw revision manifest immediately before
the write and require equality with the verified full baseline, or capture a new
baseline. Record actual created document/asset IDs and preserve pre-existing or shared
assets during any separately authorized rollback.
Vote receipts or tally updates count as baseline drift too: take a new stable baseline
before writing and defer the import if ongoing votes prevent one. Do not silently
exclude that data from the comparison. The two polls in the October 5 baseline are
closed historical polls, so they cannot accept new public votes.

An old code rollback after importing new representations can make those pages unreadable
again. Recheck compatibility with the imported batch before selecting a rollback target;
the pre-import deployment is not automatically a safe code-only rollback afterward.

Rollback repoints production at the last known-good deployment:

```bash
vercel rollback <deployment-url> --token="$VERCEL_TOKEN"
```

What rollback does **not** undo is the part worth knowing before needing it. It restores
that deployment's code and the environment values captured for it — and nothing else. It
does not roll back CMS content, email-provider state, or any other external system. A
deployment whose credentials have since expired or been rotated is not a safe target
merely because its code is known-good, and secret rotation requires a new deployment.
AB#118 owns the full runbook, including cache-tag invalidation after a promotion or
rollback (AB#83).

## Logs and telemetry

For Production failure diagnosis, proposed escalation thresholds, and the controlled
failure record, use the [AB#159 runbook](production-failure-triage.md). This is prelaunch
preparation: the alert decision and live failure trace remain pending after AB#18;
AB#118 owns exercised rollback and handoff. AB#159 remains Active.

Two separate things, with different owners:

**The application's own events** contain a random correlation identifier, a state, and a
redacted error class. No form content, no webhook bodies, no credentials, no client
identifiers. That boundary is enforced in code and documented in
[`contact-data-flow.md`](contact-data-flow.md).

**The hosting provider's request telemetry** is not the application's to shape. Runtime
Logs record request metadata — path, query, user agent, status, region, request id — and
Vercel acts as a controller for personal data in service-generated data, under
provider-defined purposes that application code cannot narrow. ADR-0004 records the
boundary the project owner accepted on 2026-08-04, and no log drain is added.
**Preview** currently runs on Hobby, where Runtime Logs retention is one hour and
Observability Plus — which would raise it to 30 days on Pro — is not available to
enable at all; there is no operator seat to limit, since Hobby has no RBAC and the
live team is confirmed to be exactly one member. **Production's tier is unresolved**
(`docs/adr/0004-reference-production-host-and-ownership-boundary.md`'s 2026-08-25
amendment) and stays on this ADR's original Pro Decision until AB#18 reconsiders it —
this paragraph's Preview facts are not a Production privacy-boundary conclusion. The
production launch review (AB#117) re-read and recorded the current Preview provider
terms, retention, and access posture on 2026-08-25
(`docs/security-privacy-review.md`'s AC3 section), and closed that inspection for
Preview specifically — the Production privacy boundary remains open until the tier is
decided and this section is re-read against whichever tier AB#18 chooses.

The pipeline holds to the same line: the deploy job prints a deployment URL, statuses, and
robots directives. It never prints a response body, a token, or a bypass secret.

## What this does not do

- **No custom production domain or DNS record exists.** Nothing here touches the
  registrar or the authoritative nameservers.
- **AB#18's production launch has not happened.** A production-target deployment does
  exist on the project's `*.vercel.app` address and was promoted by hand on 2026-09-24
  (see above), but the production environment review, the domain, and the hosting-tier
  decision are still open, and rollback has not been exercised (AB#118).
- **Nothing here is a legal compliance conclusion.** Each deployment owner remains
  responsible for its own privacy notice, processing record, provider terms, and review.
- **A passing verification proves two properties**, access protection and non-indexability,
  at one moment on one URL. It says nothing about what the provider logs, and it is not a
  substitute for the launch review.

## Offline web DNS comparison (AB#200)

Before changing DNS, export the **complete current zone** privately and normalize it
into `{"zone":"example.test","records":[{"name":"@","type":"A","value":"192.0.2.1","ttl":300}]}`.
This local format is not a raw provider export. Records require name, uppercase type,
value and integer TTL in seconds; an optional integer priority is preserved. Relative
owners are appended to the zone; absolute owners must end in a dot; `@` is the apex.
ASCII case/trailing dots normalize in names and CNAME targets. TXT, MX, SRV, CAA and
other RDATA remain byte exact: concatenate TXT chunks yourself without trimming or
adding spaces. CNAME targets are absolute names, with an optional terminal dot.

Supply a second proposed snapshot and a JSON array of explicit web owners, e.g.
`["@","www"]`, to `npm run check:dns-cutover -- before.json after.json web-hosts.json`.
Each input must be an ordinary file (a symlink to a regular file is accepted),
limited to 4 MiB and decoded as strict UTF-8. Save generated input to a file first;
FIFOs, devices and process substitution such as `<(...)` are refused with exit 2.
The three files are read sequentially, not as an atomic snapshot: use stable local
copies. The opened descriptor is closed in `finally` on every read/stat outcome.
Exit 0 means the protected record multisets agree and
there is no proposed CNAME conflict; 1 means a protected change or conflict; 2 means
invalid input. Output contains counts and digests, never record values. TTL, priority
and duplicate occurrences count. Only allowlisted A/AAAA/CNAME records may change;
wildcards and all other records remain protected. Apex aliases, multiple alias targets
and conflicting data are refused. DNSSEC coexistence follows
[RFC4035 §2.5](https://www.rfc-editor.org/rfc/rfc4035#section-2.5) and
[RFC2181 §10.1](https://www.rfc-editor.org/rfc/rfc2181#section-10.1).

A passing comparison performs no DNS write and proves neither current-export freshness,
ownership, DNSSEC validity, propagation nor mail health. In particular, SPF `a`/`mx`
authorization can depend on changed addresses even when its TXT is unchanged. Verify
received-message authentication and external mail delivery separately under AB#131.
Before allowlisting a host, inspect protected MX/SRV/NS and CNAME target dependencies.
A protected record can retain its exact bytes while an allowed target's changed
address moves mail or another service. Select hosts without those dependencies or
resolve and verify the affected service separately before cutover.

## Mail recovery evidence

Use the blank [mail recovery worksheet](mail-recovery-evidence.md) for AB#131's two
independent mailboxes, current full-zone export and exercised message/DNS/account
recovery. Completed records belong in ignored private operator evidence. Working mail
and owner-reported backups do not establish tested restoration or contractual closure.

## Rollback exercise evidence

Fill the [rollback exercise record](rollback-exercise-record.md) privately after AB#18.
It separates immutable deployment recovery from CMS, assets, cache, credentials and
already sent mail, and records owner control/access removal. AB#118 still requires an
actual accepted exercise; publishing this blank record performs no rollback.

## Legacy owner-review CSV (AB#209)

`npm run verify:legacy-redirects -- report --csv` exports only pending rows with exact
sorted source paths and observed crawl statuses. Redirect, gone, excluded and
already-live rows remain in the default JSON report. Output is semicolon-separated,
UTF-8 BOM, CRLF, with quoted/escaped cells and spreadsheet formula prefixes neutralized
in non-path text. Use `npm run --silent verify:legacy-redirects -- report --csv > review.csv`
when saving stdout to avoid npm's command banner. Owner decision, target and evidence
columns start blank. The worksheet chooses no target and is not an import format;
timeouts remain observed timeouts. Check mode still reports pending decisions as
incomplete/nonzero. AB#19 still requires accepted mappings and post-import targets.

### AB#236 — operator verification behavior

Preview verification no longer prints arbitrary identity/probe exception messages, which can include malformed secret header values. The injectable header-only probe preserves manual redirects, no-store, the twenty-second signal and response metadata. The CLI verifies deployment ownership before supplying the bypass, uses fixed unknown-cause diagnostics and has an import-safe main guard. Known project-owned VercelApiError diagnostics remain available.

This deliberately also withholds ordinary validation `Error` messages during identity lookup. Those errors share the catch boundary with transport failures, whose contents are not trusted; the fixed phase diagnostic identifies where verification stopped. Only the explicit project-owned `VercelApiError` class may supply additional detail. Inspect the URL, expected deployment ID and required Vercel settings locally when that phase fails.

### AB#350 — Bound header-only Preview probes (2026-10-18)

Header-only generated-deployment and stable-alias GETs use one
original monotonic twenty-second deadline per request. Unused bodies are cancelled
without reading or awaiting cancellation, including responses arriving after a timed-out
injected fetch. Fast completion removes the owned timer; an owned timeout has the fixed
`Preview probe timed out` diagnostic, while ordinary transport causes stay withheld.
Empty or already-locked bodies receive best-effort cleanup without taking another
reader. The two alias requests retain their separate budgets and existing retry/recovery
policy; this is not a transaction-wide deadline or live protection/ownership proof.

### AB#237 — operator verification behavior

Stable Preview alias assignment and reconciliation outcomes now withhold arbitrary transport exceptions rather than echoing their message or serializing thrown values. Known project-owned VercelApiError diagnostics remain available. Probe retry errors were already fixed messages; those retries, revision/ownership gates and post-assignment restore outcomes remain unchanged. These are local injected-transport checks, not a live alias mutation.

### AB#351 — standalone alias verification diagnostics

The read-only `verify:preview-alias` command also withholds arbitrary alias-configuration, identity-lookup and header-probe exception details. Fixed phase messages name the relevant settings; project-owned `VercelApiError` diagnostics remain available. Inspect those settings locally rather than copying credentials into logs. Ownership and non-production checks still precede the two ordered unauthenticated/bypass probes, and successful output and semantic verification details are unchanged. This is local synthetic verification of diagnostic handling, not live alias assignment or production acceptance.

### AB#238 — operator verification behavior

The legacy verifier probes each exact declared target URL once per invocation, retaining both successful and failed attempts. Source requests remain independent and every affected row keeps its source status and fixed probe-failed result. Failed target timeouts therefore accumulate per distinct target rather than per alias row; source timeouts still apply separately. A fresh invocation retries naturally. Pending paths remain blockers, and a timeout remains an operational failure, never a new 410 or missing-content decision.

### Noncanonical assigned Production aliases (AB#18, AB#117)

An assigned Production Vercel alias can answer publicly even while the canonical
custom domain still serves an older site. Canonical metadata alone does not add
an HTTP `noindex` directive. To keep explicitly chosen assigned Vercel aliases
out of search, set optional **Production-scoped, build-time**
`PRODUCTION_NOINDEX_ALIASES` to at most eight comma-separated bare
`*.vercel.app` hosts. For example:

```dotenv
PRODUCTION_NOINDEX_ALIASES=example-project.vercel.app,example-project-team.vercel.app
```

A Production-target build (`VERCEL_ENV=production`) adds `X-Robots-Tag: noindex`
only when the request host exactly matches one of those hosts. Case-equivalent
entries are deduplicated. Schemes, ports, paths, wildcards, empty entries,
multiline values and malformed/oversized hosts fail the build. The canonical
base URL must be a valid bare HTTP(S) origin; including its hostname fails the
build. Unset preserves existing behavior, including clones whose canonical site
is their Vercel host. Preview's separate `PREVIEW_STABLE_ALIAS` rule is unchanged.
This uses Next.js's documented
[host-conditioned headers](https://nextjs.org/docs/app/api-reference/config/next-config-js/headers).

Changes require a new Production-target build; setting the variable on an
already built deployment does not update its headers. Supply this nonsecret
setting to a manually allowlisted build too. A Preview-built artifact does not
acquire this rule through promotion. Generated deployment URLs retain their
provider protection/noindex controls; the explicit list does not cover other
assigned aliases. Enumerate the actual attached domains before release.

After staging and activation, check the effective headers on each listed alias
for a prerendered page, a dynamic page, robots, sitemap, not-found, legacy
redirect/gone and private routes. Verify the canonical host remains indexable
and stronger private-route `noindex, nofollow` survives. A local build check
cannot prove Vercel's edge behavior. Robots on an alias must allow the relevant
crawler to retrieve pages to observe noindex. This is crawl guidance, not access
control or immediate removal of already indexed content; it changes neither
canonical links nor domain DNS. A rollback to an older artifact without the rule
restores its previous indexing behavior and requires its own release assessment.

## Checking legacy URLs on the protected candidate (AB#283)

Capture fresh deployment metadata privately with authenticated Vercel tooling. Keep
protection and noindex enabled; send no bypass through a redirect or in a URL. Run
from a checkout whose mapping/engine bytes match the frozen source, after that
source's full CI succeeds. Use the existing environment-only automation bypass:

```sh
npm run verify:legacy-candidate -- \
  --receipt temp/candidate/deployment.json --url https://<deployment>.vercel.app \
  --source-sha <frozen-sha> --deployment-id <dpl_id> \
  --project-id <prj_id> --team-id <team_id> \
  --canonical-origin https://<intended-canonical-host> --out temp/candidate/legacy-1
```

The [candidate verification audit](audits/ab283-protected-legacy-verification-2026-10-13.md)
explains the source/ownership/bypass boundaries and private receipt. Exit 1 is a
refusal or mapping failure, never permission to weaken protection. Final public
Production verification still uses `verify:legacy-redirects -- check` without a bypass.
