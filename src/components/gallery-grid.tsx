"use client";

import Image from "next/image";
import { useCallback, useEffect, useId, useRef, useState } from "react";
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
  /**
   * The active named section's slug, or `undefined` for the unfiltered `All`
   * view. Threaded into both the continuation endpoint and the rebuilt link
   * so an append fetched from inside a named section always asks for that
   * section's next slice — this, together with the cursor's own scope
   * binding, is what keeps AB#72 continuation from ever appending an
   * out-of-section item.
   */
  activeSection?: string;
  labels: BuiltInLabels;
};

type ContinuationState = "idle" | "loading" | "failed";

/**
 * How long a `GalleryGrid` instance waits, once a click or `popstate`
 * predicts it is about to be replaced by a real navigation, before
 * concluding that navigation is not coming and reconciling its own state
 * itself. See the effect that schedules it, below, for the full reasoning.
 *
 * A fixed bound cannot distinguish "abandoned" from "genuinely still
 * pending" with certainty — no signal for that is available to a sibling
 * component here (`useLinkStatus` from `next/link` only observes its own
 * nearest ancestor `<Link>`, not an arbitrary other component's pending
 * transition). This value is a deliberately generous, chosen trade-off: long
 * enough that an ordinary App Router transition is most unlikely to still be
 * genuinely in flight once it elapses, short enough that a visitor stuck
 * behind a truly abandoned one is not stuck for long.
 */
export const STALE_RECOVERY_TIMEOUT_MS = 8000;

