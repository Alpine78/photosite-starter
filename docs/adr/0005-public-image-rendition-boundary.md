# ADR-0005: Public image rendition boundary

**Status:** Accepted
**Date:** 2026-08-04
**Deciders:** Project owner (Ilkka Rytkönen)
**Work item:** AB#108

## Context

The current public media type carries an unqualified `src` string beside image
dimensions. That is sufficient for six local mock images, but it does not say whether
the source is safe for public delivery, whether its dimensions describe the bytes at
that URL, how a changed image invalidates caches, or which rendered sizes a grid,
content block, or lightbox may request.

Those omissions become security and performance boundaries when the CMS lands. A CMS
asset reference may identify an original, a public derivative, or later private or sales
media. Passing that reference through as a URL would let provider details and possibly a
master location cross into browser data. Passing only one largest image to every surface
would waste bandwidth, while provider-specific rendition arrays would couple the public
contract and components to one CMS.

Two accepted decisions constrain this record:

- [ADR-0002](0002-media-identity-and-placement-boundary.md) separates stable project
  media identity from provider identity, archive location, and placement identity. It
  requires a property-by-property public projection and leaves rendition shape to
  AB#108.
- [ADR-0004](0004-reference-production-host-and-ownership-boundary.md) selects Vercel
  Pro as the reference host and its `next/image` integration for public web renditions.
  Camera originals and private media do not enter that optimizer.

AB#67 will carry the resulting public image data in gallery result pages. AB#82 will
later map Sanity documents onto the same project-owned contract. This decision must
therefore work for the current mocks without exposing either local-file assumptions or
Sanity types to components.

The governing constraints are:

- the full frame and native aspect ratio are always preserved;
- a transform never enlarges the source derivative;
- browser-facing sources are public web derivatives, never archive masters or private
  or sales-delivery assets;
- responsive surfaces declare layout-accurate source-size hints, and the optimizer's
  global candidate list remains an explicit project boundary; and
- a source replacement is visible to long-lived caches without treating a query token
  as access control.

## Decision

**Represent every public image with one validated, project-owned rendition descriptor,
and let the Next.js default image loader derive responsive presentation renditions from
an explicitly bounded global candidate list.**

### 1. Public image contract

The public `ImageMedia` variant owns a stable `mediaId` and a `rendition` object with
exactly these delivery fields:

| Field | Meaning |
| --- | --- |
| `rendition.src` | Root-relative or HTTPS URL of a separately exported public web derivative |
| `rendition.version` | Opaque byte version that also occurs in `src`; never an access token |
| `rendition.width` | Actual intrinsic pixel width of the bytes at `rendition.src` |
| `rendition.height` | Actual intrinsic pixel height of the bytes at `rendition.src` |

The rendition dimensions are not the camera original's dimensions and are not inferred
from layout. Both values are positive integers no greater than 8192. This bounds the
public optimizer input while retaining the derivative's true aspect ratio and allowing
Next.js and the browser to reserve the correct space.

A project-owned projection constructs the public value property by property. Its trusted
input must classify the source as a `public-web-derivative` and resolve effective
`publiclyRenderable` to true. Current local paths must use the content-versioned
`/gallery/name.<12-hex-version>.<web-format>` form with no query; an absolute HTTPS source
must contain its validated version in the request path or query. A protocol-relative URL,
relative filesystem path, HTTP URL, credential-bearing URL, fragment, mismatched version,
non-integer dimension, or dimension outside the accepted range is invalid.

The projection never spreads a provider or server record. Provider asset references,
provider document fields, master or original URLs, `archiveLocator`, private-media
locations, and sales or fulfilment locations are absent from the public type and browser
payload. Reprocessing may change `rendition` without changing `mediaId`. URL syntax alone
cannot prove what remote bytes contain: the server-only ingest/provider adapter owns the
trusted source classification, and the projection fails closed when it is not public.

The validated rendition fields carry nominal TypeScript provenance after projection.
This prevents ordinary structural construction or replacement with raw strings and
numbers from satisfying `ImageMedia` without passing the validator. It is a compile-time
guardrail, not proof of remote byte classification: an explicit cast can bypass it, and
validated fields from separate descriptors must not be recombined. The trusted
server-only adapter still owns the semantic classification above.

### 2. Public source and cache lifecycle

Every `rendition.src` identifies bytes that are already approved for anonymous public
web delivery. The source is a separate exported derivative; it is not a master made
nominally private by a transformation query.

