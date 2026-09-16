import Link from "next/link";
import { GalleryGrid } from "@/components/gallery-grid";
import { LanguageSwitch, type LanguageLink } from "@/components/language-switch";
import type { BuiltInLabels } from "@/lib/deployment-config";
import { DEFAULT_GALLERY_PRESENTATION } from "@/lib/gallery-presentation";
import type { GallerySlice } from "@/lib/gallery-slice";

type SharedProps = {
  readonly articlePath: string;
  readonly articleTitle: string;
  readonly slice: GallerySlice;
  readonly initialSliceKey: string;
  readonly labels: BuiltInLabels;
};

export function ArticleEndGallery({
  articlePath,
  articleTitle,
  slice,
  initialSliceKey,
  labels,
}: SharedProps) {
  return (
    <section
      aria-labelledby="article-end-gallery"
      className="mx-auto mt-12 max-w-6xl"
    >
      <h2 id="article-end-gallery" className="text-2xl font-semibold tracking-tight">
        {labels.article.endGallery}
      </h2>
      {slice.items.length === 0 ? (
        <p className="mt-6 text-muted">{labels.gallery.empty}</p>
      ) : (
        <div className="mt-6">
          <GalleryGrid
            key={initialSliceKey}
            label={`${articleTitle}: ${labels.article.endGallery}`}
            initialSlice={slice}
            galleryPath={articlePath}
            continuationKind="article-end-gallery"
            presentation={DEFAULT_GALLERY_PRESENTATION}
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
}: SharedProps & { readonly languages: readonly LanguageLink[] }) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
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
            presentation={DEFAULT_GALLERY_PRESENTATION}
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
