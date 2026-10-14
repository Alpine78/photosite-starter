"use client";

import Image from "next/image";
import { useId, useState, useSyncExternalStore } from "react";
import {
  canOverlayComparison,
  type ImageComparisonBlock,
} from "@/lib/content-image-comparison";
import type { BuiltInLabels } from "@/lib/deployment-config";
import styles from "./content-image-comparison.module.css";

const subscribeToNothing = () => () => {};

/** Native range interaction; server output always contains both full images. */
type ContentImageComparisonProps = {
  block: ImageComparisonBlock;
  labels: BuiltInLabels["imageComparison"];
  name: string;
  sizes: string;
};

export function ContentImageComparison({
  block, labels, name, sizes,
}: ContentImageComparisonProps) {
  const id = useId();
  const hydrated = useSyncExternalStore(subscribeToNothing, () => true, () => false);
  const [position, setPosition] = useState(50);
  const [complete, setComplete] = useState(false);
  const [loaded, setLoaded] = useState<readonly boolean[]>([false, false]);
  const [failed, setFailed] = useState(false);
  const compatible = canOverlayComparison(block);
  const ready = hydrated && compatible && loaded.every(Boolean) && !failed;
  const reveal = ready && !complete;
  const sides = [
    { image: block.first, label: block.firstLabel },
    { image: block.second, label: block.secondLabel },
  ];

  return (
    <section role="region" aria-label={name} className="space-y-3">
      {block.title && <p className="font-semibold text-foreground">{block.title}</p>}
      <div
        className={reveal ? "grid gap-y-2 px-6" : "space-y-4"}
        style={reveal ? { maxWidth: Math.min(block.first.rendition.width, block.second.rendition.width) + 48 } : undefined}
        data-comparison-view={reveal ? "reveal" : "complete"}
      >
        {sides.map(({ image, label }, side) => (
          <figure key={side} className={reveal ? "contents" : "space-y-2"}>
            <Image
              src={image.rendition.src}
              alt={image.alt}
              width={image.rendition.width}
              height={image.rendition.height}
              sizes={sizes}
              aria-describedby={`${id}-side-${side}`}
              className="h-auto w-full"
              style={{
                maxWidth: image.rendition.width,
                ...(reveal ? { gridArea: "1 / 1", ...(side === 1 ? { clipPath: `inset(0 0 0 ${position}%)` } : {}) } : {}),
              }}
              onLoad={() => setLoaded((current) => current.map((value, index) => index === side ? true : value))}
              onError={() => setFailed(true)}
            />
            <figcaption id={`${id}-side-${side}`} className="text-sm text-muted" style={reveal ? { gridArea: `${side + 2} / 1` } : undefined}>
              <span className="font-semibold text-foreground">{label}</span>
              {image.caption && <span> — {image.caption}</span>}
              {image.credit && <span> — {image.credit}</span>}
            </figcaption>
          </figure>
        ))}
        {reveal && (
          <div className="relative" style={{ gridArea: "1 / 1" }}>
            <span
              aria-hidden="true"
              className={styles.divider}
              style={{ left: `${position}%` }}
            />
            <label htmlFor={`${id}-position`} className="sr-only">{labels.position}</label>
            <input
              id={`${id}-position`}
              type="range"
              min={0}
              max={100}
              step={1}
              value={position}
              onChange={(event) => setPosition(Number(event.target.value))}
              aria-valuetext={`${block.firstLabel} ${position}%, ${block.secondLabel} ${100 - position}%`}
              className={styles.slider}
            />
            <span
              aria-hidden="true"
              data-comparison-handle
              className={styles.handle}
              style={{ left: `${position}%` }}
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
                <path d="M9 6 3 12l6 6V6Zm6 0v12l6-6-6-6Z" />
              </svg>
            </span>
          </div>
        )}
      </div>
      {ready && (
        <div className="space-y-2">
          <button
            type="button"
            aria-pressed={complete}
            onClick={() => setComplete((value) => !value)}
            className="min-h-11 rounded-md border border-border-control px-3 py-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {labels.showComplete}
          </button>
        </div>
      )}
      {failed && <p role="status" className="text-sm text-muted">{labels.unavailable}</p>}
    </section>
  );
}