Source URLs are immutable by contract: when the bytes change, both `version` and `src`
change. The current mock derivatives use content-hashed path filenames and receive a
one-year immutable source-cache policy only when the filename contains the required
12-character lowercase hexadecimal version and an allowed web-image extension. A future
CMS or CDN adapter must provide the same byte-versioned property, whether its version is
expressed by a content-addressed path or another immutable public identifier.

Width, quality, and format parameters generated for public optimization may appear in a
rendition request. They select a presentation transform; they are never authorization,
do not conceal the source, and do not make an original safe to publish.

Moving media from public to private requires a new or revoked public source URL and the
provider's source-cache purge plus the applicable Vercel image-cache purge. Removing the
source from content alone is insufficient. Bytes that were previously delivered
publicly may remain in visitor, intermediary, or provider caches and cannot be made
secret retroactively.

### 3. Responsive presentation profiles

Components use exported, project-owned image context profiles rather than inventing
`sizes` values locally. A current profile describes the responsive CSS slot and its
terminal CSS width for grid cards and content media. A full-viewport hero uses the
shared, layout-accurate `100vw` hint; unlike those bounded slots, its CSS width is
viewport-driven. These declarations let a responsive browser choose a candidate for the
rendered slot instead of assuming every image occupies the full viewport.

`sizes` is a browser selection hint, not a per-component optimizer allow-list. With a
`sizes` prop, Next.js emits width-descriptor candidates from the configured global
`imageSizes` and `deviceSizes` lists. The current lists are explicit and end at 2048
pixels, allowing a 2000-pixel public derivative to retain its source resolution. A
browser requests one candidate according to the CSS slot, viewport, and device pixel
ratio; it does not download every listed candidate. Different requested widths remain
distinct optimizer cache keys even when no-enlargement processing returns the same
source-sized bytes. AB#82 must revisit the global list with real CMS derivative policy,
and measured transformation cost can justify a dedicated loader or rendition set later.

The default Next.js loader and a narrow `localPatterns` allow-list serve current local
sources. Although the domain projection can validate a versioned HTTPS descriptor, the
current application cannot render one: a future HTTPS provider receives its own narrow
`remotePatterns` entry in the same change as its server-only adapter. That entry must
constrain protocol, host, pathname and, when feasible, the exact query shape; the public
media contract does not change.

Every presentation declaration preserves the native aspect ratio and full frame.
Components use real rendition dimensions with automatic height; they do not use crop
transforms, `object-cover`, or a fixed-aspect fill cell. The selected Next.js optimizer
uses a no-enlargement resize for width-only transforms, so a candidate request wider than
`rendition.width` still produces no upscaled output bytes. A replacement loader must
preserve that output guarantee explicitly.

The future lightbox helper calculates a `sizes` hint whose proposed terminal CSS slot is
the smaller of 3840 pixels and the public source width. No current lightbox consumes or
enforces that calculation. AB#15 must apply the matching CSS constraint, decide whether
to widen the current 2048-pixel global candidate list or use another delivery strategy,
and browser-verify full-frame rendering and candidate selection.

### 4. Failure behavior

An invalid or non-public descriptor fails at the projection boundary. The adapter or mock
loader returns no partially trusted `ImageMedia`, never substitutes a provider original
or master, and never silently removes an item from a counted or paginated result.

If optimization fails but the validated public derivative is still readable, the
selected Next.js pipeline may return that unchanged public derivative. If the source
itself cannot be served, the image keeps its reserved dimensions and its authored
alternative text remains the browser fallback. The application never retries with an
archive, private, sales, or unbounded provider source. Decorative images retain their
deliberately empty alternative text.

### 5. Future Sanity adapter

AB#82 implements the Sanity mapping in a module guarded by `import "server-only"`. The
adapter reads provider asset data, selects a separately exported public web derivative,
and constructs the same validated public contract through an explicit allow-list. It
must not expose or spread Sanity `_id`, `_type`, `_ref`, asset objects, original URLs, or
other provider-owned fields.

The adapter must compute effective public renderability, classify only a separately
exported web asset as a `public-web-derivative`, and verify its actual dimensions and
byte-versioned source. It rejects invalid or non-public descriptors with the same failure
behavior as the mocks and has a serialization test proving that server-only fields cannot
cross the boundary. The CMS may change how a source is resolved; it does not change
component props or the rendition contract.

## Options Considered

