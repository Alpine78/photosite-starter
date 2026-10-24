# Architecture decision records

Significant technical decisions are recorded here, one file per decision, so the
reasoning survives the decision. A decision belongs in an ADR when reversing it later
would be expensive — a dependency the UI is built around, a data model boundary, a
hosting or CMS commitment, a product boundary.

Routine choices do not need an ADR. Prefer no record over a record nobody trusts.

For the boundaries these decisions produced, drawn rather than described, see
[`docs/architecture/`](../architecture/README.md). Those diagrams show *what* the
boundaries are; these records are *why*, what else was considered, and what it cost.

## Naming

```
docs/adr/NNNN-short-kebab-title.md
```

`NNNN` is a zero-padded sequence number in decision order (`0001`, `0002`, …). Numbers
are never reused, and a file is never deleted. A record that no longer holds as a whole
gets its status changed to `Superseded` with a link to the ADR that replaced it. When one
scoped clause of a broader, still-accepted record changes, it may instead receive a dated
partial amendment that preserves the old rule, states the evidence and replacement, and
names every affected section. Never silently rewrite accepted history: the history is the
point.

## Format

Use the `/architecture` skill (`.claude/skills/architecture/`, mirrored in
`.agents/skills/`), which defines the full template: Status, Date, Deciders, Context,
Decision, Options Considered, Trade-off Analysis, Consequences, Action Items.

Two conventions on top of the template:

- **Status** is one of `Proposed`, `Accepted`, `Deprecated`, `Superseded`.
- Reference the Azure Boards work item as `AB#<id>` so the decision links back to the
  story that prompted it.

## Index

