# Finnish and English page coverage — AB#255

2026-10-13 Studio completion: the [initial authenticated check](audits/ab255-authenticated-studio-locales-2026-10-13.md) identified type-header, list-preview and drag-instruction gaps. [Drag localization](audits/ab255-studio-drag-localization-2026-10-13.md) merged in #371; [presentation corrections](audits/ab255-studio-presentation-completion-2026-10-13.md) are complete in #370, with final CI/review pending. Local/source verification is separate from deployed Studio acceptance.

2026-10-13 current publication update: [AB#284's stable complete census and hosted
verification](audits/ab284-current-integrated-preview-2026-10-13.md) supersede the
earlier draft-only publication counts below. Production now has all 28 article,
32 gallery, eight service and 12 category FI/EN pairs, with no missing published
counterpart. The 18 newly approved EN articles and 644 placements were verified
on clean current-main protected Preview, including no-JS pagination. Category/
service and article execution approvals remain their own dated receipts. These
counts do not accept translation quality of every earlier pair, prove hosted
restricted sessions or authorize final Production activation. #397 corrects only
the offline census's four story-root category false positives. Earlier entries
below are historical checkpoints, not today's unpublished-content inventory.

Owner requirement confirmed on 2026-10-11: every page family, including historical
articles/galleries and customer/administrator pages, needs Finnish and English.
The owner requested starting with home/contact, merged in PR #338 on 2026-10-12.
This is a source-code inventory supplemented by a dated, narrow
[published-language census](audits/ab255-public-language-inventory-2026-10-12.md).
Neither proves accepted translation quality or deployment of the merged code.

2026-10-13 release preparation: [Current content census and ordered release gates](audits/ab255-bilingual-release-readiness-2026-10-13.md) reconcile the merged article authoring and remaining Studio/content/activation work. The public-copy packets are preserved locally after worktree retirement. No new CMS write, publication or deployment is included.

2026-10-13 accepted article drafts: the owner approved the complete 18-article
FI/EN workbook and CMS editing-draft creation, with historical polls retained
only on FI versions. [Verified authoring](audits/ab255-approved-article-draft-authoring-2026-10-13.md)
created all 18 EN article drafts and 644 linked end-gallery placement drafts;
their later owner-approved publication and hosted checks are recorded above.
The 23 poll blocks were omitted only from EN drafts. Existing FI content,
polls/votes, shared media, categories and asset counts remain unchanged.
Published coverage still lacks these 18 EN articles: editing drafts are not
publication. EN canonical category and editor/media review remain publication
gates. This approval does not cover category/service/gallery proposals or new
image caption/alt authoring. AB#255 remains Active.

