# ADR-0002: Shared media identity and placement metadata boundary

**Status:** Accepted
**Date:** 2026-07-29
**Deciders:** Project owner (Ilkka Rytkönen)
**Work item:** AB#64

## Context

The shared media model landed in AB#38 as a union of `ImageMedia` and `VideoMedia`
(`src/lib/media.ts`), and the portfolio grid wraps it in `MediaItem { id, media }`
(`src/lib/gallery.ts`). That shape is enough for one mock gallery and nothing more.

The same source photograph is about to appear in several places at once. The MVP alone
puts it in curated galleries, article bodies, and service pages. The roadmap adds
keyword-driven dynamic galleries, private client delivery, enquiry about a specific
item, and possibly sales. Every one of those is a separate story already on the board —
AB#66, AB#105, AB#108, AB#68, AB#60, AB#95, AB#122 — and every one of them needs to
name a photograph.

Today the model cannot name one. `MediaItem.id` is `"coastal-landscape"`: it reads like
the identity of a photograph, it is stored next to a single gallery position, and it is
the only id in the system. It is doing the work of a media identifier and a placement
identifier simultaneously, and `Media` itself carries no identity at all. Put the same
photograph in an article and there is no way to state that it is the same photograph —
its alt text, credit, and dimensions get retyped and are then free to drift.

Four distinct things are being collapsed into that one field, and they have different
owners, different lifetimes, and different visibility:

- **Which photograph this is** — stable for the life of the site, photographer-facing,
  survives re-export and re-upload.
- **Where it sits in this container** — born and dies with a gallery position, changes
  when the photographer restructures a gallery.
- **How the CMS refers to the asset** — changes when the asset is reprocessed or
  re-uploaded, and would change entirely if the CMS were replaced.
- **Where the master file lives** — the photographer's archive, which is not part of
  the web system at all and must never reach a visitor.

Deciding this after the public schemas exist is expensive in a specific way: a media
identifier that leaks into public URLs and later into an enquiry or an order reference
cannot be renamed without breaking links and records that point at it. The decision has
to precede AB#108 (rendition boundary), AB#105 (section filtering) and AB#66 (query
contract), all of which are blocked on this story.

Constraints that shape the answer more than convenience does:

- **Generic by design.** No Sanity types in the project's own domain model. The CMS
  commitment is planned, not made, and the public boundary must survive it not being made.
- **Privacy by default**, extended to identifiers: archive locations and provider
  internals are not visitor-facing data.
- **Images are never cropped**, which makes intrinsic dimensions a property of the
  photograph, not of the place it is shown.
- **Image and video capable.** Identity rules apply to both variants; playback does not
  get built early.
- **MVP first.** This ADR defines the whole boundary but does not authorize building all
  of it now — see *Scope of implementation* below.

## Decision

**Adopt a layered identity model with five distinct identifiers, three public and two
server-only, and split metadata ownership between the media entity and its placements.**

### 1. The five identifiers

| Identifier | Owned by | Unique within | Visibility | Lifecycle |
| --- | --- | --- | --- | --- |
| `mediaId` | project | the site | public | minted once when the media enters the system; immutable thereafter |
| `placementId` | project | the site | public | born with the placement, dies with it; unaffected by reordering |
| `itemId` | derived | one result set | public | never stored — computed when a result is assembled |
| provider asset reference | CMS/provider | the provider | **server only** | changes on reprocess, re-upload, or provider migration |
| `archiveLocator` | photographer | the archive | **server only** | optional, editable, may be absent |

**`mediaId` is the photograph.** It is a project-minted, stable, human-readable string
(the existing `"coastal-landscape"` values become `mediaId`s). It is deliberately *not*
derived from the filename, the CDN URL, the provider's asset id, or a content hash.
Re-exporting a master with different processing, re-uploading it, moving to a different
CDN, or migrating off the CMS all change those values while leaving the photograph the
same work — and that is exactly when identity must hold, because an enquiry, a sale, or
an inbound link may already point at it. `mediaId` survives all four.

