import type { Page } from "@playwright/test";
import {
  buildContentTree,
  getCanonicalContentPath,
  listPublicRoutePaths,
} from "../src/lib/content-tree";
import { getBuiltInLabels } from "@/lib/deployment-config";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { getServices, type Service } from "../src/lib/services";
import {
  appUnderTestEnvironment,
  DEFAULT_STORY_NAMESPACE,
} from "./support/harness-environment";
import { expect, test } from "./support/fixtures";

/**
 * Structured data wiring (AB#86): the JSON-LD that each supported route emits,
 * and the absence of any on the routes that must not.
 *
 * The builders themselves are unit-tested (`src/lib/structured-data.test.ts`),
 * including the `</script>` escaping. What only a rendered page can prove is the
 * wiring: that the supported route actually renders a `<JsonLd>` block, that an
 * unsupported one does not, and that the payload survives a real render as
 * valid JSON. Nothing here asserts a site name, a service name, or a title as a
 * literal — a clone replaces all of it — so expected values come from the same
 * adapter the harness serves.
 */

const STORY_ROOT = `/${DEFAULT_STORY_NAMESPACE}`;
const SERVICES_PATH = "/services";
const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
const galleryLabels = getBuiltInLabels(
  appUnderTestEnvironment.SITE_LOCALE,
).gallery;

function defaultTree() {
  const treeInput = mockContentTreeInputs[language];
  if (treeInput === undefined) {
    throw new Error(`[e2e] The default locale ${language} publishes no mock tree.`);
  }
  return buildContentTree(treeInput);
}

function canonicalPathOf(contentId: string): string {
  const path = getCanonicalContentPath(defaultTree(), contentId);
  if (path === null) {
    throw new Error(`[e2e] ${contentId} has no canonical route in ${language}.`);
  }
  return `${STORY_ROOT}/${path.join("/")}`;
}

/** A real public category branch path from the tree the harness serves. */
function aCategoryBranchPath(): string {
  const category = listPublicRoutePaths(defaultTree()).find(
    (entry) => entry.kind === "category" && entry.segments.length > 0,
  );
  if (category === undefined) {
    throw new Error("[e2e] The harness needs one public category branch.");
  }
  return `${STORY_ROOT}/${category.segments.join("/")}`;
}

async function aServiceWithCover(): Promise<Service> {
  const service = (await getServices()).find(
    (candidate) => candidate.coverMedia?.type === "image",
  );
  if (service === undefined) {
    throw new Error("[e2e] The harness needs one service with an image cover.");
  }
  return service;
}

/** Every JSON-LD payload the page rendered, parsed, in document order. */
async function jsonLdPayloads(page: Page): Promise<Record<string, unknown>[]> {
  const raw = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents();
  return raw.map((text) => JSON.parse(text) as Record<string, unknown>);
}

test("the home page carries WebSite and Organization structured data", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "load" });

  const payloads = await jsonLdPayloads(page);
  expect(payloads.map((entity) => entity["@type"])).toEqual([
    "WebSite",
    "Organization",
  ]);

  for (const entity of payloads) {
    expect(entity["@context"]).toBe("https://schema.org");
    expect(String(entity.url)).toMatch(/^https?:\/\//);
  }

  const organization = payloads[1];
  expect(organization).not.toHaveProperty("logo");
  expect(organization).not.toHaveProperty("contactPoint");
  expect(organization).not.toHaveProperty("address");
});

test("a service detail page carries Service structured data", async ({
  page,
}) => {
  const service = await aServiceWithCover();
  await page.goto(`${SERVICES_PATH}/${service.slug}`, { waitUntil: "load" });

  const payloads = await jsonLdPayloads(page);
  expect(payloads).toHaveLength(1);

  const entity = payloads[0];
  expect(entity["@type"]).toBe("Service");
  expect(entity.name).toBe(service.name);
  const url = new URL(String(entity.url));
  expect(url.pathname).toBe(`${SERVICES_PATH}/${service.slug}`);
  expect(entity).not.toHaveProperty("offers");
  expect(entity).not.toHaveProperty("provider");
});

test("an article detail page carries Article structured data", async ({
  page,
}) => {
  await page.goto(canonicalPathOf("content-reading-coastal-light"), {
    waitUntil: "load",
  });

  const payloads = await jsonLdPayloads(page);
  expect(payloads).toHaveLength(1);

  const entity = payloads[0];
  expect(entity["@type"]).toBe("Article");
  expect(String(entity.headline)).toMatch(/\S/);
  expect(String(entity.datePublished)).toMatch(/\d{4}-\d{2}-\d{2}/);
  expect(String(entity.mainEntityOfPage)).toMatch(/^https?:\/\//);
  expect(entity).not.toHaveProperty("author");
  expect(entity).not.toHaveProperty("publisher");
});

test("routes outside the supported set carry no structured data", async ({
  page,
}) => {
  const unsupported = [
    canonicalPathOf("content-coastal-mornings"), // a gallery detail
    aCategoryBranchPath(), // a category branch
    SERVICES_PATH, // the services listing
    STORY_ROOT, // the story root
  ];

  for (const path of unsupported) {
    await page.goto(path, { waitUntil: "load" });
    await expect(
      page.locator('script[type="application/ld+json"]'),
      `${path} must emit no JSON-LD`,
    ).toHaveCount(0);
  }
});

test("a gallery continuation page carries no structured data", async ({
  page,
}) => {
  await page.goto(canonicalPathOf("content-large-archive"), {
    waitUntil: "domcontentloaded",
  });

  const continueHref = await page
    .getByRole("main")
    .getByRole("link", { name: galleryLabels.showMore })
    .getAttribute("href");
  expect(continueHref, "the multi-page gallery must offer a continuation link").toBeTruthy();

  await page.goto(continueHref ?? "", { waitUntil: "load" });
  expect(new URL(page.url()).searchParams.get("cursor")).toBeTruthy();

  await expect(
    page.locator('script[type="application/ld+json"]'),
  ).toHaveCount(0);
});
