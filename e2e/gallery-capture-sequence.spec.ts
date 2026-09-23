import {
  buildContentTree,
  getCanonicalContentPath,
} from "../src/lib/content-tree";
import { createHmacGalleryCursorCodec } from "../src/lib/gallery-pagination";
import { getBuiltInLabels } from "@/lib/deployment-config";
import { getMockGalleryResult } from "../src/lib/mock-gallery";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import {
  appUnderTestEnvironment,
  DEFAULT_STORY_NAMESPACE,
} from "./support/harness-environment";
import { expect, test } from "./support/fixtures";

/**
 * The capture-sequence gallery journey (AB#166, ADR-0022).
 *
 * A capture-sequence gallery has no placements: its items are photographs
 * ordered by the owner's filename running number, filtered by a media-owned
 * section. The browser contract is meant to be unchanged, so this runs
 * **without JavaScript** — the grid order, the real continuation `href`, and
 * the section links must all work in the server-rendered document — and proves:
 *
 * - the server renders the sequence order the fixture computes, although the
 *   fixture is authored in reverse;
 * - walking every page through the real link visits every photograph once;
 * - a section link narrows the grid to that section, still in sequence order,
 *   and its own continuation stays inside the section.
 *
 * Items are compared by the result identity in the DOM (`data-item-id`), which
 * for this gallery kind is the photograph's `mediaId`; section links are found
 * by the label the fixture itself declares, never a restated string.
 */

const CAPTURE_GALLERY_ID = "content-capture-sequence";
const STORY_ROOT = `/${DEFAULT_STORY_NAMESPACE}`;
const galleryLabels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE).gallery;

const harnessCursorCodec = createHmacGalleryCursorCodec(
  appUnderTestEnvironment.GALLERY_CURSOR_SIGNING_KEY,
);

async function expectedOrder(language: string, sectionSlug?: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 20; guard += 1) {
    const page = await getMockGalleryResult(language, CAPTURE_GALLERY_ID, {
      cursorCodec: harnessCursorCodec,
      ...(cursor === undefined ? {} : { cursor }),
      ...(sectionSlug === undefined ? {} : { sectionSlug }),
    });
    if (page === undefined) throw new Error("[e2e] the capture-sequence fixture is missing");
    ids.push(...page.items.map((item) => item.itemId));
    if (!page.page.hasNextPage) return ids;
    cursor = page.page.endCursor;
  }
  throw new Error("[e2e] the capture-sequence fixture did not terminate");
}

let GALLERY_PATH: string;
let PAGE_SIZE: number;
let EXPECTED: string[];
let SECTION: { readonly slug: string; readonly label: string; readonly ids: string[] };

test.beforeAll(async () => {
  const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
  const treeInput = mockContentTreeInputs[language];
  if (treeInput === undefined) {
    throw new Error(`[e2e] the default locale ${language} publishes no mock tree.`);
  }
  const path = getCanonicalContentPath(buildContentTree(treeInput), CAPTURE_GALLERY_ID);
  if (path === null) {
    throw new Error(`[e2e] ${CAPTURE_GALLERY_ID} has no canonical path in the tree.`);
  }
  GALLERY_PATH = `${STORY_ROOT}/${path.join("/")}`;

  const first = await getMockGalleryResult(language, CAPTURE_GALLERY_ID, {
    cursorCodec: harnessCursorCodec,
  });
  if (first === undefined || !first.page.hasNextPage) {
    throw new Error("[e2e] the capture-sequence fixture must span more than one page.");
  }
  PAGE_SIZE = first.page.size;
  EXPECTED = await expectedOrder(language);

  const section = first.sections[0];
  if (section === undefined) {
    throw new Error("[e2e] the capture-sequence fixture must declare a section.");
  }
  SECTION = {
    slug: section.slug,
    label: section.label,
    ids: await expectedOrder(language, section.slug),
  };
});

test.use({ javaScriptEnabled: false });

async function presentedItemIds(page: import("@playwright/test").Page) {
  const items = page.getByRole("main").locator("[data-item-id]");
  await expect(items.first()).toBeVisible();
  return items.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-item-id") ?? ""),
  );
}

async function walkFrom(page: import("@playwright/test").Page): Promise<string[]> {
  const seen = [...(await presentedItemIds(page))];
  for (let hop = 0; hop < 10; hop += 1) {
    const continueLink = page
      .getByRole("main")
      .getByRole("link", { name: galleryLabels.showMore });
    if ((await continueLink.count()) === 0) return seen;
    await continueLink.first().click();
    await page.waitForLoadState("domcontentloaded");
    seen.push(...(await presentedItemIds(page)));
  }
  throw new Error("[e2e] the continuation walk did not terminate");
}

test("renders the first page in sequence order, not authored order", async ({ page }) => {
  await page.goto(GALLERY_PATH, { waitUntil: "domcontentloaded" });
  const ids = await presentedItemIds(page);
  expect(ids).toEqual(EXPECTED.slice(0, PAGE_SIZE));
  // The fixture is authored in reverse; the head of the grid is still the
  // lowest running number.
  expect(ids[0]).toBe(EXPECTED[0]);
  expect([...ids].sort()).toEqual(ids);
});

test("walks every photograph exactly once through the real continuation link", async ({
  page,
}) => {
  await page.goto(GALLERY_PATH, { waitUntil: "domcontentloaded" });
  const seen = await walkFrom(page);
  expect(seen).toEqual(EXPECTED);
  expect(new Set(seen).size).toBe(EXPECTED.length);
});

test("a section link narrows the grid to that section and continues inside it", async ({
  page,
}) => {
  await page.goto(GALLERY_PATH, { waitUntil: "domcontentloaded" });
  const sectionLink = page
    .getByRole("navigation", { name: galleryLabels.sectionsNav })
    .getByRole("link", { name: SECTION.label, exact: true });
  await sectionLink.click();
  await page.waitForURL((url) => url.searchParams.get("section") === SECTION.slug);

  const seen = await walkFrom(page);
  expect(seen).toEqual(SECTION.ids);
  expect(SECTION.ids.length).toBeGreaterThan(PAGE_SIZE);
  expect(SECTION.ids.length).toBeLessThan(EXPECTED.length);
});