| Page family | Verified source behavior | Remaining work / responsible work item |
| --- | --- | --- |
| Home | Merged source adds requested-locale copy, portfolio/latest sections, exact switches and metadata. Published inventory finds FI/EN on all nine authored home text fields and all 16 shared-settings text fields; referenced image alt also has both languages. | AB#255: owner wording/image review, actual locale destination and journey checks, then activate separately; field presence is not full page acceptance. |
| Contact | Merged source localizes privacy notice, fields/status, service names and exact switches. All four published privacy fields have FI/EN. The metadata catalog intersection has three EN service identities against eight FI identities. | AB#255: accept existing wording and complete five EN service counterparts; verify actual form/delivery journeys. Fixed endpoint and owner-facing delivery remain unchanged. |
| Services / packages | Locale routes and stable identity pairs are implemented; #373 also supplies default-service sibling links. Latest metadata read: 8 FI / 3 EN published versions, five missing EN and no EN service drafts. Service-cover FI/EN alt fields were present in the dated cover audit. | AB#255: accept the five prepared copy/slug proposals, freshly reconcile sources/targets and author approved editing versions preserving covers, pricing and ancestors. Then review/publish and verify real journeys; fixtures are not accepted content. |
| Story root / categories | Existing locale trees and identity switching; census finds 12 FI / 11 EN label-and-slug pairs. Local suggestions cover the missing category's English label, first slug and description. The [description inventory](audits/ab255-category-description-language-inventory-2026-10-12.md) finds 8 both-language, 1 FI-only, 1 EN-only and 2 absent pairs. | AB#255: accept/reconcile and author the shared category's English fields before its 18 dependent articles; review one-language descriptions and their links. Optional absence in both is not a gap. |
| Articles | Latest read: 28 FI / 10 EN published versions and all 18 owner-approved EN editing drafts. #375 fixes temporary draft-parent references; the verified authoring run created 644 placement drafts and omitted 23 poll blocks only from the 16 affected EN versions. | AB#255: finish canonical EN category and editor/placement/media review before publication. Every EN draft still has pending review fields. General album-image alt/caption authoring is deferred after MVP; no new image descriptions are generated. |
| Cross-page shared public media | The [initial record inventory](audits/ab255-shared-media-language-inventory-2026-10-12.md) finds 5,272 eligible records: alt has 4,585 both-language and 687 FI-only pairs; optional captions have 800 both, 678 FI-only, 1 EN-only and 3,793 absent pairs. | AB#255: identify page-owned hero/service consumers and occurrence overrides before any separately approved image-text work. General album-image alt/caption authoring is deferred after MVP. Record presence does not establish consumer reachability or accepted translations; draft/release state remains separate. |
| Public galleries / continuations / filters | Existing locale documents and switches; the [document-text inventory](audits/ab255-gallery-text-language-inventory-2026-10-12.md) confirms all 32 FI/EN pairs and matching optional summary/body presence. One pair has different section identities; identical labels and body structure differences need editorial review. Continuation state does not transfer across languages. | AB#255: accept document wording/structures and section-label proposals; verify actual SEO, links, filters and continuation journeys. General album-image alt/caption authoring is deferred after MVP. Declared-language pairs alone do not establish completion. |
| Site search (AB#299) | Source supplies FI/EN dialog and results-page copy, a localized search route per locale (`searchNamespace`), a language switch between the two search pages that carries no query, and results limited to the requested locale's published stories and services; a term found only in the other language finds nothing. | AB#299: owner wording review of the built-in search copy; hosted `/haku` and `/en/search` journeys after the owner-run `SITE_LOCALE_ROUTES` update (default is `search`); image and keyword search are not covered and wait for the taxonomy chain (AB#55). What is findable follows each language's own authored titles, tags and leads. |
| Retained unlisted legacy deliveries | Merged #372 supplies FI/EN UI selection via validated locale query while retaining the existing client-gallery namespace. ADR-0028 delivery/expiry contracts remain separate. | AB#255: verify hosted FI/EN pages after authorized activation. Retained ZIP transport and migration release acceptance remain independent. |
| Protected client galleries / proofing | Merged #372 supplies configured FI/EN UI selection without adding a preference cookie or public static route prefix. | AB#255: verify hosted authorized sessions, navigation and failures while preserving capability bootstrap, no-store/noindex and object-store boundaries. |
| Private administrator | Merged #372 localizes sign-in/admin UI and retains selected query locale through login/logout with ADR-0015 authentication unchanged. | AB#255: verify hosted authorized FI/EN operations and failures after activation. Locale never grants access. |
| Not-found / error / unavailable states | Merged #372 adds locale context across restricted and public error boundaries; route-specific labels and contact messages retain the selected language. | AB#255: verify actual hosted failure states in both languages. AB#132 scriptless 404 limits remain independent. |
| Standalone Studio | Core locale and 11 structure titles are merged. #371 completes 159 core keys and drag accessibility; #370 completes field/help/validation, compiled type headings and localized full-frame document-list previews. Authenticated local FI/EN checks are recorded in their own audits. | AB#255: final-head CI/review, merge #371 then #370, then separately authorized Studio hosting and final wording/live acceptance. Pinned internal SDK bridges require upgrade checks; local/source evidence does not prove deployed Studio. |

The [offline authoring preflight](audits/ab255-content-authoring-preflight-2026-10-12.md)
originally joined one category, five services and two article proposals, all
owner-pending at the time. The later owner approval and 18 article drafts are
recorded above; category/service/gallery packets remain pending.
Existing category/service creators are not arbitrary update adapters; the service
CLI cannot write coverMedia, and the category CLI cannot patch the existing shared
category. Current identities/revisions, media and owner acceptance still gate
saving/publication. Parallel public-journey, restricted-locale and Studio core-UI
branches own their separate results; this preflight implements no runtime change.

The initial route contract is [ADR-0029](adr/0029-localized-home-and-contact-pages.md).
Absent required non-default language entries withhold the corresponding static page.
Missing required default-language copy remains a configuration error.
Malformed provider data and provider failures still fail rather than being hidden
as missing translations. Demo fixtures prove both locale directions; they cannot
prove the historical live content is fully translated. ADR-0008's accessible
media-alt fallback remains; the live home/contact audit must include missing
FI/EN image descriptions as well as shared prose.

Shared settings are strict: until all required settings copy for a non-default locale exists,
its static home/contact pages remain unavailable. Existing stories retain the
prior default-settings shell during that transition. Optional untranslated blocks
remain absent; arbitrary authored static links are not automatically translated.
No CMS write, live translation, Production deployment or authentication change is
part of these source and census slices. AB#255 remains Active after the first slice's merge.

[English copy preparation](audits/ab255-english-copy-drafts-2026-10-12.md) records
the initial owner-selected copy-preparation slice. Later article acceptance and
draft creation are recorded above; other packets still require acceptance. Before authoring,
inspect newer FI and existing EN drafts and recompare source revisions.
Coordinate later CMS authoring with [ADR-0030](adr/0030-legacy-identity-retirement.md)'s
approved mapping and [ADR-0031](adr/0031-identity-migration-operational-plan.md)'s
accepted implementation policy. No operational freeze or CMS write approval is
inferred; refresh mapped identities, variants and revisions before later authoring.

[The service-cover inventory](audits/ab255-service-media-language-inventory-2026-10-12.md)
observes no missing FI/EN alt or source-only caption on current covers. Presence
does not accept translation quality or image semantics; pending media drafts and
changes to cover references remain outside this dated published observation.

[The home/contact content inventory](audits/ab255-home-contact-content-inventory-2026-10-12.md)
finds no missing English authored text requiring a new local proposal. Optional
blocks absent in both languages remain optional; existing translations still
need owner acceptance. Service choices and home destinations are separate
dependencies, and this inventory does not establish live page readiness or activation.

The owner's standing Claude context-sharing authorization is recorded in
[AGENTS.md](../AGENTS.md#standing-authorization-for-claude-review), imported by
CLAUDE.md, referenced by the Claude review-loop skill, and in the existing local
Claude project memory and memory index.


2026-10-12 continuation: [Public bilingual editing proposals completed](audits/ab255-public-copy-completion-2026-10-12.md).

2026-10-12 continuation: [Restricted page UI locale implementation](audits/ab255-restricted-page-locales-2026-10-12.md).

2026-10-12 continuation: [Studio schema interface localization](audits/ab255-studio-schema-locales-2026-10-12.md).

2026-10-12 continuation: [Default service aliases expose actual language siblings](audits/ab255-default-service-language-links-2026-10-12.md).
General album-image alt/caption authoring is deferred until after MVP. This does
not remove existing descriptions or alter image/media contracts. AB#255 remains
Active until all applicable page families, accepted content and live journeys
meet the owner's bilingual requirement.

2026-10-12 continuation: [Finnish Studio core resource additions](audits/ab255-studio-core-locale-additions-2026-10-12.md).
