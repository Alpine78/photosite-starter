# AB#19 — final-decision continuation, 2026-10-12

Superseding owner decision, 2026-10-13: the two inventoried sitemap aliases
are retired with direct HTTP 410. The focus-speed fallback recorded below is
historical evidence and no longer the implemented decision. The current registry
keeps that alias separate from source 370's camera-review redirect and retains
the other decisions in this audit, including Komento 410s and numeric-query handling.

Status: eleven source-backed decisions prepared; 37 paths remain pending.
AB#19 stays Active. Source baseline is main `5262def`; the actual serving
Production artifact remains `dpl_6e4xtTvbq7Zd39g3mmp9AVNL7KYF`, tagged with base
`14b1af0` and `gitDirty=1`. That base does not prove the complete deployed patch;
its uncommitted source delta is not established by this readback. The deployment
ID binds live observations. New branch rows are not claimed deployed.

## Verified decisions

The October 9 Joomla backup's bytes still match the preserved source digest.
Its SQL menu/article/category identities, public state and language were read again.
This is not matching titles or guessing from URL shapes.

| Exact legacy source | Decision and evidence |
| --- | --- |
| `/blogi/370-fujifilm-x-pro2` | Direct 301 to `/tarinat/blogi/fujifilm-x-pro2`; the numeric ID, alias, source language and imported identity all match article 370. The target currently returns 200, Finnish semantic heading and the exact canonical. Joomla formerly sent this spelling to its error page; it is retained as a useful article alias. |
| `/kalusto`, `/fi/kalusto` | Source article 452 belongs to source category 133. Explicit nearest-category 301 to `/tarinat/yleinen` with the controlled unavailable-content notice. |
| `/sivusto`, `/fi/sivusto` | Source article 453, same verified category and same Finnish notice target. |
| `/en/gear`, `/en/site` | Sources 451/454 belong to English category 163. The preserved article-translation association establishes its shared current category 133; direct 301 to `/en/stories/common` with the controlled notice. |
| `/sivustokartta/fujifilm-x-pro2-tarkennusnopeus` | Source 450 belongs to category 133 and is distinct from camera review 370. The unmigrated article uses its own nearest-category notice; it is not redirected to a different camera article. |
| `/component/komento/profile`, `/component/komento/profile/138`, `/en/component/komento/profile` | Justified 410. The source component router, profile view and model prove commenter identity and comment/like statistics; no same-intent public profile system exists. This is not an article/category home fallback. |

Both real category-notice targets return 200 and pass the existing verifier's
canonical, noindex, rendered semantic status and absent-language-alternate checks.
The seven fallback rows append exactly `legacy-notice=content-unavailable`; stale
cursor/section and conflicting notice values cannot cross into the destination.
Existing numeric/unrelated query state stays intact. No CMS content was invented,
translated, published, removed or reclassified.

The registry now accounts for all 415 paths: 197 redirects, 177 gone, 37 pending,
three excluded error paths and one already-live root. The original 174 tag
removals remain distinct from the three commenter-profile decisions. Clones empty
both first-site gone lists and the migration rows; the reusable engine is unchanged.

## Request-boundary correction

A new production-build test reproduced a real inherited defect: Next.js 16.3.8's
default Proxy URL reconstruction changes bare `?4738` to `?4738=` before the
byte-preserving policy receives it. A raw Production HTTP probe confirmed that
behavior on an already deployed article redirect. The documented
[skipProxyUrlNormalize flag](https://nextjs.org/docs/app/api-reference/file-conventions/proxy)
keeps the original URL, and the exact raw-query regression now passes. Proxy still
performs no content lookup and forwards only its existing bounded path/presence
facts. No cursor, secret or complete query enters the request-header contract.

The full production-build matrix after this boundary correction passed 895 cases
with 38 existing skips. Adding the later fallback/profile data exposed obsolete
test assumptions that every content redirect has an empty query and the first
pending path is unknown in the inverted fixture locale table. The tests now assert
the declared direct/notice shape and select a genuinely unknown fixture page;
all pending rows still keep the owner-run checker incomplete. The final focused
legacy/notice journeys are reported with the PR. No worker/retry/tolerance change
or framework internal patch hides a failure.

## Production observations and exact remaining scope

The serving-source verifier checked all 367 previously decided rows and their
shared targets with zero failed expectations; the overall result is incomplete
because 48 decisions were pending in that serving registry. A separate pending
probe on the earlier 47-row branch observed 46 HTTP 404s and one HTTP 308, with
zero network failures. Neither a 404 nor a redirect observation decides removal.
New branch decisions still need serving-source verification after an accepted deploy.

The new `pending <origin>` mode performs anonymous manual-redirect source probes
and emits only exact source/status/fixed-error observations. It never follows a
Location, chooses a target, converts a 404 to 410 or returns a launch pass.

```bash
npm run verify:legacy-redirects -- pending <production-origin>
npm run verify:legacy-redirects -- report --csv
npm run verify:legacy-redirects -- check <production-origin> <canonical-origin>
```

The 37 exact remaining paths below are the next decision packet, not approved
omissions. `/en/` needs the correctly configured compatible English-home artifact;
a protected newer Preview returns 200 but canonicalizes to its Preview setting,
so it cannot establish the Production canonical target. English category/service
counterparts need real publication or an explicit verified ancestry fallback.
The remaining Finnish service and grouping-page identities are public source
content, not justified system removals. Their scope/nearest-category choice must
be settled without calling an unrelated service equivalent or silently dropping
them. The blank CSV keeps owner decision/target/evidence columns available.

| Exact pending source | Current disposition |
| --- | --- |
| `/en/` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/en/blog` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/en/photography` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/en/photography/business` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/en/photography/event` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/en/photography/funeral` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/en/photography/graduation` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/en/photography/kid-family` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/en/photography/real-estate` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/en/photos` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/en/photos/misc` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/en/wedding-portfolio` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/en/wedding/ceremony` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/en/wedding/ceremony-portraits` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/en/wedding/from-morning` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/en/wedding/half-day` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/en/wedding/whole-day` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/fi/haakuvaus/aamusta-iltaan` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/fi/haakuvaus/vihkiseremonia` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/fi/valokuvat` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/fi/valokuvat/sekalaiset` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/fi/valokuvaus/asuntokuvaus` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/fi/valokuvaus/hautajaiskuvaus` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/fi/valokuvaus/juhlakuvaus` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/fi/valokuvaus/perhe-ja-lapsikuvaus` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/fi/valokuvaus/valmistujaiskuvaus` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/fi/valokuvaus/yrityskuvaus` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/haakuvaus/aamusta-iltaan` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/haakuvaus/vihkiseremonia` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/valokuvat` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/valokuvat/sekalaiset` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/valokuvaus/asuntokuvaus` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/valokuvaus/hautajaiskuvaus` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/valokuvaus/juhlakuvaus` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/valokuvaus/perhe-ja-lapsikuvaus` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/valokuvaus/valmistujaiskuvaus` | Pending; no deletion, unrelated replacement or launch omission inferred. |
| `/valokuvaus/yrityskuvaus` | Pending; no deletion, unrelated replacement or launch omission inferred. |

## Validation and limits

Focused pure/data/configuration tests pass. Full browser-free tests, lint,
production build and applicable journey checks accompany the PR. Original failed
build/test output and corrected runs remain in private evidence. This continuation
changes no CMS, asset, credential, provider setting, DNS record or serving alias.
Final deployed source verification and all remaining decisions are still required;
AB#19 is not closed by these eleven rows or by a successful partial probe.
