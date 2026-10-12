# AB#255 — Home/contact published copy inventory, 2026-10-12

The owner selected home/contact content and any missing-English editing
suggestions after [PR #343](https://github.com/Alpine78/photosite-starter/pull/343).
The owner's commit `3e30bdf` matched the previously reviewed documentation and
local evidence. Required Azure Pipeline #812 passed all application and Studio
checks; merge `d321b70` retains the exact reviewed/tested tree. No conflict or
additional correction was needed. AB#255 remains **Active**.

## Observed field coverage

Two identical published reads found one `siteSettings` and one `homePage`
singleton and four distinct shared media records for the hero, introduction
portrait and two logo roles. The optional contact portrait is absent.

| Authored field group | FI/EN presence |
| --- | ---: |
| Shared settings text fields, including navigation/social labels and metadata | 16 / 16 pairs |
| Home text fields, including introduction and section labels/descriptions | 9 / 9 pairs |
| Four contact privacy-notice fields (included in settings total) | 4 / 4 pairs |
| Shared image alternative text | 4 / 4 pairs |
| Missing or blank English authored text fields | 0 |
| Newly prepared English copy proposals | 0 |

All **25 authored settings/home text fields** already have nonempty FI and EN
entries. Existing English prose remains unchanged; no replacement or missing
copy was invented. Both SEO title templates contain exactly one `%s` placeholder.
The two optional text fields (address and services intro) and the two optional
CTA blocks are absent in both languages; the introduction facts list is empty.
These optional absences are not translation gaps.

Four media records have FI/EN alt and no captions in either language. The two
logo alt pairs repeat the same personal-name branding; that equality alone is
not untranslated descriptive prose. Hero and portrait alt have distinct FI/EN
entries. No malformed or duplicate language/key/value or media visibility/kind
defect was observed in this scope. These are field-presence observations, not
acceptance of wording or proof of what the photographs show.

Shared settings and home have different content gates under
[ADR-0029](../adr/0029-localized-home-and-contact-pages.md): contact does not need
the home document. Strict site-copy arrays reject malformed/duplicate language
entries; required requested-language prose does not fall back. Brand/title
compatibility and accessible media-alt fallback remain distinct from accepted
English copy. Optional CTA copy requires both heading and text; captions do not
fall back. The local field matrix records those ownership/requirement differences.

## Separate page dependencies

A matching published metadata read still finds **8 FI / 3 EN service identities**;
all three English identities are present in the default-language catalog. The
contact implementation intersects the locale catalog with that default catalog.
Five missing English service counterparts therefore remain service-content work;
the earlier local suggestions are not saved or published CMS drafts. This count
is not a rendered form or submission check. The localized Other choice remains
the existing implementation's path for an unlisted service.

Home section/hero destination resolution and featured-gallery placement remain
separate route checks. Shared settings affect other public chrome and services;
shared images can have other consumers. This slice does not inventory every
consumer or prove a complete bilingual home/contact page, live route, media
derivative delivery, legal compliance, deployment or translation quality.

## Source and owner handoff

Main content window: **2026-10-12T08:54:11.255Z → 2026-10-12T08:54:12.788Z UTC**.
Service-dependency window: **08:58:28.958Z → 08:58:29.365Z UTC** on the same date;
both singleton revisions still matched the main window. Tokenless, non-CDN
`published` GETs use API `v2025-02-19`, dataset `production`, deployment-default
language `fi`, and the same locally verified target as previous inventories.
The main scoped source fingerprint is
`81eec46b009f493e9b1c3441a322510b6a970b4f1a9ee4119260a0c4a3c89510`.

Exact queries, both source/dependency reads, revision bindings, field matrix,
full existing FI/EN workbook and a non-writable suggestions receipt with an empty
proposal list are ignored under this worktree's `temp/home-contact-content/`.
Real branding/privacy/image text and provider identities/revisions stay outside
Git. Direct email, phone and business-ID fields were excluded. No credential
variables, asset URLs/bytes, archive locators or dimensions were requested.
Preserve the owner-only files before any worktree retirement under AGENTS.md.

Review the existing workbook and photographs before accepting their meaning.
Published reads cannot see newer FI/EN drafts or release edits; changed revisions
invalidate this observation. Before later CMS editing, refresh source bindings,
drafts and shared-media consumers, coordinating
[ADR-0030](../adr/0030-legacy-identity-retirement.md)'s writer freeze and approved
map reconciliation. AB#258's offline reconciliation tool neither freezes nor
writes the dataset. Local editorial receipts are not CMS consumers or cutover
approval. No CMS draft, publication or Production activation was performed.

Applicable checks cover matching complete graphs/counts, source/hash/revision
bindings, strict field/key and placeholder checks, six synthetic classification
cases, private-value exclusion, local links and whitespace. This documentation
slice changes no runtime behavior; Pipeline #812 verifies its merged base, not
the new documentation edits. Other bilingual page families and service/article
counterparts remain open; broad AB#255 cannot close on this inventory.
