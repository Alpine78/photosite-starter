# Deployment: the Preview environment and release candidates

How a release candidate reaches a testable URL, who owns the infrastructure it runs on,
and which settings differ between Preview and Production.

This covers the **Preview environment only**. Production promotion (AB#18), exercised
rollback and customer handoff (AB#118), and legacy URL redirects (AB#19) are separate
work items. The promotion and rollback commands are recorded here because ADR-0004 §3
requires them decided before the first deployment — but nothing in this repository
performs them, and no production environment or DNS record exists yet.

The reference host and the reasoning behind it are
[ADR-0004](adr/0004-reference-production-host-and-ownership-boundary.md). This document
is the operational half: what to create, what to set, and what the pipeline does with it.

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

1. **Create the scope in the owner's own Vercel account, on Pro.** A commercial site
   cannot rely on Hobby fair use. Enable MFA on the account before anything else.

   ADR-0004 §1 says "team" because it assumes the common case: the developer builds the
   site for a photographer, and the account has to belong to the photographer rather than
   to whoever wrote the code. When the site owner and the developer are the **same
   person**, that requirement is met by the owner's own **one-person Pro team** — which
   is what Vercel's default scope already is; Pro is billed per team and includes one
   deploying seat, so this needs no second paying member. A clone built for someone else
   needs a team owned by them, created before the project, because a later project
   transfer leaves logs, drains, and some integrations behind.

2. **Create the project empty — do not connect the Git repository.** This is the one
   step where the obvious path is the wrong one. The dashboard's "Add New → Project" flow
   is built around importing a Git repository, and a connected Git integration deploys on
   every push — putting a deployment on the internet _before_ lint, tests, the build, and
   the Playwright journeys had run. Azure Pipelines is the gate (ADR-0004 §3), and it
   deploys through the CLI, so the project needs no Git connection at all. Use the CLI,
   which is also what the provider's own Azure Pipelines guidance recommends:

   ```bash
   npx vercel@58.9.1 login
   npx vercel@58.9.1 project add photosite-starter
   ```

   `58.9.1` is the version `azure-pipelines.yml` pins in `vercelCliVersion`; that file
   is the source of truth, so read it from there if the two ever disagree. Do not run
   `vercel deploy` from a local checkout: it would create a deployment that skipped
   every gate.

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

6. **Nothing to do about production-domain assignment — it is a deploy-time flag, not a
   project setting.** ADR-0004 §3 requires that a production build never take the
   production domain merely by being deployed. Vercel expresses that as
   `vercel deploy --prod --skip-domain`, which AB#18's promotion sequence below already
   uses; there is no switch to turn off here, and no custom domain exists yet anyway.

   Leave the project's default `<project>.vercel.app` domain connected to **Production**,
   where Vercel puts it. Do not repoint it at Preview and do not remove it: a release
   candidate is reviewed at the **generated, per-deployment URL** the pipeline publishes,
   never at a stable preview domain (ADR-0004 §3). A fixed preview address would be one
   protection mistake away from being a second, permanently-live copy of the site.

7. **Set the Preview-scoped environment variables** from the table below. Scope them to
   Preview only — Production values are set in AB#18, and the two must never be one set.

8. **Create a deployment token** scoped to the team, and read the team (org) id and
   project id. Linking the checkout writes both to a local file:

   ```bash
   npx vercel@58.9.1 link --yes --project photosite-starter
   cat .vercel/project.json      # orgId and projectId
   ```

   `.vercel/` is gitignored, so nothing here reaches the repository.

9. **Create the variable group** `photosite-starter-vercel-preview`, authorize only this
   pipeline to use it, and add the values from the table below. Create the group with
   `PREVIEW_DEPLOYMENT_ENABLED=false` first; the YAML must be able to resolve the protected
   resource before any branch containing its reference is merged. Add and verify every
   other value, then change the flag to `true`. Do not grant open access to all pipelines.

10. **Keep Observability Plus disabled** and limit Owner, Member, and Developer seats to
    the people who need Runtime Logs; everyone else gets Pro Viewer. Both are privacy
    decisions, not cost ones — see [Logs and telemetry](#logs-and-telemetry).

The group exists before its credentials do, so provisioning can remain incomplete without
reddening `main`: the deploy stage skips while `PREVIEW_DEPLOYMENT_ENABLED=false`. Turning
that flag on is the explicit handoff from provisioning to the first release-candidate run.

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
| `VERCEL_AUTOMATION_BYPASS_SECRET` | yes    | Lets the verification probe read the protected deployment.            |
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
| `SITE_CONTENT_SOURCE`                          | `mock` today; `sanity` once the content schemas land | `sanity`                                |
| `SITE_LOCALE`, `SITE_LOCALE_ROUTES`            | same as production                                   | the launch route contract               |
| `SITE_CANONICAL_BASE_URL`                      | a fixed non-production origin — see below            | the production origin                   |
| `SITE_DEFAULT_SOCIAL_IMAGE` and its dimensions | same as production                                   | the launch social image                 |
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

Every deployment still runs on `mock` today: the Sanity connection exists (AB#39), and the
media, category, settings, and home schemas and adapters behind it do (AB#82, AB#112,
AB#80), but nothing reads them from a route yet and the remaining content schemas do not
exist (AB#81, AB#113, AB#114).
Preview flips to `sanity` with its own dataset when they land.

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

### The Sanity webhook signing secret

`SANITY_WEBHOOK_SECRET` is a Sensitive, runtime-only value shared with exactly one
environment's Sanity document webhook. Generate at least 32 random bytes (for example,
`openssl rand -base64 48`), use a different stable value for Preview and Production, and
rotate both Sanity and Vercel sides together. A mismatch makes every delivery fail closed
with 401; the value is never a URL parameter or custom bearer token.

The endpoint, exact GROQ projection, finite cache lifetime, tag map, retry behavior, and
the promotion/rollback broad-expiry command are documented in
[`cache-revalidation.md`](cache-revalidation.md). A webhook 200 proves that this
deployment accepted the event; it does not by itself prove cross-instance propagation.

### The gallery cursor signing key

A gallery larger than one page issues an opaque continuation cursor, and the deployment
signs it with `GALLERY_CURSOR_SIGNING_KEY` (AB#72). It sits in the Sensitive, runtime-only
row above deliberately: the build never issues a cursor, so it never needs the key, and
keeping it out of the build is what lets it stay unreadable after creation.

Three properties are worth knowing before provisioning it.

**It must be one stable value per environment.** ADR-0003 decision 8 makes unfiltered
continuation URLs indexable, and serverless instances do not share a process. A value that
differed per deploy — or per instance — would 404 a cursor another instance had just
issued, so generating one at boot is not an option.

**Rotating it retires every continuation URL already issued and indexed.** That is the
same property that stops a forged token from being spendable, so it is a cost rather than
a defect, but it makes rotation a deliberate act: expect crawlers to re-discover the
continuation URLs afterwards, and do not rotate as routine hygiene. Rotate it if the value
leaks. Nothing else is invalidated — a gallery's own pages, and every parameter-free URL,
are unaffected.

**It is read lazily, so a missing key is a late failure rather than a build failure.**
Nothing at build time issues a cursor, and a gallery that fits inside one page never needs
one either, so neither `next build` nor the CI gate will tell you the key is missing. The
mock content source ships a gallery larger than one page, so today every deployment does
need it: that gallery answers with a configuration error naming the setting while every
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

`azure-pipelines.yml` has two stages.

**Verify** runs on every push and pull request to `main`: lint, the browser-free test
suite, the production build, and the Playwright journey suites.

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
ID, and hostname with the expected values. It verifies the deployment, and only then
publishes the URL to the run summary.

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

**Recorded, not performed.** AB#18 promotes the first production build; AB#118 exercises
rollback before handoff. Both are named here because ADR-0004 §3 requires the mechanism
decided before the first deployment, not discovered during the first incident.

Promotion stages a production build without routing traffic to it, smoke-tests that exact
deployment, and then promotes the same build without rebuilding:

```bash
vercel pull --yes --environment=production --token="$VERCEL_TOKEN"
vercel build --prod --token="$VERCEL_TOKEN"
vercel deploy --prebuilt --prod --skip-domain --token="$VERCEL_TOKEN"
# smoke-test the staged deployment, then, after owner approval:
vercel promote <deployment-url> --token="$VERCEL_TOKEN"
```

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

Two separate things, with different owners:

**The application's own events** contain a random correlation identifier, a state, and a
redacted error class. No form content, no webhook bodies, no credentials, no client
identifiers. That boundary is enforced in code and documented in
[`contact-data-flow.md`](contact-data-flow.md).

**The hosting provider's request telemetry** is not the application's to shape. Runtime
Logs record request metadata — path, query, user agent, status, region, request id — and
Vercel acts as a controller for personal data in service-generated data, under
provider-defined purposes that application code cannot narrow. ADR-0004 records the
boundary the project owner accepted on 2026-08-04, and this is why the runbook keeps
Observability Plus disabled (one-day Runtime Logs retention instead of thirty), limits
operator seats, and adds no log drain. Before the production launch review (AB#117), the
current provider terms, retention, and transfer boundary are re-read and recorded — they
are the provider's to change, not ours.

The pipeline holds to the same line: the deploy job prints a deployment URL, statuses, and
robots directives. It never prints a response body, a token, or a bypass secret.

## What this does not do

- **No production environment, domain, or DNS record exists.** Nothing here touches the
  registrar or the authoritative nameservers.
- **No production deployment or promotion has been performed** (AB#18), and rollback has
  not been exercised (AB#118).
- **Nothing here is a legal compliance conclusion.** Each deployment owner remains
  responsible for its own privacy notice, processing record, provider terms, and review.
- **A passing verification proves two properties**, access protection and non-indexability,
  at one moment on one URL. It says nothing about what the provider logs, and it is not a
  substitute for the launch review.
