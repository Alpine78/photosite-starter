import { test, expect } from "./support/fixtures";
import { getBuiltInLabels } from "../src/lib/deployment-config";
import { buildContentTree, getCanonicalContentPath } from "../src/lib/content-tree";
import { mockContentPages } from "../src/lib/mock-content-pages";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { appUnderTestEnvironment, DEFAULT_STORY_NAMESPACE, PREFIXED_LOCALE } from "./support/harness-environment";
import { openLightbox, presentedImage } from "./support/lightbox";

const labels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE).lightbox;
const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
const tree = buildContentTree(mockContentTreeInputs[language]);
const path = `/${DEFAULT_STORY_NAMESPACE}/${getCanonicalContentPath(tree, "content-coastal-mornings")!.join("/")}`;

test("nested mini-gallery providers preserve every sequence and focus on close", async ({ page }) => {
  await page.goto(path);
  const mini = page.locator("[data-mini-gallery]");
  await expect(mini).toHaveCount(2);
  const loose = page.locator("article button[data-item-id]:not([data-mini-gallery] button):not(#gallery button)");
  const sequences = [mini.nth(0).locator("button"), mini.nth(1).locator("button"), loose, page.locator("#gallery button[data-item-id]")];
  const dialog = page.getByRole("dialog", { name: labels.viewer });
  for (const triggers of sequences) {
    await expect.poll(() => triggers.count()).toBeGreaterThan(1);
    const count = await triggers.count();
    expect(count).toBeGreaterThan(1);
    const alts = await triggers.locator("img").evaluateAll(nodes => nodes.map(n => n.getAttribute("alt")));
    for (let run = 0; run < 2; run++) {
      await openLightbox(dialog, () => triggers.first().click());
      for (let index = 0; index < count; index++) {
        await expect.poll(async () => (await presentedImage(dialog))?.alt).toBe(alts[index]);
        await expect(dialog.getByText(
          `${index + 1}${labels.indexSeparator}${count}`, { exact: true },
        )).toBeVisible();
        if (index + 1 < count) await dialog.getByRole("button", { name: labels.next, exact: true }).click();
      }
      await dialog.getByRole("button", { name: labels.close, exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(triggers.last()).toBeFocused();
    }
  }
});

const articlePath = `/${DEFAULT_STORY_NAMESPACE}/${getCanonicalContentPath(tree, "content-reading-coastal-light")!.join("/")}`;

test("untitled and repeated-title mini-galleries have distinct accessible names", async ({ page }) => {
  for (const route of [path, articlePath]) {
    await page.goto(route);
    const lists = page.locator("[data-mini-gallery]");
    await expect(lists).toHaveCount(2);
    const names = await lists.evaluateAll(nodes => nodes.map(n => n.getAttribute("aria-label")));
    expect(names.every(Boolean)).toBe(true);
    expect(new Set(names).size).toBe(2);
    for (const name of names) await expect(page.getByRole("list", { name: name!, exact: true })).toBeVisible();
  }
});

test("mini-gallery keeps full frames, row-major order, and bounded responsive sizes", async ({ page }, testInfo) => {
  await page.goto(articlePath);
  const list = page.locator("[data-mini-gallery]").first();
  const images = list.locator("img");
  await expect(images).toHaveCount(3);
  const boxes = [];
  for (const image of await images.all()) {
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((n: HTMLImageElement) => n.complete && n.naturalWidth > 0)).toBe(true);
    boxes.push(await image.evaluate((n: HTMLImageElement) => {
      const rect = n.getBoundingClientRect();
      return { top: rect.top + window.scrollY, left: rect.left, width: rect.width, height: rect.height,
        intrinsicWidth: Number(n.getAttribute("width")), intrinsicHeight: Number(n.getAttribute("height")),
        fit: getComputedStyle(n).objectFit, sizes: n.sizes };
    }));
  }
  expect(new Set(boxes.map(b => b.intrinsicWidth / b.intrinsicHeight)).size).toBeGreaterThan(1);
  for (const box of boxes) {
    expect(box.width / box.height).toBeCloseTo(box.intrinsicWidth / box.intrinsicHeight, 2);
    expect(box.width).toBeLessThanOrEqual(box.intrinsicWidth);
    expect(box.fit).not.toBe("cover");
    expect(box.sizes).toContain("348px");
  }
  await list.screenshot({ path: testInfo.outputPath("mini-gallery.png") });
  if (page.viewportSize()!.width >= 640) {
    expect(boxes[0].top).toBeCloseTo(boxes[1].top, 0);
    expect(boxes[0].left).toBeLessThan(boxes[1].left);
    expect(boxes[2].top).toBeGreaterThan(boxes[0].top);
    expect(boxes[2].left).toBeCloseTo(boxes[0].left, 0);
  } else {
    expect(boxes[1].top).toBeGreaterThan(boxes[0].top);
    expect(boxes[2].top).toBeGreaterThan(boxes[1].top);
  }
});

test("keyboard navigation returns to the repeated occurrence and offers no enquiry or continuation", async ({ page }) => {
  const galleryRequests: string[] = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/api/gallery") galleryRequests.push(request.url());
  });
  await page.goto(articlePath);
  const triggers = page.locator("[data-mini-gallery]").first().locator("button");
  await expect(triggers).toHaveCount(3);
  await expect(triggers.nth(1)).toHaveAccessibleName(labels.openImage);
  await triggers.first().focus();
  await page.keyboard.press("Tab");
  await expect(triggers.nth(1)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(triggers.nth(2)).toBeFocused();
  const dialog = page.getByRole("dialog", { name: labels.viewer });
  await openLightbox(dialog, () => triggers.first().press("Enter"));
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await presentedImage(dialog))?.alt).toBe("");
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await presentedImage(dialog))?.alt).toBe(await triggers.first().locator("img").getAttribute("alt"));
  await expect(dialog.getByRole("button", { name: labels.enquire })).toHaveCount(0);
  await expect(dialog.locator('a[href*="enquire="]')).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(triggers.nth(2)).toBeFocused();
  expect(galleryRequests).toEqual([]);
  await expect(page.locator('[data-mini-gallery] a[href*="cursor="]')).toHaveCount(0);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("renders every image with captions and credits and no inert buttons", async ({ page }) => {
    await page.goto(articlePath);
    const lists = page.locator("[data-mini-gallery]");
    await expect(lists).toHaveCount(2);
    await expect(lists.locator("img")).toHaveCount(5);
    await expect(lists.locator("button, a, [tabindex]")).toHaveCount(0);
    const authored = mockContentPages[language].get("content-reading-coastal-light")!;
    const metadata = authored.body.flatMap(block => block.type === "mini-gallery"
      ? block.items.flatMap(item => item.media.type === "image" && (item.media.caption || item.media.credit)
        ? [item.media] : []) : []);
    const captions = lists.locator("figcaption");
    await expect(captions).toHaveCount(metadata.length);
    for (const [index, media] of metadata.entries()) {
      if (media.caption) await expect(captions.nth(index)).toContainText(media.caption);
      if (media.credit) await expect(captions.nth(index)).toContainText(media.credit);
    }
  });
});


test("Finnish mini-gallery fallback names use the page locale", async ({ page }) => {
  const fiTree = buildContentTree(mockContentTreeInputs.fi);
  const fiPath = getCanonicalContentPath(fiTree, "content-coastal-mornings")!;
  await page.goto(`/${PREFIXED_LOCALE.prefix}/${PREFIXED_LOCALE.storyNamespace}/${fiPath.join("/")}`);
  const fallback = getBuiltInLabels("fi-FI").miniGallery.label;
  await expect(page.getByRole("list", { name: `${fallback} 1`, exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: `${fallback} 2`, exact: true })).toBeVisible();
});
