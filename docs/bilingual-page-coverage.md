# Finnish and English page coverage — AB#255

2026-10-13 continuation: [Authenticated Windows/WSL Studio check](audits/ab255-authenticated-studio-locales-2026-10-13.md). FI/EN switching and ten editorial forms were exercised; root schema-header text, list preview localization/full-frame thumbnails and array screen-reader instructions remain explicit gaps. This is not complete Studio coverage.

Owner requirement confirmed on 2026-10-11: every page family, including historical
articles/galleries and customer/administrator pages, needs Finnish and English.
The owner requested starting with home/contact, merged in PR #338 on 2026-10-12.
This is a source-code inventory supplemented by a dated, narrow
[published-language census](audits/ab255-public-language-inventory-2026-10-12.md).
Neither proves accepted translation quality or deployment of the merged code.

| Page family | Verified source behavior | Remaining work / responsible work item |
| --- | --- | --- |
| Home | Merged source adds requested-locale copy, portfolio/latest sections, exact switches and metadata. Published inventory finds FI/EN on all nine authored home text fields and all 16 shared-settings text fields; referenced image alt also has both languages. | AB#255: owner wording/image review, actual locale destination and journey checks, then activate separately; field presence is not full page acceptance. |
| Contact | Merged source localizes privacy notice, fields/status, service names and exact switches. All four published privacy fields have FI/EN. The metadata catalog intersection has three EN service identities against eight FI identities. | AB#255: accept existing wording and complete five EN service counterparts; verify actual form/delivery journeys. Fixed endpoint and owner-facing delivery remain unchanged. |
| Services / packages | Existing locale routes and stable identity pairs; merged source keeps intro and contact links in the selected language. The 2026-10-12 census finds 8 FI / 3 EN documents: 5 identities lack EN. Local suggestions cover all five, including body and price wording. The cover audit finds FI/EN alt on all eight shared covers; optional captions are absent in both languages. [Service journeys](audits/ab255-service-locale-journeys-2026-10-12.md) now verify UI/media/contact retention in both fixture locales, nested-service alternates and scriptless switching. | AB#255: owner copy/slug and image-text meaning review, live FI/EN draft reconciliation, then author counterparts; published counts remain unchanged. Legacy default-service language-link/metadata parity and additional failure states remain; fixture prose is not accepted translation. |
| Story root / categories | Existing locale trees and identity switching; census finds 12 FI / 11 EN label-and-slug pairs. Local suggestions cover the missing category's English label, first slug and description. The [description inventory](audits/ab255-category-description-language-inventory-2026-10-12.md) finds 8 both-language, 1 FI-only, 1 EN-only and 2 absent pairs. | AB#255: accept/reconcile and author the shared category's English fields before its 18 dependent articles; review one-language descriptions and their links. Optional absence in both is not a gap. |
| Articles | Existing independently published documents and identity-based links; refreshed counts remain 28 FI / 10 EN: 18 identities lack EN. [Copy batch 1](audits/ab255-english-article-drafts-batch-1-2026-10-12.md) and [batch 2](audits/ab255-english-article-drafts-batch-2-2026-10-12.md) now hold two complete local article-owned proposals, retaining 28 and 38 blocks respectively. | AB#255: accept copy/slugs/category and reconcile each article's shared media, inherited FI poll and end gallery. Batch 2 references 36 FI-only shared alt/caption records and 36 visible end-gallery occurrences. Sixteen other proposals remain unprepared in these two packets. AB#125 supplies linked draft creation, but currently rejects batch 2's inherited poll block as-is; a target-only poll decision/support or manual authoring is needed. Local copy is not a CMS draft or accepted translation. |
| Cross-page shared public media | The [initial record inventory](audits/ab255-shared-media-language-inventory-2026-10-12.md) finds 5,272 eligible records: alt has 4,585 both-language and 687 FI-only pairs; optional captions have 800 both, 678 FI-only, 1 EN-only and 3,793 absent pairs. | AB#255: resolve actual public-page consumers and occurrence overrides, then prioritize counterpart copy and image meaning review. Record presence does not establish consumer reachability or accepted translations; draft/release state remains separate. |
| Public galleries / continuations / filters | Existing locale documents and switches; the [document-text inventory](audits/ab255-gallery-text-language-inventory-2026-10-12.md) confirms all 32 FI/EN pairs and matching optional summary/body presence. One pair has different section identities; identical labels and body structure differences need editorial review. Continuation state does not transfer across languages. | AB#255: accept document wording/structures, then audit shared alt/captions and placement overrides; verify actual SEO, links, filters and continuation journeys. Declared-language pairs alone do not establish completion. |
| Retained unlisted legacy deliveries | `/client-gallery/...` resolves its own namespace; the shell uses default-locale labels. ADR-0028's owner-accepted file-delivery exception is independent of language support. | AB#255: add bilingual page UI/links without changing retained URLs, expiry or download semantics. |
| Protected client galleries / proofing | Rewritten private namespace and document shell use deployment-default labels/locale. No public static prefix is added by this slice. | AB#255: bilingual authorized UI/navigation while preserving capability bootstrap, sessions, no-store/noindex and object-store isolation (ADR-0014). |
| Private administrator | Its own root namespace; page uses getDefaultLocaleLabels and deployment locale. | AB#255: bilingual sign-in and administrator UI while preserving ADR-0015's independent session and authentication boundary. |
| Not-found / error / unavailable states | Existing not-found boundaries select route labels; AB#132 documents the separate scriptless 404 limitation. Shared form messages use the selected page's label set. | AB#255: verify every family/state in both languages, keep AB#132's unresolved behavior visible. |
| Standalone Studio | Separate Sanity application and session. [Core language-choice build](audits/ab255-studio-core-locale-build-2026-10-12.md) registers pinned Finnish locale 1.1.40 alongside English. [Structure titles](audits/ab255-studio-structure-locales-2026-10-12.md) register 11 project-owned EN/FI resource keys across 21 nodes; both are combined in the Studio configuration. The [source inventory](audits/ab255-studio-language-inventory-2026-10-12.md) finds 159 missing core keys. Schema/preview/custom-validation text and authored content remain separate. | AB#255: verify authenticated FI/EN switching, persistence, wording and applicable fallback/gaps; complete remaining project interface text. Preserve content identities, editorial controls and independent authentication/deployment; source/build evidence is not full bilingual acceptance. |

The [offline authoring preflight](audits/ab255-content-authoring-preflight-2026-10-12.md)
joins one category, five services and two article proposals, all owner-pending.
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
the next owner-selected slice. Its local suggestions are proposed editing copy,
not saved CMS drafts, publication or accepted translations. Before authoring,
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

2026-10-12 continuation: [Finnish Studio core resource additions](audits/ab255-studio-core-locale-additions-2026-10-12.md).

2026-10-12 continuation: [Default service aliases expose actual language siblings](audits/ab255-default-service-language-links-2026-10-12.md).
General album-image alt/caption authoring is deferred until after MVP. This does
not remove existing descriptions or alter image/media contracts. AB#255 remains
Active until all applicable page families, accepted content and live journeys
meet the owner's bilingual requirement.
