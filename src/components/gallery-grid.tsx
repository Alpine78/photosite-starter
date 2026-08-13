"use client";

import Image from "next/image";
import { useCallback, useId, useRef, useState } from "react";
import {
  GalleryLightbox,
  GalleryLightboxTrigger,
} from "@/components/gallery-lightbox";
import type { BuiltInLabels } from "@/lib/deployment-config";
import {
  appendGallerySlice,
  galleryContinuationHref,
  type GallerySlice,
} from "@/lib/gallery-slice";
import { fetchGallerySlice } from "@/lib/gallery-slice-client";
import { imageRenderProfiles } from "@/lib/image-delivery";

type GalleryGridProps = {
  /** Accessible name of the image list, normally the gallery's own title. */
  label: string;
  /**
   * The slice the server rendered: one bounded page of the shared result
   * contract, in its authoritative order. The type is AB#67's and nothing
   * narrower, so the grid renders a curated gallery and a later dynamic one
   * identically and never learns which it was given.
   */
  initialSlice: GallerySlice;
  /**
   * This gallery's canonical, parameter-free path. It addresses the
   * continuation endpoint and rebuilds the next link, so a content id never
   * reaches the browser.
   */
  galleryPath: string;
  labels: BuiltInLabels;
};

type ContinuationState = "idle" | "loading" | "failed";

/**
 * One gallery's items as a grid of full-frame thumbnails, each opening the
 * fullscreen lightbox at its own position, and the control that loads more.
 *
 * The layout is row-major: one, two, or three equal columns filled left to
 * right in DOM order. That is the whole reason it is a grid rather than the CSS
 * multi-column masonry this replaced — multi-column fills a column at a time, so
 * the top row of a three-column masonry reads as items one, three, and five
 * while the lightbox, the keyboard, and the source all count one, two, three.
 * One authoritative order means the eye has to agree with them too.
 *
 * The cost is a ragged bottom edge where a portrait and a landscape frame share
 * a row, and that is the right trade: every image keeps its native aspect ratio
 * and full frame — `h-auto w-full` over the rendition's true dimensions, no
 * `object-cover` and no fixed-ratio cell — because a cropped preview
 * misrepresents the photograph and can make a strong image go unseen.
 *
 * ## Continuing
 *
 * This is a Client Component only for the append. The first slice is rendered
 * on the server and the control below it is a real link to that slice's own
 * `?cursor=` address (ADR-0003 decision 8), so the whole gallery is reachable
 * with no JavaScript at all. Script only intercepts that link and puts the next
 * slice into the page instead of navigating to it.
 *
 * **Nothing loads on its own.** There is no scroll observer and no prefetch of
 * later pages: a visitor asks for each slice, one bounded page at a time, so a
 * four-hundred-item gallery is never implicitly retrieved whole.
 *
 * **The address bar is deliberately left alone.** Replacing it with the last
 * appended slice's URL would name a page that shows *only* that slice, while
 * the screen shows the accumulation — a reload would then contradict what the
 * visitor was just looking at. Every slice already has its own honest address
 * through the unenhanced link, which is what sharing and indexing use.
 */
