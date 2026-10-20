import { test, expect } from "./support/fixtures";
import { appUnderTestEnvironment, DEFAULT_STORY_NAMESPACE } from "./support/harness-environment";
import { buildContentTree, getCanonicalContentPath } from "../src/lib/content-tree";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { mockContentPages } from "../src/lib/mock-content-pages";
import { FIELDNOTE_NUMBERS, fieldnoteContentId } from "../src/lib/mock-fieldnotes";
import { getBuiltInLabels } from "../src/lib/deployment-config";
import { DEFAULT_GALLERY_PRESENTATION } from "../src/lib/gallery-presentation";
import { openLightbox, presentedImage } from "./support/lightbox";

const language = new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
const tree = buildContentTree(mockContentTreeInputs[language]);
const articleId = fieldnoteContentId(FIELDNOTE_NUMBERS.at(-1)!);
const labels = getBuiltInLabels(appUnderTestEnvironment.SITE_LOCALE).lightbox;
const cases = [
  { id: "content-justified-below", layout: "justified" },
  { id: "content-grid-overlay", layout: "grid" },
  { id: "content-masonry-below", layout: "grid" },
  { id: articleId, layout: DEFAULT_GALLERY_PRESENTATION.layout },
] as const;
function path(id: string) {
  const parts = getCanonicalContentPath(tree, id);
  if (!parts) throw new Error(`Missing inline fixture ${id}`);
  return `/${DEFAULT_STORY_NAMESPACE}/${parts.join("/")}`;
}
async function imageBoxes(list: import("@playwright/test").Locator) {
  return list.locator("img").evaluateAll(nodes => {
    const root = nodes[0].closest("ul")!.getBoundingClientRect();
    return nodes.map(node => {
      const image = node as HTMLImageElement;
      const box = image.getBoundingClientRect();
      return { x: box.x - root.x, y: box.y - root.y, width: box.width, height: box.height,
        sourceWidth: Number(image.getAttribute("width")), sourceHeight: Number(image.getAttribute("height")),
        fit: getComputedStyle(image).objectFit, sizes: image.sizes };
    });
  });
}

for (const javaScriptEnabled of [true, false]) {
  test.describe(`inline layout, JavaScript ${javaScriptEnabled}`, () => {
    test.use({ javaScriptEnabled, reducedMotion: "reduce" });
    for (const fixture of cases) for (const fontSize of [16, 32]) {
      test(`${fixture.id} preserves complete native frames and captions at ${fontSize}px root`, async ({ page }) => {
        const url = path(fixture.id);
        await page.route(url, async route => {
          const response = await route.fetch();
          await route.fulfill({ response, body: (await response.text())
            .replace("<head>", `<head><style>html{font-size:${fontSize}px!important}</style>`) });
        });
        const authored = mockContentPages[language].get(fixture.id)!;
        const block = authored.body.find(block => block.type === "mini-gallery")!;
        if (block.type !== "mini-gallery") throw new Error("Missing boundary set");
        const images = block.items.flatMap(item => item.media.type === "image" ? [item.media] : []);
        for (const width of [390, 1280]) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(url, { waitUntil: "domcontentloaded" });
          expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(`${fontSize}px`);
          const list = page.locator("[data-mini-gallery]");
          await expect(list).toHaveCount(1);
          await expect(list.locator("img")).toHaveCount(12);
          if (javaScriptEnabled) await expect(list.locator("button")).toHaveCount(12);
          else await expect(list.locator("button, a, [tabindex]")).toHaveCount(0);
          const boxes = await imageBoxes(list);
          for (const box of boxes) {
            expect(box.fit).not.toBe("cover");
            expect(box.width).toBeGreaterThan(0);
            expect(box.height).toBeGreaterThan(0);
            // Compare the shorter axis: amplifying a 1/64px width rounding
            // difference by a 2048:1 ratio manufactures a distortion failure.
            const ratio = box.sourceWidth / box.sourceHeight;
            const ratioError = ratio < 1 ? Math.abs(box.width - box.height * ratio)
              : Math.abs(box.height - box.width / ratio);
            expect(ratioError).toBeLessThan(0.05);
            // Mobile WebKit's viewport box quantization can add a fraction of
            // a CSS pixel; the exact CSS intrinsic cap remains authoritative.
            expect(box.width).toBeLessThanOrEqual(box.sourceWidth + 0.5);
            expect(box.height).toBeLessThanOrEqual(box.sourceHeight + 0.5);
          }
          for (let i = 1; i < boxes.length; i++) {
            const [previous, current] = [boxes[i - 1], boxes[i]];
            expect(current.y > previous.y + 1 || (Math.abs(current.y - previous.y) <= 1 && current.x > previous.x)).toBe(true);
          }
          const captions = list.locator("figcaption");
          const metadata = images.filter(image => image.caption || image.credit);
          await expect(captions).toHaveCount(metadata.length);
          for (const [index, image] of metadata.entries()) {
            await expect(captions.nth(index)).toHaveText([image.caption, image.credit].filter(Boolean).join(" — "));
          }
          const captionGeometry = await captions.evaluateAll(nodes => nodes.map(node => {
            const style = getComputedStyle(node), box = node.getBoundingClientRect();
            const image = node.closest("figure")!.querySelector("img")!.getBoundingClientRect();
            return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, height: box.height,
              imageBottom: image.bottom, display: style.display, overflow: style.overflow,
              clamp: style.webkitLineClamp };
          }));
          for (const caption of captionGeometry) {
            expect(caption.display).not.toBe("none");
            expect(caption.overflow).not.toBe("hidden");
            expect(["none", "", "unset"]).toContain(caption.clamp);
            expect(caption.height).toBeGreaterThan(0);
            expect(caption.y).toBeGreaterThanOrEqual(caption.imageBottom - 1);
          }
          for (let i = 0; i < captionGeometry.length; i++) for (let j = i + 1; j < captionGeometry.length; j++) {
            const [a, b] = [captionGeometry[i], captionGeometry[j]];
            const overlaps = Math.min(a.right, b.right) > Math.max(a.x, b.x) + 1
              && Math.min(a.bottom, b.bottom) > Math.max(a.y, b.y) + 1;
            expect(overlaps).toBe(false);
          }
          if (fixture.layout === "justified") {
            for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
              if (Math.abs(boxes[i].y - boxes[j].y) <= 1) expect(Math.abs(boxes[i].height - boxes[j].height)).toBeLessThan(1);
            }
            for (const box of boxes) expect(box.sizes).toBe("100vw");
            if (width === 1280) expect(Math.abs(boxes[9].y - boxes[10].y)).toBeLessThan(1);
            // A singleton's full caption is not forced into its tiny picture.
            expect(await captions.filter({ hasText: images[6].caption! }).count()).toBeGreaterThan(0);
          } else if (width === 1280) {
            expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThan(1);
            expect(Math.abs(boxes[0].width - boxes[1].width)).toBeLessThan(1);
            expect(Math.abs(boxes[0].height - boxes[1].height)).toBeGreaterThan(10);
          }
          // Scope the new no-overflow contract to the mini-gallery. The
          // existing desktop header can overflow at a 32px root independently.
          const bounds = await list.evaluate(node => {
            const root = node.getBoundingClientRect();
            return [...node.querySelectorAll("img, figcaption")].map(child => {
              const box = child.getBoundingClientRect();
              return { left: box.left - root.left, right: box.right - root.left, width: root.width };
            });
          });
          for (const box of bounds) {
            expect(box.left).toBeGreaterThanOrEqual(-0.5);
            expect(box.right).toBeLessThanOrEqual(box.width + 0.5);
          }
        }
      });
    }
  });
}

