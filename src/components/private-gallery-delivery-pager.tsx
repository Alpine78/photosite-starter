"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PrivateGalleryGrid } from "@/components/private-gallery-grid";
import type { BuiltInLabels } from "@/lib/deployment-config";
import type { PrivateGalleryDeliveryPage } from "@/lib/private-gallery-access";
import { PRIVATE_GALLERY_DEFAULT_MAX_PAGE_SIZE as PAGE_SIZE } from "@/lib/private-gallery-limits";
import { parsePrivateGalleryDeliveryResponse } from "@/lib/private-gallery-delivery-response";

const subscribe = () => () => {};
const hydratedSnapshot = () => true;
const serverSnapshot = () => false;

export function PrivateGalleryDeliveryPager({ initialView, readPath, assetPath, labels, pagingLabels }: {
  readonly initialView: PrivateGalleryDeliveryPage;
  readonly readPath: string;
  readonly assetPath: string;
  readonly labels: BuiltInLabels["privateGallery"];
  readonly pagingLabels: BuiltInLabels["privateGalleryDeliveryPaging"];
}) {
  const [view, setView] = useState(initialView);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const inFlight = useRef<AbortController | undefined>(undefined);
  const hydrated = useSyncExternalStore(subscribe, hydratedSnapshot, serverSnapshot);
  useEffect(() => () => { inFlight.current?.abort(); }, []);

  async function turn(pageIndex: number) {
    if (!hydrated || inFlight.current !== undefined || pageIndex < 0 ||
      (pageIndex > view.pageIndex && !view.hasNextPage)) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setPending(true);
    setNotice(pagingLabels.loading);
    try {
      const response = await fetch(`${readPath}?page=${pageIndex}`, {
        credentials: "same-origin", cache: "no-store", signal: controller.signal,
      });
      const next = response.status === 200 ? parsePrivateGalleryDeliveryResponse(await response.json(), pageIndex) : undefined;
      if (controller.signal.aborted) return;
      if (next === undefined) setNotice(pagingLabels.refused);
      else { setView(next); setNotice(""); }
    } catch {
      if (!controller.signal.aborted) setNotice(pagingLabels.refused);
    } finally {
      if (!controller.signal.aborted) { inFlight.current = undefined; setPending(false); }
    }
  }

  // Structural props allow the independently reviewed preview Grid to replace
  // the initial frame Grid without a second pager or a type assertion.
  const gridProps = { items: view.items, emptyLabel: labels.noPhotographs, assetPath, labels };
  const range = pagingLabels.range.replace("{from}", String(view.totalCount === 0 ? 0 : view.pageIndex * PAGE_SIZE + 1))
    .replace("{to}", String(view.pageIndex * PAGE_SIZE + view.items.length)).replace("{total}", String(view.totalCount));
  const buttonClass = "rounded-md border border-border-strong px-4 py-2 text-body focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus aria-disabled:opacity-50";
  return (
    <div>
      {initialView.totalCount > PAGE_SIZE && <div>
        {/* Controls stay above the grid and stay focusable at both boundaries. */}
        <nav aria-label={pagingLabels.navigation} className="mb-4 flex flex-wrap gap-3">
          <button type="button" className={buttonClass} aria-disabled={!hydrated || pending || view.pageIndex === 0}
            onClick={() => { if (view.pageIndex > 0) void turn(view.pageIndex - 1); }}>{pagingLabels.previousPage}</button>
          <button type="button" className={buttonClass} aria-disabled={!hydrated || pending || !view.hasNextPage}
            onClick={() => { if (view.hasNextPage) void turn(view.pageIndex + 1); }}>{pagingLabels.nextPage}</button>
        </nav>
        <p role="status" aria-live="polite" aria-atomic="true" className="mb-4 text-muted">{notice || range}</p>
        <noscript><p className="text-body">{pagingLabels.javascriptRequired}</p></noscript>
      </div>}
      <PrivateGalleryGrid {...gridProps} />
    </div>
  );
}
