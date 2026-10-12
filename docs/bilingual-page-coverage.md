# Finnish and English page coverage — AB#255

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
| Services / packages | Existing locale routes and stable identity pairs; merged source keeps intro and contact links in the selected language. The 2026-10-12 census finds 8 FI / 3 EN documents: 5 identities lack EN. Local suggestions cover all five, including body and price wording. The cover audit finds FI/EN alt on all eight shared covers; optional captions are absent in both languages. | AB#255: owner copy/slug and image-text meaning review, live FI/EN draft reconciliation, then author counterparts; published counts remain unchanged. |
| Story root / categories | Existing locale trees and identity switching; census finds 12 FI / 11 EN label-and-slug pairs. Local suggestions cover the missing category's English label, first slug and description. | AB#255: accept/reconcile and author the shared category's English fields before its 18 dependent articles; other descriptions still need audit. |
| Articles | Existing independently published documents and identity-based links; refreshed counts remain 28 FI / 10 EN: 18 identities lack EN. [Copy batch 1](audits/ab255-english-article-drafts-batch-1-2026-10-12.md) proposes one complete article-owned English text locally, retaining all 28 blocks. | AB#255: accept the copy/slug and category proposal, reconcile seven shared EN alt fields, the FI poll and 41 FI end-gallery occurrences; prepare the other 17 articles and author/review counterparts. AB#125 supplies linked draft creation; local copy is not a CMS draft or accepted translation. |
| Public galleries / continuations / filters | Existing locale documents and switches; the [document-text inventory](audits/ab255-gallery-text-language-inventory-2026-10-12.md) confirms all 32 FI/EN pairs and matching optional summary/body presence. One pair has different section identities; identical labels and body structure differences need editorial review. Continuation state does not transfer across languages. | AB#255: accept document wording/structures, then audit shared alt/captions and placement overrides; verify actual SEO, links, filters and continuation journeys. Declared-language pairs alone do not establish completion. |
| Retained unlisted legacy deliveries | `/client-gallery/...` resolves its own namespace; the shell uses default-locale labels. ADR-0028's owner-accepted file-delivery exception is independent of language support. | AB#255: add bilingual page UI/links without changing retained URLs, expiry or download semantics. |
| Protected client galleries / proofing | Rewritten private namespace and document shell use deployment-default labels/locale. No public static prefix is added by this slice. | AB#255: bilingual authorized UI/navigation while preserving capability bootstrap, sessions, no-store/noindex and object-store isolation (ADR-0014). |
| Private administrator | Its own root namespace; page uses getDefaultLocaleLabels and deployment locale. | AB#255: bilingual sign-in and administrator UI while preserving ADR-0015's independent session and authentication boundary. |
| Not-found / error / unavailable states | Existing not-found boundaries select route labels; AB#132 documents the separate scriptless 404 limitation. Shared form messages use the selected page's label set. | AB#255: verify every family/state in both languages, keep AB#132's unresolved behavior visible. |
| Standalone Studio | Separate Sanity application and session; schema field titles and configuration are not a localized public page tree. | AB#255: clarify/implement FI/EN authoring UI coverage under the all-pages requirement; retain the Studio's separate authentication/deployment. |

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
Coordinate CMS authoring with [ADR-0030](adr/0030-legacy-identity-retirement.md)'s
freeze and approved mapping; after cutover refresh mapped identities and revisions.

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