test("inline justified hydration preserves its plain-image geometry and its own viewer", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/_next/static/**/*.js", async route => { await gate; await route.continue(); });
  try {
    await page.goto(path("content-justified-below"), { waitUntil: "commit" });
    const list = page.locator("[data-mini-gallery]");
    await expect(list.locator("img")).toHaveCount(12);
    await expect(list.locator("button")).toHaveCount(0);
    await page.waitForFunction(() => document.fonts.status === "loaded");
    const before = await imageBoxes(list);
    release();
    const triggers = list.locator("button");
    await expect(triggers).toHaveCount(12);
    expect(await imageBoxes(list)).toEqual(before);
    const dialog = page.getByRole("dialog", { name: labels.viewer });
    await openLightbox(dialog, () => triggers.first().press("Enter"));
    await expect(dialog.getByText(`1${labels.indexSeparator}12`, { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(triggers.first()).toBeFocused();
    await openLightbox(dialog, () => triggers.last().press("Enter"));
    await expect(dialog.getByText(`12${labels.indexSeparator}12`, { exact: true })).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await presentedImage(dialog))?.alt)
      .toBe(await triggers.last().locator("img").getAttribute("alt"));
    await expect(dialog.getByRole("button", { name: labels.enquire })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(triggers.last()).toBeFocused();
  } finally { release(); }
});


test("inline native geometry survives optimized image-byte loading", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/_next/image**", async route => { await gate; await route.continue(); });
  try {
    await page.goto(path("content-justified-below"), { waitUntil: "domcontentloaded" });
    const list = page.locator("[data-mini-gallery]");
    await expect(list.locator("button")).toHaveCount(12);
    await page.waitForFunction(() => document.fonts.status === "loaded");
    const before = await imageBoxes(list);
    release();
    // Visit every lazy image, including the tiny boundary frames. complete
    // alone is also true on error, so verify its optimizer response separately.
    const responses: number[] = [];
    page.on("response", response => {
      if (new URL(response.url()).pathname === "/_next/image") responses.push(response.status());
    });
    for (const image of await list.locator("img").all()) {
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).complete)).toBe(true);
      await image.evaluate(node => (node as HTMLImageElement).decode());
    }
    expect(responses.length).toBeGreaterThan(0);
    expect(responses.every(status => status === 200)).toBe(true);
    const after = await imageBoxes(list);
    for (const [i, box] of before.entries()) {
      expect(Math.abs(after[i].width - box.width)).toBeLessThan(0.1);
      expect(Math.abs(after[i].height - box.height)).toBeLessThan(0.1);
      expect(Math.abs(after[i].y - box.y)).toBeLessThan(0.5);
    }
  } finally { release(); }
});
