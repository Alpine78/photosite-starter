import { notFound } from "next/navigation";
import { GalleryLightbox, GalleryLightboxTrigger } from "@/components/gallery-lightbox";
import { getRestrictedPageLocale } from "@/lib/restricted-page-locale-request";
import { RestrictedPageLanguages } from "@/components/restricted-page-languages";
import { getBuiltInLabels } from "@/lib/deployment-config";
import { formatUtcDateTime } from "@/lib/date-format";
import { getClientGallery } from "@/lib/client-gallery-access";

export const dynamic = "force-dynamic";

export default async function ClientGalleryPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const locale = await getRestrictedPageLocale();
  const gallery = await getClientGallery(handle, locale);
  if (gallery === undefined) notFound();
  const labels = getBuiltInLabels(locale);
  const notice = gallery.kind === "legacy" ? labels.legacyGallery : labels.clientGallery;
  const deadline = gallery.kind === "web" ? gallery.availableUntil : undefined;
  const [beforeDate, afterDate] = labels.clientGallery.deadline.split("{date}");
  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <RestrictedPageLanguages pathname={`/client-gallery/${handle}`} locale={locale} />
      <h1 className="mb-6 text-2xl">{gallery.title || labels.legacyGallery.title}</h1>
      {deadline && <p className="mb-6 text-sm text-muted">{beforeDate}<time dateTime={deadline}>{formatUtcDateTime(deadline, locale)}</time>{afterDate}</p>}
      <section aria-labelledby="legacy-delivery-notice" className="mb-6 space-y-2 text-sm text-muted">
        <h2 id="legacy-delivery-notice" className="font-semibold">{notice.noticeTitle}</h2>
        <p>{notice.publicAccessNotice}</p>
        <p>{notice.fileRetentionNotice}</p>
      </section>
      {gallery.zipUrl && <a href={gallery.zipUrl} download="photographs.zip" className="mb-8 inline-block underline focus-visible:outline-2 focus-visible:outline-focus" referrerPolicy="no-referrer">{labels.legacyGallery.download}</a>}
      <GalleryLightbox slides={gallery.images} labels={labels.lightbox}>
        <ul className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {gallery.images.map((image, index) => <li key={image.itemId}>
            <GalleryLightboxTrigger itemId={image.itemId} index={index} label={image.alt || `${index + 1}`}>
              {/* Full-frame web copies; ADR-0028 also permits the retained original JPEGs. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.src} alt={image.alt} width={image.width} height={image.height} className="h-auto w-full" style={{ maxWidth: image.width }} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
            </GalleryLightboxTrigger>
          </li>)}
        </ul>
      </GalleryLightbox>
    </main>
  );
}
