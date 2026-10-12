# AB#255 — Published public-language inventory, 2026-10-12

Dated metadata census for the owner-selected next slice after
[PR #338](https://github.com/Alpine78/photosite-starter/pull/338) merged as
`2fc58f7`. AB#255 remains **Active**. This report records missing published
counterparts and placement prerequisites; it does not accept translations or
claim complete bilingual pages.

## Verified counts

Source: the `production` Content Lake target in the owner's local Production
live-verification configuration, cross-checked with the locally retained Vercel
Production configuration. This is a content-target audit, not a fresh readback of
running deployment settings. Configured routes are Finnish `fi` and English
`en-GB`; authored document languages are `fi` and `en`.

Read window: **2026-10-12T04:54:59.725Z → 2026-10-12T04:55:01.321Z UTC**.
API version: `v2025-02-19`; perspective: `published`.
Two matching narrow scans covered **125 rows**: 38 articles, 64 gallery
versions, 11 service versions and 12 shared category documents. Independent
provider counts matched every family and document language.

| Family | Stable identities | FI documents | EN documents | Both languages | FI only / missing EN | EN only / missing FI |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Articles | 28 | 28 | 10 | 10 | 18 | 0 |
| Public galleries | 32 | 32 | 32 | 32 | 0 | 0 |
| Services / packages | 8 | 8 | 3 | 3 | 5 | 0 |
| Total page identities | 68 | 68 | 45 | 45 | 23 | 0 |

The category documents are shared across languages, so they are counted separately:
all **12** have Finnish labels/slugs; **11** have English labels/slugs. One category
has neither its English label nor its English slug.

“Both languages” means a published document with the same stable identity and
same `_type` exists in each language. It does not mean its prose, captions or
alternative text have been translated and accepted.

## Placement prerequisites and order of work

- Every currently published FI/EN page in the three families passes this probe's
  narrow canonical-category/service-ancestor presence checks. No unresolved
  published reference, structural cycle, duplicate identity/language or category/
  service sibling-slug collision was observed in the checks performed.
- All **18 FI-only articles** share the same canonical category. Their source
  canonical placement cannot yet be retained by an English counterpart because
  that category lacks its English label/slug. Author that category version first;
  confirm its public slug before publishing. Do not guess a replacement category.
- The **5 FI-only services** have no missing English service-ancestor prerequisite
  under the current metadata. Their text and localized slugs still need authoring
  and review. This includes services/packages as modeled by the shared service type.
- All **32 gallery identities** have both declared document languages. Their actual
  title/body/SEO/caption/alt quality remains a separate audit, with ADR-0008's
  accessible-alt fallback still in effect.

Use the detailed missing-counterpart list as input to **AB#125**'s linked draft
workflow. Create drafts only in a separately authorized content-editing slice;
review placement and every language-dependent field before publishing. No draft,
translation, CMS write, credential change or deployment was made by this census.

## Scope and limits

The query's server-side type allow-list is `article`, `gallery`, `service`,
`category`. `gallery` is the repository's public gallery schema. Retained unlisted
content uses the distinct `legacyDeliveryGallery`/`legacyDeliveryImage` schemas,
which the filter excludes. Private galleries and administrator surfaces use their
separate application boundary. No media bytes, asset URLs, private fields, gallery
handles or body text were fetched.

| Remaining family / check | Evidence here | Owner / next work |
| --- | --- | --- |
| Home and contact authored CMS copy | Source support merged in #338; copy readiness not censused | AB#255: audit shared FI/EN prose and image descriptions before activation |
| Category descriptions, body/SEO/media text | Labels/slugs and ancestors only | AB#255: audit translation quality; AB#125 supplies the draft workflow |
| Retained unlisted deliveries | Excluded type; no handles or contents read | AB#255: bilingual UI under ADR-0028; existing retained-gallery scope is unchanged |
| Protected customer / administrator pages | Not inventoried by this CMS query | AB#255: separate UI slice preserving ADR-0014/0015 |
| Not-found/error/unavailable and Studio | Not inventoried by this CMS query | AB#255: verify both languages; keep AB#132 visible |
| HTTP routes, complete domain validation, running deployment | Not probed here | AB#255: journey/activation checks after reviewed authoring |

[The page-family inventory](../bilingual-page-coverage.md) remains the broader
source-based ownership record. This limited census does not complete the story
or independently establish every family's acceptance criteria.

Tokenless reads cover only query-visible published documents. Auxiliary excluded-
type counts in the private receipts describe only that query's visibility; they
are not a census of retained or private storage. Two matching readbacks detect
observed changes, not an atomic transaction or a guarantee against later edits.

## Reproduction and evidence

Use the existing GET-only `parsePublicReadTarget`/`runPublicReadQuery` transport
in `scripts/sanity-read-http.mts` against an explicitly configured public target.
It pins the published perspective and calls the API origin, not the API CDN.
The [Query API](https://www.sanity.io/docs/http-reference/query) and
[perspectives](https://www.sanity.io/docs/content-lake/perspectives) document this
surface; [ID access rules](https://www.sanity.io/docs/content-lake/ids) bound what a
tokenless read can see.

Count before scanning (`$types` is the four-type allow-list):

```groq
count(*[_type in $types])
```

Scan with `$after = ""` initially and `$limit = 200`; use the last returned `_id`
for the next page, require strict advancement and stop on a short page:

```groq
*[_type in $types && _id > $after] | order(_id) [0...$limit] {
  _id, _rev, _type, contentId, serviceId, categoryId, language, slug, label,
  "parentRef": parent._ref,
  parentServiceId,
  "canonicalCategoryRef": canonicalCategory._ref,
  canonicalAtStoryRoot
}
```

Repeat the complete scan. Require both totals to match the initial count and
both `_id`/`_rev` sets to match. Also compare the complete narrow projections.
Reconcile totals and languages independently:

```groq
count(*[_type == $type])
count(*[_type == $type && language == $language])
```

Pair `article`/`gallery` by `contentId` plus `_type`, and services by `serviceId`.
Use `language` as the declared document language; categories use `categoryId`
and language-keyed nonblank `label`/`slug`. Check same-language parent chains,
canonical-category ancestry and sibling slugs. A missing published reference is
“unresolved in published perspective”; no conclusion about drafts, releases or
deletion follows. Unknown languages, malformed rows, duplicate identities and
cycles fail the probe; observed drift requires a fresh census, never averaging.

Target fingerprint (SHA-256 of the private target tuple):
`968733d05f96d0774e26a52f090ab2117e9c6ad0c1f80e87418c3456e6983e72`.
Narrow second-scan fingerprint:
`20102784eeac1b4202ed5bbea10acf163a350d2c1e90708ee2fc63702f5196e6`.

The selected worktree retains ignored evidence under
`temp/public-language-coverage/`: exact queries, probe, both scans, independent
verification, aggregate summary, bounded samples, `details.json` and the 23-row
`missing-english-private.tsv`. Detailed identifiers stay there, outside the
committed report. Preserve these receipts before retiring the worktree under
AGENTS.md's ignored-file gate; no cleanup is part of this task.

Validation: two identical complete narrow scans; independent provider counts;
recomputed aggregate arithmetic; bounded identity samples; four synthetic
negative cases (duplicate identity, unknown language, missing field, cycle)
rejected by the validator. The tracked change contains documentation only;
application code, dependencies and runtime configuration are unchanged.
