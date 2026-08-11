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

1. **Create the team in the owner's own Vercel account, on Pro.** A commercial site
   cannot rely on Hobby fair use. Enable MFA on the account before anything else.

2. **Create the project empty — do not connect the Git repository.** This is the one
   step where the obvious path is the wrong one. The dashboard's "Add New → Project" flow
   is built around importing a Git repository, and a connected Git integration deploys on
   every push — putting a deployment on the internet *before* lint, tests, the build, and
   the Playwright journeys had run. Azure Pipelines is the gate (ADR-0004 §3), and it
   deploys through the CLI, so the project needs no Git connection at all. Use the CLI,
   which is also what the provider's own Azure Pipelines guidance recommends:

   ```bash
   npx vercel@<pinned version> login
   npx vercel@<pinned version> project add photosite-starter
   ```

   Use the same version `azure-pipelines.yml` pins. Do not run `vercel deploy` from a
   local checkout: it would create a deployment that skipped every gate.

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

6. **Disable automatic production-domain assignment.** Nothing needs it yet; AB#18 stages
   a production build and promotes it deliberately.

7. **Set the Preview-scoped environment variables** from the table below. Scope them to
   Preview only — Production values are set in AB#18, and the two must never be one set.

8. **Create a deployment token** scoped to the team, and read the team (org) id and
   project id. Linking the checkout writes both to a local file:

   ```bash
   npx vercel@<pinned version> link --yes --project photosite-starter
   cat .vercel/project.json      # orgId and projectId
   ```

   `.vercel/` is gitignored, so nothing here reaches the repository.

9. **Add the pipeline variables** from the table below to the Azure Pipelines definition.

10. **Keep Observability Plus disabled** and limit Owner, Member, and Developer seats to
    the people who need Runtime Logs; everyone else gets Pro Viewer. Both are privacy
    decisions, not cost ones — see [Logs and telemetry](#logs-and-telemetry).

Until step 9 is done the deploy stage skips and `main` stays green. It starts running the
moment `VERCEL_PROJECT_ID` exists.

## Pipeline variables

Set these on the Azure Pipelines definition. Secret variables must be marked secret;
Azure Pipelines masks them in logs and passes them to a step only where the YAML names
them explicitly in an `env:` block.

| Variable | Secret | Purpose |
| --- | --- | --- |
| `VERCEL_ORG_ID` | no | Which Vercel team the project belongs to. |
| `VERCEL_PROJECT_ID` | **no — see below** | Which project to deploy. Also the switch that turns the deploy stage on. |
| `VERCEL_TOKEN` | yes | Deployment credential. Rotated or revoked at handoff. |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | yes | Lets the verification step read the deployment as a reviewer would. |

`VERCEL_PROJECT_ID` **must not be marked secret.** The deploy stage's condition tests it
to decide whether the project exists yet, and Azure Pipelines does not decrypt secret
variables into expressions — a secret there would always read as empty and the stage
would never run at all. It is an identifier rather than a credential; the token beside it
is the secret.

## Environment variables

These live in the **Vercel project**, scoped per environment, not in the pipeline and not
in this repository. `vercel pull --environment=preview` fetches the Preview set at build
time; the Production set is never fetched by the Preview job.

| Setting | Preview | Production (AB#18) |
| --- | --- | --- |
| `SITE_DEPLOYMENT_STAGE` | `preview` | `production` |
| `SITE_CONTENT_SOURCE` | `mock` today; `sanity` once the content schemas land | `sanity` |
| `SITE_LOCALE`, `SITE_LOCALE_ROUTES` | same as production | the launch route contract |
| `SITE_CANONICAL_BASE_URL` | a fixed non-production origin — see below | the production origin |
| `SITE_DEFAULT_SOCIAL_IMAGE` and its dimensions | same as production | the launch social image |
| `CONTACT_DELIVERY_ADAPTER` | `sink` | `resend` |
| `CONTACT_DELIVERY_FROM`, `CONTACT_DELIVERY_TO` | unset | the owner's verified sender and mailbox |
| `RESEND_API_KEY` | unset | Production-only secret |
| `SANITY_PROJECT_ID`, `SANITY_API_VERSION` | same project, pinned version | same |
| `SANITY_DATASET` | a Preview dataset | the production dataset |
| `SANITY_READ_TOKEN` | a Preview-only token, if the dataset is private | a separate Production token |

Two of these are safeguards rather than preferences. `SITE_CONTENT_SOURCE=mock` is
**refused outright** in a production deployment, and so is `CONTACT_DELIVERY_ADAPTER=sink`:
publishing the project's demo photographs as a photographer's own work, or accepting an
enquiry that is silently discarded, are failures worth failing the build over. Preview is
where both are legitimate — its contact tests go to a sink, with synthetic data, and never
to the owner's mailbox.

Every deployment still runs on `mock` today: the Sanity connection exists (AB#39) but the
content schemas behind it do not (AB#80, AB#81, AB#82, AB#112, AB#114). Preview flips to
`sanity` with its own dataset when they land.

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
- `VERCEL_PROJECT_ID` is set, so an unprovisioned project means a skipped stage rather
  than a red branch.

It then checks that provisioning is complete (failing by name if it is half done),
installs the pinned Vercel CLI, pulls the Preview configuration, builds, deploys the
prebuilt output so the artifact that was gated is the artifact that ships, verifies the
deployment, and only then publishes the URL to the run summary.

## Verifying a release candidate

```bash
npm run verify:preview -- https://<deployment>.vercel.app
```

The pipeline runs this before it publishes the URL. It makes two requests, because the
two properties are independent and neither substitutes for the other:

- **Without the bypass header**, the deployment must refuse the request. `noindex` asks a
  crawler not to list a URL; it asks nothing at all of a person who has it.
- **With the bypass header**, the response must carry `X-Robots-Tag: noindex`. Protection
  keeps crawlers out today; the header is what keeps the URL out of an index if
  protection is ever relaxed.

Anything else fails, including answers that prove neither — an unverified deployment is
not a protected one. The secret is read from `VERCEL_AUTOMATION_BYPASS_SECRET` and sent
in a request header. Never put it in the URL: the provider accepts it as a query
parameter, and a URL carrying a secret survives in build logs, referrers, and request
telemetry long after the deployment is gone. The script refuses a URL with a query string
for that reason.

The decisions live in `scripts/preview-verification.mts` and have tests;
`scripts/verify-preview-deployment.mts` is the part that opens a socket. Both run on the
Node major pinned in `package.json`, which executes TypeScript directly, so the check
needs no build step and no extra dependency.

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
