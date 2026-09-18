import { test, expect } from "./support/fixtures";
import { getBuiltInLabels } from "../src/lib/deployment-config";
import { buildContentTree, getCanonicalContentPath } from "../src/lib/content-tree";
import { mockContentPages } from "../src/lib/mock-content-pages";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { appUnderTestEnvironment, DEFAULT_STORY_NAMESPACE, PREFIXED_LOCALE } from "./support/harness-environment";

const routes = [
  { language: "en", root: `/${DEFAULT_STORY_NAMESPACE}` },
  { language: "fi", root: `/${PREFIXED_LOCALE.prefix}/${PREFIXED_LOCALE.storyNamespace}` },
];
const pathFor = (contentId: string, language: string, root: string) => `${root}/${getCanonicalContentPath(buildContentTree(mockContentTreeInputs[language]), contentId)!.join("/")}`;

for (const route of routes) {
  const labels = getBuiltInLabels(route.language === "en" ? appUnderTestEnvironment.SITE_LOCALE : "fi-FI").imageComparison;
  for (const contentId of ["content-reading-coastal-light", "content-coastal-mornings"]) {
    const path = pathFor(contentId, route.language, route.root);
    test(`${route.language} ${contentId}: keyboard and pointer reveal, complete view and isolated images`, async ({ page }, info) => {
      await page.goto(path);
      const comparison = page.locator("section[role=region]").filter({ has: page.locator("[data-comparison-view]") }).first();
      await comparison.scrollIntoViewIfNeeded();
      const slider = comparison.getByRole("slider", { name: labels.position });
      await expect(slider).toBeVisible();
      await slider.focus();
      await expect(slider).toHaveCSS("outline-width", "2px");
      await slider.press("ArrowRight");
      await expect(slider).toHaveValue("51");
      await expect(slider).toHaveAttribute("aria-valuetext", /51%.*49%/);
      await slider.press("Home");
      await expect(slider).toHaveValue("0");
      await expect(comparison.locator("img").nth(1)).toHaveCSS("clip-path", "inset(0px 0px 0px 0%)");
      await slider.press("End");
      await expect(slider).toHaveValue("100");
      const bounds = (await slider.boundingBox())!;
      if (info.project.name === "mobile-webkit") {
        await page.touchscreen.tap(bounds.x + bounds.width / 3, bounds.y + bounds.height / 2);
      } else {
        await page.mouse.click(bounds.x + bounds.width / 3, bounds.y + bounds.height / 2);
      }
      await expect.poll(async () => Number(await slider.inputValue())).toBeLessThan(100);
      if (info.project.name === "desktop-chromium") {
        await page.mouse.move(bounds.x + bounds.width / 3, bounds.y + bounds.height / 2);
        await page.mouse.down();
        await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height / 2, { steps: 8 });
        await page.mouse.up();
        await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(60);
      }
      const images = comparison.locator("img");
      const block = mockContentPages[route.language].get(contentId)!.body.find(block => block.type === "image-comparison")!;
      if (block.type !== "image-comparison") throw new Error("missing comparison fixture");
      await expect(images.first()).toHaveAttribute("alt", block.first.alt);
      await expect(images.nth(1)).toHaveAttribute("alt", block.second.alt);
      await expect(comparison.locator("figcaption").first()).toContainText(block.firstLabel);
      await expect(comparison.locator("figcaption").nth(1)).toContainText(block.secondLabel);
      const boxes = await images.evaluateAll(nodes => nodes.map(node => {
        const image = node as HTMLImageElement;
        const rect = image.getBoundingClientRect();
        return { width: rect.width, height: rect.height, sourceWidth: Number(image.getAttribute("width")), ratio: Number(image.getAttribute("width")) / Number(image.getAttribute("height")), sizes: image.sizes, fit: getComputedStyle(image).objectFit };
      }));
      for (const box of boxes) {
        expect(box.width / box.height).toBeCloseTo(box.ratio, 2);
        expect(box.width).toBeLessThanOrEqual(box.sourceWidth);
        expect(box.fit).not.toBe("cover");
        expect(box.sizes).toContain("px");
      }
      await expect(comparison.locator("button[data-item-id]")).toHaveCount(0);
      const toggle = comparison.getByRole("button", { name: labels.showComplete });
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      await expect(comparison.locator("[data-comparison-view]")).toHaveAttribute("data-comparison-view", "complete");
      await expect(slider).toHaveCount(0);
      await toggle.click();
      await expect(slider).toBeVisible();
      await expect(toggle).toBeFocused();
      const incompatible = page.locator("[data-comparison-view]").nth(1);
      await expect(incompatible).toHaveAttribute("data-comparison-view", "complete");
      await expect(incompatible.locator("img")).toHaveCount(2);
      await expect(incompatible.locator("input")).toHaveCount(0);
    });
    test.describe(`${route.language} ${contentId}: without JavaScript`, () => {
      test.use({ javaScriptEnabled: false });
      test(`${route.language} ${contentId}: full images and attribution without JavaScript`, async ({ page }) => {
        await page.goto(path);
        const views = page.locator("[data-comparison-view]");
        await expect(views).toHaveCount(2);
        for (const view of await views.all()) {
          await expect(view).toHaveAttribute("data-comparison-view", "complete");
          await expect(view.locator("img")).toHaveCount(2);
          await expect(view.locator("figcaption")).toHaveCount(2);
          for (const image of await view.locator("img").all()) await expect(image).toHaveCSS("clip-path", "none");
        }
        await expect(page.getByRole("slider", { name: labels.position })).toHaveCount(0);
        await expect(page.getByRole("button", { name: labels.showComplete })).toHaveCount(0);
        await expect(views.first()).toContainText("Placeholder credit");
      });
    });
  }
}

test("a failed comparison image keeps the other full image and removes inactive controls", async ({ page }) => {
  await page.route("**/_next/image?*", async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("url")?.includes("lichen-stones")) return route.fulfill({ status: 404, body: "" });
    await route.continue();
  });
  await page.goto(pathFor("content-reading-coastal-light", "en", `/${DEFAULT_STORY_NAMESPACE}`));
  const comparison = page.locator("section[role=region]").filter({ has: page.locator("[data-comparison-view]") }).first();
  await comparison.scrollIntoViewIfNeeded();
  await expect(comparison.getByRole("status")).toBeVisible();
  await expect(comparison.locator("[data-comparison-view]")).toHaveAttribute("data-comparison-view", "complete");
  await expect(comparison.getByRole("slider")).toHaveCount(0);
  await expect(comparison.locator("img").first()).toBeVisible();
});
