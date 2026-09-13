import type { Locator } from "@playwright/test";
import { test, expect } from "./support/fixtures";
import { galleryItems, STORY_ROOT } from "./support/gallery";
import { openLightbox } from "./support/lightbox";
import { appUnderTestEnvironment } from "./support/harness-environment";
import { buildContentTree, getCanonicalContentPath } from "../src/lib/content-tree";
import { mockContentTreeInputs } from "../src/lib/mock-content-tree";
import { getMockGalleryResult } from "../src/lib/mock-gallery";
import { createHmacGalleryCursorCodec } from "../src/lib/gallery-pagination";
import { getBuiltInLabels } from "../src/lib/deployment-config";

const locale = appUnderTestEnvironment.SITE_LOCALE;
const language = new Intl.Locale(locale).language;
const tree = buildContentTree(mockContentTreeInputs[language]);
const codec = createHmacGalleryCursorCodec(appUnderTestEnvironment.GALLERY_CURSOR_SIGNING_KEY);
const labels = getBuiltInLabels(locale);
function path(id: string) {
  const segments = getCanonicalContentPath(tree, `content-${id}`);
  if (!segments) throw new Error(`Missing gallery ${id}`);
  return `${STORY_ROOT}/${segments.join("/")}`;
}

async function boxes(main: Locator) {
  return galleryItems(main).evaluateAll((items) => {
    const root = items[0].parentElement!.getBoundingClientRect();
    return items.map((item) => {
      const img = item.querySelector("img")!;
      const rect = img.getBoundingClientRect();
      return { id: item.querySelector("[data-item-id]")!.getAttribute("data-item-id"),
        x: rect.x - root.x, y: rect.y - root.y, width: rect.width, height: rect.height,
        ratio: Number(img.getAttribute("width")) / Number(img.getAttribute("height")),
        sizes: img.sizes,
      };
    });
  });
}

const cases = [
  { id: "large-archive", layout: "grid", caption: "below", count: 400 },
  { id: "grid-overlay", layout: "grid", caption: "overlay", count: 30 },
  { id: "masonry-below", layout: "masonry", caption: "below", count: 30 },
  { id: "masonry-overlay", layout: "masonry", caption: "overlay", count: 30 },
  { id: "justified-below", layout: "justified", caption: "below", count: 30 },
  { id: "justified-overlay", layout: "justified", caption: "overlay", count: 30 },
] as const;