### Option A: Keep a raw `src` string and component-local `sizes`

| Dimension | Assessment |
| --- | --- |
| Complexity | Low initially |
| Provider independence | Superficial; the string carries no enforceable boundary |
| Privacy | Low; a public derivative and a master are indistinguishable |
| Performance | Inconsistent; each component can over-request independently |

**Pros:** no new type or projection; current mocks continue unchanged.

**Cons:** cannot validate public-source eligibility, actual source dimensions,
versioning, or server-only exclusions; repeated literal `sizes` values drift from the
layout; failure can fall through to unsafe provider data.

### Option B: Expose a provider-generated rendition array or `srcset`

| Dimension | Assessment |
| --- | --- |
| Complexity | Medium |
| Provider independence | Low; URL and transform semantics become public API |
| Privacy | Medium; safe only if every provider rendition is classified correctly |
| Performance | High when tuned, but duplicates the selected Next.js image pipeline |

**Pros:** the provider can precompute exact widths and the browser can receive them
directly.

**Cons:** components and tests inherit provider URL behavior; moving providers changes
the public contract; rendition policy is duplicated between the CMS/CDN and Next.js;
provider references are easier to leak through broad object mapping.

### Option C (chosen): Validated public source plus project-owned context profiles

| Dimension | Assessment |
| --- | --- |
| Complexity | Medium |
| Provider independence | High; adapters resolve into one small project type |
| Privacy | High; only an allow-listed public derivative crosses the boundary |
| Performance | High; responsive selection uses an explicit global candidate budget and the selected host's optimizer |

**Pros:** one contract serves mocks and future CMS data; server-only fields are excluded
at runtime rather than by TypeScript annotation alone; layouts own reviewed CSS slot
hints; source versioning makes long-lived caching predictable.

**Cons:** source exports and URL immutability require operational discipline; the global
candidate list cannot hard-cap each heterogeneous source independently; the reference
path depends on the Next.js optimizer selected in ADR-0004; provider and Vercel purge
procedures must both be maintained.

## Trade-off Analysis

**One public source rather than a public rendition set.** This keeps provider transform
syntax outside the domain model and uses the image pipeline already selected by
ADR-0004. The cost is an optimization hop and host-metered transformations. If that cost
becomes material, the adapter can later resolve the same descriptor to another public
image service without changing component data.

**Strict validation rather than best-effort rendering.** Rejecting malformed content can
make a publishing error visible sooner and may prevent a page from rendering. Allowing a
master fallback would be less visible but would violate the privacy boundary. A bounded
failure is the chosen trade-off in this proposal, and provider-side validation should
catch it before publication.

**Immutable URLs rather than in-place replacement.** Byte-versioned paths permit long
source cache lifetimes and deterministic optimizer keys. They also leave old public
objects to be retired deliberately and cannot revoke copies already delivered. The
proposal trades that lifecycle cost for avoiding stale bytes under an unchanged URL.

**An 8192-pixel source ceiling and an explicit presentation candidate list rather than
unrestricted dimensions.** The source limit prevents an archive-scale file from entering
the web path accidentally. The current optimizer list ends at the project's 2048-pixel
presentation ceiling and can change with an approved delivery context. Larger masters
remain in the photographer's archive or later protected delivery system.

## Consequences

**Easier**

- Mocks, gallery results, content blocks, and the future Sanity adapter share one public
  image vocabulary.
- True derivative dimensions reserve layout space, while branded validated fields make
  accidental structural bypasses visible to TypeScript.
- Context profiles can be reviewed against CSS layout once instead of auditing scattered
  `sizes` literals; the global optimizer width list is separately reviewable.
- Cache invalidation follows changed source identity instead of guessing whether bytes
  behind one URL changed.
- Serialization tests can prove that master, archive, provider, private, and sales data
  are absent.

**Harder**

- Every public source export must be bounded, dimensionally correct, and byte-versioned.
- A public-to-private transition needs source revocation and two cache-purge procedures,
  with no promise of retroactive secrecy.
- New image contexts must define a reviewed `sizes` profile and confirm whether the
  global optimizer widths remain suitable before rendering media.
- A future provider needs both a server-only adapter and a narrowly configured Next.js
  source allow-list.

**To revisit — migration triggers**

- Measured Vercel image-transformation cost or latency justifies a dedicated public image
  CDN or custom loader.
- A provider cannot offer immutable public derivative URLs without exposing protected
  source material.
