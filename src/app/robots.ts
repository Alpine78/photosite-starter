import type { MetadataRoute } from "next";

import { getDeploymentConfig } from "@/lib/deployment-config";
import { readDeploymentStage } from "@/lib/deployment-stage";
import { buildRobotsPolicy } from "@/lib/robots";

export default function robots(): MetadataRoute.Robots {
  const { canonicalBaseUrl } = getDeploymentConfig();
  return buildRobotsPolicy(readDeploymentStage(process.env), canonicalBaseUrl);
}
