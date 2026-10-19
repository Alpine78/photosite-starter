"use client";
import { useCallback, useState } from "react";
import { GalleryGrid, type GalleryGridResult } from "@/components/gallery-grid";
import { GallerySectionControls } from "@/components/gallery-section-controls";
import type { BuiltInLabels } from "@/lib/deployment-config";
import type { GallerySectionSummary } from "@/lib/gallery-sections";
import type { GalleryPresentation } from "@/lib/gallery-presentation";
import type { GallerySlice } from "@/lib/gallery-slice";
export function ArticleEndGalleryPanel({
  articlePath,
  articleTitle,
  slice,
  initialSliceKey,
  labels,
  presentation,
  sections,
  heading,
  activeSection,
  carriedQuery = {},
  isContinuation = false,
}: {
  readonly articlePath: string;
  readonly articleTitle: string;
  readonly slice: GallerySlice;
  readonly initialSliceKey: string;
  readonly labels: BuiltInLabels;
  readonly presentation: GalleryPresentation;
  readonly sections: readonly GallerySectionSummary[];
  readonly heading: string;
  readonly activeSection?: string;
  readonly carriedQuery?: Readonly<
    Record<string, string | readonly string[] | undefined>
  >;
  readonly isContinuation?: boolean;
}) {
  const [reported, setReported] = useState<{
    key: string;
    result: GalleryGridResult;
  }>();
  const receive = useCallback(
    (result: GalleryGridResult) =>
      setReported({ key: initialSliceKey, result }),
    [initialSliceKey],
  );
  const result: GalleryGridResult =
    reported?.key === initialSliceKey
      ? reported.result
      : {
          count: slice.items.length,
          hasMore: slice.nextCursor !== null,
          state: "idle",
        };
  const selectedSection = sections.find((section) => section.slug === activeSection);
  const selected = selectedSection?.label ?? labels.gallery.allSections;
  const resultLabels = selectedSection ? {
    ...labels,
    gallery: {
      ...labels.gallery,
      empty: labels.gallery.emptySection,
      allLoaded: labels.gallery.sectionAllLoaded,
    },
  } : labels;
  const summary = [
    selected,
    result.count === 0
      ? resultLabels.gallery.empty
      : labels.gallery.loadedSummary.replace("{count}", String(result.count)),
    result.state === "loading"
      ? labels.gallery.loadingMore
      : result.state === "failed"
        ? labels.gallery.loadFailed
        : result.hasMore
          ? labels.gallery.moreAvailable
          : resultLabels.gallery.allLoaded,
  ].map((sentence) => /[.!?…]$/u.test(sentence) ? sentence : `${sentence}.`).join(" ");
  return (
    <>
      <GallerySectionControls
        sections={sections}
        activeSlug={activeSection}
        galleryPath={articlePath}
        labels={labels}
        resultSummary={summary}
        articleContext={{ heading, carriedQuery, isContinuation }}
      />
      {slice.items.length > 0 && (
        <div className="mt-6">
          <GalleryGrid
            key={initialSliceKey}
            label={`${articleTitle}: ${labels.article.endGallery}`}
            initialSlice={slice}
            galleryPath={articlePath}
            activeSection={activeSection}
            continuationKind="article-end-gallery"
            presentation={presentation}
            labels={resultLabels}
            onResultChange={receive}
          />
        </div>
      )}
    </>
  );
}
