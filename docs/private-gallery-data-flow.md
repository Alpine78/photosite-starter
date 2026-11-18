# Client gallery data flow

What the unlisted client galleries hold, where it goes and what a page link does and does
not protect. Written for the site owner, a customer who asks and the AB#117 launch review.
Proof pages have their own record in [`proof-selection-data-flow.md`](proof-selection-data-flow.md).

**Protected gallery removed, 2026-11-15/16 (AB#313):** the S3/Postgres protected client
gallery that this file was first written for (ADR-0014, ADR-0015) no longer exists in the
code. No private object store, private database, capability link, access or administrator
cookie, notification outbox or retention worker is implemented or provisioned. Its two
URL prefixes (`/private` and `/admin` by default) and the literal `/private-gallery` and
`/private-gallery-admin` segments stay reserved and answer one empty 404 with `no-store`,
`noindex, nofollow` and `no-referrer`. The removed design's data-flow record is in the Git
history of this file before AB#313's slice D; the decision and removal evidence are
[ADR-0014](adr/0014-private-gallery-security-delivery-retention-boundary.md),
[ADR-0034](adr/0034-ongoing-unlisted-client-delivery.md) and the
[removal audit](audits/protected-gallery-removal-2026-10-17.md).

**Current scope, 2026-10-16:** [ADR-0034](adr/0034-ongoing-unlisted-client-delivery.md)
selects Sanity/unlisted client delivery for this owner's continuing work, not
just migration. The October 15 [availability readback](audits/ab250-release-verification-2026-10-12.md#production-readback--2026-10-15)
records the 21 live unlisted galleries. Public Sanity metadata/files can be discovered
without the page link, and page expiry does not revoke file access.

For new unlisted galleries, AB#302/303 use native Studio authentication and
public Sanity documents/assets, with no separate customer identity or access
session. The source reader is default-off. It reads published metadata and a
fresh availability record, then sends only localized display text, opaque
viewer identities, true dimensions and validated Sanity web-image URLs to the
browser. No customer/contact/job, archive or original-file fields are supported.
No positive/gallery-state cache or new tracking/IP store is introduced. A
bounded 10-second cache can remember only absent public handles. Provider query
URLs may contain handles; public dataset records remain enumerable. Asset URLs
survive page closure. Review filenames/embedded metadata before upload; the
[deployment contract](deployment.md#ongoing-unlisted-client-galleries-adr-0034)
records read limits, publication delay and remaining live verification.

AB#397–398 add explicit private operational enrollment and a default-off scheduled
cleanup worker for these new unlisted deliveries. It stores only the approved
policy/source identity and latest bounded attempt/result/receipt, without customer
text or an address. A complete dataset reference snapshot can transiently parse
private proof terms; only ID/revision/type/reference metadata is retained in
memory. The raw export is never persisted or logged. Full dataset READ and the
residual image-asset write grant need hosted verification. Shared images remain
online without a later sweep; provider history/backups, CDN and downloaded copies
remain outside ordinary deletion. See [cleanup data flow and activation
evidence](client-gallery-cleanup.md). No processing is activated by this source.

**Scoped legacy continuity decision, 2026-10-10:**

[ADR-0028](adr/0028-legacy-unlisted-gallery-continuity.md) defines a separate,
owner-accepted **unlisted public-delivery** path for 21 retained legacy galleries.
Its runtime is prepared but off; no customer content is imported or published. The protected
workflow, removed under AB#313, was a separate roadmap; its private-store requirements
never governed that bounded exception.

For the unlisted path, prepared browse JPEGs and intended download packages
use existing Sanity storage. The owner confirms the browse JPEGs are already
sized appropriately for 10 × 15 cm prints; the ZIP separately contains full-size
processed JPEGs. This is an owner statement, not an independently verified
print-quality specification. Keep those two image roles distinct. The current dataset is public: documents, references
and assets can be queried directly without a gallery link. Preserve the supplied
processed JPEGs byte for byte, at their existing resolution and with embedded
EXIF and other metadata intact, as the owner explicitly requires. These source
URLs expose the individual JPEGs and their metadata. Add no customer contact/job
records, legacy passwords or archive locators to CMS display fields. A link can
be forwarded, and direct image/package URLs work without authentication. Noindex,
sitemap/listing exclusion and no-referrer reduce routine discovery; they do not
make content confidential or control Sanity CDN indexing. Existing deadlines
and the owner's indefinite exceptions are preserved. Page expiry checks must
use fresh server reads and no-store; they do not revoke file URLs or downloaded
copies. Sanity documents indefinite CDN caching and says asset deletion does
not purge already cached bytes.

On a removal request, take down the page/references, identify any shared asset
before deleting it, and assess CDN/provider removal options and existing copies.
Do not promise immediate erasure or retroactive secrecy. Reconcile the applicable
notice and processor/region evidence under AB#117 before customer publication.
Keep real customer content out of Preview and CI artifacts. Public downloads
count toward bandwidth and can incur overages; check usage and billing alerts.
The importer, legacy-link map and deployed customer-delivery checks remain open;
no paid service or delivery-format change is authorized by this record.

**AB#250 runtime preparation:** `/client-gallery/<opaque-handle>` now has its
own document shell and a separate Sanity read facade. It defaults to
`LEGACY_GALLERY_ADAPTER=off`; no customer gallery is imported or activated by this
change. Sanity mode requires an explicitly deployed handle list and approved
batch digest. Those are publication/quota guards, not authentication.
The first fresh Doc API read checks publication and the exclusive UTC deadline;
the bounded image query must match an ordered manifest digest; a second fresh
Doc API read rechecks the revision and deadline. No cross-request gallery-data
cache is used. Missing, unavailable and malformed content fails closed; malformed
content has a constant operational classification. Provider transport errors
propagate as generic server failures, without an empty/mock gallery fallback.
All responses in the application-owned namespace carry `no-store`,
`noindex, nofollow` and `no-referrer`. Direct CDN image/ZIP URLs remain public
and page expiry does not revoke copied URLs, CDN caches or downloaded files.
Raw full-frame image sources bypass the public optimizer and retain supplied
bytes/metadata. The optional download is one whole ZIP, directly from the CDN.
Notice/processor/region, usage, import/recovery and old-link checks remain gates.
