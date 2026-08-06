"use client";

import "photoswipe/style.css";
// After the library's stylesheet, so the overrides in it win.
import "@/components/gallery-lightbox.css";
import PhotoSwipeLightbox from "photoswipe/lightbox";
import type { SlideData } from "photoswipe";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type { BuiltInLabels } from "@/lib/deployment-config";
import { getLightboxZoomCap } from "@/lib/image-delivery";
import type { LightboxSlide } from "@/lib/lightbox-slides";

/**
 * The project's only contact surface with the lightbox library (ADR-0001).
 *
 * The grid stays presentational and passes a result-ordered slide list in;
 * nothing outside this file imports PhotoSwipe, so replacing it later is a
 * one-file change. The library is loaded in two stages — this wrapper on the
 * route, the viewer itself only once a visitor opens a photo.
 */

export type GalleryLightboxLabels = BuiltInLabels["lightbox"];

/** PhotoSwipe slide data carrying the result identities unchanged. */
type IdentifiedSlideData = SlideData &
  Pick<LightboxSlide, "itemId" | "mediaId">;

type GalleryLightboxApi = {
  readonly open: (index: number) => void;
  readonly registerTrigger: (
    itemId: string,
    node: HTMLButtonElement | null,
  ) => void;
};

const GalleryLightboxContext = createContext<GalleryLightboxApi | null>(null);

/**
 * The declared-slot zoom cap (ADR-0005), read off a PhotoSwipe zoom level.
 *
 * PhotoSwipe's own "fit" level never enlarges past the derivative's pixels, so
 * the cap only binds for a source wider than the declared ceiling or for a
 * deliberately zoomed slide. It has to be applied to every level the library
 * offers, because it derives the effective maximum from all of them.
 */
function declaredSlotZoomCap(zoom: {
  readonly elementSize: { readonly x: number } | null;
}): number {
  return getLightboxZoomCap(zoom.elementSize?.x ?? 0);
}

function identitiesOf(slide: SlideData | undefined): IdentifiedSlideData | null {
  return typeof slide?.itemId === "string" && typeof slide.mediaId === "string"
    ? (slide as IdentifiedSlideData)
    : null;
}