**`placementId` is the occurrence.** One media placed in one container at one position.
It is unique across the site, so a public occurrence reference can be resolved without
guessing which container owns it. Its `mediaId` and container bindings are immutable:
replacing the media or moving it to another container creates a new placement and a new
`placementId`. Reordering it, changing its section, or editing presentation metadata
keeps the existing id.

**`itemId` is what a result set exposes**, and it is derived, never stored:

- **Curated result:** `itemId = placementId`. A curated gallery is an ordered list of
  placements, so the placement is the thing the visitor is looking at.
- **Dynamic result** (keyword-driven, AB#66): results are deduplicated by `mediaId`
  first, so each photograph appears **at most once**, and `itemId = mediaId`. The same
  query therefore yields the same `itemId`s regardless of ordering, pagination, or which
  galleries the photographs happen to live in.

**The provider asset reference never leaves the server.** It is read by the mapping
layer, resolved into the rendition shape proposed by
[ADR-0005](0005-public-image-rendition-boundary.md), and dropped. It does not
appear in a public payload, a URL, or a client component's props.

**`archiveLocator` never leaves the server either**, and unlike the provider reference it
is never even resolved into something public. It records where the master lives — an
archive path, a catalogue reference, a drive label. It exists so the photographer can get
from a published image back to the original; it is not delivery infrastructure. Master
files are not served by this system, and no public code path takes `archiveLocator` as
input.

### 2. Repeating a photograph inside one curated gallery

**Allowed, with a CMS warning.** The data model permits the same `mediaId` in two
placements of one gallery — a section opener that also appears within its section is a
legitimate edit — but the CMS surfaces a warning, because at 400 images per gallery an
accidental repeat is otherwise invisible.

This is the reason `itemId` must be placement-derived for curated results: two occurrences
of one photograph are two items, and a single media-derived id could not tell them apart.
It also means a public item reference identifies an *occurrence*, not a photograph;
anything that needs the photograph (enquiry, sales) resolves `itemId → mediaId` on the
server rather than assuming they are the same string.

Dynamic results take the opposite rule — deduplicate by `mediaId` — because there is no
curator there to intend a repeat.

### 3. Metadata ownership

**Media-owned. Global defaults and non-overridable asset state:**

| Field | Why it is global |
| --- | --- |
| `type` (`image` \| `video`) | a property of the asset |
| `alt` | the default alternative text; accessibility quality stays auditable in one place while placements may make an explicit context override |
| `credit` | attribution does not change with context |
| `width`, `height` | intrinsic pixel dimensions; a placement cannot claim a different ratio, which is what the no-crop rule requires |
| `caption` | the default caption, used when a placement does not override it |
| keywords | media-owned; exposure decided in AB#68 |
| canonical media context | see below |
| media-level state flags | `publicationState`, `publiclyRenderable`, `dynamicallyDiscoverable`, `privateOnly`, and later enquiry/sales eligibility; see §4 |

**Placement-owned:**

| Field | Notes |
| --- | --- |
| `order` | position within its container |
| section membership | gallery-local sections (AB#105); a section is a property of the placement, not of the photograph |
| `caption` override | optional; falls back to the media caption |
| `altOverride` | optional and exceptional; may be an empty string when this occurrence is decorative or redundant in its context |
| placement visibility | whether *this* placement renders |

**`caption` and `alt` have controlled placement overrides.** The same photograph genuinely
says a different thing in a rally report than in a travel story, and forcing one caption
everywhere produces captions that fit nowhere. Alternative text is also contextual: an
occurrence may be informative in a gallery but decorative or redundant next to equivalent
article text. `altOverride` therefore permits a context-specific value, including `""`,
while the media-owned `alt` remains the required default and the normal editorial path.
Resolution tests for property presence, not truthiness: an explicit empty string must not
fall back to the media default. Overrides remain separately auditable in the CMS.

**Visibility composes by AND, and a placement can only subtract.** A curated item renders
only when its container's publication policy, the media-level state, and the placement
visibility all permit it. A placement can hide a media that is publicly renderable; it
can never make a non-public media visible. Effective visibility is computed server-side.

**Canonical media context** is media-owned and optional: a pointer to the one placement
that is the photograph's public home. It supplies the canonical URL, the "see this in its
gallery" link from a dynamic result, and later the landing target for an enquiry. It is
set deliberately on the media; creating a placement never assigns it as a side effect,
and a media with no canonical context (an article-body illustration, say) is valid. The
pointer stores the site-wide `placementId`; the server resolves its container and emits a
URL only while both the placement and its container remain publicly renderable.

**Dynamic results do not inherit arbitrary placement overrides.** After deduplication a
dynamic item has no persisted dynamic placement, so it uses the media-owned default `alt`
and `caption`. Its canonical placement may supply `canonicalHref`, but not presentation
metadata. Curated results resolve `altOverride ?? alt` by presence and
`caption override ?? caption` from their own placement.

### 4. Publication state is not one boolean

These are independent policy decisions, although they are not all owned by the media
record. None is inferred from another:

| Field | Owned by | Question it answers |
| --- | --- | --- |
| `publicationState` | media | is this editorially finished, or a draft? |
| `publiclyRenderable` | media | may an anonymous visitor receive this at all? |
| `dynamicallyDiscoverable` | media | may this surface in keyword-driven dynamic results (AB#66)? |
| `indexable` | public container / route | may this page appear in the sitemap and be indexed? |
| `privateOnly` | media | does this belong to client delivery only (AB#122)? |
| enquiry / sales eligibility | media | may a visitor ask about, or buy, this? (AB#60, AB#95) |

A published photograph the photographer does not want surfacing in arbitrary keyword
queries is represented by `dynamicallyDiscoverable`. A public gallery deliberately kept
out of search results is represented by `indexable` on that gallery's public route. The
same media may still appear on another indexable page, so `indexable` is deliberately not
a field on `MediaRecord`. Both requests become unrepresentable the moment these decisions
collapse into one `published` flag. Sales eligibility in particular is opt-in and never
inferred: it carries pricing and legal consequences that publication does not.

`privateOnly` hard-excludes from every public surface regardless of the others; its
enforcement mechanism is AB#122's decision, not this one.

### 5. Content placement is not media placement

- A **media placement** attaches one media to a container at a position: a gallery item,
  a hero, a service image.
- A **content placement** is a block inside a body — an article body, or the optional
  body of a gallery. A content block may *contain* a media reference, and that nested
  reference is itself a media placement.

The consequence that matters: **an image inside a gallery's body is not a gallery item.**
It does not enter the gallery's result set, does not get a gallery `itemId`, does not
appear in the lightbox sequence, and does not participate in pagination. Reordering body
blocks moves content placements and carries their nested media placements along
unchanged.

### 6. Where the boundary lives in code

The project-owned domain types stay in `src/lib`. A server-side mapping layer converts
provider documents into them. Modules that can access provider documents,
`archiveLocator`, master locations, or provider references are marked with
`import "server-only"`, so importing them into a Client Component fails the build.
Provider types never appear in a component's props, in a public domain type, or in a
public payload — `_id`, `_type`, `_ref`, and asset objects stop at the mapping layer.

The client boundary is an explicit allow-list projection: the mapper constructs
`PublicMediaItem` property by property. It must not return or spread a server record and
rely on a narrower TypeScript annotation, because a type annotation does not remove
properties at runtime. The server-only module guard prevents client imports; the explicit
projection and a serialization test prevent a server route from leaking sensitive fields.

Sketch of the shape the boundary commits to (not the final file — field names and
optionality are settled here, module layout is not):

```ts
// In a module guarded by `import "server-only"`. Never serialized directly.
type CanonicalMediaContext = {
  placementId: string;               // site-wide unique placement
};

type MediaRecord = {
  mediaId: string;
  providerAsset: ProviderAssetRef;   // opaque outside the mapping layer
  archiveLocator?: string;           // master file location; never public
  type: "image" | "video";
  alt: string;
  caption?: string;
  credit?: string;
  width: number;
  height: number;
  canonicalContext?: CanonicalMediaContext;
  publicationState: "draft" | "published";
  publiclyRenderable: boolean;
  dynamicallyDiscoverable: boolean;
  privateOnly: boolean;
};

// Server-only. One media in one container at one position.
type MediaPlacement = {
  placementId: string;               // unique across the site
  mediaId: string;
  order: number;
  sectionId?: string;                // gallery-local (AB#105)
  caption?: string;                  // overrides MediaRecord.caption
  altOverride?: string;              // "" is a deliberate decorative result
  visible: boolean;                  // may restrict, never widen
};

// Public. Crosses to the client.
type PublicMediaItem = {
  itemId: string;                    // curated: placementId — dynamic: mediaId
  mediaId: string;
  type: "image" | "video";
  alt: string;                       // curated: explicit override or media default
  caption?: string;                  // curated override or media default
  credit?: string;
  width: number;
  height: number;
  canonicalHref?: string;            // resolved server-side
  // rendition: shape proposed by ADR-0005
};
```

`mediaId` is public on purpose: it is the photographer-facing locator, it is already the
`itemId` of dynamic results, and enquiry and sales will need a photograph-level reference
that an occurrence-level `itemId` cannot provide.

### Scope of implementation

This ADR defines the boundary; it does not authorize building all of it now. The MVP
implements `mediaId`, `placementId`, derived `itemId`, the media/placement metadata
split, the caption and alt overrides, ordering, section membership, `publicationState`
and `publiclyRenderable`. `dynamicallyDiscoverable`, route-owned `indexable`,
`privateOnly`, keywords, `archiveLocator`, and enquiry/sales eligibility are **named here
and added by their own stories** — so those stories inherit a decided shape instead of
renegotiating it, without this story shipping roadmap features early.

## Options Considered

### Option A: Keep the current flat model — media embedded per usage

| Dimension | Assessment |
| --- | --- |
| Complexity | Lowest — it is what exists |
| Reuse across contexts | None — each usage retypes alt, credit, dimensions |
| Durability of public references | None — no photograph-level identifier exists |
| Fit for roadmap stories | Poor — enquiry, sales, and dynamic galleries have nothing to name |

**Pros:** zero work; adequate for one mock gallery; nothing to migrate.

**Cons:** the same photograph in a gallery and an article are unrelated objects, so alt
text and credit drift silently and "where else does this appear?" is unanswerable.
Deduplicating a dynamic result is impossible. Every blocked story would have to invent
its own identifier, and they would not agree.

**Rejected** — this is the problem, not an option, but it is the default that happens if
no decision is made.

### Option B: Use the provider's asset id as the media identity

| Dimension | Assessment |
| --- | --- |
| Complexity | Low — nothing to mint |
| Uniqueness | Guaranteed by the provider |
| Stability | Poor — changes on reprocess and re-upload |
| Portability | Poor — public URLs become a CMS commitment |

**Pros:** no id minting, no collision handling, no editorial discipline required;
uniqueness is someone else's problem.

**Cons:** it makes the CMS a public API. Re-uploading a re-exported master produces a new
asset id, so the same photograph acquires a new identity precisely when a stored enquiry
or an inbound link needs the old one. The project has not committed to Sanity, and this
option quietly makes that commitment through the public URL space. It also contradicts
the rule that provider internals stay server-side: the identifier would be in every
payload.

**Rejected.**

### Option C: Content hash as the media identity

| Dimension | Assessment |
| --- | --- |
| Complexity | Low — computed, not managed |
| Uniqueness | Strong |
| Stability | Poor — any re-processing changes it |
| Photographer-facing usability | Poor — opaque |

**Pros:** no minting, deduplication of byte-identical uploads comes free, and it is
provider-independent — it survives a CDN or CMS change, which Option B does not.

**Cons:** it identifies a *file*, and the thing that needs identity is a *photograph*.
Re-exporting with different processing yields a different hash for the same work, which
is the case the acceptance criteria specifically require to survive. Two derivatives of
one photograph become two unrelated identities, which is wrong for enquiry and sales. And
a 64-character digest is not something a photographer can use to find an image in their
own archive.

**Rejected.**

### Option D (chosen): Layered identity with a media/placement metadata split

| Dimension | Assessment |
| --- | --- |
| Complexity | Medium — two entities, one derivation rule, a mapping layer |
| Stability | High — identity is owned by the project, not by a file or a vendor |
| Portability | High — provider and archive are both server-only |
| Fit for roadmap stories | High — each blocked story gets the identifier it needs |

**Pros:** a photograph keeps one identity across galleries, articles, services, dynamic
results, and later private delivery. Global metadata is stored once. Provider migration
touches the mapping layer and nothing public. The archive stays outside the web system by
construction rather than by discipline.

**Cons:** more moving parts than the MVP strictly needs today. `mediaId` must be minted
and kept unique as an editorial identity, and placement creation must mint a site-wide
unique `placementId`. Resolving an item to a photograph is now a lookup instead of a
field read.

## Trade-off Analysis

**Durability against minting cost.** Options B and C are free; D is not. Someone (or some
CMS automation) must produce a stable, unique `mediaId` per photograph and never reuse it.
That cost is paid once per image at ingest. The cost of B and C is paid at exactly the
wrong moment — when a photograph is re-exported or the CMS is replaced, which is when a
stored enquiry or an external link is most likely to already depend on the old identity.
The project explicitly has not committed to Sanity; an identity scheme that survives that
decision not being made is worth minting ids for.

**Allowing duplicates costs a level of indirection.** Because a curated gallery may repeat
a photograph, a public `itemId` names an occurrence rather than a work, and every feature
that cares about the work — enquiry (AB#60), sales (AB#95) — must resolve `itemId →
mediaId` server-side instead of using the id it was handed. Forbidding duplicates would
have removed that indirection and let `itemId = mediaId` everywhere. It would also have
made a legitimate edit impossible, and it would not have removed the indirection from
dynamic results, which need the deduplication rule regardless. The CMS warning recovers
most of the practical benefit of the strict rule — accidental repeats get caught — at
none of the modelling cost.

**Controlled overrides against one source of truth.** Media-owned `alt` and `caption`
remain the defaults, so ordinary reuse does not duplicate editorial work. Placements may
override either only when their context requires it. The risk is accessibility metadata
drifting across placements; requiring a media default, treating `altOverride` as an
explicit exception, and auditing overrides keeps that surface visible without making a
contextually wrong alt unavoidable. Dynamic results avoid the ambiguity entirely by
using media defaults.

**Independent policy axes against one flag.** A single `published` boolean is smaller and
easier to explain, and it is the shape most projects start with. It is also the shape that
produces the worst possible bug in this project: a private client image reachable
publicly, or a page indexed that was meant to be unlisted. These decisions were already
implied by independently planned work — dynamic discoverability by AB#66, route
indexability by SEO, private-only by AB#122, sales eligibility by AB#95 — so collapsing
them would mean splitting them again later. Keeping route-owned `indexable` outside
`MediaRecord` also avoids turning reuse of one photograph into an SEO coupling between
otherwise independent pages.

**Defining more than the MVP builds.** This ADR names fields that no MVP story will
implement, which sits awkwardly beside the MVP-first rule. The alternative is worse: seven
blocked stories each proposing their own answer, and a public payload shape that changes
under them. Naming a field costs nothing at runtime; the *Scope of implementation*
section is what keeps the rule intact, and it is binding — a field named here is not a
licence to build its feature.

**Where this could still be wrong.** The heaviest assumption is that a project-minted
`mediaId` will actually be maintained with discipline for a ~400-image gallery. If ingest
turns out to be a bulk operation where minting readable ids is impractical, the fallback
is machine-generated ids with a human-readable label alongside — which keeps this ADR's
structure but loses the photographer-facing property that argued against Option C.

## Consequences

**Easier**

- One photograph, one default alt text, one credit, one set of dimensions — with explicit,
  auditable context overrides where accessibility requires them.
- A dynamic result can deduplicate, because there is finally something to deduplicate by.
- Provider migration touches the mapping layer; no public URL or stored reference moves.
- Private and archive data are excluded by a server-only module boundary, an allow-list
  projection, and a serialization test rather than by review alone.
- AB#66, AB#105, AB#108, AB#68, AB#60, AB#95 and AB#122 all start from a decided vocabulary.

**Harder**

- Two entities and a mapping layer where there was one flat object; every read path now
  composes media-owned and placement-owned state.
- `mediaId` must be minted and kept unique, and it can never be renamed once public.
- Placement creation must mint a site-wide unique `placementId`; replacing its media or
  moving it to another container creates a new occurrence.
- Item references identify occurrences, so photograph-level features need a server-side
  resolve step.
- Effective visibility is a computation over several flags, not a field — it needs one
  implementation and tests, not a check repeated at each call site.
- Existing mock data must be restructured: today's `MediaItem.id` splits into a `mediaId`
  on the media and a `placementId` on the placement.

**To revisit — migration triggers**

- **Bulk ingest makes readable `mediaId`s impractical** → switch to generated ids plus a
  human-readable label; the structure survives, the Option C argument weakens.
- **Repeat-in-gallery proves always accidental in practice** → tighten the CMS warning to
  an error. No data migration; `itemId = placementId` stays correct either way.
- **`altOverride` becomes common rather than exceptional** → improve the CMS audit and
  comparison workflow before adding further override fields; the media default remains
  required.
- **A DAM or asset service is adopted alongside the CMS** → a second server-only provider
  reference appears; `mediaId` is unaffected. This is the case the layering exists for.
- **A ~400-image gallery makes embedded placements too heavy for one CMS document** →
  placements move to their own documents. The `mediaId`/`placementId`/`itemId` contract is
  unchanged by that move, which is the test of whether this ADR did its job.
- **Sales (AB#95) needs a stable reference to a licensed work rather than a photograph** —
  e.g. one photograph sold in several editions → a fourth identifier layer, not a change
  to this one.

## Action Items

1. [x] Restructure `src/lib/media.ts` and `src/lib/gallery.ts` to the media/placement
       split, with `mediaId` on the media and `placementId` on the placement
       (implementation story, not this one).
2. [ ] AB#67 now derives curated `itemId` from placement in one place. AB#66 still
       needs to derive dynamic `itemId` after deduplicating by `mediaId`, so no call site
       derives either form ad hoc.
3. [ ] Implement effective visibility as a single server-side function over the state
       flags; no call site checks flags individually.
4. [ ] Carry this vocabulary into AB#66 (query contract) and AB#108 (rendition boundary)
       rather than re-deriving it.
5. [ ] Add the duplicate-`mediaId` warning when the CMS schema lands (AB#105 / CMS
       integration), not before.
6. [ ] When the mapping layer lands, put provider and archive access in modules guarded by
       `import "server-only"`, construct public DTOs with an explicit allow-list projection,
       and add a serialization test proving that provider fields, `archiveLocator`, and
       master locations cannot reach a public payload.

## What this ADR did not establish

- **No prototype was built and no schema was written.** This is a design decision recorded
  before implementation, unlike ADR-0001 which was backed by a measured spike. Nothing here
  is a measurement.
- **Rendition and delivery URLs are out of scope** —
  [ADR-0005](0005-public-image-rendition-boundary.md) proposes what replaces the current
  `src` field.
- **Private gallery enforcement is out of scope** — this ADR reserves `privateOnly` and
  states that it hard-excludes; AB#122 decides how that is enforced, stored, and expired.
- **Keyword shape and hierarchy are out of scope** — AB#68 decides how media-owned
  keywords are modelled and exposed.
- **The CMS commitment is not made here.** The boundary is designed to survive Sanity not
  being chosen; it does not choose it.
