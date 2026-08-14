# Sanity Studio schemas

The document types this site reads, as plain objects that import nothing.

This directory is **content-store configuration, not application code**. Nothing under
`src/` imports it, and it is never bundled into the site — the same reasoning that keeps
the deployment tooling in `scripts/`. The application reads content through the adapters
in `src/lib`, which know the field names and never the Studio (ADR-0006).

## Why there is no `sanity` package here

A Sanity schema type is a plain JavaScript object. `defineType` and `defineField` are
typed identity helpers: convenient inside a Studio, and a dependency here. Importing them
would pull the `sanity` package into a repository that deliberately runs without a CMS
library, so the types are written as plain objects and checked against the local
declarations in [`schemas/schema-types.ts`](schemas/schema-types.ts) instead.

Those declarations cover only what these schemas use. Widen them when a schema needs
something, not in advance.

## Using them in a Studio

The Studio is the site owner's own project, created and billed in their Sanity account
(see [`docs/sanity-setup.md`](../docs/sanity-setup.md)). It is not part of this
repository. Point its schema configuration at these files:

```ts
// sanity.config.ts, in the owner's Studio project
import { defineSchemaTypes } from "./path/to/photosite-starter/sanity/schemas";

export default defineConfig({
  // …project, dataset, plugins…
  schema: {
    // Whether this dataset is world-readable. It decides which fields exist:
    // a public dataset is offered no place to record where a master lives,
    // because anyone holding the project id can read every published document
    // in it.
    types: defineSchemaTypes({ datasetVisibility: "private" }),
  },
});
```

`datasetVisibility` must match the site's own `SANITY_DATASET_VISIBILITY`, and both must
match what the dataset actually is in Sanity. It is not a preference: a public dataset is
readable by anyone holding the project id, so the archive-location field does not exist
there at all, and on the site's side declaring `private` makes the read token required —
an unauthenticated read of a private dataset returns an empty result rather than an
error, so without that guard a misconfigured deployment renders as though nothing had
been written. The reference deployment uses separate read-only credentials for its
trusted Azure build and its Vercel runtime; `docs/deployment.md` owns their provisioning.

The schemas validate against the dataset while an editor works — an uploaded image
is measured and its format checked before it can be published, media and category IDs
are checked for being unique and unchanged, and a prospective category publication is
checked against the whole published tree. Those rules use the Studio's own client, so
they need no configuration beyond the above. Studio validation cannot protect API
imports; the site's adapters repeat the public boundary checks for that reason.

Copying the files works too — they have no imports to satisfy — but a copy drifts. Prefer
a path, a submodule, or a workspace dependency, so a schema change arriving from upstream
reaches the Studio the same way a code change reaches the site.

## The rule these schemas follow

One photograph is one document, described once, referenced from everywhere it appears.
Where it sits — the order in a gallery, the section it belongs to, a caption written for
one particular page — belongs to the container that places it, never to the photograph.
[ADR-0002](../docs/adr/0002-media-identity-and-placement-boundary.md) explains why, and
[ADR-0008](../docs/adr/0008-localized-authored-text.md) explains why authored sentences
are language-keyed arrays rather than fields named after this deployment's languages.