export function GalleryGrid({
  label,
  initialSlice,
  galleryPath,
  labels,
}: GalleryGridProps) {
  const [slice, setSlice] = useState(initialSlice);
  const [state, setState] = useState<ContinuationState>("idle");
  const continueRef = useRef<HTMLAnchorElement | null>(null);
  const completionRef = useRef<HTMLParagraphElement | null>(null);
  // A second activation while one slice is in flight must not start another.
  const inFlightRef = useRef(false);
  const statusId = useId();

  const { nextCursor } = slice;

  /**
   * Loads the next slice and appends it.
   *
   * Returns whether anything was appended, so a caller that needs to act on the
   * result — the lightbox, continuing past its last loaded slide — can wait for
   * this rather than watch state it does not own.
   */
  const loadNext = useCallback(async (): Promise<boolean> => {
    if (inFlightRef.current || nextCursor === null) return false;

    inFlightRef.current = true;
    setState("loading");

    try {
      const next = await fetchGallerySlice(galleryPath, nextCursor);
      // Appending is what de-duplicates: a cursor names a boundary rather than
      // a set, so an overlapping slice is a legal answer and must not put the
      // same item on screen twice.
      setSlice((loaded) => appendGallerySlice(loaded, next));
      setState("idle");
      return true;
    } catch {
      // The failure is announced and the control becomes a retry. Nothing that
      // was already loaded is discarded: a visitor keeps everything they had.
      setState("failed");
      return false;
    } finally {
      inFlightRef.current = false;
    }
  }, [galleryPath, nextCursor]);

  const onContinue = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      // Anything but a plain primary click stays a link: a new tab, a download,
      // or a context menu on the continuation URL all keep working.
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      event.preventDefault();
      void loadNext().then((appended) => {
        // Focus is predictable: it stays on the control a visitor activated for
        // as long as that control exists, and moves to the completion notice
        // only when the control itself goes away — never to the document body.
        if (appended && slice.nextCursor === null) return;
        continueRef.current?.focus();
      });
    },
    [loadNext, slice.nextCursor],
  );

  const isLoading = state === "loading";
  const hasFailed = state === "failed";

  return (
    <GalleryLightbox
      slides={slice.slides}
      labels={labels.lightbox}
      {...(nextCursor === null ? {} : { onContinue: loadNext })}
    >
      <ul
        aria-label={label}
        className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {slice.items.map((item, index) => {
          const { media } = item;

          return (
            <li key={item.itemId}>
              <figure className="rounded-sm bg-black/5 dark:bg-white/5">
                <GalleryLightboxTrigger
                  itemId={item.itemId}
                  index={index}
                  label={
                    media.alt.length > 0 ? undefined : labels.lightbox.openImage
                  }
                >
                  <Image
                    src={media.rendition.src}
                    alt={media.alt}
                    width={media.rendition.width}
                    height={media.rendition.height}
                    loading="lazy"
                    sizes={imageRenderProfiles.galleryGrid.sizes}
                    className="h-auto w-full"
                  />
                </GalleryLightboxTrigger>
                {media.caption && (
                  <figcaption className="px-3 py-2 text-sm text-foreground/65">
                    {media.caption}
                  </figcaption>
                )}
              </figure>
            </li>
          );
        })}
      </ul>

      <div className="mt-10 flex flex-col items-center gap-3">
        {/*
          One polite region for every state this control can be in. It is always
          in the document so a change is announced as a change rather than as new
          content appearing, and it is what focus lands on when the control goes.
        */}
        <p
          id={statusId}
          ref={completionRef}
          role="status"
          tabIndex={-1}
          className={
            hasFailed
              ? "text-sm text-foreground/80"
              : "text-sm text-foreground/60"
          }
        >
          {hasFailed
            ? labels.gallery.loadFailed
            : nextCursor === null
              ? labels.gallery.allLoaded
              : ""}
        </p>

        {nextCursor !== null && (
          <a
            ref={continueRef}
            href={galleryContinuationHref(galleryPath, nextCursor)}
            rel="next"
            onClick={onContinue}
            aria-describedby={statusId}
            aria-busy={isLoading}
            // Not `disabled`: an anchor has no such state, and taking the href
            // away mid-flight would break the unenhanced path if script fails
            // between renders. The in-flight guard is what prevents a second
            // request.
            className="rounded-sm border border-black/15 px-5 py-2.5 text-sm font-medium transition-colors hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60 dark:border-white/20 dark:hover:bg-white/10"
          >
            {isLoading
              ? labels.gallery.loadingMore
              : hasFailed
                ? labels.gallery.retry
                : labels.gallery.showMore}
          </a>
        )}
      </div>
    </GalleryLightbox>
  );
}
