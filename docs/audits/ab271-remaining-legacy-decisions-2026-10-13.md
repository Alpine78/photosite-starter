# AB#271 — remaining legacy URL decisions, 2026-10-13

AB#271 is Active under AB#19. All 37 remaining paths now have explicit same-language
decisions: ten direct published equivalents and 27 visible ancestry/home fallbacks.
No new Gone response, unknown-path rule, CMS content, translation or offering is introduced.

## Evidence and classification

The October 9 Joomla backup was rehashed:
`de1c60e148a38dffbe19b6b9e48af5c4097d47518958731455eb6a0080a7c600`.
A restricted literal SQL reader inspected public menus, category ancestry and source article
399; no SQL was executed. Private source fragments and content remain outside Git.
The current complete raw Production snapshot contains 17,609 documents and 5,158 assets;
its hash still matches the recoverable baseline. Source 399 is the English Wedding Portfolio
in category 163, distinct from the general portfolio. Menu/article IDs below retain identity
even when aliases resemble a different service.

The published CMS was used in a local production build of the current source plus this
patch. All **415** inventory classifications passed the owner-run checker: 232 redirects,
179 justified Gone responses, zero pending paths, three excluded error pages and one live
home. Every applicable target returned 200 with its parameter-free canonical, and every
fallback explained the unavailable content with noindex and no hreflang alternate.
This is local current-source evidence, not approval of the final deployed artifact.

The two previously structural `/valokuvaus` aliases now target the actual Finnish canonical
`/palvelut`. The old `/services` target renders but canonicalizes to `/palvelut` in the
current deployment configuration. The English `/en/` home alias is direct because the current
merged-source production build serves `/en` successfully. The older live deployment still
returned 404 for that English home during this check; deploy the reviewed source before
claiming final production verification.

