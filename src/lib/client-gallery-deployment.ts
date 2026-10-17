import { readDeploymentStage } from "@/lib/deployment-stage";

export function readClientGalleryDeployment(environment: Readonly<Record<string, string | undefined>>): "off" | "fixture" | "sanity" {
  const adapter = environment.CLIENT_GALLERY_ADAPTER?.trim() || "off";
  if (adapter === "off") return "off";
  const stage = readDeploymentStage(environment), platform = environment.VERCEL_ENV?.trim().toLowerCase();
  if (adapter === "fixture") {
    if (stage !== "development" || (platform && platform !== "development")) throw new Error("Client gallery fixtures require local development");
    return "fixture";
  }
  if (adapter !== "sanity" || environment.SITE_CONTENT_SOURCE?.trim() !== "sanity" ||
    environment.SANITY_DATASET_VISIBILITY?.trim() !== "public" || stage === "preview" ||
    (platform && platform !== "production" && platform !== "development")) throw new Error("Invalid client gallery adapter or deployment");
  return "sanity";
}
