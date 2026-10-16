"use client";

import { useEffect, useRef, useState } from "react";

import { requestPrivateGalleryClientAssetUrl } from "@/lib/private-gallery-asset-client";
import type { PrivateGalleryPreviewMintQueue } from "@/lib/private-gallery-preview-mint-queue";

type PreviewImageItem = {
  readonly itemId: string;
  readonly width: number;
  readonly height: number;
  readonly alt?: string;
};

export type PrivateGalleryPreviewImageLabels = {
  readonly loadingImage: string;
  readonly unavailableImage: string;
  readonly retryImage: string;
};

/** One complete private web derivative, minted only when its frame is visible. */
function PrivateGalleryPreviewImageInstance({
  item,
  assetPath,
  fallbackAlt,
  queue,
  labels,
}: {
  readonly item: PreviewImageItem;
  readonly assetPath: string;
  readonly fallbackAlt: string;
  readonly queue: PrivateGalleryPreviewMintQueue;
  readonly labels: PrivateGalleryPreviewImageLabels;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const autoRetried = useRef(false);
  const [visible, setVisible] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [url, setUrl] = useState<string>();
  const [status, setStatus] = useState<"waiting" | "loading" | "ready" | "failed">("waiting");

  useEffect(() => {
    const element = frame.current;
    if (element === null) return;
    if (typeof IntersectionObserver === "undefined") {
      const timer = setTimeout(() => setVisible(true), 0);
      return () => clearTimeout(timer);
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    let cancelled = false;
    queue.enqueue(controller.signal, () => requestPrivateGalleryClientAssetUrl(assetPath, { kind: "preview", placementId: item.itemId }, controller.signal, window.location.origin))
      .then((result) => {
        if (cancelled) return;
        setUrl(result.url);
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("failed");
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [assetPath, attempt, item.itemId, queue, visible]);

  function imageFailed() {
    setUrl(undefined);
    setStatus("loading");
    if (!autoRetried.current) {
      autoRetried.current = true;
      setAttempt((value) => value + 1);
    } else {
      setStatus("failed");
    }
  }

  function retry() {
    autoRetried.current = false;
    setStatus("loading");
    setUrl(undefined);
    setAttempt((value) => value + 1);
  }

  return (
    <div
      ref={frame}
      role="group"
      aria-label={item.alt ?? fallbackAlt}
      className="relative flex w-full items-center justify-center rounded-md border border-border-strong bg-surface"
      style={{ aspectRatio: `${item.width} / ${item.height}` }}
      data-item-id={item.itemId}
      data-aspect-width={item.width}
      data-aspect-height={item.height}
    >
      {url !== undefined && (
        // The private signed URL must bypass Next's public image optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={url}
          src={url}
          width={item.width}
          height={item.height}
          alt={item.alt ?? fallbackAlt}
          className="absolute inset-0 block h-full w-full object-contain"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setStatus("ready")}
          onError={imageFailed}
        />
      )}
      {status !== "ready" && status !== "failed" && (
        <span className="absolute inset-0 flex items-center justify-center px-3 text-center text-sm text-muted">{labels.loadingImage}</span>
      )}
      <span role="status" aria-live="polite" className="sr-only">
        {status === "failed" ? labels.unavailableImage : ""}
      </span>
      {status === "failed" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center text-sm text-muted">
          <span aria-hidden="true">{labels.unavailableImage}</span>
          <button
            type="button"
            onClick={retry}
            aria-label={`${labels.retryImage}: ${item.alt ?? fallbackAlt}`}
            className="rounded-md border border-border-strong px-3 py-1 text-strong"
          >
            {labels.retryImage}
          </button>
        </div>
      )}
    </div>
  );
}

/** Identity changes discard the previous URL, retry count and pending request. */
export function PrivateGalleryPreviewImage(props: {
  readonly item: PreviewImageItem;
  readonly assetPath: string;
  readonly fallbackAlt: string;
  readonly queue: PrivateGalleryPreviewMintQueue;
  readonly labels: PrivateGalleryPreviewImageLabels;
}) {
  return <PrivateGalleryPreviewImageInstance key={`${props.assetPath}:${props.item.itemId}`} {...props} />;
}
