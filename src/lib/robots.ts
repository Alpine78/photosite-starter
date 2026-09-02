/**
 * Crawl guidance only — never access control (see `src/app/robots.ts`). A
 * Preview deployment's actual protection is the platform's own access
 * control plus its `X-Robots-Tag: noindex` header (`docs/deployment.md`);
 * disallowing everything for a non-production stage here is defense in depth
 * for a well-behaved crawler, not the thing keeping a Preview URL out of an
 * index.
 *
 * The private client-gallery namespace (`privateRoutePrefix`, ADR-0014 §6) and
 * the administrator namespace (`adminRoutePrefix`, ADR-0015 §1) are both
 * `Disallow`ed in production as further defense in depth — the real control is
 * the per-request authorization a later slice adds, plus the Proxy's
 * `X-Robots-Tag: noindex` on every response in either namespace. A
 * non-production stage already disallows `/`, which covers them.
 *
 * Each entry keeps its trailing slash deliberately. A robots.txt `Disallow` is
 * a prefix match, so the slash-free form would also claim any *unrelated* root
 * path that merely starts with the same letters — `/private-gallery-bootstrap.js`
 * is a real one. The namespace root itself (`/<prefix>`) is therefore not
 * covered here, which costs nothing: it answers with `X-Robots-Tag: noindex,
 * nofollow` like every other path in the namespace, and that is the header a
 * crawler must honour to leave it out of an index.
 */

import type { MetadataRoute } from "next";

import type { DeploymentStage } from "@/lib/deployment-stage";

export function buildRobotsPolicy(
  stage: DeploymentStage,
  canonicalBaseUrl: URL,
  privateRoutePrefix: string,
  adminRoutePrefix: string,
): MetadataRoute.Robots {
  if (stage !== "production") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [`/${privateRoutePrefix}/`, `/${adminRoutePrefix}/`],
    },
    sitemap: new URL("/sitemap.xml", canonicalBaseUrl).toString(),
  };
}