- Public presentation genuinely requires a derivative wider or taller than 8192 pixels.
- A new visual context cannot be represented by the existing slot-bound profile model.
- Video delivery is prioritized and needs its own source and rendition semantics; it does
  not inherit image transforms automatically.

## Evidence

Verified on 2026-08-04 against the installed Next.js 16.2.11 implementation and current
official documentation:

- Next.js documents intrinsic `width`/`height`, responsive `sizes`, generated `srcset`,
  source allow-lists, and optimized-image cache behavior in the
  [Image component reference](https://nextjs.org/docs/app/api-reference/components/image).
- Next.js documents that mutable `public/` assets otherwise receive `max-age=0` in the
  [`public` folder reference](https://nextjs.org/docs/app/api-reference/file-conventions/public-folder).
- Vercel documents source/cache keys, transform parameters, purge behavior, and remote
  source TTLs in [Image Optimization](https://vercel.com/docs/image-optimization), with
  the current 8192-pixel source bound in
  [Limits and Pricing](https://vercel.com/docs/image-optimization/limits-and-pricing).
- The installed default optimizer performs width-only resizing with Sharp's
  `withoutEnlargement: true` and falls back only to the already validated upstream public
  bytes when transformation fails.

## Action Items

1. [x] Replace the raw public image `src`, width, and height with stable `mediaId` plus
       the validated, nominally typed `rendition` descriptor and explicit public
       projection.
2. [x] Export content-hashed mock derivatives, configure their immutable one-year source
       headers, narrow `localPatterns`, and explicit optimizer candidate widths, and
       update mock data to the shared contract.
3. [x] Centralize responsive `sizes` profiles and migrate current image surfaces; reserve
       the proposed 3840-pixel lightbox calculation without claiming runtime enforcement.
4. [x] Unit-test source and dimension validation, compile-time field provenance, property
       allow-listing, byte-versioned mock paths, profile constants, candidate-width
       configuration, strict immutable-header matching, and the future lightbox helper.
5. [ ] The AB#67 public gallery result now carries this contract with a serialization
       allow-list test. AB#82 still needs to carry it into the server-only Sanity adapter,
       add a narrow `remotePatterns` entry, and add integration/build coverage in the
       same change as the first remote source.
6. [x] In AB#15, consume the lightbox helper, apply the matching CSS cap, revisit the
       global optimizer widths, and browser-verify full-frame rendering and candidate
       selection. Outcome, in the same order:
       - The helper feeds `getImageProps`, so the lightbox delivers width-descriptor
         candidates derived from the item's own approved rendition and never a
         hand-built optimizer URL. Section 3's claim that no lightbox consumes the
         calculation no longer holds.
       - The cap is enforced as a zoom bound, not only as a declaration: every zoom
         level the lightbox exposes — the one it opens at, the one a click zooms to,
         and the ceiling a pinch reaches — is limited to the 3840-pixel terminal slot.
         All three levels are needed: the library derives its effective maximum from
         the largest of them, so capping only some leaves the declaration untrue for a
         source wider than the slot. A browser-free calculation test covers that case,
         which no current mock derivative is wide enough to reach.
       - The proposed 32-pixel viewport gutter was dropped. The lightbox presents each
         frame edge to edge, filling the viewport in whichever dimension binds first,
         so the fluid slot is `100vw` and the terminal breakpoint is the capped width
         itself. A hint that subtracted a gutter the presentation does not take would
         understate the slot by exactly the amount this action item exists to make
         agree.
       - The global candidate list stays at 2048. The optimizer does not enlarge, so
         wider candidates against derivatives that top out below the ceiling would
         return identical pixels under new cache keys. AB#82 owns the next review, with
         real derivative policy rather than a guess ahead of it.
       - Browser-verified on Chromium and WebKit, desktop and mobile, against a
         production build: every frame renders whole and at its own ratio, and each
         delivered source is a versioned public gallery derivative.

       One behaviour this record did not anticipate: the lightbox library replaces the
       `sizes` attribute at runtime with the slide's rendered CSS width. The
       project-owned hint therefore governs which candidates exist, and the library
       governs which one is chosen — a narrower and more accurate selection than the
       static hint would make. Section 3's description of `sizes` as a browser selection
       hint still holds; what changes is who writes the final attribute in this one
       context.
7. [ ] Document and verify provider-source revocation and Vercel image-cache purge with
       AB#83; keep private delivery under AB#122.
