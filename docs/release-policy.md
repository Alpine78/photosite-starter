# Release and compatibility policy (AB#46)

**Status:** Proposed for owner review. No release has been tagged under this policy yet.
The repository's current `package.json` version is `0.1.0`; that field alone is not a
published release or a promise of compatibility.

This policy covers the public starter and gives later private deliverables a way to
declare their own support terms. It does not create a package, update service, or
customer deployment process.

## Release identity

- Tag a reviewed public core release `vMAJOR.MINOR.PATCH` using semantic versioning.
  The tag identifies a Git commit, not the mutable state of a deployment or CMS
  dataset. Keep `package.json` at the same numeric version and publish release notes
  against the tag. Never move or reuse a released tag.
- Before `v1.0.0`, treat every `0.MINOR.0` as potentially incompatible. `0.MINOR.PATCH`
  contains only compatible fixes for that minor line. A `1.0.0` baseline needs its
  own review and is not implied by the current `0.1.0` field.
- After `v1.0.0`, increment `MAJOR` for a customer-visible breaking contract change,
  `MINOR` for a compatible capability, and `PATCH` for a compatible fix. A change
  that requires customer action is breaking even if the TypeScript build still passes.
- A customer deployment records the core tag or commit, its own repository commit,
  and the CMS schema revision used to publish content. A deployment's provider ID is
  recorded separately, as described in [deployment.md](deployment.md); it is not a
  substitute for a source release identifier.
- If a private theme or other deliverable is later offered, version it separately
  with the same tag format **in its own distribution**. Its release notes name the
  supported public core range and its own support terms. No private artifact is
  implied by a public core tag.

## Compatibility statement for every release

Record the following in the release notes. A missing entry means compatibility has
not been established; do not infer it from a passing build.

| Surface | Report and verify |
| --- | --- |
| Node.js | Required major from `package.json` `engines`, the Azure pipeline pin, and the Vercel project setting. These must agree; `scripts/node-version-pin.test.mts` guards the first two. |
| Next.js | Tested major and exact resolved version from the lockfile; state whether the release requires a Next.js update in a customer checkout. |
| Theme | Theme contract revision and any changed semantic token, selector, or override rule from [theme-contract.md](theme-contract.md). Test the shipped presets and state which private theme versions, if any, were tested with this core release. |
| CMS | Schema/adapter revision (the core tag or commit containing `sanity/schemas` and its matching `src/lib` adapters), any content migration, and the oldest content shape still readable. Studio code copied into a separate repository must be updated alongside the adapter. |
| Deployment | Any changed environment variable, provider setting, data-store requirement, or rollout/rollback step. |

An update is compatible only if existing customer content and configuration continue
to work without an unannounced edit. Runtime dependency updates follow the tested
lockfile; a version range in `package.json` is not the version the release used.

## Release notes and migration

Use one changelog entry per public core tag with these headings, even when a section
is empty: **Added**, **Changed**, **Fixed**, **Security**, **Deprecated**, **Removed**,
**Compatibility**, and **Migration**. Link material changes to their work items. A
private deliverable uses the same headings in its own release notes and states its
tested core range. Do not put private source or customer data in public notes.

For each breaking change, the Migration section gives a concrete path from the
previous supported release: affected files and data, preparation or backup, ordered
steps, how to verify the result, and a rollback or exit path. A CMS schema change must
say whether old published documents remain readable during rollout. If it cannot be
rolled back safely after content is written, say so before the update is offered.

For example, if a future release renames a required `SiteSettings` field, its notes
must name the old and new field, provide a conversion for existing documents, ship an
adapter that can read the transitional shape or require a documented maintenance
window, check both locale routes against converted content, and explain how to
restore the prior dataset and deployment together. The field rename is a major change
after `1.0.0`, even if a fresh clone builds without migration.

## Support window and customer updates

**Proposed public core support window:** the latest tagged minor line of the current
major receives fixes. The immediately preceding minor line may receive critical
security fixes for 90 days after the newer minor is tagged; other backports are not
promised. Before `1.0.0`, only the latest `0.MINOR` line is supported. A superseded
tag remains available under its existing license, but availability is not maintenance.
When a supported dependency or platform major reaches its own end of support, a core
release that needs an upgrade carries that change and its migration notes; this policy
does not promise to keep an unsupported runtime alive.

The owner of each customer repository decides when to merge an offered update and
retains their own deployment, content, and rollback control. A private deliverable's
sales or service agreement must state its update channel, term, response owner, and
support window explicitly; the public core window above does not silently grant or
limit those rights. If a private product ends, the customer keeps the source and
usage rights specified by that agreement and must have a documented way to continue
operating without an update service.

## Release checklist

1. Review the diff and run the repository's lint, browser-free tests, production
   build, browser journeys, and diagram check on the release commit through CI.
2. Write the compatibility statement and changelog entry. For a breaking release,
   test the migration on a recoverable copy of representative content and settings.
3. Review any security or privacy change and the deployment's rollback constraints.
4. Tag the reviewed commit and publish the notes. Deployments and customer updates
   then reference that immutable tag or its commit, while the existing gated Preview
   and Production path remains authoritative for the reference site.
