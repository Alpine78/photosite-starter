import {
  buildContentTree,
  getCanonicalContentPath,
} from "../src/lib/content-tree";
import { getBuiltInLabels } from "@/lib/deployment-config";
import { createHmacGalleryCursorCodec } from "../src/lib/gallery-pagination";
import { getMockGalleryResult } from "../src/lib/mock-gallery";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import {
  appUnderTestEnvironment,
  DEFAULT_STORY_NAMESPACE,
} from "./support/harness-environment";
import { expect, test } from "./support/fixtures";

/**
 * A gallery's optional lead and long-form body (AB#106): rendering, the
 * content-derived page-jump navigation, the first-page-only rule ADR-0003
 * decision 3 requires, and the semantic heading hierarchy AB#106's own
 * acceptance criteria name explicitly. Complements `gallery-append.spec.ts`
 * and `gallery-sections.spec.ts`, which cover the curated grid this body is
 * deliberately kept separate from.
 */

const harnessCursorCodec = createHmacGalleryCursorCodec(
  appUnderTestEnvironment.GALLERY_CURSOR_SIGNING_KEY,
);
const STORY_ROOT = `/${DEFAULT_STORY_NAMESPACE}`;
const labels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE);
const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;

function canonicalPathOf(contentId: string): string {
  const treeInput = mockContentTreeInputs[language];
  if (treeInput === undefined) {
    throw new Error(`[e2e] The default locale ${language} publishes no mock tree.`);
  }
  const tree = buildContentTree(treeInput);
  const path = getCanonicalContentPath(tree, contentId);
  if (path === null) {
    throw new Error(`[e2e] ${contentId} has no canonical route in ${language}.`);
  }
  return `${STORY_ROOT}/${path.join("/")}`;
}

/** The gallery `content-coastal-mornings` fixture authors: paragraphs, two
 * level-2 headings, a list, a body media placement, and a blockquote — one
 * page, no continuation. */
const AUTHORED_GALLERY_PATH = canonicalPathOf("content-coastal-mornings");
/** Empty body, single page: proves absence renders no wrapper at all. */
const EMPTY_BODY_GALLERY_PATH = canonicalPathOf("content-selected-work");
/** Multi-page, and — per this story's own fix — now carries a short body
 * too, so the first-page-only rule has something to actually omit. */
const MULTI_PAGE_GALLERY_ID = "content-large-archive";
const MULTI_PAGE_GALLERY_PATH = canonicalPathOf(MULTI_PAGE_GALLERY_ID);

test("the lead, long-form body, and page-jump navigation render on the gallery's first page, with a single h1", async ({
  page,
}) => {
  await page.goto(AUTHORED_GALLERY_PATH, { waitUntil: "load" });
  const main = page.getByRole("main");

  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  // The lead (`page.summary`), rendered in the header, above the body.
  await expect(main.locator("p").first()).toHaveText(/\S/);

  // The long-form body: both authored level-2 headings render as real h2s,
  // in document order, and the body's own paragraph text is present.
  const bodyHeadings = main.getByRole("heading", { level: 2 });
  await expect(bodyHeadings).toHaveText([
    "Why first light",
    "Returning to the same shoreline",
  ]);
  await expect(main.getByText("a standing appointment with the tide", { exact: false })).toBeVisible();

  // Body media: native rendition dimensions, no crop class, lazy-loaded —
  // a content placement, rendered through the same MediaFigure/ContentBody
  // boundary as an article's, never through the gallery's own grid.
  const bodyImage = main.locator("article > div img").first();
  await expect(bodyImage).toBeVisible();
  const [width, height, loading, className] = await Promise.all([
    bodyImage.getAttribute("width"),
    bodyImage.getAttribute("height"),
    bodyImage.getAttribute("loading"),
    bodyImage.getAttribute("class"),
  ]);
  expect(Number(width)).toBeGreaterThan(0);
  expect(Number(height)).toBeGreaterThan(0);
  expect(loading).toBe("lazy");
  expect(className ?? "").not.toContain("object-cover");

  // The page-jump navigation: the leading link to the grid, then one link
  // per level-2 heading, each targeting a heading id that actually exists.
  const jumpNav = page.getByRole("navigation", { name: labels.contentTree.onThisPage });
  await expect(jumpNav).toHaveCount(1);
  const jumpLinks = jumpNav.getByRole("link");
  await expect(jumpLinks).toHaveCount(3);
  await expect(jumpLinks.first()).toHaveText(labels.gallery.jumpToImages);

  const firstHeadingLink = jumpLinks.nth(1);
  const fragment = await firstHeadingLink.getAttribute("href");
  expect(fragment?.startsWith("#")).toBe(true);
  const target = page.locator(`h2${fragment ?? ""}`);
  await expect(target).toHaveCount(1);

  await firstHeadingLink.click();
  await expect(target).toBeInViewport();

  await jumpLinks.first().click();
  await expect(page.locator("#gallery")).toBeInViewport();
});

test("a gallery with no body renders no page-jump navigation and no body wrapper", async ({
  page,
}) => {
  await page.goto(EMPTY_BODY_GALLERY_PATH, { waitUntil: "load" });

  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(
    page.getByRole("navigation", { name: labels.contentTree.onThisPage }),
  ).toHaveCount(0);
  await expect(page.getByRole("main").locator("h2")).toHaveCount(0);
});

test("a continuation page omits the lead, the body, and the page-jump navigation", async ({
  page,
}) => {
  await page.goto(MULTI_PAGE_GALLERY_PATH, { waitUntil: "load" });
  const main = page.getByRole("main");

  // The first page carries all three, same as the dedicated authored-body
  // gallery above — proving this isn't specific to one fixture.
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(
    page.getByRole("navigation", { name: labels.contentTree.onThisPage }),
  ).toHaveCount(1);
  await expect(main.getByRole("heading", { level: 2 })).toHaveCount(1);
  await expect(main.getByText("exercise pagination at scale", { exact: false })).toBeVisible();

  const result = await getMockGalleryResult(language, MULTI_PAGE_GALLERY_ID, {
    cursorCodec: harnessCursorCodec,
  });
  const cursor = result?.page.hasNextPage ? result.page.endCursor : null;
  if (cursor === null || cursor === undefined) {
    throw new Error(`[e2e] ${MULTI_PAGE_GALLERY_ID} needs a second page to test.`);
  }

  await page.goto(`${MULTI_PAGE_GALLERY_PATH}?cursor=${encodeURIComponent(cursor)}`, {
    waitUntil: "load",
  });

  // Still exactly one h1 (the compact continuation heading), but none of the
  // first page's editorial framing repeats — ADR-0003 decision 3.
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(
    page.getByRole("navigation", { name: labels.contentTree.onThisPage }),
  ).toHaveCount(0);
  await expect(page.getByRole("main").locator("h2")).toHaveCount(0);
  await expect(
    page.getByText("exercise pagination at scale", { exact: false }),
  ).toHaveCount(0);
});
