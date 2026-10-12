# Finnish and English page coverage — AB#255

Owner requirement confirmed on 2026-10-11: every page family, including historical
articles/galleries and customer/administrator pages, needs Finnish and English.
The owner requested starting with home/contact. This is a source-code inventory,
not a live CMS completeness audit or a claim that this branch is deployed.

| Page family | Verified source behavior | Remaining work / responsible work item |
| --- | --- | --- |
| Home | This slice adds requested-locale copy, portfolio/latest sections, exact static switches and canonical/alternate metadata. Available versions only enter navigation/sitemap. | AB#255: owner review/merge, audit actual authored FI/EN copy, then activate separately. |
| Contact | This slice adds localized privacy notice, portrait text, fields/status, service names and exact switches. The fixed endpoint and owner-facing delivery stay unchanged. | AB#255: audit live copy; inventory services lacking an owner-catalog counterpart. |
| Services / packages | Existing locale routes and stable service identity pairs; this slice keeps intro, contact CTA/detail links in the selected language. | AB#255: audit and author missing FI/EN service documents and ancestors; no total is inferred from fixtures. |
| Story root / categories | Existing locale-specific trees, descriptions and identity-based switching; unpublished category languages remain absent. | AB#255: audit missing localized category labels/slugs/descriptions and coverage. |
| Articles | Existing independently published per-language documents, stable content IDs and exact/parent language links. | AB#255 content coverage; related AB#125 supplies linked draft creation, AB#126 covers optional editorial assistance. Inventory actual missing counterparts, translate/review, then publish; never treat copied source text as an accepted translation. |
| Public galleries / continuations / filters | Existing per-language gallery documents, captions/sections and identity-based language switching; continuation state intentionally does not transfer across languages. | AB#255: inventory missing gallery counterparts and media text, including historical content. |
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
part of this source slice. AB#255 remains Active after its first slice merges.

The owner's standing Claude context-sharing authorization is recorded in
[AGENTS.md](../AGENTS.md#standing-authorization-for-claude-review), imported by
CLAUDE.md, referenced by the Claude review-loop skill, and in the existing local
Claude project memory and memory index.
