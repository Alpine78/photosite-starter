import { getBuiltInLabels, getDeploymentConfig } from "@/lib/deployment-config";

export default function LegacyGalleryNotFound() {
  const labels = getBuiltInLabels(getDeploymentConfig().localeRoutes.defaultLocale);
  return <main className="mx-auto max-w-5xl px-4 py-12"><h1 className="text-2xl">{labels.legacyGallery.unavailable}</h1></main>;
}
