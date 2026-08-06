import type { Metadata } from "next";
import { GalleryGrid } from "@/components/gallery-grid";
import { builtInLabels } from "@/lib/deployment-config";
import { getPortfolioGallery } from "@/lib/gallery";
import { getPageMetadata } from "@/lib/page-metadata";

/**
 * The gallery's own title and description describe this page better than the
 * built-in route label does, and its first curated item is the author's own
 * lead image — no separate social-image choice is invented for it.
 */
export async function generateMetadata(): Promise<Metadata> {
  const gallery = await getPortfolioGallery();

  return getPageMetadata({
    path: "/portfolio",
    title: gallery.title,
    description: gallery.description,
    image: gallery.result.items[0]?.media,
  });
}

export default async function PortfolioPage() {
  const gallery = await getPortfolioGallery();

  return (
    <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {gallery.title}
        </h1>
        {gallery.description && (
          <p className="mt-3 text-foreground/70">{gallery.description}</p>
        )}
      </header>

      <section
        aria-label={`${gallery.title} ${builtInLabels.gallery.images}`}
        className="mt-12"
      >
        <GalleryGrid gallery={gallery} />
      </section>
    </main>
  );
}