export function GalleryLightbox({
  slides,
  labels,
  children,
}: {
  /** Ordered by the shared gallery result, never by grid layout order. */
  readonly slides: readonly LightboxSlide[];
  readonly labels: GalleryLightboxLabels;
  readonly children: ReactNode;
}) {
  const lightboxRef = useRef<PhotoSwipeLightbox | null>(null);
  const triggersRef = useRef(new Map<string, HTMLButtonElement>());
  const slidesRef = useRef(slides);
  const activeItemIdRef = useRef<string | null>(null);

  useEffect(() => {
    slidesRef.current = slides;
  }, [slides]);

  // Depends on the label strings rather than on the object holding them: a new
  // object identity from a re-render would tear down a working instance and
  // build another, which is how duplicate viewers and stale listeners happen.
  const {
    viewer,
    close,
    previous,
    next,
    zoom,
    indexSeparator,
    loadError,
  } = labels;

  useEffect(() => {
    const lightbox = new PhotoSwipeLightbox({
      // Deferred: a visitor who never opens a photo never downloads the viewer.
      pswpModule: () => import("photoswipe"),
      // No slide padding, which is the library's default and stated here
      // because it is a decision rather than an omission: the photograph is the
      // point, so it fills the viewport in whichever dimension binds first and
      // no margin is held back from it. The `sizes` hint declares the same
      // full-viewport slot.
      // All three levels restate PhotoSwipe's own defaults, held to the
      // declared ceiling. Every one of them has to be given: the library takes
      // its effective maximum as the largest of the three, so an uncapped
      // secondary level would raise the maximum straight back past the cap.
      initialZoomLevel: (zoomLevels) =>
        Math.min(zoomLevels.fit, declaredSlotZoomCap(zoomLevels)),
      secondaryZoomLevel: (zoomLevels) =>
        Math.min(
          Math.min(1, zoomLevels.fit * 3),
          declaredSlotZoomCap(zoomLevels),
        ),
      maxZoomLevel: (zoomLevels) =>
        Math.min(
          Math.max(1, zoomLevels.fit * 4),
          declaredSlotZoomCap(zoomLevels),
        ),
      imageClickAction: "zoom",
      trapFocus: true,
      // Focus returns to the trigger for the slide the visitor ended on, which
      // is not the one they opened once they have navigated. Handled below.
      returnFocus: false,
      closeTitle: close,
      arrowPrevTitle: previous,
      arrowNextTitle: next,
      zoomTitle: zoom,
      indexIndicatorSep: indexSeparator,
      errorMsg: loadError,
    });

    // `role="dialog"` is the library's; a dialog also needs a name, and needs
    // to say that the page behind it is inert while it is open.
    lightbox.on("uiRegister", () => {
      const root = lightbox.pswp?.element;
      if (!root) {
        return;
      }
      root.setAttribute("aria-modal", "true");
      root.setAttribute("aria-label", viewer);
    });

    lightbox.on("change", () => {
      const active = identitiesOf(lightbox.pswp?.currSlide?.data);
      if (active) {
        activeItemIdRef.current = active.itemId;
      }
    });

    lightbox.on("destroy", () => {
      const itemId = activeItemIdRef.current;
      activeItemIdRef.current = null;
      if (itemId === null) {
        return;
      }

      // A trigger that has left the document means the grid unmounted while the
      // viewer was open; there is nothing left to return focus to.
      const trigger = triggersRef.current.get(itemId);
      if (trigger?.isConnected) {
        trigger.focus();
      }
    });

    lightbox.init();
    lightboxRef.current = lightbox;

    return () => {
      lightboxRef.current = null;
      lightbox.destroy();
    };
  }, [viewer, close, previous, next, zoom, indexSeparator, loadError]);

  const open = useCallback((index: number) => {
    const lightbox = lightboxRef.current;
    const slides = slidesRef.current;
    const slide = slides[index];
    if (!lightbox || !slide) {
      return;
    }

    activeItemIdRef.current = slide.itemId;

    const triggers = triggersRef.current;
    const dataSource = slides.map((resultSlide): IdentifiedSlideData => {
      const trigger = triggers.get(resultSlide.itemId);
      // Already decoded and on screen: shown while the full frame loads, and
      // the frame the opening and closing animations travel between.
      const thumbnail = trigger?.querySelector("img");

      return {
        itemId: resultSlide.itemId,
        mediaId: resultSlide.mediaId,
        src: resultSlide.src,
        ...(resultSlide.srcset === undefined
          ? {}
          : { srcset: resultSlide.srcset }),
        width: resultSlide.width,
        height: resultSlide.height,
        alt: resultSlide.alt,
        ...(trigger === undefined ? {} : { element: trigger }),
        ...(thumbnail?.currentSrc ? { msrc: thumbnail.currentSrc } : {}),
        // The grid shows whole frames, so the thumbnail bounds the animation
        // starts from are the image itself and not a crop of it.
        thumbCropped: false,
      };
    });

    // Deliberately no pointer position: PhotoSwipe reads its absence as "not
    // opened by pointer" and moves focus into the dialog immediately. Passing
    // one would leave focus on the trigger behind an open dialog until the
    // visitor pressed Tab.
    lightbox.loadAndOpen(index, dataSource);
  }, []);

  const registerTrigger = useCallback(
    (itemId: string, node: HTMLButtonElement | null) => {
      if (node === null) {
        triggersRef.current.delete(itemId);
        return;
      }
      triggersRef.current.set(itemId, node);
    },
    [],
  );

  const api = useMemo<GalleryLightboxApi>(
    () => ({ open, registerTrigger }),
    [open, registerTrigger],
  );

  return (
    <GalleryLightboxContext.Provider value={api}>
      {children}
    </GalleryLightboxContext.Provider>
  );
}

function useGalleryLightbox(): GalleryLightboxApi {
  const api = useContext(GalleryLightboxContext);

  if (api === null) {
    throw new Error(
      "[gallery-lightbox] A trigger must be rendered inside <GalleryLightbox>.",
    );
  }

  return api;
}

/**
 * The control that opens one result item.
 *
 * A real button, so the grid is reachable and operable by keyboard without the
 * component reimplementing what a button already does. `index` addresses the
 * shared result list; `itemId` is what focus comes back to.
 */
export function GalleryLightboxTrigger({
  itemId,
  index,
  label,
  children,
}: {
  readonly itemId: string;
  readonly index: number;
  /** Only for an image with no alt text of its own; the alt names it otherwise. */
  readonly label?: string;
  readonly children: ReactNode;
}) {
  const { open, registerTrigger } = useGalleryLightbox();

  const trackNode = useCallback(
    (node: HTMLButtonElement) => {
      registerTrigger(itemId, node);
      return () => registerTrigger(itemId, null);
    },
    [registerTrigger, itemId],
  );

  return (
    <button
      type="button"
      ref={trackNode}
      onClick={() => open(index)}
      aria-haspopup="dialog"
      aria-label={label}
      className="block w-full cursor-zoom-in overflow-hidden rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {children}
    </button>
  );
}
