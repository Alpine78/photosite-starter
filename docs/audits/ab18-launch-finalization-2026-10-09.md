# AB#18 — protected release candidate and customer-gallery inventory

## Release preparation

Main CI #756 passed for `f7de04f3cf95f309bcb1f0ec0b8bb39cb456ae62`,
including the merged PR #318/#319 redirects and PR #320 checkpoint. A manual
Production prebuilt candidate from that unchanged revision is READY:
`dpl_6CCZM7oXShf71d7mHS7VEd6RZZ65`
(`photosite-starter-k13lm7rut-ilkka-rytkonens-projects.vercel.app`). This is a
protected candidate, not a promotion or an Azure Production build.

Only 15 named public settings entered the build. Contact addresses and the
Resend, webhook and cursor credentials remained provider-side. The clean new
worktree contained no local credential files. The build used isolated npm
configuration/cache, pinned Node 24.20.0, Next 16.3.8 and Vercel CLI 61.0.0.
Source manifests were unchanged before/after the build and upload. The complete
provider archive matched all **641 members**: 251 physical output/alias entries
and 390 mapped runtime inputs. Function environments were empty; the only
environment file uploaded was the committed public `.env.example`. The original
project link was restored and temporary public build settings removed.

The project and both serving aliases remained on
`dpl_44SDGwpPtrcZDTFDAHLTBLvHBneU`, source
`8e3efe625d03726ff5db04e57da3b8a6b9e83bc7`. The candidate challenged anonymous
access with Vercel authentication. Authorized probes used an existing automation
bypass in a memory-only header restricted to the exact candidate origin; no
redirect was followed and the bypass inventory was unchanged.

## Deployed checks

Every one of the **415** legacy inventory paths was requested. The 189 decided
redirects and their **131 distinct declared targets** passed the repository's
source/target assertions, including single-hop location, HTTP 200 target,
canonical URL, locale and any declared fallback notice/indexing rules. The 174
decided Gone paths and three excluded paths passed their expected handling; the
homepage remained live.

The **48 pending paths remain open decisions**, not accepted omissions: 47
returned 404 and one returned 308. The latter is the English locale-root spelling;
the separately saved `/en` follow-up check returned 404. No missing English homepage or
same-language replacement was invented. These observations do not complete
AB#19. Additional query, spelling and real-browser cases retain their existing
CI coverage; they were not all replayed against this live candidate.

Nine additional GETs passed for the homepage, contact page, service listing,
both newly priced wedding packages, portfolio, English story listing, sitemap
and robots. A synthetic unknown path returned 404. A contact POST containing
the empty JSON object `{}` was rejected with 403; an unsigned revalidation POST
containing `{}` was rejected with 400.
No real email, signed webhook/cache mutation or CMS write was performed. These
refusal checks do not establish genuine post-cutover contact or webhook delivery.

An initial operator smoke run incorrectly expected `/en` to exist and stopped
after the inventory requests. Its failed log is retained. The corrected run
uses verified routes, keeps the English root open, and saves inventory evidence
before the subsequent smoke checks. No application fix or new publication is
claimed from that operator correction.

## Private customer-gallery continuity

The owner confirmed that K2 customer galleries normally remain available for
six months, with some exceptions having no end date. Existing customer access
must continue after the move. An offline inventory of the supplied October 9
Joomla backup identifies **115** items in the K2 customer-gallery category and
its descendants:

| State at the October 9 check | Items |
| --- | ---: |
| Explicit publication end already passed | 45 |
| Unpublished, trashed, or disabled by category | 42 |
| Published with a future explicit end | 6 |
| Published without an end date | 22 |

The last two groups, **28 items**, require continuity. A zero end date is kept
indefinite; six months is not inferred from creation dates. UTC comparison is
verified against the bundled K2 date queries and Joomla's GMT-default `toSql`.
These are backup publication states, not a test of authenticated customer access.

