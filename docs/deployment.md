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

6. **Choose the stable Preview integration alias** (AB#136). Pick an unused
   `<name>.vercel.app` host — for example `<project>-preview.vercel.app` — that the
   pipeline will repoint at each verified Preview deployment so a webhook configured once
   keeps working across ordinary redeploys. It must be a `*.vercel.app` host, not a custom
   domain: Standard Protection "protects all domains except production domains" on every
   plan, so a `*.vercel.app` alias inherits Vercel Authentication and `X-Robots-Tag:
   noindex`, while a custom domain's protection posture is not guaranteed. This alias is
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
   npx vercel@58.9.1 link --yes --project photosite-starter
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
| `PREVIEW_STABLE_ALIAS`            | no     | Bare `*.vercel.app` host the pipeline repoints at each verified Preview deployment so a webhook configured once keeps working (AB#136). Required once `PREVIEW_DEPLOYMENT_ENABLED=true`. |
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
rate-limited exchange, and the link/exchange routes exist so far. **No store adapter
does** — `PRIVATE_GALLERY_STORE=enabled` throws on the first request that needs one, by
design, so a deployment that turns the feature on before AB#29's provisioning slice fails
visibly instead of half-serving.

Two build-safe settings, read during `loadDeploymentConfig` like the `SITE_*` values:

| Setting | Preview | Production |
| --- | --- | --- |
| `PRIVATE_GALLERY_STORE` | `off` (or unset) | `off` (or unset) until AB#29 provisioning |
| `PRIVATE_GALLERY_ROUTE_PREFIX` | unset (defaults to `private`) | same |

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

When the delivery slices land, this section gains the backup/PITR runbook and the exit
path for both new services (ADR-0014 Action Item 9).

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
domains" on every plan, so a `*.vercel.app` alias inherits Vercel Authentication and
`noindex`. The tooling refuses any other host: a fixed, unprotected copy of the site at a
stable address is exactly what step 7 warns against.

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

- **No production environment, domain, or DNS record exists.** Nothing here touches the
  registrar or the authoritative nameservers.
- **No production deployment or promotion has been performed** (AB#18), and rollback has
  not been exercised (AB#118).
- **Nothing here is a legal compliance conclusion.** Each deployment owner remains
  responsible for its own privacy notice, processing record, provider terms, and review.
- **A passing verification proves two properties**, access protection and non-indexability,
  at one moment on one URL. It says nothing about what the provider logs, and it is not a
  substitute for the launch review.
