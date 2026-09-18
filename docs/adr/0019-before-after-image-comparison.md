# ADR-0019: Before/after image comparison body block

**Status:** Proposed
**Date:** 2026-09-18
**Deciders:** Project owner (Ilkka Rytkönen)
**Work item:** AB#23

## Context

AB#23 began as a rough article-slider story with no acceptance criteria. Its
scope was refined on 2026-09-18 following the owner's confirmation: deliver the
comparison block, Sanity authoring/projection, and Joomla conversion together;
allow the block in both article and gallery bodies; allow temporary,
visitor-controlled image occlusion; and keep incompatible aspect ratios as
complete images without an overlay. The owner normally authors equal-size pairs.
These requirements are now recorded in Azure Boards.

The authoritative discussion inventories twelve legacy comparisons across nine
articles (the second comment corrects the first comment's eight-article count).
They include exposure, camera, aperture, and chart comparisons. Side labels must
therefore be authored, rather than fixed to "before" and "after". One legacy pair
has no labels. Those articles wait for an equivalent block before entering
AB#137's launch manifest; they must never migrate with their comparisons stripped.

The public media boundary already provides versioned derivatives, true intrinsic
dimensions, localized descriptive alt text, and bounded responsive delivery.
Body images, mini-galleries, curated galleries, and article end galleries each
have their own viewer sequences. A comparison must preserve those boundaries.

## Decision

### Shared content and public media contract

Add `image-comparison`, the tenth shared `ContentBlock` kind. It has exactly two
`ImageMedia` placements (`first`, `second`), required `firstLabel`/`secondLabel`
(nonblank, maximum 200 characters each), optional `title` (nonblank when authored,
maximum 120 characters), and the usual stable block `key`.

Studio stores two media references in `contentImageComparisonBlock`. The public
adapter dereferences and validates each through `projectPublicMedia`; unresolved,
nonpublic, malformed, and video media fail closed. The block never introduces a
raw URL, archive locator, HTML fragment, or provider-shaped public DTO. Labels
belong to the comparison placement; descriptive alt text remains on shared media.
Comparison images join no lightbox sequence and offer no enquiry control.

### Native interaction and complete-image fallback

Use a project-owned component with native `input type="range"`, bounded 0–100,
step 1, initially 50. The visible control sits below the images; its position also
moves the decorative divider in the image. The control's accessible name and
complete-image toggle are localized, and `aria-valuetext` names both sides with
their visible proportions. The browser owns mouse/touch and keyboard interaction.
There is no custom gesture recognizer and no animation.

Server output shows both complete images and their labels, captions, and credits.
The interactive reveal appears only after hydration and both successful image
loads. Native aspect ratios must match exactly, checked by integer cross-product;
different derivative resolutions with the same ratio are allowed. The overlay
width is capped by the smaller derivative's intrinsic width. Each image retains
its true dimensions, native ratio, and the caller's bounded body `sizes` profile.
The second image's reveal mask changes visibility without changing its dimensions
or requesting a crop. This is the owner's scoped exception to the full-frame rule.

A pressed-state toggle returns to two complete images and can restore the reveal;
it preserves the selected divider position and retains focus. Incompatible ratios
remain complete images in source order, stacked vertically, with no inactive
controls. An image error returns to the same complete-image layout with a localized
status; it never hides the other successful image. No controls appear without
JavaScript. Hydration may reduce the two-image fallback's height once both images
are ready; this progressive-enhancement layout change is a deliberate trade-off.

### Joomla conversion and approvals

The private source confirms `{loadmodule mod_aikon_awesome_compare,<module title>}`
and the module's `img1`/`img2`, `alt1`/`alt2`, and `title1`/`title2` parameters.
The converter recognizes only that module type, resolves the exact module title
through owner-approved `comparisonModules` in the existing resolution file, and
emits a comparison at the marker's authored position. Other module types retain
the existing unknown-marker refusal.

The resolution provides `img1`/`img2`, language-keyed `labels.first`/`labels.second`,
and an optional language-keyed title. Both images still require the existing
approved `images` locator/hash entries, verified real file bytes, and descriptive
`altText` for the article's language. No label or alt text is invented or silently
borrowed from a different language. The unlabeled legacy pair needs owner-authored
labels before it can convert.

Both identities and content hashes enter the resolved-conversion approval digest,
and both references produce media documents and asset requirements. Writer field
allow-lists validate the block's two references, bounded labels/title, and reject
extra fields. Migration validation requires both references to resolve to public
image documents. The final writable-plan digest covers the resulting documents
and asset requirements. The conversion policy advances to `joomla-conversion-v3`,
retiring stale conversion approvals. Plan format remains `joomla-import-plan-v3`.

## Options Considered

| Option | Documentation checked | Outcome |
| --- | --- | --- |
| Native range control and project-owned reveal | The HTML standard defines a numeric range control with minimum, maximum, and step constraints. | Selected: browser interaction plus a small local layout meets this bounded feature without a dependency. |
| `react-compare-slider` | Its README documents custom React items, intrinsic sizing, keyboard increments, divider callbacks, and touch-specific handle dragging. | A credible alternative if future interaction needs justify it; still requires public-media, fallback, and attribution integration. |
| `img-comparison-slider` | Its README documents custom elements, Shadow DOM requirements, image slots, keyboard control, and handle-only dragging. | Introduces element registration and integration work without a demonstrated need in this slice. |

Sources checked on 2026-09-18:

- [HTML range state](https://html.spec.whatwg.org/multipage/input.html#range-state-(type=range)).
- [React Compare Slider documentation](https://github.com/nerdyman/react-compare-slider).
- [Image Comparison Slider documentation](https://github.com/sneas/img-comparison-slider/blob/master/packages/img-comparison-slider/README.md).

Library accessibility claims describe their documentation, not project measurements.
No third-party comparison library was installed or benchmarked.

## Trade-off Analysis

A native control avoids a dependency and a second interaction model to maintain.
The project owns the reveal presentation and verifies it in real browsers. The
control below the image is visually separate from its divider, rather than a
custom draggable handle laid over the photograph. Native touch behavior also
avoids taking over vertical page scrolling on the image itself.

Stacked complete images preserve meaningful reading and attribution when scripts
are unavailable, images cannot align, or a request fails. Explicit media validation
and refusal of incomplete migration resolution cost more than a permissive embed,
but preserve the existing public-media and approval boundaries.

## Consequences

- Articles and gallery bodies share one comparison schema and renderer.
- Image labels, descriptive alt text, captions, and credits remain distinct.
- No new dependency, external origin, cookie, credential, or response-policy
  relaxation is introduced.
- Private legacy module configuration remains outside the shipped template;
  fixture images and source markers in tests are generic and synthetic.
- Production import still follows AB#137's owner-reviewed manifest and writer flow.
  Shipping converter support alone does not accept or import the nine articles.

## Action Items

- Validate the implementation with unit tests, the production build, lint, and
  public browser journeys; record final results in the PR.
- Public browser coverage includes both locales and content variants, native
  keyboard and pointer/touch input, complete-image toggle, incompatible ratios,
  image failure, scriptless presentation, native ratios, and viewer isolation.
- Prepare the private resolution for the twelve legacy comparisons, author the
  missing side labels and any missing descriptive alt text, then regenerate review
  reports and approvals with conversion policy v3 before launch import.
- Confirm the decision's acceptance during PR review; no real-device screen-reader
  verification or production CMS import is claimed by fixture browser results.
