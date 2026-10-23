import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("requires an explicit maintenance-coverage review for new route handlers or metadata", () => {
  const entries = readdirSync(resolve("src/app"), { recursive: true }).map((entry) => String(entry).replaceAll("\\", "/"));
  expect(entries.filter((entry) => /\/route\.(ts|js)$/.test(entry)).sort()).toEqual([
    "api/article-gallery/route.ts", "api/contact/route.ts", "api/enquiry/route.ts",
    "api/gallery/route.ts", "api/poll-vote/route.ts", "api/proof-gallery/publish/route.ts", "api/proof-reminders/route.ts", "api/proof-selection/route.ts", "api/revalidate/route.ts",
    "api/search/route.ts", "api/site-maintenance/route.ts", "favicon.ico/route.ts",
    "private-gallery-admin/delivery/route.ts", "private-gallery-admin/login/route.ts",
    "private-gallery-admin/logout/route.ts", "private-gallery-admin/proof/[handle]/route.ts",
    "private-gallery-admin/proof/route.ts", "private-gallery/[handle]/asset/route.ts",
    "private-gallery/[handle]/exchange/route.ts", "private-gallery/[handle]/items/route.ts",
    "private-gallery/[handle]/proof/route.ts",
  ].sort());
  // Some metadata uses a file-shaped URL and can be served before afterFiles.
  // A new one must be classified by the early gate, even when prerendered.
  expect(entries.filter((entry) => /(^|\/)(robots|sitemap|manifest|favicon|icon|apple-icon|opengraph-image|twitter-image)\.[^/]+$/.test(entry)).sort()).toEqual([
    "favicon.ico", "robots.ts", "sitemap.ts",
  ]);
});
