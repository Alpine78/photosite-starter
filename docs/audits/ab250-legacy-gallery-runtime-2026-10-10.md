# AB#250 — default-off legacy gallery runtime

The authoritative AB#250 description, acceptance criteria, relations and
comments were read before editing, together with its AB#18/117 launch context.
AB#250 moved New → Active before implementation and remains Active. This is the
runtime preparation slice, not customer import or launch completion.

The separate ADR-0028 route reads only the approved deployed handles/batch.
Unknown handles perform no CMS IO. Fresh Doc reads validate publication and the
exclusive UTC deadline before and after the bounded image query. A SHA-256
manifest binds ordered placements, asset identities/sizes, exact intrinsic
JPEG dimensions/orientation, reviewed alt text and one optional whole ZIP.
The query cannot repair or silently omit malformed, stale or incomplete data.
The verified source set uses EXIF orientation 1; other values are refused.

The view contains only display title, projected image slides and one optional
CDN ZIP URL. No contact/job records, source filenames, archive locations,
passwords, CMS revision or import metadata enters the view. This is unlisted
public delivery: URLs and Content Lake assets are enumerable and shareable.
Page expiry/unpublication does not revoke downloaded/cached assets.

The native-ratio grid uses raw image URLs, without transforms or the public
optimizer. It reuses the existing lightbox for bounded preload, zoom,
keyboard/focus and touch viewing. The whole archive is a direct CDN link;
Vercel does not proxy it. Development fixtures contain only shipped generic
media and a 179-byte project-authored ZIP; fixtures are refused in Vercel
Preview/Production. The runtime remains off by default.

Every response in the application-owned namespace has no-store,
noindex/nofollow and no-referrer. Only default-locale literal routes are served;
malformed, deep, encoded/case aliases and configured locale variants are refused.
The known framework early separator-normalization redirect remains outside
Proxy, under the already documented ADR-0007 risk acceptance. No new CSP grant,
provider hook, public cache type or deployment credential is added.

## Validation and review

The one-time Claude plan review led to the manifest fence, deployed handle
guard, explicit platform fixture refusal and exact expiry tests. Its provider,
quota and CSP observations were checked against official documentation and
repository evidence. Codex self-review added the native-width no-upscale cap,
malformed-envelope classification, request-fact header cleanup and Sanity
Preview refusal. New tests use only generic project fixtures.

Validation on the final implementation scope: lint passes; 215 Vitest files and
5,089 tests pass; the production-built full Chromium/WebKit suite passes 770
cases with 38 intentional skips. Its 30 new legacy journeys cover direct full
frames, no upscale, keyboard/focus, touchscreen tap plus emulated pointer drag,
scriptless images and one complete synthetic ZIP, exclusions, 200/404/500 and
308 response hygiene. The separate default-off smoke returns 404 with the same
hygiene and no fixture content. All three generated architecture diagrams pass
the freshness check. No new real-device or live customer-delivery acceptance is
claimed. The final independent diff review is a bounded loop whose report and
scope fingerprints are retained in the owner-local handoff; it cannot imply
that the remaining full-story release gates are complete.

## Remaining launch gates

The importer and owner-local old-link map are later slices. Before customer
publication, recheck the approved source set and fresh baseline, supported
whole-ZIP transfer/attachment byte behavior, provider usage and recovery,
AB#117 notice/processor/region evidence, and filtered webhook exclusion of the
new document types. No source JPEG/ZIP was rewritten, no customer asset uploaded,
no adapter activated and no DNS or email setting changed by this branch.
