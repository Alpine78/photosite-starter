import Link from "next/link";
import { Breadcrumbs, type BreadcrumbStep } from "@/components/breadcrumbs";
import { EnquiryForm } from "@/components/enquiry-form";
import type { BuiltInLabels } from "@/lib/deployment-config";
import { getSiteSettings } from "@/lib/site-settings";

/**
 * The `?enquire=<itemId>` view of a gallery route (AB#60, ADR-0003 §8's
 * 2026-08-30 amendment): a `noindex` form for asking about one photograph,
 * shown instead of the grid.
 *
 * `contentId` and `locale` come from the route the visitor is on — the browser
 * only ever carries the public `itemId` and the parameter-free gallery path.
 * The privacy notice is the deployment-authored one, read here the same way the
 * `/contact` page reads it. The item is authorized on submit by `/api/enquiry`;
 * this view does not read the gallery result, so it renders for any
 * syntactically valid `itemId` and is immune to a gallery being reordered.
 *
 * The link back, and the lightbox link that led here, both use the
 * parameter-free gallery path. An enquiry begun from a named section or a
 * continuation slice therefore returns to the gallery's first page; browser
 * Back restores the exact position. This is intentional — the enquiry view is a
 * clean action state about one item, not a slice of the gallery.
 */
export async function GalleryItemEnquiry({
  locale,
  contentId,
  itemId,
  galleryTitle,
  galleryPath,
  breadcrumbs,
  labels,
}: {
  locale: string;
  contentId: string;
  itemId: string;
  galleryTitle: string;
  galleryPath: string;
  breadcrumbs: readonly BreadcrumbStep[];
  labels: BuiltInLabels;
}) {
  const settings = await getSiteSettings();

  return (
    <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <Breadcrumbs label={labels.navigation.breadcrumb} steps={breadcrumbs} />

      <header className="mt-6 max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {labels.enquiry.pageTitle}
        </h1>
        <Link
          href={galleryPath}
          className="mt-4 inline-block text-sm underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {labels.enquiry.backToGallery}
        </Link>
      </header>

      <div className="mt-12">
        <EnquiryForm
          key={itemId}
          locale={locale}
          contentId={contentId}
          itemId={itemId}
          galleryTitle={galleryTitle}
          labels={labels}
          privacyNotice={settings.contact.privacyNotice}
        />
      </div>
    </main>
  );
}