| ADR | Work item | Decision | Status |
| --- | --- | --- | --- |
| [0001](0001-lightbox-library.md) | AB#13 | Lightbox library: PhotoSwipe over react-photo-view | Accepted |
| [0002](0002-media-identity-and-placement-boundary.md) | AB#64 | Shared media identity and placement metadata boundary; 2026-10-14 gallery enquiry permission amendment (AB#289) | Accepted |
| [0003](0003-public-content-tree-and-url-structure.md) | AB#102 | Public content tree, category taxonomy, and localized URL structure; AB#323 isolates each loose article photograph; AB#330 follows existing H2–H4 fragments during deliberate reading without storage; AB#290 adds identity-based category navigation shortcuts; AB#24 adds bounded inline mini-gallery blocks; AB#334 adds scoped justified inline inheritance; AB#161 adds a separately paginated article end gallery; [AB#137 proposes bounded paragraph/list links](0003-public-content-tree-and-url-structure.md#proposed-amendment-2026-10-04--preserve-paragraph-and-list-links-ab137) | Accepted; link amendment Proposed |
| [0004](0004-reference-production-host-and-ownership-boundary.md) | AB#109 | Reference production host and ownership boundary; [2026-10-07 Hobby preference](0004-reference-production-host-and-ownership-boundary.md#amendment-2026-10-07-ab18-ab117--current-hobby-preference), superseded by the [2026-10-09 owner-selected active Pro plan](0004-reference-production-host-and-ownership-boundary.md#amendment-2026-10-09--owner-selected-active-pro-for-the-commercial-launch) | Accepted |
| [0005](0005-public-image-rendition-boundary.md) | AB#108 | Public image rendition boundary | Accepted |
| [0006](0006-sanity-data-access-boundary.md) | AB#39 | Sanity data-access boundary and client transport | Proposed |
| [0007](0007-proxy-request-path-boundary.md) | AB#72, AB#132, AB#341 | A Proxy request boundary carrying the requested path; [maintenance matcher amendment](0007-proxy-request-path-boundary.md#2026-10-18-maintenance-matcher-amendment-ab341); [scriptless 404 temporary-risk acceptance](0007-proxy-request-path-boundary.md#2026-10-07-owner-accepted-temporary-residual-risk-ab132) | Proposed; temporary residual Accepted |
| [0008](0008-localized-authored-text.md) | AB#82 | Localized authored text in content schemas | Accepted |
| [0009](0009-seeded-random-gallery-ordering.md) | AB#66 (ordering clauses only) | Seeded random gallery ordering contract | Accepted |
| [0010](0010-lightbox-preload-window.md) | AB#79 | Bounded adjacent-image lightbox preload window | Accepted |
| [0011](0011-security-response-headers.md) | AB#117 / AB#250 / AB#390 | Security response headers and the CSP inline-content trade-off; 2026-10-14 scoped original legacy JPEG file path; 2026-10-22 accepted per-request script nonce, implementation AB#390 | Accepted |
| [0012](0012-dynamic-keyword-gallery-query-contract.md) | AB#66 (remainder, after ADR-0009 split off ordering) | Dynamic keyword-gallery query contract (amendment proposed 2026-10-22, AB#55) | Accepted |
| [0013](0013-category-listing-continuation-cursor.md) | AB#140 | Category-listing continuation cursor contract (keyset over `(publishedAt, contentId)`, shared signing secret, self-canonical indexable pages) | Accepted |
| [0014](0014-private-gallery-security-delivery-retention-boundary.md) | AB#122 | Private client gallery security, delivery, proof selection, and retention boundary (fragment-capability access + server session, structural public/private isolation, S3-compatible object store + PostgreSQL-family private store, worker-authoritative six-month retention) | Accepted; reference-deployment target superseded by ADR-0034 |
| [0015](0015-administrator-authentication-boundary.md) | AB#29 / AB#145 | Administrator authentication boundary for private client galleries (own reserved namespace, `__Host-` session sharing nothing with the customer path, persisted login rate limit, generated single-operator secret verified with scrypt; ADR-0014 §4's open mechanism) | Accepted; reference-deployment target superseded by ADR-0034 |
| [0016](0016-hero-fold-safe-overlay.md) | AB#148 / AB#155 / AB#171 | Fold-safe hero overlay: full-bleed native image, viewport-clamped band anchored to the top of the hero rather than the image's bottom edge (`min(image height, 100dvh - HERO_CHROME_RESERVE_PX)`); shared by home and content heroes; AB#155 allows downward growth with a contrast surface for the full text stack; AB#171 makes that surface a feathered 60% veil | Accepted |
| [0017](0017-authored-event-date-ordering-key.md) | AB#150 | Authored `eventDate` replaces `publishedAt` as the public ordering key (category listings, story-root overview, sibling nav, sitemap, ADR-0013's cursor); optional `endDate` auto-hides a page via a read-time gate folded into effective `published`, with a cache-TTL-bounded staleness window | Accepted |
| [0018](0018-article-poll-voting-storage-and-dedup.md) | AB#162 | Article polls: ninth shared body block, authored close date, separate operational tally/receipt, plain receipt create and atomic increment in one transaction, independent per-poll cookies, plan-dependent runtime credential scope, and closed historical-results import | Accepted |
| [0019](0019-before-after-image-comparison.md) | AB#23, AB#291 | Before/after comparison block shared by article/gallery bodies, native range reveal, full-image fallback, and approval-bound Joomla conversion; October 14 amendment places the native drag handle on the image | Proposed |
| [0020](0020-tab-group-body-block.md) | AB#163 | Tab-group block: bounded named tabs each holding one table, WAI-ARIA Tabs pattern with no-JavaScript stacked fallback, and a strict sibling-paired Joomla `nav-tabs`/`tab-content` recognizer | Proposed |
| [0021](0021-localized-static-service-routes.md) | AB#164 | Localized static service routes and service hierarchy | Accepted |
| [0022](0022-capture-sequence-rally-galleries.md) | AB#165 | Capture-sequence rally galleries: media-owned membership, filename-sequence order and section, no placement documents, `itemId = mediaId`; file naming/import contract and per-gallery conversion preconditions (amends ADR-0002 in scope) | Accepted |
| [0023](0023-customer-customization-and-upstream-updates.md) | AB#41 | Customer customization and upstream update boundary | Proposed |
| [0024](0024-free-core-and-premium-boundary.md) | AB#42 | Free Core and Premium product boundary | Accepted |
| [0025](0025-premium-source-distribution.md) | AB#44 | Separate Premium source archives and later private release delivery; no runtime entitlement check | Accepted |
| [0026](0026-editorial-assistant-provider-boundary.md) | AB#126 | Provider-neutral editorial suggestions, independent text acceptance, server authorization and two-tier evaluation | Accepted |
| [0027](0027-public-chat-and-knowledge-boundary.md) | AB#127 | Optional grounded public chat, authoritative eligibility, synchronization, privacy and budget boundaries | Proposed |
| [0028](0028-legacy-unlisted-gallery-continuity.md) | AB#18 / AB#117 | Owner-accepted public Sanity delivery for 21 unlisted legacy galleries; 2026-10-14 scoped whole-ZIP support exception, protected workflow remains separate | Accepted; unlisted workflow direction extended by ADR-0034 |
| [0029](0029-localized-home-and-contact-pages.md) | AB#255 (first slice) | Locale-owned home/contact routes, authored-copy availability and exact static language switching | Accepted |
| [0030](0030-legacy-identity-retirement.md) | AB#257 | Accepted full domain identity mapping, retained Sanity identities and future owner-gated cutover/recovery | Accepted |
| [0031](0031-identity-migration-operational-plan.md) | AB#260 | Accepted identity-alias, legacy-writer retirement and maintenance implementation policy; isolated rehearsal and Production operations remain gated | Accepted |
| [0032](0032-restricted-page-ui-locales.md) | AB#255 | Accepted bounded GET UI locale selection inside existing protected client, administrator and retained legacy namespaces; authored-text acceptance remains separate | Accepted |
| [0033](0033-unified-site-search.md) | AB#299 | Unified site search: one reserved route with a fixed free-text/keyword mode rule, server-side matching over a cached per-language index of stories and services, POST dialog transport, `noindex` results; amends ADR-0003 decision 6 and ADR-0012 §8 | Proposed |
| [0034](0034-ongoing-unlisted-client-delivery.md) | AB#29 / AB#145 / AB#130 | Final reference-deployment choice: ongoing unlisted client delivery in existing Sanity; protected S3/Postgres development deferred; 2026-10-24 amendment requires expiry-triggered image/ZIP cleanup (AB#392), not yet implemented | Accepted |
| [0035](0035-unlisted-delivery-zip-proposal.md) | AB#309 / AB#29 | Proposed whole processed-JPEG ZIP in existing Sanity; new-file exception, account capacity and upload verification remain pending | Proposed |
| [0036](0036-article-end-section-filtering-proposal.md) | AB#360 / AB#27 / AB#321 | Owner-accepted optional article-end sections with bounded authenticated filtering; 41-item identity/text preflight complete, implementation/content acceptance pending | Accepted |
| [0037](0037-cookieless-site-analytics.md) | AB#371 | Cookieless site analytics as an off-by-default adapter with Vercel Web Analytics as the reference provider; route exclusion and URL reduction; Speed Insights not adopted | Accepted |
| [0038](0038-proof-selection-in-existing-sanity.md) | AB#130 | Proof selection in the existing Sanity project: public watermarked proofs with permanent references, private ID-path terms/selections/versions, a separate selection key, one narrow write path with transactional confirmation, notification separate from the record; 2026-10-22 owner answers (indefinite default, no resend path at first activation, replaced by a linked delivery gallery; automatic reminder with selection link, then monthly) ; 2026-10-22 publication path: Studio action → server route with the editor's own token; 2026-10-24 amendment requires proof deletion on replacement delivery publication (AB#396), not yet implemented | Accepted |
| [0039](0039-keyword-taxonomy-and-ingest-boundary.md) | AB#55 | Image keyword taxonomy and ingest boundary: governed keyword documents, Lightroom as audit input with re-import overrides, ancestor closure on the medium, separate article tags, public/internal privacy boundary | Proposed |

Expected further entries:

| Work item | Decision |
| --- | --- |
| AB#95 | Image sales, checkout, and fulfilment boundary |

Add a row here when an ADR lands.
