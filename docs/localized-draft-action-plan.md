# Linked localized draft action plan (AB#125)

**Status:** implementation design for the Studio action; no Studio action or draft write exists yet.

## Current source contract

`sanity/schemas/article.ts` and `gallery.ts` store one document per language. The shared `contentId` identifies the page across versions; `language` identifies one version. A draft can be incomplete, while document and field validation block publication. Article and gallery have their own `body` blocks; a gallery's curated placements are separate `galleryPlacement` documents, and its `sections` catalog is embedded on the gallery. The public adapter reads published documents only.

## Action input and preflight

The action is offered on a saved article or gallery and asks for a target language from configured language subtags. It must resolve the source's stable `contentId`, source type, and current revision before writing. Query both published and draft versions for the same `contentId` and target `language`; if either exists, refuse with a link to that version. Also refuse a target language that is not configured, a source without stable identity, or a cross-type identity conflict. Repeat the duplicate check in the write transaction or use a deterministic target document ID so concurrent clicks cannot create two drafts.

The action creates **only a target draft**. It never patches or republishes the source and never creates a public page. The target shares `contentId`, has the requested `language`, and receives a new document identity. It keeps stable structural identities (`_key` on copied body items, `sectionId`, `endGalleryId`), ordering rules, dates, cover/media references, and relevant placement references. It must not copy Sanity system metadata such as source `_rev`, `_createdAt`, or `_updatedAt`.

## Localization review

Copying prose verbatim into a valid-looking target risks accidental publication. The first draft should omit or clearly mark language-dependent fields for review: page `title`, `slug`, `summary`, article `author` when authored, gallery section `label`, `slug`, and `intro`, and the text inside every body kind (paragraphs, headings, lists, quotes, media captions, video titles, tables, comparison labels, tab labels, and any linked poll text). Keep nonlinguistic IDs, references, order, and block kinds. The review marker must stay in Studio-only draft metadata or a dedicated field excluded from public projection; it must never appear on a published page as fake translated content.

Before publishing, require actual localized title/slug and every required block text. Revalidate the target's canonical category in that language, because copying a category reference does not prove that category has a target-language public path. Existing content-placement validation remains the final publication guard. The action's review UI should enumerate every field requiring work; a checklist alone is insufficient if publish validation allows old-language text through. A specific guard or deliberate blanking strategy is needed.

## Gallery placement boundary

Gallery placements have their own documents and per-language gallery reference. The action must inspect the source gallery's ordering representation before copying anything: manual/seeded-random placements, capture-sequence media, and article end-gallery placements have different sources. It must preserve the authored sequence and stable placement IDs without binding a target placement to the source document. Duplicate detection must include target-language placements. Seeded-random materialized order and seed consistency need the existing recompute contract; simply copying a stale key would make the new gallery unavailable.

## Implementation sequence

1. Build a pure, tested draft plan from sanitized article/gallery snapshots and a target language. It should return the target document and an explicit list of localization paths, never perform a write.
2. Add Studio-side action wiring in the customer-owned Studio integration using verified current Sanity APIs. This repository only exports plain schema definitions; it does not currently host a Studio app or depend on the Sanity Studio package, so API signatures must be checked before adding that integration.
3. Make the create operation conditional/idempotent, then test source immutability, duplicate refusal, target draft-only state, references/order, and publish blocking.
4. Test an article and a gallery in the actual Studio, including a missing target-language category and a seeded-random gallery.

This plan does not claim that a localized draft can yet be created. It identifies the separate placement and publish-safety work that a page-document copy alone would miss.
