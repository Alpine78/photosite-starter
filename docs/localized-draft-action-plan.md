# Linked localized draft action plan (AB#125)

**Status:** the owner-run linked-draft creator, pure plan, and Studio review guards are implemented on the AB#125 implementation branch. The customer-owned Studio still needs an action UI and live Studio verification before AB#125 is complete.

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

## Implemented owner-run action

`npm run create:localized-draft -- --content-id <id> --from <language> --to <language>`
reads the source draft when present, otherwise its published version. It requires
`SANITY_PROJECT_ID`, `SANITY_DATASET`, `SANITY_API_VERSION`, `SANITY_LOCALIZATION_TOKEN`, and
`SITE_LOCALE_ROUTES` in the owner's environment. Mint a temporary Editor-role token
for this authoring run, distinct from demo seeding, migration, runtime read, and
poll-voting tokens; revoke it afterward. The default is a read-only dry run;
`--yes` submits one atomic strict-create transaction. It never edits the source, writes
only `drafts.` IDs, and uses deterministic IDs so a repeated creation fails. A target
version already present under any ID is rejected at preflight. The transaction's strict
creates also stop two runs of this command racing for the same target ID. Independent
Studio or API clients that invent unrelated IDs still rely on the existing schema and
public-adapter identity checks.

The draft retains copied text as an editing base and records exact `pendingFields` in
`localizationReview`. Remove a path only after editing or confirming its translation.
The article, gallery, and placement schemas block ordinary Studio publication while
pending paths remain. Their existing content-placement guard checks that the canonical
category has a published path in the target language. Media documents are shared; the
command reports missing target-language alt and caption entries in a persisted notice
list, without creating or changing media. A source-language poll block is refused because
poll IDs identify separate language-specific votes. Capture-sequence galleries reuse the
same media sequence without creating placement documents. Seeded-random galleries copy
only valid materialized order keys.

Sanity schema validation runs in Studio, not in Content Lake. A direct API publication
can bypass the review guard; the command never publishes. The customer-owned Studio
needs a document action UI that offers the target only when absent and invokes this
same planning/creation contract. That UI, large-gallery handling beyond one 3.5 MB
transaction, and live Studio tests remain open in AB#125. The owner should inspect the
dry-run report and perform the command on their own dataset only after reviewing the
result. No live content was written by this implementation.

## Source placement review follow-up (2026-10-05)

A new language cannot be derived from a page or selected source placement whose
localization review is pending or malformed. This includes gallery placements and
article end-gallery placements, including a selected placement draft when the page
is published. A review marker without its source-language marker still requires
review. The refusal names the placement; no mutation or partial plan is returned.
Reviewed source placements receive a new pending-fields list for the immediate
source language. Ordinary unlocalized source placements retain their behavior.
The Studio action and live verification remain open; AB#125 stays Active.
