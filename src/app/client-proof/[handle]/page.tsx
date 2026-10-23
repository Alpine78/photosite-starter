import { notFound, redirect } from "next/navigation";
import { GalleryLightbox, GalleryLightboxTrigger } from "@/components/gallery-lightbox";
import { getRestrictedPageLocale } from "@/lib/restricted-page-locale-request";
import { RestrictedPageLanguages } from "@/components/restricted-page-languages";
import { getBuiltInLabels, getDeploymentConfig } from "@/lib/deployment-config";
import { formatUtcDateTime } from "@/lib/date-format";
import { getProofGallery } from "@/lib/proof-gallery-access";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

/**
 * The delivery page that replaces the proofs, keeping only an explicitly
 * requested configured locale. The empty fragment stops the browser carrying
 * the proof link's `#select=` key over to a delivery URL that may be forwarded.
 */
function deliveryPath(handle: string, search: Search): string {
  const requested = search.locale;
  const locale = typeof requested === "string" && getDeploymentConfig().localeRoutes.locales.some((route) => route.locale === requested) ? requested : undefined;
  return `/client-gallery/${handle}${locale ? `?${new URLSearchParams({ locale })}` : ""}#`;
}

/**
 * The read-only proof page (ADR-0038 action item 2): complete, uncropped
 * proofs with their permanent numbers, or a temporary redirect to the delivery
 * gallery that replaces them (owner answer 5). The selection link's fragment is
 * not read here; selecting arrives with the write path.
 */
export default async function ProofGalleryPage({ params, searchParams }: { params: Promise<{ handle: string }>; searchParams: Promise<Search> }) {
  const { handle } = await params;
  const locale = await getRestrictedPageLocale();
  const outcome = await getProofGallery(handle, locale);
  if (outcome === undefined) notFound();
  if (outcome.kind === "replaced") redirect(deliveryPath(outcome.deliveryHandle, await searchParams));
  const gallery = outcome.view;
  const labels = getBuiltInLabels(locale), copy = labels.proofGallery;
  const [beforeDate, afterDate] = copy.deadline.split("{date}");
  const slides = gallery.images.map(({ reference, ...image }) => {
    const label = copy.reference.replace("{reference}", reference);
    // The number is the caption, so the lightbox shows the same permanent reference as the grid.
    return { ...image, alt: image.alt || label, caption: label };
  });
  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <RestrictedPageLanguages pathname={`/client-proof/${handle}`} locale={locale} />
      <h1 className="mb-6 text-2xl">{gallery.title || copy.title}</h1>
      {gallery.availableUntil && <p className="mb-6 text-sm text-muted">{beforeDate}<time dateTime={gallery.availableUntil}>{formatUtcDateTime(gallery.availableUntil, locale)}</time>{afterDate}</p>}
      <section aria-labelledby="proof-gallery-notice" className="mb-6 space-y-2 text-sm text-muted">
        <h2 id="proof-gallery-notice" className="font-semibold">{copy.noticeTitle}</h2>
        <p>{copy.selectionNotice}</p>
        <p>{copy.publicAccessNotice}</p>
        <p>{copy.fileRetentionNotice}</p>
      </section>
      <GalleryLightbox slides={slides} labels={labels.lightbox}>
        <ul className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {slides.map((image, index) => <li key={image.itemId}>
            <figure>
              <GalleryLightboxTrigger itemId={image.itemId} index={index}>
                {/* Full-frame watermarked web proofs at their true dimensions; never cropped. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.src} alt={image.alt} width={image.width} height={image.height} className="h-auto w-full" style={{ maxWidth: image.width }} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
              </GalleryLightboxTrigger>
              <figcaption className="mt-2 text-sm font-semibold tabular-nums">{image.caption}</figcaption>
            </figure>
          </li>)}
        </ul>
      </GalleryLightbox>
    </main>
  );
}
