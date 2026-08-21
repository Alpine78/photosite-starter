/**
 * Crawl guidance only — never access control (see `src/app/robots.ts`). A
 * Preview deployment's actual protection is the platform's own access
 * control plus its `X-Robots-Tag: noindex` header (`docs/deployment.md`);
 * disallowing everything for a non-production stage here is defense in depth
 * for a well-behaved crawler, not the thing keeping a Preview URL out of an
 * index.
 */

import type { MetadataRoute } from "next";

import type { DeploymentStage } from "@/lib/deployment-stage";

export function buildRobotsPolicy(
  stage: DeploymentStage,
  canonicalBaseUrl: URL,
): MetadataRoute.Robots {
  if (stage !== "production") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: new URL("/sitemap.xml", canonicalBaseUrl).toString(),
  };
}