for (const fixture of cases) {
  test.describe(`${fixture.layout} / ${fixture.caption}`, () => {
    test("image loading and hydration preserve the server-rendered boxes", async ({ page }) => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const delayed = async (route: import("@playwright/test").Route) => { await gate; await route.continue(); };
      await page.route("**/_next/static/**/*.js", delayed);
      await page.route("**/_next/image?*", delayed);
      try {
        await page.goto(path(fixture.id), { waitUntil: "commit" });
        const main = page.getByRole("main");
        await expect(galleryItems(main)).toHaveCount(24);
        // Not `document.fonts.ready`: under WebKit, that promise stays pending
        // for as long as this test's own intercepted `_next/static`/`_next/image`
        // routes are held, even though `document.fonts.status` already reports
        // "loaded" at this point — reproduced in isolation, unrelated to any
        // gallery layout. Polling the status directly gets the same guarantee
        // (fonts finished loading before boxes are measured) without depending
        // on whatever else WebKit ties that promise's settlement to.
        await page.waitForFunction(() => document.fonts.status === "loaded");
        const before = await boxes(main);
        const listBefore = await galleryItems(main).first().evaluate((item) => item.parentElement!.getBoundingClientRect().toJSON());
        release();
        await page.waitForLoadState("load");
        // Prove the page has hydrated rather than merely receiving its scripts.
        const dialog = page.getByRole("dialog");
        await openLightbox(dialog, () => main.locator("[data-item-id]").first().click());
        await page.keyboard.press("Escape");
        const after = await boxes(main);
        for (let i = 0; i < before.length; i += 1) {
          for (const key of ["x", "y", "width", "height"] as const) {
            expect(Math.abs(after[i][key] - before[i][key])).toBeLessThan(0.1);
          }
        }
        const heightAfter = await galleryItems(main).first().evaluate((item) => item.parentElement!.getBoundingClientRect().height);
        expect(Math.abs(heightAfter - listBefore.height)).toBeLessThan(0.1);
      } finally { release(); }
    });

    for (const javaScriptEnabled of [false, true]) {
      test.describe(javaScriptEnabled ? "enhanced" : "scriptless", () => {
        test.use({ javaScriptEnabled });
        test("native ratios, source order, and continuation at narrow and wide sizes", async ({ page, browserName }) => {
          const expected = await getMockGalleryResult(locale, `content-${fixture.id}`, { cursorCodec: codec });
          const url = path(fixture.id);
          for (const width of [320, 390, 800, 1280]) {
            await page.setViewportSize({ width, height: 900 });
            await page.goto(url, { waitUntil: "load" });
            const main = page.getByRole("main");
            await expect(galleryItems(main)).toHaveCount(24);
            const before = await boxes(main);
            expect(before.map((item) => item.id)).toEqual(expected!.items.map((item) => item.itemId));
            for (const [index, item] of before.entries()) {
              expect(Math.abs(item.height - item.width / item.ratio)).toBeLessThan(0.6);
              if (index > 0) {
                const previous = before[index - 1];
                expect(item.y > previous.y + 1 || (Math.abs(item.y - previous.y) <= 1 && item.x > previous.x)).toBe(true);
              }
              if (fixture.layout === "justified") expect(item.height).toBeLessThanOrEqual(256.1);
            }
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            if (javaScriptEnabled && browserName === "chromium") {
              const triggers = main.locator("[data-item-id]");
              await triggers.first().focus();
              for (let i = 1; i < 4; i += 1) {
                await page.keyboard.press("Tab");
                await expect(triggers.nth(i)).toBeFocused();
              }
            }
            await main.locator('a[rel="next"]').click();
            if (javaScriptEnabled) {
              await expect(galleryItems(main)).toHaveCount(fixture.count === 400 ? 48 : 30);
              const after = await boxes(main);
              const lastRow = before.at(-1)!.y;
              for (let i = 0; i < before.length; i += 1) {
                expect(after[i].id).toBe(before[i].id);
                if (fixture.layout === "justified" && Math.abs(before[i].y - lastRow) < 1) continue;
                for (const key of ["x", "y", "width", "height"] as const) {
                  expect(Math.abs(after[i][key] - before[i][key]), `${i}.${key} at ${width}`).toBeLessThan(0.5);
                }
              }
              expect(new Set(after.map((item) => item.id)).size).toBe(after.length);
              if (fixture.count !== 400) await expect(page.getByRole("status").filter({ hasText: labels.gallery.allLoaded })).toBeFocused();
            } else {
              await expect(page).toHaveURL(/[?&]cursor=/);
              await expect(galleryItems(main)).toHaveCount(fixture.count === 400 ? 24 : 6);
              await page.reload();
              expect((await boxes(main)).every((item) => item.height > 0 && item.width > 0)).toBe(true);
            }
          }
        });
      });
    }

    test("lightbox continuation preserves the current image and focus returns by identity", async ({ page }) => {
      await page.goto(path(fixture.id), { waitUntil: "load" });
      const main = page.getByRole("main");
      const triggers = main.locator("[data-item-id]");
      const lastId = await triggers.nth(23).getAttribute("data-item-id");
      const dialog = page.getByRole("dialog");
      await openLightbox(dialog, () => triggers.nth(23).click());
      await expect(galleryItems(main)).toHaveCount(fixture.count === 400 ? 48 : 30);
      await page.keyboard.press("Escape");
      await expect(main.locator(`[data-item-id="${lastId}"]`)).toBeFocused();
    });
  });
}

