import { notFound } from "next/navigation";
import { GalleryLightbox, GalleryLightboxTrigger } from "@/components/gallery-lightbox";
import { getBuiltInLabels, getDeploymentConfig } from "@/lib/deployment-config";
import { getLegacyGallery } from "@/lib/legacy-gallery-access";

export const dynamic = "force-dynamic";

export default async function LegacyGalleryPage({ params }: { params: Promise<{ handle: string }> }) {
  const gallery = await getLegacyGallery((await params).handle);
  if (gallery === undefined) notFound();
  const labels = getBuiltInLabels(getDeploymentConfig().localeRoutes.defaultLocale);
  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="mb-6 text-2xl">{gallery.title || labels.legacyGallery.title}</h1>
      {gallery.zipUrl && <a href={gallery.zipUrl} className="mb-8 inline-block underline focus-visible:outline-2 focus-visible:outline-focus" referrerPolicy="no-referrer">{labels.legacyGallery.download}</a>}
      <GalleryLightbox slides={gallery.images} labels={labels.lightbox}>
        <ul className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {gallery.images.map((image, index) => <li key={image.itemId}>
            <GalleryLightboxTrigger itemId={image.itemId} index={index} label={image.alt || `${index + 1}`}>
              {/* ADR-0028: unchanged source bytes, full frame; never the public optimizer. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.src} alt={image.alt} width={image.width} height={image.height} className="h-auto w-full" style={{ maxWidth: image.width }} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
            </GalleryLightboxTrigger>
          </li>)}
        </ul>
      </GalleryLightbox>
    </main>
  );
}