| Source | Joomla identity | Direct target | Decision |
| --- | --- | --- |
| `/en/` | English home alias | `/en` | Published equivalent |
| `/en/photography` | menu 792 / category 161 | `/en/services` | Published equivalent |
| `/en/wedding-portfolio` | article 399 / category 163 | `/en/stories/wedding-portfolio` | Published equivalent |
| `/en/wedding/ceremony-portraits` | menu 806 / article 393 | `/en/services/wedding-photography/ceremony-and-portraits` | Published equivalent |
| `/haakuvaus/vihkiseremonia` | menu 833 / article 306 | `/palvelut/haakuvaus/vihkiseremonia` | Published equivalent |
| `/fi/haakuvaus/vihkiseremonia` | menu 833 / article 306 | `/palvelut/haakuvaus/vihkiseremonia` | Published equivalent |
| `/valokuvaus/asuntokuvaus` | menu 1072 / article 473 | `/palvelut/asuntokuvaus` | Published equivalent |
| `/fi/valokuvaus/asuntokuvaus` | menu 1072 / article 473 | `/palvelut/asuntokuvaus` | Published equivalent |
| `/valokuvaus/hautajaiskuvaus` | menu 825 / article 312 | `/palvelut/hautajaiskuvaus` | Published equivalent |
| `/fi/valokuvaus/hautajaiskuvaus` | menu 825 / article 312 | `/palvelut/hautajaiskuvaus` | Published equivalent |
| `/valokuvat` | menu 836 / category 127 | `/` | Unavailable notice |
| `/fi/valokuvat` | menu 836 / category 127 | `/` | Unavailable notice |
| `/valokuvat/sekalaiset` | menu 844 / category 132 | `/` | Unavailable notice |
| `/fi/valokuvat/sekalaiset` | menu 844 / category 132 | `/` | Unavailable notice |
| `/en/blog` | menu 807 / category 160 | `/en` | Unavailable notice |
| `/en/photos` | menu 808 / category 162 | `/en` | Unavailable notice |
| `/en/photos/misc` | menu 816 / category 181 | `/en` | Unavailable notice |
| `/valokuvaus/juhlakuvaus` | menu 824 / article 340 | `/palvelut` | Unavailable notice |
| `/fi/valokuvaus/juhlakuvaus` | menu 824 / article 340 | `/palvelut` | Unavailable notice |
| `/valokuvaus/perhe-ja-lapsikuvaus` | menu 822 / article 310 | `/palvelut` | Unavailable notice |
| `/fi/valokuvaus/perhe-ja-lapsikuvaus` | menu 822 / article 310 | `/palvelut` | Unavailable notice |
| `/valokuvaus/valmistujaiskuvaus` | menu 823 / article 311 | `/palvelut` | Unavailable notice |
| `/fi/valokuvaus/valmistujaiskuvaus` | menu 823 / article 311 | `/palvelut` | Unavailable notice |
| `/valokuvaus/yrityskuvaus` | menu 827 / article 313 | `/palvelut` | Unavailable notice |
| `/fi/valokuvaus/yrityskuvaus` | menu 827 / article 313 | `/palvelut` | Unavailable notice |
| `/en/photography/business` | menu 799 / article 382 | `/en/services` | Unavailable notice |
| `/en/photography/event` | menu 796 / article 380 | `/en/services` | Unavailable notice |
| `/en/photography/funeral` | menu 797 / article 383 | `/en/services` | Unavailable notice |
| `/en/photography/graduation` | menu 795 / article 384 | `/en/services` | Unavailable notice |
| `/en/photography/kid-family` | menu 794 / article 385 | `/en/services` | Unavailable notice |
| `/en/photography/real-estate` | menu 1073 / article 474 | `/en/services` | Unavailable notice |
| `/en/wedding/ceremony` | menu 805 / article 392 | `/en/services/wedding-photography` | Unavailable notice |
| `/en/wedding/from-morning` | menu 801 / article 388 | `/en/services/wedding-photography` | Unavailable notice |
| `/en/wedding/half-day` | menu 803 / article 390 | `/en/services/wedding-photography` | Unavailable notice |
| `/en/wedding/whole-day` | menu 802 / article 389 | `/en/services/wedding-photography` | Unavailable notice |
| `/haakuvaus/aamusta-iltaan` | menu 829 / article 337 | `/palvelut/haakuvaus` | Unavailable notice |
| `/fi/haakuvaus/aamusta-iltaan` | menu 829 / article 337 | `/palvelut/haakuvaus` | Unavailable notice |

## Content and release constraints

The English Blog category and five service counterparts still await owner-approved copy
and publication under AB#270. Their exact legacy rows use published same-language ancestors
until that happens. Re-evaluate `/en/blog`, the funeral/real-estate service aliases and the
ceremony/half-day/whole-day aliases after actual publication; a published exact replacement
takes precedence over fallback. No fallback is evidence of a translated missing page.

The original morning-to-evening wedding offers are over twelve hours, while the published
full-day package is eight hours. They stay distinct and reach the wedding parent with the
unavailable notice. Unmigrated photography offers reach their verified services-category
replacement. Photos/Misc categories have no surviving corresponding category or ancestor
beyond the language root and reach that language’s home with the notice, per ADR-0003.

Service listings and ancestors now share the existing fixed localized notice behavior.
It is server-rendered, accessible as status, noindex, canonical without parameters, and has
no language alternate. Invalid/repeated values display no notice and no request text is
rendered. Images, media delivery and ordinary service content retain their existing contracts.

Validation: lint, 6,024 browser-free tests, TypeScript, harness production build and 132
Chromium/WebKit journeys (four data-dependent skips for empty pending/clone-only cases).
The real-CMS local production build and all 415 read-only mapping checks also pass.
Security/React review covered closed fixed notices, query preservation, locale boundaries,
server rendering, semantic tokens and unchanged full-frame media. No independent Claude
review, deployed rollback or owner security/privacy acceptance is claimed.

AB#19 remains Active until the exact reviewed release version and canonical origin are
checked on the final deployment. Keep numeric query state, retired sitemap aliases, unknown
404 behavior, the copy approval gate and supported whole-ZIP delivery as separate facts.
