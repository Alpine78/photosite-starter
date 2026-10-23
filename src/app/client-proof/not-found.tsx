import { getBuiltInLabels } from "@/lib/deployment-config";
import { getRestrictedPageLocale } from "@/lib/restricted-page-locale-request";

export default async function ProofGalleryNotFound() {
  const labels = getBuiltInLabels(await getRestrictedPageLocale());
  return <main className="mx-auto max-w-5xl px-4 py-12"><h1 className="text-2xl">{labels.proofGallery.unavailable}</h1></main>;
}
