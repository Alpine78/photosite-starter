# Finnish and English page coverage — AB#255

Owner requirement confirmed on 2026-10-11: every page family, including historical
articles/galleries and customer/administrator pages, needs Finnish and English.
The owner requested starting with home/contact, merged in PR #338 on 2026-10-12.
This is a source-code inventory supplemented by a dated, narrow
[published-language census](audits/ab255-public-language-inventory-2026-10-12.md).
Neither proves accepted translation quality or deployment of the merged code.

| Page family | Verified source behavior | Remaining work / responsible work item |
| --- | --- | --- |
| Home | Merged source adds requested-locale copy, portfolio/latest sections, exact static switches and canonical/alternate metadata. Available versions only enter navigation/sitemap. | AB#255: audit actual authored FI/EN copy, then activate separately. |
| Contact | Merged source adds localized privacy notice, portrait text, fields/status, service names and exact switches. The fixed endpoint and owner-facing delivery stay unchanged. | AB#255: audit live copy and review authored localized service options against the owner catalog. |
| Services / packages | Existing locale routes and stable identity pairs; merged source keeps intro and contact links in the selected language. The 2026-10-12 census finds 8 FI / 3 EN documents: 5 identities lack EN. | AB#255: author/review missing counterparts; narrow ancestor checks pass, content quality remains open. |
| Story root / categories | Existing locale trees and identity switching; census finds 12 FI / 11 EN label-and-slug pairs. | AB#255: author one missing English label/slug pair before its 18 dependent articles; descriptions still need audit. |
| Articles | Existing independently published documents and identity-based links; census finds 28 FI / 10 EN documents: 18 identities lack EN. | AB#255: complete the shared category's English placement, then author/review counterparts. AB#125 supplies linked draft creation; copied source text is not an accepted translation. |
| Public galleries / continuations / filters | Existing locale documents and switches; census finds both languages for all 32 stable identities. Continuation state does not transfer across languages. | AB#255: audit actual body/SEO/caption/alt translation quality, including historical content; declared-language pairs alone do not establish completion. |
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

The owner's standing Claude context-sharing authorization is recorded in
[AGENTS.md](../AGENTS.md#standing-authorization-for-claude-review), imported by
CLAUDE.md, referenced by the Claude review-loop skill, and in the existing local
Claude project memory and memory index.