/** What a continuation attempt did, which decides where focus belongs after it. */
type ContinuationOutcome = {
  readonly appended: boolean;
  /** True once nothing follows, so the control is about to leave the document. */
  readonly complete: boolean;
};

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
  activeSection,
  labels,
}: GalleryGridProps) {
  const [slice, setSlice] = useState(initialSlice);
  const [state, setState] = useState<ContinuationState>("idle");
  const [pendingFocus, setPendingFocus] = useState<"control" | "completion" | null>(
    null,
  );
  const continueRef = useRef<HTMLAnchorElement | null>(null);
  const completionRef = useRef<HTMLParagraphElement | null>(null);
  // The request callback reads and advances the current slice synchronously.
  // React may render its state update later, but a second caller must already
  // see the new cursor and the append must throw inside the request's catch.
  const sliceRef = useRef(slice);
  // A second activation while one slice is in flight must not start another.
  const inFlightRef = useRef(false);
  // Selecting a different section remounts this component (a fresh
  // `initialSliceKey` in `ContentGallery`), but not synchronously: React keeps
  // this instance mounted and running until the new section's navigation
  // actually commits, so a continuation already in flight when that
  // navigation *starts* can still resolve into this, the outgoing, instance —
  // appending stale items and moving focus into a subtree about to be
  // replaced. Unmount is the trailing edge of that window, not the leading
  // one, so it is not by itself enough to satisfy "ignores stale in-flight
  // responses": the moment a visitor initiates any other navigation, a
  // capture-phase click listener marks this instance stale immediately,
  // before Next.js's own transition has even started fetching.
  const isStaleRef = useRef(false);
  // A genuine App Router transition to a new page — the case this marking
  // exists to protect — unmounts this instance well inside
  // `STALE_RECOVERY_TIMEOUT_MS`, at which point the timeout below is moot;
  // it only ever matters for a navigation that gets blocked, cancelled, or
  // fails, which otherwise leaves `isStaleRef.current` a one-way latch with
  // no route back to `false` short of a full page reload (see the two
  // checks below that read it).
  const staleRecoveryTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // What the most recent stale-dropped continuation attempt actually did,
  // preserved so the recovery timeout can apply it once abandonment is
  // confirmed. Without this, a response that resolves *before* the timeout
  // fires — the common case, since most fetches settle well under
  // `STALE_RECOVERY_TIMEOUT_MS` — would already have been dropped by the
  // checks in `loadNext` below, leaving nothing for the timeout to react to
  // and the control stuck regardless. `sliceRef.current` is always kept
  // current independent of staleness, so reconciling never needs to know
  // *which* attempt this was, only whether the most recent one succeeded or
  // failed.
  const pendingStaleOutcomeRef = useRef<"success" | "failed" | undefined>(undefined);
  useEffect(() => {
    isStaleRef.current = false;

    const markStale = () => {
      isStaleRef.current = true;
      // Each new marking gets its own full window: a second qualifying
      // event before the first one's timeout would have fired is still
      // evidence a departure is genuinely underway, not a reason to let
      // the earlier, shorter-lived timer clear the marking early.
      if (staleRecoveryTimeoutRef.current !== undefined) {
        clearTimeout(staleRecoveryTimeoutRef.current);
      }
      staleRecoveryTimeoutRef.current = setTimeout(() => {
        isStaleRef.current = false;
        const outcome = pendingStaleOutcomeRef.current;
        pendingStaleOutcomeRef.current = undefined;
        if (outcome === undefined) return;
        // `sliceRef.current` is the one cumulative truth regardless of how
        // many attempts happened while stale: an earlier attempt in this
        // same window may have succeeded and advanced it before a later one
        // failed, and that progress must not stay hidden just because the
        // *most recent* attempt is the one being reported. Only `state`
        // depends on which was most recent.
        setSlice(sliceRef.current);
        setState(outcome === "failed" ? "failed" : "idle");
        // Mirrors `onContinue`'s own post-success focus handling below,
        // which this reconciled attempt was unable to run at the time
        // because it was still (correctly, at that moment) considered
        // stale: focus stays on the control for as long as it exists, and
        // moves to the completion notice only once it doesn't.
        if (outcome === "success") {
          setPendingFocus(sliceRef.current.nextCursor === null ? "completion" : "control");
        }
      }, STALE_RECOVERY_TIMEOUT_MS);
    };

    const onDocumentClick = (event: MouseEvent) => {
      // Only a plain primary click actually leaves this page — the same
      // checks `onContinue` applies to its own link below. A modifier click
      // or a non-primary button opens a new tab or does nothing, and the
      // current instance is not going anywhere.
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      const link =
        target instanceof Element ? target.closest("a") : null;
      // The continuation control's own click is handled by `onContinue`
      // below. An explicit new-tab link (the section intro's external links)
      // leaves this tab exactly where it is, and a link back to this exact
      // URL — re-activating the already-selected section — causes no
      // navigation at all. Neither replaces this instance, so marking it
      // stale for either would suppress every future continuation update on
      // a gallery a visitor never actually left.
      if (
        link === null ||
        link === continueRef.current ||
        link.target === "_blank"
      ) {
        return;
      }

      const targetUrl = new URL(link.href, window.location.href);
      const currentUrl = new URL(window.location.href);
      if (
        targetUrl.pathname === currentUrl.pathname &&
        targetUrl.search === currentUrl.search
      ) {
        return;
      }

      markStale();
    };

    const onPopState = () => {
      markStale();
    };

    document.addEventListener("click", onDocumentClick, true);
    window.addEventListener("popstate", onPopState);
    return () => {
      isStaleRef.current = true;
      if (staleRecoveryTimeoutRef.current !== undefined) {
        clearTimeout(staleRecoveryTimeoutRef.current);
      }
      document.removeEventListener("click", onDocumentClick, true);
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  const statusId = useId();

  const { nextCursor } = slice;

  /**
   * Loads the next slice and appends it.
   *
   * Returns whether anything was appended, so a caller that needs to act on the
   * result — the lightbox, continuing past its last loaded slide — can wait for
   * this rather than watch state it does not own.
   */
  const loadNext = useCallback(async (): Promise<ContinuationOutcome> => {
    const cursor = sliceRef.current.nextCursor;
    if (inFlightRef.current || cursor === null) {
      return { appended: false, complete: cursor === null };
    }

    inFlightRef.current = true;
    setState("loading");

    try {
      const next = await fetchGallerySlice(galleryPath, cursor, activeSection);
      // Appending is what de-duplicates: a cursor names a boundary rather than
      // a set, so an overlapping slice is a legal answer and must not put the
      // same item on screen twice.
      const loaded = sliceRef.current;
      const merged = appendGallerySlice(loaded, next);
      sliceRef.current = merged;
      const outcome = {
        appended: merged.items.length > loaded.items.length,
        complete: merged.nextCursor === null,
      };
      if (!isStaleRef.current) {
        setSlice(merged);
        setState("idle");
      } else {
        pendingStaleOutcomeRef.current = "success";
      }
      return outcome;
    } catch {
      // The failure is announced and the control becomes a retry. Nothing that
      // was already loaded is discarded: a visitor keeps everything they had.
      if (!isStaleRef.current) {
        setState("failed");
      } else {
        pendingStaleOutcomeRef.current = "failed";
      }
      return { appended: false, complete: false };
    } finally {
      inFlightRef.current = false;
    }
  }, [galleryPath, activeSection]);

  /** The lightbox needs to know whether it grew or reached a clean end. */
  const continueForLightbox = useCallback(
    async () => {
      const outcome = await loadNext();
      // Reaching a duplicate-only final slice is still a successful end, even
      // though the viewer did not grow. A non-final slice that adds nothing
      // remains retryable, now from the cursor that response advanced to.
      return outcome.appended || outcome.complete;
    },
    [loadNext],
  );

  /**
   * Moves focus after the append has rendered.
   *
   * It has to wait for the render: on the last slice the control leaves the
   * document, and focusing it in the promise callback would either focus a
   * detached node or, once React had cleared the ref, nothing at all — which
   * drops the visitor to `document.body` in a gallery that just grew.
   */
  useEffect(() => {
    if (pendingFocus === null) return;

    if (pendingFocus === "completion") {
      completionRef.current?.focus();
    } else {
      continueRef.current?.focus();
    }
    setPendingFocus(null);
  }, [pendingFocus]);

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
      void loadNext().then((outcome) => {
        // Never on a stale instance: moving focus here after a visitor has
        // already clicked away to another section would pull it back into a
        // subtree on its way out, exactly the "steals focus" failure mode
        // the click listener above exists to prevent.
        if (isStaleRef.current) return;
        // Focus is predictable: it stays on the control a visitor activated for
        // as long as that control exists, and moves to the completion notice
        // only when the control itself goes away — never to the document body.
        setPendingFocus(outcome.complete ? "completion" : "control");
      });
    },
    [loadNext],
  );

  const isLoading = state === "loading";
  const hasFailed = state === "failed";

  return (
    <GalleryLightbox
      slides={slice.slides}
      labels={labels.lightbox}
      enquiryBasePath={galleryPath}
      {...(nextCursor === null
        ? {}
        : {
            continuation: {
              loadNext: continueForLightbox,
              failedLabel: labels.gallery.loadFailed,
              retryLabel: labels.gallery.retry,
            },
          })}
    >
      <ul
        aria-label={label}
        className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {slice.items.map((item, index) => {
          const { media } = item;

          return (
            <li key={item.itemId}>
              <figure className="rounded-sm bg-surface-muted">
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
                  <figcaption className="px-3 py-2 text-sm text-subtle">
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
              ? "text-sm text-body"
              : "text-sm text-subtle"
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
            href={galleryContinuationHref(galleryPath, nextCursor, activeSection)}
            rel="next"
            onClick={onContinue}
            aria-describedby={statusId}
            aria-busy={isLoading}
            // Not `disabled`: an anchor has no such state, and taking the href
            // away mid-flight would break the unenhanced path if script fails
            // between renders. The in-flight guard is what prevents a second
            // request.
            className="rounded-sm border border-border-control px-5 py-2.5 text-sm font-medium transition-colors hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
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