test("justified singleton, pair, empty gallery and named shuffled section", async ({ page }) => {
  for (const width of [320, 800, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const id of ["layout-single", "layout-pair"]) {
      await page.goto(path(id));
      const measured = await boxes(page.getByRole("main"));
      expect(measured).toHaveLength(id === "layout-single" ? 1 : 2);
      for (const item of measured) expect(item.height).toBeLessThanOrEqual(192.1);
    }
  }
  await page.goto(path("awaiting-selection"));
  await expect(page.getByText(labels.gallery.empty, { exact: true })).toBeVisible();
  await page.goto(`${path("justified-overlay")}?section=frames`, { waitUntil: "load" });
  await expect(galleryItems(page.getByRole("main"))).toHaveCount(24);
  await page.getByRole("main").locator('a[rel="next"]').click();
  await expect(galleryItems(page.getByRole("main"))).toHaveCount(30);
});

test.describe("captioned extreme-portrait cell squeezed by its row neighbour", () => {
  // Scriptless: the popover this test ends with is a native
  // `popovertarget`-invoking button (`gallery-lightbox.tsx`'s
  // `GalleryLightboxTrigger`) whose own `onClick` calls `preventDefault()`
  // once hydrated, deliberately routing an activated trigger to the lightbox
  // instead — the popover is this codebase's documented *scriptless*
  // fallback, so exercising it means not hydrating, exactly like the
  // "full captions without script" describe block below. The overflow half
  // of this test is pure CSS/layout and holds identically either way.
  test.use({ javaScriptEnabled: false });

  test("never overflows, and its full caption stays reachable through the popover", async ({
    page,
  }) => {
    // `layout-pair` puts an extreme (1:8) portrait beside a panorama (16:1) in
    // one justified row, squeezing the portrait to only a few pixels wide —
    // narrow enough that `-webkit-line-clamp` cannot fit even one character
    // per line. Measured in both engines: at that width the clamp does not
    // just fail to truncate gracefully, it stops capping the box at all, and
    // the caption's real text paints far past the figure it belongs to. The
    // fix drops the resting caption below a minimum figure width rather than
    // let it overflow; this proves neither failure mode by measuring actual
    // painted text extent, not just the figcaption's own (possibly wrongly
    // small) box.
    await page.setViewportSize({ width: 600, height: 900 });
    await page.goto(path("layout-pair"), { waitUntil: "load" });
    const main = page.getByRole("main");
    const items = galleryItems(main);
    await expect(items).toHaveCount(2);

    const measured = await items.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        const span = element.querySelector(".gallery-caption-text");
        let textRight: number | null = null;
        let textBottom: number | null = null;
        if (span?.firstChild) {
          const range = document.createRange();
          range.selectNodeContents(span.firstChild);
          const rects = [...range.getClientRects()];
          if (rects.length > 0) {
            textRight = Math.max(...rects.map((r) => r.right));
            textBottom = Math.max(...rects.map((r) => r.bottom));
          }
        }
        return {
          itemId: element.querySelector("[data-item-id]")?.getAttribute("data-item-id") ?? "",
          width: rect.width,
          right: rect.right,
          bottom: rect.bottom,
          textRight,
          textBottom,
        };
      }),
    );

    const narrow = measured.reduce((a, b) => (a.width < b.width ? a : b));
    const wide = measured.find((item) => item !== narrow)!;

    // The squeezed cell is genuinely squeezed — otherwise this fixture is not
    // exercising the case this test exists for.
    expect(narrow.width).toBeLessThan(20);

    // Neither the narrow item's caption text nor the wide one's escapes its
    // own figure, in either direction.
    for (const item of [narrow, wide]) {
      if (item.textRight !== null) {
        expect(item.textRight, `${item.itemId} caption right edge`).toBeLessThanOrEqual(
          item.right + 1,
        );
      }
      if (item.textBottom !== null) {
        expect(item.textBottom, `${item.itemId} caption bottom edge`).toBeLessThanOrEqual(
          item.bottom + 1,
        );
      }
    }

    // The narrow item's own full caption stays reachable through the
    // popover — dropping the resting caption must not also drop caption
    // access.
    const narrowTrigger = main.locator(`[data-item-id="${narrow.itemId}"]`);
    await narrowTrigger.focus();
    await page.keyboard.press("Enter");
    const popover = page.getByRole("dialog");
    await expect(popover).toBeVisible();
    await expect(popover.locator("p")).toHaveText("A narrow portrait frame");
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
  });
});

