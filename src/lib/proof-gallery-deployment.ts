import { readDeploymentStage } from "@/lib/deployment-stage";

/** The proof page reader (ADR-0038 action item 2): off unless configured, with the client gallery's constraints. */
export function readProofGalleryDeployment(environment: Readonly<Record<string, string | undefined>>): "off" | "fixture" | "sanity" {
  const adapter = environment.PROOF_GALLERY_ADAPTER?.trim() || "off";
  if (adapter === "off") return "off";
  const stage = readDeploymentStage(environment), platform = environment.VERCEL_ENV?.trim().toLowerCase();
  if (adapter === "fixture") {
    if (stage !== "development" || (platform && platform !== "development")) throw new Error("Proof gallery fixtures require local development");
    return "fixture";
  }
  if (adapter !== "sanity" || environment.SITE_CONTENT_SOURCE?.trim() !== "sanity" ||
    environment.SANITY_DATASET_VISIBILITY?.trim() !== "public" || stage === "preview" ||
    (platform && platform !== "production" && platform !== "development")) throw new Error("Invalid proof gallery adapter or deployment");
  return "sanity";
}
