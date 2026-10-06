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

## Legacy URL mapping verification (AB#19)

The first-site mapping is deployment configuration in `src/lib/legacy-redirects-data.ts`;
the source inventory and undecided/excluded/already-live classifications live beside it.
The reusable engine rejects invalid sources, duplicate decisions, self-redirects, and
targets that are other legacy sources. No target is inferred from a legacy slug.

Export its complete, offline JSON report with:

```bash
npm run --silent verify:legacy-redirects -- report > /tmp/legacy-mapping.json
```

The report distinguishes the full crawl's 442 URL records (the AB#19 attachment) from the
415 path/status observations committed here. Counts and classifications are calculated
from the mapping: currently 39 redirects, 174 justified `410` responses, 198 pending
decisions, three excluded error paths, and one already-live root. A duplicate, unaccounted,
or non-inventory source fails report generation. Successful export proves bookkeeping;
it does not prove target availability or approve launch.

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
evidence that the 198 pending paths meet AB#19's acceptance criteria or that a phased launch
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
| `CONTACT_DELIVERY_ADAPTER`                     | `sink`                                               | `resend`                                |
| `CONTACT_DELIVERY_FROM`, `CONTACT_DELIVERY_TO` | unset                                                | the owner's verified sender and mailbox |
| `RESEND_API_KEY`                               | unset                                                | Production-only secret                  |
| `GALLERY_CURSOR_SIGNING_KEY`                   | one stable Preview secret                            | a separate, stable Production secret     |
| `SANITY_PROJECT_ID`, `SANITY_API_VERSION`      | same project, pinned version                         | same                                    |
| `SANITY_DATASET`                               | a Preview dataset                                    | the production dataset                  |
| `SANITY_DATASET_VISIBILITY`                    | that dataset's actual visibility                     | that dataset's actual visibility        |
| `SANITY_READ_TOKEN`                            | a Preview runtime token in Vercel, required if private | a separate Production runtime token in Vercel, required if private |
| `SANITY_WEBHOOK_SECRET`                        | one stable Preview secret                            | a separate, stable Production secret    |

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

### Private client galleries (ADR-0014, not yet provisioned)

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
§3): thirty attempts per fifteen minutes, for the whole site rather than per client. That
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

#### Provisioning the two private services — owner-run, before the delivery slices

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

**DependencyAudit** runs daily at 06:00 UTC on `main`, even without a source
change, in the `Default` self-hosted pool. It audits the committed production
and development dependency tree without installing packages. Scheduled runs
skip Verify and DeployPreview, so the audit does not spend Microsoft-hosted
minutes or deploy a release candidate. The [dependency response process](dependency-security.md)
records actual runs and the outstanding notification-delivery check (AB#160).

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

## Promotion and rollback

**Recorded; AB#18 still owns the first production build.** AB#118 exercises rollback
before handoff. Both are named here because ADR-0004 §3 requires the mechanism decided
before the first deployment, not discovered during the first incident. The staged
sequence below was run once by hand on 2026-09-24 (see "A production-target deployment
exists"); that does not complete AB#18.

Before AB#18 promotion, record the reviewed [AB#132 initial-404 decision evidence](adr/0007-proxy-request-path-boundary.md#2026-10-03-main-branch-recheck-and-decision-proposal-ab132)
on AB#132 and link that decision from AB#18. Its scriptless probes are known
failures while the limitation exists; a green suite with those markers does not
satisfy the semantic-HTML requirement. Obtain either a passing fix or an explicit
owner acceptance with impact, reason, review date and follow-up. AB#117 also
requires [AB#186's dependency residual decision](audits/ab186-dependency-review.md#2026-10-02-follow-up--ab186-remains-active).
Neither decision is made by this follow-up or by a successful Preview check.

Promotion stages a production build without routing traffic to it, smoke-tests that exact
deployment, and then promotes the same build without rebuilding:

```bash
vercel pull --yes --environment=production --token="$VERCEL_TOKEN"
vercel build --prod --token="$VERCEL_TOKEN"
vercel deploy --prebuilt --prod --skip-domain --token="$VERCEL_TOKEN"
# smoke-test the staged deployment, then, after owner approval:
vercel promote <deployment-url> --token="$VERCEL_TOKEN"
```

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

## Mail recovery evidence

Use the blank [mail recovery worksheet](mail-recovery-evidence.md) for AB#131's two
independent mailboxes, current full-zone export and exercised message/DNS/account
recovery. Completed records belong in ignored private operator evidence. Working mail
and owner-reported backups do not establish tested restoration or contractual closure.
