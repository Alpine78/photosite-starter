import type { Metadata } from "next";
import { GalleryGrid } from "@/components/gallery-grid";
import { getPortfolioGallery } from "@/lib/gallery";

export const metadata: Metadata = {
  title: "Portfolio",
};

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

      <section aria-label={`${gallery.title} images`} className="mt-12">
        <GalleryGrid gallery={gallery} />
      </section>
    </main>
  );
}
