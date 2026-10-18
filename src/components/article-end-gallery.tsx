import Link from "next/link";
import { GalleryGrid } from "@/components/gallery-grid";
import { LanguageSwitch, type LanguageLink } from "@/components/language-switch";
import type { BuiltInLabels } from "@/lib/deployment-config";
import type { GalleryPresentation } from "@/lib/gallery-presentation";
import type { GallerySlice } from "@/lib/gallery-slice";

type SharedProps = {
  readonly articlePath: string;
  readonly articleTitle: string;
  readonly slice: GallerySlice;
  readonly initialSliceKey: string;
  readonly labels: BuiltInLabels;
  readonly presentation: GalleryPresentation;
};

export function ArticleEndGallery({
  articlePath,
  articleTitle,
  slice,
  initialSliceKey,
  labels,
  presentation,
  headingId,
}: SharedProps & {
  /** An existing terminal body heading names this region instead of a generated h2. */
  readonly headingId?: string;
}) {
  return (
    <section
      id={headingId === undefined ? undefined : "article-end-gallery"}
      aria-labelledby={headingId ?? "article-end-gallery"}
      data-article-end-gallery=""
      className={`mx-auto max-w-6xl ${headingId === undefined ? "mt-12" : "mt-6"}`}
    >
      {headingId === undefined && (
        <h2 id="article-end-gallery" className="text-2xl font-semibold tracking-tight">
          {labels.article.endGallery}
        </h2>
      )}
      {slice.items.length === 0 ? (
        <p className="mt-6 text-muted">{labels.gallery.empty}</p>
      ) : (
        <div className={headingId === undefined ? "mt-6" : undefined}>
          <GalleryGrid
            key={initialSliceKey}
            label={`${articleTitle}: ${labels.article.endGallery}`}
            initialSlice={slice}
            galleryPath={articlePath}
            continuationKind="article-end-gallery"
            presentation={presentation}
            labels={labels}
          />
        </div>
      )}
    </section>
  );
}

export function ArticleEndGalleryContinuation({
  articlePath,
  articleTitle,
  slice,
  initialSliceKey,
  languages,
  labels,
  presentation,
}: SharedProps & { readonly languages: readonly LanguageLink[] }) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-16 wrap-anywhere sm:px-6 [&_table]:wrap-normal">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        {articleTitle} — {labels.gallery.continued}
      </h1>
      <LanguageSwitch label={labels.contentTree.languages} links={languages} />
      <section aria-label={`${articleTitle}: ${labels.article.endGallery}`} className="mt-10">
        {slice.items.length === 0 ? (
          <p className="text-muted">{labels.gallery.empty}</p>
        ) : (
          <GalleryGrid
            key={initialSliceKey}
            label={`${articleTitle}: ${labels.article.endGallery}`}
            initialSlice={slice}
            galleryPath={articlePath}
            continuationKind="article-end-gallery"
            presentation={presentation}
            labels={labels}
          />
        )}
      </section>
      <p className="mt-8 flex justify-center">
        <Link
          href={articlePath}
          className="text-sm text-muted underline underline-offset-4 transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {labels.article.backToArticle}
        </Link>
      </p>
    </main>
  );
}
