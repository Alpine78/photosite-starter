# ADR-0019: Before/after image comparison body block

**Status:** Proposed
**Date:** 2026-09-18
**Deciders:** Pending owner decision
**Work item:** AB#23

## Context

AB#23 is currently titled "Before/after image comparison slider in articles
(rough)". Its description explicitly requires refinement and a library evaluation
before implementation; it has no acceptance criteria as of 2026-09-18.

The authoritative discussion records twelve legacy comparison-module instances
across nine articles. The subsequent correction changes the original comment's
article count from eight to nine. Those articles must retain their comparisons
before entering AB#137's launch manifest. The inventory includes comparisons
between exposure settings, cameras, and charts, so labels must be authored per
side rather than fixed to "before" and "after". One pair has no authored labels.

The current application has nine shared `ContentBlock` kinds. Body images already
pass through `projectPublicMedia`, carry public derivatives and true intrinsic
dimensions, and render with bounded responsive `sizes`. Loose body images,
mini-galleries, and curated/end galleries have separate lightbox sequences.
A comparison must preserve those boundaries.

This proposal is the start of refinement, not an accepted implementation contract.
No library has been installed and no application or migration behavior is changed.

## Decision

Propose a tenth shared body-block kind for exactly two image placements, reusing
the existing public image contract. Each side would carry its own placement label;
labels would not overwrite a shared media document's descriptive alt text.
Stable block identity, optional title, and label bounds require definition during
refinement. The first requested consumer is the article body; availability in
gallery bodies remains a scope decision.

Recommend a small project-owned component using a native `input type="range"`
unless browser verification demonstrates a concrete reason to prefer a library.
Server rendering would show both complete, labeled images, with captions and
credits retained. Interactive controls would appear only after hydration.

An enhanced reveal would change which of two aligned images is visible, without
changing either image's ratio, requesting cropped derivatives, or enlarging one
image beyond its source resolution. This introduces an explicit question under
the repository's "full frame" rule: confirm that temporary, visitor-controlled
occlusion is permitted for this comparison feature. A complete-image view must
remain available. For incompatible ratios, propose retaining the complete-image
presentation rather than stretching or cropping to invent alignment. This policy
needs owner confirmation before implementation.

## Options Considered

| Option | Verified documentation | Remaining project work |
| --- | --- | --- |
| Native range control and project-owned reveal | The HTML standard defines a numeric range control with minimum, maximum, and step constraints. | Implement presentation; verify keyboard, touch, focus, accessible naming/value, image failures, and hydration. |
| `react-compare-slider` | The project's README documents custom React items, intrinsic sizing, keyboard increments, divider position callbacks, touch-specific handle dragging, and reduced-motion behavior. | Verify a pinned release with the project's React version, full-frame image rendering, server fallback, captions/credits, and accessibility in the actual page. |
| `img-comparison-slider` | The project's README documents custom elements and Shadow DOM requirements, two image slots, keyboard control, and handle-only dragging. | Verify a pinned release, React integration, server fallback, semantic control/value exposure, and image sizing in the actual page. |

Sources checked on 2026-09-18:

- [HTML range state](https://html.spec.whatwg.org/multipage/input.html#range-state-(type=range)).
- [React Compare Slider documentation](https://github.com/nerdyman/react-compare-slider).
- [Image Comparison Slider documentation](https://github.com/sneas/img-comparison-slider/blob/master/packages/img-comparison-slider/README.md).

Library accessibility statements above describe their documentation; they are
not measurements or an accessibility approval. Bundle size, maintenance quality,
release compatibility, and browser results have not been measured.

## Trade-off Analysis

A native control would avoid a dependency and use an existing browser control,
but the project would own reveal layout and its verification. This is a
recommendation, not evidence that a prototype already works.

A React library offers packaged interaction with custom image components. It
still needs the project's public-delivery, no-crop, fallback, and attribution
integration. A custom-element library also introduces registration and
Shadow DOM integration to assess. Neither option removes the need for
application-level verification.

Two-image fallback is useful on its own when scripts are unavailable or the pair
cannot be aligned without distortion. It must keep authored side labels distinct
from alt text and image attribution.

## Consequences

- The content contract, Studio schema, public projection, renderer, localized UI
  labels, and mock fixtures would change together once the scope is defined.
- Comparison images must not accidentally enter another viewer's slide sequence.
- No new external origin, cookie, or runtime write credential is needed by the
  proposed presentation.
- Selecting a third-party dependency would require a pinned version and the
  repository's asset/license inventory updates before it ships.
- The nine affected legacy articles remain blocked from the launch manifest until
  an equivalent block ships and their approved conversions preserve it.
- Joomla converter support in this story is pending a scope answer. No production
  import or live CMS write is authorized by this proposal.

## Action Items

1. Define AB#23's acceptance criteria and settle article/gallery availability,
   incompatible image ratios, controlled reveal under the full-frame rule, and
   whether Joomla conversion ships in this story.
2. Define the block fields and validate both images through the existing public
   projection. Decide how an unlabeled legacy pair receives owner-authored labels.
3. Prototype the preferred interaction; verify mouse, keyboard, touch, accessible
   naming/value, endpoint positions, focus visibility, reduced motion, and image
   failures in Chromium and WebKit.
4. Verify both complete images, their labels, captions, and credits with JavaScript
   disabled. Confirm native ratios and bounded image requests.
5. If migration is in scope, inspect the actual exported marker syntax and module
   resolution contract before implementing conversion. Use synthetic fixtures;
   never copy private article names, file locators, or archive images into demo
   content. Unknown modules and unresolved image pairs must remain refusals.
6. Ensure migration approval digests and writer validation cover both placements
   and their image requirements when conversion support is added.
7. Record browser evidence, settle the dependency choice, and update this proposal's
   status only when project authority establishes acceptance.

