"use client";

import { useEffect, useRef, useState } from "react";

import { PrivateGalleryPreviewMintQueue } from "@/lib/private-gallery-preview-mint-queue";

type ProofImageItem = {
  readonly itemId: string;
  readonly width: number;
  readonly height: number;
  readonly alt?: string;
  readonly reference: string;
  readonly filename: string;
};

type ProofImageLabels = {
  readonly loadingImage: string;
  readonly unavailableImage: string;
  readonly retryImage: string;
};

type MintResult = { readonly url: string };

async function mintPreview(
  assetPath: string,
  placementId: string,
  signal: AbortSignal,
): Promise<MintResult> {
  const response = await fetch(assetPath, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ kind: "preview", placementId }),
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("preview-unavailable");
  const body = (await response.json()) as unknown;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("preview-unavailable");
  }
  const result = body as Record<string, unknown>;
  if (result.ok !== true || typeof result.url !== "string" ||
      typeof result.expiresAt !== "string" || Date.parse(result.expiresAt) <= Date.now()) {
    throw new Error("preview-unavailable");
  }
  let parsed: URL;
  try {
    parsed = new URL(result.url);
  } catch {
    throw new Error("preview-unavailable");
  }
  // The configured CSP img-src is the enforcement boundary. This rejects an
  // obviously unusable scheme early; local HTTP is for the test/dev origin only.
  if (
    parsed.username !== "" || parsed.password !== "" ||
    (parsed.protocol !== "https:" &&
      !(parsed.protocol === "http:" && parsed.origin === window.location.origin))
  ) throw new Error("preview-unavailable");
  return { url: parsed.href };
}

/** One native-ratio watermarked proof, minted only when its frame is visible. */
export function PrivateGalleryProofImage({
  item,
  assetPath,
  queue,
  labels,
}: {
  readonly item: ProofImageItem;
  readonly assetPath: string;
  readonly queue: PrivateGalleryPreviewMintQueue;
  readonly labels: ProofImageLabels;
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
    queue.enqueue(controller.signal, () => mintPreview(assetPath, item.itemId, controller.signal))
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
      className="relative flex w-full items-center justify-center overflow-hidden rounded-md border border-border-strong bg-surface"
      style={{ aspectRatio: `${item.width} / ${item.height}` }}
      data-item-id={item.itemId}
      data-aspect-width={item.width}
      data-aspect-height={item.height}
    >
      {url !== undefined && (
        // The private signed URL must bypass Next's public image optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          width={item.width}
          height={item.height}
          alt={item.alt ?? `${item.reference} — ${item.filename}`}
          className="block h-auto w-full object-contain"
          decoding="async"
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={() => setStatus("ready")}
          onError={imageFailed}
        />
      )}
      {status !== "ready" && status !== "failed" && (
        <span className="absolute inset-0 flex items-center justify-center px-3 text-center text-sm text-muted">{labels.loadingImage}</span>
      )}
      {status === "failed" && (
        <div role="status" className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center text-sm text-muted">
          <span>{labels.unavailableImage}</span>
          <button
            type="button"
            onClick={retry}
            className="rounded-md border border-border-strong px-3 py-1 text-strong"
          >
            {labels.retryImage}
          </button>
        </div>
      )}
    </div>
  );
}
