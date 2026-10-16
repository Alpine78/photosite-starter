"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { requestPrivateGalleryClientAssetUrl } from "@/lib/private-gallery-asset-client";

const subscribeNever = () => () => {};
const isClient = () => true;
const isServer = () => false;

/** Explicit click-time authorization, followed by a native whole-object download. */
export function PrivateGalleryZipDownload({ assetPath, labels }: {
  readonly assetPath: string;
  readonly labels: {
    readonly downloadZip: string;
    readonly downloadPreparing: string;
    readonly downloadRequested: string;
    readonly downloadUnavailable: string;
  };
}) {
  const hydrated = useSyncExternalStore(subscribeNever, isClient, isServer);
  const pending = useRef<AbortController | undefined>(undefined);
  const cooldown = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [status, setStatus] = useState<"idle" | "pending" | "requested" | "failed">("idle");
  const [coolingDown, setCoolingDown] = useState(false);

  useEffect(() => () => {
    pending.current?.abort();
    if (cooldown.current !== undefined) clearTimeout(cooldown.current);
  }, [assetPath]);

  async function download() {
    if (pending.current !== undefined || cooldown.current !== undefined) return;
    const controller = new AbortController();
    pending.current = controller;
    setStatus("pending");
    try {
      const result = await requestPrivateGalleryClientAssetUrl(assetPath, { kind: "zip" }, controller.signal, window.location.origin);
      if (controller.signal.aborted) return;
      // The signed response-content-disposition=attachment is authoritative
      // across origins. Object bytes never pass through fetch, blobs or Next.
      const anchor = document.createElement("a");
      anchor.href = result.url;
      anchor.rel = "noreferrer";
      anchor.referrerPolicy = "no-referrer";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setStatus("requested");
      setCoolingDown(true);
      // A very fast mint must not turn an accidental double-click into two
      // multi-GB downloads. Later deliberate requests always reauthorize.
      cooldown.current = setTimeout(() => {
        cooldown.current = undefined;
        setCoolingDown(false);
      }, 3000);
    } catch {
      if (!controller.signal.aborted) setStatus("failed");
    } finally {
      if (pending.current === controller) pending.current = undefined;
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={download}
        disabled={!hydrated || status === "pending" || coolingDown}
        aria-busy={status === "pending"}
        className="rounded-md border border-border-strong px-4 py-2 font-medium text-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
      >
        {labels.downloadZip}
      </button>
      <p role="status" aria-live="polite" className="text-sm text-muted">
        {status === "pending" ? labels.downloadPreparing
          : status === "requested" ? labels.downloadRequested
          : status === "failed" ? labels.downloadUnavailable : ""}
      </p>
    </div>
  );
}
