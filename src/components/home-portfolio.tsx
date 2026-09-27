"use client";

import Link from "next/link";
import { GalleryLightbox } from "@/components/gallery-lightbox";
import { GalleryMasonryList } from "@/components/gallery-masonry-list";
import type { BuiltInLabels } from "@/lib/deployment-config";
import type { CuratedGalleryPage, GallerySectionSummary } from "@/lib/gallery-sections";
import type { GallerySlice } from "@/lib/gallery-slice";

type HomePortfolioProps = {
  readonly galleryPath: string;
  readonly sections: readonly GallerySectionSummary[];
  readonly activeSlug?: string;
  readonly topicCounts?: CuratedGalleryPage["topicCounts"];
  readonly slice: GallerySlice;
  readonly locale: string;
  readonly labels: BuiltInLabels;
};

/** A bounded, full-frame preview of the configured gallery, filtered in place by real links. */
export function HomePortfolio({
  galleryPath,
  sections,
  activeSlug,
  topicCounts,
  slice,
  locale,
  labels,
}: HomePortfolioProps) {
  const fullGalleryHref = activeSlug
    ? galleryPath + "?section=" + encodeURIComponent(activeSlug)
    : galleryPath;
  const topics = [
    { id: "all", label: labels.gallery.allSections, href: "/#home-portfolio", count: topicCounts?.all, active: activeSlug === undefined },
    ...sections.map((section) => ({
      id: section.sectionId,
      label: section.label,
      href: "/?topic=" + encodeURIComponent(section.slug) + "#home-portfolio",
      count: topicCounts?.sections[section.sectionId],
      active: activeSlug === section.slug,
    })),
  ];
  const number = new Intl.NumberFormat(locale);

  return (
    <section id="home-portfolio" aria-labelledby="home-portfolio-heading" className="scroll-mt-8 border-t border-border py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted">{labels.pages.portfolio}</p>
            <h2 id="home-portfolio-heading" className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              {labels.homePortfolio.heading}
            </h2>
          </div>
          {sections.length > 0 && (
            <nav aria-label={labels.homePortfolio.topicsNav}>
              <ul className="flex flex-wrap gap-2">
                {topics.map((topic) => (
                  <li key={topic.id} className="min-w-0 max-w-full">
                    <Link
                      href={topic.href}
                      prefetch={false}
                      aria-current={topic.active ? "true" : undefined}
                      className={
                        "inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border px-4 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
                        (topic.active
                          ? "border-accent bg-accent font-semibold text-accent-foreground underline underline-offset-4"
                          : "border-border-control text-body hover:border-border-strong")
                      }
                    >
                      <span className="min-w-0 wrap-anywhere">{topic.label}</span>
                      {topic.count !== undefined && (
                        <>
                          <span aria-hidden="true" className="tabular-nums">{number.format(topic.count)}</span>
                          <span className="sr-only">
                            {number.format(topic.count)} {topic.count === 1 ? labels.gallery.photoSingular : labels.gallery.photoPlural}
                          </span>
                        </>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </div>
        {slice.items.length === 0 ? (
          <p className="text-muted">{labels.gallery.empty}</p>
        ) : (
          <GalleryLightbox slides={slice.slides} labels={labels.lightbox} enquiryBasePath={galleryPath}>
            <GalleryMasonryList
              label={labels.homePortfolio.heading}
              items={slice.items}
              captionPlacement="below"
              compactCaptions
              labels={labels}
            />
          </GalleryLightbox>
        )}
        <Link href={fullGalleryHref} prefetch={false} className="mt-6 inline-block text-sm font-medium underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
          {labels.homePortfolio.viewAll}
        </Link>
      </div>
    </section>
  );
}