The embedded galleries are **Balbooa**, joined through their explicit K2
shortcodes and category/form identities. Whole-form shortcodes are included.
The 28 items reference **2,277 image rows**. Of those, **323 images** and **three
linked delivery ZIPs** were not found in either the archive or local gallery
files. Bounded unauthenticated recovery attempted these 326 missing paths on
the current Joomla origin, without following redirects. No bytes were recovered.
A separate read-only probe confirmed that all 326 redirect to the same-origin
Joomla `/404` page. A known-present image requested without authentication on
the same origin returned 200 and matched the owner's supplied local bytes.
The owner must identify intentional removals or another copy
of the required material; missing files are not silently recreated or discarded.
Resolve required-file disposition and customer access for all 28 items before
the confirmed **October 15, 2026** web-hotel retirement (AB#131). The HTTP probes
do not establish a complete inventory of files on the hosting account.

Names, aliases, private source paths and the per-gallery review list stay in the
ignored local evidence directory. No customer content was put into public
Sanity, a public derivative store, or the candidate artifact. Production private
gallery storage remains off; this inventory does not provision its durable
metadata/object stores or establish working customer links on the new site.

## Open launch gates

DigitalOcean credentials are still unavailable after checking the agreed file,
local environment-file key names and doctl configuration. Public DNS still
resolves the web host to `31.217.196.210` and mail MX to Infomaniak. No web, mail,
Resend verification, DNS or webhook-destination record was changed.

The [post-import checkpoint](ab137-production-launch-2026-10-09.md#remaining-launch-work)
continues to govern preserved-content approval, actual dataset region, older
Editor disposition, historical signing-key receivers, physical-device evidence
and exercised recovery. Fresh project/dataset metadata still omits region; a
CDN hostname or a general provider location is not substituted for that evidence.
The new candidate does not renew or close the AB#132 temporary-risk follow-up.

AB#18 remains **Active** (reconfirmed before this work). AB#19, AB#117, AB#131,
AB#137 and AB#141 remain Active. No final go/no-go, DNS cutover, complete launch
acceptance or post-launch AB#118 acceptance is claimed.

## Owner continuity decisions — October 10 follow-up

Historical provisioning basis: the later accepted unlisted-delivery decision
below replaces the UpCloud/PostgreSQL requirement for legacy continuity only.

The owner excludes seven K2 items from migration and supplies a date-only end
for one previously indefinite item. The October 9 inventory above remains the
source baseline; this decision overlay does not alter Joomla, the backup or
local customer files. The retained set is now **21 galleries**: **seven with
an end date and fourteen without one**, counting the owner's date override.
The override carries no time or timezone; a runtime expiry instant is not
invented. Customer names, K2 identifiers and the exact decision list stay in
the ignored private review artifacts.

The retained source set references **1,831 images**. The owner confirms that
two current local folders, containing **49 and 15 JPEGs**, replace their older
source lists. The **39 obsolete missing references** are therefore omitted
from the migration overlay; the effective set has **1,792 image references**,
all found locally or in the backup. Hash receipts bind both replacement folders
and their ZIPs; those ZIPs pass CRC and contain respectively 49 and 15 JPEGs.
These checks do not establish image dimensions, web-derivative suitability or
customer access. All **12 referenced delivery ZIPs** are locally available;
nine retained items have no ZIP reference, which does not prove that a delivery
package exists for them. No gallery has been imported or published by this
follow-up.

The owner confirms that no private-gallery storage service is provisioned and
asks for it to be established. Storage alone is insufficient:
`getPrivateGalleryStores` and `getPrivateGalleryAdminStores` in
`src/lib/private-gallery-access.ts` explicitly refuse the `enabled` mode until
the durable adapters are implemented. Development memory stores cannot serve
Production. The accepted ADR-0014 object-store and PostgreSQL boundaries remain
the preparation basis. The owner confirms that an UpCloud account must first
be created; account access and a concrete provider order are absent.

At that checkpoint the proposed protected continuity path would have needed
AB#29/145 durable adapters and schema migrations, verified upload/delivery,
a retention worker, recovery/access tests and a scoped indefinite-gallery policy.
ADR-0028 supersedes those protected-store and capability prerequisites for the
21 retained unlisted deliveries. They remain requirements of the separate
protected AB#29/145 workflow. The six-month access clock and object-age deletion
backstop cannot preserve indefinite data and must not govern the new exception.
Original deadlines still must not restart, and the unlisted implementation needs
its own explicit legacy link mapping and delivery checks. Processor/notice checks
remain AB#117 work; real customer content stays out of Preview.

**October 15 continuity is still unresolved.** If customer access is not ready
before retirement, an owner-decided alternative or an explicitly accepted
interruption is required. This follow-up does not extend hosting, accept an
outage, select an interim delivery service, or satisfy AB#18's launch criteria.
AB#18 and AB#29 remain **Active**; no state transition or closure is claimed.

## Accepted unlisted continuity direction — October 10

The owner rejected the separate paid UpCloud/PostgreSQL proposal and explicitly
accepted public direct file URLs with unlisted gallery pages and existing end
dates. [ADR-0028](../adr/0028-legacy-unlisted-gallery-continuity.md) records the
bounded exception for the same 21 retained galleries; it does not repeat the
content approval or change source files. Protected AB#29/145 remain separate.
Their durable-store prerequisites no longer block this limited continuity path.

Read-only current dataset checks found 5,145 asset documents totaling
2,432,677,495 bytes in Production and no assets in Preview; both datasets are
public. Adding available retained images and the 12 referenced ZIPs gives
12,101,836,331 bytes (about 12.10 GB) before new derivatives/repackaging, against
Growth's currently included 100 GB. This is an asset-document/source estimate,
not a billing ledger or guarantee of zero overage charges.

Package transport is unresolved: all 12 ZIPs exceed the documented 100 MB HTTP
body limit, the largest is 2,032,617,616 bytes, and the documented from-URL
upload path is limited to 50 MiB. No supported larger upload method was verified.
The owner answered the package question: one complete ZIP per gallery is
required, and several independently opened ZIPs are rejected. No package
splitting, recompression, omission or purchase has been performed or approved.
Supported whole-package upload is still unverified.

The unlisted schema, reader, page, legacy link mapping and importer are still
unbuilt. Source-byte preservation and true-dimension checks, exact expiry
semantics for the date-only override, package delivery, finite-date recheck, exclusions,
actual notice/processor evidence and recovery must pass before customer
publication. Public CMS enumeration and direct-file/cache persistence are
explicit consequences, not security findings claimed fixed. The acceptance
changes the direction; it does not satisfy AB#18/117 or accept an October 15
interruption. Both remain Active; no state transition was needed or item closed.
No CMS, production alias, web/mail DNS or customer source mutation occurred.

A read-only JPEG header scan of the effective 1,792 source references found
**72** above a 2,048-pixel longest edge, a largest source edge of **6,240 px**,
and EXIF segments in all **1,792**. This is header evidence only, not a complete
image-decode or GPS-field verification. The 2,048-pixel comparison was a
diagnostic against the earlier protected-preview policy, not a requirement to
resize these files. The owner explicitly rejected resizing and EXIF removal:
all supplied processed JPEGs must retain their exact bytes, existing resolution
and embedded metadata. No re-encoding, rotation or metadata stripping is planned.
The owner additionally confirms that the prepared browse JPEGs have the
intended size for 10 × 15 cm prints; the ZIP contains the separate full-size
processed JPEGs. This confirms the intended roles, not independently tested
print quality. Do not replace browse files with full-size ZIP members.
Verify source hashes and presentation dimensions before import. The
private scan/helper and per-file hashes stay outside the public commit and were
not reviewed line by line in this documentation slice. Source bytes were read,
not rewritten or uploaded.
