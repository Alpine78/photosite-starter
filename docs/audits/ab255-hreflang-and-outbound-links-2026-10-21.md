# Language alternates, canonicals and links on Production — 2026-10-21

Read-only evidence for AB#255 (language versions) and AB#137 (migrated content). Anonymous
GET requests to the public Production domain (`dpl_ARuiTPxfvhAsn7D4foP2ajzfchVE`), at most
one at a time with a short pause; server-rendered HTML only, no JavaScript.

## Canonical and hreflang (AB#255)

Every page listed in `/sitemap.xml` (166) was fetched and its `<head>` parsed.

| Check | Result |
| --- | --- |
| Exactly one `rel="canonical"`, pointing at the page itself | 166 / 166 |
| `rel="alternate"` with `hreflang` present | 166 / 166 |
| The page lists itself among its alternates | 166 / 166 |
| An `x-default` alternate is present | 166 / 166 |
| Every alternate is itself in the sitemap | yes |
| Alternates are reciprocal (A lists B ⇒ B lists A) | yes, no exception |
| `noindex` on a sitemap page | none |

The sitemap lists URLs without `xhtml:link` alternates; the language relationship is carried
by each page's `<head>`, which is a supported way to declare it. This evidences the published
pages only, not pages that have no second language yet.

## Outbound links in page content (AB#137)

Links to other hosts inside `<main>` on those 166 pages: 13 distinct URLs. Each was requested
with up to five redirects and a 20-second limit.

| Result | Links |
| --- | --- |
| 200 (directly or after redirect) | 11: seven Polar Flow training analyses, one Garmin Connect activity, and the Facebook, Instagram and X profiles on the contact pages |
| No connection (curl status `000`) | 2: `http://www.movescount.com/fi/moves/move136819144` and `…/move136957438`, both on the Finnish and English "Polar M600 and Suunto Spartan Ultra" quick-test article |

The two Movescount links need an owner decision (remove, replace with an archived copy, or
keep as historical text without a link); this record does not establish why the host does not
answer. A 200 from Polar Flow or Garmin Connect shows the address answers, not that the
activity is publicly visible without signing in.

## Internal links and image sources (AB#137)

Same 166 pages, same deployment, read later the same day.

| Check | Result |
| --- | --- |
| Distinct same-host link targets anywhere in the page (navigation, footer and content) | 451 |
| Targets answering `200` to a `HEAD` request without following redirects | 451 / 451; no redirect, error or missing target |
| `<img>` URLs (`src` and every `srcset` candidate) | all go through `/_next/image`, all with a `cdn.sanity.io` source; 1 809 distinct sources |
| Requested optimizer widths | 256 … 2048; none above 2048 |
| Random sample of 40 distinct sources from 25 random pages, requested directly from `cdn.sanity.io` | 40 / 40 `200 image/jpeg` |

The optimizer URLs themselves were not requested: each distinct width would start a new
transformation on the hosting provider, and the source check answers the question that
matters here (the referenced asset exists). The sample covers 40 of the 1 809 sources,
not all of them.

## Not covered

Pages outside the sitemap (query variants, search) and links inside images or embeds.
Outbound links in navigation or footer chrome other than the contact profiles above;
same-host links there are covered by the internal-link check.