test.describe("full captions without script", () => {
  test.use({ javaScriptEnabled: false });
  test("long captions remain readable at enlarged text size, including a low panorama", async ({ page, isMobile }) => {
    for (const id of ["grid-overlay", "masonry-below", "masonry-overlay", "justified-overlay"]) {
      await page.goto(path(id));
      await page.evaluate(() => document.documentElement.style.setProperty("font-size", "32px", "important"));
      const main = page.getByRole("main");
      const item = galleryItems(main).filter({ has: page.locator('img[width="2048"]') }).first();
      const caption = item.locator("figcaption");
      const trigger = item.locator("[data-item-id]");
      if (isMobile) await trigger.tap();
      else { await trigger.focus(); await page.keyboard.press("Enter"); }
      const popover = page.getByRole("dialog");
      await expect(popover).toBeVisible();
      await expect(popover.locator("p")).toHaveText(await caption.innerText());
      expect(await popover.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      await page.keyboard.press("Escape");
      await expect(popover).toHaveCount(0);
      expect(await caption.evaluate((node) => getComputedStyle(node).pointerEvents)).toBe("none");
    }
  });
});

test.describe("responsive image source at an enlarged root font size", () => {
  test.use({ javaScriptEnabled: true });

  /**
   * A persistent accessibility setting (browser or OS text zoom at up to
   * 200%, WCAG's own bound), so it has to be in place for the page's very
   * first parse: `sizes`/`srcset` source selection happens once, when the
   * browser decodes the image, and a later runtime style mutation does not
   * retroactively reselect a source. `page.addInitScript` looked like the
   * right tool for that and is not: it runs before `document.documentElement`
   * exists, so `element.style.setProperty(...)` inside one throws, and
   * because the test asserted nothing about the *page*, it passed anyway
   * while silently leaving the root at its default 16px (a real gap this
   * project's own review process caught — an unasserted setup step is a
   * setup step that can quietly do nothing). Rewriting the response body to
   * carry the override in the markup itself, before the browser ever parses
   * it, is what actually works, and the assertion below is what would have
   * caught the very failure this replaces.
   */
  async function forceRootFontSize(page: import("@playwright/test").Page, url: string, px: number) {
    await page.route(url, async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      await route.fulfill({
        response,
        body: body.replace("<head>", `<head><style>html{font-size:${px}px!important}</style>`),
      });
    });
  }

  for (const id of ["masonry-below", "justified-below"] as const) {
    test(`${id} never selects a candidate narrower than the rendered image`, async ({ page }) => {
      const url = path(id);
      for (const width of [375, 640, 944, 1152, 1280, 2000]) {
        await page.unrouteAll();
        await forceRootFontSize(page, url, 32);
        await page.setViewportSize({ width, height: 900 });
        await page.goto(url, { waitUntil: "load" });

        const actualRoot = await page.evaluate(
          () => getComputedStyle(document.documentElement).fontSize,
        );
        expect(actualRoot, "the enlarged root font-size actually took effect").toBe("32px");

        const main = page.getByRole("main");
        await expect(galleryItems(main)).toHaveCount(24);

        const measured = await main.locator("img").evaluateAll((images) =>
          images
            .filter((image) => (image as HTMLImageElement).currentSrc)
            .map((image) => {
              const img = image as HTMLImageElement;
              const url = new URL(img.currentSrc);
              return {
                candidateWidth: Number(url.searchParams.get("w")),
                renderedWidth: img.getBoundingClientRect().width,
              };
            }),
        );

        expect(measured.length, `at ${width}px`).toBeGreaterThan(0);
        for (const { candidateWidth, renderedWidth } of measured) {
          // A device-pixel-ratio-1 browser context, so the rendered CSS width
          // itself is the bar a same-or-larger candidate must clear.
          expect(
            candidateWidth,
            `at ${width}px, rendered ${renderedWidth}`,
          ).toBeGreaterThanOrEqual(Math.round(renderedWidth));
        }
      }
    });
  }
});
