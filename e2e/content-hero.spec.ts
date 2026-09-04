import {
  buildContentTree,
  getCanonicalContentPath,
} from "../src/lib/content-tree";
import { getBuiltInLabels } from "@/lib/deployment-config";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import {
  appUnderTestEnvironment,
  DEFAULT_STORY_NAMESPACE,
} from "./support/harness-environment";
import { expect, test } from "./support/fixtures";

/**
 * The content-page hero (AB#149, ADR-0016's mechanism reused unchanged): an
 * article's or curated gallery's explicit `cover` renders as a full-bleed
 * hero with the title (and, for a gallery, the lead description) overlaid,
 * fold-safe by the same band mechanism AB#148 built for the home hero. A
 * page with no authored cover renders no hero at all — the default, since
 * the field carries no fallback (unlike the listing card's own cover, which
 * still falls back to the gallery's first item).
 *
 * Assertions stay generic on purpose: content ids are named here only to
 * derive routes from the same adapter data the harness serves, and every
 * check is against accessible roles, states, and laid-out geometry — never
 * fixture copy a clone would replace.
 */

const STORY_ROOT = `/${DEFAULT_STORY_NAMESPACE}`;
const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
const galleryLabels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE).gallery;

function defaultTree() {
  const treeInput = mockContentTreeInputs[language];
  if (treeInput === undefined) {
    throw new Error(`[e2e] The default locale ${language} publishes no mock tree.`);
  }
  return buildContentTree(treeInput);
}

function canonicalPath(contentId: string): string {
  const segments = getCanonicalContentPath(defaultTree(), contentId);
  if (segments === null) {
    throw new Error(`[e2e] ${contentId} has no canonical path.`);
  }
  return `${STORY_ROOT}/${segments.join("/")}`;
}

// Fixture content ids, chosen for what they already prove without a fixture
// change beyond the one this story makes (AB#149's own mock-layer fix, plus
// an authored cover on one multi-page gallery to exercise AC7 end to end —
// see mock-content-listing.ts's own comment on why it's the shuffled
// showcase and deliberately not the large archive).
const ARTICLE_WITH_HERO = canonicalPath("content-reading-coastal-light");
const ARTICLE_NO_HERO = canonicalPath("content-packing-for-a-photo-trip");
const GALLERY_WITH_HERO = canonicalPath("content-coastal-mornings");
const GALLERY_NO_HERO = canonicalPath("content-polar-night-sessions");
const GALLERY_MULTI_PAGE_WITH_HERO = canonicalPath("content-shuffled-showcase");

const DESKTOP_TARGET_VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1680, height: 1050 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
] as const;

/** True when `box` lies entirely within `[0, viewportHeight]` — visible with no scrolling. */
function isFullyAboveTheFold(
  box: { y: number; height: number },
  viewportHeight: number,
): boolean {
  return box.y >= 0 && box.y + box.height <= viewportHeight;
}

for (const viewport of DESKTOP_TARGET_VIEWPORTS) {
  test(`article hero: the title spans the full viewport width and stays inside the fold at ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    test.skip(
      test.info().project.name !== "desktop-chromium",
      "desktop target sizes are exercised on desktop-chromium only",
    );

    await page.setViewportSize(viewport);
    await page.goto(ARTICLE_WITH_HERO, { waitUntil: "domcontentloaded" });

    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();
    const headingBox = await heading.boundingBox();
    expect(headingBox).not.toBeNull();
    expect(
      isFullyAboveTheFold(headingBox!, viewport.height),
      `title at (${headingBox!.y}, height ${headingBox!.height}) should fit inside a ${viewport.height}px-tall viewport`,
    ).toBe(true);

    // AC1: full viewport width, edge to edge — the hero is `main`'s own
    // direct-child figure, never a body-placed one nested inside `article`.
    const heroImage = page.locator("main > figure").first().getByRole("img");
    await expect(heroImage).toBeVisible();
    const imageBox = await heroImage.boundingBox();
    expect(imageBox).not.toBeNull();
    expect(Math.round(imageBox!.width)).toBe(viewport.width);
  });

  test(`gallery hero: the title and lead description stay inside the fold at ${viewport.width}×${viewport.height}, and the photograph is full width`, async ({
    page,
  }) => {
    test.skip(
      test.info().project.name !== "desktop-chromium",
      "desktop target sizes are exercised on desktop-chromium only",
    );

    await page.setViewportSize(viewport);
    await page.goto(GALLERY_WITH_HERO, { waitUntil: "domcontentloaded" });

    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();
    const headingBox = await heading.boundingBox();
    expect(headingBox).not.toBeNull();
    expect(isFullyAboveTheFold(headingBox!, viewport.height)).toBe(true);

    // AC2: the lead description renders on the hero, with the title.
    const hero = page.locator("main > figure").first();
    const description = hero.locator("p").first();
    await expect(description).toBeVisible();
    await expect(description).toHaveText(/\S/);
    const descriptionBox = await description.boundingBox();
    expect(descriptionBox).not.toBeNull();
    expect(isFullyAboveTheFold(descriptionBox!, viewport.height)).toBe(true);

    const heroImage = hero.getByRole("img");
    const imageBox = await heroImage.boundingBox();
    expect(imageBox).not.toBeNull();
    expect(Math.round(imageBox!.width)).toBe(viewport.width);
  });
}

test("article with no authored cover renders the existing constrained title block, with no hero", async ({
  page,
}) => {
  await page.goto(ARTICLE_NO_HERO, { waitUntil: "domcontentloaded" });

  await expect(page.locator("main > figure")).toHaveCount(0);
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  // The title renders in the ordinary reading column, not full-bleed.
  const mainBox = await page.getByRole("main").boundingBox();
  const headingBox = await heading.boundingBox();
  expect(mainBox).not.toBeNull();
  expect(headingBox).not.toBeNull();
  expect(headingBox!.width).toBeLessThan(mainBox!.width);
});

test("gallery with no authored cover renders the existing constrained title block, with no hero", async ({
  page,
}) => {
  await page.goto(GALLERY_NO_HERO, { waitUntil: "domcontentloaded" });

  await expect(page.locator("main > figure")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("a gallery continuation slice never shows a hero, even though the gallery has an authored cover", async ({
  page,
}) => {
  await page.goto(GALLERY_MULTI_PAGE_WITH_HERO, {
    waitUntil: "domcontentloaded",
  });

  // The first, uncursored page does show the hero.
  await expect(page.locator("main > figure")).toHaveCount(1);

  const continueHref = await page
    .getByRole("main")
    .getByRole("link", { name: galleryLabels.showMore })
    .getAttribute("href");
  expect(
    continueHref,
    "the multi-page gallery must offer a continuation link",
  ).toBeTruthy();

  await page.goto(continueHref ?? "", { waitUntil: "domcontentloaded" });
  expect(new URL(page.url()).searchParams.get("cursor")).toBeTruthy();

  // ADR-0003 decision 3 / AC7: a continuation carries no hero at all.
  await expect(page.locator("main > figure")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("the hero band is sized with dvh, not vh, on a content page too", async ({
  page,
}) => {
  await page.goto(ARTICLE_WITH_HERO, { waitUntil: "domcontentloaded" });

  const band = page.locator("main > figure").first().locator("div").first();
  const inlineStyle = await band.getAttribute("style");

  expect(inlineStyle).toContain("dvh");
  expect(inlineStyle).not.toMatch(/(?<!d)vh\b/);
});
